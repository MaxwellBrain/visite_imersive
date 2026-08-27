# -*- coding: utf-8 -*-
"""
Genere le schema de la chaine de deploiement de MUSEA au format .drawio.

Meme vocabulaire graphique que « architecture-cloud-musea.drawio » : icones
officielles AWS, code couleur AWS, logo GitHub embarque en data URI.

    Reseau ..... violet #5A30B5      Stockage ... vert   #277116
    Securite ... rouge  #C7131F      Cadres ..... bleu   #147EBA

TROIS PARTIS PRIS, tous au service de la lisibilite :

1. Le schema RESPIRE. Onze objets, deux bandes, 350 px entre deux etapes
   voisines. Les details sont rejetes sur les etiquettes des fleches et sur deux
   notes, jamais dans des boites supplementaires.

2. Les tailles de police sont DEFINITIVES ici (28 px), et non multipliees a
   l'export. C'est la seule facon de dimensionner les boites et de calibrer la
   longueur des etiquettes en connaissance de cause : une etiquette de fleche ne
   doit pas depasser 22 caracteres, sans quoi elle deborde sur les blocs voisins.

3. AUCUN TRAIT NE TRAVERSE UN CADRE, UN LIBELLE OU UNE ICONE. La liaison qui
   passe d'une bande a l'autre sort par la droite, contourne la bande PAR
   L'EXTERIEUR, longe le couloir laisse vide entre les deux bandes, puis
   redescend a la verticale sur le premier bloc. Les sorties de bloc sont
   imposees, jamais laissees au routeur : une sortie par le bas ferait descendre
   le trait au travers du libelle, qui est justement pose dessous.

    python rapport/schemas/generer-deploiement.py
"""
import base64
import io
import os

DOSSIER = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------- logo GitHub
OCTICON = ('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 '
           '0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 '
           '0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-'
           '1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 '
           '1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44'
           '.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38'
           '.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-'
           '.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z')


def logo(couleur, chemin, boite="0 0 16 16"):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" width="64" height="64">'
           '<path fill="%s" d="%s"/></svg>' % (boite, couleur, chemin))
    return "data:image/svg+xml," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


LOGO_GITHUB = logo("#24292F", OCTICON)

cellules = []


def c(x):
    cellules.append(x)


def echapper(t):
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def noeud(ident, valeur, style, x, y, w, h):
    c('        <mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">\n'
      '          <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry" />\n'
      '        </mxCell>' % (ident, echapper(valeur), style, x, y, w, h))


def lien(ident, source, cible, etiquette="", couleur="#232F3E",
         pointille=False, epaisseur=3):
    """Liaison rectiligne, reservee a deux blocs voisins sur la meme ligne."""
    style = ("edgeStyle=none;rounded=0;html=1;endArrow=blockThin;endFill=1;"
             "strokeColor=%s;strokeWidth=%g;fontSize=26;fontColor=#44546A;"
             "labelBackgroundColor=#FFFFFF;verticalAlign=bottom;%s"
             % (couleur, epaisseur, "dashed=1;" if pointille else ""))
    c('        <mxCell id="%s" value="%s" style="%s" edge="1" parent="1" '
      'source="%s" target="%s">\n'
      '          <mxGeometry relative="1" as="geometry" />\n'
      '        </mxCell>' % (ident, echapper(etiquette), style, source, cible))


def lien_coude(ident, source, cible, etiquette, points, couleur="#232F3E",
               sortie=(1, 0.5), entree=(0.5, 0), pointille=False, epaisseur=3):
    """Liaison a angles droits passant par des points imposes.

    sortie et entree sont des couples (x, y) en fraction du bloc : (1, 0.25) =
    bord droit, au quart de la hauteur. Les imposer evite que draw.io ne
    choisisse un bord qui renverrait le trait a travers le libelle du bloc."""
    sx, sy = sortie
    ex, ey = entree
    style = ("edgeStyle=orthogonalEdgeStyle;rounded=1;arcSize=10;html=1;"
             "endArrow=blockThin;endFill=1;jettySize=14;"
             "exitX=%g;exitY=%g;exitDx=0;exitDy=0;entryX=%g;entryY=%g;"
             "entryDx=0;entryDy=0;strokeColor=%s;strokeWidth=%g;fontSize=26;"
             "fontColor=#44546A;labelBackgroundColor=#FFFFFF;verticalAlign=bottom;%s"
             % (sx, sy, ex, ey, couleur, epaisseur,
                "dashed=1;" if pointille else ""))
    passages = "".join('              <mxPoint x="%g" y="%g" />\n' % (x, y)
                       for x, y in points)
    c('        <mxCell id="%s" value="%s" style="%s" edge="1" parent="1" '
      'source="%s" target="%s">\n'
      '          <mxGeometry relative="1" as="geometry">\n'
      '            <Array as="points">\n'
      '%s'
      '            </Array>\n'
      '          </mxGeometry>\n'
      '        </mxCell>' % (ident, echapper(etiquette), style, source, cible,
                            passages))


# --------------------------------------------------------------- styles
def aws(res, bas, haut):
    return ("sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],"
            "[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],"
            "[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;"
            "gradientColor=%s;gradientDirection=north;fillColor=%s;strokeColor=#ffffff;"
            "dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;"
            "fontSize=28;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;"
            "resIcon=mxgraph.aws4.%s;" % (haut, bas, res))


def image(uri):
    return ("shape=image;html=1;verticalLabelPosition=bottom;verticalAlign=top;"
            "imageAspect=0;aspect=fixed;image=%s;fontSize=28;fontColor=#232F3E;" % uri)


