# -*- coding: utf-8 -*-
"""
Genere le schema de l'assistant a ancrage documentaire (RAG) au format .drawio.

    python rapport/schemas/generer-rag.py

Principe de mise en page, tire des corrections apportees au schema cloud :

  · quatre colonnes seulement, largement espacees ;
  · l'index vectoriel est place AU CENTRE, entre les deux chaines, parce qu'il
    est le seul element qu'elles partagent : la chaine d'ingestion l'alimente,
    la chaine d'interrogation le consulte ;
  · la colonne 3 de la rangee basse est alignee sous l'index, si bien que le
    lien qui les unit est une verticale droite, sans coude ;
  · les deux seuls coudes du schema passent dans les bandes VIDES menagees
    entre les cadres, jamais au travers d'un bloc, d'un libelle ou d'un cadre ;
  · aucune fleche ne longe un cadre : celle du retour passe 70 px sous lui.

Le detail qui n'a pas besoin d'etre dessine est renvoye a la note du bas : un
schema surcharge ne se lit pas.
"""
import io
import os

DOSSIER = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------- palette
# Celle du rapport, pour que le schema soit de la meme famille que les autres.
BLEU_FONCE = "#1F4D78"
BLEU_MOYEN = "#2E74B5"
BLEU_CLAIR = "#DEEAF6"
ORANGE = "#ED7D31"
GRIS = "#44546A"
GRIS_CLAIR = "#F4F6FA"

cellules = []


def c(x):
    cellules.append(x)


def echapper(t):
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def noeud(ident, valeur, style, x, y, w, h):
    """Le HTML des libelles (<br>, <b>, <i>) doit etre ECHAPPE dans l'attribut
    XML ; draw.io le re-interprete ensuite grace a html=1. Sans cet echappement
    le « < » de <br> casse le document et seule une partie du schema est rendue."""
    c('        <mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">\n'
      '          <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry" />\n'
      '        </mxCell>' % (ident, echapper(valeur), style, x, y, w, h))


def _edge(ident, valeur, source, cible, style, points):
    passages = "".join('              <mxPoint x="%g" y="%g" />\n' % (x, y)
                       for x, y in points)
    if passages:
        geo = ('          <mxGeometry relative="1" as="geometry">\n'
               '            <Array as="points">\n%s'
               '            </Array>\n'
               '          </mxGeometry>\n' % passages)
    else:
        geo = '          <mxGeometry relative="1" as="geometry" />\n'
    c('        <mxCell id="%s" value="%s" style="%s" edge="1" parent="1" '
      'source="%s" target="%s">\n%s        </mxCell>'
      % (ident, echapper(valeur), style, source, cible, geo))


def _style(couleur, epaisseur, pointille, double, orthogonal):
    return (("edgeStyle=orthogonalEdgeStyle;rounded=1;arcSize=10;"
             if orthogonal else "edgeStyle=none;rounded=0;")
            + "html=1;jettySize=14;endArrow=blockThin;endFill=1;"
            + ("startArrow=blockThin;startFill=1;" if double else "")
            # verticalAlign=bottom pose l'etiquette AU-DESSUS du trait au lieu
            # de la poser dessus : sans cela la ligne barre le mot.
            + "verticalAlign=bottom;labelBackgroundColor=#ffffff;"
            + "fontSize=11;fontColor=%s;" % GRIS
            + "strokeColor=%s;strokeWidth=%g;" % (couleur, epaisseur)
            + ("dashed=1;" if pointille else ""))


def droit(ident, source, cible, valeur="", couleur=GRIS, epaisseur=1.8,
          double=False, pointille=False):
    """Liaison rectiligne, reservee a deux blocs voisins et alignes."""
    _edge(ident, valeur, source, cible,
          _style(couleur, epaisseur, pointille, double, False), [])


def coude(ident, source, cible, sortie, entree, points, valeur="",
          couleur=GRIS, epaisseur=1.8, double=False, pointille=False):
    """Liaison a angles droits passant par des points imposes.

    Imposer le bord de sortie et le bord d'entree evite que draw.io ne choisisse
    de lui-meme un cote qui renverrait le trait a travers le bloc."""
    sx, sy = sortie
    ex, ey = entree
    style = (_style(couleur, epaisseur, pointille, double, True)
             + "exitX=%g;exitY=%g;exitDx=0;exitDy=0;"
               "entryX=%g;entryY=%g;entryDx=0;entryDy=0;" % (sx, sy, ex, ey))
    _edge(ident, valeur, source, cible, style, points)


