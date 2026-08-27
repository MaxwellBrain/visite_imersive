# -*- coding: utf-8 -*-
"""Fabrique la page d'export a partir d'un .drawio, sans echappement a la main.

    python construire_page.py [nom-du-diagramme] [facteur]

    nom-du-diagramme : sans l'extension. Defaut : architecture-cloud-musea
    facteur          : multiplicateur des tailles de police. Defaut : celui
                       inscrit dans FACTEURS pour ce diagramme, sinon 1.8

Pourquoi grossir les polices avant le rendu : le schema sera ramene a 15,5 cm,
la justification du rapport. Un dessin de 50 cm de large subit donc une
reduction de 70 %, et des libelles de 11 px arriveraient a 3,3 pt sur le
papier. On les grossit AVANT, ce qui ne touche pas la geometrie : seule la
taille des caracteres change.

Le facteur depend de la densite du schema. Un schema serre plafonne vite : au
dela, les libelles voisins se chevauchent. Un schema aere en supporte beaucoup
plus.
"""
import io, json, os, re, sys

DOSSIER = os.path.dirname(os.path.abspath(__file__))
SCHEMAS = os.path.dirname(DOSSIER)

# Facteur retenu pour chaque diagramme, etabli en regardant l'apercu :
#   architecture-cloud-musea : 1,8 (11 -> 20 px). Au dela, « Amazon ECR » et
#       « Secrets Manager » se chevauchent.
#   deploiement-musea : 1,0. Ce schema est deja ecrit a sa taille definitive
#       (28 px), ce qui a permis de dimensionner ses boites et de calibrer la
#       longueur de ses etiquettes en connaissance de cause.
FACTEURS = {
    "architecture-cloud-musea": 1.8,
    "deploiement-musea": 1.0,
}

nom = sys.argv[1] if len(sys.argv) > 1 else "architecture-cloud-musea"
facteur = float(sys.argv[2]) if len(sys.argv) > 2 else FACTEURS.get(nom, 1.8)

source = os.path.join(SCHEMAS, nom + ".drawio")
if not os.path.isfile(source):
    raise SystemExit("introuvable : " + source)

xml = io.open(source, encoding="utf-8").read()
xml = re.sub(r"fontSize=(\d+)",
             lambda m: "fontSize=%d" % round(int(m.group(1)) * facteur), xml)

config = {"xml": xml, "toolbar": None, "zoom": 1, "highlight": "#0000ff",
          "nav": False, "resize": False, "border": 10}
# Le navigateur DECODE les entites d'un attribut HTML avant que le JSON ne soit
# lu. Sans neutraliser le « & », les entites du XML — les &lt;br&gt; des libelles
# — redeviendraient des « < » a l'interieur d'un attribut XML : le document
# devient invalide et seuls les tout premiers blocs sont rendus.
attr = (json.dumps(config, ensure_ascii=False)
        .replace("&", "&amp;")
        .replace("'", "&#39;"))

page = """<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Export du schema</title></head>
<body>
<div id="etat" style="font:14px monospace;padding:8px;background:#eef">
chargement du moteur de rendu draw.io...</div>
<div id="cible" data-mxgraph='%s'></div>
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
<script>
function etat(t){ document.getElementById('etat').textContent = t; }

window.addEventListener('load', function () {
  try {
    // Libelles traces en <text> et non en foreignObject.
    mxClient.NO_FO = true;
    var el = document.getElementById('cible');
    var cfg = JSON.parse(el.getAttribute('data-mxgraph'));
    var node = mxUtils.parseXml(cfg.xml).documentElement;
    el.innerHTML = '';
    var v = new GraphViewer(null, node, cfg);
    v.init(el, node);
    window.__v = v;
    setTimeout(envoyer, 1200);
    etat('rendu en cours...');
  } catch (e) { etat('ERREUR : ' + e.message); }
});

function envoyer() {
  try {
    var g = window.__v.graph;
    g.foEnabled = false;
    var svg = g.getSvg('#ffffff', 1, 12, false, null, true, null, null, null, false);
    var s = '<?xml version="1.0" encoding="UTF-8"?>\\n'
          + new XMLSerializer().serializeToString(svg);
    window.__taille = s.length;
    fetch('/', { method: 'POST', body: s })
      .then(function (r) { return r.text(); })
      .then(function () { window.__fini = true; etat('OK - ' + s.length + ' octets envoyes'); })
      .catch(function (e) { etat('ERREUR envoi : ' + e.message); });
  } catch (e) { etat('ERREUR rendu : ' + e.message); }
}
</script>
</body>
</html>
""" % attr

io.open(os.path.join(DOSSIER, "export.html"), "w", encoding="utf-8").write(page)
io.open(os.path.join(DOSSIER, "diagramme-courant.txt"), "w",
        encoding="utf-8").write(nom)
print("export.html ecrit pour « %s », polices x%.1f" % (nom, facteur))
