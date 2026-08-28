#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ALLÈGEMENT D'UN .glb PHOTOGRAMMÉTRIQUE — réduction des textures embarquées.

    python scripts/alleger-glb.py entree.glb sortie.glb [--taille 2048] [--qualite 82]

POURQUOI CET OUTIL EXISTE

Un scan photogrammétrique sort avec des textures de 4096 x 4096 pixels, parfois
plusieurs. Sur la case obus mousgoum du projet « ancestor » : cinq atlas de
4096², soit 12,4 Mo de JPEG pour 60 546 triangles. Autrement dit, 92 % du poids
du fichier n'est pas de la géométrie — c'est de l'image, à une définition que
l'écran d'un téléphone ne peut pas restituer et que sa mémoire graphique paie
au prix fort (un atlas 4096² décompressé occupe 64 Mo en VRAM ; cinq, 320 Mo).

Ramener à 2048² divise le poids par quatre environ et la mémoire graphique par
quatre aussi, sans différence visible sur un bâtiment regardé à deux mètres à
travers une caméra de téléphone. C'est exactement la mesure faite ailleurs dans
le projet : la lenteur vient du VOLUME TRANSPORTÉ, pas du langage.

CE QUE L'OUTIL NE FAIT PAS

Il ne compresse pas la GÉOMÉTRIE (Draco, meshopt) : cela demande `gltf-transform`,
donc npm, hors service sur ce poste. Ici la géométrie ne pèse que 1,1 Mo — la
compresser ferait gagner quelques centaines de kilo-octets quand les textures en
font gagner neuf mille. On fait d'abord ce qui compte.

    npx @gltf-transform/cli optimize entree.glb sortie.glb --compress draco

COMMENT IL PROCÈDE