BAS, HAUT, GAUCHE, DROITE = (0.5, 1), (0.5, 0), (0, 0.5), (1, 0.5)

# ------------------------------------------------------------------ styles
def bloc(fond=BLEU_CLAIR, trait=BLEU_MOYEN, police=BLEU_FONCE, epaisseur=1.4):
    return ("rounded=1;whiteSpace=wrap;html=1;arcSize=12;"
            "fillColor=%s;strokeColor=%s;strokeWidth=%g;fontColor=%s;"
            "fontSize=12;verticalAlign=middle;align=center;spacing=6;"
            % (fond, trait, epaisseur, police))


PIVOT = bloc(BLEU_MOYEN, BLEU_FONCE, "#FFFFFF", 2)      # l'index vectoriel
ACTEUR = bloc(BLEU_FONCE, BLEU_FONCE, "#FFFFFF", 1.4)   # le visiteur
EXTERNE = bloc(GRIS_CLAIR, ORANGE, GRIS, 1.6)           # service tiers

CADRE = ("rounded=1;whiteSpace=wrap;html=1;arcSize=4;fillColor=none;"
         "strokeColor=%s;dashed=1;dashPattern=8 6;strokeWidth=1.4;"
         "verticalAlign=top;align=left;spacingLeft=14;spacingTop=8;"
         "fontSize=13;fontStyle=1;fontColor=%s;" % (BLEU_MOYEN, BLEU_MOYEN))

NOTE = ("rounded=1;whiteSpace=wrap;html=1;arcSize=8;fillColor=%s;"
        "strokeColor=#9AA0A6;fontSize=11;fontColor=%s;align=left;"
        "spacingLeft=12;spacingTop=6;verticalAlign=top;" % (GRIS_CLAIR, GRIS))

TITRE = ("text;html=1;strokeColor=none;fillColor=none;align=left;"
         "verticalAlign=middle;fontSize=18;fontStyle=1;fontColor=%s;" % BLEU_FONCE)

# ================================================================ geometrie
# ATTENTION : la chaine d'export multiplie les corps de texte par 1,8 pour que
# le schema reste lisible une fois ramene a 15,5 cm. Les blocs doivent donc
# etre dimensionnes pour le texte AGRANDI : a 12 px d'origine, une ligne occupe
# environ 26 px a l'arrivee. D'ou trois regles tenues ici :
#   · trois lignes au plus par bloc, vingt caracteres au plus par ligne ;
#   · des blocs de 120 px de haut, soit trois lignes plus les marges ;
#   · 75 px entre le haut d'un cadre et le premier bloc, pour degager le titre.
COL = [100, 445, 790, 1135]
LARG, HAUT_BLOC = 250, 120
MILIEU = COL[2] + LARG / 2.0          # 915 : l'axe de l'index

Y_ING, Y_IDX, Y_INT = 215, 490, 865
CADRE_ING, CADRE_INT = 140, 790
CADRE_H, CADRE_L = 250, 1310

noeud("titre", "Architecture de l'assistant à ancrage documentaire (RAG)",
      TITRE, 30, 20, 900, 26)

# ------------------------------------------------- cadre : chaîne d'ingestion
noeud("cadre_ing",
      "CHAÎNE D'INGESTION — hors ligne, à chaque mise à jour du catalogue",
      CADRE, 80, CADRE_ING, CADRE_L, CADRE_H)

noeud("ing1", "Base des notices<br><i>œuvres, salles,<br>musées, FAQ</i>",
      bloc(), COL[0], Y_ING, LARG, HAUT_BLOC)
noeud("ing2", "Dépôt documentaire<br><b>Amazon S3</b><br>"
              "<i>la source de vérité</i>",
      bloc(), COL[1], Y_ING, LARG, HAUT_BLOC)
noeud("ing3", "Découpage en<br>fragments<br><i>par lots de 12</i>",
      bloc(), COL[2], Y_ING, LARG, HAUT_BLOC)
