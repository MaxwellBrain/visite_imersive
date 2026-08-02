> ⚠️ **Lire d'abord [`MUSEA_MASTER_PLAN.md`](MUSEA_MASTER_PLAN.md)** — document maître
> (vision, état mesuré, phases 1 à 8). Ce fichier-ci reste l'archive de détail de la V2.

# MUSÉA V2 — Plateforme SaaS professionnelle

Refonte demandée le 2026-07-31. Le multi-tenant V1 isolait les données du staff
mais ne constituait pas une plateforme de souscription. Ce document reprend
l'architecture depuis les fondations.

**Domaine cible : `musea.nexacode.store`** — chaque organisation sur `<slug>.musea.nexacode.store`.

---

## ▶ POINT DE REPRISE (lire en premier)

**Fait et vérifié** : Phase 1 (base de données) · Phase 2 (couche code sous-domaines, DNS/AWS à brancher) · Phase 3 (refonte ERP + site éditable, ~80 %)

**Espace visiteur branché** : adhésions automatiques (`join_tenant`) + écran ERP
« Mes visiteurs » (`tenant_audience`, export CSV) — isolation revérifiée.
**Campagnes e-mail branchées** (Phase 4) : rédaction assistée par Groq, ciblage opt-in,
journal d'envoi, désinscription — l'envoi réel n'attend plus que `RESEND_API_KEY`.

**Prochaine étape recommandée** : finir le **formulaire de souscription multi-étapes**
(`SignupView.vue`, Phase 1 restante — la base accepte ~30 champs, le formulaire en demande 5),
ou les **20 % restants de la Phase 3** (3 blocs encore figés + unifier connexion/inscription).
Ensuite viennent les phases « produit » : **5 — recherche IA**, **6 — visite immersive/AR**,
**7 — généalogie repensée**. La Phase 2 est faite côté code ; seule l'infrastructure AWS
(wildcard DNS, CloudFront, ACM) reste, à connecter plus tard.

**Déjà en base, pas encore exploité par l'interface** :
`tenant_members` (adhésions), `campaigns` + `campaign_recipients`, `slugs_reserves`,
tous les nouveaux champs de `tenants`, et les colonnes de marque de `site_settings`.
→ La couche SQL est prête et testée ; il manque les écrans.

**Contexte technique utile** :
- Projet Supabase : `dvwwwlqrwwzfwxukyoxz`
- Aucune clé payante posée : ElevenLabs (quota épuisé), Resend (absente).
  L'app fonctionne sans, avec repli explicite.
- npm échoue sur ce poste (réseau) → **aucune nouvelle dépendance** ;
  tout est écrit à la main (globe SVG, frontières embarquées, service worker).
- L'aperçu intégré met la page en `visibilityState: hidden`, ce qui **suspend
  `requestAnimationFrame`** : une animation peut sembler figée alors qu'elle marche.

**Autres documents** : `PLAN_EVOLUTION.md` (V1 : commerce, billetterie, événements,
généalogie, Mémoire Réunifiée + globe), `RESUME_PROJET.md`, `HANDOFF.md`.

---

## Constat de départ (mesuré, pas supposé)

| Point | État V1 |
|---|---|
| Visiteurs par organisation | **2 visiteurs, 0 rattaché** — modèle global, inutilisable |
| Fiche organisation | 12 colonnes — trop pauvre pour une souscription |
| Adressage | `/c/slug` — pas de sous-domaine |
| E-mails aux visiteurs | inexistant |
| Site éditable depuis l'ERP | partiel (marque, hero, pages de connexion figés) |
| Visite immersive / AR | non commencé |
| DevOps / AWS | rien |

## Décisions prises (choix de l'utilisateur)

1. **Visiteurs** : compte MUSÉA global + **table d'adhésions** (`tenant_members`).
   Un visiteur peut adhérer à plusieurs organisations sans recréer de compte ;
   chaque admin ne voit et ne contacte que ses propres adhérents.
2. **Recherche IA** : traduction FR→EN par **Groq** (déjà disponible, gratuit),
   puis interrogation des 5 collections + Wikidata. Branchement d'une recherche
   web (Brave/Tavily) préparé mais non activé.
3. **Immersif/AR** : démonstration complète avec médias libres, prête à recevoir
   les vrais panoramas et modèles 3D.

---

## Phase 1 — Fondations : souscription & adhésions ✅ (base de données)
- [x] `tenants` enrichie : sigle, description, logo, site web, année, pays/région/ville/adresse,
      responsable (nom, fonction, e-mail, tél), n° de registre, dates d'abonnement,
      quotas (musées/objets/visiteurs), langue, fuseau, devise, motif de refus, notes internes
