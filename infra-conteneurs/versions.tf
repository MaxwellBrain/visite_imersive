# ============================================================================
# PILE CONTENEURS — seconde infrastructure, indépendante de `infra/`
# ----------------------------------------------------------------------------
# Ce dossier est un état Terraform SÉPARÉ. Il ne connaît rien de `infra/`, ne
# lit pas son état, ne peut donc rien y modifier ni y détruire. Les deux piles
# cohabitent dans le même compte AWS et la même zone Route 53 sans se voir.
#
# Ce qui garantit la non-collision, point par point :
#
#   · État        — `infra-conteneurs/terraform.tfstate`, distinct.
#   · Nommage     — toutes les ressources sont préfixées « musea-conteneurs- ».
#   · DNS         — la pile n'écrit QU'UN enregistrement exact
#                   (conteneurs.nexacode.store) ; l'enregistrement joker
#                   « *.nexacode.store » de `infra/` reste intact et continue
#                   de servir tous les autres noms. Un enregistrement exact
#                   l'emporte sur un joker pour ce seul nom : c'est la règle de
#                   résolution de Route 53, pas un effet de bord.
#   · OIDC GitHub — le fournisseur d'identité est UNIQUE PAR COMPTE et existe
#                   déjà (créé par `infra/`). Cette pile le LIT (data source)
#                   et ne le crée jamais : le recréer lèverait
#                   EntityAlreadyExists et ferait échouer l'apply.
#   · SES         — l'identité est posée sur un sous-domaine dédié
#                   (notif.nexacode.store) : aucun enregistrement SendGrid
#                   existant à la racine n'est touché. Voir ses.tf.
#
# Rien ici ne référence le bucket du site, la distribution CloudFront ni le
# certificat us-east-1 de `infra/`.
# ============================================================================

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # État distant — à décommenter le jour où l'on déploie à plusieurs.
  # La clé DIFFÈRE de celle de `infra/` : deux piles ne partagent jamais un état.
  #
  # backend "s3" {
  #   bucket       = "musea-tfstate"
  #   key          = "musea/conteneurs.tfstate"
  #   region       = "eu-west-3"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "musea"
      Stack       = "conteneurs" # <- distingue les deux piles dans la facture
      Environment = var.environnement
      ManagedBy   = "terraform"
    }
  }
}

# Identité du compte : sert à composer les ARN et à verrouiller les politiques
# IAM sur CE compte plutôt que sur « * ».
data "aws_caller_identity" "courant" {}

# Zones de disponibilité réellement utilisables dans la région. Les coder en dur
# (eu-west-3a/b) fonctionne aujourd'hui et casse le jour où l'on change de
# région ou qu'AWS retire une zone d'un compte.
data "aws_availability_zones" "disponibles" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  prefixe = "musea-conteneurs-${var.environnement}"

  # Deux zones : c'est le minimum exigé par un Application Load Balancer, et
  # c'est aussi ce qui rend la panne d'une zone survivable.
  zones = slice(data.aws_availability_zones.disponibles.names, 0, 2)
}
