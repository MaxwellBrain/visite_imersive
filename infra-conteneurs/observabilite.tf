# ============================================================================
# Surveillance — savoir que ça casse avant que le jury ne le voie
# ----------------------------------------------------------------------------
# Trois alarmes seulement, et c'est un choix. Une console couverte d'alarmes
# qui clignotent en permanence n'est plus lue par personne. Chacune de celles-ci
# répond à une question qu'on se pose vraiment un jour de panne.
# ============================================================================

resource "aws_sns_topic" "alertes" {
  name = "${local.prefixe}-alertes"

  tags = { Name = "${local.prefixe}-alertes" }
}

resource "aws_sns_topic_subscription" "courriel" {
  count = var.email_alertes != "" ? 1 : 0

  topic_arn = aws_sns_topic.alertes.arn
  protocol  = "email"
  endpoint  = var.email_alertes
}

# ---------------------------------------------------------------- 1. le site répond-il ?
# Zéro cible saine = plus personne n'est servi. C'est l'alarme qui compte le
# plus, et la seule qu'il faut regarder en premier.
resource "aws_cloudwatch_metric_alarm" "aucune_cible_saine" {
  count = var.activer_ecs ? 1 : 0

  alarm_name        = "${local.prefixe}-aucune-cible-saine"
  alarm_description = "Plus aucune tache saine derriere le repartiteur : le site ne repond plus."

  namespace   = "AWS/ApplicationELB"
  metric_name = "HealthyHostCount"
  statistic   = "Minimum"

  dimensions = {
    LoadBalancer = aws_lb.principal[0].arn_suffix
    TargetGroup  = aws_lb_target_group.application[0].arn_suffix
  }

  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 2

  # `breaching` : une métrique ABSENTE déclenche l'alarme. C'est volontaire —
  # quand tout s'effondre, le répartiteur cesse d'émettre, et l'option par
  # défaut (« missing ») garderait l'alarme au vert pendant la panne.
  treat_missing_data = "breaching"

  alarm_actions = [aws_sns_topic.alertes.arn]
  ok_actions    = [aws_sns_topic.alertes.arn]
}

# ---------------------------------------------------------------- 2. le site répond-il mal ?
# Le répartiteur est debout, les tâches répondent, mais elles renvoient des
# erreurs. Panne applicative, pas panne d'infrastructure : le diagnostic
# change du tout au tout.
resource "aws_cloudwatch_metric_alarm" "erreurs_serveur" {
  count = var.activer_ecs ? 1 : 0

  alarm_name        = "${local.prefixe}-erreurs-5xx"
  alarm_description = "Les taches renvoient des erreurs 5xx : panne applicative, pas reseau."

  namespace   = "AWS/ApplicationELB"
  metric_name = "HTTPCode_Target_5XX_Count"
  statistic   = "Sum"

  dimensions = {
    LoadBalancer = aws_lb.principal[0].arn_suffix
    TargetGroup  = aws_lb_target_group.application[0].arn_suffix
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 10 # quelques erreurs isolées ne réveillent personne
  period              = 300
  evaluation_periods  = 1

  # Ici l'absence de donnée signifie « aucune erreur » : c'est bon signe.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.alertes.arn]
}

# ---------------------------------------------------------------- 3. le courrier part-il encore ?
# Au-delà de 5 % de rejets, AWS suspend le compte SES. L'alarme se déclenche à
# 3 % : de quoi arrêter une campagne mal ciblée avant la sanction, pas après.
resource "aws_cloudwatch_metric_alarm" "rejets_ses" {
  count = var.activer_ses ? 1 : 0

  alarm_name        = "${local.prefixe}-rejets-ses"
  alarm_description = "Taux de rejets SES eleve : au-dela de 5 pour cent, AWS suspend l'expedition."

  namespace   = "AWS/SES"
  metric_name = "Reputation.BounceRate"
  statistic   = "Average"

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0.03
  period              = 3600
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alertes.arn]
}

# ------------------------------------------------------------------- tableau de bord
# Une page unique à ouvrir en soutenance : trafic, latence, santé, expéditions.
resource "aws_cloudwatch_dashboard" "principal" {
  count = var.activer_ecs ? 1 : 0

  dashboard_name = local.prefixe

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "Requetes et erreurs"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.principal[0].arn_suffix, { stat = "Sum", label = "Requetes" }],
            [".", "HTTPCode_Target_5XX_Count", ".", ".", { stat = "Sum", label = "Erreurs 5xx" }],
            [".", "HTTPCode_Target_4XX_Count", ".", ".", { stat = "Sum", label = "Erreurs 4xx" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title  = "Temps de reponse (secondes)"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.principal[0].arn_suffix, { stat = "p50", label = "median" }],
            ["...", { stat = "p95", label = "p95" }],
            ["...", { stat = "p99", label = "p99" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title  = "Taches : charge et nombre"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.principal[0].name, "ServiceName", aws_ecs_service.application[0].name, { stat = "Average", label = "CPU %" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { stat = "Average", label = "Memoire %" }],
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.principal[0].name, "ServiceName", aws_ecs_service.application[0].name, { stat = "Average", label = "Taches actives" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6
        properties = {
          title  = "Courrier SES"
          region = var.region
          view   = "timeSeries"
          metrics = [
            ["AWS/SES", "Send", { stat = "Sum", label = "Expedies" }],
            [".", "Delivery", { stat = "Sum", label = "Delivres" }],
            [".", "Bounce", { stat = "Sum", label = "Rejetes" }],
            [".", "Complaint", { stat = "Sum", label = "Plaintes" }],
          ]
        }
      },
    ]
  })
}
