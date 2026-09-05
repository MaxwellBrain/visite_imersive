-- ============================================================================
-- PLUSIEURS VUES PAR OBJET
-- ----------------------------------------------------------------------------
-- POURQUOI
--
-- Une pièce de musée ne se donne pas dans une seule image. Un masque a une
-- face, un profil, un revers ; une statuette a un dessous portant une marque
-- d'inventaire ; un tissu a un détail de trame qu'aucune vue d'ensemble ne
-- montre. L'ERP n'acceptait qu'UNE photo par objet : le conservateur devait
-- choisir laquelle des trois vues il sacrifiait.
--
-- `photo` reste la VUE DE COUVERTURE — celle des listes, des vignettes, des
-- cartes de partage, du cabinet des pièces sœurs. Rien de tout cela ne change.
-- `photos` ajoute les vues COMPLÉMENTAIRES, affichées sur la fiche publique à
-- côté de la notice.
--
-- FORME : [{ "url": "https://…", "legende": "Profil droit" }, …]
--
-- Un tableau JSON plutôt qu'une table `object_photos` : ces vues n'ont ni vie
-- propre, ni droits propres, ni requête qui les cherche sans leur objet. Elles
-- sont toujours lues et écrites avec lui. Une table imposerait une jointure et
-- un jeu de politiques RLS supplémentaires pour ne rien gagner.
--
-- L'ORDRE DU TABLEAU EST L'ORDRE D'AFFICHAGE. Le conservateur le règle dans
-- l'ERP ; aucune colonne `position` n'est donc nécessaire.
-- ============================================================================

alter table public.objects
  add column if not exists photos jsonb not null default '[]'::jsonb;

comment on column public.objects.photos is
  'Vues complementaires de l''objet : [{url, legende}]. La vue de couverture '
  'reste dans `photo`. L''ordre du tableau est l''ordre d''affichage.';

-- ----------------------------------------------------------------------------
-- MÊME GARDE QUE 20260821_interdire_base64_en_base.sql
--
-- La colonne `photo` est protégée contre les DATA URL depuis que trois mégas de
-- base64 ont été mesurés dans `site_settings`. Ouvrir une galerie sans la même
-- protection rouvrirait la porte par le côté — et multipliée par le nombre de
-- vues, la facture serait pire.
--
-- Une contrainte CHECK n'accepte pas de sous-requête : le parcours du tableau
-- passe donc par une fonction immuable.
-- ----------------------------------------------------------------------------
create or replace function public.galerie_valide(p jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(
    coalesce(e ->> 'url', '') <> ''
    and coalesce(e ->> 'url', '') not like 'data:%'
  ), true)
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
$$;

comment on function public.galerie_valide(jsonb) is
  'Vrai si chaque entree de galerie porte une URL non vide qui n''est pas une '
  'DATA URL base64. Utilisee en contrainte CHECK (qui interdit les sous-requetes).';

alter table public.objects
  add constraint objects_photos_forme check (
    jsonb_typeof(photos) = 'array'
    and jsonb_array_length(photos) <= 12
    and public.galerie_valide(photos)
  );

comment on constraint objects_photos_forme on public.objects is
  'Tableau de 12 vues au plus, chacune avec une URL de Storage. Le plafond n''est '
  'pas decoratif : la fiche publique charge ces images, et une galerie sans borne '
  'redevient le probleme de poids que le passage au Storage a resolu.';
