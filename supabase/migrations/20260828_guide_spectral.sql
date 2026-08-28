-- ============================================================================
-- GUIDE SPECTRAL — réalité augmentée spatiale, case grandeur nature
-- ----------------------------------------------------------------------------
-- À exécuter dans l'éditeur SQL de Supabase (ou via `supabase db push`).
--
-- Le visiteur scanne un espace vide ; une case traditionnelle apparaît à sa
-- taille réelle ; un avatar semi-transparent l'accompagne et raconte, en
-- fonction de ce qu'il REGARDE, des micro-récits de 15 à 35 secondes.
--
-- Cinq tables, pas une de plus :
--   ar_scenes         la case ancrable (modèle, emprise au sol, échelle)
--   ar_hotspots       les sept points d'intérêt et leurs colliders invisibles
--   ar_recits         les micro-récits, avec le circuit de validation HUMAINE
--   ar_avatar_configs l'apparence et le TEMPÉRAMENT du guide
--   ar_events         la télémétrie minimale (fixations, images/s, abandons)
--
-- DEUX PARTIS PRIS QUI SE LISENT DANS LE SCHÉMA
--
--  1. Le cahier des charges est encodé en CONTRAINTES, pas en commentaires.
--     « apparition entre 2,5 et 3,5 s », « récit de 15 à 35 s », « fixation de
--     1,8 à 2,2 s » : ce sont des CHECK. Un réglage hors bornes est refusé par
--     la base. Le comportement du guide ne peut donc pas dériver au fil des
--     modifications de l'ERP.
--
--  2. Aucun récit ne se publie sans signature. Le déclencheur
--     `ar_recits_exiger_validation` refuse `statut = 'publie'` tant que
--     `valide_par` est vide, et EFFACE la signature dès que le texte change.
--     Une relecture ne vaut que pour le texte relu — c'est la seule façon
--     d'empêcher qu'un récit approuvé serve de laissez-passer à un autre.
-- ============================================================================

