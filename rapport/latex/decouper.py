# -*- coding: utf-8 -*-
"""Decoupe rapport.pdf en cinq fascicules.

    python rapport/latex/decouper.py

Les bornes ne sont pas ecrites en dur : le script relit le PDF, y cherche les
pages qui s'ouvrent sur « CHAPITRE n : » et sur « CONCLUSION GENERALE », et en
deduit les coupures. Il reste donc juste apres n'importe quelle recompilation
qui deplacerait la pagination.

Decoupage demande :
    1. de la dedicace a la fin du chapitre 1
    2. chapitre 2
    3. chapitre 3
    4. chapitre 4
    5. le reste : conclusion, perspectives, references, annexes, table des matieres
"""
import os
import re
import sys

import pymupdf

DOSSIER = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(DOSSIER, "rapport.pdf")
SORTIE = os.path.join(DOSSIER, "parties")


def premiere_page(doc, motif):
    """Numero (base 1) de la premiere page dont le texte commence par motif."""
    for i in range(doc.page_count):
        tete = " ".join(doc[i].get_text().split())[:80].upper()
        if tete.startswith(motif):
            return i + 1
    raise SystemExit("repere introuvable dans le PDF : %s" % motif)


doc = pymupdf.open(SOURCE)
ch2 = premiere_page(doc, "CHAPITRE 2 :")
ch3 = premiere_page(doc, "CHAPITRE 3 :")
ch4 = premiere_page(doc, "CHAPITRE 4 :")
fin = premiere_page(doc, "CONCLUSION G")

parties = [
    ("dedicace-a-chapitre-1", 1, ch2 - 1,
     "Dedicace, remerciements, sigles, resume, abstract, listes, sommaire, "
     "introduction generale et chapitre 1"),
    ("chapitre-2", ch2, ch3 - 1, "Chapitre 2 : methodologie de l'etude"),
    ("chapitre-3", ch3, ch4 - 1,
     "Chapitre 3 : site de l'etude, donnees et resultats"),
    ("chapitre-4", ch4, fin - 1,
     "Chapitre 4 : diagnostic et intervention proposee"),
    ("reste-du-rapport", fin, doc.page_count,
     "Conclusion generale, perspectives, references, annexes, table des matieres"),
]

if not os.path.isdir(SORTIE):
    os.makedirs(SORTIE)

titre = doc.metadata.get("title") or "Rapport de fin d'etudes"
auteur = doc.metadata.get("author") or ""

print("rapport.pdf : %d pages" % doc.page_count)
total = 0
for nom, debut, arret, description in parties:
    part = pymupdf.open()
    part.insert_pdf(doc, from_page=debut - 1, to_page=arret - 1)
    part.set_metadata({"title": "%s - %s" % (titre, description),
                       "author": auteur})
    chemin = os.path.join(SORTIE, nom + ".pdf")
    part.save(chemin, garbage=4, deflate=True)
    part.close()
    n = arret - debut + 1
    total += n
    print("  %-26s pages %3d a %3d  (%2d pages, %6d octets)"
          % (nom + ".pdf", debut, arret, n, os.path.getsize(chemin)))

if total != doc.page_count:
    print("ATTENTION : %d pages reparties pour %d pages source"
          % (total, doc.page_count))
else:
    print("Total : %d pages, aucune page perdue ni dupliquee." % total)
