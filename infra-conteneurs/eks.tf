# ============================================================================
# EKS — Kubernetes managé (facultatif, éteint par défaut)
# ----------------------------------------------------------------------------
# Tout ce fichier est conditionné par `activer_eks`. À false, aucune ressource
# n'est créée et la pile reste sur ECS.
#
# POURQUOI ÉTEINT PAR DÉFAUT — et pourquoi le code existe quand même
#
# Le plan de contrôle EKS est facturé à l'heure, indépendamment du trafic :
# environ 70 $/mois avant le premier nœud, auxquels s'ajoutent les nœuds et le
# répartiteur. Pour servir un site statique, c'est disproportionné.
#
# Mais les manifestes de `kubernetes/` sont écrits pour tourner À L'IDENTIQUE
# sur un cluster local (kind, ou le Kubernetes intégré à Docker Desktop). On
# peut donc démontrer déploiement, montée en charge et mise à jour progressive
# sans dépenser un centime, et n'allumer EKS que le jour où le trafic ou le
# client le justifient. `terraform apply -var activer_eks=true` suffit alors :
# les mêmes YAML s'appliquent sur le cluster managé.
#
# NOTE D'ARCHITECTURE
# EKS et ECS partagent ici le même VPC et les mêmes sous-réseaux. Ils ne se
# gênent pas : les groupes de sécurité sont distincts, et les deux voies
# peuvent tourner en parallèle le temps d'une migration.
# ============================================================================

# ------------------------------------------------------- rôle du plan de contrôle
data "aws_iam_policy_document" "confiance_eks" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_cluster" {
  count = var.activer_eks ? 1 : 0

  name               = "${local.prefixe}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.confiance_eks.json
}

resource "aws_iam_role_policy_attachment" "eks_cluster" {
  count = var.activer_eks ? 1 : 0

  role       = aws_iam_role.eks_cluster[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# --------------------------------------------------------------------- cluster
resource "aws_eks_cluster" "principal" {
  count = var.activer_eks ? 1 : 0

  name     = "${local.prefixe}-k8s"
  version  = var.version_kubernetes
  role_arn = aws_iam_role.eks_cluster[0].arn

  vpc_config {
    subnet_ids              = aws_subnet.public[*].id
    endpoint_public_access  = true # sinon il faudrait un bastion pour kubectl
    endpoint_private_access = true # les nœuds joignent l'API sans sortir sur Internet
  }

  access_config {
    # « API » plutôt que la ConfigMap aws-auth historique : les droits
    # s'accordent en Terraform, auditables, et une erreur ne verrouille plus
    # le cluster hors d'atteinte — panne classique de l'ancienne méthode.
    authentication_mode = "API"

    # Celui qui applique Terraform devient administrateur du cluster. Sans
    # cela, le cluster naîtrait sans aucun administrateur : personne, pas même
    # le compte racine, ne pourrait y lancer un kubectl.
    bootstrap_cluster_creator_admin_permissions = true
  }

  # Journaux du plan de contrôle. `authenticator` et `audit` sont les deux qui
  # servent réellement quand un accès est refusé sans explication.
  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  tags = { Name = "${local.prefixe}-k8s" }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster]
}

resource "aws_cloudwatch_log_group" "eks" {
  count = var.activer_eks ? 1 : 0

  # Le nom est imposé par EKS. Le déclarer permet de fixer une rétention :
  # créé automatiquement, ce groupe conserverait — et facturerait — sans fin.
  name              = "/aws/eks/${local.prefixe}-k8s/cluster"
  retention_in_days = 14
}

# ------------------------------------------------------------- nœuds de calcul
data "aws_iam_policy_document" "confiance_noeuds" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_noeuds" {
  count = var.activer_eks ? 1 : 0

  name               = "${local.prefixe}-eks-noeuds"
  assume_role_policy = data.aws_iam_policy_document.confiance_noeuds.json
}

resource "aws_iam_role_policy_attachment" "eks_noeuds" {
  for_each = var.activer_eks ? toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    # Sans ce dernier, les nœuds ne peuvent pas tirer l'image depuis ECR et
    # les pods restent en ErrImagePull — sans que rien n'indique la cause.
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ]) : toset([])

  role       = aws_iam_role.eks_noeuds[0].name
  policy_arn = each.value
}

