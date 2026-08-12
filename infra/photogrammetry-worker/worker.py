#!/usr/bin/env python3
"""
Worker de reconstruction photogrammétrique — MUSÉA.

RÔLE
    Tourne sur une instance GPU, réclame les campagnes prêtes, reconstruit un
    maillage texturé à partir des photos, dépose le modèle et met la campagne à
    jour. Puis s'éteint quand la file est vide — c'est ce qui rend la dépense
    proportionnelle au travail réel.

POURQUOI CE PROCÉDÉ, ET PAS UN AUTRE
    La reconstruction enchaîne deux étapes de nature différente :
      • SfM  (Structure-from-Motion) : retrouver la position de chaque caméra ;
      • MVS  (Multi-View Stereo)     : densifier, mailler, texturer.
    Meshroom (AliceVision) fait les deux et sort un OBJ TEXTURÉ, là où COLMAP
    seul rend un maillage à couleurs par sommet — visuellement pauvre sur un
    masque sculpté, où le décor peint porte l'essentiel de l'information.

CE QUI PEUT ÉCHOUER, ET CE QU'ON EN FAIT
    Une reconstruction rate pour des raisons légitimes : trop peu de
    recouvrement, objet uniforme sans point saillant, fond mouvant. On ne
    masque pas ces échecs — ils remontent dans `photogrammetry_jobs.erreur`,
    visibles par le conservateur, qui saura refaire la campagne autrement.

Variables d'environnement attendues :
    SUPABASE_URL              https://<ref>.supabase.co
    SUPABASE_SERVICE_KEY      clé de service (JAMAIS la clé publique)
    MUSEA_IDLE_SHUTDOWN       minutes d'inactivité avant extinction (0 = jamais)
    MUSEA_MESHROOM_IMAGE      image Docker (défaut : alicevision/meshroom:2023.3.0)
    MUSEA_WORKDIR             répertoire de travail (défaut : /var/musea)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------- Réglages --
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
IDLE_SHUTDOWN_MIN = int(os.environ.get("MUSEA_IDLE_SHUTDOWN", "20"))
MESHROOM_IMAGE = os.environ.get("MUSEA_MESHROOM_IMAGE", "alicevision/meshroom:2023.3.0")
WORKDIR = Path(os.environ.get("MUSEA_WORKDIR", "/var/musea"))

INTERVALLE_SONDAGE = 30       # secondes entre deux interrogations de la file
BUCKET_CAPTURES = "captures"
BUCKET_MODELES = "modeles"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("musea.worker")


class ErreurWorker(RuntimeError):
    """Échec attribuable à la campagne, à remonter au conservateur."""


# ------------------------------------------------------------ Supabase -----
def _entetes() -> dict[str, str]:
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def rpc(nom: str, params: dict[str, Any] | None = None) -> Any:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{nom}",
        headers=_entetes(),
        json=params or {},
        timeout=60,
    )
    r.raise_for_status()
    return r.json() if r.text else None


def telecharger_photo(chemin: str, vers: Path) -> None:
    # Bucket privé : on passe par l'API authentifiée, pas par une URL publique.
    r = requests.get(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET_CAPTURES}/{chemin}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
        timeout=120,
    )
    r.raise_for_status()
    vers.write_bytes(r.content)


def televerser_modele(chemin: str, fichier: Path, mime: str) -> str:
    with fichier.open("rb") as f:
        r = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET_MODELES}/{chemin}",
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": mime,
                # Une reprise de campagne doit écraser le modèle précédent,
                # sinon on accumule des fichiers que plus rien ne référence.
                "x-upsert": "true",
            },
            data=f,
            timeout=900,
        )
    r.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_MODELES}/{chemin}"


# ----------------------------------------------------------- Traitement ----
def lancer(cmd: list[str], cwd: Path | None = None, minutes: int = 180) -> None:
    log.info("→ %s", " ".join(cmd[:6]) + (" …" if len(cmd) > 6 else ""))
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, timeout=minutes * 60
    )
    if proc.returncode != 0:
        # Les dernières lignes portent la cause ; l'intégralité du journal
        # Meshroom ferait plusieurs milliers de lignes en base.
        queue = (proc.stderr or proc.stdout or "").strip().splitlines()[-12:]
        raise ErreurWorker(f"{cmd[0]} a échoué : " + " | ".join(queue))


def reconstruire(dossier_images: Path, sortie: Path) -> Path:
    """Meshroom en conteneur. Renvoie le chemin de l'OBJ texturé."""
    sortie.mkdir(parents=True, exist_ok=True)
    lancer(
        [
            "docker", "run", "--rm", "--gpus", "all",
            "-v", f"{dossier_images}:/data/images:ro",
            "-v", f"{sortie}:/data/out",
            MESHROOM_IMAGE,
            "meshroom_batch",
            "--input", "/data/images",
            "--output", "/data/out",
        ],
        minutes=240,
    )
    objs = sorted(sortie.rglob("*.obj"), key=lambda p: p.stat().st_size, reverse=True)
    if not objs:
        raise ErreurWorker(
            "Meshroom n'a produit aucun maillage. Cause la plus fréquente : "
            "recouvrement insuffisant entre photos voisines, ou objet trop "
            "uniforme pour offrir des points saillants."
        )
    return objs[0]


