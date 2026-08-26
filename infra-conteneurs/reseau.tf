# ============================================================================
# Réseau dédié à la pile conteneurs
# ----------------------------------------------------------------------------
# Un VPC neuf, plutôt que le VPC par défaut du compte : celui-ci est partagé
# avec tout ce qui traîne dans la région, ses groupes de sécurité ont été
# modifiés par d'autres essais, et on ne peut pas raisonner sur ce qu'il
# contient. Un VPC dédié est lisible de bout en bout.
#
# CHOIX ASSUMÉ : PAS DE PASSERELLE NAT.
#
# L'architecture de manuel place les tâches dans des sous-réseaux privés
# derrière une passerelle NAT. C'est plus propre, et cela coûte environ 32 €
# par mois et par zone — soit davantage que tout le reste de cette pile réunie.
#
# Ici les tâches vivent dans des sous-réseaux publics avec une adresse IP
# publique (Fargate en a besoin pour tirer l'image depuis ECR et pousser ses
# journaux). Ce qui protège réellement les tâches, ce n'est pas l'absence
# d'adresse publique : c'est le groupe de sécurité, qui n'accepte de trafic
# entrant QUE depuis le répartiteur de charge. Une adresse publique sans port
# ouvert n'est joignable par personne.
#
# À revoir le jour où la pile hébergera autre chose qu'un frontal statique —
# une base de données, par exemple, n'a rien à faire dans un sous-réseau public.
# ============================================================================

resource "aws_vpc" "principal" {
  cidr_block = var.cidr_vpc

  # Indispensables à ECS et EKS : sans résolution DNS interne, les tâches ne
  # joignent ni ECR, ni CloudWatch, ni Supabase.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.prefixe}-vpc" }
}

resource "aws_internet_gateway" "principale" {
  vpc_id = aws_vpc.principal.id
  tags   = { Name = "${local.prefixe}-igw" }
}

# Un sous-réseau par zone de disponibilité. /20 = 4091 adresses utilisables,
# largement de quoi absorber une montée en charge sans redécouper le VPC.
resource "aws_subnet" "public" {
  count = length(local.zones)

  vpc_id                  = aws_vpc.principal.id
  cidr_block              = cidrsubnet(var.cidr_vpc, 4, count.index)
  availability_zone       = local.zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.prefixe}-public-${local.zones[count.index]}"

    # Étiquettes lues par Kubernetes lui-même : sans elles, le contrôleur de
    # répartiteur de charge ne sait pas dans quels sous-réseaux poser un
    # Service de type LoadBalancer, et échoue avec un message peu parlant.
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.principal.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principale.id
  }

  tags = { Name = "${local.prefixe}-rt-public" }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ============================================================================
# Groupes de sécurité — deux étages
# ----------------------------------------------------------------------------
# Étage 1 : le répartiteur de charge, seul exposé à Internet.
# Étage 2 : les tâches, qui n'acceptent QUE le répartiteur.
#
# La règle du second étage ne cite pas une plage d'adresses mais l'identifiant
# du groupe du premier. C'est ce qui rend la protection insensible aux
# changements d'adresse : quand le répartiteur change d'IP, rien à mettre à jour.
# ============================================================================

resource "aws_security_group" "repartiteur" {
  name        = "${local.prefixe}-alb"
  description = "Entree publique HTTP/HTTPS vers le repartiteur de charge"
  vpc_id      = aws_vpc.principal.id

  tags = { Name = "${local.prefixe}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "repartiteur_https" {
  security_group_id = aws_security_group.repartiteur.id
  description       = "HTTPS depuis Internet"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# Le port 80 n'existe que pour rediriger vers 443 (voir alb.tf). Le fermer
# obligerait les visiteurs à taper « https:// » à la main.
resource "aws_vpc_security_group_ingress_rule" "repartiteur_http" {
  security_group_id = aws_security_group.repartiteur.id
  description       = "HTTP depuis Internet, uniquement pour rediriger vers HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "repartiteur_sortie" {
  security_group_id = aws_security_group.repartiteur.id
  description       = "Vers les taches"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "taches" {
  name        = "${local.prefixe}-taches"
  description = "Taches applicatives : entree limitee au repartiteur"
  vpc_id      = aws_vpc.principal.id

  tags = { Name = "${local.prefixe}-taches" }
}

resource "aws_vpc_security_group_ingress_rule" "taches_depuis_repartiteur" {
  security_group_id = aws_security_group.taches.id
  description       = "Seul le repartiteur peut joindre le port applicatif"

  # La source est un GROUPE, pas une adresse : c'est le point important.
  referenced_security_group_id = aws_security_group.repartiteur.id

  from_port   = 8080
  to_port     = 8080
  ip_protocol = "tcp"
}

# La sortie reste ouverte : la tâche doit joindre ECR (image), CloudWatch
# (journaux), SES (courriel) et Supabase (données). Restreindre demanderait des
# points de terminaison VPC, facturés à l'heure — hors budget ici.
resource "aws_vpc_security_group_egress_rule" "taches_sortie" {
  security_group_id = aws_security_group.taches.id
  description       = "Sortie Internet : ECR, CloudWatch, SES, Supabase"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
