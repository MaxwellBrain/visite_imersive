# Exporter `architecture-cloud-musea.drawio` vers le rapport

Le schéma d'architecture cloud est dessiné dans draw.io. Le rapport LaTeX a
besoin d'un **PDF vectoriel** ; ces trois scripts font la conversion sans
installer draw.io sur le poste.

## Pourquoi ce détour

draw.io ne dessine pas ses icônes AWS avec des formes SVG stockées dans le
fichier : il les trace en JavaScript, au moment de l'affichage. Aucun
convertisseur local ne peut donc lire le `.drawio` et en sortir une image — il
faut passer par le moteur de rendu de draw.io lui-même. On le charge dans un
navigateur, on récupère le SVG qu'il produit, et on le convertit en PDF.

**Le diagramme ne quitte jamais le poste.** Seul le script de rendu est
téléchargé depuis `viewer.diagrams.net` ; le fichier, lui, est servi par un
serveur local et le SVG revient sur le même serveur local.

## Marche à suivre

```bash
python rapport/schemas/export/construire_page.py
python rapport/schemas/export/serveur.py
```

Ouvrir ensuite `http://127.0.0.1:8731/export.html` dans un navigateur. La page
affiche « OK — n octets envoyés » : le SVG est arrivé dans `rendu.svg`. Arrêter
le serveur (Ctrl+C), puis :

```bash
python rapport/schemas/export/finaliser.py
```

Le PDF est écrit directement à sa place :
`rapport/latex/figures/architecture-cloud-musea.pdf`. Recompiler le rapport.

## Ce que font les scripts

| Script | Rôle |
|---|---|
| `construire_page.py` | Fabrique `export.html` à partir du `.drawio`, **en grossissant les libellés** (11 px → 20 px). Le schéma fait 52 cm de large et sera ramené à 15,5 cm, la justification du rapport : sans ce grossissement, les libellés arriveraient à 3,3 pt, illisibles. La géométrie, elle, n'est pas touchée — seule la taille des caractères change. 20 px est le maximum : au-delà, « Amazon ECR » et « Secrets Manager » se chevauchent. |
| `serveur.py` | Sert la page sur `127.0.0.1:8731` et reçoit le SVG rendu (`rendu.svg`). |
| `finaliser.py` | Nettoie le SVG et le convertit en PDF. |

`finaliser.py` fait quatre retouches, chacune indispensable :

1. draw.io écrit chaque libellé en `<switch><foreignObject>…HTML…</foreignObject><text>secours</text></switch>`. Le HTML n'est compris que par un navigateur : sans nettoyage, **le schéma arriverait sans aucun texte**. On supprime les `foreignObject` et on garde les `<text>`.
2. **Les couleurs sont écrites deux fois** : en attribut (`stop-color="#C7131F"`) et dans un style CSS qui, lui, emploie la fonction récente `light-dark(rgb(199,19,31), rgb(255,154,165))`. Le style l'emporte sur l'attribut, et comme aucun convertisseur ne comprend `light-dark()`, **la couleur devient noire**. C'est ce qui rendait toutes les tuiles AWS noires au premier export. On résout `light-dark()` sur sa première valeur, celle du thème clair — 159 occurrences dans ce schéma.
3. Les tuiles AWS sont peintes avec un **dégradé** (`fill="url(#…)"`). MuPDF ne suit pas ces références : on aplatit chaque dégradé sur sa couleur basse. Le code couleur AWS est conservé — violet réseau, vert stockage, orange calcul, rouge sécurité, rose gestion.
4. Les logos GitHub, Docker et Supabase sont des `<image>` pointant vers un SVG encodé en base64. Un SVG imbriqué dans un SVG est ignoré à la conversion : on le remplace par son tracé, mis à l'échelle.

## Si vous préférez draw.io

Si vous installez draw.io Desktop, l'export direct fait le même travail :
**Fichier → Exporter → PDF**, avec *Crop* activé, puis enregistrer sous
`rapport/latex/figures/architecture-cloud-musea.pdf`. Pensez alors à grossir
les polices dans le diagramme, sans quoi les libellés seront trop petits sur la
page A4.

## Contrôle après export

Ouvrir `apercu.png`, écrit par `finaliser.py`, et vérifier deux choses :

- **les tuiles AWS sont en couleur** (violet, vert, orange, rouge, rose) et non
  en noir — le noir signale que la résolution de `light-dark()` a échoué ;
- **aucun libellé n'en chevauche un autre**, en particulier « Amazon ECR » et
  « Secrets Manager », le couple le plus serré du schéma.

## Deux diagrammes, un seul outillage

Les scripts prennent le nom du diagramme en argument :

```bash
python rapport/schemas/generer-rag.py          # ou generer-drawio.py
python rapport/schemas/export/construire_page.py rag-musea
python rapport/schemas/export/serveur.py       # puis ouvrir la page
python rapport/schemas/export/finaliser.py rag-musea
```

| Diagramme | Source | Figure |
|---|---|---|
| `architecture-cloud-musea` | `generer-drawio.py` | 3.4 — infrastructure en nuage |
| `rag-musea` | `generer-rag.py` | 3.3 — assistant à ancrage documentaire |

## Le piège des entités HTML

`construire_page.py` place le XML du diagramme dans un attribut HTML. **Le
navigateur décode les entités d'un attribut avant que le JSON ne soit lu** :
sans neutraliser le `&`, les `&lt;br&gt;` des libellés redeviennent des `<`
à l'intérieur d'un attribut XML. Le document devient invalide, `parseXml`
s'arrête à la première occurrence, et **seuls les premiers blocs sont rendus**
— le reste du schéma disparaît sans le moindre message d'erreur.

Le symptôme à reconnaître : un SVG anormalement petit (quelques milliers
d'octets) et un `viewBox` qui ne couvre que le haut du dessin.

## Régler la taille des blocs

`construire_page.py` multiplie les corps de texte par 1,8. **Les blocs doivent
donc être dimensionnés pour le texte agrandi**, sinon il déborde du cadre. À
12 px d'origine, une ligne occupe environ 26 px à l'arrivée. Les règles tenues
dans `generer-rag.py` :

- trois lignes au plus par bloc, vingt caractères au plus par ligne ;
- des blocs de 120 px de haut, soit trois lignes plus les marges ;
- 75 px entre le haut d'un cadre et le premier bloc, pour dégager le titre.

Et pour les étiquettes de flèche : `verticalAlign=bottom` les pose **au-dessus**
du trait. Sans cela la ligne barre le mot.
