# -*- coding: utf-8 -*-
"""
Genere le schema d'architecture cloud de MUSEA au format .drawio.

Un script plutot qu'un XML ecrit a la main, pour une raison de depart : le logo
GitHub doit etre embarque en image encodee (draw.io n'embarque aucune forme
GitHub, il faut passer par une data URI). Le reste a suivi.

Conventions de couleur, celles d'AWS :
    AWS Cloud ............ #232F3E
    Region ............... #147EBA, pointille
    VPC .................. #8C4FFF
    Zone de disponibilite  #1E8E3E, pointille  (vert)
    Sous-reseau public ... #7AA116, fond clair (vert)
    Sous-reseau prive .... #00A4A6, fond clair (turquoise)

Les tuiles estompees sont decrites en Terraform mais non appliquees.

------------------------------------------------------------------------------
ROUTAGE DES LIAISONS — la regle qui gouverne tout ce fichier
------------------------------------------------------------------------------
AUCUNE LIAISON EN LIGNE DROITE entre deux blocs eloignes. Une diagonale traverse
les cadres, les libelles et les icones qu'elle rencontre, et un schema
d'architecture devient alors illisible.

Toutes les liaisons sont donc a angle droit, et passent par des COULOIRS laisses
volontairement vides dans la geometrie :

    C1  x = 770..840   entre la zone de disponibilite A et la zone B
    C2  y = 530..565   dans chaque zone, entre sous-reseau public et prive
    C3  y = 760..800   dans le VPC, sous les zones de disponibilite
    C4  y = 215..300   dans la region, au-dessus du VPC
    C5  x = 260..290   dans la region, a gauche du VPC

Une liaison ne franchit un cadre que PERPENDICULAIREMENT a son bord, jamais en
biais : c'est lisible, et cela se lit comme « ce trait entre dans cette zone ».

Le plan d'adressage interne du VPC (sous-reseau prive -> passerelle NAT de la
zone -> passerelle Internet) n'est PAS dessine : il demanderait six liaisons de
plus, toutes entre des ressources estompees, pour un gain nul. Il est enonce
dans la note du bas.

    python rapport/schemas/generer-drawio.py
"""
import base64
import io
import os

DOSSIER = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------- logo GitHub
# Mark officiel GitHub (Octicons « mark-github »), licence MIT.
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
# Docker : la baleine, tracee au plus simple sur une grille de 24.
LOGO_DOCKER = logo("#1D63ED",
                   "M4 10h3v3H4zM8 10h3v3H8zM12 10h3v3h-3zM8 6h3v3H8zM12 6h3v3h-3zM16 10h3v3h-3z"
                   "M2 15c1 3 4 5 9 5 6 0 10-3 11-8-1 1-3 1-4 0-1 2-3 2-4 1H2z", "0 0 24 24")
# Supabase : l'eclair.
LOGO_SUPABASE = logo("#3ECF8E", "M13 2 4 14h6l-1 8 9-12h-6z", "0 0 24 24")

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


def _edge(ident, source, cible, style, points):
    passages = "".join('              <mxPoint x="%g" y="%g" />\n' % (x, y)
                       for x, y in points)
    if passages:
        geo = ('          <mxGeometry relative="1" as="geometry">\n'
               '            <Array as="points">\n%s'
               '            </Array>\n'
               '          </mxGeometry>\n' % passages)
    else:
        geo = '          <mxGeometry relative="1" as="geometry" />\n'
    c('        <mxCell id="%s" style="%s" edge="1" parent="1" source="%s" target="%s">\n'
      '%s'
      '        </mxCell>' % (ident, style, source, cible, geo))


def droit(ident, source, cible, couleur="#232F3E", pointille=False, epaisseur=1.8):
    """Liaison rectiligne. Reservee aux blocs VOISINS et alignes : deux tuiles
    cote a cote sur la meme ligne, ou l'une au-dessus de l'autre. Partout
    ailleurs, employer coude()."""
    style = ("edgeStyle=none;rounded=0;html=1;endArrow=blockThin;endFill=1;"
             "strokeColor=%s;strokeWidth=%g;%s" % (couleur, epaisseur,
                                                   "dashed=1;" if pointille else ""))
    _edge(ident, source, cible, style, [])


