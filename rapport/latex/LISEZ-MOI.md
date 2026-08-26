# Rapport de fin d'études — sources LaTeX

## Compiler

Depuis ce dossier, trois passes (nécessaires pour le sommaire, la table des
matières, les listes de tableaux et de figures, et les renvois croisés) :

```bash
pdflatex rapport.tex && pdflatex rapport.tex && pdflatex rapport.tex
```

Ou, plus simplement, le script fourni :

```bash
bash compiler.sh
```

Compilateur installé sur ce poste : **MiKTeX 25.12**, à
`C:\Users\maxib\AppData\Local\Programs\MiKTeX\miktex\bin\x64`.
Si `pdflatex` n'est pas trouvé, ajouter ce dossier au `PATH`.

## Organisation des fichiers

| Fichier | Contenu |
|---|---|
| `rapport.tex` | Préambule (mise en forme, couleurs, styles) et assemblage |
| `sections/00-liminaires.tex` | Dédicace, remerciements, sigles, résumé, abstract, listes, sommaire |
| `sections/01-introduction.tex` | Introduction générale (contexte, problématique, hypothèses, objectifs, justification, délimitation, plan) |
| `sections/02-chapitre1.tex` | Chapitre 1 — Cadre conceptuel et état de l'art |
| `sections/03-chapitre2.tex` | Chapitre 2 — Méthodologie de l'étude |
| `sections/04-chapitre3.tex` | Chapitre 3 — Site de l'étude, données et résultats |
| `sections/05-chapitre4.tex` | Chapitre 4 — Diagnostic et intervention proposée |
| `sections/06-conclusion.tex` | Conclusion générale et perspectives |
| `sections/07-bibliographie.tex` | Références bibliographiques (norme APA) |
| `sections/08-annexes.tex` | Annexes 1 à 5 |
| `figures/` | Y déposer les images (vide pour l'instant) |

**La première de couverture et la page de garde ne sont pas incluses**, comme
demandé.

## Les schémas

**Les sept schémas sont dessinés, pas importés.** Chacun vit dans un fichier
TikZ de `figures/` et s'insère par `\schema{nom}` :

| Fichier | Figure | Sujet |
|---|---|---|
| `figures/scrumban.tex` | 2.1 | Le tableau Scrumban de conduite du projet |
| `figures/organigramme.tex` | 3.1 | Organigramme de la Fondation |
| `figures/architecture-generale.tex` | 3.2 | Les quatre couches de la plateforme |
| `figures/rag.tex` | 3.3 | L'assistant à ancrage documentaire |
| `figures/infrastructure-cloud.tex` | 3.4 | L'hébergement en nuage |
| `figures/devops-actuel.tex` | 3.5 | La chaîne CI/CD en service |
| `figures/devops-cible.tex` | 4.1 | La chaîne DevOps cible |

Pourquoi TikZ plutôt que des images : les schémas partagent la palette, la
typographie et l'épaisseur de trait du reste du document, restent vectoriels à
l'impression, et se corrigent dans le fichier source — un libellé faux se
change en une ligne, sans rouvrir un logiciel de dessin.

**Le vocabulaire graphique est commun aux sept schémas**, défini une seule fois
dans le préambule de `rapport.tex` (`\tikzset`) :

| Style | Sens |
|---|---|
| `bloc` (bleu clair) | composant ordinaire du système |
| `blocfort` (bleu plein) | point d'entrée ou de sortie : le visiteur, la direction, le développeur |
| `blocext` (contour orange) | service extérieur au projet |
| `blocgris` | réglage, note ou condition d'arrêt |
| `couche` (cadre pointillé) | regroupement logique, avec son titre |
| `flechecle` (orange) | lien qui transporte un secret |

Pour modifier un schéma, éditer son fichier et recompiler ; `\schema` réduit
automatiquement à la largeur du texte un dessin qui déborderait.

**Il reste quatre emplacements `\acapturer`** — des captures d'écran et des
pièces qui ne peuvent pas être dessinées et que vous devez fournir :

| Emplacement | Où | À fournir |
|---|---|---|
| Figure 3.6 | Chapitre 3 | Capture d'AWS Cost Explorer sur la période du stage (masquer l'identifiant de compte) |
| Figure 3.7 | Chapitre 3 | Capture du parcours de visite immersive côté visiteur |
| Annexe 4 | Annexes | Situation géographique de la Fondation |
| Annexe 5 | Annexes | Attestation de fin de stage |

Une fois l'image obtenue, la déposer dans `figures/` et remplacer la ligne
`\acapturer{...}{...}` par :

```latex
\includegraphics[width=0.9\textwidth]{figures/nom-du-fichier.png}
```

Le titre (`\caption`), l'étiquette (`\label`) et la source restent inchangés :
la numérotation et les renvois dans le texte suivent automatiquement.

