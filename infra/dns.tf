# ============================================================================
# DNS et certificat
# ----------------------------------------------------------------------------
# Le certificat couvre DEUX entrées, et c'est indispensable :
#
#   musea.space     — le domaine nu. Un joker ne le couvre PAS.
#   *.musea.space   — tous les sous-domaines d'organisation (bandjoun.musea.space…),
#                     c'est-à-dire l'architecture multi-tenant de la Phase 2.
#
# Un joker ne descend que d'un seul niveau : « a.b.musea.space » ne serait pas
# couvert. Sans importance ici, les slugs d'organisation étant plats.
# ============================================================================

resource "aws_route53_zone" "principale" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.domain

  comment = "MUSÉA — zone gérée par Terraform"
}

data "aws_route53_zone" "existante" {
  count        = var.create_hosted_zone ? 0 : 1
  name         = "${var.domain}."
  private_zone = false
}

locals {
  zone_id = var.create_hosted_zone ? aws_route53_zone.principale[0].zone_id : data.aws_route53_zone.existante[0].zone_id
}

# ---------------------------------------------------------------- certificat
resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1 # obligatoire pour CloudFront

  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Enregistrements de validation. La déduplication par nom est nécessaire : le
# domaine nu et le joker produisent souvent le MÊME enregistrement de validation,
# et Terraform refuserait deux ressources de même clé.
resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }...
  }

  zone_id         = local.zone_id
  name            = each.value[0].name
  type            = each.value[0].type
  records         = [each.value[0].value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]

  # 45 minutes : de quoi absorber la propagation DNS après délégation.
  #
  # Mais que ce soit clair — allonger ce délai ne sauve JAMAIS une délégation
  # absente. AWS interroge le DNS public du domaine ; si le registrar pointe
  # encore ailleurs, il ne trouvera jamais l'enregistrement de validation, et le
  # certificat restera en PENDING_VALIDATION pour toujours.
  #
  # D'où la marche à suivre en deux temps (voir DEPLOY.md) :
  #   1. terraform apply -target=aws_route53_zone.principale
  #   2. déléguer chez le registrar, vérifier avec nslookup
  #   3. terraform apply
  timeouts {
    create = "45m"
  }
}

# ------------------------------------------------------------ enregistrements
# Alias A/AAAA plutôt que CNAME : seul l'alias fonctionne sur un domaine nu,
# et il est facturé zéro requête.
resource "aws_route53_record" "apex_a" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

# Le joker : c'est lui qui fait exister bandjoun.musea.space sans qu'on ait à
# créer un enregistrement par organisation. L'application résout ensuite le
# locataire à partir du nom d'hôte (src/services/host.js).
resource "aws_route53_record" "joker_a" {
  zone_id = local.zone_id
  name    = "*.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "joker_aaaa" {
  zone_id = local.zone_id
  name    = "*.${var.domain}"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