def coude(ident, source, cible, sortie, entree, points,
          couleur="#232F3E", pointille=False, epaisseur=1.8):
    """Liaison a angles droits passant par des points imposes.

    sortie et entree sont des couples (x, y) exprimes en fraction du bloc :
    (0.5, 1) = milieu du bord bas, (1, 0.5) = milieu du bord droit. Les imposer
    evite que draw.io ne choisisse un bord qui renverrait le trait a travers le
    libelle du bloc, lequel est pose juste dessous."""
    sx, sy = sortie
    ex, ey = entree
    style = ("edgeStyle=orthogonalEdgeStyle;rounded=1;arcSize=8;html=1;"
             "endArrow=blockThin;endFill=1;jettySize=12;"
             "exitX=%g;exitY=%g;exitDx=0;exitDy=0;"
             "entryX=%g;entryY=%g;entryDx=0;entryDy=0;"
             "strokeColor=%s;strokeWidth=%g;%s"
             % (sx, sy, ex, ey, couleur, epaisseur,
                "dashed=1;" if pointille else ""))
    _edge(ident, source, cible, style, points)


# --------------------------------------------------------------- styles
def aws(res, bas, haut):
    """Tuile de service AWS, icone officielle de la bibliotheque draw.io."""
    return ("sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],"
            "[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],"
            "[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;"
            "gradientColor=%s;gradientDirection=north;fillColor=%s;strokeColor=#ffffff;"
            "dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;"
            "fontSize=11;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;"
            "resIcon=mxgraph.aws4.%s;" % (haut, bas, res))


def aws_pale(res, bas, haut):
    return aws(res, bas, haut) + "opacity=40;fontColor=#9AA0A6;fontStyle=2;"


def image(uri):
    return ("shape=image;html=1;verticalLabelPosition=bottom;verticalAlign=top;"
            "imageAspect=0;aspect=fixed;image=%s;fontSize=11;fontColor=#232F3E;" % uri)


UTILISATEUR = ("sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;"
               "fillColor=#232F3E;strokeColor=none;dashed=0;verticalLabelPosition=bottom;"
               "verticalAlign=top;align=center;html=1;fontSize=11;fontStyle=0;aspect=fixed;"
               "pointerEvents=1;shape=mxgraph.aws4.user;")

RESEAU   = ("#5A30B5", "#945DF2")
STOCKAGE = ("#277116", "#60A337")
CALCUL   = ("#D05C17", "#F78E04")
SECURITE = ("#C7131F", "#F54749")
GESTION  = ("#BC1356", "#FF4F8B")


def groupe(gr_icon, trait, pointille=False, fond="none", police=None):
    return ("points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],"
            "[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];"
            "outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;"
            "fontStyle=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.%s;strokeColor=%s;"
            "fillColor=%s;verticalAlign=top;align=left;spacingLeft=30;fontColor=%s;"
            "dashed=%d;" % (gr_icon, trait, fond, police or trait, 1 if pointille else 0))


def zone(trait, fond, pointille=True):
    return ("rounded=1;whiteSpace=wrap;html=1;fillColor=%s;strokeColor=%s;dashed=%d;"
            "fontSize=11;fontStyle=1;verticalAlign=top;align=left;spacingLeft=12;"
            "spacingTop=6;fontColor=%s;arcSize=6;" % (fond, trait, 1 if pointille else 0, trait))


NOTE = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#F4F6FA;strokeColor=#9AA0A6;"
        "fontSize=11;fontColor=#44546A;align=left;spacingLeft=10;"
        "verticalAlign=middle;arcSize=8;")

# =========================================================== construction
noeud("titre", "Architecture cloud MUSÉA",
      "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
      "fontSize=18;fontStyle=1;fontColor=#232F3E;", 30, 18, 600, 26)

# --- acteurs, hors AWS ------------------------------------------------------
noeud("vis",  "Visiteur",       UTILISATEUR,          56, 100, 52, 52)
noeud("dev",  "Développeur",    UTILISATEUR,          56, 240, 52, 52)
noeud("gha",  "GitHub Actions", image(LOGO_GITHUB),   56, 370, 52, 52)
noeud("hub",  "Docker Hub",     image(LOGO_DOCKER),   56, 500, 52, 52)
# Supabase est cale a gauche de SES : une remontee verticale sous SES
# traverserait son libelle, pose juste sous la tuile.
noeud("supa", "Supabase",       image(LOGO_SUPABASE), 900, 965, 52, 52)

