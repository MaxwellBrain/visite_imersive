# ============================================================================
# Déploiement depuis GitHub — un SECOND rôle, distinct de celui de `infra/`
# ----------------------------------------------------------------------------
# `infra/` possède déjà un rôle « musea-production-deploiement », qui sait
# écrire dans le bucket du site et purger CloudFront. Il ne sait rien faire
# d'autre, et c'est très bien : on ne l'élargit pas.
#
# Cette pile crée son propre rôle, « musea-conteneurs-… », avec ses propres
# droits — pousser une image, faire évoluer un service. Les deux rôles
# coexistent, chacun cantonné à sa moitié. Si l'un fuitait, l'autre resterait
# hors d'atteinte.
#
# Aucune clé AWS n'est stockée dans GitHub, dans les deux cas : GitHub présente
# un jeton OIDC signé, valable quelques minutes, et AWS le convertit en
# identifiants temporaires.
# ============================================================================

locals {
  deploiement_actif = var.depot_github != ""
}

# Le fournisseur d'identité est unique par compte. Par défaut on le RETROUVE :
# `infra/` l'a déjà créé. Voir la variable pour le cas d'un compte neuf.
resource "aws_iam_openid_connect_provider" "github" {
  count = local.deploiement_actif && var.creer_fournisseur_oidc_github ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "github_existant" {
  count = local.deploiement_actif && !var.creer_fournisseur_oidc_github ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  arn_oidc_github = local.deploiement_actif ? (
    var.creer_fournisseur_oidc_github
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github_existant[0].arn
  ) : null
}

data "aws_iam_policy_document" "confiance_github" {
  count = local.deploiement_actif ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.arn_oidc_github]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # C'est CETTE condition qui verrouille le rôle sur un dépôt. Sans elle,
    # n'importe quel dépôt GitHub du monde pourrait déployer sur ce compte.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.depot_github}:*"]
    }
  }
}

resource "aws_iam_role" "deploiement" {
  count = local.deploiement_actif ? 1 : 0

  name               = "${local.prefixe}-deploiement"
  description        = "Assume par GitHub Actions : pousser l'image et faire evoluer le service"
  assume_role_policy = data.aws_iam_policy_document.confiance_github[0].json
}

data "aws_iam_policy_document" "droits_deploiement" {
  count = local.deploiement_actif ? 1 : 0

  # Le jeton de connexion au registre ne peut pas être restreint à un dépôt :
  # l'action ne porte sur aucune ressource. C'est une limite d'ECR, pas un
  # relâchement — le jeton obtenu ne donne accès qu'aux dépôts autorisés
  # par les autres énoncés.
  statement {
    sid       = "OuvrirUneSessionEcr"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "PousserEtTirerLImage"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
      "ecr:DescribeImageScanFindings",
    ]
    resources = [aws_ecr_repository.application.arn]
  }

  # `RegisterTaskDefinition` ne porte sur aucune ressource nommable : une
  # définition de tâche n'existe pas encore au moment où on l'enregistre.
  statement {
    sid       = "EnregistrerUneDefinitionDeTache"
    effect    = "Allow"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
    resources = ["*"]
  }

  # Le déploiement consiste à faire pointer le service sur la nouvelle
  # révision, puis à attendre que les tâches deviennent saines.
  dynamic "statement" {
    for_each = var.activer_ecs ? [1] : []

    content {
      sid    = "FaireEvoluerLeService"
      effect = "Allow"
      actions = [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:ListTasks",
      ]
      resources = [
        aws_ecs_service.application[0].id,
        "arn:aws:ecs:${var.region}:${data.aws_caller_identity.courant.account_id}:task/${aws_ecs_cluster.principal[0].name}/*",
      ]
    }
  }

  # Enregistrer une définition de tâche revient à confier deux rôles à ECS :
  # AWS exige donc le droit explicite de les transmettre. La condition
  # restreint la transmission au seul service ECS — le rôle ne peut pas être
  # refilé à une instance EC2 ou à une Lambda.
  dynamic "statement" {
    for_each = var.activer_ecs ? [1] : []

    content {
      sid       = "TransmettreLesRolesDeTache"
      effect    = "Allow"
      actions   = ["iam:PassRole"]
      resources = [aws_iam_role.execution[0].arn, aws_iam_role.tache[0].arn]

      condition {
        test     = "StringEquals"
        variable = "iam:PassedToService"
        values   = ["ecs-tasks.amazonaws.com"]
      }
    }
  }

  # La CI lit la configuration de compilation depuis Secrets Manager : une
  # seule source de vérité, plutôt qu'une copie dans les secrets GitHub.
  statement {
    sid       = "LireLaConfigurationDeCompilation"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.application.arn]
  }

  # Sous EKS : de quoi obtenir un kubeconfig. Les droits DANS le cluster sont
  # accordés séparément, par une entrée d'accès EKS (voir eks.tf) — appartenir
  # au compte AWS ne donne aucun droit Kubernetes.
  dynamic "statement" {
    for_each = var.activer_eks ? [1] : []

    content {
      sid       = "DecrireLeClusterKubernetes"
      effect    = "Allow"
      actions   = ["eks:DescribeCluster", "eks:ListClusters"]
      resources = [aws_eks_cluster.principal[0].arn]
    }
  }
}

resource "aws_iam_role_policy" "deploiement" {
  count = local.deploiement_actif ? 1 : 0

  name   = "${local.prefixe}-deploiement"
  role   = aws_iam_role.deploiement[0].id
  policy = data.aws_iam_policy_document.droits_deploiement[0].json
}
