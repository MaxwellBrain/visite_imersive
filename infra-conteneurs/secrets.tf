# ============================================================================
# AWS Secrets Manager — une seule source de vérité pour la configuration
# ----------------------------------------------------------------------------
# Aujourd'hui, la configuration de MUSÉA est recopiée à trois endroits : le
# `.env` local, les secrets GitHub, le tableau de bord Supabase. Trois copies
# qui divergent, et une panne par divergence.
#
# Ce secret devient la référence. La CI le lit après s'être authentifiée par
# OIDC ; le conteneur en reçoit une partie à son démarrage.
#
# CE QUE TERRAFORM ÉCRIT ET CE QU'IL N'ÉCRIT PAS
#
# Terraform crée le secret et y pose un gabarit VIDE. Il ne connaîtra jamais
# les vraies valeurs : `ignore_changes` lui interdit de les relire ou de les
# écraser au prochain apply. On les renseigne une fois, à la main :
#
#   aws secretsmanager put-secret-value \
#     --secret-id musea/production/application \
#     --secret-string file://valeurs.json
#
# Sans cette précaution, les secrets se retrouveraient en clair dans
# `terraform.tfvars` et dans le fichier d'état — c'est-à-dire, tôt ou tard,
# dans un dépôt Git.
# ============================================================================

locals {
  # Les clés attendues dans le document JSON. Le gabarit les crée toutes vides :
  # une clé absente ferait échouer le DÉMARRAGE de la tâche ECS (« secret not
  # found »), panne d'autant plus déroutante qu'elle n'apparaît pas au déploiement.
  gabarit_secret = {
    vite_supabase_url      = ""
    vite_supabase_anon_key = ""
    vite_platform_domain   = local.domaine_conteneurs
    basic_auth             = "" # « utilisateur:motdepasse » ⇒ portail de staging
  }
}

resource "aws_secretsmanager_secret" "application" {
  name        = "musea/${var.environnement}/application"
  description = "Configuration MUSEA : compilation du frontal et reglages d'execution du conteneur"

  # Une suppression est différée, pas immédiate — et le nom reste réservé
  # pendant tout le délai de grâce. En production c'est un filet de sécurité ;
  # hors production, c'est le piège classique : on détruit, on remonte aussitôt
  # et l'apply échoue sur « already scheduled for deletion ».
  recovery_window_in_days = var.environnement == "production" ? 7 : 0

  tags = { Name = "${local.prefixe}-secret" }
}

resource "aws_secretsmanager_secret_version" "gabarit" {
  secret_id     = aws_secretsmanager_secret.application.id
  secret_string = jsonencode(local.gabarit_secret)

  lifecycle {
    # LA ligne qui compte : après le premier apply, les vraies valeurs vivent
    # dans AWS et Terraform n'y touche plus.
    ignore_changes = [secret_string]
  }
}

# Droit de LIRE ce secret, et lui seul. Réutilisé par le rôle d'exécution ECS
# (qui injecte les valeurs dans le conteneur) et par le rôle de déploiement
# GitHub (qui les lit pour compiler le frontal).
data "aws_iam_policy_document" "lire_secret" {
  statement {
    sid       = "LireLeSecretApplicatif"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.application.arn]
  }
}

resource "aws_iam_policy" "lire_secret" {
  name        = "${local.prefixe}-lire-secret"
  description = "Lecture du secret applicatif MUSEA"
  policy      = data.aws_iam_policy_document.lire_secret.json
}
