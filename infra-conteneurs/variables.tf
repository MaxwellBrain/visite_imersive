# ============================================================================
# Réglages de la pile conteneurs
# ----------------------------------------------------------------------------
# Les valeurs par défaut sont celles qui coûtent le moins et cassent le moins.
# Tout ce qui coûte cher (EKS) ou touche à une identité durable (utilisateur
# IAM pour SES) est désactivé par défaut et doit être demandé explicitement.
# ============================================================================

variable "region" {
  description = "Région AWS. Paris par défaut : même région que Supabase (eu-west-3), donc latence minimale entre le conteneur et la base."
  type        = string
  default     = "eu-west-3"
}

variable "environnement" {
  description = "Environnement déployé. Chaque environnement a sa pile complète et son propre état Terraform."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environnement)
    error_message = "Environnement attendu : staging ou production."
  }
}

# ------------------------------------------------------------------------ DNS

variable "zone_domaine" {
  description = <<-EOT
    Zone Route 53 EXISTANTE, la même que celle de `infra/`. Terraform ne la crée
    pas et n'y touche qu'à ses propres enregistrements.
  EOT
  type        = string
  default     = "nexacode.store"
}

variable "hosted_zone_id" {
  description = "Identifiant exact de la zone. Vide ⇒ recherche par nom (préférable : survit à une recréation de la zone)."
  type        = string
  default     = ""
}

variable "sous_domaine" {
  description = <<-EOT
    Nom d'hôte servi par les conteneurs, à l'intérieur de la zone.

    « conteneurs » ⇒ https://conteneurs.nexacode.store

    ⚠️ Ce nom devient un enregistrement EXACT, qui l'emporte sur le joker
    « *.nexacode.store » de `infra/` pour ce seul nom. Il ne doit donc jamais
    correspondre au slug d'une organisation locataire, sous peine de rendre son
    sous-domaine injoignable. « conteneurs », « k8s », « ecs » sont sûrs ;
    « bandjoun » ne l'est pas.
  EOT
  type        = string
  default     = "conteneurs"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.sous_domaine))
    error_message = "Sous-domaine : minuscules, chiffres et tirets uniquement, sans point."
  }
}

# --------------------------------------------------------------------- réseau

variable "cidr_vpc" {
  description = <<-EOT
    Plage d'adresses du VPC dédié à cette pile.

    10.42.0.0/16 est volontairement exotique : le VPC par défaut d'AWS occupe
    172.31.0.0/16 et la plupart des tutoriels 10.0.0.0/16. Un chevauchement
    interdirait tout appairage futur entre les deux.
  EOT
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrhost(var.cidr_vpc, 0))
    error_message = "CIDR invalide (attendu : 10.42.0.0/16)."
  }
}

# ------------------------------------------------------------------ conteneur

variable "nom_image" {
  description = "Nom du dépôt d'images, identique côté ECR et côté Docker Hub."
  type        = string
  default     = "musea"
}

variable "etiquette_image" {
  description = <<-EOT
    Étiquette déployée au prochain apply.

    Terraform ne fait que POSER une valeur initiale : ensuite, c'est la CI qui
    fait évoluer l'étiquette à chaque version, via une nouvelle révision de la
    définition de tâche. `ignore_changes` (voir ecs.tf) empêche Terraform de
    ramener la production à cette valeur au prochain apply.
  EOT
  type        = string
  default     = "latest"
}

variable "depot_dockerhub" {
  description = "Dépôt Docker Hub visé par la CI, au format « compte/image ». Vide ⇒ la CI ne pousse que vers ECR. Purement informatif côté Terraform."
  type        = string
  default     = ""
}

# ------------------------------------------------------------------------ ECS

variable "activer_ecs" {
  description = "Monte le service ECS Fargate et son répartiteur de charge. C'est la voie recommandée : pas de plan de contrôle à payer."
  type        = bool
  default     = true
}

variable "cpu_tache" {
  description = "Unités de CPU par tâche (1024 = 1 vCPU). 256 suffit largement à servir des fichiers statiques."
  type        = number
  default     = 256
}

variable "memoire_tache" {
  description = "Mémoire par tâche, en Mo. Fargate impose des couples valides : 256 CPU ⇒ 512, 1024 ou 2048 Mo."
  type        = number
  default     = 512
}

variable "taches_minimum" {
  description = "Nombre de tâches en régime normal. 2 = une par zone de disponibilité, donc survie à la panne d'une zone."
  type        = number
  default     = 2

  validation {
    condition     = var.taches_minimum >= 1
    error_message = "Au moins une tâche, sinon le service ne sert rien."
  }
}

variable "taches_maximum" {
  description = "Plafond de la mise à l'échelle automatique. Un plafond est un garde-fou de facture autant qu'un réglage de performance."
  type        = number
  default     = 6
}

