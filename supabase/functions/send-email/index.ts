// Edge Function : e-mails transactionnels, via Twilio SendGrid ou Resend.
// La clé API reste 100 % côté serveur — jamais dans le frontend.
//
// Secrets (poser CELUI du service retenu) :
//   SENDGRID_API_KEY  — Twilio SendGrid, clé de la forme « SG.… »
//                       (alias acceptés : SEND_GRID_API_KEY, TWILIO_SENDGRID_API_KEY)
//   RESEND_API_KEY    — Resend
//   EMAIL_PROVIDER    — facultatif : « sendgrid » ou « resend » pour forcer le choix
//   EMAIL_FROM        — expéditrice, ex. « MUSÉA <contact@votredomaine.cm> »
//
// Sans EMAIL_PROVIDER, la première clé trouvée l'emporte, SendGrid en tête.
//
// Types gérés : recu_commande | acces_debloque | organisation_approuvee | bienvenue
//               | campagne | reponse_message
//
// Sans clé configurée, la fonction répond 200 { skipped: true } : l'application
// continue de fonctionner normalement, seul l'e-mail n'est pas envoyé.
//
// IMPORTANT — l'expéditrice doit être VÉRIFIÉE chez le fournisseur, sinon tout envoi
// est refusé (respectivement 403 et 401/422) :
//   SendGrid : vérifier l'expéditrice unique, ou authentifier le domaine (SPF/DKIM).
//   Resend   : sans domaine vérifié, on ne peut écrire QU'À l'adresse du titulaire
//              du compte, depuis onboarding@resend.dev.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const money = (v: unknown, d = '€') =>
  `${Number(v || 0).toLocaleString('fr-FR')} ${esc(d)}`

// Une ligne d'objet n'est PAS du HTML : l'échapper y fait apparaître des entités
// bien visibles pour le destinataire (« l&#39;exposition » au lieu de « l'exposition »).
// On n'ôte donc que les retours à la ligne, qui permettraient d'injecter des en-têtes.
const sujetLigne = (s: unknown) =>
  String(s ?? '').replace(/[\r\n]+/g, ' ').trim()