-- ------------------------------------------------------------- ar_scenes ----
-- « mousgoum » est l'orthographe usuelle de l'ethnonyme (Extrême-Nord du
-- Cameroun et Tchad) ; la case obus s'y dit « tolek ».
CREATE TABLE IF NOT EXISTS public.ar_scenes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      bigint REFERENCES public.tenants(id) ON DELETE CASCADE,
  museum_id      bigint NOT NULL REFERENCES public.museums(id) ON DELETE CASCADE,
  sector_id      bigint REFERENCES public.sectors(id) ON DELETE SET NULL,
  -- L'OBJET du catalogue dont le modèle EST cette scène. C'est lui qui permet à
  -- la fiche publique de proposer « entrer dans la case » plutôt que « poser
  -- l'objet devant soi » : sans ce lien, il faudrait deviner, ou coder en dur.
  object_id      bigint REFERENCES public.objects(id) ON DELETE SET NULL,

  titre          text NOT NULL,
  description    text,
  archetype      text NOT NULL DEFAULT 'mousgoum'
                 CHECK (archetype IN ('mousgoum', 'bamileke', 'fali', 'autre')),

  -- Modèles. Le .glb est compressé Draco + meshopt et servi par CloudFront ;
  -- le .usdz sert de repli Quick Look sur les iPhone sans WebXR (c'est-à-dire
  -- tous, à ce jour : Safari n'expose pas `immersive-ar`).
  modele_url     text,
  modele_ios_url text,
  modele_octets  integer,                 -- budget de préchargement hors ligne

  -- Un scan sort rarement en mètres ; même correctif que `objects.ar_echelle`.
  echelle        numeric NOT NULL DEFAULT 1 CHECK (echelle > 0 AND echelle <= 100),

  -- Emprise au sol RÉELLE de la case, en mètres. Elle ne décore pas : c'est
  -- elle qui permet de dire « reculez de deux pas » AVANT l'ancrage, plutôt
  -- que de laisser le visiteur poser un bâtiment de six mètres dans un couloir.
  emprise_m      numeric NOT NULL DEFAULT 6.0 CHECK (emprise_m > 0 AND emprise_m <= 40),
  hauteur_m      numeric NOT NULL DEFAULT 4.5 CHECK (hauteur_m > 0 AND hauteur_m <= 40),
  orientation_deg numeric NOT NULL DEFAULT 0,   -- rotation par défaut autour de Y

  published      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ar_scenes_museum_idx ON public.ar_scenes(museum_id);
CREATE INDEX IF NOT EXISTS ar_scenes_tenant_idx ON public.ar_scenes(tenant_id);
CREATE INDEX IF NOT EXISTS ar_scenes_object_idx ON public.ar_scenes(object_id)
  WHERE object_id IS NOT NULL;

-- ----------------------------------------------------------- ar_hotspots ----
-- Sept points, et seulement sept : la liste est fermée par un CHECK. Un huitième
-- point n'est pas une donnée, c'est une décision de conception — elle passe par
-- une migration, visible en revue, pas par un formulaire.
CREATE TABLE IF NOT EXISTS public.ar_hotspots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint REFERENCES public.tenants(id) ON DELETE CASCADE,
  scene_id    bigint NOT NULL REFERENCES public.ar_scenes(id) ON DELETE CASCADE,

  code        text NOT NULL CHECK (code IN
              ('seuil', 'foyer', 'couchage', 'grenier', 'poteaux', 'toit', 'sortie')),
  libelle     text NOT NULL,
  object_id   bigint REFERENCES public.objects(id) ON DELETE SET NULL,

  -- Ancrage dans le repère de la CASE : mètres, Y vers le haut, origine au
  -- centre du sol. Indépendant de l'endroit où le visiteur a posé le bâtiment.
  x           double precision NOT NULL DEFAULT 0,
  y           double precision NOT NULL DEFAULT 1.2,
  z           double precision NOT NULL DEFAULT 0,

  -- Rayon du collider invisible traversé par le rayon du regard. Large pour le
  -- toit (on le vise mal, tête en arrière), serré pour un poteau sculpté.
  rayon       numeric NOT NULL DEFAULT 0.45 CHECK (rayon >= 0.15 AND rayon <= 4),

  -- Où l'avatar se place pour raconter CE point : décalage en mètres dans le
  -- repère de la case. Le guide se met À CÔTÉ de l'élément, jamais devant.
  pose_avatar jsonb NOT NULL DEFAULT '{"dx": 0.9, "dz": 0.7}'::jsonb,

  -- Ordre de la proposition proactive (§7) : ce que le guide offre de montrer
  -- quand le visiteur stagne. Le seuil d'abord, la sortie en dernier.
  priorite    integer NOT NULL DEFAULT 0,

  -- SOURCES VALIDÉES, et rien d'autre. Tableau d'objets :
  --   {"kind": "objet",   "id": 32}          notice de l'ERP
  --   {"kind": "secteur", "id": 4}           histoire de la salle
  --   {"kind": "note",    "texte": "…",      note de terrain saisie par le
  --                       "auteur": "…"}     conservateur
  -- C'est le SEUL corpus transmis au modèle. Hors de là, il n'a rien à dire.
  notices     jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, code)
);

CREATE INDEX IF NOT EXISTS ar_hotspots_scene_idx  ON public.ar_hotspots(scene_id, priorite);
CREATE INDEX IF NOT EXISTS ar_hotspots_tenant_idx ON public.ar_hotspots(tenant_id);

-- ------------------------------------------------------------- ar_recits ----
CREATE TABLE IF NOT EXISTS public.ar_recits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint REFERENCES public.tenants(id) ON DELETE CASCADE,
  hotspot_id  bigint NOT NULL REFERENCES public.ar_hotspots(id) ON DELETE CASCADE,

  lang        text NOT NULL DEFAULT 'fr',
  -- Plusieurs variantes par point : un visiteur qui revient au foyer n'entend
  -- pas deux fois la même phrase. Sans cela l'avatar devient une borne audio.
  variante    integer NOT NULL DEFAULT 1 CHECK (variante >= 1 AND variante <= 5),

  texte       text NOT NULL,
  -- 15 à 35 secondes (§5). Estimée à la génération (~2,6 mots/s en français
  -- parlé posé), corrigée à la mesure quand l'audio est synthétisé.
  duree_s     integer CHECK (duree_s IS NULL OR (duree_s >= 15 AND duree_s <= 35)),
  audio_url   text,                       -- voix pré-synthétisée, mise en cache hors ligne

  statut      text NOT NULL DEFAULT 'brouillon'
              CHECK (statut IN ('brouillon', 'en_relecture', 'valide', 'publie', 'rejete')),

  -- Traçabilité : quel moteur a rédigé, sur quelles sources exactement.
  genere_par  text,                       -- 'bedrock:eu.anthropic.claude-…' | 'humain'
  sources     jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Signature de relecture. Effacée dès que le texte change (voir le déclencheur).
  valide_par  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  valide_le   timestamptz,
  motif_rejet text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotspot_id, lang, variante)
);

