variable "zone_domain" {
  description = <<-EOT
    Domaine de la zone Route 53 **existante et déjà déléguée**, sans protocole
    ni point final. Terraform ne la crée pas : il s'y greffe et n'y touche
    qu'aux enregistrements du projet.

    ⚠️ La validation du certificat ACM se fait par DNS. Si le registrar de ce
    domaine ne pointe pas vers cette zone, elle restera en PENDING_VALIDATION
    indéfiniment — aucun délai d'attente n'y changera rien.
  EOT
  type        = string
  default     = "nexacode.store"

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.zone_domain))
    error_message = "Le domaine doit ressembler à « nexacode.store », sans https:// ni barre oblique."
  }
}

variable "subdomain" {
  description = <<-EOT
    Sous-domaine occupé par le site à l'intérieur de la zone.

    « musea » ⇒ le site vit sur musea.nexacode.store, et les organisations sur
    bandjoun.musea.nexacode.store. Chaîne vide ⇒ le site occupe la racine de la
    zone, ce qui déplacerait tout ce qui y répond déjà : à n'utiliser que sur
    une zone dédiée.
  EOT
  type        = string
  default     = "musea"
}

variable "hosted_zone_id" {
  description = <<-EOT
    Identifiant exact de la zone Route 53. Vide ⇒ recherche par nom.

    À renseigner si la recherche par nom échoue ou devient ambiguë (plusieurs
    zones homonymes dans le compte). La zone du compte portait au 2026-08-02
    l identifiant « Z04024483OZXQYBYW978O », mais celui-ci CHANGE a chaque
    recreation de la zone : preferer la recherche par nom, qui y survit.
  EOT
  type        = string
  default     = ""
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
