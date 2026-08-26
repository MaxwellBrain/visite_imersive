#!/usr/bin/env bash
# Compile le rapport en trois passes (sommaire, table des matières, renvois).
set -e
cd "$(dirname "$0")"

MIKTEX="/c/Users/maxib/AppData/Local/Programs/MiKTeX/miktex/bin/x64"
[ -d "$MIKTEX" ] && export PATH="$PATH:$MIKTEX"

command -v pdflatex >/dev/null || {
  echo "pdflatex introuvable. Ajoutez MiKTeX au PATH :"
  echo "  $MIKTEX"
  exit 1
}

for i in 1 2 3; do
  echo "── passe $i/3 ──"
  pdflatex -interaction=nonstopmode rapport.tex > "compil-$i.log" 2>&1 || true
done

if grep -qE '^!' compil-3.log; then
  echo
  echo "ERREURS LaTeX :"
  grep -E '^!' -A3 compil-3.log
  exit 1
fi

echo
grep "Output written" compil-3.log
echo "Débordements de marge : $(grep -c Overfull compil-3.log)"
echo "Fichier : $(pwd -W 2>/dev/null || pwd)/rapport.pdf"

# Ouvre le PDF dans la visionneuse par défaut, sauf si on passe --sans-ouvrir.
if [ "$1" != "--sans-ouvrir" ]; then
  start rapport.pdf 2>/dev/null || explorer.exe rapport.pdf 2>/dev/null || true
fi
