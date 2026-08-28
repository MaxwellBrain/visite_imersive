-- ============================================================================
-- RÉALITÉ AUGMENTÉE SEULE — objets qu'on ne manipule pas, qu'on habite
-- ----------------------------------------------------------------------------
-- À exécuter dans l'éditeur SQL de Supabase (ou via `supabase db push`).
--
-- POURQUOI CETTE COLONNE EXISTE
--
-- La fiche d'un objet propose deux boutons : « Poser dans votre espace » (RA) et
-- « Voir en 3D » (une visionneuse où l'on fait tourner la pièce). Ce couple est
-- juste pour un masque ou un tabouret : on tourne l'objet dans sa main, puis on
-- le pose chez soi.
--
-- Il est FAUX pour une architecture. Une case obus mousgoum fait plusieurs
-- mètres. La faire pivoter dans un cadre de trois cents pixels ne dit rien
-- d'elle — pire, cela la présente comme un bibelot qu'on retourne, alors que
-- son sujet est précisément l'échelle : on y ENTRE, on ne la tient pas. Seule
-- la réalité augmentée restitue ce rapport, en la dressant à sa taille réelle
-- dans la cour où se tient le visiteur.
--
-- D'où un réglage par objet plutôt qu'un cas particulier codé en dur sur la
-- case mousgoum : le jour où une chefferie numérise son grenier à mil ou sa
-- case-cuisine, le conservateur coche la même case, et personne ne retouche au
-- code. Une exception écrite dans le code est une exception qu'il faut rouvrir
-- à chaque nouvelle pièce.
--
-- La valeur par défaut est `false` : rien ne change pour les objets existants.
-- ============================================================================

ALTER TABLE public.objects
  ADD COLUMN IF NOT EXISTS ar_seulement boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.objects.ar_seulement IS
  'true = seule la réalité augmentée est proposée, la visionneuse 3D est masquée. Pour les pièces dont le sujet est l''échelle (architecture) : les faire tourner dans un cadre les dénature.';