CREATE INDEX IF NOT EXISTS ar_recits_hotspot_idx ON public.ar_recits(hotspot_id, lang, statut);
CREATE INDEX IF NOT EXISTS ar_recits_tenant_idx  ON public.ar_recits(tenant_id);
CREATE INDEX IF NOT EXISTS ar_recits_relecture_idx
  ON public.ar_recits(tenant_id, created_at DESC) WHERE statut = 'en_relecture';

-- ----------------------------------------------------- ar_avatar_configs ----
-- Une configuration par musée. Les bornes du cahier des charges sont ici :
-- l'ERP peut régler le tempérament du guide, il ne peut pas le dénaturer.
CREATE TABLE IF NOT EXISTS public.ar_avatar_configs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint REFERENCES public.tenants(id) ON DELETE CASCADE,
  museum_id   bigint NOT NULL UNIQUE REFERENCES public.museums(id) ON DELETE CASCADE,

  nom         text NOT NULL DEFAULT 'Guide',
  -- glTF riggé, animations « idle / walk / talk / greet / farewell ».
  modele_url  text,
  echelle     numeric NOT NULL DEFAULT 1 CHECK (echelle > 0 AND echelle <= 3),
  opacite     numeric NOT NULL DEFAULT 0.55 CHECK (opacite >= 0.25 AND opacite <= 0.85),
  teinte      text NOT NULL DEFAULT '#9fe8d4',

  -- Voix. `browser` ne coûte rien et fonctionne hors ligne ; `elevenlabs` et
  -- `polly` passent par l'Edge Function `tts`, clé côté serveur uniquement.
  voix_provider text NOT NULL DEFAULT 'browser'
                CHECK (voix_provider IN ('browser', 'elevenlabs', 'polly')),
  voix_id     text,
  debit       numeric NOT NULL DEFAULT 0.95 CHECK (debit >= 0.5 AND debit <= 1.5),
  salutation  text NOT NULL DEFAULT
              'Bienvenue. Je suis là si tu veux comprendre ce que tu vois. Prends ton temps.',

  -- ---- Tempérament. Chaque borne vient du cahier des charges. --------------
  delai_apparition_ms integer NOT NULL DEFAULT 3000
    CHECK (delai_apparition_ms BETWEEN 2500 AND 3500),   -- §1
  salutation_max_s    integer NOT NULL DEFAULT 10
    CHECK (salutation_max_s BETWEEN 8 AND 12),           -- §2
  distance_min_m      numeric NOT NULL DEFAULT 1.5
    CHECK (distance_min_m >= 1.5 AND distance_min_m <= 2.0),  -- §3
  distance_max_m      numeric NOT NULL DEFAULT 2.0
    CHECK (distance_max_m >= 1.5 AND distance_max_m <= 2.0),
  -- Jamais pile devant : l'avatar reste au moins à ce cap du regard du visiteur.
  decalage_lateral_deg numeric NOT NULL DEFAULT 32
    CHECK (decalage_lateral_deg >= 20 AND decalage_lateral_deg <= 70),
  fixation_ms         integer NOT NULL DEFAULT 2000
    CHECK (fixation_ms BETWEEN 1800 AND 2200),           -- §4
  silence_contemplatif_s integer NOT NULL DEFAULT 6
    CHECK (silence_contemplatif_s >= 6),                 -- §6
  relance_stagnation_s   integer NOT NULL DEFAULT 12
    CHECK (relance_stagnation_s >= 12),                  -- §7

  published   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ar_avatar_distances_coherentes CHECK (distance_min_m <= distance_max_m)
);