resource "aws_eks_node_group" "principal" {
  count = var.activer_eks ? 1 : 0

  cluster_name    = aws_eks_cluster.principal[0].name
  node_group_name = "${local.prefixe}-noeuds"
  node_role_arn   = aws_iam_role.eks_noeuds[0].arn
  subnet_ids      = aws_subnet.public[*].id

  instance_types = [var.type_instance_noeuds]

  # SPOT : mêmes économies que côté Fargate. Kubernetes replace un pod évincé
  # sur un autre nœud tout seul — c'est précisément ce pour quoi il est fait.
  capacity_type = "SPOT"

  scaling_config {
    desired_size = var.noeuds_souhaites
    min_size     = 1
    max_size     = var.noeuds_souhaites + 2
  }

  # Un seul nœud indisponible à la fois pendant une mise à jour : le service
  # reste debout pendant que la version de Kubernetes évolue.
  update_config {
    max_unavailable = 1
  }

  tags = { Name = "${local.prefixe}-noeuds" }

  lifecycle {
    # L'autoscaler ajuste `desired_size` ; Terraform ne doit pas le ramener.
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [aws_iam_role_policy_attachment.eks_noeuds]
}

# ------------------------------------------------------------------ extensions
# Ces trois-là sont le socle : sans CNI pas de réseau, sans CoreDNS pas de
# résolution de nom entre services, sans kube-proxy pas de Service. Les
# déclarer en extensions managées, c'est laisser AWS les tenir à jour.
resource "aws_eks_addon" "socle" {
  for_each = var.activer_eks ? toset(["vpc-cni", "coredns", "kube-proxy"]) : toset([])

  cluster_name = aws_eks_cluster.principal[0].name
  addon_name   = each.value

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"

  # CoreDNS a besoin d'un nœud pour se poser : sans cette dépendance, la
  # création part avant le groupe de nœuds et reste en « Degraded ».
  depends_on = [aws_eks_node_group.principal]
}

# ============================================================================
# IRSA — donner des droits AWS à un pod, sans clé
# ----------------------------------------------------------------------------
# L'équivalent Kubernetes du rôle de tâche ECS. Le pod présente le jeton de son
# ServiceAccount, AWS le vérifie contre le fournisseur OIDC du cluster et rend
# des identifiants temporaires.
#
# La condition « :sub » verrouille le rôle sur UN ServiceAccount d'UN espace de
# noms : un pod déployé ailleurs dans le cluster ne peut pas l'endosser.
# ============================================================================

data "tls_certificate" "eks_oidc" {
  count = var.activer_eks ? 1 : 0
  url   = aws_eks_cluster.principal[0].identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  count = var.activer_eks ? 1 : 0

  url             = aws_eks_cluster.principal[0].identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc[0].certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "confiance_irsa" {
  count = var.activer_eks ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.principal[0].identity[0].oidc[0].issuer, "https://", "")}:sub"
      values   = ["system:serviceaccount:musea:musea"]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.principal[0].identity[0].oidc[0].issuer, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "irsa_application" {
  count = var.activer_eks ? 1 : 0

  name               = "${local.prefixe}-irsa"
  description        = "Endosse par le pod musea via son ServiceAccount"
  assume_role_policy = data.aws_iam_policy_document.confiance_irsa[0].json
}

resource "aws_iam_role_policy_attachment" "irsa_ses" {
  count = var.activer_eks && var.activer_ses ? 1 : 0

  role       = aws_iam_role.irsa_application[0].name
  policy_arn = aws_iam_policy.expedier_ses[0].arn
}

# ------------------------------------------- accès de la CI au cluster
# Appartenir au compte AWS ne donne AUCUN droit dans Kubernetes : les deux
# systèmes d'autorisation sont séparés. Cette entrée d'accès fait le pont pour
# le rôle de déploiement, et lui seul.
resource "aws_eks_access_entry" "deploiement" {
  count = var.activer_eks && local.deploiement_actif ? 1 : 0

  cluster_name  = aws_eks_cluster.principal[0].name
  principal_arn = aws_iam_role.deploiement[0].arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "deploiement" {
  count = var.activer_eks && local.deploiement_actif ? 1 : 0

  cluster_name = aws_eks_cluster.principal[0].name
  # « Edit » et non « Admin » : de quoi faire évoluer un déploiement, pas de
  # quoi refaire les droits du cluster.
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"
  principal_arn = aws_iam_role.deploiement[0].arn

  access_scope {
    type       = "namespace"
    namespaces = ["musea"]
  }

  depends_on = [aws_eks_access_entry.deploiement]
}
