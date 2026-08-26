# ============================================================================
# ECS Fargate — exécution des conteneurs sans serveur à administrer
# ----------------------------------------------------------------------------
# Fargate plutôt qu'EC2 : aucune instance à mettre à jour, à patcher ni à
# dimensionner. On décrit une tâche, AWS trouve où la faire tourner.
#
# Deux rôles distincts, et la distinction n'est pas cosmétique :
#
#   · rôle d'EXÉCUTION — utilisé par l'agent ECS, AVANT que le conteneur
#     démarre : tirer l'image depuis ECR, lire le secret, ouvrir le flux de
#     journaux. Le code applicatif n'en dispose jamais.
#   · rôle de TÂCHE — endossé par le code QUI TOURNE dans le conteneur.
#     C'est lui, et lui seul, qui porte le droit d'expédier via SES.
#
# Les confondre — le réflexe courant — donnerait au code applicatif le droit de
# lire tous les secrets du compte.
# ============================================================================

resource "aws_ecs_cluster" "principal" {
  count = var.activer_ecs ? 1 : 0

  name = "${local.prefixe}-cluster"

  # Métriques par tâche et par service, sans agent à installer. Facturé à
  # l'usage, quelques centimes par mois à cette échelle — et c'est la seule
  # façon de répondre à « pourquoi c'était lent mardi ? ».
  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.prefixe}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "principal" {
  count = var.activer_ecs ? 1 : 0

  cluster_name       = aws_ecs_cluster.principal[0].name
  capacity_providers = var.utiliser_fargate_spot ? ["FARGATE", "FARGATE_SPOT"] : ["FARGATE"]

  # `base = 1` sur FARGATE garanti : la PREMIÈRE tâche ne sera jamais du Spot.
  # AWS peut reprendre une capacité Spot avec deux minutes de préavis ; sans
  # cette base, une reprise simultanée sur toutes les tâches couperait le site.
  # Les tâches suivantes vont sur Spot, à 70 % du prix en moins.
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    base              = 1
    weight            = 1
  }

  dynamic "default_capacity_provider_strategy" {
    for_each = var.utiliser_fargate_spot ? [1] : []

    content {
      capacity_provider = "FARGATE_SPOT"
      base              = 0
      weight            = 4
    }
  }
}

# ------------------------------------------------------------------- journaux
resource "aws_cloudwatch_log_group" "application" {
  count = var.activer_ecs ? 1 : 0

  name = "/ecs/${local.prefixe}"

  # Sans rétention, CloudWatch conserve indéfiniment et facture indéfiniment.
  # 30 jours couvrent largement le délai entre une panne et son analyse.
  retention_in_days = 30

  tags = { Name = "${local.prefixe}-logs" }
}

# ----------------------------------------------------------- rôle d'exécution
data "aws_iam_policy_document" "confiance_ecs" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  count = var.activer_ecs ? 1 : 0

  name               = "${local.prefixe}-execution"
  description        = "Endosse par l'agent ECS : tirer l'image, lire le secret, ecrire les journaux"
  assume_role_policy = data.aws_iam_policy_document.confiance_ecs.json
}

resource "aws_iam_role_policy_attachment" "execution_base" {
  count = var.activer_ecs ? 1 : 0

  role       = aws_iam_role.execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# C'est l'agent, pas le code, qui lit le secret et l'injecte comme variable
# d'environnement dans le conteneur.
resource "aws_iam_role_policy_attachment" "execution_secret" {
  count = var.activer_ecs ? 1 : 0

  role       = aws_iam_role.execution[0].name
  policy_arn = aws_iam_policy.lire_secret.arn
}

# --------------------------------------------------------------- rôle de tâche
resource "aws_iam_role" "tache" {
  count = var.activer_ecs ? 1 : 0

  name               = "${local.prefixe}-tache"
  description        = "Endosse par le code applicatif qui tourne dans le conteneur"
  assume_role_policy = data.aws_iam_policy_document.confiance_ecs.json
}

# `enable_execute_command` ne suffit pas : sans ces quatre droits sur le rôle de
# TÂCHE, `aws ecs execute-command` échoue avec un message peu parlant (« execute
# command failed »). Ils ouvrent le canal chiffré de Session Manager — ce qui
# remplace avantageusement un accès SSH : rien n'écoute sur le réseau, tout
# passe par l'API AWS, et chaque session est tracée.
data "aws_iam_policy_document" "session_tache" {
  statement {
    sid    = "OuvrirUnCanalSessionManager"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    # Ces actions ne portent sur aucune ressource nommable : le canal n'existe
    # pas encore au moment où on demande à l'ouvrir.
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "session_tache" {
  count = var.activer_ecs ? 1 : 0

  name   = "${local.prefixe}-session"
  role   = aws_iam_role.tache[0].id
  policy = data.aws_iam_policy_document.session_tache.json
}

# Droit d'expédier via SES — sans la moindre clé d'accès. Le conteneur récupère
# des identifiants temporaires auprès du service de métadonnées ; ils sont
# renouvelés tout seuls et ne servent qu'à cette tâche.
resource "aws_iam_role_policy_attachment" "tache_ses" {
  count = var.activer_ecs && var.activer_ses ? 1 : 0

  role       = aws_iam_role.tache[0].name
  policy_arn = aws_iam_policy.expedier_ses[0].arn
}

# ------------------------------------------------------- définition de tâche
resource "aws_ecs_task_definition" "application" {
  count = var.activer_ecs ? 1 : 0

  family                   = local.prefixe
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu_tache
  memory                   = var.memoire_tache

  execution_role_arn = aws_iam_role.execution[0].arn
  task_role_arn      = aws_iam_role.tache[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    # X86_64 par défaut. ARM64 coûte ~20 % de moins et l'image est construite
    # pour les deux architectures (voir le Dockerfile) : passer à ARM64 ne
    # demande que de changer cette ligne.
    cpu_architecture = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "musea"
      image     = "${aws_ecr_repository.application.repository_url}:${var.etiquette_image}"
      essential = true

      portMappings = [
        {
          containerPort = 8080
          protocol      = "tcp"
        }
      ]

      # Injecté par l'AGENT depuis Secrets Manager, jamais écrit dans cette
      # définition. La syntaxe « arn:…:cle:: » extrait UNE clé du document JSON :
      # le conteneur ne voit pas le reste du secret.
      secrets = [
        {
          name      = "MUSEA_BASIC_AUTH"
          valueFrom = "${aws_secretsmanager_secret.application.arn}:basic_auth::"
        }
      ]

      environment = [
        { name = "MUSEA_ENVIRONNEMENT", value = var.environnement },
        { name = "AWS_REGION", value = var.region },
        { name = "MUSEA_SES_IDENTITE", value = var.activer_ses ? local.domaine_notifications : "" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.application[0].name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "musea"
        }
      }

      # Sonde interne au conteneur, distincte de celle du répartiteur : elle
      # détecte un nginx figé même quand le réseau, lui, répond.
      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/sante >/dev/null || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }

      readonlyRootFilesystem = false # nginx écrit ses fichiers temporaires
    }
  ])

  tags = { Name = "${local.prefixe}-tache" }
}