## Conformité au guide KEYCE v3.0

| Exigence | État |
|---|---|
| Format A4 | ✔ |
| Marge gauche 3 cm, autres 2,5 cm | ✔ |
| Times New Roman 12 pt | ✔ — même police que le rapport BTS |
| Interligne 1,5 | ✔ |
| Tabulation de première ligne 1,25 cm | ✔ — valeur relevée dans le BTS |
| Paragraphes justifiés | ✔ |
| Numérotation des pages en bas à droite | ✔ — dans le cartouche orange |
| Liminaires en chiffres romains | ✔ |
| Titres de chapitre en majuscules et gras | ✔ |
| Numérotation `chapitre.ordre` des tableaux et figures | ✔ |
| Titre **au-dessus** des tableaux | ✔ |
| Titre **en dessous** des figures | ✔ |
| Source citée sous chaque tableau et figure | ✔ |
| Rédaction à la première personne du pluriel | ✔ |
| Références bibliographiques APA, par ordre alphabétique | ✔ |
| Résumé de 300 à 400 mots + 5 mots clés | ✔ |
| Sommaire sur 2 pages au maximum | ✔ |
| Longueur du corps entre 30 et 60 pages | ✔ — **60 pages** ; document paginé jusqu'à 67 |

## Mise en forme reprise du rapport BTS

Relevée directement dans le fichier Word (`word/theme/theme1.xml`,
`word/footer1.xml`, `word/document.xml`) :

