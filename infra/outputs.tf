output "bucket_site" {
  description = "Nom du bucket S3 — à reporter dans le secret GitHub S3_BUCKET."
  value       = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  description = "Identifiant de la distribution — secret GitHub CLOUDFRONT_DISTRIBUTION_ID."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domaine" {
  description = "Adresse technique de CloudFront. Sert à tester le site avant que le DNS ne se soit propagé."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "role_deploiement_arn" {
  description = "Rôle à assumer par GitHub Actions — secret GitHub AWS_ROLE_ARN. Vide si github_repository n'a pas été renseigné."
  value       = local.deploiement_actif ? aws_iam_role.deploiement[0].arn : ""
}

output "site_domain" {
  description = "Domaine du site — à reporter dans la variable GitHub PLATFORM_DOMAIN et dans VITE_PLATFORM_DOMAIN à la compilation."
  value       = local.site_domain
}

output "zone_utilisee" {
  description = "Zone Route 53 dans laquelle les enregistrements ont été posés. Elle préexistait : Terraform ne l'a pas créée et n'y touche à rien d'autre."
  value = {
    domaine = var.zone_domain
    zone_id = local.zone_id
  }
}

output "adresses_du_site" {
  description = "Ce que le visiteur tapera une fois la propagation faite."
  value = {
    plateforme           = "https://${local.site_domain}"
    exemple_organisation = "https://bandjoun.${local.site_domain}"
  }
}

output "rappel_supabase" {
  description = "Étape manuelle à ne pas oublier côté Supabase."
  value = join(" ", [
    "Supabase → Authentication → URL Configuration :",
    "poser Site URL = https://${local.site_domain}",
    "et ajouter aux Redirect URLs https://${local.site_domain}/**",
    "ainsi que https://*.${local.site_domain}/**.",
    "Sans cela, la connexion Google et les liens e-mail renverront vers localhost."
  ])
}
