# ============================================================================
# Distribution CloudFront
# ----------------------------------------------------------------------------
# Deux points valent qu'on s'y arrête, parce qu'ils cassent des choses visibles :
#
#  1. LE REPLI SPA. Le routeur Vue gère /site/visite/3 côté navigateur, mais S3
#     ne connaît pas ce chemin et répond 403. Sans les `custom_error_response`
#     ci-dessous, tout lien profond échoue au rafraîchissement — et les QR codes
#     de réalité augmentée pointent précisément vers /site/ar/<id>.
#
#  2. LES DURÉES DE CACHE. Les fichiers de /assets/ portent un hachage dans leur
#     nom : ils sont immuables, on les garde un an. index.html et sw.js, eux, ne
#     doivent JAMAIS être mis en cache, sinon un déploiement reste invisible
#     pendant des heures pour qui a déjà visité le site.
# ============================================================================

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "musea-${var.environment}-oac"
  description                       = "Accès exclusif de CloudFront au bucket du site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Politiques de cache gérées par AWS.
#
# Ces identifiants sont des CONSTANTES GLOBALES : ils sont identiques dans tous
# les comptes AWS, toutes régions confondues. On les écrit en dur volontairement.
#
# La forme élégante — `data "aws_cloudfront_cache_policy" { name = "…" }` —
# oblige AWS à LISTER toutes les politiques du compte pour retrouver celle qui
# porte ce nom, et réclame donc la permission `cloudfront:ListCachePolicies`.
# Exiger un droit supplémentaire pour retrouver une valeur connue d'avance est
# un mauvais échange : on perd en robustesse ce qu'on gagne en lisibilité.
locals {
  # Managed-CachingOptimized — compression, TTL long, aucun en-tête transmis.
  cache_policy_optimise = "658327ea-f89d-4fab-a63d-7e88639e58f6"

  # Managed-CachingDisabled — rien n'est mis en cache.
  cache_policy_desactive = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
}

resource "aws_cloudfront_response_headers_policy" "securite" {
  name    = "musea-${var.environment}-securite"
  comment = "En-têtes de sécurité du site MUSÉA"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false # à n'activer qu'une fois le domaine stabilisé
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    # POLITIQUE DE SÉCURITÉ DU CONTENU — volontairement NON activée.
    #
    # Le site appelle beaucoup de tiers : Supabase, cinq API de musées, Wikipédia,
    # Open Library, Google Fonts, un générateur de QR, et model-viewer qui crée
    # des workers. Une CSP incomplète casse en silence une fonctionnalité qu'on
    # ne teste pas ce jour-là. La liste ci-dessous est celle réellement lue dans
    # le code — à activer APRÈS avoir vérifié chaque écran en préproduction.
    #
    # content_security_policy {
    #   override = true
    #   content_security_policy = join(" ", [
    #     "default-src 'self';",
    #     "script-src 'self' 'wasm-unsafe-eval' blob:;",
    #     "worker-src 'self' blob:;",
    #     "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
    #     "font-src 'self' https://fonts.gstatic.com;",
    #     "img-src 'self' data: blob: https:;",
    #     "media-src 'self' data: blob: https:;",
    #     "connect-src 'self' blob: https://*.supabase.co",
    #     "  https://collectionapi.metmuseum.org https://api.artic.edu",
    #     "  https://openaccess-api.clevelandart.org https://api.vam.ac.uk",
    #     "  https://www.wikidata.org https://query.wikidata.org",
    #     "  https://fr.wikipedia.org https://en.wikipedia.org",
    #     "  https://openlibrary.org;",
    #     "frame-ancestors 'none';",
    #     "base-uri 'self';"
    #   ])
    # }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "MUSÉA — ${var.environment}"
  default_root_object = "index.html"
  price_class         = var.price_class

  aliases = [var.domain, "*.${var.domain}"]

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Comportement par défaut : le document HTML, jamais mis en cache.
  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = local.cache_policy_desactive
    response_headers_policy_id = aws_cloudfront_response_headers_policy.securite.id
  }

  # Les fichiers compilés portent un hachage : immuables, donc cache maximal.
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = local.cache_policy_optimise
    response_headers_policy_id = aws_cloudfront_response_headers_policy.securite.id
  }

  # Modèles 3D de démonstration : stables, mais pas hachés — cache modéré.
  ordered_cache_behavior {
    path_pattern           = "/modeles/*"
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false # un .glb est déjà compressé

    cache_policy_id            = local.cache_policy_optimise
    response_headers_policy_id = aws_cloudfront_response_headers_policy.securite.id
  }

  # Le service worker décide de ce que voient les visiteurs déjà venus.
  # Mis en cache, il fige le site sur une version périmée.
  ordered_cache_behavior {
    path_pattern           = "/sw.js"
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = local.cache_policy_desactive
    response_headers_policy_id = aws_cloudfront_response_headers_policy.securite.id
  }

  # LE REPLI SPA. S3 répond 403 (et non 404) sur une clé absente quand le bucket
  # est privé : les deux codes doivent être rattrapés. Le 200 est essentiel —
  # renvoyer index.html avec un 404 casserait le référencement et les partages.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
