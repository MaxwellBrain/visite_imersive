-- ============================================================================
-- GUIDE SPECTRAL — PAROLE EN DIRECT
-- ----------------------------------------------------------------------------
-- À jouer APRÈS `20260828_guide_spectral.sql`.
--
-- CE QUI CHANGE, ET POURQUOI ÇA CHANGE TOUT
--
-- La première version faisait rédiger l'IA à l'avance, faisait relire un
-- humain, puis servait un texte figé. Le guide était une borne audio bien
-- écrite. On veut l'inverse : un guide qui IMPROVISE devant le visiteur, qui
-- tient compte de ce qu'il a déjà dit, et qui répond aux questions.
--
-- Conséquence qu'il faut regarder en face : **la validation humaine AVANT
-- publication devient impossible**. Un texte qui n'existe qu'à l'instant où il
-- est prononcé ne peut pas avoir été relu la veille. Prétendre le contraire
-- serait un mensonge de conception.
--
-- Ce qui la remplace, et qui n'est pas moins exigeant :
--
--   1. LES SOURCES restent validées. Le modèle ne reçoit que les notices
--      publiées rattachées au point chaud. C'est là que se joue l'essentiel de
--      l'ancrage : on ne contrôle plus la phrase, on contrôle ce qu'elle peut
--      dire.
--   2. TOUT CE QUI A ÉTÉ DIT EST CONSERVÉ. `ar_improvisations` enregistre la
--      parole réelle, la question qui l'a provoquée, le modèle, les sources.
--      Le conservateur ne relit plus un brouillon : il écoute son guide.
--   3. LE SIGNALEMENT EST IMMÉDIAT. Une improvisation peut être marquée, et
--      promue en récit canonique (`ar_recits`) quand elle est bonne — ce qui
--      la fige, la fait relire, et la rend disponible hors ligne.
--
-- `ar_recits` ne disparaît donc pas : il devient le REPLI. Réseau coupé,
-- Bedrock indisponible, quota épuisé — le guide retombe sur des textes relus
-- plutôt que de se taire. Les deux systèmes se complètent au lieu de se
-- concurrencer.
-- ============================================================================

-- ------------------------------------------------- ar_avatar_configs --------
ALTER TABLE public.ar_avatar_configs
  -- Quel Claude fait parler ce guide. Une COLONNE, pas une constante du code :
  -- les identifiants de modèles se périment (le projet l'a déjà vécu avec Groq
  -- et Gemini). Changer de modèle doit être un UPDATE, pas un redéploiement.
  ADD COLUMN IF NOT EXISTS modele text NOT NULL DEFAULT 'equilibre'
    CHECK (modele IN ('rapide', 'equilibre', 'profond')),

  -- L'improvisation peut être coupée musée par musée. Une institution qui ne
  -- veut, pour l'instant, que des textes relus doit pouvoir le décider sans
  -- qu'on touche au code — et le guide reste fonctionnel, sur `ar_recits`.
  ADD COLUMN IF NOT EXISTS improvisation boolean NOT NULL DEFAULT true,

  -- Les questions libres sont un engagement plus lourd que la narration : le
  -- visiteur peut demander n'importe quoi. Réglable à part.
  ADD COLUMN IF NOT EXISTS questions_ouvertes boolean NOT NULL DEFAULT true,

  -- Ce que le guide sait de lui-même. Injecté tel quel dans le prompt : c'est
  -- ainsi qu'une chefferie donne une VOIX à son guide plutôt qu'un ton neutre
  -- de notice. Vide = le guide reste sobre.
  ADD COLUMN IF NOT EXISTS persona text;

COMMENT ON COLUMN public.ar_avatar_configs.modele IS
  'rapide = Haiku (le moins cher, le plus prompt) | equilibre = Sonnet (défaut) | profond = Opus.';
COMMENT ON COLUMN public.ar_avatar_configs.persona IS
  'Qui parle, en deux ou trois phrases. Injecté dans le prompt système : c''est ce qui donne une voix propre au guide d''une chefferie.';

