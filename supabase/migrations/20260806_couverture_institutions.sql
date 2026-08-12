-- ============================================================================
-- MÉMOIRE RÉUNIFIÉE — couverture institutionnelle
-- ----------------------------------------------------------------------------
-- OBJECTIF : pouvoir affirmer, chiffre à l'appui, sur COMBIEN D'INSTITUTIONS
-- porte la recherche d'objets frères. Jusqu'ici c'était impossible : le musée
-- détenteur n'était stocké nulle part. Les adaptateurs le connaissent pourtant
-- déjà (champ `musee` de la forme commune) — il se perdait à l'écriture.
--
-- MESURES QUI ONT DICTÉ CE TRAVAIL (faites sur les points d'accès réels,
-- le 2026-08-06, pas supposées) :
--
--   Wikidata, objets de pays d'origine = Cameroun (Q1009) :
--     • P495 seul .......... 1414 objets, mais SIX institutions seulement
--                            renseignent P195 (collection détentrice)
--     • P2596 (culture) ....    4 objets — propriété quasi vide en ethnographie
--     • P189 (lieu de découverte)  3 objets
--   → Wikidata PLAFONNE à 6 institutions. Il ne mènera jamais à 40.
--
--   museum-digital (nat.museum-digital.de), recherche « Kamerun » :
--     • 2311 objets annoncés ; sur 672 parcourus, DÉJÀ 22 institutions
--       distinctes. C'est la source qui apporte la diversité, et elle
--       s'explique historiquement : le Cameroun fut colonie allemande
--       (1884-1916), l'essentiel des collections est en Allemagne.
--
-- D'où l'ajout de museum-digital à la liste blanche des sources.
-- ============================================================================

-- ------------------------------------------------- 1. Colonnes manquantes ---
ALTER TABLE public.objets_externes  ADD COLUMN IF NOT EXISTS institution text;
ALTER TABLE public.objets_externes  ADD COLUMN IF NOT EXISTS pays_musee  text;
ALTER TABLE public.object_siblings  ADD COLUMN IF NOT EXISTS institution text;
ALTER TABLE public.object_siblings  ADD COLUMN IF NOT EXISTS pays_musee  text;

-- Compter les institutions distinctes est LA requête de ce module : on l'indexe.
CREATE INDEX IF NOT EXISTS objets_externes_institution_idx
  ON public.objets_externes(institution) WHERE institution IS NOT NULL;
CREATE INDEX IF NOT EXISTS object_siblings_institution_idx
  ON public.object_siblings(institution) WHERE institution IS NOT NULL;

COMMENT ON COLUMN public.objets_externes.institution IS
  'Musée détenteur. Renseigné par l''adaptateur ; c''est l''unité de compte de la couverture.';
COMMENT ON COLUMN public.objets_externes.pays_musee IS
  'Pays du musée détenteur — sert à cartographier la dispersion du patrimoine.';

