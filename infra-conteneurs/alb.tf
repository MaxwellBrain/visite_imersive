# ============================================================================
# Répartiteur de charge applicatif (ALB)
# ----------------------------------------------------------------------------
# C'est lui qui termine le TLS, redirige le port 80 vers le 443, et surtout qui
# retire du service une tâche qui ne répond plus. Sans lui, un conteneur en
# panne continue de recevoir du trafic.
#
# Il n'existe que si ECS est monté. Sous EKS, c'est Kubernetes qui commande la
# création d'un répartiteur, à partir du Service ou de l'Ingress.
# ============================================================================

resource "aws_lb" "principal" {
  count = var.activer_ecs ? 1 : 0

  name               = "${local.prefixe}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.repartiteur.id]
  subnets            = aws_subnet.public[*].id

  # Un en-tête HTTP malformé est le vecteur classique du « request smuggling » :
  # deux serveurs de la chaîne lisent la même requête différemment. On le jette
  # à l'entrée plutôt que de faire confiance à nginx pour le rattraper.
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "strictest"

  enable_http2 = true

  # Le temps pendant lequel une connexion inactive est conservée. 60 s : assez
  # pour un rechargement de page, assez court pour ne pas retenir de ressources.
  idle_timeout = 60

  # À passer à true le jour où ce domaine porte du trafic réel : cela empêche
  # un `terraform destroy` distrait d'emporter le répartiteur.
  enable_deletion_protection = false

  tags = { Name = "${local.prefixe}-alb" }
}

# ---------------------------------------------------------- groupe de cibles
resource "aws_lb_target_group" "application" {
  count = var.activer_ecs ? 1 : 0

  # `name_prefix` et non `name` : avec `create_before_destroy`, le remplacant
  # est cree AVANT que l'ancien ne disparaisse. Deux groupes de cibles ne
  # peuvent pas porter le meme nom — un nom fixe ferait echouer tout
  # remplacement (changement de port, de protocole, de VPC). Le prefixe est
  # limite a 6 caracteres par AWS, d'ou « musea- » et non le prefixe complet.
  name_prefix = "musea-"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.principal.id
  target_type = "ip" # Fargate n'a pas d'instance EC2 : la cible est l'IP de la tâche

  health_check {
    enabled = true

    # Route dédiée, servie par nginx sans authentification (voir docker/nginx.conf).
    # Sonder « / » paraît plus simple, mais échouerait dès qu'on active le
    # portail d'accès du staging : le répartiteur recevrait 401 et déclarerait
    # saines zéro tâche — le service tournerait, injoignable.
    path                = "/sante"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # nginx démarre en une seconde : inutile de laisser une tâche condamnée
  # retenir des connexions pendant les 300 s par défaut. Un déploiement gagne
  # ainsi près de cinq minutes.
  deregistration_delay = 15

  # Le répartiteur peut être remplacé sans coupure s'il n'est pas détruit avant
  # que le nouveau ne soit rattaché.
  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.prefixe}-tg" }
}

# ------------------------------------------------------------------ écouteurs
resource "aws_lb_listener" "http" {
  count = var.activer_ecs ? 1 : 0

  load_balancer_arn = aws_lb.principal[0].arn
  port              = 80
  protocol          = "HTTP"

  # Redirection permanente : aucune requête en clair n'atteint l'application.
  default_action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.activer_ecs ? 1 : 0

  load_balancer_arn = aws_lb.principal[0].arn
  port              = 443
  protocol          = "HTTPS"

  # Politique 2021 : TLS 1.2 minimum, chiffrements modernes. La politique par
  # défaut d'AWS accepte encore TLS 1.0 pour compatibilité historique.
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  # On attend la VALIDATION du certificat, pas sa simple création : un
  # certificat encore en PENDING_VALIDATION serait refusé par l'écouteur.
  certificate_arn = aws_acm_certificate_validation.conteneurs[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.application[0].arn
  }
}
