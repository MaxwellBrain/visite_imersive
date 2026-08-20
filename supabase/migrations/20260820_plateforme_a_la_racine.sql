-- ============================================================================
-- ARCHITECTURE — la plateforme occupe la RACINE, « musea » devient un locataire
-- ----------------------------------------------------------------------------
-- CORRECTION DE CONCEPTION (2026-08-20).
--
-- AVANT : la plateforme vivait sur `musea.nexacode.store`, et les organisations
--         sous `<slug>.musea.nexacode.store`.
-- APRÈS : la plateforme vit sur `nexacode.store` — vitrine, inscription et
--         back-office du super-admin — et CHAQUE organisation occupe
--         `<slug>.nexacode.store`, le slug étant choisi à l'inscription.
--
-- Conséquence directe : `musea` n'est plus un nom de système mais un nom
-- d'organisation comme un autre. Le laisser dans `slugs_reserves` le rendrait
-- impossible à attribuer, alors que c'est précisément ce qu'on veut permettre.
--
-- Les autres réservations (admin, api, www, login…) restent : ce sont de vrais
-- noms d'infrastructure, et les laisser prendre par une organisation créerait
-- des adresses ambiguës — voire un risque d'usurpation sur `login`.
--
-- Le miroir applicatif de cette liste est dans src/services/host.js
-- (RESERVED_SUBDOMAINS) : les deux doivent rester d'accord.
-- ============================================================================

DELETE FROM public.slugs_reserves WHERE slug = 'musea';

COMMENT ON TABLE public.slugs_reserves IS
  'Noms de sous-domaine réservés à la plateforme, jamais attribuables à une organisation. Miroir de RESERVED_SUBDOMAINS dans src/services/host.js — tenir les deux d''accord.';
