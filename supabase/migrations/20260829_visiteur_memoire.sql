-- LA MÉMOIRE DU VISITEUR — ce que la pièce se rappelle vous avoir dit.
--
-- LE PROBLÈME QU'ELLE RÉSOUT. Un objet qui ouvre toujours sur son détail le plus
-- frappant devient une borne : le visiteur qui revient entend le même mot pour
-- mot, et l'illusion tombe d'un coup. Le message d'accueil généré par le modèle
-- change la FORMULATION ; il ne change pas le SUJET, parce qu'on demande à la
-- pièce d'ouvrir sur ce qu'elle a de plus saisissant, et que c'est toujours le
-- même. Il faut donc que quelqu'un se souvienne — et ce quelqu'un, c'est ici.
--
-- CE QU'ON STOCKE, ET CE QU'ON NE STOCKE PAS.
--
-- On stocke : un identifiant tiré au sort par le NAVIGATEUR, la pièce concernée,
-- le nombre de visites, et la liste des ANGLES déjà servis — « le chef Gacha »,
-- « la salle », « la rareté ». Rien d'autre.
--
-- On ne stocke PAS ce que le visiteur a dit. Pas une phrase, pas un mot. Une
-- conversation devant une vitrine n'a pas à laisser de trace : ce qu'on retient,
-- c'est ce que la PIÈCE a raconté, pour ne pas le répéter. La distinction n'est
-- pas cosmétique — elle sépare un objet courtois d'un objet qui écoute.
--
-- L'IDENTIFIANT N'EST PAS UNE IDENTITÉ. Il est tiré au sort dans le navigateur,
-- ne quitte jamais l'appareil autrement que pour cette table, et disparaît si le
-- visiteur vide son stockage. Il ne se rattache à aucun compte, aucun e-mail,
-- aucune adresse IP. Il ne dit pas QUI vous êtes ; il dit seulement « ce
-- navigateur-là est déjà passé devant cette pièce-là ».
create table if not exists public.visiteur_memoire (
  id            bigint generated always as identity primary key,
  visiteur      text        not null,
  object_id     bigint      not null,
  tenant_id     bigint,
  visites       integer     not null default 1,
  -- Les angles déjà servis, du PLUS ANCIEN au plus récent. L'ordre est ce qui
  -- permet de revenir au moins récemment utilisé quand ils ont tous été vus.
  angles        text[]      not null default '{}',
  vu_le         timestamptz not null default now(),
  cree_le       timestamptz not null default now(),
  unique (visiteur, object_id)
);

create index if not exists visiteur_memoire_vu_idx
  on public.visiteur_memoire (vu_le);

-- Aucune politique n'est créée, et c'est délibéré : RLS actif sans policy ferme
-- la table à la clé anonyme. Seule la fonction ci-dessous y touche, appelée par
-- l'Edge Function avec la clé de service.
alter table public.visiteur_memoire enable row level security;

-- CHOISIR L'ANGLE ET L'ENREGISTRER DANS LE MÊME APPEL.
--
-- Un « lire puis écrire » depuis l'Edge Function laisserait deux onglets ouverts
-- en même temps recevoir le même angle. Ici, la lecture, le choix et l'écriture
-- tiennent dans une transaction.
--
-- LA RÈGLE DE CHOIX, en deux temps :
--   1. le premier angle proposé qui n'a jamais été servi ;
--   2. s'ils ont tous été vus, le MOINS RÉCEMMENT servi — c'est-à-dire le
--      premier de la liste, puisqu'on ajoute à la fin.
-- Une pièce à trois angles ne devient donc jamais muette : elle tourne.
create or replace function public.visiteur_angle(
  p_visiteur text,
  p_object   bigint,
  p_tenant   bigint,
  p_angles   text[]
) returns table (visites integer, choisi text, deja text[])
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_ligne  public.visiteur_memoire%ROWTYPE;
  v_choisi text;
  v_vus    text[];
  v_reste  text[];
BEGIN
  IF p_visiteur IS NULL OR btrim(p_visiteur) = '' OR p_angles IS NULL OR array_length(p_angles, 1) IS NULL THEN
    -- Pas d'identifiant, ou pas d'angle à proposer : on ne retient rien et on
    -- laisse l'appelant se comporter comme avant. La mémoire est un supplément,
    -- jamais une condition.
    RETURN QUERY SELECT 0, NULL::text, '{}'::text[];
    RETURN;
  END IF;

  SELECT * INTO v_ligne
    FROM public.visiteur_memoire m
   WHERE m.visiteur = p_visiteur AND m.object_id = p_object;

  v_vus := COALESCE(v_ligne.angles, '{}'::text[]);

  -- Les angles proposés que ce visiteur n'a jamais entendus, dans l'ordre donné.
  SELECT array_agg(a ORDER BY o) INTO v_reste
    FROM unnest(p_angles) WITH ORDINALITY AS t(a, o)
   WHERE NOT (a = ANY (v_vus));

  IF v_reste IS NOT NULL AND array_length(v_reste, 1) > 0 THEN
    v_choisi := v_reste[1];
  ELSE
    -- Tout a été vu : on reprend le plus ancien encore valable, en ignorant les
    -- angles qui n'existent plus (une notice peut avoir perdu un chef lié).
    SELECT a INTO v_choisi
      FROM unnest(v_vus) WITH ORDINALITY AS t(a, o)
     WHERE a = ANY (p_angles)
     ORDER BY o
     LIMIT 1;
    IF v_choisi IS NULL THEN v_choisi := p_angles[1]; END IF;
    -- On le retire de sa position ancienne : il repart à la fin.
    v_vus := array_remove(v_vus, v_choisi);
  END IF;

  IF v_ligne.id IS NULL THEN
    INSERT INTO public.visiteur_memoire (visiteur, object_id, tenant_id, visites, angles)
    VALUES (p_visiteur, p_object, p_tenant, 1, ARRAY[v_choisi]);
    RETURN QUERY SELECT 1, v_choisi, '{}'::text[];
  ELSE
    UPDATE public.visiteur_memoire m
       SET visites = m.visites + 1,
           angles  = (v_vus || v_choisi),
           vu_le   = now()
     WHERE m.id = v_ligne.id;
    RETURN QUERY SELECT v_ligne.visites + 1, v_choisi, v_vus;
  END IF;

  -- Ménage opportuniste : une visite d'il y a six mois ne dit plus rien d'utile,
  -- et garder ces lignes indéfiniment serait conserver sans raison. Une fois sur
  -- cent plutôt qu'une tâche planifiée pour quelques milliers de lignes.
  IF random() < 0.01 THEN
    DELETE FROM public.visiteur_memoire WHERE vu_le < now() - interval '180 days';
  END IF;
END $$;

revoke all on function public.visiteur_angle(text, bigint, bigint, text[]) from public, anon, authenticated;
grant execute on function public.visiteur_angle(text, bigint, bigint, text[]) to service_role;
