-- ============================================================================
-- INTERDIRE LE BASE64 DANS LES COLONNES D'IMAGES
-- ----------------------------------------------------------------------------
-- POURQUOI CETTE CONTRAINTE EXISTE
--
-- Le problème est revenu trois fois. À chaque fois le même mécanisme :
-- `ImageUploader` retombait silencieusement sur une DATA URL base64 quand on
-- oubliait de lui passer un bucket, et l'image partait dans la colonne.
-- Mesuré le 2026-08-21 sur `site_settings` de la Fondation :
--
--     image_fond   1 756 ko
--     login_image  1 152 ko
--     favicon        229 ko
--     ligne entière  3 083 ko  — relue à CHAQUE affichage de page
--                               → 9,7 s pour cette seule requête
--
-- Le code a été corrigé (le bucket est désormais le défaut), mais un défaut de
-- code se re-casse. Une contrainte, non : elle refuse l'écriture. C'est ce qui
-- rend la correction permanente plutôt que provisoire.
--
-- CE QUI SE PASSE SI QUELQU'UN RÉESSAIE
-- L'INSERT/UPDATE échoue avec une erreur explicite, au lieu de dégrader
-- silencieusement toutes les pages du site concerné.
--
-- ⚠️ ORDRE D'APPLICATION — cette migration suppose que les données ont DÉJÀ été
-- migrées vers le Storage :
--
--     export SUPABASE_SERVICE_KEY="eyJ..."
--     node scripts/migrer-medias.mjs              # simulation
--     node scripts/migrer-medias.mjs --appliquer  # écriture
--
-- Appliquée avant, elle ferait échouer l'enregistrement des réglages d'une
-- organisation dont les images sont encore en base64.
-- ============================================================================

-- Vérification préalable : on refuse de poser la contrainte si du base64
-- subsiste, plutôt que de laisser un écran d'administration cassé derrière soi.
do $$
declare reste bigint;
begin
  select count(*) into reste
  from public.site_settings
  where logo like 'data:%' or favicon like 'data:%' or image_fond like 'data:%'
     or hero_image like 'data:%' or login_image like 'data:%' or seo_image like 'data:%';

  if reste > 0 then
    raise exception
      'Migration refusee : % ligne(s) de site_settings contiennent encore du base64. '
      'Lancez d''abord : node scripts/migrer-medias.mjs --appliquer', reste;
  end if;
end $$;

alter table public.site_settings
  add constraint site_settings_images_sans_base64 check (
        coalesce(logo, '')        not like 'data:%'
    and coalesce(favicon, '')     not like 'data:%'
    and coalesce(image_fond, '')  not like 'data:%'
    and coalesce(hero_image, '')  not like 'data:%'
    and coalesce(login_image, '') not like 'data:%'
    and coalesce(seo_image, '')   not like 'data:%'
  );

comment on constraint site_settings_images_sans_base64 on public.site_settings is
  'Les images vont dans le Storage ; la colonne ne garde que leur URL. Une DATA URL '
  'ici alourdit toutes les pages du site, cette table etant relue a chaque affichage.';

-- Les mêmes colonnes, dans les autres tables qui portent des images. Elles sont
-- propres aujourd'hui (verifie le 2026-08-21) : la contrainte les garde propres.
alter table public.museums
  add constraint museums_photo_sans_base64 check (coalesce(photo, '') not like 'data:%');

alter table public.objects
  add constraint objects_medias_sans_base64 check (
        coalesce(photo, '')        not like 'data:%'
    and coalesce(photo_thumb, '')  not like 'data:%'
    and coalesce(model3d, '')      not like 'data:%'
    and coalesce(model3d_ios, '')  not like 'data:%'
  );

alter table public.products
  add constraint products_image_sans_base64 check (coalesce(image, '') not like 'data:%');

alter table public.events
  add constraint events_image_sans_base64 check (coalesce(image, '') not like 'data:%');

alter table public.personnages
  add constraint personnages_photo_sans_base64 check (coalesce(photo, '') not like 'data:%');

alter table public.tenants
  add constraint tenants_logo_sans_base64 check (coalesce(logo, '') not like 'data:%');