Un .glb est un en-tête, un bloc JSON qui décrit la scène, un bloc binaire qui
porte sommets et images. Changer la taille d'une image change la longueur de sa
« vue de tampon » (bufferView), donc le décalage de TOUTES les suivantes. On
reconstruit donc le bloc binaire d'un bout à l'autre, en recopiant chaque vue et
en réécrivant son décalage. Les vues sont recopiées telles quelles : on ne
touche ni à l'entrelacement des sommets ni au `byteStride`, qu'on ne comprendrait
qu'à moitié et qu'on casserait entièrement.
"""

import argparse
import io
import json
import struct
import sys

# La console Windows tourne en cp1252 : sans cette ligne, le moindre caractère
# hors table fait planter l'outil au moment d'afficher son résultat — après
# avoir fait tout le travail.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow est requis : python -m pip install Pillow")

MAGIC = 0x46546C67          # « glTF »
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def pad4(n):
    """Les blocs et les vues d'un .glb s'alignent sur quatre octets."""
    return (n + 3) & ~3


def lire_glb(chemin):
    donnees = open(chemin, 'rb').read()
    magic, version, _total = struct.unpack_from('<III', donnees, 0)
    if magic != MAGIC:
        sys.exit(f"{chemin} n'est pas un .glb (en-tête inattendu).")
    if version != 2:
        sys.exit(f"{chemin} est en glTF {version} ; seul le 2 est pris en charge.")

    gltf, binaire, pos = None, b'', 12
    while pos < len(donnees):
        taille, genre = struct.unpack_from('<II', donnees, pos)
        corps = donnees[pos + 8:pos + 8 + taille]
        if genre == CHUNK_JSON:
            gltf = json.loads(corps.decode('utf-8'))
        elif genre == CHUNK_BIN:
            binaire = corps
        pos += 8 + pad4(taille)

    if gltf is None:
        sys.exit(f"{chemin} ne contient pas de bloc JSON.")
    return gltf, binaire


def ecrire_glb(chemin, gltf, binaire):
    txt = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    # Le bourrage du bloc JSON se fait avec des ESPACES, celui du binaire avec
    # des zéros : un lecteur strict rejette l'inverse.
    txt += b' ' * (pad4(len(txt)) - len(txt))
    binaire += b'\x00' * (pad4(len(binaire)) - len(binaire))

    total = 12 + 8 + len(txt) + 8 + len(binaire)
    with open(chemin, 'wb') as f:
        f.write(struct.pack('<III', MAGIC, 2, total))
        f.write(struct.pack('<II', len(txt), CHUNK_JSON))
        f.write(txt)
        f.write(struct.pack('<II', len(binaire), CHUNK_BIN))
        f.write(binaire)
    return total


def recompresser(donnees, taille_max, qualite):
    """Redimensionne une image embarquée, en JPEG. Rend les octets d'origine
    si le résultat n'est pas plus petit — recompresser pour alourdir serait
    une régression silencieuse."""
    img = Image.open(io.BytesIO(donnees))
    largeur, hauteur = img.size
    if max(largeur, hauteur) > taille_max:
        f = taille_max / max(largeur, hauteur)
        # LANCZOS : sur une texture photographique, un rééchantillonnage
        # grossier fait « baver » les joints de terre, très visibles sur une
        # paroi de banco.
        img = img.resize((max(1, int(largeur * f)), max(1, int(hauteur * f))), Image.LANCZOS)

    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    tampon = io.BytesIO()
    img.save(tampon, format='JPEG', quality=qualite, optimize=True, progressive=True)
    sortie = tampon.getvalue()
    return (sortie, img.size) if len(sortie) < len(donnees) else (donnees, (largeur, hauteur))


def main():
    ap = argparse.ArgumentParser(description="Allège un .glb en réduisant ses textures.")
    ap.add_argument('entree')
    ap.add_argument('sortie')
    ap.add_argument('--taille', type=int, default=2048,
                    help='côté maximal des textures, en pixels (défaut : 2048)')
    ap.add_argument('--qualite', type=int, default=82,
                    help='qualité JPEG, 1 à 95 (défaut : 82)')
    args = ap.parse_args()

    gltf, binaire = lire_glb(args.entree)
    vues = gltf.get('bufferViews', [])
    if not vues:
        sys.exit('Aucune vue de tampon : rien à faire.')

    # Quelles vues portent une image ? Les autres sont recopiées à l'identique.
    images_par_vue = {}
    for i, im in enumerate(gltf.get('images', [])):
        if 'bufferView' in im:
            images_par_vue[im['bufferView']] = i

    print(f"{args.entree} — {len(vues)} vues, {len(images_par_vue)} textures embarquées")

    nouveau = bytearray()
    gagne = 0
    for idx, vue in enumerate(vues):
        debut = vue.get('byteOffset', 0)
        brut = bytes(binaire[debut:debut + vue['byteLength']])

        if idx in images_par_vue:
            avant = len(brut)
            brut, taille = recompresser(brut, args.taille, args.qualite)
            gagne += avant - len(brut)
            print(f"  texture {images_par_vue[idx]} : "
                  f"{avant / 1048576:.2f} Mo -> {len(brut) / 1048576:.2f} Mo "
                  f"({taille[0]}x{taille[1]})")
            # Le type MIME peut changer si la source était en PNG.
            gltf['images'][images_par_vue[idx]]['mimeType'] = 'image/jpeg'

        # On aligne AVANT d'écrire : le décalage d'une vue doit être un multiple
        # de quatre, faute de quoi certains lecteurs refusent le fichier.
        while len(nouveau) % 4:
            nouveau.append(0)
        vue['byteOffset'] = len(nouveau)
        vue['byteLength'] = len(brut)
        nouveau.extend(brut)

    gltf['buffers'][0]['byteLength'] = len(nouveau)
    gltf['buffers'][0].pop('uri', None)

    avant = len(binaire)
    total = ecrire_glb(args.sortie, gltf, bytes(nouveau))
    print(f"\n{args.sortie}")
    print(f"  binaire : {avant / 1048576:.2f} Mo -> {len(nouveau) / 1048576:.2f} Mo "
          f"({gagne / 1048576:.2f} Mo gagnés sur les textures)")
    print(f"  fichier : {total / 1048576:.2f} Mo")


if __name__ == '__main__':
    main()
