#!/usr/bin/env python3
# ============================================================================
# CARTES DE PROFONDEUR — le pipeline 2.5D, partie hors ligne
# ----------------------------------------------------------------------------
# Ce script tourne SUR VOTRE MACHINE (ou dans un Colab), pas sur Supabase :
# les Edge Functions n'exécutent ni Python ni PyTorch, et le modèle a besoin
# d'un GPU pour être rapide. C'est la seule partie du Cabinet qui ne peut pas
# vivre dans le navigateur.
#
#   pip install rembg pillow requests "transformers>=4.45" torch
#   export SUPABASE_URL=https://xxxx.supabase.co
#   export SUPABASE_SERVICE_KEY=...        # clé de service, JAMAIS versionnée
#   python scripts/profondeur.py --limite 20
#
# CE QU'IL FAIT, DANS CET ORDRE — et l'ordre compte
#
#  1. SEGMENTATION d'abord (rembg). Sans elle, le mur du musée d'origine part
#     en relief avec l'objet et le résultat est immonde. C'est l'erreur qu'on
#     voit dans toutes les démonstrations bâclées de ce procédé.
#  2. PROFONDEUR ensuite (Depth Anything V2 Small) : rapide, robuste, licence
#     permissive. Marigold rend plus fin mais est bien plus lent — à réserver
#     aux pièces mises en avant.
#  3. MASQUAGE de la carte par l'alpha de la segmentation, pour que le fond
#     reste STRICTEMENT plat. Une carte non masquée fait onduler le vide.
#  4. Envoi dans le bucket « profondeur » et rattachement à la notice.
#
# POURQUOI DU PNG 16 BITS
# Sur une surface lisse — une joue, une panse de calebasse —, 256 niveaux
# produisent des marches visibles (banding) une fois le maillage déplacé.
# ============================================================================

import argparse
import io
import os
import sys

import requests
from PIL import Image

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
BUCKET = "profondeur"

if not URL or not KEY:
    sys.exit("SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis.")

EN_TETES = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def a_traiter(limite):
    """Les notices qui ont une image mais pas encore de carte de profondeur."""
    r = requests.get(
        f"{URL}/rest/v1/objets_externes",
        headers=EN_TETES,
        params={
            "select": "id,source,source_id,image_url",
            "depth_map_url": "is.null",
            "image_url": "not.is.null",
            "limit": str(limite),
            "order": "id",
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def telecharger(url):
    r = requests.get(url, timeout=45, headers={"User-Agent": "MUSEA/1.0"})
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGBA")


def carte_profondeur(image_rgba, pipe):
    """Renvoie (carte 16 bits masquée, image détourée en RGBA)."""
    from rembg import remove

    # 1. Segmentation. `rembg` suffit sur des photos de musée à fond neutre ;
    #    passer à SAM 2 si vos images sont encombrées.
    detoure = remove(image_rgba)
    alpha = detoure.getchannel("A")

    # 2. Profondeur, sur l'image DÉTOURÉE aplatie sur du noir : le modèle ne
    #    doit pas raisonner sur un fond qu'on va jeter.
    fond_noir = Image.new("RGB", detoure.size, (0, 0, 0))
    fond_noir.paste(detoure, mask=alpha)
    brut = pipe(fond_noir)["depth"]          # PIL, 8 bits

    # 3. Masquage : hors de l'objet, profondeur nulle donc parfaitement plate.
    profond = brut.convert("I;16")
    px_p = profond.load()
    px_a = alpha.load()
    for y in range(profond.height):
        for x in range(profond.width):
            if px_a[x, y] < 12:
                px_p[x, y] = 0
    return profond, detoure


def envoyer(chemin, image, content_type="image/png"):
    tampon = io.BytesIO()
    image.save(tampon, format="PNG")
    tampon.seek(0)
    r = requests.post(
        f"{URL}/storage/v1/object/{BUCKET}/{chemin}",
        headers={**EN_TETES, "Content-Type": content_type, "x-upsert": "true"},
        data=tampon.read(),
        timeout=60,
    )
    r.raise_for_status()
    return f"{URL}/storage/v1/object/public/{BUCKET}/{chemin}"


def rattacher(externe_id, url):
    r = requests.post(
        f"{URL}/rest/v1/rpc/externe_carte_profondeur",
        headers={**EN_TETES, "Content-Type": "application/json"},
        json={"p_id": externe_id, "p_url": url},
        timeout=30,
    )
    r.raise_for_status()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=10)
    ap.add_argument("--modele", default="depth-anything/Depth-Anything-V2-Small-hf")
    args = ap.parse_args()

    from transformers import pipeline

    pipe = pipeline("depth-estimation", model=args.modele)

    lignes = a_traiter(args.limite)
    if not lignes:
        print("Rien à traiter : toutes les notices ont déjà leur carte.")
        return

    print(f"{len(lignes)} notice(s) à traiter.")
    for ligne in lignes:
        cle = f"{ligne['source']}-{ligne['source_id']}".replace("/", "_")
        try:
            image = telecharger(ligne["image_url"])
            profond, detoure = carte_profondeur(image, pipe)
            # On stocke AUSSI l'image détourée : le moteur WebGL s'en sert pour
            # ne pas dessiner le fond (il écarte les pixels dont l'alpha est
            # faible). Sans elle, l'objet resterait collé sur son rectangle.
            envoyer(f"{cle}-couleur.png", detoure)
            url = envoyer(f"{cle}-profondeur.png", profond)
            rattacher(ligne["id"], url)
            print(f"  ok   {cle}")
        except Exception as e:  # une notice qui échoue n'arrête pas le lot
            print(f"  ECHEC {cle} : {str(e)[:120]}")


if __name__ == "__main__":
    main()
