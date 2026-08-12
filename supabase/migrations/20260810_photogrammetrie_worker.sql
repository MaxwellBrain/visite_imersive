-- ============================================================================
-- PHOTOGRAMMÉTRIE — interface du worker de reconstruction
-- ----------------------------------------------------------------------------
-- Le worker tourne sur une instance GPU, hors de Supabase. Il s'authentifie
-- avec la CLÉ DE SERVICE : ces fonctions ne sont donc accessibles ni à `anon`
-- ni à `authenticated`, et elles ne dépendent d'aucune RLS.
--
-- LE POINT DÉLICAT EST LA RÉSERVATION.
-- Deux workers lancés en parallèle — ou un worker relancé après une coupure —
-- se disputeraient la même campagne, et l'on paierait deux fois le même calcul
-- pour un résultat écrasé. D'où `FOR UPDATE SKIP LOCKED` : chaque appelant
-- verrouille une ligne différente, sans attendre celles déjà prises. C'est le
-- motif canonique d'une file de travaux en PostgreSQL, et il évite d'ajouter
-- un service de file dédié pour trois campagnes par semaine.
-- ============================================================================

-- ------------------------------------------------------------ Réserver -----
-- Renvoie UNE campagne prête, déjà basculée en 'en_cours', avec ses chemins de
-- photos. NULL s'il n'y a rien à faire — c'est ce que le worker attend pour
-- décider de s'éteindre.
CREATE OR REPLACE FUNCTION public.photogrammetry_reclamer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id  bigint;
  v_res jsonb;
BEGIN
  SELECT j.id INTO v_id
  FROM public.photogrammetry_jobs j
  WHERE j.statut = 'pret'
  ORDER BY j.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.photogrammetry_jobs
     SET statut = 'en_cours', started_at = now()
   WHERE id = v_id;

  SELECT jsonb_build_object(
    'job_id',    j.id,
    'tenant_id', j.tenant_id,
    'object_id', j.object_id,
    'formats',   to_jsonb(j.formats),
    'nb_photos', j.nb_photos,
    'photos',    coalesce(
                   (SELECT jsonb_agg(s.chemin ORDER BY s.orbite, s.indice)
                      FROM public.photogrammetry_shots s
                     WHERE s.job_id = j.id),
                   '[]'::jsonb)
  ) INTO v_res
  FROM public.photogrammetry_jobs j
  WHERE j.id = v_id;

  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------- Terminer -----
-- Le worker fournit les URL publiques des modèles produits. La contrainte de
-- table refuse déjà « terminé » sans résultat ; on vérifie ici aussi pour
-- renvoyer un message net plutôt qu'une violation de contrainte.
CREATE OR REPLACE FUNCTION public.photogrammetry_terminer(
  p_job_id bigint,
  p_glb    text DEFAULT NULL,
  p_usdz   text DEFAULT NULL,
  p_obj    text DEFAULT NULL,
  p_moteur text DEFAULT 'colmap'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_object bigint;
BEGIN
  IF p_glb IS NULL AND p_usdz IS NULL AND p_obj IS NULL THEN
    RAISE EXCEPTION 'aucun_modele_fourni';
  END IF;

  UPDATE public.photogrammetry_jobs
     SET statut        = 'termine',
         resultat_glb  = coalesce(p_glb,  resultat_glb),
         resultat_usdz = coalesce(p_usdz, resultat_usdz),
         resultat_obj  = coalesce(p_obj,  resultat_obj),
         moteur        = p_moteur,
         finished_at   = now(),
         erreur        = NULL
   WHERE id = p_job_id
  RETURNING object_id INTO v_object;

  IF v_object IS NULL THEN RAISE EXCEPTION 'travail_introuvable'; END IF;

  -- Rattachement à l'objet : chaque colonne ne reçoit QUE le format que son
  -- appareil sait lire. iOS ne lira jamais un .glb, Android jamais un .usdz.
  UPDATE public.objects
     SET model3d      = coalesce(p_glb,  model3d),
         model3d_ios  = coalesce(p_usdz, model3d_ios)
   WHERE id = v_object;

  RETURN jsonb_build_object('ok', true, 'object_id', v_object);
END;
$$;

-- --------------------------------------------------------------- Échouer ----
-- Un échec doit être VISIBLE et porter sa cause : sans cela, une campagne reste
-- « en cours » indéfiniment et l'opérateur ne sait pas s'il doit attendre.
CREATE OR REPLACE FUNCTION public.photogrammetry_echouer(
  p_job_id bigint,
  p_erreur text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.photogrammetry_jobs
     SET statut = 'echec', erreur = left(coalesce(p_erreur, 'erreur inconnue'), 2000),
         finished_at = now()
   WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------- Reprise après coupure ----
-- Une instance spot peut être reprise par AWS en cours de calcul : la campagne
-- resterait alors « en cours » pour toujours. On la remet en file au-delà d'un
-- délai raisonnable, plutôt que d'exiger une intervention manuelle.
CREATE OR REPLACE FUNCTION public.photogrammetry_reprendre_abandonnes(
  p_apres_minutes integer DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.photogrammetry_jobs
     SET statut = 'pret', started_at = NULL
   WHERE statut = 'en_cours'
     AND started_at < now() - make_interval(mins => greatest(p_apres_minutes, 10));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Réservées au worker (clé de service). Le rôle `service_role` contourne de
-- toute façon la RLS ; ce qui compte ici est de les fermer au public.
REVOKE ALL ON FUNCTION public.photogrammetry_reclamer()                         FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.photogrammetry_terminer(bigint, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.photogrammetry_echouer(bigint, text)              FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.photogrammetry_reprendre_abandonnes(integer)      FROM public, anon, authenticated;

COMMENT ON FUNCTION public.photogrammetry_reclamer() IS
  'Réserve une campagne prête pour le worker GPU. FOR UPDATE SKIP LOCKED : deux workers ne peuvent pas prendre la même.';
