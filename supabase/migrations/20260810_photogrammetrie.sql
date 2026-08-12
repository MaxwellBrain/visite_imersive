-- ============================================================================
-- PHOTOGRAMMÉTRIE — numériser un objet à partir d'une série de photos
-- ----------------------------------------------------------------------------
-- Constat de terrain (Fondation Jean Félicien Gacha) : la PRISE DE VUE est à la
-- portée d'un agent muni d'un téléphone. Ce qui manquait n'était pas le
-- matériel, c'était la MÉTHODE et la traçabilité.
--
-- CE QUE CETTE MIGRATION FAIT — ET CE QU'ELLE NE FAIT PAS
--   Elle gère la campagne de prises de vue : le lot de photos, son contrôle
--   qualité, le format attendu en sortie, l'état d'avancement.
--   Elle NE reconstruit RIEN. La reconstruction (SfM + MVS) demande un GPU et
--   plusieurs minutes ; c'est hors de portée d'une Edge Function (Deno, sans
--   GPU, ~150 s de plafond). Le moteur est donc VOLONTAIREMENT externe, et la
--   table est écrite pour en accueillir n'importe lequel : le champ `moteur`
--   enregistre lequel a produit le modèle.
--
-- Le résultat vient se poser sur les colonnes 3D qui existent déjà :
--   objects.model3d      (.glb — Android, navigateurs)
--   objects.model3d_ios  (.usdz — Quick Look, indispensable sur iPhone)
-- ============================================================================