variable "utiliser_fargate_spot" {
  description = <<-EOT
    Place les tâches excédentaires sur de la capacité Spot (~70 % moins chère,
    mais récupérable par AWS avec 2 minutes de préavis).

    La première tâche reste sur du Fargate garanti : le service ne peut donc
    jamais tomber à zéro à cause d'une reprise de capacité.
  EOT
  type        = bool
  default     = true
}

# ------------------------------------------------------------------------ EKS

variable "activer_eks" {
  description = <<-EOT
    Monte un cluster Kubernetes managé (EKS).

    Désactivé par défaut, et ce n'est pas de la timidité : le plan de contrôle
    EKS est facturé à l'heure, qu'il serve du trafic ou non — de l'ordre de
    70 $/mois avant même le premier nœud. Les manifestes de `kubernetes/`
    fonctionnent tels quels sur un cluster local (kind, Docker Desktop) : on
    peut donc démontrer Kubernetes en soutenance sans rien payer, et n'allumer
    EKS que le jour où il sert vraiment.
  EOT
  type        = bool
  default     = false
}

variable "version_kubernetes" {
  description = "Version du plan de contrôle EKS."
  type        = string
  default     = "1.31"
}

variable "type_instance_noeuds" {
  description = "Type d'instance des nœuds EKS. t3.small suffit pour deux répliques nginx."
  type        = string
  default     = "t3.small"
}

variable "noeuds_souhaites" {
  description = "Nombre de nœuds dans le groupe managé."
  type        = number
  default     = 2
}

# ------------------------------------------------------------------------ SES

variable "activer_ses" {
  description = "Crée l'identité SES, ses clés DKIM et son domaine d'expédition. Voir ses.tf pour la cohabitation avec SendGrid."
  type        = bool
  default     = true
}

variable "sous_domaine_notifications" {
  description = <<-EOT
    Sous-domaine dédié à SES, ex. « notif » ⇒ identité notif.nexacode.store.

    Pourquoi un sous-domaine plutôt que la racine : SendGrid authentifie déjà
    `nexacode.store` (enregistrements em2987, s1._domainkey, s2._domainkey) et
    la racine porte un SPF et un DMARC. Isoler SES sous son propre nom garantit
    qu'aucun de ces enregistrements n'est touché, et que les deux routes
    d'expédition peuvent coexister — voire basculer de l'une à l'autre sans
    coupure.
  EOT
  type        = string
  default     = "notif"
}

variable "creer_utilisateur_ses" {
  description = <<-EOT
    Crée un utilisateur IAM porteur d'une clé durable pour SES.

    Désactivé par défaut, à dessein : tout le reste de cette infrastructure
    fonctionne sans aucune clé permanente (OIDC pour la CI, rôle de tâche pour
    ECS). Une clé durable ne périme jamais et se copie sans trace.

    Le seul cas légitime : les Edge Functions Supabase tournent HORS d'AWS et
    ne peuvent donc pas assumer de rôle. Si l'on veut leur faire expédier via
    SES, il leur faut une clé. La clé secrète atterrit alors dans l'état
    Terraform — raison de plus pour ne l'activer qu'en connaissance de cause.
  EOT
  type        = bool
  default     = false
}

# -------------------------------------------------------------------- GitHub

variable "depot_github" {
  description = <<-EOT
    Dépôt autorisé à déployer, au format « proprietaire/depot ».

    C'est CETTE valeur qui verrouille le rôle IAM sur un seul dépôt. Vide ⇒
    aucun rôle de déploiement n'est créé (l'infrastructure se monte quand même,
    on déploie alors depuis son poste).
  EOT
  type        = string
  default     = ""
}

variable "creer_fournisseur_oidc_github" {
  description = <<-EOT
    Crée le fournisseur d'identité OIDC GitHub dans le compte AWS.

    Ce fournisseur est UNIQUE PAR COMPTE, jamais par projet. Deux cas :

      false (défaut) — le compte en possède déjà un ; cette pile le retrouve.
                       C'est le cas dès que `infra/` a été appliqué avec un
                       `github_repository` renseigné.
      true           — aucun fournisseur GitHub dans le compte ; il faut le créer.

    Le vérifier avant de choisir, la commande ne coûte rien :

      aws iam list-open-id-connect-providers

    Se tromper dans un sens lève EntityAlreadyExists ; dans l'autre, le plan
    échoue faute de trouver la ressource. Aucun des deux n'abîme quoi que ce soit.
  EOT
  type        = bool
  default     = false
}

variable "email_alertes" {
  description = <<-EOT
    Adresse prévenue quand une alarme se déclenche. Vide ⇒ les alarmes sont
    quand même créées et visibles dans la console, mais personne n'est averti.

    ⚠️ AWS envoie un message de confirmation à cette adresse ; tant qu'on n'a
    pas cliqué le lien, l'abonnement reste « PendingConfirmation » et aucune
    alerte n'arrive. Terraform ne peut pas confirmer à votre place.
  EOT
  type        = string
  default     = ""
}
