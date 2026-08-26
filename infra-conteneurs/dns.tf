# ============================================================================
# DNS et certificat de la pile conteneurs
# ----------------------------------------------------------------------------
# La zone `nexacode.store` est PARTAGÉE avec `infra/`. Cette pile n'y ajoute que
# ses propres entrées, et jamais à la racine :
#
#   conteneurs.nexacode.store          A / AAAA  → répartiteur de charge
#   _xxxx.conteneurs.nexacode.store    CNAME     → validation du certificat
#
# `infra/` possède la racine et le joker `*.nexacode.store`. Route 53 fait
# primer l'enregistrement EXACT sur le joker : `conteneurs.nexacode.store` ira
# donc vers le répartiteur, et tous les autres noms — `bandjoun`, `musea`… —
# continueront d'aller vers CloudFront, sans qu'aucun d'eux ne soit modifié.
#
# Le certificat, lui, est RÉGIONAL (eu-west-3). Celui de `infra/` vit en
# us-east-1 parce que CloudFront l'exige ; un répartiteur de charge exige
# l'inverse — le certificat doit être dans SA région. Deux certificats
# distincts, deux services, aucune interférence.
# ============================================================================

data "aws_route53_zone" "principale" {
  count        = var.hosted_zone_id == "" ? 1 : 0
  name         = "${var.zone_domaine}."
  private_zone = false
}

locals {
  zone_id            = var.hosted_zone_id != "" ? var.hosted_zone_id : data.aws_route53_zone.principale[0].zone_id
  domaine_conteneurs = "${var.sous_domaine}.${var.zone_domaine}"
}

resource "aws_acm_certificate" "conteneurs" {
  # Un certificat n'a de sens que s'il y a un répartiteur pour le présenter.
  # Avec `activer_ecs = false` — le cas quand on ne monte que SES — cette pile
  # ne pose donc AUCUN enregistrement lié au web dans la zone partagée.
  count = var.activer_ecs ? 1 : 0

  domain_name       = local.domaine_conteneurs
  validation_method = "DNS"

  # Pas de joker ici : un répartiteur de charge sert un seul nom d'hôte. Les
  # sous-domaines d'organisation restent servis par CloudFront.

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.prefixe}-certificat" }
}

resource "aws_route53_record" "validation" {
  # Clé = nom de domaine, connue dès le plan. Utiliser `resource_record_name`
  # comme clé ferait échouer le plan (« Invalid for_each argument ») puisque
  # cette valeur n'existe qu'après création du certificat.
  # Splat plutôt que ternaire : `aws_acm_certificate.conteneurs[*]` rend une
  # liste VIDE quand le count vaut zéro, là où `conteneurs[0]` lèverait
  # « Invalid index » dès le plan — y compris dans la branche non retenue d'une
  # condition, que Terraform résout quand même.
  for_each = {
    for o in flatten(aws_acm_certificate.conteneurs[*].domain_validation_options) : o.domain_name => {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }...
  }

  zone_id = local.zone_id
  name    = each.value[0].name
  type    = each.value[0].type
  records = [each.value[0].value]
  ttl     = 60

  # La zone héberge d'autres projets : on écrase un enregistrement de validation
  # homonyme sans hésiter, mais on ne touche à rien d'autre.
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "conteneurs" {
  count = var.activer_ecs ? 1 : 0

  certificate_arn         = aws_acm_certificate.conteneurs[0].arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]

  # La zone est déjà déléguée chez le registrar : la validation aboutit en
  # quelques minutes. Si elle reste bloquée 30 minutes, ce n'est pas la lenteur
  # d'ACM — c'est que la délégation DNS ne pointe pas vers cette zone.
  timeouts {
    create = "30m"
  }
}

# ---------------------------------------------------------- pointage du nom
# Alias, pas CNAME : facturé zéro requête, et un alias suit le répartiteur si
# celui-ci change d'adresse.
#
# Ces enregistrements n'existent que si ECS est monté. Avec EKS seul, c'est
# Kubernetes qui crée le répartiteur : Terraform ne peut pas en connaître le nom
# au moment du plan. On pose alors l'enregistrement après coup (voir
# kubernetes/README.md) ou l'on confie la tâche à ExternalDNS.
resource "aws_route53_record" "conteneurs_a" {
  count = var.activer_ecs ? 1 : 0

  zone_id = local.zone_id
  name    = local.domaine_conteneurs
  type    = "A"

  alias {
    name                   = aws_lb.principal[0].dns_name
    zone_id                = aws_lb.principal[0].zone_id
    evaluate_target_health = true
  }
}

# Pas d'enregistrement AAAA ici, et c'est délibéré : un répartiteur de charge ne
# répond en IPv6 que s'il est déclaré « dualstack », ce qui suppose d'attribuer
# un bloc IPv6 au VPC et à chaque sous-réseau. Poser un AAAA vers un répartiteur
# IPv4 produirait la pire panne qui soit — un site injoignable pour les seuls
# visiteurs en IPv6, et parfaitement normal depuis le poste qui teste.
# CloudFront, côté `infra/`, sert déjà l'IPv6 : les visiteurs concernés passent
# par là.
