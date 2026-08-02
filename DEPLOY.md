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
- Le domaine `musea.space` acheté chez un registrar
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

## 1. Monter l'infrastructure — EN DEUX TEMPS

L'ordre compte. La validation du certificat ACM se fait par DNS : elle ne peut
aboutir que si le domaine est **déjà délégué** à la zone Route 53. Tout appliquer
d'un coup mène à 45 minutes d'attente puis à un échec.

### 1a. Créer la zone DNS, et rien d'autre

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # vérifier le domaine !
terraform init
terraform apply -target=aws_route53_zone.principale
terraform output serveurs_de_noms
```

### 1b. Déléguer chez le registrar — étape manuelle

Recopiez les quatre serveurs affichés chez votre registrar, **en remplacement**
des siens. C'est l'étape qui conditionne tout le reste.

Vérifiez que la délégation est effective avant de continuer :

```bash
nslookup -type=NS nexacode.space 8.8.8.8
```

Vous devez voir les serveurs `awsdns`. Comptez de quelques minutes à quelques
heures. Tant qu'ils n'apparaissent pas, ne lancez pas la suite.

### 1c. Monter le reste

```bash
terraform apply
```

Le certificat se valide alors en quelques minutes, et la distribution CloudFront
se déploie (comptez 5 à 15 minutes de plus).

> **Le piège rencontré en vrai** : un certificat demandé pour un domaine qu'on ne
> possède pas reste en `PENDING_VALIDATION` indéfiniment. AWS interroge le DNS
> public ; si le registrar pointe ailleurs, l'enregistrement de validation posé
> dans votre zone Route 53 n'est jamais lu. **Allonger le délai d'attente ne sert
> à rien** — c'est la délégation qu'il faut corriger, ou le domaine.

---

## 3. Configurer Supabase — étape manuelle

**C'est l'oubli le plus fréquent, et le plus déroutant** : le site s'affiche
parfaitement, mais la connexion Google et les liens e-mail renvoient vers
`localhost`.

Supabase → **Authentication → URL Configuration** :

- **Site URL** : `https://musea.space`
- **Redirect URLs** : ajouter `https://musea.space/**` **et** `https://*.musea.space/**`

Le second motif est indispensable : sans lui, un visiteur qui se connecte depuis
`bandjoun.musea.space` est renvoyé sur le mauvais domaine.

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

**Variables** : `PLATFORM_DOMAIN` = `musea.space`, `AWS_REGION` = `eu-west-3`

Un `push` sur `main` déclenche alors la compilation, la publication et la purge
du cache. Aucune clé AWS durable n'est stockée : GitHub prouve son identité par
un jeton OIDC valable quelques minutes.

---

## 5. Vérifier avant d'y croire

Le workflow contrôle lui-même trois choses après publication. À refaire à la main
en cas de doute :

```bash
# Le repli SPA — de lui dépendent les QR codes de réalité augmentée
curl -o /dev/null -w "%{http_code}\n" https://musea.space/site/ar/demo   # attendu 200

# Le type MIME du modèle 3D — sinon la RA échoue en silence sur mobile
curl -sI https://musea.space/modeles/tabouret.glb | grep -i content-type  # model/gltf-binary

# Un sous-domaine d'organisation
curl -o /dev/null -w "%{http_code}\n" https://bandjoun.musea.space/       # attendu 200
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

**Un joker ne couvre qu'un seul niveau.** `*.musea.space` ne couvre pas
`musea.space` : le certificat déclare les deux, et ce n'est pas une redondance.

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