CREATE INDEX IF NOT EXISTS ar_avatar_configs_tenant_idx ON public.ar_avatar_configs(tenant_id);

-- ------------------------------------------------------------- ar_events ----
-- Télémétrie ANONYME et minimale. `session` est un identifiant tiré dans le
-- navigateur, jamais rattaché à un compte : on veut savoir quels points
-- retiennent le regard et si l'appareil tient les 30 images/s, pas qui visite.
CREATE TABLE IF NOT EXISTS public.ar_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  bigint REFERENCES public.tenants(id) ON DELETE CASCADE,
  scene_id   bigint NOT NULL REFERENCES public.ar_scenes(id) ON DELETE CASCADE,
  hotspot_id bigint REFERENCES public.ar_hotspots(id) ON DELETE SET NULL,
  session    uuid NOT NULL,
  type       text NOT NULL CHECK (type IN
             ('ancrage', 'apparition', 'fixation', 'recit', 'silence',
              'proposition', 'fin', 'perf', 'echec_ancrage')),
  valeur     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ar_events_scene_idx ON public.ar_events(scene_id, created_at DESC);

-- ============================================================================
-- Rattachement automatique à l'organisation
-- ============================================================================
DO $rattachement$
DECLARE t text;
BEGIN
  -- `ar_events` est ABSENTE de cette liste, et c'est le point délicat : elle est
  -- la seule table écrite par un VISITEUR ANONYME. Or `set_tenant_id` rattache
  -- à l'organisation du membre du personnel qui insère — un visiteur n'en a
  -- pas (« un visiteur n'est jamais profiles.tenant_id », MUSEA_MASTER_PLAN §3).
  -- Ses événements arriveraient donc avec tenant_id NULL, et la politique de
  -- lecture `can_manage_tenant(tenant_id)` les rendrait invisibles à tout le
  -- monde : on collecterait une télémétrie que personne ne peut relire. Elle a
  -- son propre déclencheur, plus bas, qui hérite du tenant de la SCÈNE.
  FOREACH t IN ARRAY ARRAY['ar_scenes', 'ar_hotspots', 'ar_recits', 'ar_avatar_configs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_tenant ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_tenant BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id()', t);
  END LOOP;
END $rattachement$;

-- ----------------------------------------------------------------------------
-- Télémétrie : le locataire vient de la SCÈNE, pas de l'auteur de l'insertion.
--
-- SECURITY INVOKER volontairement : la politique d'insertion exige déjà que la
-- scène soit visible de l'appelant, donc ce SELECT aboutit dans les deux seuls
-- cas licites — un visiteur sur une scène publiée, un membre du personnel sur
-- une scène de son organisation. Passer en DEFINER élargirait la portée du
-- déclencheur sans rien résoudre.
CREATE OR REPLACE FUNCTION public.ar_events_heriter_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $heritage$
BEGIN
  SELECT s.tenant_id INTO NEW.tenant_id
    FROM public.ar_scenes s WHERE s.id = NEW.scene_id;
  RETURN NEW;
END $heritage$;

DROP TRIGGER IF EXISTS trg_ar_events_tenant ON public.ar_events;
CREATE TRIGGER trg_ar_events_tenant BEFORE INSERT ON public.ar_events
  FOR EACH ROW EXECUTE FUNCTION public.ar_events_heriter_tenant();

-- ============================================================================
-- VALIDATION HUMAINE — la règle qui ne se contourne pas
-- ----------------------------------------------------------------------------
-- Vérifier la relecture dans l'interface ne protège de rien : un appel direct à
-- l'API REST de Supabase passe à côté. La règle vit donc dans la base.
--
-- Trois interdits :
--   1. `publie` ou `valide` sans relecteur identifié → refus.
--   2. Se signer soi-même un texte que l'on vient de générer par IA reste
--      permis (le conservateur EST le relecteur), mais la signature est
--      horodatée et attribuée : la trace existe.
--   3. Modifier le texte d'un récit signé le RENVOIE en relecture. C'est le
--      point important : sans cela, on validerait un texte anodin puis on le
--      remplacerait par n'importe quoi.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ar_recits_exiger_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $validation$
BEGIN
  -- Le texte a changé : toute signature antérieure devient caduque.
  IF TG_OP = 'UPDATE' AND NEW.texte IS DISTINCT FROM OLD.texte THEN
    IF NEW.valide_par IS NOT DISTINCT FROM OLD.valide_par THEN
      NEW.valide_par := NULL;
      NEW.valide_le  := NULL;
      IF NEW.statut IN ('valide', 'publie') THEN NEW.statut := 'en_relecture'; END IF;
    END IF;
    -- L'audio décrivait l'ancien texte : il ne doit plus être servi.
    IF NEW.audio_url IS NOT DISTINCT FROM OLD.audio_url THEN NEW.audio_url := NULL; END IF;
  END IF;

  IF NEW.statut IN ('valide', 'publie') THEN
    IF NEW.valide_par IS NULL THEN
      NEW.valide_par := auth.uid();
      NEW.valide_le  := now();
    ELSIF NEW.valide_le IS NULL THEN
      NEW.valide_le := now();
    END IF;
    -- auth.uid() est NULL pour une clé de service : un automate ne publie pas.
    IF NEW.valide_par IS NULL THEN
      RAISE EXCEPTION 'Un récit ne peut passer en « % » sans relecteur identifié.', NEW.statut
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $validation$;

DROP TRIGGER IF EXISTS trg_ar_recits_validation ON public.ar_recits;
CREATE TRIGGER trg_ar_recits_validation
  BEFORE INSERT OR UPDATE ON public.ar_recits
  FOR EACH ROW EXECUTE FUNCTION public.ar_recits_exiger_validation();

-- ============================================================================
-- RLS — cloisonnement total par organisation, publication en cascade
-- ============================================================================
ALTER TABLE public.ar_scenes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_hotspots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_recits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_avatar_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_events         ENABLE ROW LEVEL SECURITY;

-- Scène : publiée + musée publié + organisation publique (cascade des visites).
DROP POLICY IF EXISTS ar_scenes_public_read ON public.ar_scenes;
CREATE POLICY ar_scenes_public_read ON public.ar_scenes FOR SELECT
  USING (
    published = true
    AND public.tenant_is_public(tenant_id)
    AND EXISTS (SELECT 1 FROM public.museums m WHERE m.id = museum_id AND m.published = true)
  );

DROP POLICY IF EXISTS ar_scenes_staff_all ON public.ar_scenes;
CREATE POLICY ar_scenes_staff_all ON public.ar_scenes FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

-- Point chaud : visible si sa scène l'est. La condition n'est pas répliquée,
-- elle est déléguée à la politique de `ar_scenes` — une seule vérité.
DROP POLICY IF EXISTS ar_hotspots_public_read ON public.ar_hotspots;
CREATE POLICY ar_hotspots_public_read ON public.ar_hotspots FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.ar_scenes s WHERE s.id = scene_id));

