# ============================================================================
# WORKER GPU DE PHOTOGRAMMÉTRIE
# ----------------------------------------------------------------------------
# Instance ponctuelle (spot) qui réclame les campagnes prêtes, reconstruit, puis
# S'ÉTEINT SEULE quand la file est vide. C'est ce qui rend la dépense
# proportionnelle au travail : une campagne dure ~40 min, pas 24 h.
#
# ⚠️ DÉSACTIVÉ PAR DÉFAUT — `gpu_worker_enabled = false`.
# Une g4dn.xlanche coûte de l'argent dès la première seconde. Un `terraform
# apply` lancé pour changer un enregistrement DNS ne doit jamais démarrer un GPU
# au passage : il faut l'activer sciemment, campagne par campagne.
#
# CE QUE CE FICHIER NE FAIT PAS
# Il n'ouvre aucun port entrant. Le worker n'a rien à servir : il appelle
# Supabase en sortie et c'est tout. L'accès administrateur passe par SSM Session
# Manager — pas de clé SSH à gérer, pas de port 22 exposé à Internet.
# ============================================================================

variable "gpu_worker_enabled" {
  description = <<-EOT
    Démarre l'instance GPU de reconstruction.

    ⚠️ Ressource FACTURÉE dès son démarrage. Le worker s'éteint tout seul après
    `gpu_worker_idle_minutes` sans travail, mais l'instance reste DÉCLARÉE :
    la repasser à false, ou lancer `terraform destroy -target`, évite qu'un
    `apply` ultérieur ne la relance.
  EOT
  type        = bool
  default     = false
}

variable "gpu_worker_instance_type" {
  description = <<-EOT
    Type d'instance. g4dn.xlarge (1 × T4, 16 Go) traite confortablement 50 à 80
    photos. En dessous — g4dn.large n'existe pas, et une instance sans GPU fera
    échouer Meshroom, pas seulement le ralentir.
  EOT
  type        = string
  default     = "g4dn.xlarge"

  validation {
    condition     = can(regex("^(g4dn|g5|p3|p4d)\\.", var.gpu_worker_instance_type))
    error_message = "Le type doit appartenir à une famille GPU (g4dn, g5, p3, p4d) : Meshroom exige CUDA."
  }
}

variable "gpu_worker_idle_minutes" {
  description = "Minutes sans campagne avant extinction automatique. 0 = ne jamais s'éteindre (déconseillé)."
  type        = number
  default     = 20
}

variable "gpu_worker_meshroom_image" {
  description = <<-EOT
    Image Docker de reconstruction. Meshroom (AliceVision) fait le SfM ET le MVS
    et sort un maillage TEXTURÉ — là où COLMAP seul rend des couleurs par sommet,
    visuellement pauvres sur un masque sculpté dont le décor peint porte
    l'essentiel de l'information.
  EOT
  type        = string
  default     = "alicevision/meshroom:2023.3.0"
}

variable "supabase_url" {
  description = "URL du projet Supabase, ex. https://dvwwwlqrwwzfwxukyoxz.supabase.co"
  type        = string
  default     = ""
}

