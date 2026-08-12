-- ============================================================================
-- ENTREPÔT DE DONNÉES — modèle en étoile pour le pilotage
-- ----------------------------------------------------------------------------
-- Le tableau de bord actuel COMPTE (objets publiés, vues, commandes). Il ne
-- permet aucune analyse croisée : « quel secteur rapporte le plus au premier
-- trimestre ? » n'a pas de réponse. Ce module apporte la couche décisionnelle.
--
-- DÉCISION D'ARCHITECTURE, ET POURQUOI ELLE COMPTE ICI
--
-- Le réflexe serait des VUES MATÉRIALISÉES, plus rapides. C'est un piège dans
-- une plateforme multi-tenant : une vue matérialisée est un instantané détenu
-- par son propriétaire, sur lequel la RLS des tables sources ne s'applique
-- plus. Une organisation y lirait les chiffres d'affaires des autres.
--
-- On emploie donc des VUES ORDINAIRES avec `security_invoker = true`
-- (PostgreSQL 15+ ; le projet tourne en 17) : la vue s'exécute avec les droits
-- de l'APPELANT, la RLS de `objects`, `orders` et `object_views` continue donc
-- de s'appliquer, et chaque organisation ne voit que ses propres faits.
-- Le coût de recalcul est négligeable à cette échelle, et la sécurité prime.
--
-- Convention de nommage : dw_ (data warehouse), dim_ (dimension), fait_.
-- ============================================================================

-- ============================= DIMENSIONS ===================================

-- Dimension temps : engendrée à partir de l'amplitude réelle des faits, pour
-- ne pas fabriquer des années vides. Les mois SANS activité restent présents
-- dans l'intervalle : c'est justement ce qui permet de voir les creux.
CREATE OR REPLACE VIEW public.dw_dim_temps
WITH (security_invoker = true) AS
WITH bornes AS (
  SELECT
    least(
      coalesce((SELECT min(jour) FROM public.object_views), current_date),
      coalesce((SELECT min(created_at)::date FROM public.orders), current_date)
    ) AS debut,
    greatest(
      coalesce((SELECT max(jour) FROM public.object_views), current_date),
      coalesce((SELECT max(created_at)::date FROM public.orders), current_date)
    ) AS fin
)
SELECT
  d::date                                        AS jour,
  extract(year  FROM d)::int                     AS annee,
  extract(quarter FROM d)::int                   AS trimestre,
  extract(month FROM d)::int                     AS mois,
  to_char(d, 'TMMonth')                          AS nom_mois,
  extract(week FROM d)::int                      AS semaine,
  extract(isodow FROM d)::int                    AS jour_semaine,
  to_char(d, 'TMDay')                            AS nom_jour,
  -- Le week-end se lit différemment dans un musée : on le marque dès la dimension.
  (extract(isodow FROM d)::int >= 6)             AS est_weekend,
  date_trunc('month', d)::date                   AS debut_mois
FROM bornes, generate_series(bornes.debut, bornes.fin, interval '1 day') AS d;

COMMENT ON VIEW public.dw_dim_temps IS
  'Dimension temps engendrée sur l''amplitude réelle des faits. Les jours sans activité sont conservés : ils font les creux.';

-- Dimension objet, dénormalisée jusqu'au musée : c'est la table que le
-- décideur interroge, il ne doit pas avoir à joindre trois niveaux lui-même.
CREATE OR REPLACE VIEW public.dw_dim_objet
WITH (security_invoker = true) AS
SELECT
  o.id                AS objet_id,
  o.tenant_id,
  o.nom               AS objet,
  o.nom_commun,
  o.published         AS publie,
  o.published_at      AS publie_le,
  s.id                AS secteur_id,
  s.nom               AS secteur,
  s.etage,
  m.id                AS musee_id,
  m.nom               AS musee,
  m.type              AS type_musee,
  (o.model3d IS NOT NULL OR o.model_usdz IS NOT NULL) AS a_3d,
  (o.embedding IS NOT NULL)                            AS a_plongement
FROM public.objects o
LEFT JOIN public.sectors s ON s.id = o.sector_id
LEFT JOIN public.museums m ON m.id = s.museum_id;

CREATE OR REPLACE VIEW public.dw_dim_musee
WITH (security_invoker = true) AS
SELECT
  m.id AS musee_id, m.tenant_id, m.nom AS musee, m.type AS type_musee,
  m.annee_fondation, m.published AS publie,
  (SELECT count(*) FROM public.sectors s WHERE s.museum_id = m.id) AS nb_secteurs,
  (SELECT count(*) FROM public.objects o
     JOIN public.sectors s2 ON s2.id = o.sector_id
    WHERE s2.museum_id = m.id) AS nb_objets
FROM public.museums m;

-- ================================ FAITS =====================================

