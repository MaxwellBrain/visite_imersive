-- ============================================================================
-- RÈGLES D'ASSOCIATION — « souvent ensemble »
-- ----------------------------------------------------------------------------
-- Deux usages, deux niveaux de fiabilité qu'il ne faut SURTOUT pas confondre :
--
--   bi_regles_panier   — analyse de panier au sens strict. La transaction est
--                        la COMMANDE : deux articles y sont ensemble ou non,
--                        sans ambiguïté. Résultat exploitable pour la vente
--                        croisée en boutique.
--
--   bi_objets_covus    — co-occurrence de consultation. ATTENTION : la table
--                        `object_views` n'agrège que (objet, jour, nombre) et
--                        ne porte AUCUN identifiant de visiteur — c'est un
--                        choix de conception assumé pour la vie privée. On ne
--                        peut donc pas savoir si la MÊME personne a vu deux
--                        objets ; on observe seulement qu'ils ont été vus le
--                        même jour. C'est un indice de tendance, PAS une
--                        association individuelle. Le nommer autrement serait
--                        malhonnête envers le lecteur du tableau de bord.
--
-- LES TROIS MESURES (vocabulaire du cours de Data Mining) :
--   support(A,B)    = transactions contenant A et B / total des transactions
--   confiance(A→B)  = transactions avec A et B / transactions avec A
--   lift(A→B)       = confiance(A→B) / support(B)
--       lift > 1 : A rend B PLUS probable (association réelle)
--       lift ≈ 1 : indépendance — la règle n'apprend rien
--       lift < 1 : A rend B moins probable
-- Le lift est indispensable : une confiance élevée sur un article vendu
-- partout ne prouve rien, elle ne fait que refléter sa popularité.
-- ============================================================================

-- ------------------------------------------------- Analyse de panier --------
CREATE OR REPLACE FUNCTION public.bi_regles_panier(
  p_support_min numeric DEFAULT 0.02,
  p_limite      integer DEFAULT 40
)
RETURNS TABLE(
  article_a text, article_b text,
  ensemble bigint, support numeric, confiance numeric, lift numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH panier AS (
    -- Un article ne compte qu'UNE fois par commande : sans ce DISTINCT, deux
    -- exemplaires du même billet gonfleraient artificiellement le support.
    SELECT DISTINCT v.order_id, v.article
    FROM public.dw_fait_vente v
    WHERE v.article IS NOT NULL
  ),
  total AS (SELECT count(DISTINCT order_id)::numeric AS n FROM panier),
  frequence AS (
    SELECT article, count(*)::numeric AS n FROM panier GROUP BY article
  ),
  paires AS (
    -- a < b évite de compter deux fois la même paire ; on émet ensuite les
    -- DEUX sens, car la confiance n'est pas symétrique.
    SELECT p1.article AS a, p2.article AS b, count(*)::numeric AS n
    FROM panier p1
    JOIN panier p2 ON p2.order_id = p1.order_id AND p2.article > p1.article
    GROUP BY 1, 2
  ),
  regles AS (
    SELECT a, b, n FROM paires
    UNION ALL
    SELECT b, a, n FROM paires
  )
  SELECT
    r.a, r.b, r.n::bigint,
    round(r.n / t.n, 4)                                   AS support,
    round(r.n / fa.n, 4)                                  AS confiance,
    round((r.n / fa.n) / nullif(fb.n / t.n, 0), 3)        AS lift
  FROM regles r
  CROSS JOIN total t
  JOIN frequence fa ON fa.article = r.a
  JOIN frequence fb ON fb.article = r.b
  WHERE t.n > 0 AND (r.n / t.n) >= p_support_min
  ORDER BY lift DESC NULLS LAST, support DESC
  LIMIT p_limite;
$$;

COMMENT ON FUNCTION public.bi_regles_panier(numeric, integer) IS
  'Analyse de panier sur les commandes payées : support, confiance, lift. La transaction est la commande.';

-- ------------------------------------ Co-consultation (indice, pas preuve) --
CREATE OR REPLACE FUNCTION public.bi_objets_covus(
  p_jours  integer DEFAULT 180,
  p_limite integer DEFAULT 40
)
RETURNS TABLE(
  objet_a text, objet_b text, jours_communs bigint,
  support numeric, confiance numeric, lift numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH vues AS (
    SELECT DISTINCT f.jour, f.objet_id, f.objet
    FROM public.dw_fait_visite f
    WHERE f.objet IS NOT NULL
      AND f.jour >= current_date - make_interval(days => greatest(p_jours, 1))
  ),
  total AS (SELECT count(DISTINCT jour)::numeric AS n FROM vues),
  frequence AS (SELECT objet_id, objet, count(*)::numeric AS n FROM vues GROUP BY 1, 2),
  paires AS (
    SELECT v1.objet_id AS a_id, v2.objet_id AS b_id, count(*)::numeric AS n
    FROM vues v1
    JOIN vues v2 ON v2.jour = v1.jour AND v2.objet_id > v1.objet_id
    GROUP BY 1, 2
  ),
  regles AS (
    SELECT a_id, b_id, n FROM paires
    UNION ALL
    SELECT b_id, a_id, n FROM paires
  )
  SELECT
    fa.objet, fb.objet, r.n::bigint,
    round(r.n / t.n, 4)                            AS support,
    round(r.n / fa.n, 4)                           AS confiance,
    round((r.n / fa.n) / nullif(fb.n / t.n, 0), 3) AS lift
  FROM regles r
  CROSS JOIN total t
  JOIN frequence fa ON fa.objet_id = r.a_id
  JOIN frequence fb ON fb.objet_id = r.b_id
  WHERE t.n > 0
  ORDER BY lift DESC NULLS LAST, support DESC
  LIMIT p_limite;
$$;

COMMENT ON FUNCTION public.bi_objets_covus(integer, integer) IS
  'Objets consultés le MÊME JOUR. object_views ne portant aucun identifiant de visiteur, c''est un indice de tendance, pas une association individuelle.';

-- ------------------------------------------------ Garde-fou statistique -----
-- Une règle calculée sur trois commandes n'a aucune valeur, mais elle S'AFFICHE
-- avec la même autorité qu'une règle solide. Cette fonction dit franchement si
-- le volume autorise à conclure — pour que l'interface puisse avertir.
CREATE OR REPLACE FUNCTION public.bi_fiabilite()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'commandes',      (SELECT count(DISTINCT order_id) FROM public.dw_fait_vente),
    'lignes_vente',   (SELECT count(*) FROM public.dw_fait_vente),
    'jours_observes', (SELECT count(DISTINCT jour) FROM public.dw_fait_visite),
    'objets_vus',     (SELECT count(DISTINCT objet_id) FROM public.dw_fait_visite),
    -- Seuils usuels en fouille de données : en deçà, le bruit domine le signal.
    'panier_exploitable', (SELECT count(DISTINCT order_id) >= 30 FROM public.dw_fait_vente),
    'covues_exploitable', (SELECT count(DISTINCT jour)     >= 30 FROM public.dw_fait_visite),
    'avertissement',
      CASE WHEN (SELECT count(DISTINCT order_id) FROM public.dw_fait_vente) < 30
           THEN 'Volume insuffisant : les règles affichées sont illustratives, non concluantes.'
           ELSE NULL END
  );
$$;

GRANT EXECUTE ON FUNCTION public.bi_regles_panier(numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bi_objets_covus(integer, integer)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bi_fiabilite()                     TO authenticated;
