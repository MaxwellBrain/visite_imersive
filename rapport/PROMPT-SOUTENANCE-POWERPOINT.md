# Prompt à copier-coller dans Claude pour PowerPoint

> Copie **tout ce qui se trouve entre les deux lignes de tirets** ci-dessous et colle-le
> dans Claude depuis PowerPoint. Les quatre schémas et les cinq logos sont exportés en
> PNG dans `rapport/latex/figures/pour-slides/` : tu les insères toi-même dans les
> emplacements que Claude aura réservés (Claude dans PowerPoint ne peut pas lire tes
> fichiers locaux).

---

Tu es chargé de construire ma présentation de soutenance de fin d'études (Licence en
Génie Informatique). Crée un diaporama de **14 diapositives au format 16:9**, en
français, prêt à être projeté devant un jury universitaire.

## Règles de forme, valables pour toute la présentation

- **Palette** : bleu foncé `#1F4D78` (titres, bandeaux), bleu moyen `#2E74B5`
  (filets, accents), orange `#C55A11` (mise en relief ponctuelle, jamais plus d'un
  élément par diapositive), fond blanc cassé `#F7F9FC`, texte gris anthracite `#333333`.
- **Typographie** : titres en Calibri Light 32 pt gras, sous-titres 18 pt, corps de
  texte 16 à 18 pt, jamais en dessous de 14 pt. Aucune diapositive ne doit dépasser
  **6 puces**, et chaque puce fait **au maximum deux lignes**.
- **Mise en page** : privilégie systématiquement les blocs, les colonnes, les cartes
  de chiffres-clés et les frises plutôt que les listes à puces brutes. Une seule idée
  forte par diapositive.
- **Pied de page** sur toutes les diapositives sauf la première : « DASSI KAMGANG
  Max-Brian — Soutenance de Licence — 2025-2026 » à gauche, numéro de diapositive à droite.
- **Notes de l'orateur** : rédige pour chaque diapositive 4 à 6 phrases de commentaire
  oral dans le volet Notes, en français soutenu, à la première personne du pluriel.
- **Emplacements d'images** : partout où j'écris « RÉSERVER UN EMPLACEMENT IMAGE »,
  place un cadre image vide occupant la zone indiquée, avec une légende en dessous en
  italique 12 pt. Je collerai le PNG moi-même.
- **Interdiction absolue d'inventer** : n'ajoute aucun chiffre, aucune référence,
  aucune technologie qui ne figure pas dans le contenu ci-dessous.

---

## Diapositive 1 — Première de couverture

Reproduis la première de couverture du rapport, mais mise en page comme une
diapositive de titre (pas comme une page A4).