# --- nuage AWS --------------------------------------------------------------
noeud("aws", "AWS Cloud", groupe("group_aws_cloud_alt", "#232F3E"), 180, 60, 1310, 880)
noeud("iam", "IAM",        aws("identity_and_access_management", *SECURITE), 194, 220, 52, 52)
noeud("r53", "Route 53",   aws("route_53", *RESEAU),              300, 100, 52, 52)
noeud("cf",  "CloudFront", aws("cloudfront", *RESEAU),            420, 100, 52, 52)
noeud("acm", "ACM",        aws("certificate_manager", *SECURITE), 540, 100, 52, 52)

# --- region -----------------------------------------------------------------
noeud("reg", "Région eu-west-3", groupe("group_region", "#147EBA", pointille=True),
      260, 185, 1210, 735)
# S3 est pose HORS du couloir C4 : a son ancienne place, son libelle occupait
# exactement la voie de passage vers le repartiteur de charge.
noeud("s3", "Amazon S3", aws("s3", *STOCKAGE), 480, 196, 52, 52)

# --- VPC --------------------------------------------------------------------
noeud("vpc", "VPC 10.42.0.0/16", groupe("group_vpc2", "#8C4FFF"), 290, 300, 1030, 500)
noeud("igw", "Internet Gateway", aws_pale("internet_gateway", *RESEAU), 430, 318, 52, 52)
noeud("alb", "Load Balancer",    aws_pale("elastic_load_balancing", *RESEAU), 779, 318, 52, 52)

noeud("aza", "Zone de disponibilité eu-west-3a", zone("#1E8E3E", "none"), 320, 390, 450, 370)
noeud("azb", "Zone de disponibilité eu-west-3b", zone("#1E8E3E", "none"), 840, 390, 450, 370)

noeud("pua", "Sous-réseau public 10.42.0.0/20",  zone("#7AA116", "#F4F9EC", pointille=False), 360, 425, 385, 105)
noeud("pub", "Sous-réseau public 10.42.16.0/20", zone("#7AA116", "#F4F9EC", pointille=False), 880, 425, 385, 105)
noeud("pra", "Sous-réseau privé 10.42.32.0/20",  zone("#00A4A6", "#EAF7F7", pointille=False), 360, 565, 385, 170)
noeud("prb", "Sous-réseau privé 10.42.48.0/20",  zone("#00A4A6", "#EAF7F7", pointille=False), 880, 565, 385, 170)

noeud("nata", "NAT Gateway", aws_pale("nat_gateway", *RESEAU), 520, 450, 52, 52)
noeud("natb", "NAT Gateway", aws_pale("nat_gateway", *RESEAU), 1040, 450, 52, 52)

noeud("fga",  "ECS Fargate", aws_pale("fargate", *CALCUL), 420, 600, 52, 52)
noeud("eksa", "EKS",         aws_pale("eks", *CALCUL),     620, 600, 52, 52)
noeud("fgb",  "ECS Fargate", aws_pale("fargate", *CALCUL), 940, 600, 52, 52)
noeud("eksb", "EKS",         aws_pale("eks", *CALCUL),    1140, 600, 52, 52)

# --- services regionaux -----------------------------------------------------
noeud("ecr", "Amazon ECR",      aws("ecr", *CALCUL),                   340, 840, 52, 52)
noeud("sm",  "Secrets Manager", aws("secrets_manager", *SECURITE),     540, 840, 52, 52)
noeud("ses", "Amazon SES",      aws("simple_email_service", *GESTION), 1000, 840, 52, 52)
noeud("cw",  "CloudWatch",      aws("cloudwatch_2", *GESTION),        1150, 840, 52, 52)
noeud("sns", "Amazon SNS",      aws("sns", *GESTION),                 1300, 840, 52, 52)

# --- note ------------------------------------------------------------------
noeud("note",
      "Tuiles estompées : décrites en Terraform, non appliquées.  ·  "
      "GitHub Actions pousse la même image vers Docker Hub ET vers Amazon ECR, "
      "simultanément.  ·  Le répartiteur de charge servirait les tâches ECS "
      "Fargate ; celles-ci sortiraient par la passerelle NAT placée dans le "
      "sous-réseau PUBLIC de leur zone, puis par la passerelle Internet.  ·  "
      "Secrets Manager leur fournit les secrets.",
      NOTE, 180, 946, 680, 140)

