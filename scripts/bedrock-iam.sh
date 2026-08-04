#!/usr/bin/env bash
# ============================================================================
# Identifiants Bedrock pour les Edge Functions
# ----------------------------------------------------------------------------
# Crée un utilisateur IAM dédié, dont le SEUL droit est d'invoquer les modèles
# Anthropic en Europe. Sa clé est écrite directement dans
# supabase/.secrets.env — elle n'est jamais affichée à l'écran, donc jamais
# capturée dans un historique de terminal ou une conversation.
#
#   bash scripts/bedrock-iam.sh
#
# ⚠️ À lancer avec un profil AWS ADMINISTRATEUR : terraform_user n'a pas les
#    droits IAM. Ex. :  AWS_PROFILE=admin bash scripts/bedrock-iam.sh
#
# Pourquoi un utilisateur séparé plutôt que réutiliser terraform_user :
# une clé qui vit dans une Edge Function est exposée à toute faille de cette
# fonction. Elle ne doit pouvoir faire qu'une chose, et rien d'autre.
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

UTILISATEUR="${BEDROCK_IAM_USER:-musea-bedrock}"
REGION="${BEDROCK_REGION:-eu-west-3}"
FICHIER="supabase/.secrets.env"

COMPTE=$(aws sts get-caller-identity --query Account --output text)
echo "Compte AWS : $COMPTE · région : $REGION"

# --- Politique : invoquer, et uniquement invoquer -------------------------
# Les ressources couvrent le modèle sous-jacent ET le profil d'inférence :
# un appel via profil touche les deux, et n'autoriser que l'un donne un
# AccessDenied difficile à diagnostiquer.
POLITIQUE=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvoquerClaudeEnEurope",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
        "arn:aws:bedrock:*:${COMPTE}:inference-profile/eu.anthropic.claude-*"
      ]
    }
  ]
}
EOF
)

if aws iam get-user --user-name "$UTILISATEUR" >/dev/null 2>&1; then
  echo "Utilisateur $UTILISATEUR : déjà présent"
else
  aws iam create-user --user-name "$UTILISATEUR" \
    --tags Key=Project,Value=musea Key=ManagedBy,Value=script >/dev/null
  echo "Utilisateur $UTILISATEUR : créé"
fi

aws iam put-user-policy --user-name "$UTILISATEUR" \
  --policy-name musea-bedrock-invoke \
  --policy-document "$POLITIQUE"
echo "Politique attachée : invocation des modèles Claude uniquement"

# --- Clé d'accès -----------------------------------------------------------
# Deux clés maximum par utilisateur : on retire les anciennes, sinon la
# création échoue au deuxième passage.
for K in $(aws iam list-access-keys --user-name "$UTILISATEUR" \
           --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name "$UTILISATEUR" --access-key-id "$K"
  echo "Ancienne clé révoquée : ${K:0:8}…"
done

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
aws iam create-access-key --user-name "$UTILISATEUR" --output json > "$TMP"

# On écrit sans jamais afficher : la valeur passe du JSON au fichier.
ID=$(node -e "console.log(require('$TMP').AccessKey.AccessKeyId)")
SECRET=$(node -e "console.log(require('$TMP').AccessKey.SecretAccessKey)")

touch "$FICHIER"
# Remplace les lignes existantes plutôt que d'empiler des doublons.
grep -v -E '^BEDROCK_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION)=' "$FICHIER" > "$TMP.env" || true
{
  cat "$TMP.env"
  echo "BEDROCK_ACCESS_KEY_ID=$ID"
  echo "BEDROCK_SECRET_ACCESS_KEY=$SECRET"
  echo "BEDROCK_REGION=$REGION"
} > "$FICHIER"
rm -f "$TMP.env"

echo
echo "Clé écrite dans $FICHIER (identifiant ${ID:0:8}…, secret non affiché)."
echo
echo "Étape suivante — poussez les secrets vers Supabase :"
echo "   supabase secrets set --env-file $FICHIER --project-ref dvwwwlqrwwzfwxukyoxz"
echo
echo "Puis SUPPRIMEZ le fichier : les secrets vivent alors chez Supabase."