-- Fait de fréquentation. Grain : un objet, un jour. `object_views` est déjà
-- agrégée à ce grain — aucune donnée personnelle n'entre donc dans l'entrepôt,
-- ce qui règle d'emblée la question de la conservation des traces de visite.
CREATE OR REPLACE VIEW public.dw_fait_visite
WITH (security_invoker = true) AS
SELECT
  v.jour, v.object_id AS objet_id, v.tenant_id, v.vues,
  d.musee_id, d.musee, d.secteur_id, d.secteur, d.objet
FROM public.object_views v
LEFT JOIN public.dw_dim_objet d ON d.objet_id = v.object_id;

-- Fait de vente. Grain : une ligne de commande. On ne retient que les
-- commandes PAYÉES : un panier abandonné n'est pas un chiffre d'affaires.
CREATE OR REPLACE VIEW public.dw_fait_vente
WITH (security_invoker = true) AS
SELECT
  coalesce(o.paid_at, o.created_at)::date AS jour,
  i.id            AS ligne_id,
  i.order_id,
  i.tenant_id,
  i.type          AS type_article,
  i.label         AS article,
  i.montant,
  o.devise,
  i.museum_id     AS musee_id,
  m.nom           AS musee,
  o.moyen_paiement,
  o.user_id
FROM public.order_items i
JOIN public.orders o ON o.id = i.order_id
LEFT JOIN public.museums m ON m.id = i.museum_id
WHERE o.statut = 'payee';

COMMENT ON VIEW public.dw_fait_vente IS
  'Lignes de commandes PAYÉES uniquement : un panier abandonné n''est pas un chiffre d''affaires.';

-- ========================== ANALYSE OLAP ====================================
-- ROLLUP donne, en UNE passe, le détail ET tous les sous-totaux : par musée et
-- par mois, par musée tous mois confondus, puis le total général. C'est
-- exactement ce qu'un tableau croisé affiche — calculé côté base.
CREATE OR REPLACE FUNCTION public.bi_cube_ventes(
  p_depuis date DEFAULT NULL,
  p_jusqu  date DEFAULT NULL
)
RETURNS TABLE(musee text, mois date, nb_lignes bigint, chiffre numeric, niveau text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    -- Deux NULL de nature opposée arrivent ici : celui d'une ligne sans musée
    -- rattaché, et celui que ROLLUP produit pour la ligne de TOTAL. Les
    -- confondre sous « (sans musée) » attribuerait le total général à un poste
    -- qui n'existe pas — on teste donc grouping() AVANT de combler.
    CASE WHEN grouping(v.musee) = 1 THEN 'TOUS MUSÉES'
         ELSE coalesce(v.musee, '(sans musée)') END AS musee,
    date_trunc('month', v.jour)::date      AS mois,
    count(*)                               AS nb_lignes,
    sum(v.montant)                         AS chiffre,
    CASE
      WHEN grouping(v.musee) = 1 AND grouping(date_trunc('month', v.jour)) = 1 THEN 'total'
      WHEN grouping(date_trunc('month', v.jour)) = 1 THEN 'sous_total_musee'
      ELSE 'detail'
    END                                    AS niveau
  FROM public.dw_fait_vente v
  WHERE (p_depuis IS NULL OR v.jour >= p_depuis)
    AND (p_jusqu  IS NULL OR v.jour <= p_jusqu)
  GROUP BY ROLLUP (v.musee, date_trunc('month', v.jour))
  ORDER BY musee NULLS LAST, mois NULLS LAST;
$$;

-- Fréquentation agrégée par mois et par musée, avec la part de chaque musée.
CREATE OR REPLACE FUNCTION public.bi_frequentation(
  p_depuis date DEFAULT NULL,
  p_jusqu  date DEFAULT NULL
)
RETURNS TABLE(mois date, musee text, vues bigint, objets_vus bigint, part_pourcent numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT date_trunc('month', f.jour)::date AS mois,
           coalesce(f.musee, '(sans musée)') AS musee,
           sum(f.vues)::bigint               AS vues,
           count(DISTINCT f.objet_id)::bigint AS objets_vus
    FROM public.dw_fait_visite f
    WHERE (p_depuis IS NULL OR f.jour >= p_depuis)
      AND (p_jusqu  IS NULL OR f.jour <= p_jusqu)
    GROUP BY 1, 2
  )
  SELECT b.mois, b.musee, b.vues, b.objets_vus,
         round(100.0 * b.vues / nullif(sum(b.vues) OVER (PARTITION BY b.mois), 0), 1)
  FROM base b
  ORDER BY b.mois DESC, b.vues DESC;
$$;

GRANT SELECT ON public.dw_dim_temps, public.dw_dim_objet, public.dw_dim_musee,
                public.dw_fait_visite, public.dw_fait_vente TO authenticated;
GRANT EXECUTE ON FUNCTION public.bi_cube_ventes(date, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bi_frequentation(date, date) TO authenticated;

COMMENT ON FUNCTION public.bi_cube_ventes(date, date) IS
  'Ventes en ROLLUP musée × mois : détail, sous-totaux par musée, total général — en une passe.';
