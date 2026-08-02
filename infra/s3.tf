# ============================================================================
# Stockage du site — bucket PRIVÉ
# ----------------------------------------------------------------------------
# Le bucket n'est jamais exposé au public. Seule la distribution CloudFront peut
# le lire, via un « Origin Access Control ». C'est ce qui empêche de contourner
# CloudFront en tapant l'URL S3 directement — et donc de contourner le HTTPS,
# les en-têtes de sécurité et le repli SPA.
# ============================================================================

resource "random_id" "suffixe" {
  byte_length = 4
}

resource "aws_s3_bucket" "site" {
  # Les noms de bucket sont uniques sur TOUT AWS, pas seulement dans le compte :
  # un suffixe aléatoire évite l'échec au premier apply.
  bucket = "musea-${var.environment}-${random_id.suffixe.hex}"

  # Voir la variable : à laisser à false en production.
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Le versionnement sert de filet : un déploiement qui casse tout se rattrape en
# restaurant les versions précédentes, sans reconstruire.
resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Sans expiration, chaque déploiement empile une version de plus de chaque
# fichier — la facture grossit en silence.
resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket     = aws_s3_bucket.site.id
  depends_on = [aws_s3_bucket_versioning.site]

  rule {
    id     = "purge-anciennes-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Seule cette distribution CloudFront peut lire le bucket.
data "aws_iam_policy_document" "site_lecture_cloudfront" {
  statement {
    sid       = "AutoriseCloudFrontUniquement"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_lecture_cloudfront.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}