// ---------- Gabarit commun (sobre, lisible sur tous les clients mail) ----------
function layout(opts: { titre: string; corps: string; marque: string; couleur: string; lien?: string; lienTexte?: string; desinscription?: string }) {
  const { titre, corps, marque, couleur, lien, lienTexte, desinscription } = opts
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101210">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f3;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e8e9e6;border-radius:10px;overflow:hidden">
        <tr><td style="background:${couleur};padding:22px 28px">
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.04em">${esc(marque)}</div>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.25">${esc(titre)}</h1>
          ${corps}
          ${lien ? `<div style="margin-top:24px"><a href="${esc(lien)}" style="display:inline-block;background:${couleur};color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:700;font-size:14px">${esc(lienTexte || 'Ouvrir')}</a></div>` : ''}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eef0ed;color:#7c817b;font-size:12px">
          ${esc(marque)} — message automatique, merci de ne pas y répondre.
          ${desinscription ? `<br><a href="${esc(desinscription)}" style="color:#7c817b">Se désinscrire de ces e-mails</a>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`
}

function ligneArticles(items: Array<Record<string, unknown>>, devise: string) {
  return items.map((i) =>
    `<tr>
       <td style="padding:8px 0;border-bottom:1px solid #eef0ed;font-size:14px">${esc(i.label)}</td>
       <td style="padding:8px 0;border-bottom:1px solid #eef0ed;font-size:14px;text-align:right;white-space:nowrap"><strong>${money(i.montant, devise)}</strong></td>
     </tr>`).join('')
}

// ---------- Construction du message selon le type ----------
function build(type: string, d: Record<string, any>) {
  const marque = d.marque || 'MUSÉA'
  const couleur = d.couleur || '#0e6f5c'

  if (type === 'recu_commande') {
    const items = Array.isArray(d.items) ? d.items : []
    const corps = `
      <p style="margin:0 0 16px;line-height:1.6;font-size:15px">Bonjour${d.prenom ? ' ' + esc(d.prenom) : ''}, merci pour votre commande.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">
        ${ligneArticles(items, d.devise || '€')}
        <tr>
          <td style="padding:12px 0;font-size:15px"><strong>Total</strong></td>
          <td style="padding:12px 0;font-size:18px;text-align:right"><strong>${money(d.total, d.devise || '€')}</strong></td>
        </tr>
      </table>
      <p style="margin:14px 0 0;color:#5c615c;font-size:13px">Commande n°${esc(d.orderId)} — ${esc(d.date || '')}</p>`
    return {
      sujet: `Votre commande n°${d.orderId} — ${marque}`,
      html: layout({ titre: 'Reçu de votre commande', corps, marque, couleur, lien: d.lien, lienTexte: 'Voir mes accès' })
    }
  }

  if (type === 'acces_debloque') {
    const corps = `
      <p style="margin:0 0 16px;line-height:1.6;font-size:15px">Bonjour${d.prenom ? ' ' + esc(d.prenom) : ''}, votre accès est désormais actif.</p>
      <p style="margin:0 0 8px;line-height:1.6;font-size:15px"><strong>${esc(d.libelle)}</strong></p>
      ${d.expiration ? `<p style="margin:0;color:#5c615c;font-size:13px">Valable jusqu'au ${esc(d.expiration)}.</p>` : ''}`
    return {
      sujet: `Votre accès est actif — ${marque}`,
      html: layout({ titre: 'Accès débloqué', corps, marque, couleur, lien: d.lien, lienTexte: 'Commencer la visite' })
    }
  }

  if (type === 'organisation_approuvee') {
    const corps = `
      <p style="margin:0 0 16px;line-height:1.6;font-size:15px">Bonne nouvelle : l'espace de <strong>${esc(d.nomOrganisation)}</strong> vient d'être approuvé.</p>
      <p style="margin:0 0 16px;line-height:1.6;font-size:15px">Votre site public est en ligne à l'adresse :<br>
        <a href="${esc(d.lien)}" style="color:${couleur}">${esc(d.lien)}</a></p>`
    return {
      sujet: `Votre espace est en ligne — ${marque}`,
      html: layout({ titre: 'Votre organisation est approuvée', corps, marque, couleur, lien: d.lien, lienTexte: 'Voir mon site' })
    }
  }

  // Campagne aux visiteurs (V2 Phase 4). Contenu saisi/assisté côté ERP : on le reçoit
  // en TEXTE BRUT et on l'échappe intégralement — aucun HTML de l'admin n'est interprété.
  if (type === 'campagne') {
    const paragraphes = String(d.contenu || '')
      .split(/\n\s*\n/)
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((p: string) => `<p style="margin:0 0 16px;line-height:1.65;font-size:15px">${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('')
    const corps = `
      ${d.prenom ? `<p style="margin:0 0 16px;line-height:1.6;font-size:15px">Bonjour ${esc(d.prenom)},</p>` : ''}
      ${paragraphes}
      ${d.image ? `<img src="${esc(d.image)}" alt="" style="width:100%;border-radius:8px;margin:8px 0 4px">` : ''}`
    return {
      sujet: sujetLigne(d.sujet || marque),
      html: layout({
        titre: d.titre || d.sujet || marque,
        corps, marque, couleur,
        lien: d.lien, lienTexte: d.lienTexte || 'En savoir plus',
        desinscription: d.desinscription
      })
    }
  }

  // Réponse du personnel à un message reçu dans la boîte de l'organisation.
  // Le corps est saisi par un humain dans l'ERP : on le reçoit en TEXTE BRUT et on
  // l'échappe intégralement, comme pour les campagnes. On rappelle la question du
  // visiteur en citation, pour qu'il retrouve le contexte sans ouvrir le site.
  if (type === 'reponse_message') {
    const paragraphes = String(d.contenu || '')
      .split(/\n\s*\n/)
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((p: string) => `<p style="margin:0 0 16px;line-height:1.65;font-size:15px">${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('')
    const corps = `
      ${d.prenom ? `<p style="margin:0 0 16px;line-height:1.6;font-size:15px">Bonjour ${esc(d.prenom)},</p>` : ''}
      ${paragraphes}
      ${d.question ? `
        <div style="margin:22px 0 0;padding:12px 16px;background:#f7f8f6;border-left:3px solid ${couleur};border-radius:0 6px 6px 0">
          <div style="color:#7c817b;font-size:12px;margin-bottom:6px">Votre message</div>
          <div style="color:#5c615c;font-size:14px;line-height:1.55">${esc(d.question).replace(/\n/g, '<br>')}</div>
        </div>` : ''}`
    return {
      sujet: `Re : ${sujetLigne(d.sujet || 'votre message')} — ${marque}`,
      html: layout({
        titre: d.sujet || 'Réponse à votre message',
        corps, marque, couleur,
        lien: d.lien, lienTexte: d.lienTexte || 'Poursuivre la conversation'
      })
    }
  }

  if (type === 'bienvenue') {
    // L'ADRESSE PUBLIQUE est la première chose que cherche un nouveau client, et
    // la seule qu'il ne peut pas deviner. Tant qu'elle ne figurait pas ici, elle
    // se devinait — mal : on a vu chercher « organisation.nexacode.store », qui
    // n'a jamais existé. On l'écrit donc en toutes lettres.
    const nu = (u: string) => String(u).replace(/^https?:\/\//, '')
    const adresse = d.adresseSite
      ? `<p style="margin:0 0 16px;line-height:1.6;font-size:15px">Votre adresse publique est :
          <a href="${esc(d.adresseSite)}" style="color:${couleur};font-weight:600;text-decoration:none">${esc(nu(d.adresseSite))}</a></p>`
      : ''
    const corps = `
      <p style="margin:0 0 16px;line-height:1.6;font-size:15px">Bienvenue ! L'espace de <strong>${esc(d.nomOrganisation)}</strong> a bien été créé.</p>
      ${adresse}
      <p style="margin:0 0 16px;line-height:1.6;font-size:15px">Il est en cours de validation. Vous pourrez préparer vos contenus dès maintenant ;
      votre site public sera visible une fois l'espace approuvé.</p>`
    return {
      sujet: `Votre espace a été créé — ${marque}`,
      html: layout({ titre: 'Espace créé', corps, marque, couleur, lien: d.lien, lienTexte: 'Ouvrir mon espace' })
    }
  }

  return null
}

// ============================================================================
// Acheminement — deux fournisseurs possibles, même contrat en sortie.
//
// ATTENTION à un contresens courant : les identifiants Twilio habituels
// (Account SID + Auth Token) n'envoient PAS d'e-mail — ils servent au SMS et à
// la voix. L'e-mail chez Twilio, c'est SendGrid, avec sa propre clé « SG.… ».
// C'est donc l'API SendGrid qui est appelée ici.
//
// Choix du fournisseur : EMAIL_PROVIDER (sendgrid | resend) s'il est posé,
// sinon la première clé trouvée, SendGrid en tête.
// ============================================================================
type Envoi = { ok: boolean; id?: string; status: number; detail: string }

function resolveProvider(): { provider: string; key: string | null; from: string } {
  // On accepte les trois graphies rencontrées : la variante avec tiret bas est
  // celle réellement posée sur ce projet. Même précaution que GROK_API_KEY côté
  // guide-agent — un secret mal nommé échoue en silence, ce qui coûte cher à trouver.
  const sendgridKey = Deno.env.get('SENDGRID_API_KEY')
    || Deno.env.get('SEND_GRID_API_KEY')
    || Deno.env.get('TWILIO_SENDGRID_API_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const choix = (Deno.env.get('EMAIL_PROVIDER') || '').toLowerCase()

  // Une expéditrice commune évite d'avoir à reconfigurer en changeant de service.
  const from = Deno.env.get('EMAIL_FROM')
    || Deno.env.get('SENDGRID_FROM')
    || Deno.env.get('RESEND_FROM')
    || 'MUSÉA <onboarding@resend.dev>'

  if (choix === 'sendgrid') return { provider: 'sendgrid', key: sendgridKey ?? null, from }
  if (choix === 'resend') return { provider: 'resend', key: resendKey ?? null, from }
  if (sendgridKey) return { provider: 'sendgrid', key: sendgridKey, from }
  return { provider: 'resend', key: resendKey ?? null, from }
}

// « MUSÉA <contact@domaine.cm> » → { nom, email }. SendGrid exige les deux séparés,
// là où Resend accepte la forme combinée.
function parseFrom(from: string): { email: string; name?: string } {
  // `[^>]+` étant gourmand, il avale les espaces situés avant le chevron fermant :
  // on retaille l'adresse, sans quoi SendGrid refuse un destinataire mal formé.
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/)
  if (m) return { email: m[2].trim(), name: m[1] || undefined }
  return { email: from.trim() }
}

async function viaSendGrid(key: string, from: string, to: string, message: { sujet: string; html: string }): Promise<Envoi> {
  const expediteur = parseFrom(from)
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: expediteur,
      subject: message.sujet,
      content: [{ type: 'text/html', value: message.html }]
    })
  })

  // Succès SendGrid = 202 avec un corps VIDE : appeler .json() ici lèverait.
  // L'identifiant du message n'est disponible que dans l'en-tête X-Message-Id.
  if (r.ok) {
    return { ok: true, id: r.headers.get('x-message-id') ?? undefined, status: r.status, detail: '' }
  }
  return { ok: false, status: r.status, detail: (await r.text().catch(() => '')) || '(corps vide)' }
}