# ------------------------------------------------------------------- service
resource "aws_ecs_service" "application" {
  count = var.activer_ecs ? 1 : 0

  name            = local.prefixe
  cluster         = aws_ecs_cluster.principal[0].id
  task_definition = aws_ecs_task_definition.application[0].arn
  desired_count   = var.taches_minimum

  # Pas de `launch_type` ici : il est incompatible avec une stratégie de
  # fournisseur de capacité, et c'est elle qui donne accès au Spot.
  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    base              = 1
    weight            = 1
  }

  dynamic "capacity_provider_strategy" {
    for_each = var.utiliser_fargate_spot ? [1] : []

    content {
      capacity_provider = "FARGATE_SPOT"
      base              = 0
      weight            = 4
    }
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.taches.id]
    assign_public_ip = true # requis sans passerelle NAT : voir reseau.tf
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.application[0].arn
    container_name   = "musea"
    container_port   = 8080
  }

  # 100 % de tâches saines maintenues pendant un déploiement, et jusqu'au double
  # le temps de la bascule : aucune requête n'est perdue.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # LE mécanisme qui distingue un déploiement automatisé d'un déploiement
  # imprudent : si les nouvelles tâches ne deviennent pas saines, ECS annule et
  # remet la version précédente, tout seul. Sans lui, une image cassée laisse le
  # service en boucle de redémarrage jusqu'à ce qu'un humain s'en aperçoive.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Une tâche a 60 s pour devenir saine avant que le répartiteur ne la compte
  # en échec — le temps de tirer l'image au premier démarrage.
  health_check_grace_period_seconds = 60

  # Répartir les tâches entre zones AVANT de les répartir entre hôtes : c'est
  # la panne de zone qu'on cherche à survivre.
  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }

  enable_execute_command = true # `aws ecs execute-command` : un shell dans la tâche, sans SSH

  lifecycle {
    ignore_changes = [
      # La CI publie une nouvelle révision à chaque version. Sans cette ligne,
      # le `terraform apply` suivant ramènerait la production à l'étiquette
      # inscrite dans les variables — une régression silencieuse.
      task_definition,
      # Le nombre de tâches est piloté par la mise à l'échelle automatique.
      desired_count,
    ]
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = "${local.prefixe}-service" }
}

# ------------------------------------------------- mise à l'échelle automatique
resource "aws_appautoscaling_target" "service" {
  count = var.activer_ecs ? 1 : 0

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.principal[0].name}/${aws_ecs_service.application[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.taches_minimum
  max_capacity       = var.taches_maximum
}

# Suivi de cible plutôt que seuils manuels : on déclare l'objectif (60 % de CPU)
# et AWS calcule lui-même quand ajouter ou retirer une tâche.
resource "aws_appautoscaling_policy" "cpu" {
  count = var.activer_ecs ? 1 : 0

  name               = "${local.prefixe}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.service[0].service_namespace
  resource_id        = aws_appautoscaling_target.service[0].resource_id
  scalable_dimension = aws_appautoscaling_target.service[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value = 60

    # Monter vite, redescendre lentement : une descente trop prompte relance
    # une montée au coup de charge suivant, et l'on paie l'aller-retour.
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
