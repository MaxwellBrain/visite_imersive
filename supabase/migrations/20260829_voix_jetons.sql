-- LE COMPTEUR DE JETONS VOCAUX — le garde-fou de `jeton-voix`.
--
-- POURQUOI IL EXISTE. Le point d'entrée `jeton-voix` est NÉCESSAIREMENT PUBLIC :
-- le visiteur d'un musée n'a pas de compte. Or chaque jeton délivré ouvre chez
-- xAI une conversation FACTURÉE À LA MINUTE. Sans compteur, une boucle lancée
-- depuis n'importe quel navigateur viderait le crédit d'une chefferie en une
-- nuit, et personne ne s'en apercevrait avant la facture.
--
-- ON COMPTE UN USAGE, ON NE SUIT PERSONNE. La colonne `empreinte` reçoit un
-- SHA-256 salé de l'adresse IP, calculé dans l'Edge Function : l'adresse elle-
-- même n'entre jamais dans la base. Le sel (`SEL_EMPREINTE`) est ce qui empêche
-- de retrouver l'IP par force brute — l'espace IPv4 est petit, un hachage nu s'y
-- inverse en quelques minutes.
--
-- AUCUNE POLITIQUE RLS N'OUVRE CETTE TABLE, et c'est délibéré : RLS est activé,
-- aucune policy n'est créée, donc personne n'y accède avec la clé anonyme. Seule
-- la fonction ci-dessous y écrit, en SECURITY DEFINER, appelée par l'Edge
-- Function avec la clé de service.
create table if not exists public.voix_jetons (
  id         bigint generated always as identity primary key,
  empreinte  text        not null,
  tenant_id  bigint,
  object_id  bigint,
  created_at timestamptz not null default now()
);

-- L'index porte sur le COUPLE interrogé par le compteur : une empreinte, une
-- fenêtre de temps. Sans lui, chaque demande de jeton lirait toute la table.
create index if not exists voix_jetons_compte_idx
  on public.voix_jetons (empreinte, created_at desc);

alter table public.voix_jetons enable row level security;

-- COMPTER ET INSCRIRE DANS LE MÊME APPEL, et c'est le point important : un
-- « lire puis écrire » depuis l'Edge Function laisserait passer deux demandes
-- simultanées au moment précis où le plafond est atteint. Ici, la lecture et
-- l'insertion se font dans la même transaction.
--
-- SECURITY DEFINER parce que la table n'est ouverte à personne (voir plus haut) ;
-- `search_path` figé parce qu'une fonction SECURITY DEFINER dont le chemin est
-- modifiable par l'appelant est une élévation de privilège.
create or replace function public.voix_jeton_autorise(
  p_empreinte       text,
  p_tenant          bigint,
  p_object          bigint,
  p_plafond         integer default 20,
  p_fenetre_minutes integer default 10
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_recents integer;
BEGIN
  SELECT count(*) INTO v_recents
    FROM public.voix_jetons j
   WHERE j.empreinte = p_empreinte
     AND j.created_at > now() - make_interval(mins => p_fenetre_minutes);

  IF v_recents >= p_plafond THEN
    RETURN false;
  END IF;

  INSERT INTO public.voix_jetons (empreinte, tenant_id, object_id)
  VALUES (p_empreinte, p_tenant, p_object);

  -- Ménage opportuniste : la table ne sert qu'à compter sur dix minutes, elle
  -- n'a aucune raison de grandir indéfiniment. On purge une fois sur cinquante
  -- plutôt que d'installer une tâche planifiée pour trois lignes.
  IF random() < 0.02 THEN
    DELETE FROM public.voix_jetons WHERE created_at < now() - interval '1 day';
  END IF;

  RETURN true;
END $$;

-- Seul le rôle de service appelle cette fonction — jamais le navigateur.
revoke all on function public.voix_jeton_autorise(text, bigint, bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.voix_jeton_autorise(text, bigint, bigint, integer, integer) to service_role;
