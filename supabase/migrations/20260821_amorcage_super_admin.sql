-- ============================================================================
-- AMORÇAGE DU SUPER-ADMIN DE LA PLATEFORME
-- ----------------------------------------------------------------------------
-- Le rôle `super_admin` ne s'attribuait que par une écriture directe en base.
-- Résultat : une plateforme en ligne, avec des organisations en attente, et
-- personne pour les approuver.
--
-- On ouvre donc un écran d'installation — mais UNE SEULE FOIS. C'est le modèle
-- du premier démarrage : le premier compte qui se présente prend la main, puis
-- la porte se referme définitivement. Sans cette condition, l'écran serait une
-- porte ouverte permanente sur les droits les plus élevés du système.
--
-- La condition est vérifiée EN BASE, pas dans la page : une vérification côté
-- navigateur se contourne avec la console.
-- ============================================================================

-- Lisible par tous, y compris hors session : la page d'installation doit savoir
-- si elle a encore lieu d'être AVANT que quiconque se connecte. Ne renvoie
-- qu'un booléen, jamais l'identité de qui que ce soit.
create or replace function public.plateforme_a_un_super_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.profiles where role = 'super_admin');
$$;

-- Promeut l'appelant, et lui seul. Trois verrous :
--   1. il faut être authentifié — le compte vient d'être créé par la page ;
--   2. aucun super-admin ne doit exister ;
--   3. `tenant_id` est remis à NULL : l'administrateur de la plateforme
--      n'appartient à aucun locataire, sinon le cloisonnement le renverrait
--      vers un sous-domaine (voir le garde-fou du routeur).
create or replace function public.amorcer_super_admin()
returns table (ok boolean, raison text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    return query select false, 'non_authentifie'; return;
  end if;

  if exists (select 1 from public.profiles where role = 'super_admin') then
    return query select false, 'deja_configure'; return;
  end if;

  update public.profiles
     set role = 'super_admin',
         tenant_id = null
   where id = uid;

  if not found then
    return query select false, 'profil_introuvable'; return;
  end if;

  return query select true, 'promu';
end $$;

grant execute on function public.plateforme_a_un_super_admin() to anon, authenticated;
grant execute on function public.amorcer_super_admin() to authenticated;