DROP POLICY IF EXISTS ar_hotspots_staff_all ON public.ar_hotspots;
CREATE POLICY ar_hotspots_staff_all ON public.ar_hotspots FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

-- Récit : le visiteur ne voit QUE le statut `publie`. Un brouillon d'IA non
-- relu n'est jamais lisible depuis le site, même en connaissant son identifiant.
DROP POLICY IF EXISTS ar_recits_public_read ON public.ar_recits;
CREATE POLICY ar_recits_public_read ON public.ar_recits FOR SELECT
  USING (
    statut = 'publie'
    AND valide_par IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.ar_hotspots h
       WHERE h.id = hotspot_id
         AND EXISTS (SELECT 1 FROM public.ar_scenes s WHERE s.id = h.scene_id)
    )
  );

DROP POLICY IF EXISTS ar_recits_staff_all ON public.ar_recits;
CREATE POLICY ar_recits_staff_all ON public.ar_recits FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS ar_avatar_public_read ON public.ar_avatar_configs;
CREATE POLICY ar_avatar_public_read ON public.ar_avatar_configs FOR SELECT
  USING (
    published = true
    AND public.tenant_is_public(tenant_id)
    AND EXISTS (SELECT 1 FROM public.museums m WHERE m.id = museum_id AND m.published = true)
  );