- [x] Table `slugs_reserves` : www, api, admin, app, mail… interdits aux organisations
- [x] Table **`tenant_members`** (adhésions) + RLS complète
- [x] `profiles.tenant_id` réservé au **staff** ; les visiteurs passent par les adhésions
- [x] RPC `join_tenant`, `my_memberships`, `tenant_audience`, `slug_available` (durcie)
- [x] **Isolation vérifiée dans les deux sens** : l'admin de l'org 6 voit 0 adhérent de l'org 1 ;
      l'admin de l'org 1 voit bien le sien. Verrou effectif même en lecture directe de la table.
- [x] **`join_tenant()` branché** — `joinTenant()` / `myMemberships()` dans `services/publicApi.js`,
      appelés par `PublicLayout.ensureMembership()` : tout visiteur connecté consultant le site
      d'une organisation en devient adhérent (idempotent, source `site`, staff exclu ; déclenché
      aussi au retour d'une connexion OTP/Google et au changement d'organisation).
      *Vérifié : `join_tenant` → `{ok:true, reason:"joined"}`, `my_memberships` → « Fondation Max Brian ».*
- [x] **Écran ERP « Mes visiteurs »** — `views/AudienceView.vue` (route `/visiteurs`, groupe
      Engagement) sur `tenant_audience()` : compteurs (total, opt-in e-mails), recherche,
      statut/opt-in/origine/dates, **export CSV** (prépare la Phase 4). i18n fr/en.
      *Vérifié : admin org 1 → 1 adhérent ; **org 6 → 0** ; lecture directe de la table → sa seule ligne.*
- [ ] **RESTE** : formulaire de souscription multi-étapes côté public exploitant tous ces champs
      (`views/platform/SignupView.vue` ne demande encore que nom/type/slug/e-mail/tél)

## Phase 2 — Sous-domaines `<slug>.musea.nexacode.store` 🟡 (couche code faite, DNS/AWS à brancher)
- [x] **Résolution par nom d'hôte en priorité** — `src/services/host.js` (`parseHost` →
      `local` | `platform` | `reserved` | `subdomain` | `custom`, domaine plateforme
      configurable via `VITE_PLATFORM_DOMAIN`, défaut `musea.nexacode.store`). Store
      `usePublicTenantStore.resolveByHost()` : sous-domaine → `resolveBySlug`, domaine
      perso → `resolveByDomain`. `PublicLayout` applique **l'hôte d'abord**, `/c/:slug`
      conservé en repli local. *Testé : localhost/vercel → local, `x.musea.nexacode.store` → slug x,
      `api/app.musea.nexacode.store` → réservé, `chefferie.cm` → custom.*
- [x] **Réservation des sous-domaines système** — `RESERVED_SUBDOMAINS` (miroir de
      `slugs_reserves`) : www, api, admin, app… ne désignent jamais une organisation.
- [x] **Canonical** — `<link rel=canonical>` posé par `PublicLayout` vers l'URL canonique
      de l'organisation (`canonicalOrigin` : domaine perso vérifié, sinon `<slug>.musea.nexacode.store`),
      préfixes `/c/:slug` et `/site` retirés. Redirection racine `/` → site de l'org sur un
      hôte d'organisation (guard routeur). *Vérifié : `/c/fondation/musees` → canonical
      `https://fondation.musea.nexacode.store/musees`, `/site` → `https://fondation.musea.nexacode.store`.*