- **Bandeau supérieur**, trois colonnes, texte 10 pt gras centré :
  - Colonne gauche : « UNIVERSITÉ DE YAOUNDÉ I / ÉCOLE NATIONALE SUPÉRIEURE
    POLYTECHNIQUE DE YAOUNDÉ / DÉPARTEMENT DE GÉNIE INFORMATIQUE / INSTITUT SUPÉRIEUR
    KEYCE INFORMATIQUE & INTELLIGENCE ARTIFICIELLE »
  - Colonne centrale : RÉSERVER UN EMPLACEMENT IMAGE, carré de 2,5 cm (logo de
    l'Université de Yaoundé I)
  - Colonne droite : « UNIVERSITY OF YAOUNDE I / NATIONAL ADVANCED SCHOOL OF
    ENGINEERING OF YAOUNDE / DEPARTMENT OF COMPUTER ENGINEERING / HIGHER INSTITUTE
    KEYCE OF COMPUTER SCIENCE AND ARTIFICIAL INTELLIGENCE »
- **Cartouche du thème**, encadré de deux filets horizontaux bleu moyen, texte en
  italique gras bleu foncé 24 pt, centré :
  « Mise en place d'un système de visite immersive des musées : cas de la Fondation
  Jean Félicien Gacha »
- **Bloc central** :
  - « Rapport de fin d'études — Soutenance publique »
  - « Présenté et soutenu par : **DASSI KAMGANG Max-Brian** »
  - « En vue de l'obtention du Diplôme de Licence en Génie Informatique »
  - « Sous l'encadrement de : **M. GOUDJOU Blondon**, encadreur académique —
    **M. Adrien GHOMSI**, encadreur professionnel, Think Tank Fou'ndjem »
- **Bande basse** : RÉSERVER QUATRE EMPLACEMENTS IMAGE alignés horizontalement,
  hauteur 1,8 cm (logos ENSPY, IUGEE, KEYCE, et logo de la Fondation Jean Félicien
  Gacha, ce dernier précédé de la mention « Structure d'accueil »).
- **Ligne de bas de page** : « Année académique 2025-2026 — BAFOUSSAM, CAMEROUN ».

---

## Diapositive 2 — Plan de la présentation

Titre : « Plan de la présentation ». Présente huit entrées numérotées en deux
colonnes, sous forme de pastilles numérotées bleu moyen :

1. Contexte et cadre du stage
2. Déroulement du stage et tâches effectuées
3. Problématique de l'étude
4. Hypothèses et objectifs
5. État de l'art
6. Architecture de la solution
7. Difficultés rencontrées
8. Résultats, vérification des hypothèses et perspectives

---

## Diapositive 3 — Contexte et situation géographique

Titre : « Contexte de l'étude et situation géographique ». Deux colonnes.

**Colonne gauche — Le contexte mondial** (trois cartes de chiffres) :
- « **90 %** des musées du monde fermés durant la pandémie de COVID-19 (UNESCO, 2021) »
- « **85 à 90 %** du patrimoine matériel africain conservé hors d'Afrique
  (Sarr et Savoy, 2018) »
- « **Aucun** musée camerounais ne propose aujourd'hui de visite immersive »

**Colonne droite — Le terrain** (encadré) :
- Fondation Jean Félicien Gacha, organisation à but non lucratif de droit camerounais
- Bangoulap, arrondissement de Bangangté, **département du Ndé, région de l'Ouest, Cameroun**
- Domaines : culture, art, artisanat, éducation, développement communautaire
- Espaces d'exposition, ateliers de création, résidences d'artistes, espaces verts
- Structure d'accueil du stage : **Département Think Tank Fou'ndjem**, structure de
  réflexion et de recherche — cadrage intellectuel, et non commanditaire opérationnel

Ajoute en bas un bandeau orange fin : « Stage du 20 juin au 20 août 2026 —
Encadreur professionnel : M. Adrien GHOMSI ».

---

## Diapositive 4 — Déroulement du stage et tâches effectuées

Titre : « Déroulement du stage : neuf semaines, quatre phases ». Représente une
**frise chronologique horizontale** à quatre jalons, chacun avec sa période, son
intitulé et deux ou trois tâches :

1. **20 juin – 10 juillet — Immersion et cadrage** : accueil et visite complète des
   espaces ; observation de visites guidées ; étude de l'existant ; entretiens
   semi-directifs avec six membres du personnel ; questionnaire administré à
   42 visiteurs ; rédaction du cahier des charges.
2. **11 – 24 juillet — Socle de gestion** : conception de la base de données et
   cloisonnement par organisation ; back-office (musées, salles, œuvres, tarifs,
   médias) ; site public, catalogue, boutique, événements, livre d'or.
3. **25 juillet – 7 août — Restitution spatiale** : moteur de visite immersive à
   360 degrés et éditeur de parcours ; numérisation en trois dimensions ; réalité
   augmentée ; génération des codes QR ; couverture Android et iOS.
4. **8 – 20 août — Intelligence et industrialisation** : assistant conversationnel à
   ancrage documentaire ; rapprochement documentaire avec les collections ouvertes ;
   module de généalogie ; conteneurisation ; intégration et déploiement continus ;
   mise en ligne ; mesures de performance et de coût.

---

## Diapositive 5 — Problématique de l'étude

Titre : « Problématique : une vitrine que l'on regarde, un lieu que l'on ne visite pas ».

Présente d'abord **quatre limites relevées, chacune avec sa valeur de départ chiffrée**,
sous forme de quatre cartes en grille 2 × 2 :
- **Une visite passive** — aucun parcours reliant les espaces, aucune restitution à
  l'échelle. *Valeur de départ : 0*
- **Des objets isolés** — aucune mise en relation avec les collections extérieures.
  *Valeur de départ : 0 œuvre rattachée, 0 collection interrogée*
- **Aucune aide au visiteur** — question par courriel, réponse en **10 à 20 jours**,
  parfois sans réponse. *Valeur de départ : 0 % de réponses immédiates*
- **Un dispositif non transposable** — réécriture complète du code exigée pour une
  deuxième institution. *Valeur de départ : 1 seule institution servie*

Termine par un **encadré orange pleine largeur** contenant la question générale :
« Comment concevoir et réaliser une plateforme numérique unifiée capable d'offrir une
visite virtuelle en trois dimensions, de mettre en relation un réseau d'institutions
pour retrouver les œuvres apparentées, et d'assurer une assistance conversationnelle
fiable fondée sur les données réelles de la Fondation Jean Félicien Gacha ? »

---

## Diapositive 6 — Hypothèses de l'étude

Titre : « Hypothèses de l'étude ».

En haut, un bandeau bleu foncé — **Hypothèse générale** : « La mise en place d'une
plateforme numérique unifiée réunissant la restitution des espaces et des œuvres en
trois dimensions, le rapprochement documentaire avec les collections ouvertes, un
assistant conversationnel ancré sur la documentation de l'institution et une
architecture isolant les données de chaque organisation, permet de restituer à
distance l'essentiel de l'expérience de visite et d'élargir l'audience de la
Fondation au-delà de ses murs. »

En dessous, quatre colonnes numérotées — **hypothèses spécifiques**, formulées court :
1. **Restitution spatiale** — les panoramas à 360 degrés reliés entre eux, la
   présentation en 3D et la réalité augmentée procurent une perception des volumes et
   des dimensions que la photographie plate ne permet pas.
2. **Mise en relation** — le rapprochement automatique des notices avec les
   collections ouvertes identifie des œuvres apparentées et enrichit la valeur
   documentaire des pièces de Bangoulap.
3. **Ancrage documentaire** — un assistant qui ne répond qu'à partir des documents
   validés par la Fondation est plus exact et plus vérifiable, et réduit le risque
   d'affirmations inventées.
4. **Cloisonnement** — une architecture qui isole les données dès la base de données
   permet d'accueillir une institution sans modifier le code ni compromettre la
   confidentialité des autres.

---

## Diapositive 7 — État de l'art

Titre : « État de l'art : ce qui existe, et ce qui manque ». Trois blocs superposés.

**Au Cameroun** : une trentaine d'établissements muséaux ; là où une présentation en
ligne existe, elle se limite à des photographies accompagnées de notices. Le seul
travail de visualisation 3D documenté est un **projet pilote expérimental** conduit au
Musée national du Cameroun autour de l'exposition *Contact(s) Zone* (Blender et Unreal
Engine 5, jamais mis en service pour le public). Obstacles connus : moyens techniques
insuffisants, absence de formation, plans architecturaux manquants, précarité
financière, faible synergie entre institutions.

**À l'international** — un tableau à quatre lignes (Solution / Limite principale) :
- Google Arts & Culture — sélection à l'initiative de l'opérateur ; l'institution ne
  maîtrise ni sa présentation ni ses données ; aucun outil de gestion
- Matterport — matériel dédié coûteux ; données hébergées chez l'éditeur ; ni
  assistance conversationnelle ni gestion documentaire
- Kuula, Pano2VR — pas de base documentaire, pas de réalité augmentée, parcours isolé
  du reste du site
- Développement sur mesure — coût élevé, non réutilisable pour une autre structure

**Le constat qui fonde notre travail**, en bandeau orange : « Ces solutions traitent la
visite virtuelle comme un produit isolé, détaché de la gestion de l'institution et de
sa documentation. Aucune ne relie le parcours immersif à un inventaire, à une
billetterie, à une base de connaissances interrogeable ou à d'autres institutions. »

Ajoute une mention discrète en bas : « Collections ouvertes examinées : 9 — retenues :
5 (Metropolitan Museum of Art, Art Institute of Chicago, Cleveland Museum of Art,
Victoria and Albert Museum, Wikidata). »

---

## Diapositive 8 — Architecture générale de la plateforme

Titre : « Architecture générale de la plateforme MUSÉA ».

**RÉSERVER UN EMPLACEMENT IMAGE** occupant les deux tiers gauches de la diapositive,
légende : « Figure 3.2 — Architecture générale de la plateforme MUSÉA ».

Dans la colonne droite, quatre points de lecture courts :
- **Couche cliente** — dans le navigateur : site public, back-office, moteur de
  panorama WebGL, visionneuse 3D et réalité augmentée, moteur de relief 2.5D,
  encodeur de codes QR
- **Couche de services** — base PostgreSQL avec sécurité au niveau de la ligne,
  authentification, stockage de fichiers, et **12 fonctions serveur**
- **Couche de diffusion** — stockage d'objets privé, chiffré, versionné, servi par un
  réseau de distribution mondial
- **La règle jamais enfreinte**, en orange : « Aucune clé d'accès à un service tiers
  ne se trouve dans le navigateur. »

---

## Diapositive 9 — Architecture de l'agent conversationnel (RAG)

Titre : « Comment l'agent conversationnel répond : l'ancrage documentaire ».

**RÉSERVER UN EMPLACEMENT IMAGE** pleine largeur dans la moitié supérieure, légende :
« Figure 3.3 — Architecture de l'assistant conversationnel à ancrage documentaire (RAG) ».

Dans la moitié inférieure, une frise à cinq étapes numérotées, une ligne chacune :
1. **Ingestion** — notices d'œuvres, descriptions de salles, histoires des musées,
   biographies, FAQ, déposées dans un stockage d'objets : rien de ce qui n'y figure
   pas ne peut fonder une réponse
2. **Découpage et vectorisation** — fragments homogènes, plongés **en anglais**
3. **Indexation** — colonne vectorielle de **dimension 384**, index **HNSW** en
   distance cosinus
4. **Recherche et augmentation** — garde-fous, restriction au musée ou à la salle,
   récupération des fragments les plus proches
5. **Génération contrôlée** — interdiction d'énoncer un fait absent des fragments,
   citation de l'institution et du numéro d'inventaire, **autorisation explicite de
   dire « je ne sais pas »**

Ajoute un encadré orange sur le côté : « Mesure décisive : en anglais, les
correspondances légitimes atteignent au moins **0,898** contre au plus **0,779** pour
le bruit — une étendue de 0,20 contre 0,13 en français. »

---

## Diapositive 10 — Architecture cloud

Titre : « Architecture de l'infrastructure d'hébergement en nuage ».

**RÉSERVER UN EMPLACEMENT IMAGE** occupant les deux tiers gauches, légende :
« Figure 3.4 — Architecture de l'infrastructure d'hébergement en nuage (d'après la
description Terraform du projet) ».

Colonne droite, trois blocs :
- **Chemin du visiteur** : Route 53 résout le domaine principal et le sous-domaine de
  chaque institution → CloudFront sert le contenu sous certificat ACM → seul
  CloudFront peut lire le compartiment Amazon S3
- **Chemin de la livraison** : GitHub Actions construit l'image et la dépose sur
  Docker Hub et Amazon ECR, en se présentant à IAM avec un **jeton de courte durée**
  plutôt qu'une clé permanente
- **Services de support** : Secrets Manager, SES, CloudWatch et SNS. Hors du nuage
  AWS, Supabase porte la base de données, l'authentification et les fonctions serveur

En bas, un bandeau orange : « **19 ressources créées sur les 29 décrites** : le réseau
privé virtuel, le répartiteur de charge et les exécutions conteneurisées ECS Fargate
et EKS sont écrits et validés, mais délibérément non appliqués — un site statique n'en
a pas besoin. Coût récurrent mesuré : **730 FCFA par mois**. »

---

## Diapositive 11 — Difficultés rencontrées lors de l'implémentation

Titre : « Difficultés rencontrées lors de l'implémentation ». Quatre cartes en grille
2 × 2, chacune avec un titre gras, le problème puis, en bleu moyen, la réponse apportée.

1. **Un format 3D imposé par Apple** — l'application de modélisation ne produisait que
   de l'USDZ, que ni les navigateurs ni les appareils Android ne lisent : la moitié du
   public visé n'aurait rien vu. → *Étape de conversion vers le GLB ; chaque œuvre
   dispose désormais de ses deux versions.*
2. **Les sous-domaines par institution** — la difficulté qui a demandé le plus de
   tentatives : certificat couvrant le domaine et tous ses sous-domaines via ACM,
   enregistrements génériques dans Route 53, et validation par le DNS public qui reste
   en attente puis expire sans message explicite tant que la délégation n'est pas
   effective. → *Montage finalement obtenu et en service.*
3. **Quatre collections inaccessibles** — Europeana, Rijksmuseum, Smithsonian et
   Harvard Art Museums exigent une clé que nous n'avons pu obtenir. → *Le rapprochement
   porte sur 5 sources et non 9, ce qui minore le nombre d'œuvres apparentées trouvées.*
4. **Comparaison sur le texte, non sur l'image** — faute de processeur graphique, les
   plongements ont été calculés sur les descriptions écrites. → *Deux objets semblables
   mais décrits différemment peuvent échapper au rapprochement : c'est la première
   perspective du travail.*

---

## Diapositive 12 — Résultats obtenus

Titre : « Résultats : la situation avant et après la mise en service ».

Construis un **tableau à trois colonnes** (Ce qui est mesuré / Avant / Après), en-tête
bleu foncé sur texte blanc, lignes alternées. Mets en gras les quatre lignes marquées :

| Ce qui est mesuré | Avant | Après |
|---|---|---|
| **Délai de réponse à une question de visiteur** | **10 à 20 jours**, parfois sans réponse | **Immédiat** |
| Questions ayant reçu une réponse | — | 60 sur 70 (85,7 %) |
| Questions sans réponse, rendues actionnables | 0 | 10, en 8 thèmes |
| Espaces parcourables en continu à distance | 0 | Parcours à 360° reliant les salles |
| Œuvres examinables sous tous les angles | 0 | 3 |
| Espaces posables à leur taille réelle en réalité augmentée | 0 | Sur iOS et Android |
| Collections extérieures interrogées | 0 | 5 |
| Œuvres apparentées identifiées à l'étranger | 0 | 41, dans 137 pays |
| Inventaire structuré derrière le site | Aucun | Base de 51 tables |
| Tables protégées par une règle de sécurité | 0 | 51 sur 51 |
| **Institutions servies par le dispositif** | **1** | **6** |
| **Code à modifier pour accueillir une institution** | **Réécriture complète** | **Aucune ligne** |
| Coût récurrent mensuel de l'hébergement | — | 730 FCFA |

---

## Diapositive 13 — Vérification des hypothèses

Titre : « Vérification des hypothèses ». Cinq lignes, chacune avec une pastille de
statut colorée à droite (vert pour « Confirmée », orange pour « Confirmée sous réserve ») :

- **Spécifique 1 — Restitution spatiale** : parcours à 360°, examen sous tous les
  angles, espaces restitués à l'échelle sur iOS et Android. → **Confirmée**, avec la
  précision que trois dispositifs distincts sont requis, la perception des dimensions
  n'étant obtenue que par la réalité augmentée.
- **Spécifique 2 — Mise en relation** : 5 collections interrogées, 41 œuvres
  apparentées, meilleur score 90/100, 137 pays. Gain de la reformulation mesuré :
  57 → 85. → **Confirmée**
- **Spécifique 3 — Ancrage documentaire** : filtrage en amont, restriction du
  périmètre, autorisation explicite d'ignorer ; l'assistant cite ses sources et
  déclare son ignorance. → **Confirmée**
- **Spécifique 4 — Cloisonnement** : 51 tables protégées sans exception par 101
  politiques de sécurité au niveau de la ligne ; accueil d'une institution sans
  modification du code. → **Confirmée**, la garantie devant être portée par la base
- **Hypothèse générale** : les quatre hypothèses spécifiques étant vérifiées et le
  dispositif étant en service. → **Confirmée sous réserve** : la restitution demeure
  tributaire de la production des médias par l'institution.

---

## Diapositive 14 — Conclusion, perspectives et remerciements

Titre : « Conclusion et perspectives ».

Trois colonnes de perspectives, titres courts et deux puces chacune :
- **Consolider** — comparer les œuvres sur l'image et non sur le texte, ce qui
  supprimerait la principale limite de la mémoire réunifiée ; obtenir les clés d'accès
  aux quatre collections écartées.
- **Enrichir** — ajouter les langues de l'Ouest camerounais, ghomálá', fe'efe'e et
  medumba, pour restituer le patrimoine aux communautés qui en sont issues ; mode hors
  connexion ; collecte des récits oraux.
- **Industrialiser** — passage aux conteneurs orchestrés puis à Kubernetes au-delà
  d'une dizaine d'institutions ; ouverture des données de la Fondation selon les mêmes
  standards que les catalogues qu'elle interroge.

Termine par un bandeau bleu foncé pleine largeur, texte blanc centré 28 pt :
« Merci de votre attention — Questions »

---

Une fois les 14 diapositives créées, vérifie et corrige si nécessaire : aucune
diapositive ne doit déborder de sa zone, aucun texte ne doit chevaucher un cadre
image, et la numérotation du pied de page doit être continue.

---

## Fichiers images à insérer toi-même

Tous dans `rapport/latex/figures/pour-slides/` :

| Diapositive | Fichier |
|---|---|
| 1 — logo Université de Yaoundé I | `logo-uy1.png` |
| 1 — logos du bas | `logo-enspy.png`, `logo-iugee.png`, `logo-keyce.png`, `logo-fondation.png` |
| 8 — architecture générale | `architecture-generale.png` |
| 9 — architecture RAG | `architecture-rag.png` |
| 10 — architecture cloud | `architecture-cloud.png` |
| *(en réserve)* chaîne CI/CD | `chaine-devops.png` |