-- --------------------------------------------------------------- Stockage ---
-- Bucket PRIVÉ : une campagne de prises de vue est un document de travail, pas
-- une publication. Le modèle fini, lui, ira dans les colonnes publiques.
-- 12 Mo par fichier : une photo de téléphone en pleine résolution tient
-- largement, et le plafond arrête un téléversement accidentel de vidéo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('captures', 'captures', false, 12582912, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------ Travaux de scan -----
CREATE TABLE IF NOT EXISTS public.photogrammetry_jobs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      bigint NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  object_id      bigint NOT NULL REFERENCES public.objects(id) ON DELETE CASCADE,

  statut         text NOT NULL DEFAULT 'capture'
                 CHECK (statut IN ('capture', 'pret', 'en_cours', 'termine', 'echec')),

  -- Formats demandés. glb couvre Android et le web, usdz couvre iOS : la
  -- plupart des campagnes voudront les deux, d'où un tableau plutôt qu'un
  -- champ unique. obj/ply servent à l'archivage scientifique et aux logiciels
  -- de retouche, qui ne lisent pas toujours le glTF.
  formats        text[] NOT NULL DEFAULT ARRAY['glb', 'usdz'],

  nb_photos      integer NOT NULL DEFAULT 0,
  -- En deçà, la reconstruction échoue ou rend un maillage troué. 50 est le
  -- minimum retenu avec le commanditaire ; on le contrôle avant d'autoriser
  -- le passage en file.
  nb_photos_min  integer NOT NULL DEFAULT 50,

  -- Traçabilité de la campagne, utile au conservateur comme au chercheur.
  operateur      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moteur         text,                    -- renseigné par le moteur qui traite
  note           text,
  erreur         text,

  -- Résultats : URL publiques une fois le modèle produit.
  resultat_glb   text,
  resultat_usdz  text,
  resultat_obj   text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,

  -- Un travail terminé sans aucun modèle serait un mensonge d'état.
  CONSTRAINT photogrammetry_termine_a_un_resultat
    CHECK (statut <> 'termine'
           OR resultat_glb IS NOT NULL
           OR resultat_usdz IS NOT NULL
           OR resultat_obj IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS photogrammetry_object_idx ON public.photogrammetry_jobs(object_id);
CREATE INDEX IF NOT EXISTS photogrammetry_tenant_idx ON public.photogrammetry_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS photogrammetry_statut_idx ON public.photogrammetry_jobs(statut);

-- ---------------------------------------------------- Photos de la campagne --
-- Une ligne par cliché. On conserve l'ORBITE et l'indice : c'est ce qui permet
-- de vérifier que le tour a bien été fait, et de rejouer une campagne
-- incomplète sans tout recommencer.
CREATE TABLE IF NOT EXISTS public.photogrammetry_shots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id      bigint NOT NULL REFERENCES public.photogrammetry_jobs(id) ON DELETE CASCADE,

  orbite      text NOT NULL CHECK (orbite IN ('basse', 'mediane', 'haute', 'dessus', 'dessous')),
  indice      integer NOT NULL,
  chemin      text NOT NULL,              -- clé dans le bucket `captures`

  -- Variance du laplacien, calculée dans le navigateur au moment du cliché.
  -- Plus c'est bas, plus l'image est floue. Une photo floue ne dégrade pas un
  -- peu la reconstruction : elle fausse l'appariement des points et peut faire
  -- échouer toute la campagne. On garde la mesure pour pouvoir l'exclure.
  nettete     numeric,
  largeur     integer,
  hauteur     integer,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (job_id, orbite, indice)
);

CREATE INDEX IF NOT EXISTS photogrammetry_shots_job_idx ON public.photogrammetry_shots(job_id);

-- ------------------------------------------------------------------ RLS -----
ALTER TABLE public.photogrammetry_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photogrammetry_shots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photogrammetry_jobs_staff ON public.photogrammetry_jobs;
CREATE POLICY photogrammetry_jobs_staff ON public.photogrammetry_jobs FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS photogrammetry_shots_staff ON public.photogrammetry_shots;
CREATE POLICY photogrammetry_shots_staff ON public.photogrammetry_shots FOR ALL
  USING (EXISTS (SELECT 1 FROM public.photogrammetry_jobs j
                  WHERE j.id = job_id AND public.can_manage_tenant(j.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.photogrammetry_jobs j
                       WHERE j.id = job_id AND public.can_manage_tenant(j.tenant_id)));

-- Rattachement automatique à l'organisation, comme les autres tables.
DROP TRIGGER IF EXISTS trg_set_tenant ON public.photogrammetry_jobs;
CREATE TRIGGER trg_set_tenant BEFORE INSERT ON public.photogrammetry_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- ------------------------------------------------- Accès au bucket privé ----
-- Le premier segment du chemin porte l'identifiant du tenant : `<tenant>/<job>/…`.
--
-- Lecture SÛRE de ce préfixe : un `split_part(...)::bigint` direct lèverait une
-- erreur sur un chemin mal formé au lieu de refuser l'accès — et rien ne garantit
-- que Postgres évalue le `bucket_id = 'captures'` en premier. Un objet déposé
-- ailleurs avec un nom non numérique ferait alors échouer la politique entière.
CREATE OR REPLACE FUNCTION public.prefixe_tenant(p_chemin text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN split_part(coalesce(p_chemin, ''), '/', 1) ~ '^[0-9]+$'
    THEN split_part(p_chemin, '/', 1)::bigint
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.prefixe_tenant(text) IS
  'Identifiant d''organisation en tête d''un chemin de stockage, ou NULL si le chemin est mal formé. Ne lève jamais.';

DROP POLICY IF EXISTS captures_staff_all ON storage.objects;
CREATE POLICY captures_staff_all ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'captures'
    AND public.can_manage_tenant(public.prefixe_tenant(name))
  )
  WITH CHECK (
    bucket_id = 'captures'
    AND public.can_manage_tenant(public.prefixe_tenant(name))
  );

-- ------------------------------------------- Compteur tenu par la base ------
-- Le client peut être interrompu en plein téléversement ; c'est donc la base
-- qui fait foi sur le nombre de clichés réellement reçus.
CREATE OR REPLACE FUNCTION public.photogrammetry_recompter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.photogrammetry_jobs j
     SET nb_photos = (SELECT count(*) FROM public.photogrammetry_shots s WHERE s.job_id = j.id)
   WHERE j.id = coalesce(NEW.job_id, OLD.job_id);
  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.photogrammetry_recompter() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_photogrammetry_recompter ON public.photogrammetry_shots;
CREATE TRIGGER trg_photogrammetry_recompter
  AFTER INSERT OR DELETE ON public.photogrammetry_shots
  FOR EACH ROW EXECUTE FUNCTION public.photogrammetry_recompter();

-- --------------------------------------------- Passage en file de traitement -
-- Refuse de mettre en file une campagne trop courte : mieux vaut un refus net
-- ici qu'un maillage troué découvert une heure plus tard.
CREATE OR REPLACE FUNCTION public.photogrammetry_soumettre(p_job_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE j public.photogrammetry_jobs;
BEGIN
  SELECT * INTO j FROM public.photogrammetry_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'travail_introuvable'; END IF;
  IF j.nb_photos < j.nb_photos_min THEN
    RAISE EXCEPTION 'photos_insuffisantes: % sur % attendues', j.nb_photos, j.nb_photos_min;
  END IF;

  UPDATE public.photogrammetry_jobs
     SET statut = 'pret'
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'nb_photos', j.nb_photos);
END;
$$;

GRANT EXECUTE ON FUNCTION public.photogrammetry_soumettre(bigint) TO authenticated;

COMMENT ON TABLE public.photogrammetry_jobs IS
  'Campagne de numérisation 3D d''un objet par photogrammétrie. La reconstruction elle-même est faite par un moteur externe (GPU requis).';
COMMENT ON COLUMN public.photogrammetry_shots.nettete IS
  'Variance du laplacien mesurée à la prise de vue. Basse = flou. Une photo floue peut faire échouer toute la reconstruction.';
