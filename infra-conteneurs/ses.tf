# ============================================================================
# Amazon SES — la ressource cloud qui expédie le courrier
# ----------------------------------------------------------------------------
# MUSÉA expédie déjà par Twilio SendGrid, et cela fonctionne. SES ne le
# remplace pas : il s'installe À CÔTÉ, sur son propre sous-domaine, et devient
# une seconde route utilisable — pour absorber une campagne que le quota
# d'essai SendGrid ne passerait pas, ou pour prendre le relais si ce compte
# ferme.
#
# POURQUOI UN SOUS-DOMAINE DÉDIÉ, ET PAS LA RACINE
#
# `nexacode.store` porte déjà l'authentification SendGrid : em2987,
# s1._domainkey, s2._domainkey, plus un SPF et un DMARC. Poser SES sur la même
# racine reviendrait à empiler deux jeux d'enregistrements sur les mêmes noms
# et, pour le SPF, à réécrire un enregistrement existant : la moindre erreur
# renvoie TOUT le courrier de MUSÉA en indésirable, SendGrid compris.
#
# Sur `notif.nexacode.store`, SES possède son domaine du premier au dernier
# enregistrement. Aucun nom n'est partagé. Les deux routes coexistent, et l'on
# bascule de l'une à l'autre en changeant une variable d'environnement.
#
# ⚠️ BAC À SABLE — le piège qui fait échouer les démonstrations
# Un compte SES neuf est en « sandbox » : il n'expédie QU'À des adresses
# vérifiées, 200 messages par jour au plus. Les enregistrements DNS peuvent
# être parfaits et le message rester bloqué. La sortie du bac à sable se
# demande à AWS (Account dashboard → Request production access) et prend
# généralement 24 h. À faire AVANT la soutenance, pas la veille.
# ============================================================================

locals {
  domaine_notifications = "${var.sous_domaine_notifications}.${var.zone_domaine}"

  # Sous-domaine d'où partent les rejets. SES le veut distinct de l'identité :
  # c'est lui qui apparaît dans l'enveloppe SMTP (« Return-Path »), et c'est sur
  # lui que porte l'alignement SPF.
  domaine_rejets = "rebonds.${local.domaine_notifications}"
}

resource "aws_sesv2_email_identity" "notifications" {
  count = var.activer_ses ? 1 : 0

  email_identity = local.domaine_notifications

  # DKIM géré par AWS : trois clés tournantes, publiées en CNAME. La rotation
  # est automatique — c'est l'avantage sur une clé posée à la main, qu'on
  # n'échange jamais.
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  configuration_set_name = aws_sesv2_configuration_set.principal[0].configuration_set_name

  tags = { Name = "${local.prefixe}-ses" }
}

