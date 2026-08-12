-- ============================================================================
-- E-MAIL MULTI-FOURNISSEUR — trace du service d'acheminement
-- ----------------------------------------------------------------------------
-- `send-email` sait désormais passer par Twilio SendGrid ou par Resend. Le
-- journal doit dire LEQUEL a acheminé chaque message : sans cette colonne, on ne
-- peut pas diagnostiquer une panne qui ne toucherait qu'un des deux services.
--
-- Rappel : les identifiants Twilio classiques (Account SID + Auth Token) n'envoient
-- pas d'e-mail — ils servent au SMS et à la voix. L'e-mail chez Twilio, c'est
-- SendGrid, avec une clé distincte de la forme « SG.… ».
-- ============================================================================

ALTER TABLE public.email_log ADD COLUMN IF NOT EXISTS provider text;

COMMENT ON COLUMN public.email_log.provider IS
  'Service ayant acheminé l''e-mail : sendgrid (Twilio SendGrid) | resend. Nul pour les envois antérieurs au multi-fournisseur.';