| Élément | Valeur du BTS | Appliqué |
|---|---|---|
| Police | Times New Roman | ✔ |
| Tabulation de paragraphe | 708 twips = 1,25 cm | ✔ |
| Bleu du thème (accent 1) | `#5B9BD5` | ✔ cadres de titre + en-têtes de tableau |
| Orange du thème (accent 2) | `#ED7D31` | ✔ filets et cartouche de page |
| Titres de niveau 1 | centrés, rectangle à coins arrondis | ✔ `\cadretitre` |
| **Tableaux** | style Word « Grille du tableau » : traits noirs 0,5 pt sur **tous** les bords et à l'intérieur | ✔ les 22 tableaux |
| En-tête de tableau | fond `#5B9BD5`, texte blanc gras | ✔ `\thead` |
| Lignes de total | fond gris `#F2F2F2` | ✔ |
| En-tête de page | thème en italique + **deux** filets orange (fin 1 pt puis épais 3 pt, 4 pt d'écart) | ✔ `\enteteregles` |
| Pied de page | **un** filet orange 1,5 pt, la mention en police sans empattement 11 pt (Calibri dans le BTS) et le numéro en 14 pt blanc dans un cartouche orange de 1,32 cm accroché sous le filet, à droite | ✔ `\piedbts` |

### Ce qui diffère volontairement du BTS

| Point | BTS | Ce rapport | Raison |
|---|---|---|---|
| Taille du texte | 14 pt | **12 pt** | Le guide KEYCE l'impose explicitement (« Times New Roman et la taille 12 ») |
| Marge gauche | 2,5 cm | **3 cm** | Le guide KEYCE l'impose |
| Découpage | Parties **puis** chapitres | **Chapitres seuls** | La structure de licence du guide ne prévoit pas de regroupement en parties : les pages « Première partie » et « Deuxième partie » ont été supprimées |

Pour changer le nom affiché en pied de page ou le thème en en-tête, modifier les
deux lignes en tête de `rapport.tex` :

```latex
\newcommand{\themerapport}{Mise en place d'un système de visite immersive …}
\newcommand{\auteurrapport}{DASSI KAMGANG MAX-BRIAN}
```

## Points à compléter ou à vérifier avant remise

### 1. Longueur : 67 pages paginées

La pagination en chiffres arabes va de la page 1 (introduction générale) à la
page 67 (dernière annexe), soit **67 pages**. Le corps proprement dit,
introduction générale à perspectives, fait **60 pages**, soit exactement le
plafond du guide.

**Écart avec la version précédente : +2 pages.** Elles viennent de la refonte du
chapitre 3 (voir § 7) : la présentation de l'entreprise a été raccourcie, mais
le nouveau sous-chapitre 3.1.3 sur le Département *Think Tank* Fou'ndjem, le
tableau 3.2 et les brèves lectures ajoutées sous chaque tableau (exigées par le
guide) pèsent davantage. Pour revenir à 65 pages, le gisement le plus simple est
le resserrement des vingt fonctionnalités F1 à F20 (§ 3.2.3).

La table des matières finale est désormais numérotée en chiffres romains, comme
le veut le guide : elle ne compte plus dans la pagination.

**Pour y parvenir, les contenus suivants ont été retirés**, conformément à votre
demande de supprimer l'UML et l'ingénierie logicielle :

| Retiré | Où | Motif |
|---|---|---|
| Section « Méthode d'ingénierie logicielle » (choix d'UML, tableau des 13 diagrammes, processus 2TUP, cycle en Y) | Chapitre 2 | Demande explicite |
| Section « Modélisation du système » (cas d'utilisation, classes, 2 diagrammes de séquence, modèle physique des données) | Chapitre 3 | Demande explicite |
| Section « Ancrage théorique » (recherche par la conception, modèle TAM) | Chapitre 1 | Facultative en licence selon le guide |
| Détails internes du moteur de panorama et de la chaîne 3D | Chapitre 3 | Trop technique |
| Annexes « Extrait de la description de l'infrastructure » et « Extrait de la chaîne d'intégration continue » | Annexes | Code source |
| Tableau récapitulatif des 20 fonctionnalités, diagramme de Gantt, graphique des attentes, tableau des approches, 3 captures d'écran, figure des quatre continuités | Chapitres 3 et 4 | Doublons avec le texte |

Les mentions d'UML et de 2TUP ont été retirées **partout** : résumé, abstract,
liste des sigles, chronogramme, acquis du stage, conclusions de chapitre et
conclusion générale. Les trois références bibliographiques devenues non citées
(Roques \& Vallée, Davis, OMG) ont été supprimées, conformément à l'APA.

**Ce qui a été conservé** : les vingt fonctionnalités restent décrites une à une
avec leur finalité, les quatre schémas que vous avez demandés (RAG, cloud,
DevOps actuel, DevOps cible), tous les tableaux de coûts et la totalité des
perspectives.

### 2. L'état de l'art sur le Cameroun : un point à connaître avant la soutenance

Le tableau 1.1 recense neuf établissements camerounais et leur mode de
présentation à distance. **Ce relevé est à confirmer sur le terrain** : il a été
établi à partir des pages publiques de ces musées et de l'article scientifique
cité ci-dessous.

Votre constat est exact, mais il appelle une nuance que le rapport énonce
explicitement, car un membre du jury pourrait la connaître. Keumoe et Blot
(2023), dans la revue *Humanités numériques*, rapportent **une initiative de
visualisation 3D conduite au Musée national du Cameroun** autour de l'exposition
temporaire *Contact(s) Zone*. Trois précisions la rendent inoffensive pour votre
argument, et le rapport les donne :

- c'était un **projet pilote de chercheurs**, pas une commande du musée ;
- la modélisation a été faite **sous Blender et Unreal Engine 5**, la
  photogrammétrie ayant été écartée faute de moyens ;
- le dispositif portait sur une **exposition temporaire** et **n'a jamais été
  mis en service pour le public**.

Ce même article confirme par ailleurs le reste de votre constat : aucun autre
musée camerounais n'a numérisé ses collections ni ne propose de visite
virtuelle, et il attribue cette situation au manque de moyens techniques, à
l'absence de formation du personnel et à la faible synergie entre institutions.
Écrire « aucun musée camerounais n'a jamais fait de 3D » aurait été attaquable ;
écrire « aucun ne le propose à ses visiteurs, le seul travail documenté étant
resté expérimental » est exact et se défend.

### 3. Informations à confirmer

| Élément | Où | À faire |
|---|---|---|
| Fiche d'identification de la Fondation | Tableau 3.1 | Deux lignes (**date de création**, **effectif**) attendent leur valeur : elles sont écrites en commentaire dans `sections/04-chapitre3.tex`, il suffit de retirer le `%` et de renseigner |
| Historique de la Fondation | § 3.1.2 | Vérifier et préciser les dates |
| Rôle du Département *Think Tank* Fou'ndjem | § 3.1.3 | Rédigé d'après les informations que vous avez fournies : à faire relire par M. GHOMSI |
| Orthographe « Fou'ndjem » | Tout le rapport | Retenue d'après votre note ; si la Fondation écrit « Foudjem », un remplacement global suffit |
| Organigramme | Figure 3.1 | Confirmer les pôles réels |
| Nom de l'encadreur académique | Remerciements | Vérifié : M. GOUDJOU Blondon (repris du rapport précédent) |
| Nom de l'encadreur professionnel | Remerciements, Tableau 3.1 | M. Adrien GHOMSI, Département *Think Tank* Fou'ndjem |

### 4. Chiffres de l'enquête à remplacer par les vôtres

Les effectifs suivants sont **des valeurs de travail** et doivent être remplacés
par vos relevés réels :

- 6 entretiens semi-directifs et 42 répondants au questionnaire (Tableau 2.2) ;
- profil des répondants (Tableau 3.5) et attentes exprimées (Tableau 3.6).

En revanche, **toutes les mesures techniques sont réelles** et proviennent du
projet : 38 tables, 12 fonctions serveur, 41 œuvres apparentées, score 90/100,
137 pays, 57 → 85 sur la reformulation, 0,898 / 0,779 sur les plongements,
18 fragments / 1,7 s, 29 ressources Terraform, 19 ressources créées,
45 × 52 × 45 cm et 835 sommets sur le modèle de démonstration.

### 5. Coûts

- Les trois montants que vous avez indiqués sont en place : machine 450 000,
  écran 100 000, iPhone 15 Pro 400 000 FCFA.
- Les autres postes matériels (disque, onduleur, éclairage, trépied) sont des
  estimations : **à ajuster**.
- **Les montants AWS (Tableau 3.9) sont une projection** fondée sur les tarifs
  publics pour un site statique. Les remplacer par le relevé réel de votre
  console *Cost Explorer*, et insérer la capture correspondante (Figure 3.6).
- Le coût total (Tableau 3.10) se recalcule à la main après ajustement, ainsi
  que les pourcentages cités dans les lectures qui suivent les tableaux 3.7,
  3.8 et 3.10.

### 6. Les figures

**Les sept schémas sont dessinés et en place** (voir « Les schémas » plus haut).
Il ne reste que **quatre captures à fournir** : figures 3.6 et 3.7, annexes 4
et 5. Ces quatre-là ne peuvent pas être dessinées : la première vient de votre
console AWS, la deuxième de la plateforme en fonctionnement, les deux dernières
du terrain et de la Fondation.

Vérifiez au passage que les schémas disent bien ce que vous voulez soutenir :
l'organigramme (les pôles réels de la Fondation) et la chaîne DevOps cible (les
services que vous comptez réellement mettre en œuvre) sont les deux qu'un jury
peut vous demander de justifier.