def vers_glb(obj: Path, glb: Path) -> None:
    # obj2gltf (CesiumGS) : conversion fidèle des matériaux et des textures.
    lancer(["obj2gltf", "-i", str(obj), "-o", str(glb), "--binary"], minutes=30)
    if not glb.exists() or glb.stat().st_size == 0:
        raise ErreurWorker("La conversion en GLB n'a produit aucun fichier.")


def vers_usdz(glb: Path, usdz: Path) -> bool:
    """
    Conversion best-effort. Contrairement au GLB, elle n'est pas garantie :
    l'outillage USD sous Linux reste fragile et dépend de la version installée.
    Un échec ici ne doit PAS perdre la campagne — le GLB seul reste exploitable
    partout sauf en Quick Look iOS. On renvoie donc un booléen, pas une exception.
    """
    try:
        lancer(["usd_from_gltf", str(glb), str(usdz)], minutes=30)
        return usdz.exists() and usdz.stat().st_size > 0
    except Exception as e:  # noqa: BLE001 — on veut vraiment tout absorber ici
        log.warning("USDZ non produit (le GLB reste valable) : %s", e)
        return False


# ------------------------------------------------------------- Campagne ----
def traiter(job: dict[str, Any]) -> None:
    job_id = job["job_id"]
    tenant_id = job["tenant_id"]
    object_id = job["object_id"]
    photos: list[str] = job.get("photos") or []
    formats: list[str] = job.get("formats") or ["glb"]

    log.info("Campagne %s — objet %s — %s photos", job_id, object_id, len(photos))
    base = WORKDIR / f"job-{job_id}"
    images = base / "images"
    sortie = base / "out"
    if base.exists():
        shutil.rmtree(base)
    images.mkdir(parents=True)

    try:
        for i, chemin in enumerate(photos, 1):
            telecharger_photo(chemin, images / f"{i:04d}.jpg")
            if i % 20 == 0:
                log.info("  %s/%s photos récupérées", i, len(photos))

        obj = reconstruire(images, sortie)
        log.info("Maillage obtenu : %s (%.1f Mo)", obj.name, obj.stat().st_size / 1e6)

        glb = base / f"modele-{job_id}.glb"
        vers_glb(obj, glb)

        url_glb = televerser_modele(
            f"{tenant_id}/{object_id}/modele-{job_id}.glb", glb, "model/gltf-binary"
        )
        url_usdz = None
        if "usdz" in formats:
            usdz = base / f"modele-{job_id}.usdz"
            if vers_usdz(glb, usdz):
                url_usdz = televerser_modele(
                    f"{tenant_id}/{object_id}/modele-{job_id}.usdz",
                    usdz, "model/vnd.usdz+zip",
                )

        rpc("photogrammetry_terminer", {
            "p_job_id": job_id,
            "p_glb": url_glb,
            "p_usdz": url_usdz,
            "p_obj": None,
            "p_moteur": "meshroom",
        })
        log.info("Campagne %s terminée — %s", job_id, url_glb)

    except Exception as e:  # noqa: BLE001
        log.exception("Campagne %s en échec", job_id)
        try:
            rpc("photogrammetry_echouer", {"p_job_id": job_id, "p_erreur": str(e)[:1800]})
        except Exception:  # noqa: BLE001
            log.error("Impossible de signaler l'échec de la campagne %s", job_id)
    finally:
        # Une instance GPU a un disque modeste : 50 photos + maillage dense
        # remplissent vite plusieurs gigaoctets.
        shutil.rmtree(base, ignore_errors=True)


def eteindre() -> None:
    log.info("File vide depuis %s min — extinction.", IDLE_SHUTDOWN_MIN)
    subprocess.run(["sudo", "shutdown", "-h", "now"], check=False)


def main() -> int:
    if not SUPABASE_URL or not SERVICE_KEY:
        log.error("SUPABASE_URL et SUPABASE_SERVICE_KEY sont obligatoires.")
        return 2

    WORKDIR.mkdir(parents=True, exist_ok=True)
    log.info("Worker prêt. Sondage toutes les %s s.", INTERVALLE_SONDAGE)

    dernier_travail = time.monotonic()
    while True:
        try:
            # Remet en file ce qu'une instance spot reprise aurait laissé en
            # plan : sans cela, une campagne resterait « en cours » à jamais.
            rpc("photogrammetry_reprendre_abandonnes", {"p_apres_minutes": 180})

            job = rpc("photogrammetry_reclamer")
            if job:
                traiter(job)
                dernier_travail = time.monotonic()
                continue
        except requests.RequestException as e:
            # Une coupure réseau n'est pas une raison de s'éteindre.
            log.warning("Supabase injoignable (%s) — nouvelle tentative.", e)

        inactif_min = (time.monotonic() - dernier_travail) / 60
        if IDLE_SHUTDOWN_MIN and inactif_min >= IDLE_SHUTDOWN_MIN:
            eteindre()
            return 0
        time.sleep(INTERVALLE_SONDAGE)


if __name__ == "__main__":
    sys.exit(main())
