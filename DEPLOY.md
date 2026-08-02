# Déploiement de MUSÉA sur AWS

> Phase 8 du `MUSEA_MASTER_PLAN.md`.
> **Aucun identifiant AWS n'est demandé ni stocké dans ce dépôt.** Tout ce qui
> suit se fait avec vos propres accès, depuis votre poste.

---

## Ce qui va où

L'application est un **site statique**. Le partage est net, et les deux moitiés
ne se gênent pas :

| Moitié | Où | Quoi |
|---|---|---|
| **Front** | AWS — S3 + CloudFront | Les fichiers compilés par Vite |
| **Back** | Supabase (eu-west-3) | Postgres, Auth, RLS, Edge Functions |

Le navigateur du visiteur charge le front depuis CloudFront, puis parle
directement à Supabase en HTTPS. Rien à héberger entre les deux.

---

## Prérequis

- Un compte AWS et l'AWS CLI configurée (`aws sts get-caller-identity` doit répondre)
- Terraform ≥ 1.6
- Une zone Route 53 existante et déléguée (`nexacode.space`)
- Un dépôt Git (voir l'avertissement en fin de page)

---

## 0. Droits de l'utilisateur Terraform

`terraform plan` ne vérifie **que les droits de lecture**. Les permissions de
création ne sont éprouvées qu'au moment de l'`apply` : un plan qui passe ne
garantit donc rien.

Le plus simple pour un compte de travail : attacher ces quatre politiques gérées
par AWS à l'utilisateur qui exécute Terraform.

| Politique | Pour |
|---|---|
| `AmazonS3FullAccess` | bucket, chiffrement, versionnement, cycle de vie |
| `CloudFrontFullAccess` | distribution, OAC, politique d'en-têtes |
| `AWSCertificateManagerFullAccess` | certificat et sa validation |
| `AmazonRoute53FullAccess` | zone DNS et enregistrements |

Ajouter `IAMFullAccess` **uniquement** si vous renseignez `github_repository` —
c'est ce qui crée le fournisseur OIDC et le rôle de déploiement.

> Ces politiques sont larges. Pour un compte partagé ou de production, remplacez-les
> par une politique sur mesure limitée aux ressources du projet.

**Piège rencontré** : `cloudfront:ListCachePolicies`. Rechercher une politique de
cache par son nom oblige AWS à les lister toutes. Les identifiants des politiques
gérées étant des constantes globales, ils sont désormais écrits en dur dans
`cloudfront.tf` — cette permission n'est plus nécessaire.

---

## 1. Monter l'infrastructure

Le site s'installe sur un **sous-domaine d'une zone Route 53 existante** :

```
nexacode.space                     <- votre zone, deja deleguee, intacte
  musea.nexacode.space             <- le site
    bandjoun.musea.nexacode.space  <- une organisation (joker)
```

Terraform **ne cree pas la zone** et n'y touche qu'a ses propres enregistrements.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # verifier zone_domain et subdomain
terraform init
terraform plan      # LIRE la sortie avant d'appliquer
terraform apply
```

La zone etant deja deleguee, le certificat se valide en quelques minutes. La
distribution CloudFront demande ensuite 5 a 15 minutes pour se deployer.

> **Le piege rencontre en vrai** : un certificat demande pour un domaine dont on
> ne controle pas la delegation reste en `PENDING_VALIDATION` indefiniment. AWS
> interroge le DNS **public** ; si le registrar pointe ailleurs, l'enregistrement
> de validation pose dans la zone Route 53 n'est jamais lu. **Allonger le delai
> d'attente ne sert a rien** -- c'est la delegation qu'il faut corriger.
>
> Verification prealable, en une commande :
>
> ```bash
> nslookup -type=NS nexacode.space 8.8.8.8
> ```
>
> Vous devez y voir des serveurs `awsdns`.

---

## 2. Domaine du site

Le domaine effectif est calcule a partir de `zone_domain` et `subdomain`, et
ressort en sortie :

```bash
terraform output site_domain      # musea.nexacode.space
terraform output zone_utilisee    # la zone touchee, pour verification
```

Cette valeur doit etre reportee a DEUX endroits, sans quoi la resolution du
locataire par nom d'hote ne fonctionnera pas :

- variable GitHub `PLATFORM_DOMAIN`
- variable de compilation `VITE_PLATFORM_DOMAIN` (elle est inscrite dans le
  bundle par Vite, donc necessaire des la compilation)

---


## 3. Configurer Supabase — étape manuelle

**C'est l'oubli le plus fréquent, et le plus déroutant** : le site s'affiche
parfaitement, mais la connexion Google et les liens e-mail renvoient vers
`localhost`.

Supabase → **Authentication → URL Configuration** :

- **Site URL** : `https://musea.nexacode.space`
- **Redirect URLs** : ajouter `https://musea.nexacode.space/**` **et** `https://*.musea.nexacode.space/**`

Le second motif est indispensable : sans lui, un visiteur qui se connecte depuis
`bandjoun.musea.nexacode.space` est renvoyé sur le mauvais domaine.

---

## 4. Brancher le déploiement automatique

Dans GitHub → Settings → Secrets and variables → Actions.

**Secrets** (valeurs issues de `terraform output`) :

| Secret | Origine |
|---|---|
| `AWS_ROLE_ARN` | `terraform output role_deploiement_arn` |
| `S3_BUCKET` | `terraform output bucket_site` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output cloudfront_distribution_id` |
| `VITE_SUPABASE_URL` | fichier `.env` |
| `VITE_SUPABASE_ANON_KEY` | fichier `.env` |

**Variables** : `PLATFORM_DOMAIN` = `musea.nexacode.space`, `AWS_REGION` = `eu-west-3`

Un `push` sur `main` déclenche alors la compilation, la publication et la purge
du cache. Aucune clé AWS durable n'est stockée : GitHub prouve son identité par
un jeton OIDC valable quelques minutes.

---

## 5. Vérifier avant d'y croire

Le workflow contrôle lui-même trois choses après publication. À refaire à la main
en cas de doute :

```bash
# Le repli SPA — de lui dépendent les QR codes de réalité augmentée
curl -o /dev/null -w "%{http_code}\n" https://musea.nexacode.space/site/ar/demo   # attendu 200

# Le type MIME du modèle 3D — sinon la RA échoue en silence sur mobile
curl -sI https://musea.nexacode.space/modeles/tabouret.glb | grep -i content-type  # model/gltf-binary

# Un sous-domaine d'organisation
curl -o /dev/null -w "%{http_code}\n" https://bandjoun.musea.nexacode.space/       # attendu 200
```

---

## Vérifier la production sans rien déployer

```bash
docker build -t musea \
  --build-arg VITE_SUPABASE_URL="…" \
  --build-arg VITE_SUPABASE_ANON_KEY="…" .
docker run --rm -p 8080:8080 musea
```

`docker/nginx.conf` reproduit volontairement le comportement de CloudFront —
repli SPA, types MIME, durées de cache — pour que ce qui marche ici marche là-bas.

---

## Pièges connus

**Le certificat doit vivre en `us-east-1`.** Quelle que soit votre région.
CloudFront n'en accepte aucune autre. C'est déjà traité par le fournisseur
`aws.us_east_1` dans `versions.tf`.

**Un joker ne couvre qu'un seul niveau.** `*.musea.nexacode.space` ne couvre pas
`musea.nexacode.space` : le certificat déclare les deux, et ce n'est pas une redondance.

**Les variables sont figées à la compilation.** Vite inscrit
`VITE_SUPABASE_URL` dans le bundle. Changer de clé impose de **recompiler**, pas
de redéployer une variable d'environnement.

**Le projet Supabase gratuit se met en pause** après une semaine sans trafic —
deux de vos projets sont déjà dans cet état. Si vous déployez en avance et ne
touchez à rien jusqu'à la soutenance, **la base peut être endormie le jour J**
alors que le front ira très bien. Ouvrez le site une fois par semaine, ou passez
ce projet en offre payante le temps de la soutenance.

**Le service worker est têtu.** Si un ancien `sw.js` traîne dans un navigateur,
il sert une version périmée. D'où le `no-cache` sur `/sw.js` — et, en cas de
doute lors d'une démonstration, une fenêtre de navigation privée.

---

## Coût attendu

Pour un site de mémoire, S3 et CloudFront coûtent **quelques centimes par mois**
(le premier téraoctet sortant est gratuit la première année). Route 53 facture
**0,50 $ par zone et par mois**. ACM est gratuit. Le poste réel, c'est le
domaine.