-- ------------------------------------------------- ar_improvisations --------
-- La mémoire de ce qui a été dit. Elle sert trois usages, et un seul suffirait
-- à la justifier : sans elle, personne ne sait ce que le guide raconte.
CREATE TABLE IF NOT EXISTS public.ar_improvisations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint REFERENCES public.tenants(id) ON DELETE CASCADE,
  scene_id    bigint NOT NULL REFERENCES public.ar_scenes(id) ON DELETE CASCADE,
  hotspot_id  bigint REFERENCES public.ar_hotspots(id) ON DELETE SET NULL,
  session     uuid NOT NULL,

  -- Vide pour une narration spontanée ; renseignée quand le visiteur a demandé
  -- quelque chose. C'est la colonne la plus précieuse du lot : elle dit ce que
  -- les gens veulent savoir, et que les notices ne couvrent pas.
  question    text,
  texte       text NOT NULL,
  lang        text NOT NULL DEFAULT 'fr',

  modele      text,
  latence_ms  integer,                   -- délai avant le PREMIER mot prononcé
  sources     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Le modèle a-t-il reconnu ne pas savoir ? Un guide qui le dit souvent sur
  -- un même point désigne une notice à écrire.
  aveu        boolean NOT NULL DEFAULT false,

  -- Relecture APRÈS COUP. `signale` peut venir du visiteur (bouton) comme du
  -- conservateur : les deux voient la même phrase.
  signale     boolean NOT NULL DEFAULT false,
  motif       text,
  revu_par    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revu_le     timestamptz,
  -- Renseigné quand l'improvisation a été promue en récit canonique.
  recit_id    bigint REFERENCES public.ar_recits(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ar_improvisations_scene_idx
  ON public.ar_improvisations(scene_id, created_at DESC);
-- Index partiel : la file de surveillance du conservateur, celle qu'il ouvre
-- tous les matins. Elle ne doit pas balayer des dizaines de milliers de lignes
-- pour en trouver trois.
CREATE INDEX IF NOT EXISTS ar_improvisations_a_revoir_idx
  ON public.ar_improvisations(tenant_id, created_at DESC)
  WHERE signale = true AND revu_le IS NULL;
CREATE INDEX IF NOT EXISTS ar_improvisations_aveux_idx
  ON public.ar_improvisations(hotspot_id, created_at DESC) WHERE aveu = true;

-- Même raisonnement que pour `ar_events` : la table est écrite par un VISITEUR
-- ANONYME, qui n'a pas de `tenant_id`. Sans cet héritage depuis la scène, la
-- trace serait orpheline et le conservateur ne pourrait jamais la relire.
CREATE OR REPLACE FUNCTION public.ar_improvisations_heriter_tenant()
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

DROP TRIGGER IF EXISTS trg_ar_improvisations_tenant ON public.ar_improvisations;
CREATE TRIGGER trg_ar_improvisations_tenant BEFORE INSERT ON public.ar_improvisations
  FOR EACH ROW EXECUTE FUNCTION public.ar_improvisations_heriter_tenant();

ALTER TABLE public.ar_improvisations ENABLE ROW LEVEL SECURITY;

-- Le visiteur ÉCRIT (sur une scène qu'il peut voir) et ne relit jamais rien,
-- pas même ses propres échanges : la table contient les questions de tous.
DROP POLICY IF EXISTS ar_improvisations_public_insert ON public.ar_improvisations;
CREATE POLICY ar_improvisations_public_insert ON public.ar_improvisations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.ar_scenes s WHERE s.id = scene_id));

-- Signaler une phrase est le seul geste d'écriture laissé au visiteur, et il
-- est volontairement étroit : la politique n'autorise QUE `signale` et `motif`
-- (les autres colonnes doivent rester identiques à ce qu'elles étaient).
-- Sans cette restriction, un visiteur pourrait réécrire la parole du guide et
-- fabriquer une citation qu'il n'a jamais prononcée.
DROP POLICY IF EXISTS ar_improvisations_public_signaler ON public.ar_improvisations;
CREATE POLICY ar_improvisations_public_signaler ON public.ar_improvisations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.ar_scenes s WHERE s.id = scene_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ar_scenes s WHERE s.id = scene_id));

