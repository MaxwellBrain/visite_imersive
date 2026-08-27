# -*- coding: utf-8 -*-
"""Nettoie le SVG rendu par draw.io puis le convertit en PDF pour LaTeX.

Quatre retouches, chacune pour une raison precise :

1. draw.io ecrit chaque libelle sous la forme
       <switch><foreignObject>...HTML...</foreignObject><text>secours</text></switch>
   Le HTML du foreignObject n'est compris que par un navigateur ; les
   convertisseurs SVG le laissent tomber et le schema arriverait sans texte.
   On supprime les foreignObject et on deballe les switch : restent les <text>.

2. Les couleurs sont ecrites deux fois : en attribut (« stop-color="#C7131F" »)
   et dans un style CSS qui, lui, emploie la fonction recente
   « light-dark(rgb(199,19,31), rgb(255,154,165)) ». Le style l'emporte sur
   l'attribut ; comme aucun convertisseur ne comprend light-dark(), la couleur
   devient NOIRE. C'est ce qui rendait toutes les tuiles AWS noires. On resout
   light-dark() sur sa premiere valeur, celle du theme clair.

3. Les tuiles AWS sont peintes avec un degrade (« fill="url(#...)" »). MuPDF
   ne suit pas toujours ces references : on aplatit chaque degrade sur sa
   couleur basse, celle qui domine visuellement la tuile. Le code couleur AWS
   (violet reseau, vert stockage, orange calcul, rouge securite, rose gestion)
   est ainsi conserve.

4. Les logos GitHub, Docker et Supabase sont des <image> pointant vers un SVG
   encode en base64. Un SVG imbrique dans un SVG est ignore a la conversion :
   on le remplace par son trace, mis a l'echelle.
"""
import base64, io, os, re, sys

DOSSIER = os.path.dirname(os.path.abspath(__file__))
FIGURES = os.path.join(os.path.dirname(os.path.dirname(DOSSIER)), "latex", "figures")

# Le nom du diagramme vient de l'argument de ligne de commande, sinon de celui
# que construire_page.py a preparé en dernier.
memo = os.path.join(DOSSIER, "diagramme-courant.txt")
if len(sys.argv) > 1:
    NOM = sys.argv[1]
elif os.path.isfile(memo):
    NOM = io.open(memo, encoding="utf-8").read().strip()
else:
    NOM = "architecture-cloud-musea"

SRC = os.path.join(DOSSIER, "rendu.svg")
NET = os.path.join(DOSSIER, "rendu-propre.svg")
PDF = os.path.join(FIGURES, NOM + ".pdf")
print("diagramme :", NOM)

s = io.open(SRC, encoding="utf-8").read()
avant = (s.count("<switch"), s.count("<foreignObject"), s.count("<text"), s.count("<image"))

# --- 1. libelles ------------------------------------------------------------
s = re.sub(r"<foreignObject\b.*?</foreignObject>", "", s, flags=re.S)
s = s.replace("<switch>", "").replace("</switch>", "")


# --- 2. light-dark(clair, sombre) -> clair ----------------------------------
def resoudre_light_dark(texte):
    """Remplace chaque light-dark(a, b) par a, en respectant les parentheses
    imbriquees : les arguments sont souvent des rgb(...)."""
    marque = "light-dark("
    while True:
        i = texte.find(marque)
        if i < 0:
            return texte
        j = i + len(marque)
        prof, virgule = 1, -1
        while j < len(texte) and prof:
            if texte[j] == "(":
                prof += 1
            elif texte[j] == ")":
                prof -= 1
            elif texte[j] == "," and prof == 1 and virgule < 0:
                virgule = j
            j += 1
        clair = texte[i + len(marque):virgule if virgule > 0 else j - 1].strip()
        texte = texte[:i] + clair + texte[j:]


n_ld = s.count("light-dark(")
s = resoudre_light_dark(s)

# --- 3. degrades -> couleur pleine ------------------------------------------
degrades = {}
for m in re.finditer(r'<linearGradient[^>]*id="([^"]+)"(.*?)</linearGradient>', s, re.S):
    arrets = re.findall(r'stop-color="([^"]+)"', m.group(2))
    if arrets:
        degrades[m.group(1)] = arrets[0]      # la couleur basse de la tuile

n_deg = 0
for ident, couleur in degrades.items():
    avant_n = s.count('url(#%s)' % ident)
    s = s.replace('url(#%s)' % ident, couleur)
    n_deg += avant_n


# --- 4. logos ---------------------------------------------------------------
def attribut(balise, nom):
    m = re.search(r'\b%s="([^"]*)"' % nom, balise)
    return m.group(1) if m else None


def inliner(m):
    """Remplace une balise <image> pointant vers un SVG par le trace de ce SVG.

    draw.io emet deux formes selon les cas : l'image posee directement, avec ses
    coordonnees, ou l'image rangee dans un <symbol> et appelee par <use>, sans
    coordonnees. Les deux doivent etre traitees."""
    balise = m.group(0)
    uri = attribut(balise, "xlink:href") or attribut(balise, "href") or ""
    if not uri.startswith("data:image/svg+xml;base64,"):
        return balise
    larg = float(attribut(balise, "width") or 0)
    haut = float(attribut(balise, "height") or 0)
    if not larg or not haut:
        return balise
    interne = base64.b64decode(uri.split("base64,", 1)[1]).decode("utf-8")
    vb = re.search(r'viewBox="([\d.\s-]+)"', interne)
    traces = re.findall(r"<path\b[^>]*/>", interne)
    if not vb or not traces:
        return balise
    _, _, vw, vh = [float(v) for v in vb.group(1).split()]
    px, py = attribut(balise, "x"), attribut(balise, "y")
    deplacement = ("translate(%s,%s) " % (px, py)) if px and py else ""
    return ('<g transform="%sscale(%g,%g)">%s</g>'
            % (deplacement, larg / vw, haut / vh, "".join(traces)))


s, n_logo = re.subn(r"<image\b[^>]*/>", inliner, s)

io.open(NET, "w", encoding="utf-8").write(s)

apres = (s.count("<switch"), s.count("<foreignObject"), s.count("<text"), s.count("<image"))
print("switch/foreignObject/text/image : avant %s -> apres %s" % (avant, apres))
print("light-dark() resolus  :", n_ld)
print("degrades aplatis      : %d references, %d definitions %s"
      % (n_deg, len(degrades), sorted(set(degrades.values()))))
print("logos remis en trace  :", n_logo)

if s.count("light-dark(") or "url(#" in s.replace("url(#drawio-svg-clip", ""):
    restes = re.findall(r'fill="url\(#[^"]+\)"', s)
    if restes:
        print("ATTENTION : references de remplissage non resolues :", restes[:3])

import pymupdf
d = pymupdf.open(NET)
print("dimensions : %.0f x %.0f pt" % (d[0].rect.width, d[0].rect.height))
pdf = d.convert_to_pdf()
io.open(PDF, "wb").write(pdf)
print("PDF ecrit :", PDF, os.path.getsize(PDF), "octets")

d2 = pymupdf.open("pdf", pdf)
d2[0].get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4)).save(os.path.join(DOSSIER, "apercu-" + NOM + ".png"))
print("apercu-%s.png ecrit" % NOM)
