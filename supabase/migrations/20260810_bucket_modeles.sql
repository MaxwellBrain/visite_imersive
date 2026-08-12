-- ============================================================================
-- BUCKET DES MODÈLES 3D
-- ----------------------------------------------------------------------------
-- POURQUOI, alors que `objects.model3d` fonctionne déjà :
-- ce champ reçoit aujourd'hui une DATA URL base64, plafonnée à 12 Mo côté
-- formulaire. Deux limites, sans gravité pour un modèle dessiné à la main, mais
-- rédhibitoires pour un modèle issu de photogrammétrie :
--   • un maillage photogrammétrique texturé pèse couramment 20 à 50 Mo, et le
--     base64 ajoute encore un tiers ;
--   • surtout, la colonne est lue à CHAQUE requête sur l'objet. Un catalogue de
--     30 pièces embarquerait des centaines de mégaoctets dans des listes qui
--     n'affichent qu'un titre et une vignette.
--
-- Le bucket est PUBLIC : un modèle 3D est fait pour être vu par les visiteurs,
-- exactement comme la photo de l'objet. Seul le personnel peut y écrire.
--
-- La colonne `model3d` reste inchangée : elle accueille désormais une URL. Les
-- data URLs déjà en place continuent de fonctionner — `model-viewer` lit les
-- deux — donc aucune reprise de données n'est nécessaire.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'modeles', 'modeles', true, 52428800,
  ARRAY[
    'model/gltf-binary',        -- .glb
    'model/vnd.usdz+zip',       -- .usdz
    'application/octet-stream', -- navigateurs qui ne devinent pas le type
    'model/gltf+json',          -- .gltf
    'application/zip'           -- .usdz vu comme une archive
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lecture ouverte : c'est ce qui permet au site public d'afficher le modèle.
DROP POLICY IF EXISTS modeles_lecture_publique ON storage.objects;
CREATE POLICY modeles_lecture_publique ON storage.objects FOR SELECT
  USING (bucket_id = 'modeles');

-- Écriture réservée au personnel de l'organisation propriétaire. Le premier
-- segment du chemin porte son identifiant : `<tenant>/<objet>/modele.glb`.
-- `prefixe_tenant` le lit sans jamais lever, même sur un chemin mal formé.
DROP POLICY IF EXISTS modeles_ecriture_staff ON storage.objects;
CREATE POLICY modeles_ecriture_staff ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'modeles'
    AND public.can_manage_tenant(public.prefixe_tenant(name))
  );

DROP POLICY IF EXISTS modeles_maj_staff ON storage.objects;
CREATE POLICY modeles_maj_staff ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'modeles'
    AND public.can_manage_tenant(public.prefixe_tenant(name))
  );

DROP POLICY IF EXISTS modeles_suppr_staff ON storage.objects;
CREATE POLICY modeles_suppr_staff ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'modeles'
    AND public.can_manage_tenant(public.prefixe_tenant(name))
  );