# ============================================================== liaisons
BLEU, ORANGE, GRIS, ROSE, ROUGE = "#1350B0", "#B84F13", "#9AA0A6", "#BC1356", "#C7131F"

BAS, HAUT, GAUCHE, DROITE = (0.5, 1), (0.5, 0), (0, 0.5), (1, 0.5)

# --- chemin d'une requete ---------------------------------------------------
droit("a1", "vis", "r53", BLEU, epaisseur=2)
droit("a2", "r53", "cf",  BLEU, epaisseur=2)
droit("a4", "acm", "cf",  ROUGE, pointille=True, epaisseur=1.4)
# CloudFront descend vers S3 en contournant par le haut : passer tout droit
# ecraserait le libelle « Région eu-west-3 ».
coude("a3", "cf", "s3", (1, 0.75), HAUT, [(506, 139)], BLEU, epaisseur=2)

# --- chemin de livraison ----------------------------------------------------
droit("a5", "dev", "gha", ORANGE, epaisseur=2)
# GitHub Actions pousse la MEME image vers les deux registres, en meme temps.
# Les deux liaisons partent donc d'une souche commune a y = 455 et divergent
# visiblement : enchainer gha -> hub -> ecr se lirait comme une sequence, ce
# qui serait faux.
coude("a6", "gha", "hub", BAS, HAUT, [(82, 455)], ORANGE, epaisseur=2)
# IAM rejoint GitHub Actions par la gauche, en descendant dans le blanc du
# nuage AWS plutot qu'en coupant en biais.
coude("a8", "iam", "gha", BAS, DROITE, [(220, 396)], ROUGE, pointille=True, epaisseur=1.4)
# GitHub Actions descend a l'exterieur du nuage, puis entre a l'horizontale.
coude("a7", "gha", "ecr", BAS, GAUCHE,
      [(82, 455), (24, 455), (24, 866)], ORANGE, epaisseur=2)

# --- entree dans le VPC : couloir C4, au-dessus du VPC ----------------------
coude("b1", "r53", "alb", (0, 0.75), (0.27, 0),
      [(252, 139), (252, 285), (793, 285)], GRIS, pointille=True, epaisseur=1.6)
coude("b2", "acm", "alb", BAS, (0.73, 0),
      [(566, 265), (817, 265)], ROUGE, pointille=True, epaisseur=1.4)
droit("b3", "igw", "alb", GRIS, pointille=True, epaisseur=1.6)

# Le lien « repartiteur de charge -> taches » N'EST PAS DESSINE, a dessein.
# Toute descente depuis le repartiteur traverse d'abord son propre libelle,
# puis le libelle du sous-reseau vise, tous deux cales en haut a gauche de
# leur cadre. Deux traits pointilles entre ressources estompees ne valaient
# pas de salir le schema : la note du bas l'enonce en toutes lettres.

# --- le registre alimente les taches : couloir C3, sous les zones -----------
coude("d1", "ecr", "fga", (0.25, 0), GAUCHE,
      [(353, 626)], ORANGE, epaisseur=2)
coude("d2", "ecr", "fgb", (0.75, 0), GAUCHE,
      [(379, 790), (913, 790), (913, 626)], ORANGE, epaisseur=2)

# --- courrier et surveillance ----------------------------------------------
coude("e1", "supa", "ses", HAUT, GAUCHE, [(926, 866)], ROSE, epaisseur=2)
droit("e2", "ses",  "cw",  ROSE, epaisseur=2)
droit("e3", "cw",   "sns", ROSE, epaisseur=2)

# ============================================================== ecriture
document = (
    '<mxfile host="app.diagrams.net" type="device" version="24.7.17">\n'
    '  <diagram id="musea-cloud" name="Architecture cloud MUSEA">\n'
    '    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" '
    'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1540" '
    'pageHeight="1100" math="0" shadow="0">\n'
    '      <root>\n'
    '        <mxCell id="0" />\n'
    '        <mxCell id="1" parent="0" />\n'
    + "\n".join(cellules) + "\n"
    '      </root>\n'
    '    </mxGraphModel>\n'
    '  </diagram>\n'
    '</mxfile>\n')

chemin = os.path.join(DOSSIER, "architecture-cloud-musea.drawio")
io.open(chemin, "w", encoding="utf-8", newline="\n").write(document)
print(chemin)
