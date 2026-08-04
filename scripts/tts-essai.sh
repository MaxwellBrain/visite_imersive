#!/usr/bin/env bash
# ============================================================================
# ÉCOUTER AVANT DE CONSTRUIRE
# ----------------------------------------------------------------------------
# Génère le même texte avec les trois moteurs de Polly, puis une version
# travaillée en SSML. Rien à déployer : ce script utilise l'AWS CLI déjà
# configurée sur ce poste.
#
#   bash scripts/tts-essai.sh
#   bash scripts/tts-essai.sh "Votre propre texte."
#
# Les fichiers sortent dans essais-voix/, à écouter dans l'ordre des numéros.
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${POLLY_REGION:-eu-central-1}"   # Francfort : seule région à proposer le génératif en français
VOIX="${POLLY_VOICE:-Lea}"
SORTIE="essais-voix"
mkdir -p "$SORTIE"

TEXTE="${1:-Ce masque-casque royal est sculpté dans une seule pièce de bois, rehaussée de perles bleues et blanches et de cauris cousus. Il mesure quarante-cinq centimètres. Collecté à Bandjoun, il était porté lors des funérailles du chef.}"

# --------------------------------------------------------------------------
# La version SSML : c'est elle qui fait la différence.
#
#  · rate="92%"  — une notice de musée se lit plus lentement qu'une conversation
#  · <break>     — un humain respire ; c'est le signal le plus audible
#  · <phoneme>   — sans lui, « Bandjoun » est prononcé « ban-joun » et
#                  « mbap mteng » devient une bouillie. C'est LE point qui
#                  compte pour un patrimoine dont les noms sont vernaculaires.
# --------------------------------------------------------------------------
SSML='<speak><prosody rate="92%">Ce masque-casque royal est sculpté dans une seule pièce de bois,<break time="300ms"/> rehaussée de perles bleues et blanches et de cauris cousus.<break time="600ms"/> Il mesure quarante-cinq centimètres.<break time="600ms"/> Collecté à <phoneme alphabet="ipa" ph="bɑ̃dʒun">Bandjoun</phoneme>,<break time="250ms"/> il était porté lors des funérailles du chef.</prosody></speak>'

synthese() { # fichier moteur type contenu
  printf "  %-42s" "$1"
  if aws polly synthesize-speech \
      --region "$REGION" --voice-id "$VOIX" --output-format mp3 \
      --engine "$2" --text-type "$3" --text "$4" \
      "$SORTIE/$1" >/dev/null 2>&1; then
    echo "$(wc -c < "$SORTIE/$1" | tr -d ' ') octets"
  else
    echo "indisponible pour cette voix / région"
  fi
}

echo "Voix $VOIX · région $REGION"
echo
synthese "1-standard.mp3"          standard   text "$TEXTE"
synthese "2-neuronal.mp3"          neural     text "$TEXTE"
synthese "3-generatif.mp3"         generative text "$TEXTE"
synthese "4-generatif-travaille.mp3" generative ssml "$SSML"

echo
echo "Écoutez dans l'ordre : l'écart 1 → 3 est celui du moteur,"
echo "l'écart 3 → 4 est celui de la mise en voix (pauses, débit, prononciation)."
echo "Fichiers dans : $(pwd)/$SORTIE"

# Ouvre le dossier sous Windows, sans échouer ailleurs.
command -v explorer.exe >/dev/null 2>&1 && explorer.exe "$(cygpath -w "$SORTIE")" || true
