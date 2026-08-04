# MUSÉA — Document maître (vision, état mesuré, phases)

> **À lire en premier par toute IA ou tout développeur qui reprend le projet.**
> Ce fichier est le point d'entrée unique. Il remplace la lecture dispersée de
> `PLAN_EVOLUTION.md` (V1), `PLAN_V2_PLATEFORME.md` (V2) et `HANDOFF.md`, qui
> restent valables comme archives de détail.
>
> Dernière mise à jour : **2026-08-04**
> Langue de travail : **français**. Projet : `C:\Users\maxib\Desktop\visite_immersive`

---

## 0. Comment utiliser ce document

1. Lire §1 (vision) et §2 (état mesuré) — ne jamais supposer, tout y est vérifié.
2. Choisir une phase en §4. Chaque phase porte un statut ✅ / 🟡 / ⏳ et des lignes
   **RESTE** explicites avec les fichiers concernés.
3. Respecter §6 (pièges du poste) et §7 (conventions) — sinon on casse l'existant.
4. Mettre ce fichier à jour **en même temps que le code**. Un plan qui ment est pire
   que pas de plan : les cases doivent refléter le réel, pas les intentions.

---

## 1. Vision produit

**MUSÉA est une plateforme SaaS de patrimoine.** Une institution (chefferie, musée,
fondation, association) souscrit, obtient **son ERP** et **son site public**, et
gère seule ses collections, sa billetterie, sa boutique, ses visiteurs et ses e-mails.

**Domaine cible : `musea.nexacode.store`.** Chaque organisation vit sur
**`<slug>.musea.nexacode.store`** (ex. `bandjoun.musea.nexacode.store`), avec `/c/<slug>` conservé
comme repli local de développement.

### Les cinq promesses

| # | Promesse | Traduction technique |
|---|---|---|
| 1 | **Cloisonnement absolu** | Une organisation ne voit jamais les données d'une autre. RLS + `tenant_id` sur toutes les tables métier. |
| 2 | **Autonomie éditoriale** | L'admin modifie **tout** son site depuis l'ERP : marque, couleurs, images de fond, images et textes des pages de connexion/inscription. Rien en dur. |
| 3 | **Public propre à chaque organisation** | Un visiteur crée son compte sur le site du tenant 1 et devient **son** adhérent. L'admin ne contacte que ses adhérents. |
| 4 | **Mémoire réunifiée** | Retrouver, par IA, les objets frères dispersés dans les musées du monde — recherche en français, traduite et enrichie côté serveur. |
| 5 | **Visite immersive** | Vidéo/panorama 360 du musée → toucher un objet → 3D + AR + récit vocal → **lien vers la généalogie du chef**. C'est le cœur de la démonstration. |

### Le fil narratif (ce qui doit impressionner le jury)

> **objet → chef qui l'a possédé → chefferie → généalogie → autres objets de la lignée
> → où sont les objets frères dans le monde.**

Chaque écran doit permettre de continuer ce fil. Un objet qui ne mène nulle part est
un échec de conception, pas un manque de données.

---

## 2. État mesuré du projet (vérifié, pas supposé)

### Stack

Vue 3 `<script setup>` · Vite 5 · PrimeVue 4 · Pinia · Vue Router · vue-i18n 9
Supabase (Postgres 17 + Auth + RLS + Edge Functions) · D3 (généalogie) ·
`@google/model-viewer` (3D/AR) · **aucune dépendance ajoutable** (npm HS sur ce poste).

### Base de données — 38 tables (relevé du 2026-08-04)

`tenants` · `tenant_members` · `tenant_partnerships` · `slugs_reserves` ·
`profiles` · `site_settings` · `museums` · `sectors` · `objects` ·
`object_tariffs` · `object_rarity` · `object_siblings` · `object_views` ·
`personnages` · `genealogy_links` · `migrations_historiques` ·
`object_personnage` · `faq` · `guide_questions` · `voice_assistants` ·
`audio_tracks` · `ai_agent_config` · `tours` · `tour_scenes` · `scene_hotspots` ·
`quests` · `quest_steps` · `quest_progress` · `products` · `orders` ·
`order_items` · `user_access` · `subscription_plans` · `donation_tiers` ·
`events` · `reviews` · `campaigns` · `email_log`

### Edge Functions déployées (10)

| Fonction | JWT | Rôle | État |
|---|---|---|---|
| `guide-agent` | non | Guide IA ancré + **scopé musée/salle** | ✅ Groq actif |
| `campaign-ai` | oui | Rédaction de campagne (Groq, JSON) | ✅ |
| `send-email` | non | Resend, 5 gabarits dont `campagne` | ✅ (clé absente ⇒ `skipped`) |
| `tts` | non | ElevenLabs (voix par musée/secteur) | ⚠️ quota épuisé |
| `payment-create` | oui | CinetPay (init) | ⚠️ clés absentes |
| `payment-webhook` | non | CinetPay (vérif serveur) | ⚠️ non testé |
| `memory-search` | oui | Enrichissement FR→EN + synthèse sourcée | ✅ Groq actif |
| `setup-agent` | oui | **Installe l'organisation** par conversation (Groq + outils) | ✅ Groq actif |
| `object-ai` | non | Notices, SEO et **annonce WhatsApp** (Bedrock → Groq) | ✅ testé le 2026-08-04, répond via Groq (Bedrock non configuré) |
| `freres` | non | **Cabinet de comparaison** : requête structurée, plongements, jugement | 🟡 `requete` et `juger` testés en direct ; `plonger` jamais exercé avec une session personnel |
| ~~`sonde-embeddings`~~ | oui | Outil de mesure jetable — **neutralisé**, à SUPPRIMER depuis le tableau de bord | ⚠️ une version antérieure écrivait avec la clé de service |

> **`setup-agent` — le point de sécurité à ne jamais casser** : l'agent écrit avec le
> **jeton de l'appelant**, jamais avec la clé de service. La RLS s'applique donc comme
> si la personne cliquait elle-même : un agent détourné par une consigne malveillante
> ne peut rien écrire hors de son organisation — *la base refuse, pas le prompt*.
> Outils en liste blanche (créer musée/salle/œuvre/identité), aucune suppression,
> 5 tours et 40 créations au maximum.
>
> ⚠️ **Le récapitulatif du modèle n'est pas fiable** : en essai, l'agent a annoncé deux
> œuvres alors qu'une seule était enregistrée. L'interface affiche donc la liste
> `cree` renvoyée par le serveur (issue des insertions réellement acceptées) comme
> source de vérité, à côté du texte.

### Clés / secrets

