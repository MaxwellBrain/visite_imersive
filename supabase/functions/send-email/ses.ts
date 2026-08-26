// ============================================================================
// Expédition via Amazon SES — troisième fournisseur, à côté de SendGrid et Resend
// ----------------------------------------------------------------------------
// Ce module n'est sollicité QUE si des identifiants SES sont posés et que
// SendGrid et Resend n'ont pas été retenus (voir resolveProvider dans
// index.ts). Sans secret SES, il n'est jamais appelé et rien ne change.
//
// POURQUOI SIGNER À LA MAIN
//
// Les Edge Functions tournent sur Deno, chez Supabase, hors d'AWS. Le SDK AWS
// pour JavaScript tirerait plusieurs mégaoctets de dépendances pour un seul
// appel HTTP — sur une fonction dont le temps de démarrage à froid compte.
// SigV4 tient en une soixantaine de lignes avec la Web Crypto API, déjà
// présente dans le runtime.
//
// Secrets attendus (Supabase → Edge Functions → Secrets) :
//   AWS_SES_ACCESS_KEY_ID      — ou AWS_ACCESS_KEY_ID
//   AWS_SES_SECRET_ACCESS_KEY  — ou AWS_SECRET_ACCESS_KEY
//   AWS_SES_REGION             — défaut eu-west-3
//   AWS_SES_CONFIGURATION_SET  — facultatif : sans lui, aucune métrique de
//                                rejet ne remonte dans CloudWatch
//
// Les identifiants proviennent de l'utilisateur IAM créé par
// `infra-conteneurs/ses.tf` (variable `creer_utilisateur_ses`). Ils ne donnent
// QUE le droit d'expédier depuis l'identité MUSÉA.
// ============================================================================

export type Envoi = { ok: boolean; id?: string; status: number; detail: string }

const encodeur = new TextEncoder()

function versHex(donnees: ArrayBuffer): string {
  return Array.from(new Uint8Array(donnees))
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256(message: string): Promise<string> {
  return versHex(await crypto.subtle.digest('SHA-256', encodeur.encode(message)))
}

async function hmac(cle: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cleImportee = await crypto.subtle.importKey(
    'raw',
    cle as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cleImportee, encodeur.encode(message))
}

// Clé de signature dérivée en quatre HMAC successifs. Chaque étape restreint la
// portée de la clé : une signature valable aujourd'hui ne l'est plus demain, et
// une signature pour SES ne vaut pas pour S3. C'est ce qui limite les dégâts
// d'une requête interceptée.
async function cleDeSignature(
  secret: string,
  date: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmac(encodeur.encode('AWS4' + secret), date)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

export function sesConfigure(): boolean {
  const cle = Deno.env.get('AWS_SES_ACCESS_KEY_ID') || Deno.env.get('AWS_ACCESS_KEY_ID')
  const secret = Deno.env.get('AWS_SES_SECRET_ACCESS_KEY') || Deno.env.get('AWS_SECRET_ACCESS_KEY')
  return Boolean(cle && secret)
}

export async function viaSes(
  from: string,
  to: string,
  message: { sujet: string; html: string }
): Promise<Envoi> {
  const cleAcces = Deno.env.get('AWS_SES_ACCESS_KEY_ID') || Deno.env.get('AWS_ACCESS_KEY_ID') || ''
  const cleSecrete = Deno.env.get('AWS_SES_SECRET_ACCESS_KEY') || Deno.env.get('AWS_SECRET_ACCESS_KEY') || ''
  const region = Deno.env.get('AWS_SES_REGION') || 'eu-west-3'
  const jeuConfiguration = Deno.env.get('AWS_SES_CONFIGURATION_SET') || ''

  if (!cleAcces || !cleSecrete) {
    return { ok: false, status: 0, detail: 'identifiants SES absents' }
  }

  const service = 'ses'
  const hote = `email.${region}.amazonaws.com`
  const chemin = '/v2/email/outbound-emails'

  const corps = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: message.sujet, Charset: 'UTF-8' },
        Body: { Html: { Data: message.html, Charset: 'UTF-8' } }
      }
    },
    // Sans jeu de configuration, SES expédie quand même — mais rejets et
    // plaintes ne remontent nulle part, et l'on découvre le problème le jour
    // où AWS suspend le compte.
    ...(jeuConfiguration ? { ConfigurationSetName: jeuConfiguration } : {})
  })

  // Format AWS : 20260825T143000Z, et sa version courte 20260825.
  const maintenant = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateCourte = maintenant.slice(0, 8)

  const enTetesCanoniques =
    'content-type:application/json' + '\n' +
    'host:' + hote + '\n' +
    'x-amz-date:' + maintenant + '\n'
  const enTetesSignes = 'content-type;host;x-amz-date'

  const requeteCanonique = [
    'POST',
    chemin,
    '', // pas de paramètres de requête
    enTetesCanoniques,
    enTetesSignes,
    await sha256(corps)
  ].join('\n')

  const portee = [dateCourte, region, service, 'aws4_request'].join('/')
  const aSigner = [
    'AWS4-HMAC-SHA256',
    maintenant,
    portee,
    await sha256(requeteCanonique)
  ].join('\n')

  const signature = versHex(
    await hmac(await cleDeSignature(cleSecrete, dateCourte, region, service), aSigner)
  )

  const autorisation =
    `AWS4-HMAC-SHA256 Credential=${cleAcces}/${portee}, ` +
    `SignedHeaders=${enTetesSignes}, Signature=${signature}`

  const r = await fetch(`https://${hote}${chemin}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': maintenant,
      Authorization: autorisation
    },
    body: corps
  })

  const charge = await r.json().catch(() => ({}))

  if (r.ok) return { ok: true, id: charge?.MessageId, status: r.status, detail: '' }

  // Deux échecs méritent d'être reconnus au premier coup d'œil :
  //   403 + « Email address is not verified » → le compte est encore dans le
  //        bac à sable SES : il n'expédie qu'aux adresses vérifiées.
  //   403 + « Signature ... does not match »  → clé secrète erronée, ou horloge
  //        du serveur décalée de plus de 5 minutes.
  return {
    ok: false,
    status: r.status,
    detail: JSON.stringify(charge) || '(corps vide)'
  }
}
