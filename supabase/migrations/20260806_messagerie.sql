-- ============================================================================
-- MESSAGERIE — boîte de réception de l'organisation
-- ----------------------------------------------------------------------------
-- À exécuter dans l'éditeur SQL de Supabase (ou via `supabase db push`).
--
-- Complète le dispositif e-mail existant, qui ne savait jusqu'ici que PARTIR
-- (send-email / campaigns). Ici on gère l'ARRIVÉE et le fil de discussion.
--
-- Trois canaux, tels que définis avec le commanditaire :
--   public     — un visiteur écrit depuis le site, sans compte
--   commande   — une question rattachée à une commande précise (SAV)
--   plateforme — l'organisation écrit à MUSÉA, et réciproquement
--
-- PRINCIPE DE SÉCURITÉ : `anon` n'obtient AUCUN droit d'écriture sur les tables.
-- Tout ce qui vient du public passe par deux fonctions SECURITY DEFINER qui
-- valident l'organisation, plafonnent le débit et façonnent la ligne elles-mêmes.
-- Un visiteur ne peut donc ni choisir son statut, ni écrire chez autrui.
-- ============================================================================

-- ---------------------------------------------------------------- Le fil ----
CREATE TABLE IF NOT EXISTS public.messages (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          bigint NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  canal              text NOT NULL CHECK (canal IN ('public', 'commande', 'plateforme')),
  sujet              text NOT NULL,

  -- Identité de l'expéditeur. `user_id` est nul quand le visiteur n'a pas de compte :
  -- l'e-mail reste alors le seul moyen de lui répondre, d'où son caractère obligatoire.
  expediteur_nom     text,
  expediteur_email   text,
  user_id            uuid   REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id           bigint REFERENCES public.orders(id) ON DELETE SET NULL,

  statut             text NOT NULL DEFAULT 'nouveau'
                     CHECK (statut IN ('nouveau', 'en_cours', 'traite', 'spam')),
  lu                 boolean NOT NULL DEFAULT false,

  -- Sert au tri de la boîte : un fil remonte dès qu'un message s'y ajoute.
  dernier_message_at timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Un fil « commande » doit désigner sa commande ; sinon le rattachement SAV n'a pas de sens.
  CONSTRAINT messages_commande_a_une_commande
    CHECK (canal <> 'commande' OR order_id IS NOT NULL),
  -- On doit toujours pouvoir répondre : compte connu OU adresse e-mail fournie.
  CONSTRAINT messages_joignable
    CHECK (canal = 'plateforme' OR user_id IS NOT NULL OR expediteur_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS messages_tenant_idx  ON public.messages(tenant_id, dernier_message_at DESC);
CREATE INDEX IF NOT EXISTS messages_statut_idx  ON public.messages(statut);
CREATE INDEX IF NOT EXISTS messages_user_idx    ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS messages_order_idx   ON public.messages(order_id);

-- ------------------------------------------------------- Les échanges du fil --
CREATE TABLE IF NOT EXISTS public.message_replies (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id    bigint NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,

  corps         text NOT NULL,
  -- Qui parle : le visiteur, le personnel de l'organisation, ou l'équipe MUSÉA.
  auteur        text NOT NULL CHECK (auteur IN ('visiteur', 'staff', 'plateforme')),
  author_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Trace l'acheminement : une réponse du personnel part aussi par e-mail.
  email_envoye  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_replies_message_idx
  ON public.message_replies(message_id, created_at);

-- ============================================================================
-- Remontée automatique du fil à chaque nouvel échange.
-- Un message du visiteur repasse le fil en non-lu : le personnel ne peut pas
-- le manquer, même s'il avait déjà classé la conversation.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.touch_message_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.messages
     SET dernier_message_at = NEW.created_at,
         lu     = CASE WHEN NEW.auteur = 'visiteur' THEN false ELSE lu END,
         statut = CASE
                    WHEN NEW.auteur = 'visiteur' AND statut = 'traite' THEN 'nouveau'
                    WHEN NEW.auteur <> 'visiteur' AND statut = 'nouveau' THEN 'en_cours'
                    ELSE statut
                  END
   WHERE id = NEW.message_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_message_thread ON public.message_replies;
CREATE TRIGGER trg_touch_message_thread AFTER INSERT ON public.message_replies
  FOR EACH ROW EXECUTE FUNCTION public.touch_message_thread();

-- Une fonction de trigger n'a rien à faire dans l'API REST : sans cette révocation,
-- elle apparaît comme un point d'entrée /rpc/ exécutable par `anon` (signalé par
-- le linter Supabase). L'appel échouerait de toute façon, mais la surface exposée
-- doit rester exactement celle qu'on a voulue.
REVOKE ALL ON FUNCTION public.touch_message_thread() FROM public, anon, authenticated;

-- ============================================================================
-- RLS — lecture/écriture directes réservées au personnel, à la plateforme
-- et au visiteur propriétaire de son fil.
-- ============================================================================
ALTER TABLE public.messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_replies ENABLE ROW LEVEL SECURITY;

-- Le personnel gère la boîte de SON organisation.
DROP POLICY IF EXISTS messages_staff_all ON public.messages;
CREATE POLICY messages_staff_all ON public.messages FOR ALL
  USING (public.can_manage_tenant(tenant_id))
  WITH CHECK (public.can_manage_tenant(tenant_id));

-- L'équipe MUSÉA voit le canal « plateforme » de toutes les organisations.
DROP POLICY IF EXISTS messages_platform_all ON public.messages;
CREATE POLICY messages_platform_all ON public.messages FOR ALL
  USING (public.is_super_admin() AND canal = 'plateforme')
  WITH CHECK (public.is_super_admin() AND canal = 'plateforme');

-- Un visiteur connecté relit ses propres fils (espace client).
DROP POLICY IF EXISTS messages_owner_read ON public.messages;
CREATE POLICY messages_owner_read ON public.messages FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS replies_staff_all ON public.message_replies;
CREATE POLICY replies_staff_all ON public.message_replies FOR ALL
  USING (EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.id = message_id AND public.can_manage_tenant(m.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.messages m
                       WHERE m.id = message_id AND public.can_manage_tenant(m.tenant_id)));

DROP POLICY IF EXISTS replies_platform_all ON public.message_replies;
CREATE POLICY replies_platform_all ON public.message_replies FOR ALL
  USING (public.is_super_admin()
         AND EXISTS (SELECT 1 FROM public.messages m
                      WHERE m.id = message_id AND m.canal = 'plateforme'))
  WITH CHECK (public.is_super_admin()
         AND EXISTS (SELECT 1 FROM public.messages m
                      WHERE m.id = message_id AND m.canal = 'plateforme'));

DROP POLICY IF EXISTS replies_owner_read ON public.message_replies;
CREATE POLICY replies_owner_read ON public.message_replies FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.id = message_id AND m.user_id = auth.uid()));