CREATE OR REPLACE FUNCTION public.ar_improvisations_signalement_seul()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $garde$
BEGIN
  -- Le personnel de l'organisation fait ce qu'il veut : c'est lui qui relit.
  IF public.can_manage_tenant(OLD.tenant_id) THEN RETURN NEW; END IF;

  -- Tout le reste est figé. On ne lève pas d'exception, on RESTAURE : un
  -- visiteur qui signale ne doit pas voir une erreur parce qu'un client a
  -- renvoyé la ligne entière.
  NEW.texte      := OLD.texte;
  NEW.question   := OLD.question;
  NEW.sources    := OLD.sources;
  NEW.modele     := OLD.modele;
  NEW.hotspot_id := OLD.hotspot_id;
  NEW.scene_id   := OLD.scene_id;
  NEW.session    := OLD.session;
  NEW.aveu       := OLD.aveu;
  NEW.tenant_id  := OLD.tenant_id;
  NEW.created_at := OLD.created_at;
  NEW.revu_par   := OLD.revu_par;
  NEW.revu_le    := OLD.revu_le;
  NEW.recit_id   := OLD.recit_id;
  RETURN NEW;
END $garde$;

DROP TRIGGER IF EXISTS trg_ar_improvisations_garde ON public.ar_improvisations;
CREATE TRIGGER trg_ar_improvisations_garde BEFORE UPDATE ON public.ar_improvisations
  FOR EACH ROW EXECUTE FUNCTION public.ar_improvisations_signalement_seul();

DROP POLICY IF EXISTS ar_improvisations_staff_all ON public.ar_improvisations;
CREATE POLICY ar_improvisations_staff_all ON public.ar_improvisations FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

COMMENT ON TABLE public.ar_improvisations IS
  'Ce que le guide a RÉELLEMENT dit, en direct. Remplace la validation avant publication par une surveillance après coup.';
COMMENT ON COLUMN public.ar_improvisations.aveu IS
  'Le guide a reconnu ne pas savoir. Répété sur un même point, c''est une notice à écrire.';
COMMENT ON COLUMN public.ar_improvisations.latence_ms IS
  'Délai avant le PREMIER mot prononcé, pas avant la fin. C''est celui-là que le visiteur ressent.';

-- ----------------------------------------------------------------------------
-- Promotion d'une improvisation réussie en récit canonique.
-- Le geste inverse du signalement : « cette phrase-là était juste, garde-la ».
-- Elle entre en `en_relecture` — promue n'est pas validée.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ar_promouvoir_improvisation(p_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $promotion$
DECLARE
  v_imp   public.ar_improvisations;
  v_var   integer;
  v_mots  integer;
  v_recit bigint;
BEGIN
  SELECT * INTO v_imp FROM public.ar_improvisations WHERE id = p_id;
  IF v_imp.id IS NULL THEN
    RAISE EXCEPTION 'Improvisation % introuvable (ou hors de votre organisation).', p_id;
  END IF;
  IF v_imp.hotspot_id IS NULL THEN
    RAISE EXCEPTION 'Cette parole n''était rattachée à aucun point chaud : rien à promouvoir.';
  END IF;

  SELECT COALESCE(MAX(variante), 0) + 1 INTO v_var
    FROM public.ar_recits WHERE hotspot_id = v_imp.hotspot_id AND lang = v_imp.lang;
  IF v_var > 5 THEN
    RAISE EXCEPTION 'Ce point a déjà cinq variantes : supprimez-en une avant de promouvoir.';
  END IF;

  v_mots := array_length(regexp_split_to_array(trim(v_imp.texte), '\s+'), 1);

  INSERT INTO public.ar_recits (hotspot_id, lang, variante, texte, duree_s, statut, genere_par, sources)
  VALUES (
    v_imp.hotspot_id, v_imp.lang, v_var, v_imp.texte,
    -- 2,6 mots/seconde, borné : la contrainte de `ar_recits` refuserait le reste.
    LEAST(35, GREATEST(15, (v_mots / 2.6)::integer)),
    'en_relecture',
    COALESCE('improvisation:' || v_imp.modele, 'improvisation'),
    v_imp.sources
  )
  RETURNING id INTO v_recit;

  UPDATE public.ar_improvisations
     SET recit_id = v_recit, revu_par = auth.uid(), revu_le = now()
   WHERE id = p_id;

  RETURN v_recit;
END $promotion$;

COMMENT ON FUNCTION public.ar_promouvoir_improvisation(bigint) IS
  'Fige une improvisation réussie en récit canonique (statut en_relecture), ce qui la rend disponible hors ligne.';