# Trois CNAME de signature. Sans eux l'identité reste « Pending » et rien ne part.
resource "aws_route53_record" "ses_dkim" {
  count = var.activer_ses ? 3 : 0

  zone_id = local.zone_id
  name    = "${aws_sesv2_email_identity.notifications[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${local.domaine_notifications}"
  type    = "CNAME"
  ttl     = 300
  records = ["${aws_sesv2_email_identity.notifications[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]

  allow_overwrite = true
}

# ------------------------------------------------------- domaine des rejets
# Par défaut, l'enveloppe porte `amazonses.com`. Le destinataire voit alors un
# expéditeur MUSÉA et une enveloppe Amazon : l'alignement SPF est impossible et
# DMARC dégrade la réputation. Un domaine de rejet à nous rétablit l'alignement.
resource "aws_sesv2_email_identity_mail_from_attributes" "notifications" {
  count = var.activer_ses ? 1 : 0

  email_identity   = aws_sesv2_email_identity.notifications[0].email_identity
  mail_from_domain = local.domaine_rejets

  # REJECT_MESSAGE : si le MX du domaine de rejet disparaît, SES refuse
  # d'expédier plutôt que de retomber sur `amazonses.com`. On préfère une
  # panne visible à une dégradation silencieuse de la réputation.
  behavior_on_mx_failure = "REJECT_MESSAGE"

  depends_on = [
    aws_route53_record.ses_rejets_mx,
    aws_route53_record.ses_rejets_spf,
  ]
}

resource "aws_route53_record" "ses_rejets_mx" {
  count = var.activer_ses ? 1 : 0

  zone_id = local.zone_id
  name    = local.domaine_rejets
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

# SPF du domaine de rejet UNIQUEMENT. Le SPF de la racine, qui autorise
# SendGrid, n'est pas touché : nom différent, enregistrement différent.
resource "aws_route53_record" "ses_rejets_spf" {
  count = var.activer_ses ? 1 : 0

  zone_id = local.zone_id
  name    = local.domaine_rejets
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com ~all"]
}

# DMARC propre au sous-domaine. Sans lui, `notif.nexacode.store` hérite de la
# politique de la racine ; l'expliciter permet de durcir SES sans rien changer
# pour SendGrid. `p=none` d'abord : on observe les rapports avant de rejeter.
resource "aws_route53_record" "ses_dmarc" {
  count = var.activer_ses ? 1 : 0

  zone_id = local.zone_id
  name    = "_dmarc.${local.domaine_notifications}"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=none; adkim=r; aspf=r"]
}

# --------------------------------------------------- jeu de configuration
# Il regroupe les réglages d'expédition et, surtout, publie les événements.
resource "aws_sesv2_configuration_set" "principal" {
  count = var.activer_ses ? 1 : 0

  configuration_set_name = "${local.prefixe}-envois"

  delivery_options {
    # Refuse d'expédier en clair si le serveur du destinataire ne propose pas
    # STARTTLS. Un message d'adhésion contient un nom et une adresse.
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  # Coupe-circuit : au-delà d'un certain taux de rejets, AWS suspend le compte.
  # Cette option met SES en pause AVANT, le temps de comprendre.
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

# Les rejets et les plaintes deviennent des métriques CloudWatch exploitables.
# Sans destination d'événements, un message perdu ne laisse aucune trace :
# SES répond 200 à l'appel d'API, et l'échec survient plus tard, en silence.
resource "aws_sesv2_configuration_set_event_destination" "cloudwatch" {
  count = var.activer_ses ? 1 : 0

  configuration_set_name = aws_sesv2_configuration_set.principal[0].configuration_set_name
  event_destination_name = "metriques"

  event_destination {
    enabled              = true
    matching_event_types = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT", "RENDERING_FAILURE"]

    cloud_watch_destination {
      dimension_configuration {
        dimension_name          = "ses:configuration-set"
        dimension_value_source  = "MESSAGE_TAG"
        default_dimension_value = "musea"
      }
    }
  }
}

# ------------------------------------------------------------ droit d'expédier
# Étroit à dessein : expédier depuis CETTE identité, via CE jeu de
# configuration. Rien d'autre — ni vérifier une identité, ni lire les quotas,
# ni expédier au nom d'un autre domaine du compte.
data "aws_iam_policy_document" "expedier_ses" {
  count = var.activer_ses ? 1 : 0

  statement {
    sid     = "ExpedierDepuisIdentiteMusea"
    effect  = "Allow"
    actions = ["ses:SendEmail", "ses:SendRawEmail"]

    resources = [
      aws_sesv2_email_identity.notifications[0].arn,
      "arn:aws:ses:${var.region}:${data.aws_caller_identity.courant.account_id}:configuration-set/${aws_sesv2_configuration_set.principal[0].configuration_set_name}",
    ]
  }
}

resource "aws_iam_policy" "expedier_ses" {
  count = var.activer_ses ? 1 : 0

  name        = "${local.prefixe}-expedier-ses"
  description = "Expedition SES restreinte a l'identite MUSEA"
  policy      = data.aws_iam_policy_document.expedier_ses[0].json
}

# ============================================================================
# Clé durable pour Supabase — désactivée par défaut
# ----------------------------------------------------------------------------
# Les Edge Functions tournent chez Supabase, hors d'AWS : elles ne peuvent pas
# endosser de rôle et n'ont donc que ce recours. Tout le reste de cette
# infrastructure s'en passe.
#
# La clé secrète atterrit dans l'état Terraform. Si l'on active ceci, l'état
# devient lui-même un secret : chiffré côté S3, jamais versionné.
# ============================================================================

resource "aws_iam_user" "ses" {
  count = var.activer_ses && var.creer_utilisateur_ses ? 1 : 0

  name = "${local.prefixe}-ses"
  path = "/service/"

  tags = { Name = "${local.prefixe}-ses" }
}

resource "aws_iam_user_policy_attachment" "ses" {
  count = var.activer_ses && var.creer_utilisateur_ses ? 1 : 0

  user       = aws_iam_user.ses[0].name
  policy_arn = aws_iam_policy.expedier_ses[0].arn
}

resource "aws_iam_access_key" "ses" {
  count = var.activer_ses && var.creer_utilisateur_ses ? 1 : 0

  user = aws_iam_user.ses[0].name
}
