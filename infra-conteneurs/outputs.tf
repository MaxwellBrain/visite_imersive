# ============================================================================
# Ce que la pile rend, et où le reporter
# ============================================================================

output "adresse_du_service" {
  description = "Adresse publique servie par les conteneurs."
  value       = var.activer_ecs ? "https://${local.domaine_conteneurs}" : "(ECS desactive)"
}

output "repartiteur_dns" {
  description = "Nom technique du repartiteur. Sert a tester avant que le DNS ne se soit propage."
  value       = var.activer_ecs ? aws_lb.principal[0].dns_name : ""
}

output "registre_ecr" {
  description = "Adresse du depot ECR — secret GitHub ECR_REPOSITORY."
  value       = aws_ecr_repository.application.repository_url
}

output "cluster_ecs" {
  description = "Nom du cluster ECS — variable GitHub ECS_CLUSTER."
  value       = var.activer_ecs ? aws_ecs_cluster.principal[0].name : ""
}

output "service_ecs" {
  description = "Nom du service ECS — variable GitHub ECS_SERVICE."
  value       = var.activer_ecs ? aws_ecs_service.application[0].name : ""
}

output "famille_tache" {
  description = "Famille de la definition de tache — variable GitHub ECS_TASK_FAMILY."
  value       = var.activer_ecs ? aws_ecs_task_definition.application[0].family : ""
}

output "role_deploiement_arn" {
  description = "Role assume par GitHub Actions — secret GitHub AWS_ROLE_ARN_CONTENEURS. Vide si depot_github n'a pas ete renseigne."
  value       = local.deploiement_actif ? aws_iam_role.deploiement[0].arn : ""
}

output "secret_application" {
  description = "Secret Secrets Manager a renseigner AVANT le premier deploiement."
  value = {
    nom            = aws_secretsmanager_secret.application.name
    arn            = aws_secretsmanager_secret.application.arn
    cles_attendues = keys(local.gabarit_secret)
    commande = join(" ", [
      "aws secretsmanager put-secret-value",
      "--secret-id ${aws_secretsmanager_secret.application.name}",
      "--secret-string file://valeurs.json",
      "--region ${var.region}"
    ])
  }
}

output "cluster_kubernetes" {
  description = "Cluster EKS et commande pour s'y connecter. Vide si EKS est desactive."
  value = var.activer_eks ? {
    nom        = aws_eks_cluster.principal[0].name
    endpoint   = aws_eks_cluster.principal[0].endpoint
    version    = aws_eks_cluster.principal[0].version
    kubeconfig = "aws eks update-kubeconfig --name ${aws_eks_cluster.principal[0].name} --region ${var.region}"
    role_irsa  = aws_iam_role.irsa_application[0].arn
  } : null
}

output "ses" {
  description = "Identite SES et etat de la delegation."
  value = var.activer_ses ? {
    identite          = aws_sesv2_email_identity.notifications[0].email_identity
    expediteur_type   = "musea@${local.domaine_notifications}"
    domaine_rejets    = local.domaine_rejets
    jeu_configuration = aws_sesv2_configuration_set.principal[0].configuration_set_name
    verification = join(" ", [
      "aws ses get-identity-verification-attributes",
      "--identities ${local.domaine_notifications}",
      "--region ${var.region}"
    ])
    rappel_bac_a_sable = "Compte en bac a sable : n'expedie qu'aux adresses verifiees. Demander la sortie dans SES > Account dashboard, compter 24 h."
  } : null
}

# Identifiants SMTP pour les Edge Functions Supabase, qui tournent hors d'AWS.
# `sensitive` empêche l'affichage : les lire demande un appel explicite.
#   terraform output -raw identifiants_smtp_ses
output "identifiants_smtp_ses" {
  description = "Identifiants SMTP SES (utilisateur IAM). Vide si creer_utilisateur_ses = false."
  sensitive   = true

  value = var.activer_ses && var.creer_utilisateur_ses ? jsonencode({
    hote        = "email-smtp.${var.region}.amazonaws.com"
    port        = 587
    utilisateur = aws_iam_access_key.ses[0].id
    # SES ne veut pas la clé secrète brute mais une signature dérivée : la
    # coller telle quelle donne un « 535 Authentication Credentials Invalid »
    # incompréhensible. Terraform fait la dérivation.
    mot_de_passe = aws_iam_access_key.ses[0].ses_smtp_password_v4
    cle_acces    = aws_iam_access_key.ses[0].id
    cle_secrete  = aws_iam_access_key.ses[0].secret
  }) : ""
}

output "a_reporter_dans_github" {
  description = "Recapitulatif des secrets et variables a poser dans le depot, une fois l'apply passe."
  value = {
    secrets = {
      AWS_ROLE_ARN_CONTENEURS = local.deploiement_actif ? aws_iam_role.deploiement[0].arn : "(depot_github non renseigne)"
      DOCKERHUB_USERNAME      = "(votre compte Docker Hub — facultatif)"
      DOCKERHUB_TOKEN         = "(jeton d'acces Docker Hub — facultatif)"
    }
    variables = {
      AWS_REGION               = var.region
      ECR_REPOSITORY           = aws_ecr_repository.application.repository_url
      ECS_CLUSTER              = var.activer_ecs ? aws_ecs_cluster.principal[0].name : ""
      ECS_SERVICE              = var.activer_ecs ? aws_ecs_service.application[0].name : ""
      ECS_TASK_FAMILY          = var.activer_ecs ? aws_ecs_task_definition.application[0].family : ""
      DOCKERHUB_REPOSITORY     = var.depot_dockerhub
      SECRET_APPLICATION       = aws_secretsmanager_secret.application.name
      CONTENEUR_DOMAINE        = local.domaine_conteneurs
      EKS_CLUSTER              = var.activer_eks ? aws_eks_cluster.principal[0].name : ""
      EKS_IRSA_ROLE_ARN        = var.activer_eks ? aws_iam_role.irsa_application[0].arn : ""
      ECR_REPOSITORY_NAME      = aws_ecr_repository.application.name
      CONTENEUR_DEPLOY_ENABLED = "true  <- l'interrupteur : tant qu'il n'est pas pose, le workflow ne s'execute pas"
    }
  }
}

output "tableau_de_bord" {
  description = "Page CloudWatch a ouvrir en soutenance."
  value       = var.activer_ecs ? "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.principal[0].dashboard_name}" : ""
}

output "cohabitation_avec_infra" {
  description = "Ce que cette pile a touche dans la zone partagee — et ce qu'elle n'a pas touche."
  value = {
    enregistrements_crees = compact([
      var.activer_ecs ? "${local.domaine_conteneurs} (A)" : "",
      var.activer_ses ? "3 CNAME DKIM sous ${local.domaine_notifications}" : "",
      var.activer_ses ? "${local.domaine_rejets} (MX + TXT)" : "",
      var.activer_ses ? "_dmarc.${local.domaine_notifications} (TXT)" : "",
    ])
    jamais_touche = [
      "${var.zone_domaine} (A/AAAA) — la plateforme, servie par CloudFront",
      "*.${var.zone_domaine} (A/AAAA) — les sous-domaines d'organisation",
      "_dmarc.${var.zone_domaine}, SPF racine, em2987 et s1/s2._domainkey — SendGrid",
    ]
  }
}
