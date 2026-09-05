-- ============================================================================
-- SÉPARER « IL Y A UN MODÈLE » DE « ON PEUT LE VOIR EN RÉALITÉ AUGMENTÉE »
-- ----------------------------------------------------------------------------
-- `a_3d` vaut vrai dès qu'UN modèle existe, quel qu'il soit :
--
--     (model3d is not null) or (model3d_ios is not null) or (model_usdz is not null)
--
-- Le site public s'en servait pour proposer À LA FOIS la visionneuse 3D et la
-- réalité augmentée. Conséquence, dans les deux sens :
--
--   · un objet n'ayant qu'un .usdz annonçait une 3D qu'aucun navigateur ne sait
--     afficher à l'écran ;
--   · un objet n'ayant qu'un .glb annonçait une réalité augmentée qu'un iPhone
--     ne peut pas ouvrir, faute de Quick Look.
--
-- Dans les deux cas le visiteur cliquait sur une promesse vide. Ce n'est pas un
-- défaut d'affichage : c'est une fonction annoncée puis absente, sur une fiche
-- dont l'accès est parfois payant.
--
-- On expose donc les deux capacités séparément. `a_3d` reste en place — d'autres
-- écrans s'en servent, et le supprimer casserait des requêtes existantes — mais
-- il ne décide plus seul de ce qu'on propose au visiteur.
--
-- Colonnes GÉNÉRÉES, comme `a_3d` : elles ne peuvent pas se désynchroniser des
-- colonnes qu'elles résument, et aucun code applicatif n'a à les tenir à jour.
-- ============================================================================

alter table public.objects
  add column if not exists a_glb boolean
    generated always as (model3d is not null) stored;

alter table public.objects
  add column if not exists a_ar_ios boolean
    generated always as (model3d_ios is not null or model_usdz is not null) stored;

comment on column public.objects.a_glb is
  'Un maillage .glb existe : la visionneuse 3D à l''écran est possible, et la RA sur Android (Scene Viewer / WebXR).';
comment on column public.objects.a_ar_ios is
  'Un .usdz existe : Quick Look est possible sur iPhone et iPad. Seul format que la RA iOS sait ouvrir.';
