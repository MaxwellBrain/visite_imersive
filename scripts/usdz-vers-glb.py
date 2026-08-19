#!/usr/bin/env python3
"""
USDZ → GLB — convertisseur pour les scans iPhone.

POURQUOI CE SCRIPT EXISTE
    Un iPhone (Object Capture, Polycam, Scaniverse…) produit du .usdz. Or
    AUCUN navigateur ne sait afficher ce format : c'est du Quick Look, une
    application système d'Apple. Le web, lui, lit du glTF/GLB.
    Sans conversion, un objet scanné à l'iPhone reste invisible dans MUSÉA
    partout ailleurs que sur un iPhone.

CE QU'IL FAIT
    Lit le maillage et ses textures, calcule les normales si elles manquent,
    et écrit un .glb autonome (géométrie + textures embarquées, aucun fichier
    annexe). Le résultat se dépose tel quel dans le champ « Modèle 3D ».

CE QU'IL NE FAIT PAS
    Pas d'animation, pas de scène à plusieurs objets, pas de matériaux
    complexes. Un scan photogrammétrique n'en a pas : c'est un maillage unique
    avec une texture de couleur, et c'est exactement ce cas qui est traité.

PRÉREQUIS
    pip install usd-core

USAGE
    python scripts/usdz-vers-glb.py mon-scan.usdz [sortie.glb]
"""

from __future__ import annotations

import json
import struct
import sys
import zipfile
from pathlib import Path

try:
    from pxr import Usd, UsdGeom, UsdShade
except ImportError:
    sys.exit("usd-core manquant. Installez-le :  pip install usd-core")


