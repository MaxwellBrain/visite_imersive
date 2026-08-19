-- ============================================================================
-- PERFORMANCE — cesser de transporter les modèles 3D dans les listes
-- ----------------------------------------------------------------------------
-- CONSTAT MESURÉ (2026-08-19, 13 objets publiés) :
--   select('*')            → 3 159 Ko
--   colonnes réellement
--   affichées dans une liste →    19 Ko
--   soit 99,3 % de charge inutile, et un facteur 166.
--
-- La cause : `objects` porte les modèles 3D en base64 (`model3d`,
-- `model3d_ios`). Un seul objet pèse 3,1 Mo à lui seul. Le site public faisait
-- `select('*')` sur l'accueil, l'arbre du musée et les pages de salle : chaque
-- visiteur téléchargeait donc des mégaoctets de modèles que ces écrans
-- n'affichent jamais — ils ne montrent qu'une vignette et un titre.
--
-- CE QUE CETTE MIGRATION APPORTE
-- Une liste doit tout de même savoir SI un objet possède un modèle, pour
-- afficher la pastille « 3D · AR ». Tester `model3d IS NOT NULL` côté client
-- obligerait à rapatrier la colonne — exactement ce qu'on veut éviter.
-- D'où une colonne calculée : PostgreSQL la maintient seule, elle ne peut pas
-- se désynchroniser, et elle pèse un octet.
--
-- `model3d_name` aurait pu servir d'indice, mais il est renseigné pour 3 objets
-- sur les 4 qui ont un modèle : il aurait menti sur le quatrième.
-- ============================================================================

ALTER TABLE public.objects
  ADD COLUMN IF NOT EXISTS a_3d boolean
  GENERATED ALWAYS AS (
    model3d IS NOT NULL OR model3d_ios IS NOT NULL OR model_usdz IS NOT NULL
  ) STORED;

COMMENT ON COLUMN public.objects.a_3d IS
  'Vrai si l''objet possède un modèle 3D, quel qu''en soit le format. Calculée par la base : permet aux listes d''afficher la pastille 3D sans rapatrier les modèles eux-mêmes (99,3 % de la charge).';

-- Les listes publiques filtrent toutes sur `published` puis trient : cet index
-- couvre les deux en une passe.
CREATE INDEX IF NOT EXISTS objects_publies_idx
  ON public.objects (published, published_at DESC NULLS LAST)
  WHERE published = true;
