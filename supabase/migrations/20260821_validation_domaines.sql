-- ============================================================================
-- VALIDATION DES DOMAINES PERSONNALISÉS
-- ----------------------------------------------------------------------------
-- Jusqu'ici, `domain_verified` se cochait à la main dans le back-office, sans
-- aucune preuve que le domaine appartienne à l'organisation qui le déclare.
-- Deux conséquences :
--   - coché à tort, le site du client ne répond pas et personne ne sait pourquoi ;
--   - surtout, `resolveByDomain()` fait confiance à ce drapeau. N'importe quelle
--     organisation pouvait déclarer le domaine d'une autre et, une fois le
--     drapeau posé, se voir servie à cette adresse.
--
-- On demande donc une PREUVE DE POSSESSION : un enregistrement TXT que seul le
-- détenteur du domaine peut poser. Le jeton vit dans sa propre table, car
-- `tenants` est lisible par tout visiteur dès qu'une organisation est approuvée
-- (policy `tenants_public_read`) — l'y ranger l'aurait rendu public.
-- ============================================================================

create table if not exists public.tenant_domain_verification (
  tenant_id        bigint primary key references public.tenants(id) on delete cascade,
  domaine          text        not null,
  jeton            text        not null,
  cree_le          timestamptz not null default now(),
  dernier_essai    timestamptz,
  dernier_resultat text,
  verifie_le       timestamptz
);

comment on table public.tenant_domain_verification is
  'Preuve de possession d''un domaine personnalise. Le jeton est secret : il ne '
  'doit jamais transiter par la table tenants, lisible publiquement.';

alter table public.tenant_domain_verification enable row level security;

-- Seuls l'organisation concernée (son personnel) et le super-admin voient le jeton.
drop policy if exists tdv_lecture on public.tenant_domain_verification;
create policy tdv_lecture on public.tenant_domain_verification
  for select using (public.can_manage_tenant(tenant_id));

-- Personne n'écrit ici depuis l'application : la ligne est posée par le trigger
-- ci-dessous, et le résultat de la vérification par la fonction de bord, qui
-- passe par la clé de service et ignore la RLS.

-- ----------------------------------------------------------------------------
-- Le jeton naît avec le domaine, et meurt avec lui.
--
-- Point important : changer de domaine REMET la vérification à zéro. Sans cela,
-- il suffirait de faire vérifier un domaine que l'on possède, puis de le
-- remplacer par celui d'un tiers en gardant le drapeau.
-- ----------------------------------------------------------------------------
create or replace function public.tenants_domaine_modifie()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare nouveau text; ancien text;
begin
  nouveau := nullif(lower(trim(coalesce(new.custom_domain, ''))), '');
  new.custom_domain := nouveau;
  ancien := case when tg_op = 'INSERT' then null
                 else nullif(lower(trim(coalesce(old.custom_domain, ''))), '') end;

  -- Les deux valeurs sont normalisées avant comparaison : sans cela, NULL et
  -- chaîne vide passeraient pour un changement et remettraient la vérification
  -- à zéro à chaque enregistrement du formulaire.
  if nouveau is distinct from ancien then
    new.domain_verified := false;

    if nouveau is null then
      delete from public.tenant_domain_verification where tenant_id = new.id;
    else
      insert into public.tenant_domain_verification (tenant_id, domaine, jeton)
      values (new.id, nouveau, replace(gen_random_uuid()::text, '-', ''))
      on conflict (tenant_id) do update
        set domaine = excluded.domaine,
            jeton = excluded.jeton,
            cree_le = now(),
            dernier_essai = null,
            dernier_resultat = null,
            verifie_le = null;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_tenants_domaine on public.tenants;
create trigger trg_tenants_domaine
  before insert or update of custom_domain on public.tenants
  for each row execute function public.tenants_domaine_modifie();

-- ----------------------------------------------------------------------------
-- Le super-admin garde la main : certaines configurations DNS ne se prêtent pas
-- à un TXT (délégation partielle, hébergeur récalcitrant). Mais la dérogation
-- est TRACÉE — on doit pouvoir dire, plus tard, que ce domaine n'a pas été
-- prouvé mais forcé.
-- ----------------------------------------------------------------------------
create or replace function public.forcer_domaine_verifie(p_tenant_id bigint, p_verifie boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then return false; end if;

  update public.tenants set domain_verified = p_verifie where id = p_tenant_id;
  if not found then return false; end if;

  update public.tenant_domain_verification
     set dernier_essai = now(),
         dernier_resultat = case when p_verifie then 'force_par_super_admin'
                                 else 'annule_par_super_admin' end,
         verifie_le = case when p_verifie then now() else null end
   where tenant_id = p_tenant_id;

  return true;
end $$;

-- ----------------------------------------------------------------------------
-- Ce qui attend une décision du super-admin, en un seul appel : les
-- organisations à approuver et les domaines à vérifier. C'est la file de travail
-- du back-office plateforme.
-- ----------------------------------------------------------------------------
create or replace function public.file_validation_plateforme()
returns table (
  tenant_id bigint, slug text, nom text, statut text,
  created_at timestamptz, contact_email text,
  custom_domain text, domain_verified boolean,
  domaine_essaye_le timestamptz, domaine_resultat text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id, t.slug, t.nom, t.statut, t.created_at, t.contact_email,
         t.custom_domain, t.domain_verified,
         v.dernier_essai, v.dernier_resultat
    from public.tenants t
    left join public.tenant_domain_verification v on v.tenant_id = t.id
   where public.is_super_admin()
     and (t.statut = 'en_attente' or (t.custom_domain is not null and not t.domain_verified))
   order by t.created_at desc;
$$;

grant execute on function public.forcer_domaine_verifie(bigint, boolean) to authenticated;
grant execute on function public.file_validation_plateforme() to authenticated;