-- --------------------------------------- 2. Nouvelle source autorisée -------
-- museum-digital : agrégateur allemand, sans clé, pagination `startwert` (24/page).
CREATE OR REPLACE FUNCTION public.source_externe_valide(p_source text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  select p_source in ('met','artic','cleveland','vam','wikidata',
                      'europeana','rijksmuseum','smithsonian','harvard',
                      'museumdigital');
$$;

-- ------------------------------- 3. Le cache retient l'institution ----------
CREATE OR REPLACE FUNCTION public.externes_cacher(p_lignes jsonb)
RETURNS TABLE(source text, source_id text, id bigint, a_embedding boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not is_staff() then raise exception 'reserve au personnel'; end if;

  return query
  with entree as (
    select
      trim(l->>'source')      as source,
      trim(l->>'source_id')   as source_id,
      nullif(trim(l->>'titre'), '')       as titre,
      nullif(trim(l->>'culture'), '')     as culture,
      nullif(trim(l->>'pays'), '')        as pays,
      nullif(trim(l->>'date_objet'), '')  as date_objet,
      nullif(trim(l->>'materiau'), '')    as materiau,
      nullif(trim(l->>'image_url'), '')   as image_url,
      nullif(trim(l->>'source_url'), '')  as source_url,
      nullif(trim(l->>'licence'), '')     as licence,
      nullif(trim(l->>'texte_indexe'), '') as texte_indexe,
      nullif(trim(l->>'institution'), '') as institution,
      nullif(trim(l->>'pays_musee'), '')  as pays_musee
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) as l
    where source_externe_valide(trim(l->>'source'))
      and coalesce(trim(l->>'source_id'), '') <> ''
  ),
  dedup as (
    select distinct on (source, source_id) * from entree order by source, source_id
  ),
  insere as (
    insert into objets_externes as oe
      (source, source_id, titre, culture, pays, date_objet, materiau,
       image_url, source_url, licence, texte_indexe, institution, pays_musee)
    select source, source_id, titre, culture, pays, date_objet, materiau,
           image_url, source_url, licence, texte_indexe, institution, pays_musee
    from dedup
    on conflict (source, source_id) do update set
      titre        = coalesce(oe.titre, excluded.titre),
      culture      = coalesce(oe.culture, excluded.culture),
      pays         = coalesce(oe.pays, excluded.pays),
      date_objet   = coalesce(oe.date_objet, excluded.date_objet),
      materiau     = coalesce(oe.materiau, excluded.materiau),
      image_url    = coalesce(oe.image_url, excluded.image_url),
      source_url   = coalesce(oe.source_url, excluded.source_url),
      licence      = coalesce(oe.licence, excluded.licence),
      texte_indexe = coalesce(oe.texte_indexe, excluded.texte_indexe),
      -- Le cache est GLOBAL : une organisation qui repasse avec une donnée
      -- absente ne doit jamais effacer celle qu'une autre a déjà obtenue.
      institution  = coalesce(oe.institution, excluded.institution),
      pays_musee   = coalesce(oe.pays_musee, excluded.pays_musee)
    returning oe.source, oe.source_id, oe.id, (oe.embedding is not null)
  )
  select * from insere;
end $function$;

-- ------------------------- 4. La proposition emporte l'institution ----------
CREATE OR REPLACE FUNCTION public.freres_proposer(p_object_id bigint, p_lignes jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_tenant bigint; v_n integer;
begin
  select tenant_id into v_tenant from objects where id = p_object_id;
  if v_tenant is null or not can_manage_tenant(v_tenant) then
    raise exception 'objet hors de votre organisation';
  end if;

  with entree as (
    select
      (l->>'externe_id')::bigint as externe_id,
      nullif(trim(l->>'type_lien'), '')     as type_lien,
      nullif(trim(l->>'justification'), '') as justification,
      greatest(0, least(100, coalesce((l->>'score')::integer, 0))) as score
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) as l
  ),
  avec_notice as (
    select distinct on (e.externe_id)
      e.*, oe.source, oe.source_id, oe.titre, oe.culture, oe.pays,
      oe.date_objet, oe.materiau, oe.image_url, oe.source_url,
      oe.institution, oe.pays_musee
    from entree e
    join objets_externes oe on oe.id = e.externe_id
    order by e.externe_id
  ),
  ecrit as (
    insert into object_siblings as s
      (tenant_id, object_id, externe_id, source, external_id, titre, culture, pays,
       date_objet, materiau, image_url, source_url, score, type_lien, justification,
       methode, statut, institution, pays_musee)
    select v_tenant, p_object_id, externe_id, source, source_id, titre, culture, pays,
           date_objet, materiau, image_url, source_url, score, type_lien, justification,
           'semantique', 'propose', institution, pays_musee
    from avec_notice
    on conflict (object_id, source, external_id) do update set
      externe_id    = excluded.externe_id,
      score         = excluded.score,
      -- On rafraîchit type et justification UNIQUEMENT tant que personne n'a
      -- tranché : sinon on écraserait le texte qu'un conservateur a corrigé.
      type_lien     = case when s.statut = 'propose' then excluded.type_lien else s.type_lien end,
      justification = case when s.statut = 'propose' then excluded.justification else s.justification end,
      methode       = 'semantique',
      institution   = coalesce(excluded.institution, s.institution),
      pays_musee    = coalesce(excluded.pays_musee, s.pays_musee)
    returning 1
  )
  select count(*)::integer into v_n from ecrit;
  return v_n;
end $function$;

-- ------------------------------------- 5. Mesurer la couverture -------------
-- Deux chiffres à ne pas confondre, et c'est tout l'intérêt de les séparer :
--   institutions_explorees — ce que la recherche a BALAYÉ (cache global)
--   institutions_retenues  — ce qu'un conservateur a VALIDÉ pour cet objet
-- Le premier justifie l'ampleur de l'enquête, le second sa qualité.
CREATE OR REPLACE FUNCTION public.freres_couverture(p_object_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_res jsonb;
begin
  if not is_staff() then raise exception 'reserve au personnel'; end if;

  select jsonb_build_object(
    'institutions_explorees',
      (select count(distinct institution) from objets_externes where institution is not null),
    'objets_explores',
      (select count(*) from objets_externes),
    'sources_actives',
      (select count(distinct source) from objets_externes),
    'institutions_retenues',
      (select count(distinct institution) from object_siblings
        where institution is not null and statut = 'valide'
          and (p_object_id is null or object_id = p_object_id)
          and can_manage_tenant(tenant_id)),
    'pays_detenteurs',
      (select count(distinct pays_musee) from objets_externes where pays_musee is not null),
    'par_institution',
      (select coalesce(jsonb_agg(x order by x->>'n' desc), '[]'::jsonb) from (
         select jsonb_build_object('institution', institution, 'pays', max(pays_musee),
                                   'n', count(*)) as x
         from objets_externes where institution is not null
         group by institution order by count(*) desc limit 60
       ) t)
  ) into v_res;

  return v_res;
end $function$;

REVOKE ALL ON FUNCTION public.freres_couverture(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.freres_couverture(bigint) TO authenticated;

COMMENT ON FUNCTION public.freres_couverture(bigint) IS
  'Ampleur mesurée de la Mémoire Réunifiée : institutions balayées, objets en cache, musées retenus.';