### 7. Refonte du chapitre 3 (août 2026)

Le chapitre 3 a été repris pour trois raisons : le cadre du titre débordait, la
présentation de l'entreprise était trop longue, et le rôle du Département
*Think Tank* Fou'ndjem n'était pas exposé.

**Le cadre de titre.** `\cadretitre`, dans `rapport.tex`, imposait une hauteur
fixe de 1,15 cm : un titre de deux ou trois lignes sortait donc du rectangle
(chapitres 3 et 4). Cette hauteur est devenue un **plancher**
(`height from=1.15cm to 4.2cm`) : les cadres d'une seule ligne gardent tous
exactement la même taille, tandis qu'un titre long fait grandir le cadre. La
coupure des mots y est en outre interdite, ce qui supprime la césure
« FÉLI-CIEN » du chapitre 4.

**Le plan du chapitre**, conforme aux § 13 et § 14 du guide :

| Avant | Après |
|---|---|
| 3.1.1 Identification de la structure | 3.1.1 Identification de la structure |
| 3.1.2 Historique et évolution | 3.1.2 Historique, missions et organisation *(trois sous-chapitres fondus en un)* |
| 3.1.3 Missions et activités principales | — |
| 3.1.4 Organisation et fonctionnement | — |
| — | **3.1.3 Le Département *Think Tank* Fou'ndjem et son rôle dans le projet** *(nouveau)* |
| 3.1.5 Environnement technologique existant | 3.1.4 Environnement technologique existant |
| 3.1.6 Justification du choix du terrain | *fondue en fin de 3.1.5, en paragraphe* |
| 3.1.7 Déroulement du stage | 3.1.5 Cadre et déroulement du stage |

**Ce que dit le nouveau 3.1.3.** Le Département y est présenté comme la structure
de réflexion et de recherche de la Fondation, et **non comme le client
opérationnel** : il n'administre pas les collections, ne reçoit pas le public et
n'est pas l'utilisateur final de la plateforme. Son rôle a été celui d'un cadre
d'encadrement intellectuel et méthodologique ; c'est M. GHOMSI qui a proposé de
faire mûrir le thème pour en faire un sujet de fin d'études. Les trois
contraintes camerounaises — connectivité mobile instable, coût des données,
sécurité des données en environnement multi-institutions — sont explicitement
rattachées à trois choix techniques du projet. Le tableau 3.2 sépare le cadre
d'accueil du périmètre d'application.

**Autres corrections.**

- Une **brève lecture** a été ajoutée sous chaque tableau qui n'en avait pas
  (3.3, 3.4, 3.7, 3.8, 3.10, 3.11) : le guide l'exige au § 14.
- La conclusion du chapitre a été réécrite.
- L'orthographe **Fou'ndjem** a été appliquée à tout le rapport (remerciements,
  résumé, *abstract*, introduction, chapitres 2 et 3, conclusion, annexes) ;
  dans l'introduction, « cellule de réflexion et d'innovation » est devenu
  « département de réflexion et de recherche ».
- La version précédente du chapitre est conservée dans
  `sauvegardes/04-chapitre3-avant-refonte.tex`.