UTILISATEUR = ("sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;"
               "fillColor=#232F3E;strokeColor=none;dashed=0;verticalLabelPosition=bottom;"
               "verticalAlign=top;align=center;html=1;fontSize=28;fontStyle=0;aspect=fixed;"
               "pointerEvents=1;shape=mxgraph.aws4.user;")

RESEAU   = ("#5A30B5", "#945DF2")
STOCKAGE = ("#277116", "#60A337")
SECURITE = ("#C7131F", "#F54749")

VIOLET, VERT, ROUGE = "#5A30B5", "#277116", "#C7131F"
BLEU, ORANGE = "#1350B0", "#B84F13"

BANDE = ("rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#147EBA;"
         "dashed=1;dashPattern=8 6;strokeWidth=2;fontSize=32;fontStyle=1;"
         "verticalAlign=top;align=left;spacingLeft=28;spacingTop=16;"
         "fontColor=#147EBA;arcSize=3;")

NOTE = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#F4F6FA;strokeColor=#9AA0A6;"
        "fontSize=26;fontColor=#44546A;align=center;verticalAlign=middle;arcSize=10;")

ARRET = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#FDECEC;strokeColor=#C7131F;"
         "strokeWidth=2;fontSize=26;fontColor=#C7131F;align=center;"
         "verticalAlign=middle;arcSize=10;")

# =========================================================== construction
noeud("titre", "Chaîne de déploiement MUSÉA",
      "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
      "fontSize=44;fontStyle=1;fontColor=#232F3E;", 50, 40, 900, 60)

# ---- bande 1 : integration continue ---------------------------------------
#      cadre : x 50..1450, y 130..470
noeud("b1", "INTÉGRATION CONTINUE — à chaque dépôt de modification",
      BANDE, 50, 130, 1400, 340)

noeud("dev", "Développeur",    UTILISATEUR,        230, 220, 60, 60)
noeud("hub", "Dépôt GitHub",   image(LOGO_GITHUB), 580, 220, 60, 60)
noeud("gha", "GitHub Actions", image(LOGO_GITHUB), 930, 220, 60, 60)

# La boite d'echec est posee SOUS le niveau des fleches horizontales : la
# liaison qui file vers la bande du bas passe au-dessus d'elle sans la toucher.
noeud("ech", "Échec d'un contrôle :\nla chaîne s'arrête, rien n'est publié",
      ARRET, 1170, 330, 260, 120)

#      la note occupe la moitie gauche, laissant libre la colonne x > 950
noeud("etapes",
      "installation  ·  compilation  ·  contrôles du paquet produit  ·  "
      "terraform fmt  ·  terraform validate",
      NOTE, 200, 330, 700, 120)

lien("a1", "dev", "hub", "git push", BLEU)
lien("a2", "hub", "gha", "déclenche la chaîne", BLEU)
# Sortie aux trois quarts de la hauteur : 30 px sous la liaison qui part vers la
# bande du bas, deux traits paralleles et jamais superposes.
lien_coude("a3", "gha", "ech", "", [(1300, 265)], ROUGE,
           sortie=(1, 0.75), entree=(0.5, 0), pointille=True, epaisseur=2.5)

# ---- bande 2 : deploiement -------------------------------------------------
#      cadre : x 50..1450, y 610..950
noeud("b2", "DÉPLOIEMENT — sur la branche principale seulement",
      BANDE, 50, 610, 1400, 340)

noeud("iam", "Jeton OIDC (IAM)",
      aws("identity_and_access_management", *SECURITE), 250, 700, 60, 60)
noeud("s3",  "Amazon S3",  aws("s3", *STOCKAGE),        600, 700, 60, 60)
noeud("cf",  "CloudFront", aws("cloudfront", *RESEAU),  950, 700, 60, 60)
noeud("vis", "Visiteur",   UTILISATEUR,                1300, 700, 60, 60)

# Le passage d'une bande a l'autre : sortie par la droite au quart de la
# hauteur, contournement PAR L'EXTERIEUR du cadre (x = 1500, le cadre s'arrete a
# 1450), parcours du couloir vide entre les deux bandes (y = 545), puis descente
# verticale sur le premier bloc. Aucun cadre, aucun libelle, aucune icone n'est
# traverse ; les deux seuls franchissements de bord sont perpendiculaires.
lien_coude("p1", "gha", "iam", "si tous les contrôles passent",
           [(1500, 235), (1500, 545), (280, 545)], ORANGE,
           sortie=(1, 0.25), entree=(0.5, 0))

lien("d1", "iam", "s3",  "publication",    VERT)
lien("d2", "s3",  "cf",  "purge du cache", VIOLET)
lien("d3", "cf",  "vis", "site vérifié",   VIOLET)

noeud("cle",
      "Aucune clé permanente : le jeton OIDC est présenté à chaque exécution,\n"
      "et le rôle est restreint à ce dépôt, à ce seul stockage, à cette seule distribution.",
      NOTE, 300, 830, 900, 100)

# ============================================================== ecriture
document = (
    '<mxfile host="app.diagrams.net" type="device" version="24.7.17">\n'
    '  <diagram id="musea-deploiement" name="Chaine de deploiement MUSEA">\n'
    '    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" '
    'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" '
    'pageHeight="1010" math="0" shadow="0">\n'
    '      <root>\n'
    '        <mxCell id="0" />\n'
    '        <mxCell id="1" parent="0" />\n'
    + "\n".join(cellules) + "\n"
    '      </root>\n'
    '    </mxGraphModel>\n'
    '  </diagram>\n'
    '</mxfile>\n')

chemin = os.path.join(DOSSIER, "deploiement-musea.drawio")
io.open(chemin, "w", encoding="utf-8", newline="\n").write(document)
print(chemin)