| Secret | État |
|---|---|
| `GROK_API_KEY` | ✅ **fonctionne** (nom mal orthographié : Groq s'écrit avec un Q — le code lit `GROQ_API_KEY \|\| GROK_API_KEY`) |
| `GEMINI_API_KEY` | ❌ posée mais quota `limit: 0` (429) — projet Google sans palier gratuit |
| `ELEVENLABS_API_KEY` | ⚠️ posée, quota épuisé |
| `RESEND_API_KEY` | ❌ absente ⇒ e-mails tracés `desactive`, jamais bloquant |
| CinetPay, AWS | ❌ à connecter par l'utilisateur plus tard |

### Ce qui est réellement livré

- **V1 complet** : commerce (produits, commandes), billetterie QR (scan caméra),
  événements, livre d'or modéré, généalogie publique, dashboard, PWA.
- **Multi-tenant** : isolation RLS vérifiée dans les deux sens, 12 stores filtrés,
  back-office super-admin, deux fuites historiques corrigées (contenu payant
  inter-organisations, pass valable partout).
- **Mémoire réunifiée (V1)** : 5 collections + Wikidata interrogées en parallèle,
  notation explicable /100, **globe de dispersion SVG** écrit à la main (137 pays,
  0 dépendance). Mesure réelle : 41 objets frères, meilleure correspondance 90 %.
- **Assistant vocal V2** : voix ElevenLabs **par musée ET par secteur**, agent
  **scopé** (répond « en rapport avec ce lieu ») et **cultivé** (Groq).
- **Adhésions + campagnes e-mail** : `join_tenant`, écran « Mes visiteurs »,
  campagnes avec rédaction IA, ciblage opt-in, journal, désinscription.
- **Sous-domaines** : couche applicative complète (`src/services/host.js`).
- **Visite immersive 360** : moteur de panorama WebGL écrit à la main (aucune
  dépendance), points chauds cliquables, parcours public et éditeur ERP.
  ⚠️ **La migration `20260801_immersive_tours.sql` reste à exécuter** dans
  l'éditeur SQL de Supabase — sans elle, les écrans se chargent mais restent vides.

### Ce qui n'existe pas du tout (à ce jour)

- ❌ **Recherche IA avec traduction FR→EN et web** — `collectionsApi.js` est
  **lexical uniquement**, pas de traduction, pas de recherche web, pas de synthèse.
- ❌ **DevOps** — aucun `Dockerfile`, aucun `.github/`, aucun Terraform.
- ❌ **Généalogie « percutante »** — l'arbre D3 fonctionne mais reste austère.

---

## 3. Architecture multi-tenant (la règle qui prime sur tout)

```
                    musea.nexacode.store                 → vitrine plateforme + /inscription
            bandjoun.musea.nexacode.store                → site public du tenant « bandjoun »
    bandjoun.musea.nexacode.store/dashboard              → ERP du tenant « bandjoun »
```

**Résolution** (`src/services/host.js` → `parseHost()`), par ordre :

1. `subdomain` — `<slug>.musea.nexacode.store` → `resolveBySlug(slug)`
2. `custom` — domaine propre vérifié → `resolveByDomain(host)`
3. `reserved` — `www`, `api`, `admin`, `app`… → jamais une organisation
4. `local` / `platform` → repli `/c/<slug>`, sinon site historique

**Trois cercles d'identité — ne jamais les confondre :**

| Cercle | Table | Portée |
|---|---|---|
| **Super-admin** | `profiles.role = 'super_admin'` | Toute la plateforme. Approuve les organisations. |
| **Staff d'organisation** | `profiles.tenant_id` + `role = 'admin'` | **Son** ERP uniquement. |
| **Visiteur** | `tenant_members` (adhésion) | Compte MUSÉA global, adhère à 1..n organisations. |

**Règles non négociables :**

- Jamais `is_staff()` seul pour du contenu appartenant à une organisation →
  toujours **`can_manage_tenant(tenant_id)`**.
- Toute table exposée au public a une **RLS explicite**.
- Le trigger `set_tenant_id` rattache automatiquement à l'insertion : le code
  applicatif n'a pas à penser au `tenant_id`.
- Un visiteur n'est **jamais** `profiles.tenant_id` — il passe par `tenant_members`.

---

## 4. Phases

### Phase 1 — Souscription & adhésions ✅

- [x] `tenants` enrichie (~30 colonnes), `slugs_reserves`, `tenant_members` + RLS
- [x] RPC `join_tenant`, `my_memberships`, `tenant_audience`, `slug_available`
- [x] **`create_tenant` enrichie** (migration `create_tenant_rich_profile`) : accepte
      un `p_profil jsonb` appliqué **dans la même transaction** — pas d'organisation
      à moitié créée. **Liste blanche stricte** : statut, plan, quotas, domaine et
      notes internes restent hors de portée de l'inscrivant. Refuse aussi les slugs réservés.
- [x] **Formulaire de souscription en 4 étapes** (`views/platform/SignupView.vue`) :
      compte → identité (nom, type, slug vérifié en direct, sigle, année, description,
      site web) → coordonnées & responsable & administratif (pays, région, ville,
      adresse, responsable nom/fonction/e-mail/tél, registre, langue, devise) → confirmation.
      Seuls **nom + slug** sont obligatoires : le reste se complète depuis « Mon organisation ».
- [x] Adhésion automatique du visiteur (`join_tenant`) + écran ERP « Mes visiteurs »
      (`views/AudienceView.vue`, export CSV)

### Phase 2 — Sous-domaines `<slug>.musea.nexacode.store` ✅ (EN LIGNE)

- [x] `src/services/host.js` — `parseHost()`, `canonicalOrigin()`,
      `RESERVED_SUBDOMAINS`, domaine configurable via `VITE_PLATFORM_DOMAIN`
- [x] `usePublicTenantStore.resolveByHost()` + priorité hôte dans `PublicLayout`
- [x] `<link rel="canonical">` (préfixes `/c/:slug` et `/site` retirés) + garde de
      route : sur un hôte d'organisation, `/` mène au site du tenant
- [x] **AWS appliqué le 2026-08-02** — 19 ressources créées, site **en ligne** :
      | Vérification | Résultat |
      |---|---|
      | `https://musea.nexacode.store/` | **200** |
      | `https://musea.nexacode.store/site` | **200** (repli SPA) |
      | `https://bandjoun.musea.nexacode.store/` | **200** ← le joker fonctionne |
      | Certificat | valide (`ssl_verify_result=0`) |

      Zone Route 53 `nexacode.store` = `Z03037321AVZ4G6C1Z7E7` ·
      bucket `musea-production-007fc014` · distribution `E20HJ21DOVYTE2`.

      ⚠️ **Piège vécu, à ne pas refaire** : une *hosted zone* Route 53 peut être créée
      pour n'importe quel nom — ça ne prouve aucune possession. La première tentative
      visait `nexacode.space`, **domaine non enregistré** : ACM interroge le DNS
      **public**, recevait NXDOMAIN, et `aws_acm_certificate_validation` a expiré au
      bout de 30 min. Diagnostic : `nslookup -type=NS <domaine> 8.8.8.8` doit renvoyer
      les 4 serveurs `awsdns` **avant** tout `apply`. NXDOMAIN = non enregistré ;
      SERVFAIL = enregistré mais délégation cassée.

### Phase 3 — ERP : design & édition totale du site ✅

- [x] Tables refondues (en-tête collant, lignes aérées, montants tabulaires) — 9 vues
- [x] **Boutons d'action uniformisés** : ronds, taille identique, estompés au repos,
      révélés au survol de la ligne, toujours visibles sur mobile (`.row-actions`)
- [x] États vides titrés · système mutualisé dans `style.css` (`vi-stats`,
      `vi-toolbar`, `row-actions`, `cell-id`, `cell-thumb`, `vi-dot`)
- [x] Site éditable : `marque`, `marque_initiale`, `hero_image`, `login_image`,
      `login_titre`, `login_sous_titre` + 46 champs dans `site_settings`
- [x] **Les 3 derniers blocs figés sont éditables** (migration `site_settings_editable_blocks`) :
      colonnes **JSONB** `badges`, `bande_genealogie`, `bloc_pwa`. Choix du JSONB plutôt
      que 20 colonnes plates : ce sont des listes de rubriques dont le **nombre varie**
      sans migration. **`NULL` = textes par défaut (i18n)** → aucun site existant n'a bougé.
      Édition dans `SiteSettingsView.vue` (section « Blocs de la page d'accueil »,
      choix de l'icône, ajout/suppression de rubriques).
      *Vérifié : sans réglage → textes d'origine ; avec 2 badges + 2 avantages
      personnalisés → affichés, icônes comprises, nombre adapté.*
- [x] **Connexion dédupliquée**. `/login` portait un onglet « Créer un compte » qui
      fabriquait un compte **staff systématiquement refusé** (`signupPending`) — un
      cul-de-sac qui doublonnait `/inscription`. Supprimé.
- [x] **`/login` est une porte unique : visiteurs ET personnel.** Elle refusait
      auparavant tout compte non-staff — un visiteur aux identifiants pourtant valides
      était déconnecté de force avec « accès refusé ». Le compte n'était pas en cause,
      c'est la porte qui était mal étiquetée. Après authentification, `destination()`
      oriente : personnel → `/dashboard`, visiteur → `/site/compte`. La garde de route
      fait la même chose au retour de Google, où le rôle n'est connu qu'après coup.
- [x] **Créer une organisation a quitté `/login`** : c'est un acte commercial, sa place
      est sur la vitrine publique (`/`), qui porte déjà deux appels « Créer mon espace ».
- [x] **L'inscription visiteur se fait DANS la carte de connexion**, pas sur une page
      séparée : le même formulaire s'allonge de prénom, nom, pays et téléphone.
      *Vérifié : bascule sur `/login`, 4 champs ajoutés, 29 pays, retour possible.*
      ⚠️ Le rôle n'est jamais transmis par le client : `profiles.role` vaut `visitor`
      par défaut en base. Un compte créé ici **ne peut pas** devenir staff par accident —
      c'était précisément le défaut de l'ancien onglet supprimé.
- [x] Migration `profiles_visitor_fields` (appliquée le 2026-08-01) : colonnes
      `prenom`, `nom`, `pays`, `telephone`, et `handle_new_user()` étendue pour les
      recopier depuis les métadonnées d'inscription. Sans elles, on aurait demandé au
      visiteur des informations qui se perdent, et privé l'organisation de son fichier
      d'adhérents. `full_name` reste alimenté : plusieurs écrans le lisent.
- [x] **Le formulaire en double de `/site/compte` est supprimé.** `PublicAccount.vue`
      portait ses propres onglets Connexion/Inscription, son code par e-mail et son
      OAuth — un doublon complet de `/login`, d'aspect différent. Deux portes pour une
      même serrure. La page **reste** : c'est l'espace compte (pass, billets QR,
      commandes). Simplement, un visiteur non authentifié est renvoyé vers
      `/login?redirect=/site/compte`, et y revient une fois identifié.
      *Vérifié : redirection effective, plus aucun `.authbox`, zéro erreur console.*
      ⚠️ Ne pas supprimer la vue elle-même : elle est la destination du visiteur après
      connexion et la seule voie d'accès à ses billets.
- [x] Clés i18n mortes retirées : `tabSignUp`, `signupPending`, `fullNamePh`,
      `errNoAccess`, `otherIntents`, `intentOrg*`, `intentVisitor*`, plus **25 clés
      `account.*`** devenues orphelines (détectées par balayage des références réelles).

### Phase 4 — Campagnes e-mail assistées par IA ✅

- [x] `CampaignsView.vue` + `CampaignFormDialog.vue` + `useCampaignStore.js`,
      route `/campagnes`. Brouillon → envoi → bilan ; une campagne envoyée est figée.
- [x] Edge Function **`campaign-ai`** (Groq, sortie JSON). Prompt anti-hallucination :
      interdiction d'inventer date, horaire, tarif ou nom d'œuvre non fournis.
      *Vérifié : brief « exposition de masques Bamiléké » → objet + 3 paragraphes,
      aucune date inventée.*
- [x] Destinataires calculés par la base (`campaign_recipients` : adhérents actifs
      **opt-in**), journal `email_log`, **lien de désinscription**, contenu admin
      **entièrement échappé** (aucun HTML injectable).
- [ ] **RESTE (facultatif)** : poser `RESEND_API_KEY` pour l'envoi réel.

### Phase 5 — Recherche IA « Mémoire Réunifiée » ✅ (déployée et mesurée)

> **C'est ici que le projet gagne sa dimension recherche.**

- [x] **Edge Function `memory-search`** (Groq, clé serveur), deux actions :
      `enrichir` (requête FR → `termes_en, culture, pays, materiaux, periode,
      synonymes, note`) et `synthese` (bilan sourcé). Température 0,2 : en recherche
      documentaire on veut de la constance, pas de l'imagination.
- [x] **Déployée le 2026-08-01** sur `dvwwwlqrwwzfwxukyoxz`, `verify_jwt=true`.
      *Vérifiée en direct :* d'une description française sans culture ni pays indiqués
      (« masque éléphant de danse, perles cousues sur toile, société Kuosi »), elle
      déduit `culture: Bamileke`, `pays: Cameroon` et renvoie `elephant mask`,
      `Kuosi society mask`, `beaded mask` — sans inventer de terme vernaculaire.

**Mesure comparative du 2026-08-01** — mêmes 4 collections, même seuil de score :

| Requête | Résultats | Meilleur score |
|---|---|---|
| Saisie française brute | 16 | 57 |
| **Termes enrichis par l'IA** | **5** | **85** |

L'enrichissement **échange du rappel contre de la précision**. Il fait remonter
`Mask (mbap mteng): Elephant (aka)` — Cleveland, inv. 1985.1082 — et deux masques
éléphants du Met (inv. 2001.758.1, 1980.554.2). La saisie française ramenait surtout
du bruit. **C'est un résultat défendable en soutenance** : il montre que l'échec initial
venait du vocabulaire de catalogage, non d'un manque de données.
- [x] `collectionsApi.chercherFreres` accepte des **termes imposés** : les termes
      enrichis priment sur la saisie brute.
- [x] **Recherche documentaire hors musées** — `chercherReferences()` : Wikipédia
      (fr + en) et **Open Library**, sans clé, CORS vérifié. Tenue **séparée** des
      « frères » : ce sont des références, pas des objets ; les mêler fausserait la
      notation, le globe et le décompte. Point d'accroche `braveAdapter` documenté
      pour une recherche généraliste (nécessite une clé, donc une Edge Function).
      ⚠️ Jamais de moissonnage de Google : bloqué, fragile, juridiquement douteux.
      *Vérifié en direct : 10 références, dont « Les Bamiléké », Lecoq, 1953,
      « Le dynamisme Bamileke », Dongmo, 1981.*
- [x] Les termes sont essayés **un par un**, du plus précis au plus large. Les joindre
      en une requête unique ne renvoie rien : « Bamileke beadwork Cameroon » → 0,
      « Bamileke » → un ouvrage de 1953.
- [x] **Synthèse IA sourcée** : chaque affirmation cite musée + n° d'inventaire, dit
      « inventaire non communiqué » quand il manque, présente les scores comme des
      indices et non des preuves, et déclare son niveau de confiance. Le prompt
      autorise explicitement « aucune conclusion possible ».
- [x] **Affichage public** : « Cette pièce a N sœurs, dans X pays » sur la fiche
      objet, **uniquement** à partir des correspondances validées par le conservateur
      (`object_siblings.statut = 'valide'`), avec numéro d'inventaire et lien source.
- [ ] *(recherche, hors périmètre actuel)* Appariement **sémantique** CLIP via
      `transformers.js` — impossible ici : npm est hors service, donc aucune
      dépendance nouvelle. À reprendre sur une machine connectée.

### Phase 6 — Visite immersive, 3D & réalité augmentée 🟡 (livrée ; migration à exécuter)

> **Le cœur de la démonstration.** Le visiteur avance dans le musée, touche un
> objet, le voit en 3D, l'entend raconté, et remonte à la généalogie.

**Base de données** — migration `supabase/migrations/20260801_immersive_tours.sql`

- [x] `tours` · `tour_scenes` · `scene_hotspots`, trigger `set_tenant_id`, RLS
      complète. Publication en cascade : **musée + visite** publiés, sinon rien.
- [x] **Migration appliquée le 2026-08-01** sur le projet `dvwwwlqrwwzfwxukyoxz`.
      *Vérifié après coup : 3 tables, 6 politiques RLS, 3 triggers `set_tenant_id`.*

**Front**

- [x] `components/immersive/panorama.js` — moteur équirectangulaire **WebGL natif,
      zéro dépendance**. Pas de sphère maillée : un quadrilatère plein écran et un
      rayon calculé par pixel, donc aucun artefact de facettes. Images ramenées en
      puissance de deux pour autoriser `REPEAT` et **effacer la couture**.
- [x] `components/immersive/PanoramaViewer.vue` — souris, tactile, **pincement**,
      gyroscope (avec demande de permission iOS), clavier (flèches, +/−), inertie,
      plein écran, fondu entre salles. Les points chauds sont de **vrais `<button>`**
      positionnés en pourcentage : focus clavier et lecteurs d'écran conservés.
- [x] `views/public/PublicTour.vue` — enchaînement des salles, mini-carte, barre de
      progression, fiche flottante (photo, description, **3D/AR**, **« Écouter le
      guide »** avec la voix du secteur, **lien vers le chef**), fin de parcours.
- [x] ERP : `views/ToursView.vue` + `components/tours/SceneEditorDialog.vue` —
      salles à gauche, panorama au centre, réglages à droite ; **on pose une pastille
      en cliquant dans le panorama**, puis on choisit l'objet lié.
- [x] **Démo sans média** : `demoPanorama()` dessine une salle stylisée au vol
      (plafond, cimaise, alcôves éclairées, sol), teinte différente par salle. Le
      parcours est démontrable **avant** les prises de vue réelles du musée.

**Convention d'orientation** (partagée moteur ↔ points chauds — ne pas la casser) :
`yaw` 0° = centre de l'image, positif vers la **droite** ; `pitch` 0° = horizon,
positif vers le **haut**. La matrice de vue est `Ry(−yaw)·Rx(pitch)` : avec `Ry(+yaw)`
la caméra part à gauche quand les pastilles partent à droite. *Vérifié en banc d'essai :
projection ↔ dé-projection réciproques au centième de degré, couture ±180° franchie,
clic au centre de l'écran → cadrage courant exact.*

**Réalité augmentée « Retour au pays »** ✅

- [x] `components/immersive/ArViewer.vue` — `ar-scale="fixed"` : l'objet garde ses
      **dimensions réelles**, mesurées sur le maillage (`getDimensions()`), pas saisies
      à la main. Le mode « auto » laisserait l'agrandir et le propos tomberait à plat.
- [x] `views/public/PublicAr.vue` sur **`/site/ar/:id`** — page autonome, cible du QR.
      `/site/ar/demo` ouvre la pièce générée : la RA est démontrable sur base vierge.
- [x] **`services/glb.js`** — écrit un fichier `.glb` en mémoire (en-tête + JSON + BIN),
      géométrie de révolution. Deux pièces : tabouret royal 52 cm, récipient rituel 34 cm.
      *Vérifié : conteneur conforme, 835 sommets, dimensions mesurées 45 × 52 × 45 cm.*
- [x] **`services/qrcode.js`** — encodeur QR (octet, niveau M, versions 1-6, Reed-Solomon,
      choix du masque par pénalité). **C'est la clé de la soutenance** : la RA exige un
      téléphone, or on présente sur ordinateur. Le jury scanne, l'objet apparaît dans la
      salle. *Vérifié : 274 modules de service (compte exact de la norme), syndromes
      Reed-Solomon nuls, charge utile relue identique.*
- [x] `loading="eager"` — sans lui, `model-viewer` attend l'entrée dans le champ de
      vision ; sur une page dont la 3D est le sujet, ce report n'a pas de sens.
- [x] **HTTPS de développement** — `bash scripts/dev-cert.sh` puis **`npm run dev:phone`**.
      Sans contexte sécurisé, `navigator.xr` n'existe pas et le bouton RA ne peut pas
      s'afficher : `http://192.168.x.x` ne suffit donc jamais. Le certificat inclut
      l'IP du poste, à **régénérer à chaque changement de réseau**.
      ⚠️ Le HTTPS est **explicite, jamais automatique**. Première tentative : bascule
      dès que `certs/` existait — un certificat auto-signé fait alors échouer tout ce
      qui parle au serveur sans exception de sécurité (navigateur intégré, outils), et
      `npm run dev` cessait de fonctionner normalement. Le mode normal doit rester le
      mode normal : c'est `--mode phone` qui l'active.
      ⚠️ Git Bash convertit `/CN=…` en chemin Windows : `MSYS_NO_PATHCONV=1` obligatoire.
- [x] Repli honnête quand la RA est refusée : QR **uniquement sur ordinateur**, et sur
      téléphone un message qui nomme la cause (HTTP, iOS sans `.usdz`, ARCore absent).

**Couverture des appareils** — migration `20260801_object_ar.sql`

Trois colonnes ajoutées à `objects` pour que la RA marche partout **sans retouche**
une fois le site déployé :

| Colonne | Pourquoi elle est indispensable |
|---|---|
| `model3d_ios` (+ `_name`) | iOS ne fait de RA que par Quick Look, qui exige un `.usdz`. Un `.glb` ne sera **jamais** lu par un iPhone, quel que soit l'hébergement. |
| `ar_placement` | `floor` (tabouret) ou `wall` (masque). Sans lui, model-viewer suppose le sol et couche les masques par terre. |
| `ar_echelle` | Un scan exporté en centimètres arriverait cent fois trop grand. Facteur correctif, 1 = taille réelle. |

**Migration appliquée le 2026-08-01.** *Vérifié : 4 colonnes créées.* Elle efface aussi
les `model3d` en `blob:` hérités du bug corrigé — **mesuré avant application : 0 ligne
concernée**, le seul modèle 3D en base est une adresse valide et n'a pas été touché.
`useObjectStore` tolère l'absence de ces colonnes (une seule reprise sans elles,
avertissement en console) : ne pas avoir passé la migration ne bloque pas l'ERP.

| Plateforme | État |
|---|---|
| **Android + Chrome + ARCore** | ✅ y compris la pièce de démonstration |
| **iPhone / iPad** | ✅ **dès qu'un `.usdz` est chargé** sur l'objet (onglet Médias de l'ERP) |
| Android sans WebXR (repli Scene Viewer) | ✅ Les modèles de démonstration sont désormais des **fichiers statiques** (`public/modeles/*.glb`, générés par `node scripts/build-demo-models.mjs`) et non des URL `blob:`, que Scene Viewer — une application distincte qui télécharge le fichier — ne sait pas lire. |

- [ ] **RESTE (à vérifier sur téléphone)** : le décodage du QR par une caméra
      (`BarcodeDetector` est absent de Chrome/Windows, donc invérifiable ici) et le
      démarrage réel d'une session ARCore.

**Au déploiement AWS — ce qui doit être vrai pour que la RA fonctionne**

1. **HTTPS avec certificat valide** (ACM + CloudFront). WebXR n'existe pas hors
   contexte sécurisé : c'est le seul point vraiment bloquant, et il disparaît de
   lui-même avec un vrai domaine.
2. **Types MIME** sur S3/CloudFront : `.glb` → `model/gltf-binary`,
   `.usdz` → `model/vnd.usdz+zip`. Scene Viewer et Quick Look sont pointilleux là-dessus,
   alors que le navigateur, lui, tolère `binary/octet-stream`. Panne classique :
   la RA marche dans le navigateur et échoue en session.
3. **CORS** si les modèles sont servis depuis un autre domaine que le site
   (`Access-Control-Allow-Origin`). Inutile tant qu'ils sont dans `public/` ou en base.
4. Les modèles **ne doivent pas être derrière une authentification** : Scene Viewer et
   Quick Look téléchargent le fichier depuis une application externe, sans les cookies
   de session.

**Propositions restantes pour marquer le jury** (à arbitrer)

1. ✅ **« Retour au pays » en AR** — fait, voir ci-dessus.
2. ✅ **Le fil du chef** — fait : la fiche d'objet affiche « cet objet a appartenu à … »
   et mène à la lignée. Présent aussi sur la page RA.
3. **Guide vocal contextuel** — le guide sait **où** est le visiteur (scope musée/salle
   déjà implémenté) : qu'il commente la salle sans qu'on demande.
4. **Mur de la dispersion** — en fin de visite, animer le globe : « les 41 frères de vos
   objets sont ici ». L'écran de fin existe, il reste à y brancher le globe.
5. **Mode hors-ligne** — la PWA existe déjà ; il resterait à mettre les panoramas en cache.

### Phase 7 — Généalogie repensée ✅

- [x] **`services/genealogy.js`** — toute la logique en un point : normalisation des
      deux formes de données (camelCase du store, snake_case de Supabase), lignée,
      chemin de filiation, recherche, ordre des règnes. Trois copies de la même
      récursion vivaient auparavant dans trois vues.
- [x] Arbre **bidirectionnel** : ascendants à gauche, descendants à droite, la
      personne au centre. L'ancienne version ne montrait que les ancêtres, en lecture
      seule — on tournait en rond dès qu'on entrait par un objet du musée.
      *Vérifié : en recentrant sur un aïeul, ses 2 liens de descendance apparaissent
      là où l'ancien arbre affichait une feuille morte.*
- [x] **Recentrage au clic**, animé (transition CSS : `d3-transition` n'est pas
      installé), zoom fluide + « voir toute la lignée », couleur du trait selon le sens.
- [x] **Recherche instantanée** qui allume les cartes correspondantes dans l'arbre.
      *Vérifié : « tchamba » → 2 résultats, 2 cartes allumées.*
- [x] **Chemin de filiation entre deux personnes** (aïeul commun le plus proche),
      surligné en or. *Vérifié : Jean-Félicien Gacha → Ngo Tchamba → Mande Djamou,
      2 liens, 3 cartes et 2 traits surlignés.* Dire « aucun lien connu » est une
      réponse assumée, pas un échec.
- [x] **Frise chronologique des règnes** (`ReignTimeline.vue`) — l'arbre dit « qui
      descend de qui », pas « depuis quand ». Les fins non renseignées sont estimées
      à l'avènement du successeur, et **signalées par des hachures** plutôt que
      présentées comme des faits.
- [x] Fiche chef enrichie : **migrations historiques** (`pubMigrations`), objets liés,
      arbre navigable, lien vers la généalogie complète.
- [x] **Passerelle depuis la visite immersive** : objet → chef → lignée. L'adresse
      porte la personne au centre (`/genealogie?p=12`), donc un état est partageable.

### Phase 8 — DevOps & déploiement AWS ✅ (APPLIQUÉ — site en ligne le 2026-08-02)

> Voir **`DEPLOY.md`** pour la marche à suivre. Aucun identifiant n'est demandé
> ni stocké : tout se joue avec les accès de l'utilisateur, depuis son poste.

- [x] **`infra/`** — Terraform complet, **`terraform validate` passe**, 29 ressources :
      S3 privé (chiffré, versionné, purge à 30 j), CloudFront avec *Origin Access
      Control*, ACM `musea.nexacode.store` **+** `*.musea.nexacode.store`, Route 53 avec
      enregistrements **joker** — c'est lui qui fait exister `bandjoun.musea.nexacode.store`
      sans créer un enregistrement par organisation (Phase 2).
- [x] **Repli SPA** : `custom_error_response` 403 **et** 404 → `/index.html` en **200**.
      S3 répond 403 (pas 404) sur une clé absente quand le bucket est privé : les
      deux codes doivent être rattrapés. Sans cela, tout lien profond échoue au
      rafraîchissement — **et les QR codes de RA pointent vers `/site/ar/<id>`**.
- [x] **Durées de cache séparées** : `/assets/*` immuable un an (noms hachés),
      `/modeles/*` une semaine, `index.html` et **`sw.js` jamais** — un service
      worker mis en cache fige le site sur une version périmée pendant des jours.
- [x] **`.github/workflows/ci.yml`** : compilation + contrôles du bundle (présence
      des `.glb`, en-tête `glTF` valide, adresse Supabase réellement inscrite) et
      `terraform fmt` / `validate` sans aucun accès AWS.
- [x] **`.github/workflows/deploy.yml`** : publication en 4 passes, **types MIME
      explicites** pour `.glb` et `.usdz`, invalidation CloudFront, puis
      **vérification a posteriori du site en ligne** (code 200 sur lien profond,
      `content-type` du modèle 3D).
- [x] **`infra/oidc.tf`** — GitHub s'authentifie par **jeton OIDC de courte durée**,
      pas par clé AWS permanente. Le rôle est verrouillé sur un dépôt précis
      (`repo:proprietaire/depot:*`) et ne peut qu'écrire dans *ce* bucket et
      invalider *cette* distribution.
- [x] `Dockerfile` multi-étapes + `docker/nginx.conf` — voie alternative, et
      surtout moyen de **vérifier le comportement de production en local**
      (mêmes repli SPA, types MIME et en-têtes que CloudFront).
- [ ] **RESTE (utilisateur)** : `terraform apply`, déléguer le DNS chez le
      registrar, et déclarer les URL de redirection dans Supabase — sans quoi la
      connexion Google renvoie vers `localhost`.

⚠️ **Piège de calendrier** : un projet Supabase gratuit se met en pause après une
semaine sans trafic (deux des projets du compte le sont déjà). Déployer en avance
puis ne rien toucher jusqu'à la soutenance expose à une base endormie le jour J,
alors que le front fonctionnera parfaitement.

### Phase 8 bis — détail historique (rien n'existait avant le 2026-08-02)

- [ ] `Dockerfile` multi-étapes (build Vite → Nginx alpine) + `nginx.conf` avec
      **fallback SPA** et en-têtes de sécurité.
- [ ] `.github/workflows/ci.yml` : install → lint → build → (tests) → image.
- [ ] `.github/workflows/deploy.yml` : push image → déploiement, avec environnements
      séparés (`staging` / `production`) et secrets GitHub.
- [ ] **Terraform** : S3 + CloudFront (ou ECS Fargate), **Route 53 avec wildcard
      `*.musea.nexacode.store`**, certificat ACM `*.musea.nexacode.store` (région `us-east-1` pour CloudFront).
- [ ] Variables d'environnement par environnement, sauvegardes Supabase, journalisation.
- [ ] ⚠️ **Identifiants AWS à connecter par l'utilisateur plus tard** — préparer le
      terrain sans jamais demander de secrets.

### Phase 9 — « Petites mais utiles » ✅ (2026-08-04)

Trois améliorations dont la valeur tient à ce qu'elles font TOUTES SEULES : le
conservateur n'a rien à saisir, rien à consulter, rien à décider.

**9.1 — Mise en avant automatique des œuvres populaires**

- [x] `object_views` (une ligne par œuvre et par jour) + RPC `vue_oeuvre`
      (`SECURITY DEFINER` ; l'organisation se déduit de l'œuvre, jamais d'un
      paramètre) et `oeuvres_populaires`.
- [x] `marquerVue()` appelée à l'ouverture d'une fiche publique
      (`PublicObject.vue`) — silencieuse, jamais bloquante.
- [x] `PublicHome.vue` remplace la sélection éditoriale par le classement réel,
      **mais seulement au-dessus d'un seuil** (5 vues, 3 œuvres minimum).
      En dessous, trois clics ne font pas une tendance : on garde le choix humain.
- [x] Bloc « Ce que le public regarde » au tableau de bord de l'ERP.
- [x] ⚠️ **Faille corrigée le 2026-08-04** : `oeuvres_populaires` ne filtrait
      que sur `tenant_is_public()`, sans l'organisation affichée — l'accueil
      d'une chefferie pouvait mettre en avant l'œuvre d'une autre. Argument
      `p_tenant_id` ajouté (migration `oeuvres_populaires_cloisonnee_par_organisation`),
      renseigné systématiquement par le client.

**9.2 — Carte de partage WhatsApp**

- [x] `src/services/carte.js` — carte **1080×1080** dessinée au canvas, zéro
      dépendance : photo recadrée, nom, salle, marque, pastille 3D/AR et **QR**
      vers la fiche publique. Le carré est un choix : WhatsApp recadre tout ce
      qui ne l'est pas, et un 1200×630 perdrait le nom de l'œuvre.
- [x] Repli si le canvas est « teinté » par une photo d'un autre domaine :
      on redessine sans photo au lieu de laisser remonter la `SecurityError`.
- [x] Action `annonce` dans l'Edge Function `object-ai` (Bedrock → Groq) :
      message de 250 caractères, interdiction d'inventer un fait, le lien n'est
      **jamais** rédigé par le modèle mais ajouté après lui.
- [x] `ShareCardDialog.vue` — aperçu, message modifiable, partage natif (image)
      sur téléphone, `wa.me` + téléchargement sur ordinateur (WhatsApp Web
      n'accepte pas de pièce jointe par lien : on le dit au lieu de le taire).
      Accessible depuis la liste des œuvres et depuis la fiche.

**9.3 — Ce que les visiteurs demandent (statistiques du guide)**

- [x] `guide_questions` + RPC `journaliser_question` — anonyme (aucune identité,
      aucune IP, aucune session), organisation déduite du contexte.
- [x] `src/services/lacunes.js` — classement des questions sans réponse en
      **8 thèmes** (matière, datation, origine, usage, auteur, dimensions,
      valeur, conservation) + visite. **Sans LLM, et c'est délibéré** : huit
      catégories fermées, affichage instantané, et surtout ça marche quand la
      clé API manque — ce qui est le cas courant ici.
- [x] `GuideQuestionsView.vue` affiche un CONSEIL (« Précisez la matière et la
      technique ») et non un comptage.
- [x] **L'ERP avertit** : bannière cliquable au tableau de bord dès qu'une
      lacune récurrente est détectée.

> ⚠️ Pièges de sous-chaîne rencontrés dans le classificateur (corrigés, à ne pas
> réintroduire) : `origin` est contenu dans « original », `age de` dans
> « image de », `rite` dans « mérite », `cher` dans « chercher », `etat` est
> trop court. Les mots-clés courts doivent être testés contre des pièges.

### Phase 10 — Le Cabinet de comparaison 🟡 (2026-08-04, chaîne complète non éprouvée)

Le « retrieve then rerank » : ramener large depuis les API de musées, **ordonner
par le sens**, faire **justifier** par un modèle, faire **trancher** par un humain.

**Ce qui est en place**

- [x] `objets_externes` — catalogue mondial **GLOBAL, hors tenant**. Un masque du
      Met est le même objet pour toutes les organisations : on l'interroge et on
      le plonge **une seule fois**. Le coût par organisation baisse donc quand la
      plateforme grandit. `embedding vector(384)`, index **HNSW cosinus**,
      `depth_map_url` déjà prévu pour le 2.5D.
- [x] `object_siblings` étendu (`externe_id`, `type_lien`, `justification`) : il
      **est** le `lien_fraternite` par tenant, il portait déjà `statut`,
      `decided_by`, `decided_at`. Les 11 correspondances existantes ont été
      reprises et rattachées.
- [x] Edge Function `freres` : `requete` (fiche FR → vocabulaire de catalogue EN),
      `plonger` / `plonger_objet` (gte-small), `juger`.
- [x] `src/services/freres.js` — orchestration des cinq temps.
- [x] `FreresCabinet.vue` (ERP) — étape D : valider / écarter / **corriger la
      justification**. Relancer une recherche ne piétine jamais une décision prise.
- [x] `CabinetFreres.vue` (public) — l'œuvre au centre, les frères en arc de
      planches, cartel avec musée et justification. Remplace la grille plate.

**Trois mesures qui ont dicté la conception — ne pas les redécouvrir**

1. **Il faut plonger en ANGLAIS.** Avec `gte-small`, une requête française
   classait une peinture de moulin hollandais **devant** deux masques. En
   anglais : vrais frères ≥ 0,898, bruit ≤ 0,779 (étendue 0,20 contre 0,13).
   D'où le champ `texte_en` produit par l'action `requete`.
2. **Le plafond de calcul des Edge Functions est bas.** 18 plongements passent
   (1,7 s), **20 déclenchent `WORKER_RESOURCE_LIMIT`**. D'où des lots de 12.
3. **L'arc du cabinet est plafonné à 96°.** À 150° d'étendue, les planches des
   extrémités tombaient à −75°, presque de profil : ni image ni cartel lisibles.

**Écarts assumés par rapport au cahier des charges (contraintes du poste)**

| Prévu | Obstacle | Retenu |
|---|---|---|
| Three.js / React Three Fiber | npm HS (§6) **et** front en Vue, pas React | CSS 3D (`perspective` + `preserve-3d`) — GPU, texte accessible, zéro dépendance |
| Embeddings SigLIP/CLIP sur l'image | ni GPU ni dépendance installable | `gte-small` du runtime Supabase, sur le **texte**. ⚠️ **La comparaison ne porte donc pas sur l'image** |
| BullMQ / Celery + worker Python | pas d'infra worker | lots de 12 dans l'Edge Function + cache global |
| Europeana, Rijksmuseum, Smithsonian, Harvard | **les quatre exigent une clé API** absente | liste blanche `source_externe_valide()` prête ; sources actives : Met, ARTIC, Cleveland, V&A, Wikidata |

**RESTE**

- [ ] **Éprouver la chaîne complète avec un compte du personnel.** Chaque maillon
      a été vérifié séparément — `requete` et `juger` en direct (le jugement
      écarte bien un masque Nô et une théière), `freres_reclasser` en SQL sur de
      vrais vecteurs, le plafond de plongement mesuré — mais l'enchaînement
      `cache → plonger → reclasser → proposer` n'a jamais tourné bout en bout,
      faute de session personnel.
- [ ] **Supprimer `sonde-embeddings`** depuis le tableau de bord Supabase. Elle
      est neutralisée (corps vide, JWT obligatoire) mais une version antérieure
      écrivait avec la clé de service : l'API de déploiement ne sait pas
      supprimer une fonction, seulement la remplacer.
- [ ] Brancher Bedrock sur `freres` : Llama rend des justifications laconiques
      (« Même culture Bamiléké ») là où Claude rédigerait la phrase de cartel
      attendue. Trois lignes, cf. le commentaire en tête de la fonction.
### Phase 11 — Relief 2.5D 🟡 (2026-08-04, moteur prêt, aucune carte produite)

Une photo plate qui révèle du volume quand la caméra bouge. **Ce n'est pas un
scan** : un plan subdivisé dont les sommets sont poussés par une carte de
profondeur. L'illusion tient de face et s'effondre de profil — d'où le bridage
d'angle, qui est la condition du procédé et non un réglage de confort.

- [x] `src/services/relief.js` — moteur **WebGL écrit à la main**, dans la veine
      de `panorama.js` : grille 128×128, déplacement des sommets par
      `texture2D` dans le shader de sommets, fond écarté par l'alpha.
      **Contrôle indispensable au démarrage** : `MAX_VERTEX_TEXTURE_IMAGE_UNITS`
      vaut 0 sur certains GPU mobiles anciens — le moteur renonce alors
      proprement et l'appelant affiche l'image plate.
- [x] **Règle des deux niveaux de rendu** respectée : maillage déplacé pour la
      SEULE planche ouverte, image simple pour les vingt autres. 16 000 sommets
      et deux textures par planche tueraient un téléphone.
- [x] Parallaxe bornée à **±20°**, angle au-delà duquel les zones absentes de
      la photo apparaissent et s'étirent.
- [x] `amplitude_relief` **réglable par œuvre** (0,02–0,30, bornée en base) :
      une tapisserie et un buste ne demandent pas la même valeur.
- [x] Bucket `profondeur` (public en lecture, écriture réservée au personnel).
      Pas de base64 en colonne texte : `image.js` documente déjà ce piège.
- [x] `scripts/profondeur.py` — segmentation `rembg`, puis Depth Anything V2
      Small, puis **masquage de la carte par l'alpha** (sans quoi le fond
      ondule), envoi dans le bucket et rattachement à la notice. PNG 16 bits
      pour éviter les marches sur les surfaces lisses.

> ⚠️ **Piège d'échelle mesuré.** Le cahier des charges donne 0,08–0,15 « de la
> largeur du plan », pour un plan de largeur 1. Notre grille va de −1 à +1 :
> elle fait DEUX unités. Sans le facteur ×2 appliqué dans `rendre()`, le relief
> sortait deux fois trop faible — invisible à l'œil.

**RESTE**

- [ ] **Aucune carte de profondeur n'existe encore.** Le moteur a été vérifié
      sur une carte fabriquée pour l'essai (un visage : nez saillant, yeux
      creusés) — la parallaxe est franche. Mais tant que `scripts/profondeur.py`
      n'a pas tourné, aucune planche du cabinet n'a de relief en production.
      Ce script ne peut PAS tourner ici : Python + PyTorch, et npm est HS.
- [ ] Régler l'amplitude par œuvre depuis l'ERP (la colonne et la RPC
      `externe_regler_relief` existent, l'écran n'a pas encore le curseur).
- [ ] Passe d'inpainting sur les zones de disocclusion, si l'on veut élargir
      l'angle au-delà de 20°. Confort, pas nécessité.

---

## 5. Ordre de travail recommandé

| Ordre | Phase | Pourquoi |
|---|---|---|
| ~~—~~ | ~~6 — Visite immersive~~ | ✅ **Fait le 2026-08-01.** Reste à exécuter la migration SQL. |
| ~~—~~ | ~~7 — Généalogie~~ | ✅ **Fait le 2026-08-01.** |
| ~~—~~ | ~~3 — Finitions ERP~~ | ✅ **Fait le 2026-08-01.** |
| ~~—~~ | ~~5 — Recherche IA~~ | ✅ **Fait le 2026-08-01.** Reste à déployer `memory-search`. |
| 1 | **8 — DevOps** | À faire avant la mise en ligne réelle, pas avant la démonstration. |
| 2 | **2 — AWS** | Dépend d'identifiants que l'utilisateur connectera plus tard. |
| 4 | **RA — finition** | Mise en pause à la demande de l'utilisateur : elle ne peut être réglée que sur un vrai appareil. |

---

## 6. Pièges techniques de ce poste (vérifiés, coûteux à redécouvrir)

- **npm est hors service** (réseau) → **aucune nouvelle dépendance**. Tout est écrit à
  la main : globe SVG, frontières embarquées, service worker. Le panorama 360 devra
  l'être aussi.
- **PowerShell + npm** : `npm` renvoie exit 255 s'il écrit sur stderr → lancer les
  builds via **Bash** : `npm run build 2>&1 | tail -3`.
- **L'aperçu intégré met la page en `visibilityState: hidden`** → `requestAnimationFrame`
  est suspendu : une animation semble figée alors qu'elle fonctionne dans un vrai navigateur.
- **Le screenshot headless timeoute** → vérifier par `read_page`, `get_page_text` ou
  styles calculés en JS.
- **Les clics simulés** peuvent ne pas déclencher les handlers Vue (décalage de
  coordonnées) → déclencher par script pour valider une logique.
- **Service worker en dev** : peut servir une version périmée → recharger sans cache.
- **PL/pgSQL** : dans une fonction `RETURNS TABLE`, ne jamais écrire un nom de colonne
  nu qui correspond à une colonne de sortie (ambiguïté). Qualifier avec un alias.
- **Publication en cascade** : un objet n'apparaît en public que si **musée + secteur +
  objet** sont tous `published = true`. De même pour une visite : **musée + visite**.
- **Texture WebGL et CORS** : une image sans en-tête CORS « salit » la texture et fait
  lever une erreur de sécurité au téléversement. `PanoramaViewer` demande donc le mode
  anonyme et retombe sur la salle de démonstration si le serveur distant refuse.
- **Jamais de `URL.createObjectURL()` vers la base.** Une adresse `blob:` n'existe que
  dans l'onglet qui l'a créée. `ObjectFormDialog` enregistrait ainsi les modèles 3D :
  aucun ne survivait au rechargement, et la RA était donc structurellement impossible.
  Corrigé (data URL + champ adresse web + garde-fou 12 Mo). Les objets importés avant
  la correction affichent un avertissement dans l'ERP et doivent être réimportés.
- **`BarcodeDetector` est absent de Chrome sous Windows** : ni le scan de billets ni la
  relecture d'un QR ne peuvent être testés sur ce poste. Vérifier sur téléphone.

---

## 7. Conventions

- **Modifier directement les fichiers**, jamais coller le code dans le chat.
- Mapping **camelCase (app) ↔ snake_case (DB)** via `fromRow`/`toRow` dans chaque store.
- Site public : design system `.ps-*` (`src/assets/public-site.css`), titres **Anton**
  majuscules, couleur émeraude `--site-primary`, or `--gold`.
- ERP : PrimeVue + classes `vi-*`, navy `#16223C` + orange `#F26B21` sur `#F6F7F9`.
- **Toute chaîne visible passe par i18n** (`fr.js` **et** `en.js`, mêmes clés).
  ⚠️ Piège `@` : vue-i18n l'interprète → échapper `"vous{'@'}exemple.com"`.
- **Jamais de clé API dans le frontend** — toujours une Edge Function.
- Une fonctionnalité dépendant d'une clé absente doit **dégrader proprement**, jamais
  bloquer le parcours (modèle : `send-email` → `{ skipped: true }`).

---

## 8. Comptes de développement

| Rôle | Identifiants |
|---|---|
| Staff ERP | `admin@musea.app` / `Musea2026!` |
| Visiteur | `visiteur@musea.app` / `Visiteur2026!` |

Projet Supabase : `dvwwwlqrwwzfwxukyoxz` · `https://dvwwwlqrwwzfwxukyoxz.supabase.co`

Devenir super-admin (une fois, en SQL) :
```sql
update public.profiles set role = 'super_admin' where id = '<votre-user-id>';
```

---

## 9. Démarrage

```bash
npm run dev
```

Site public `/site` · ERP `/dashboard` · vitrine plateforme `/` · inscription `/inscription`