- [ ] **RESTE (AWS, à brancher par l'utilisateur)** : Route 53 wildcard `*.musea.nexacode.store`,
      CloudFront, certificat ACM, et la **redirection canonique HTTP côté edge** (servir les
      pages publiques à la racine du sous-domaine sans le préfixe `/site`). La couche
      applicative est prête ; il ne manque que l'infrastructure et le domaine.

## Phase 3 — ERP : refonte visuelle & édition totale du site 🟡 (en grande partie faite)
- [x] **Tables refondues** : en-tête collant, lignes aérées, bande d'accent au survol,
      montants alignés à droite en chiffres tabulaires. 9 vues traitées.
- [x] **Boutons d'action uniformisés** : ronds, taille identique, estompés au repos et
      révélés au survol de la ligne ; toujours visibles sur mobile. Classe `.row-actions`.
- [x] **États vides titrés** (guider au lieu de constater)
- [x] **Système mutualisé** dans `style.css` : `vi-stats`, `vi-toolbar`, `row-actions`,
      `cell-id`, `cell-thumb`, `vi-dot`. Plus aucune vue ne redéfinit ses classes.
- [x] Suppression du doublon mort `views/AdminTenantsView.vue` (235 lignes, non routé)
- [x] **Site éditable** : colonnes `marque`, `marque_initiale`, `hero_image`,
      `login_image`, `login_titre`, `login_sous_titre` + sections ERP correspondantes.
      Marque, initiale/logo, image d'accueil et page de connexion ne sont plus en dur.
      Repli en cascade : marque → nom_entite → nom du tenant.
- [ ] **RESTE** : 3 blocs encore identiques pour toutes les organisations car issus des
      traductions — les **3 badges de réassurance** sous le hero, la **bande généalogie**,
      les textes de la **section application (PWA)**
- [ ] **RESTE** : **unifier connexion et inscription** en une seule page à deux intentions
      (rejoindre une organisation / en créer une) — aujourd'hui `/login` et `/inscription`
      sont deux écrans distincts qui se recouvrent partiellement

## Phase 4 — E-mails aux visiteurs, assistés par IA ✅ (envoi réel conditionné à Resend)
- [x] **Campagnes** (annonce · exposition · message) — `views/CampaignsView.vue` +
      `components/campaigns/CampaignFormDialog.vue` + `stores/useCampaignStore.js`,
      route `/campagnes` (groupe Engagement). Brouillon → envoi → bilan ; une campagne
      envoyée devient non modifiable. Compteurs destinataires/envoyés/échecs.
- [x] **Rédaction assistée par IA** — Edge Function **`campaign-ai`** (`verify_jwt=true`,
      Groq, sortie JSON `{sujet, contenu}`). Un brief d'une ligne suffit ; le texte reste
      éditable et porte un bandeau « relisez avant envoi ». Prompt anti-hallucination :
      interdiction d'inventer date, horaire, tarif ou nom d'œuvre non fournis.
      *Vérifié : brief « exposition de masques Bamiléké » → objet + 3 paragraphes,
      **aucune date inventée** (« informations communiquées prochainement »).*
- [x] **Segmentation, journal, désinscription** — destinataires calculés par la base
      (`campaign_recipients` : adhérents actifs **opt-in** de l'organisation, cible tous/musée) ;
      chaque envoi tracé dans `email_log` ; lien de désinscription ajouté au pied de tous
      les e-mails de campagne (gabarit `campagne` dans `send-email`, contenu **échappé** —
      aucun HTML de l'admin n'est interprété).
      *Vérifié : campagne créée → `tenant_id` auto = 1, 1 destinataire opt-in ;
      **un visiteur voit 0 campagne et 0 destinataire** ; sans clé Resend l'envoi répond
      `{skipped:true}` et `email_log` note `desactive` — jamais bloquant.*
- [ ] **RESTE (facultatif)** : poser `RESEND_API_KEY` pour un envoi réel (offre gratuite :
      3 000 e-mails/mois ; sans domaine vérifié, Resend n'écrit qu'au titulaire du compte).

## Phase 5 — Recherche IA « Mémoire Réunifiée » professionnelle ⏳
- [ ] Saisie en français → traduction et enrichissement des termes par IA
- [ ] Interrogation parallèle musées + Wikidata + (web, plus tard)
- [ ] Synthèse IA : « cet objet existe en N exemplaires, dans tel musée, telle bibliothèque »
- [ ] Globe déjà en place, à relier aux résultats enrichis

## Phase 6 — Visite immersive, 3D & réalité augmentée ⏳
- [ ] Visite 360° navigable (salle en salle)
- [ ] Points chauds : cliquer un objet → fiche + modèle 3D + narration vocale
- [ ] Mode AR (`model-viewer`, déjà intégré) : poser l'objet dans son espace réel
- [ ] Lien systématique objet → chef → **généalogie**

## Phase 7 — Généalogie repensée ⏳
- [ ] Arbre lisible et navigable, recentrage, recherche
- [ ] Fiche chef enrichie : règne, objets liés, récit
- [ ] Passerelle depuis la visite immersive

## Phase 8 — DevOps & déploiement AWS ⏳
- [ ] Dockerfile multi-étapes + Nginx
- [ ] GitHub Actions : lint → build → tests → image → déploiement
- [ ] Infrastructure as Code (Terraform) : S3+CloudFront ou ECS Fargate, Route 53, ACM
- [ ] Environnements séparés, variables et secrets, sauvegardes, journalisation
- [ ] Identifiants AWS : **à connecter plus tard par l'utilisateur**

---

## Règles d'ingénierie (rappel)
- Toute table exposée au public a une **RLS explicite**
- Jamais `is_staff()` seul pour du contenu appartenant à une organisation :
  toujours `can_manage_tenant(tenant_id)`
- Dans une fonction `RETURNS TABLE`, ne jamais écrire un nom de colonne nu
  qui correspond à une colonne de sortie (ambiguïté PL/pgSQL)
- Toute chaîne visible passe par i18n