variable "supabase_service_key" {
  description = <<-EOT
    Clé de SERVICE Supabase — jamais la clé publique.

    Elle contourne toute la RLS : à ne poser que dans un terraform.tfvars
    non versionné, ou via la variable d'environnement TF_VAR_supabase_service_key.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

# ---------------------------------------------------------------------------
# AMI « Deep Learning Base OSS » : pilotes NVIDIA, Docker et
# nvidia-container-toolkit déjà en place. Les installer soi-même sur une Ubuntu
# nue prend vingt minutes et casse à chaque changement de noyau — inacceptable
# sur une instance spot qui peut être reprise à tout moment.
# ---------------------------------------------------------------------------
data "aws_ami" "deep_learning" {
  count       = var.gpu_worker_enabled ? 1 : 0
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_vpc" "default" {
  count   = var.gpu_worker_enabled ? 1 : 0
  default = true
}

resource "aws_security_group" "gpu_worker" {
  count       = var.gpu_worker_enabled ? 1 : 0
  name        = "musea-gpu-worker"
  description = "Worker photogrammetrie : sortie seule, aucun port entrant"
  vpc_id      = data.aws_vpc.default[0].id

  # Aucun bloc `ingress` : c'est délibéré. Le worker n'expose aucun service.
  egress {
    # AWS n'accepte pas les caracteres accentues dans ce champ (contrainte API).
    description = "Supabase, Docker Hub, depots de paquets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "musea-gpu-worker" }
}

# ---------------------------------------------------------------------------
# Rôle IAM : le worker ne touche AUCUN service AWS pour son métier — ses données
# vivent dans Supabase. Les seules permissions accordées servent à
# l'administration (SSM) et aux journaux. Rien de plus.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "gpu_worker" {
  count = var.gpu_worker_enabled ? 1 : 0
  name  = "musea-gpu-worker"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "gpu_worker_ssm" {
  count      = var.gpu_worker_enabled ? 1 : 0
  role       = aws_iam_role.gpu_worker[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "gpu_worker" {
  count = var.gpu_worker_enabled ? 1 : 0
  name  = "musea-gpu-worker"
  role  = aws_iam_role.gpu_worker[0].name
}

resource "aws_instance" "gpu_worker" {
  count                  = var.gpu_worker_enabled ? 1 : 0
  ami                    = data.aws_ami.deep_learning[0].id
  instance_type          = var.gpu_worker_instance_type
  vpc_security_group_ids = [aws_security_group.gpu_worker[0].id]
  iam_instance_profile   = aws_iam_instance_profile.gpu_worker[0].name

  # L'image Meshroom pèse ~8 Go, et une campagne dense produit plusieurs Go de
  # fichiers intermédiaires. 120 Go laissent de la marge sans excès.
  root_block_device {
    volume_size = 120
    volume_type = "gp3"
    encrypted   = true
  }

  instance_market_options {
    market_type = "spot"
    spot_options {
      # `terminate` et non `stop` : une instance arrêtée conserve son volume EBS,
      # facturé indéfiniment pour un travail déjà fini.
      instance_interruption_behavior = "terminate"
    }
  }

  # `shutdown -h` déclenché par le worker doit RÉELLEMENT détruire l'instance,
  # sinon l'extinction automatique ne ferait qu'arrêter la facturation calcul en
  # laissant courir celle du disque.
  instance_initiated_shutdown_behavior = "terminate"

  # Le worker est INJECTÉ dans le user-data plutôt que téléchargé au démarrage :
  # l'instance n'a ainsi besoin ni d'un dépôt Git accessible, ni d'un bucket, ni
  # d'identifiants supplémentaires pour se procurer son propre code.
  user_data = templatefile("${path.module}/photogrammetry-worker/bootstrap.sh", {
    supabase_url         = var.supabase_url
    supabase_service_key = var.supabase_service_key
    idle_minutes         = var.gpu_worker_idle_minutes
    meshroom_image       = var.gpu_worker_meshroom_image
    worker_py            = file("${path.module}/photogrammetry-worker/worker.py")
  })

  user_data_replace_on_change = true

  tags = { Name = "musea-gpu-worker" }

  lifecycle {
    precondition {
      condition     = var.supabase_url != "" && var.supabase_service_key != ""
      error_message = "supabase_url et supabase_service_key sont obligatoires pour démarrer le worker."
    }
  }
}

output "gpu_worker_id" {
  description = "Identifiant de l'instance GPU, vide si le worker est désactivé."
  value       = var.gpu_worker_enabled ? aws_instance.gpu_worker[0].id : ""
}

output "gpu_worker_connexion" {
  description = "Commande d'accès administrateur (SSM, sans clé SSH)."
  value       = var.gpu_worker_enabled ? "aws ssm start-session --target ${aws_instance.gpu_worker[0].id} --region ${var.region}" : ""
}