async function viaResend(key: string, from: string, to: string, message: { sujet: string; html: string }): Promise<Envoi> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: message.sujet, html: message.html })
  })
  const payload = await r.json().catch(() => ({}))
  if (r.ok) return { ok: true, id: payload?.id, status: r.status, detail: '' }
  return { ok: false, status: r.status, detail: JSON.stringify(payload) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const { type, to, tenantId, orderId, ...data } = body || {}
  if (!type || !to) return json({ error: 'missing_fields' }, 400)

  // `orderId` est extrait ci-dessus pour la journalisation, mais le gabarit du reçu
  // l'affiche aussi (« Commande n°… ») : sans ce réajout il valait `undefined` dans
  // l'e-mail reçu par le client.
  const message = build(String(type), { ...data, orderId })
  if (!message) return json({ error: 'unknown_type' }, 400)

  const { provider, key, from } = resolveProvider()

  // Journalisation (service role : contourne la RLS en écriture).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
  const log = async (statut: string, erreur?: string, providerId?: string) => {
    try {
      await admin.from('email_log').insert({
        tenant_id: tenantId ?? null, type, destinataire: to, sujet: message.sujet,
        statut, erreur: erreur ?? null, order_id: orderId ?? null,
        provider_id: providerId ?? null,
        // Sans clé, aucun service n'a été sollicité : inscrire « resend » (la branche
        // par défaut) laisserait croire à une panne Resend. On laisse donc le champ nul.
        provider: key ? provider : null
      })
    } catch { /* le journal ne doit jamais bloquer l'envoi */ }
  }

  // Aucune clé configurée : on ne bloque pas l'application.
  if (!key) {
    await log('desactive', 'aucune cle API e-mail (SENDGRID_API_KEY ou RESEND_API_KEY)')
    return json({ skipped: true, reason: 'no_api_key' })
  }

  try {
    const envoi = provider === 'sendgrid'
      ? await viaSendGrid(key, from, String(to), message)
      : await viaResend(key, from, String(to), message)

    if (!envoi.ok) {
      await log('echec', `${envoi.status}: ${envoi.detail.slice(0, 300)}`)
      return json({ error: `${provider}_error`, status: envoi.status, detail: envoi.detail }, 502)
    }
    await log('envoye', undefined, envoi.id)
    return json({ ok: true, id: envoi.id, provider })
  } catch (e) {
    await log('echec', `reseau: ${String(e).slice(0, 200)}`)
    return json({ error: 'network' }, 502)
  }
})