-- ============================================================================
-- Écriture publique — porte d'entrée unique et contrôlée.
--
-- Plafond de débit : 5 messages par heure et par adresse. Volontairement calculé
-- sur l'e-mail et non sur l'IP, que Postgres ne voit pas de façon fiable ici ;
-- le honeypot du formulaire écarte en amont les robots les plus simples.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.envoyer_message_public(
  p_tenant_id bigint,
  p_sujet     text,
  p_corps     text,
  p_nom       text DEFAULT NULL,
  p_email     text DEFAULT NULL,
  p_order_id  bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canal   text := CASE WHEN p_order_id IS NULL THEN 'public' ELSE 'commande' END;
  v_email   text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_sujet   text := nullif(btrim(p_sujet), '');
  v_corps   text := nullif(btrim(p_corps), '');
  v_recents integer;
  v_id      bigint;
BEGIN
  IF v_sujet IS NULL OR v_corps IS NULL THEN
    RAISE EXCEPTION 'champs_obligatoires';
  END IF;

  -- On n'écrit qu'à une organisation réellement en ligne.
  IF NOT public.tenant_is_public(p_tenant_id) THEN
    RAISE EXCEPTION 'organisation_indisponible';
  END IF;

  -- Sans compte, l'adresse e-mail est le seul chemin de retour : elle est exigée.
  IF auth.uid() IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'email_requis';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'email_invalide';
  END IF;

  -- Une question sur une commande n'est légitime que pour son propriétaire.
  IF p_order_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o
                    WHERE o.id = p_order_id
                      AND o.user_id = auth.uid()
                      AND o.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'commande_introuvable';
    END IF;
  END IF;

  SELECT count(*) INTO v_recents
    FROM public.messages
   WHERE created_at > now() - interval '1 hour'
     AND ((auth.uid() IS NOT NULL AND user_id = auth.uid())
          OR (v_email IS NOT NULL AND expediteur_email = v_email));
  IF v_recents >= 5 THEN
    RAISE EXCEPTION 'trop_de_messages';
  END IF;

  INSERT INTO public.messages (tenant_id, canal, sujet, expediteur_nom, expediteur_email, user_id, order_id)
  VALUES (p_tenant_id, v_canal, left(v_sujet, 200), nullif(btrim(coalesce(p_nom, '')), ''),
          v_email, auth.uid(), p_order_id)
  RETURNING id INTO v_id;

  INSERT INTO public.message_replies (message_id, corps, auteur, author_id)
  VALUES (v_id, left(v_corps, 5000), 'visiteur', auth.uid());

  RETURN v_id;
END;
$$;

-- Réponse d'un visiteur connecté dans un fil qui lui appartient.
CREATE OR REPLACE FUNCTION public.repondre_message_public(
  p_message_id bigint,
  p_corps      text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corps text := nullif(btrim(p_corps), '');
  v_id    bigint;
BEGIN
  IF v_corps IS NULL THEN
    RAISE EXCEPTION 'champs_obligatoires';
  END IF;
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.messages m
                     WHERE m.id = p_message_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'fil_introuvable';
  END IF;

  INSERT INTO public.message_replies (message_id, corps, auteur, author_id)
  VALUES (p_message_id, left(v_corps, 5000), 'visiteur', auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.envoyer_message_public(bigint, text, text, text, text, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.envoyer_message_public(bigint, text, text, text, text, bigint) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.repondre_message_public(bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.repondre_message_public(bigint, text) TO authenticated;

COMMENT ON TABLE public.messages IS
  'Fil de discussion reçu par une organisation : contact public, question sur une commande, ou échange avec la plateforme.';
COMMENT ON TABLE public.message_replies IS
  'Échanges successifs d''un fil. L''ordre chronologique fait la conversation.';
COMMENT ON FUNCTION public.envoyer_message_public(bigint, text, text, text, text, bigint) IS
  'Unique porte d''entrée publique de la messagerie : valide, plafonne le débit, puis crée le fil et son premier message.';
