#!/usr/bin/env bash
# ============================================================================
# Déploiement manuel vers AWS — équivalent de .github/workflows/deploy.yml
# ----------------------------------------------------------------------------
# À utiliser quand GitHub Actions n'est pas disponible. Fait exactement la même
# chose que le workflow, depuis votre poste, avec vos propres accès AWS.
#
#   bash scripts/deploy.sh
#
# Prérequis : AWS CLI configurée (`aws sts get-caller-identity` doit répondre)
# et l'infrastructure montée (`cd infra && terraform apply`).
#
# Les trois valeurs ci-dessous se lisent avec :  cd infra && terraform output
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET="${S3_BUCKET:-}"
DISTRIBUTION="${CLOUDFRONT_DISTRIBUTION_ID:-}"
# Domaine RÉELLEMENT servi. « musea.space » a longtemps figuré ici, alors que le
# site vit sur musea.nexacode.store : la vérification finale annonçait donc un
# 404 à chaque déploiement, pourtant réussi. Une alerte qui se déclenche toujours
# est pire qu'aucune alerte — elle apprend à ne plus la lire.
DOMAINE="${PLATFORM_DOMAIN:-musea.nexacode.store}"

# Si les variables ne sont pas fournies, on les demande à Terraform.
if [ -z "$BUCKET" ] && [ -d infra/.terraform ]; then
  BUCKET=$(terraform -chdir=infra output -raw bucket_site 2>/dev/null || true)
  DISTRIBUTION=$(terraform -chdir=infra output -raw cloudfront_distribution_id 2>/dev/null || true)
fi

if [ -z "$BUCKET" ] || [ -z "$DISTRIBUTION" ]; then
  cat >&2 <<'EOF'
Impossible de déterminer la cible du déploiement.

Renseignez-les à la main :
  export S3_BUCKET=musea-production-xxxxxxxx
  export CLOUDFRONT_DISTRIBUTION_ID=E1XXXXXXXXXXXX
  bash scripts/deploy.sh

ou lancez d'abord `cd infra && terraform apply`.
EOF
  exit 1
fi

echo "Cible : s3://$BUCKET  ·  distribution $DISTRIBUTION"
echo

# ---------------------------------------------------------------- compilation
echo "── Compilation ──"
npm run build

# Contrôles identiques à ceux de la CI : mieux vaut échouer ici qu'en ligne.
[ -f dist/index.html ] || { echo "dist/index.html absent" >&2; exit 1; }
[ -f dist/modeles/tabouret.glb ] || {
  echo "Modèles de démonstration absents — lancez : node scripts/build-demo-models.mjs" >&2
  exit 1
}
head -c 4 dist/modeles/tabouret.glb | grep -q 'glTF' || {
  echo "tabouret.glb n'est pas un glTF valide" >&2; exit 1
}
grep -rq 'supabase.co' dist/assets/*.js || {
  echo "Aucune adresse Supabase dans le bundle : votre .env est-il rempli ?" >&2; exit 1
}
echo "Contrôles du bundle : OK"
echo

# ---------------------------------------------------------------- publication
# Quatre passes, parce que chaque famille de fichiers a sa durée de cache et,
# surtout, son type MIME. Une seule commande produirait un site à moitié cassé.

echo "── 1/4 · fichiers immuables (noms hachés) ──"
aws s3 sync dist/ "s3://$BUCKET/" \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" \
  --exclude "sw.js" \
  --exclude "manifest.webmanifest" \
  --exclude "*.glb" \
  --exclude "*.usdz"

echo "── 2/4 · modèles 3D avec le bon type MIME ──"
# S3 étiquette par défaut binary/octet-stream. Le navigateur s'en accommode,
# mais Scene Viewer (Android) et Quick Look (iOS) refusent le fichier :
# la 3D s'affiche et la réalité augmentée échoue sans le moindre message.
aws s3 sync dist/ "s3://$BUCKET/" \
  --exclude "*" --include "*.glb" \
  --content-type "model/gltf-binary" \
  --cache-control "public,max-age=604800"

aws s3 sync dist/ "s3://$BUCKET/" \
  --exclude "*" --include "*.usdz" \
  --content-type "model/vnd.usdz+zip" \
  --cache-control "public,max-age=604800"

echo "── 3/4 · fichiers jamais mis en cache ──"
# sw.js décide de ce que voient les visiteurs déjà venus : mis en cache, il fige
# le site sur la version précédente, parfois pendant des jours.
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

aws s3 cp dist/sw.js "s3://$BUCKET/sw.js" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "application/javascript; charset=utf-8"

aws s3 cp dist/manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" \
  --cache-control "public,max-age=3600" \
  --content-type "application/manifest+json"

echo "── 4/4 · purge du cache CloudFront ──"
# MSYS_NO_PATHCONV : sous Git Bash, « /index.html » est pris pour un chemin
# absolu et réécrit en « C:/Program Files/Git/index.html ». CloudFront rejette
# alors la requête avec « invalid invalidation paths ».
ID=$(MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION" \
  --paths "/index.html" "/sw.js" "/manifest.webmanifest" \
  --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION" --id "$ID"
echo "Cache purgé."
echo

# ------------------------------------------------------------- vérification
# On contrôle ce que le visiteur reçoit vraiment, pas ce qu'on croit avoir mis.
echo "── Vérification du site en ligne ──"
BASE="https://$DOMAINE"

# `-o /dev/null` echoue sous Git Bash (curl 23, « error on write ») : le repli
# s'ajoutait alors au vrai code et affichait « 200000 » a chaque deploiement.
# On ecrit dans un fichier temporaire, qui marche sur les deux systemes.
JETABLE=$(mktemp)
CODE=$(curl -fsS -o "$JETABLE" -w "%{http_code}" "$BASE/" || echo 000)
echo "  accueil                 : $CODE"

# LE contrôle qui compte : les QR codes de réalité augmentée pointent vers
# /site/ar/<id>. Sans repli SPA, ils mènent à une page blanche.
CODE=$(curl -fsS -o "$JETABLE" -w "%{http_code}" "$BASE/site/ar/demo" || echo 000)
echo "  lien profond (repli SPA): $CODE"
[ "$CODE" = "200" ] || echo "     ⚠ le repli SPA ne fonctionne pas — les QR de RA seront cassés"

TYPE=$(curl -fsSI "$BASE/modeles/tabouret.glb" 2>/dev/null | tr -d '\r' \
       | awk -F': ' 'tolower($1)=="content-type"{print $2}')
echo "  type du modèle 3D       : ${TYPE:-inconnu}"
[ "$TYPE" = "model/gltf-binary" ] || echo "     ⚠ type MIME incorrect — la RA échouera sur Android et iOS"

echo
rm -f "$JETABLE"
echo "Déployé sur $BASE"
