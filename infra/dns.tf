# ============================================================================
# DNS et certificat — sur une zone Route 53 DÉJÀ EXISTANTE
# ----------------------------------------------------------------------------
# La zone `nexacode.space` existe et est déjà déléguée chez le registrar :
# Terraform ne la crée pas, il s'y greffe. Le site occupe un sous-domaine,
# « musea.nexacode.space », et l'on ne touche à aucun autre enregistrement.
#
# Le certificat couvre DEUX entrées :
#
#   musea.nexacode.space     — le site lui-même
#   *.musea.nexacode.space   — les sous-domaines d'organisation
#                              (bandjoun.musea.nexacode.space…)
#
# Un joker ne couvre PAS le nom qu'il préfixe, ni plus d'un niveau : d'où les
# deux entrées, et le fait que les slugs d'organisation doivent rester plats.
# ============================================================================

locals {
  # Domaine du site. Sous-domaine vide ⇒ on s'installe sur la racine de la zone.
  site_domain = var.subdomain == "" ? var.zone_domain : "${var.subdomain}.${var.zone_domain}"

  # Motif joker pour les organisations.
  site_wildcard = "*.${local.site_domain}"
}

# La zone existe déjà : on la retrouve. `hosted_zone_id` permet de lever
# l'ambiguïté si plusieurs zones portent le même nom dans le compte.
data "aws_route53_zone" "principale" {
  count        = var.hosted_zone_id == "" ? 1 : 0
  name         = "${var.zone_domain}."
  private_zone = false
}

locals {
  zone_id = var.hosted_zone_id != "" ? var.hosted_zone_id : data.aws_route53_zone.principale[0].zone_id
}

# ---------------------------------------------------------------- certificat
resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1 # CloudFront n'accepte que us-east-1

  domain_name               = local.site_domain
  subject_alternative_names = [local.site_wildcard]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Enregistrements de validation, posés dans la zone existante.
#
# La déduplication par nom est nécessaire : le domaine et son joker produisent
# souvent le MÊME enregistrement de validation, et Terraform refuserait deux
# ressources partageant une clé. Le `...` regroupe les doublons en liste.
resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.resource_record_name => {
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

  # La zone contient d'autres projets : on écrase sans hésiter un enregistrement
  # de validation homonyme, mais jamais rien d'autre.
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]

  # La zone étant déjà déléguée, la validation aboutit en quelques minutes.
  timeouts {
    create = "30m"
  }
}

# ------------------------------------------------------------ enregistrements
# Alias plutôt que CNAME : facturé zéro requête, et seul l'alias fonctionne sur
# une racine de zone (utile si `subdomain` est un jour laissé vide).
resource "aws_route53_record" "site_a" {
  zone_id = local.zone_id
  name    = local.site_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_aaaa" {
  zone_id = local.zone_id
  name    = local.site_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

# Le joker : c'est lui qui fait exister bandjoun.musea.nexacode.space sans qu'on
# ait à créer un enregistrement par organisation. L'application résout ensuite
# le locataire à partir du nom d'hôte (src/services/host.js).
resource "aws_route53_record" "joker_a" {
  zone_id = local.zone_id
  name    = local.site_wildcard
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "joker_aaaa" {
  zone_id = local.zone_id
  name    = local.site_wildcard
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
