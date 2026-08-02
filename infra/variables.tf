variable "domain" {
  description = <<-EOT
    Domaine racine du projet, sans protocole ni point final.

    ⚠️ Il doit s'agir d'un domaine que vous POSSÉDEZ et dont vous pouvez changer
    les serveurs de noms chez le registrar. La validation du certificat ACM se
    fait par DNS : sur un domaine qui ne vous appartient pas, elle reste en
    PENDING_VALIDATION indéfiniment — aucun délai d'attente n'y changera rien.
  EOT
  type        = string
  default     = "nexacode.space"

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.domain))
    error_message = "Le domaine doit ressembler à « nexacode.space », sans https:// ni barre oblique."
  }
}

variable "environment" {
  description = "Environnement déployé. Chaque environnement a sa propre pile complète."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environnement attendu : staging ou production."
  }
}

variable "region" {
  description = "Région AWS du bucket. Paris par défaut : c'est aussi celle du projet Supabase (eu-west-3), donc la latence de bout en bout est minimale."
  type        = string
  default     = "eu-west-3"
}

variable "create_hosted_zone" {
  description = <<-EOT
    true  : Terraform crée la zone Route 53 ; il faudra alors déléguer le domaine
            chez le registrar en y recopiant les 4 serveurs de noms affichés en sortie.
    false : la zone existe déjà, Terraform la retrouve par son nom.
  EOT
  type        = bool
  default     = true
}

variable "github_repository" {
  description = <<-EOT
    Dépôt autorisé à déployer, au format « proprietaire/depot ».
    C'est LA valeur qui restreint le rôle IAM : sans elle correctement renseignée,
    n'importe quel dépôt GitHub pourrait assumer le rôle. Laisser vide désactive
    entièrement la création du rôle de déploiement.
  EOT
  type        = string
  default     = ""
}

variable "create_github_oidc_provider" {
  description = <<-EOT
    Le fournisseur d'identité GitHub est unique PAR COMPTE AWS.
    true  : compte neuf, Terraform le crée.
    false : le compte déploie déjà depuis GitHub — le recréer échouerait
            (EntityAlreadyExists), Terraform réutilise l'existant.
  EOT
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = <<-EOT
    Autorise `terraform destroy` à supprimer le bucket même s'il contient encore
    des fichiers.

    Pourquoi cela existe : dès que le site est publié, le bucket contient ~180
    objets, et le versionnement en garde toutes les versions. `terraform destroy`
    échoue alors sur « BucketNotEmpty », et il faut vider le bucket à la main
    avant de pouvoir recommencer.

    true  : pratique tant qu'on monte et démonte l'infrastructure.
    false : indispensable en production — c'est le garde-fou qui empêche
            d'effacer le site d'un `destroy` malheureux.
  EOT
  type        = bool
  default     = false
}

variable "price_class" {
  description = "Étendue géographique de CloudFront. PriceClass_100 = Europe + Amérique du Nord, le meilleur rapport coût/couverture pour une soutenance. PriceClass_All pour servir l'Afrique depuis des points de présence locaux."
  type        = string
  default     = "PriceClass_100"
}