DROP POLICY IF EXISTS ar_avatar_staff_all ON public.ar_avatar_configs;
CREATE POLICY ar_avatar_staff_all ON public.ar_avatar_configs FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

-- Télémétrie : le visiteur ÉCRIT (sur une scène visible), le personnel LIT.
-- Personne ne relit les événements d'une autre organisation.
DROP POLICY IF EXISTS ar_events_public_insert ON public.ar_events;
CREATE POLICY ar_events_public_insert ON public.ar_events FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.ar_scenes s WHERE s.id = scene_id));

DROP POLICY IF EXISTS ar_events_staff_read ON public.ar_events;
CREATE POLICY ar_events_staff_read ON public.ar_events FOR SELECT
  USING (public.can_manage_tenant(tenant_id));

-- ============================================================================
-- Commentaires
-- ============================================================================
COMMENT ON TABLE public.ar_scenes IS
  'Case grandeur nature ancrable en réalité augmentée. emprise_m sert à vérifier que la pièce est assez grande AVANT l''ancrage.';
COMMENT ON TABLE public.ar_hotspots IS
  'Les sept points d''intérêt de la case. x/y/z en mètres dans le repère du bâtiment, origine au centre du sol.';
COMMENT ON COLUMN public.ar_hotspots.notices IS
  'Seul corpus transmis au modèle. Hors de ces sources validées, le guide n''a rien à dire.';
COMMENT ON TABLE public.ar_recits IS
  'Micro-récits de 15 à 35 s. Statut `publie` impossible sans relecteur ; modifier le texte annule la signature.';
COMMENT ON TABLE public.ar_avatar_configs IS
  'Tempérament du guide. Les bornes du cahier des charges sont des CHECK : l''ERP règle, il ne dénature pas.';
COMMENT ON TABLE public.ar_events IS
  'Télémétrie anonyme : fixations, images/s, abandons. `session` est tiré dans le navigateur, jamais lié à un compte.';

