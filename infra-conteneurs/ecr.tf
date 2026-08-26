# ============================================================================
# Registre d'images — ECR
# ----------------------------------------------------------------------------
# La CI pousse CHAQUE version vers deux registres :
#
#   · Docker Hub — vitrine publique, `docker pull maxbrain/musea:v1.2.0`
#                  fonctionne depuis n'importe quelle machine, sans compte AWS.
#   · ECR        — registre privé, dans la même région que les tâches.
#
# Pourquoi les deux plutôt qu'un seul : ECS et EKS tirent depuis ECR sans
# jamais sortir de la région (rapide, gratuit, et sans dépendre de la
# disponibilité d'un service tiers ni de ses quotas de tirage anonyme).
# Docker Hub, lui, rend le travail vérifiable par un tiers — un jury, un
# collègue — sans lui ouvrir le compte AWS.
# ============================================================================

resource "aws_ecr_repository" "application" {
  name = var.nom_image

  # MUTABLE : la CI publie « latest » en plus des étiquettes de version.
  # IMMUTABLE l'interdirait et ferait échouer chaque poussée.
  # Ce qui garantit la traçabilité, ce n'est pas l'immuabilité de l'étiquette,
  # c'est le déploiement par empreinte (voir la CI) — « latest » n'est qu'un
  # alias de confort.
  image_tag_mutability = "MUTABLE"

  # Analyse de vulnérabilités à chaque poussée. Gratuite dans sa forme de base,
  # et c'est le seul moment où l'on regarde vraiment : plus tard, personne ne
  # relance l'analyse à la main.
  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  # L'utilisateur n'existe pas encore ⇒ un `destroy` ne bute pas sur des images
  # résiduelles. Le registre n'est pas une donnée : tout y est reconstructible.
  force_delete = true

  tags = { Name = "${local.prefixe}-ecr" }
}

# Sans politique de cycle de vie, chaque poussée empile une image de ~60 Mo et
# la facture grossit en silence. Deux règles, dans cet ordre — ECR les applique
# par priorité croissante.
resource "aws_ecr_lifecycle_policy" "purge" {
  repository = aws_ecr_repository.application.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Les images sans etiquette sont des restes de build : 7 jours suffisent a diagnostiquer."
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Conserver les 15 dernieres versions : de quoi revenir en arriere plusieurs fois."
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "sha-", "main-", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 15
        }
        action = { type = "expire" }
      }
    ]
  })
}