# --------------------------------------------------------------- géométrie --
def normales_lissees(points, indices):
    """
    Normales par sommet, pondérées par l'aire des triangles.

    On accumule le produit vectoriel NON normalisé de chaque triangle : sa
    longueur est proportionnelle à l'aire, si bien qu'une grande facette pèse
    davantage qu'une petite. Normaliser avant d'accumuler donnerait le même
    poids à un triangle minuscule qu'à un grand, et bosselerait la surface.
    """
    acc = [[0.0, 0.0, 0.0] for _ in points]
    for i in range(0, len(indices), 3):
        a, b, c = indices[i], indices[i + 1], indices[i + 2]
        pa, pb, pc = points[a], points[b], points[c]
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        vx, vy, vz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        for k in (a, b, c):
            acc[k][0] += nx
            acc[k][1] += ny
            acc[k][2] += nz
    out = []
    for n in acc:
        L = (n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5
        # Un sommet isolé ou dégénéré donnerait une longueur nulle : on lui met
        # une normale arbitraire mais VALIDE, glTF refusant un vecteur nul.
        out.append((n[0] / L, n[1] / L, n[2] / L) if L > 1e-12 else (0.0, 1.0, 0.0))
    return out


def lire_usdz(chemin: Path):
    stage = Usd.Stage.Open(str(chemin))
    if not stage:
        sys.exit(f"Ouverture impossible : {chemin}")

    meshes = [p for p in stage.Traverse() if p.IsA(UsdGeom.Mesh)]
    if not meshes:
        sys.exit("Aucun maillage trouvé dans ce fichier.")
    if len(meshes) > 1:
        print(f"  ! {len(meshes)} maillages — seul le premier est converti.")

    prim = meshes[0]
    mesh = UsdGeom.Mesh(prim)
    points = [tuple(p) for p in (mesh.GetPointsAttr().Get() or [])]
    counts = list(mesh.GetFaceVertexCountsAttr().Get() or [])
    idx = list(mesh.GetFaceVertexIndicesAttr().Get() or [])

    # Triangulation en éventail : un polygone à n côtés donne n-2 triangles.
    # Les scans sont déjà triangulés, mais un maillage retouché dans un autre
    # logiciel peut contenir des quads — les ignorer produirait des trous.
    tris, curseur = [], 0
    for c in counts:
        face = idx[curseur:curseur + c]
        curseur += c
        for k in range(1, c - 1):
            tris.extend((face[0], face[k], face[k + 1]))

    # Coordonnées de texture. Seule l'interpolation « vertex » est suivie ici :
    # c'est celle que produisent les scanners, et elle correspond 1:1 aux points.
    uvs = None
    for pv in UsdGeom.PrimvarsAPI(prim).GetPrimvars():
        if pv.GetPrimvarName() in ("st", "st0", "UVMap") and pv.Get():
            if pv.GetInterpolation() == UsdGeom.Tokens.vertex:
                uvs = [tuple(v) for v in pv.Get()]
            else:
                print(f"  ! UV en interpolation « {pv.GetInterpolation()} » — ignorées.")
            break

    normals = [tuple(n) for n in (mesh.GetNormalsAttr().Get() or [])]
    if len(normals) != len(points):
        normals = None

    # Textures : on récupère les chemins déclarés par le matériau.
    textures = {}
    try:
        mat = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
        if mat:
            for sh in Usd.PrimRange(mat.GetPrim()):
                shader = UsdShade.Shader(sh)
                if not shader or shader.GetIdAttr().Get() != "UsdUVTexture":
                    continue
                f = shader.GetInput("file").Get()
                if not f:
                    continue
                nom = Path(str(f.path)).name
                bas = nom.lower()
                role = ("color" if "color" in bas or "diffuse" in bas or "albedo" in bas
                        else "normal" if "normal" in bas
                        else "occlusion" if "occlusion" in bas or "_ao" in bas
                        else None)
                if role and role not in textures:
                    textures[role] = str(f.path).lstrip("./")
    except Exception as e:  # noqa: BLE001
        print("  ! matériau illisible :", e)

    return points, tris, uvs, normals, textures


def extraire_images(usdz: Path, chemins: dict[str, str]) -> dict[str, bytes]:
    """Un .usdz est une archive ZIP : les textures s'y lisent directement."""
    out = {}
    with zipfile.ZipFile(usdz) as z:
        noms = {n.lower(): n for n in z.namelist()}
        for role, rel in chemins.items():
            cle = rel.lower().lstrip("./")
            vrai = noms.get(cle) or next(
                (n for k, n in noms.items() if k.endswith(Path(cle).name.lower())), None)
            if vrai:
                out[role] = z.read(vrai)
            else:
                print(f"  ! texture {role} introuvable dans l'archive ({rel})")
    return out


# -------------------------------------------------------------------- GLB --
def aligner(b: bytearray, sur: int = 4, remplissage: bytes = b"\x00") -> None:
    while len(b) % sur:
        b += remplissage


def ecrire_glb(sortie: Path, points, tris, uvs, normals, images: dict[str, bytes]) -> None:
    tampon = bytearray()
    vues, accesseurs = [], []

    def ajouter_vue(donnees: bytes, cible=None) -> int:
        aligner(tampon)
        debut = len(tampon)
        tampon.extend(donnees)
        v = {"buffer": 0, "byteOffset": debut, "byteLength": len(donnees)}
        if cible:
            v["target"] = cible
        vues.append(v)
        return len(vues) - 1

    # POSITION — glTF EXIGE min/max sur cet accesseur : le moteur s'en sert pour
    # cadrer la caméra et tester la visibilité. Sans eux, model-viewer refuse.
    pos = b"".join(struct.pack("<3f", *p) for p in points)
    mins = [min(p[i] for p in points) for i in range(3)]
    maxs = [max(p[i] for p in points) for i in range(3)]
    accesseurs.append({"bufferView": ajouter_vue(pos, 34962), "componentType": 5126,
                       "count": len(points), "type": "VEC3", "min": mins, "max": maxs})

    nrm = normals or normales_lissees(points, tris)
    accesseurs.append({"bufferView": ajouter_vue(b"".join(struct.pack("<3f", *n) for n in nrm), 34962),
                       "componentType": 5126, "count": len(nrm), "type": "VEC3"})

    attributs = {"POSITION": 0, "NORMAL": 1}
    if uvs:
        # USD place l'origine des UV en bas à gauche, glTF en haut à gauche.
        # Sans cette inversion, la texture apparaît retournée verticalement —
        # défaut discret sur une surface unie, flagrant sur un décor peint.
        uvb = b"".join(struct.pack("<2f", u, 1.0 - v) for (u, v) in uvs)
        accesseurs.append({"bufferView": ajouter_vue(uvb, 34962), "componentType": 5126,
                           "count": len(uvs), "type": "VEC2"})
        attributs["TEXCOORD_0"] = 2

    idx_acc = len(accesseurs)
    accesseurs.append({"bufferView": ajouter_vue(struct.pack(f"<{len(tris)}I", *tris), 34963),
                       "componentType": 5125, "count": len(tris), "type": "SCALAR"})

    gltf_images, textures, materiau_tex = [], [], {}
    for role in ("color", "normal", "occlusion"):
        if role not in images:
            continue
        vue = ajouter_vue(images[role])
        gltf_images.append({"bufferView": vue, "mimeType": "image/jpeg"})
        textures.append({"source": len(gltf_images) - 1, "sampler": 0})
        materiau_tex[role] = len(textures) - 1

    pbr = {"metallicFactor": 0.0, "roughnessFactor": 1.0}
    if "color" in materiau_tex:
        pbr["baseColorTexture"] = {"index": materiau_tex["color"]}
    else:
        pbr["baseColorFactor"] = [0.8, 0.8, 0.8, 1.0]

    materiau = {"pbrMetallicRoughness": pbr, "doubleSided": True}
    if "normal" in materiau_tex:
        materiau["normalTexture"] = {"index": materiau_tex["normal"]}
    if "occlusion" in materiau_tex:
        materiau["occlusionTexture"] = {"index": materiau_tex["occlusion"]}

    gltf = {
        "asset": {"version": "2.0", "generator": "MUSEA usdz-vers-glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "scan"}],
        "meshes": [{"primitives": [{"attributes": attributs, "indices": idx_acc, "material": 0}]}],
        "materials": [materiau],
        "accessors": accesseurs,
        "bufferViews": vues,
        "buffers": [{"byteLength": len(tampon)}],
    }
    if textures:
        gltf["images"] = gltf_images
        gltf["textures"] = textures
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987,
                             "wrapS": 10497, "wrapT": 10497}]

    js = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    aligner(js, 4, b" ")      # le chunk JSON se complète avec des ESPACES
    aligner(tampon, 4)        # le chunk binaire avec des zéros

    with sortie.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(tampon)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(tampon), 0x004E4942))
        f.write(tampon)


def main() -> int:
    if len(sys.argv) < 2:
        return print(__doc__) or 2
    src = Path(sys.argv[1])
    if not src.exists():
        sys.exit(f"Introuvable : {src}")
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".glb")

    print(f"Lecture  : {src.name}")
    points, tris, uvs, normals, chemins = lire_usdz(src)
    print(f"  {len(points)} sommets · {len(tris)//3} triangles · "
          f"UV {'oui' if uvs else 'non'} · normales {'fournies' if normals else 'calculées'}")

    images = extraire_images(src, chemins) if chemins else {}
    if images:
        print("  textures : " + ", ".join(f"{k} ({len(v)//1024} Ko)" for k, v in images.items()))

    ecrire_glb(dst, points, tris, uvs, normals, images)
    print(f"Écrit    : {dst.name}  ({dst.stat().st_size/1048576:.2f} Mo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