noeud("ing4", "Plongement<br><b>en anglais</b><br><i>gte-small, 384 dim.</i>",
      bloc(), COL[3], Y_ING, LARG, HAUT_BLOC)

droit("i1", "ing1", "ing2", "export")
droit("i2", "ing2", "ing3")
droit("i3", "ing3", "ing4")

# -------------------------------------------------------- l'index, au centre
noeud("idx", "<b>Index vectoriel</b><br>HNSW — pgvector<br>distance cosinus",
      PIVOT, COL[2], Y_IDX, LARG, HAUT_BLOC)

# Le coude descend dans la bande vide laissee sous le cadre d'ingestion
# (y = 430), puis rejoint l'axe de l'index. Il ne traverse ni bloc ni libelle.
coude("i4", "ing4", "idx", BAS, HAUT,
      [(COL[3] + LARG / 2.0, 430), (MILIEU, 430)], "vecteurs")

# --------------------------------------------- cadre : chaîne d'interrogation
noeud("cadre_int",
      "CHAÎNE D'INTERROGATION — en ligne, à chaque question posée",
      CADRE, 80, CADRE_INT, CADRE_L, CADRE_H)

noeud("int1", "<b>Visiteur</b><br><i>question en français<br>ou en anglais</i>",
      ACTEUR, COL[0], Y_INT, LARG, HAUT_BLOC)
noeud("int2", "Fonction serveur<br><b>guide-agent</b><br>"
              "<i>garde-fous, vectorisation</i>",
      bloc(), COL[1], Y_INT, LARG, HAUT_BLOC)
noeud("int3", "Recherche<br>vectorielle<br><i>k plus proches voisins</i>",
      bloc(), COL[2], Y_INT, LARG, HAUT_BLOC)
noeud("int4", "<b>Modèle de langue</b><br><i>génération contrôlée</i>",
      EXTERNE, COL[3], Y_INT, LARG, HAUT_BLOC)

droit("q1", "int1", "int2")
droit("q2", "int2", "int3")
droit("q3", "int3", "int4", "", ORANGE)

# La colonne 3 est alignee sous l'index : le lien est une verticale droite.
droit("q4", "int3", "idx", "", BLEU_MOYEN, 1.8, double=True)

# Le retour passe 70 px SOUS le cadre, jamais le long de ses bords.
coude("q5", "int4", "int1", BAS, BAS,
      [(COL[3] + LARG / 2.0, 1110), (COL[0] + LARG / 2.0, 1110)],
      "réponse sourcée")

# --------------------------------------------------------------------- note
noeud("note",
      "La clé d'accès au modèle de langue ne quitte jamais la fonction serveur : "
      "le navigateur du visiteur ne dialogue qu'avec guide-agent.  ·  "
      "Les fragments sont plongés en anglais : une requête française classait "
      "une œuvre sans rapport devant deux masques réellement apparentés.  ·  "
      "La recherche remonte les fragments les plus proches, que la consigne "
      "d'ancrage impose au modèle : il ne peut énoncer aucun fait qui n'y "
      "figure pas, et il est autorisé à déclarer qu'aucune conclusion n'est "
      "possible.  ·  Les questions restées sans réponse sont journalisées "
      "anonymement et classées en huit thèmes, qui indiquent quoi documenter.",
      NOTE, 80, 1180, CADRE_L, 210)

# ============================================================== ecriture
document = (
    '<mxfile host="app.diagrams.net" type="device" version="24.7.17">\n'
    '  <diagram id="musea-rag" name="Architecture RAG MUSEA">\n'
    '    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" '
    'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
    'pageWidth="1470" pageHeight="1440" math="0" shadow="0">\n'
    '      <root>\n'
    '        <mxCell id="0" />\n'
    '        <mxCell id="1" parent="0" />\n'
    + "\n".join(cellules) + "\n"
    '      </root>\n'
    '    </mxGraphModel>\n'
    '  </diagram>\n'
    '</mxfile>\n')

chemin = os.path.join(DOSSIER, "rag-musea.drawio")
io.open(chemin, "w", encoding="utf-8", newline="\n").write(document)
print(chemin)