-- ============================================================================
-- AMORÇAGE DES SEPT POINTS CHAUDS
-- ----------------------------------------------------------------------------
-- Poser sept points à la main dans un formulaire, pour chaque case, c'est sept
-- occasions de se tromper de repère. Cette fonction les pose d'un coup, avec
-- une géométrie tirée d'un tolek réel : environ six mètres de diamètre au sol,
-- quatre mètres cinquante sous la clé, entrée unique.
--
-- REPÈRE. Origine au centre du sol, Y vers le haut, +Z vers l'entrée. Les
-- coordonnées sont donc lisibles : « z positif » veut dire « du côté de la
-- porte », et rien d'autre.
--
-- SEUIL ET SORTIE SONT LE MÊME PASSAGE, vus d'où l'on se tient. Le seuil est
-- posé à l'INTÉRIEUR (z = 2,55), la sortie à l'EXTÉRIEUR (z = 4,2). Depuis le
-- foyer, le rayon du regard rencontre le seuil d'abord : c'est lui qui parle.
-- Une fois le visiteur passé, le seuil est derrière lui et c'est la sortie qui
-- répond. Aucune logique supplémentaire n'a été nécessaire — la règle « le
-- premier point touché fait foi » suffit à distinguer entrer de sortir.
--
-- UNE HONNÊTETÉ SUR « POTEAUX SCULPTÉS ». Le tolek mousgoum est une coque de
-- terre à profil de chaînette : il ne comporte pas de poteaux porteurs, et son
-- décor est fait de NERVURES en relief modelées sur la paroi extérieure — qui
-- servent aussi d'échafaudage pour l'entretien. Les poteaux sculptés, eux, sont
-- caractéristiques des cases bamiléké. Le point chaud garde donc le même code
-- (`poteaux`, la structure reste commune) mais son libellé suit l'archétype :
-- annoncer des poteaux là où il n'y en a pas serait la première contrevérité
-- de la visite, et elle serait dite par le décor lui-même.
CREATE OR REPLACE FUNCTION public.ar_semer_points(p_scene_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $semer$
DECLARE
  v_archetype text;
  v_libelle_poteaux text;
  v_emprise numeric;
  v_hauteur numeric;
  v_fh numeric;
  v_fv numeric;
  v_poses integer;
BEGIN
  SELECT archetype, emprise_m, hauteur_m
    INTO v_archetype, v_emprise, v_hauteur
    FROM public.ar_scenes WHERE id = p_scene_id;
  IF v_archetype IS NULL THEN
    RAISE EXCEPTION 'Scène % introuvable (ou hors de votre organisation).', p_scene_id;
  END IF;

  v_libelle_poteaux := CASE v_archetype
    WHEN 'mousgoum' THEN 'Nervures sculptées de la paroi'
    ELSE 'Poteaux sculptés'
  END;

  -- MISE À L'ÉCHELLE DE LA SCÈNE.
  --
  -- Les coordonnées ci-dessous décrivent un tolek de référence : six mètres au
  -- sol, quatre mètres cinquante sous la clé. Une case réelle, ou un scan qui
  -- englobe toute une concession, n'a pas ces proportions — sur le relevé de la
  -- Fondation, l'enveloppe fait près de vingt mètres de diamètre. Posés tels
  -- quels, les sept points tomberaient au milieu du vide, à trois mètres de
  -- toute paroi, et aucun regard ne les rencontrerait jamais.
  --
  -- On les dilate donc PROPORTIONNELLEMENT à l'emprise et à la hauteur
  -- déclarées. Le foyer reste au centre, le seuil reste sur la paroi d'entrée,
  -- la voûte reste en haut : ce sont des positions RELATIVES au bâtiment, et
  -- c'est ainsi qu'elles doivent voyager d'une case à l'autre.
  v_fh := COALESCE(v_emprise, 6.0) / 6.0;    -- facteur horizontal
  v_fv := COALESCE(v_hauteur, 4.5) / 4.5;    -- facteur vertical

  INSERT INTO public.ar_hotspots (scene_id, code, libelle, x, y, z, rayon, pose_avatar, priorite)
  VALUES
    -- Le seuil parle en premier : c'est le point qu'on regarde en arrivant.
    (p_scene_id, 'seuil',    'Le seuil',              0.0,          1.00 * v_fv,  2.55 * v_fh, LEAST(4, 0.55 * v_fh), '{"dx": 0.8, "dz": -0.6}', 1),
    -- Le foyer est au centre, bas : on le regarde en baissant les yeux.
    (p_scene_id, 'foyer',    'Le foyer central',      0.0,          0.35 * v_fv,  0.0,         LEAST(4, 0.70 * v_fh), '{"dx": 1.0, "dz": 0.4}',  2),
    (p_scene_id, 'poteaux',  v_libelle_poteaux,      -2.05 * v_fh,  1.60 * v_fv,  1.30 * v_fh, LEAST(4, 0.50 * v_fh), '{"dx": 0.7, "dz": 0.7}',  3),
    (p_scene_id, 'couchage', 'La zone de couchage',  -1.60 * v_fh,  0.50 * v_fv, -1.20 * v_fh, LEAST(4, 0.80 * v_fh), '{"dx": 0.9, "dz": 0.8}',  4),
    (p_scene_id, 'grenier',  'Le grenier',            1.70 * v_fh,  1.50 * v_fv, -1.30 * v_fh, LEAST(4, 0.70 * v_fh), '{"dx": -0.9, "dz": 0.8}', 5),
    -- Le toit se vise mal, tête en arrière : son collider est large à dessein.
    (p_scene_id, 'toit',     'La voûte',              0.0,          3.60 * v_fv,  0.0,         LEAST(4, 1.60 * v_fh), '{"dx": 1.2, "dz": 0.9}',  6),
    -- Dehors, au-delà du seuil. Voir la note ci-dessus.
    (p_scene_id, 'sortie',   'La sortie',             0.0,          1.20 * v_fv,  4.20 * v_fh, LEAST(4, 0.90 * v_fh), '{"dx": 1.0, "dz": 0.8}',  7)
  ON CONFLICT (scene_id, code) DO NOTHING;

  GET DIAGNOSTICS v_poses = ROW_COUNT;
  RETURN v_poses;
END $semer$;

COMMENT ON FUNCTION public.ar_semer_points(bigint) IS
  'Pose les sept points chauds d''une case, dilatés à l''emprise et à la hauteur de la scène. Rejouable : ON CONFLICT DO NOTHING.';
