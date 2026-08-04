// Appel de Claude via Amazon Bedrock, depuis une Edge Function Deno.
//
// POURQUOI SIGNER À LA MAIN
//
// Bedrock exige la signature AWS SigV4. On pourrait importer une bibliothèque
// depuis esm.sh, mais ce code manipule des identifiants AWS : une dépendance
// compromise les exfiltrerait sans bruit. SigV4 est un protocole documenté et
// stable — quatre-vingts lignes de Web Crypto valent mieux qu'une confiance
// aveugle pour ce cas précis.
//
// SECRETS ATTENDUS (Supabase → Edge Functions → Secrets) :
//   BEDROCK_ACCESS_KEY_ID
//   BEDROCK_SECRET_ACCESS_KEY
//   BEDROCK_REGION            (défaut : eu-west-3, la région du reste du projet)

const encodeur = new TextEncoder()

// Modèles vérifiés disponibles sur le compte, en profil d'inférence européen.
//
// ⚠️ L'identifiant BRUT (« anthropic.claude-… ») est refusé : ces modèles
// n'acceptent que le débit à la demande via un PROFIL d'inférence, d'où le
// préfixe « eu. ». C'est la première erreur qu'on rencontre, et son message
// ne le dit qu'à demi-mot.
export const MODELES = {
  // Rapide et bon marché : rédaction de notices, reformulation, extraction.
  rapide: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  // Équilibré : synthèses sourcées, raisonnement sur des données hétérogènes.
  equilibre: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
  // Le plus capable, à réserver aux textes qui comptent vraiment.
  profond: 'eu.anthropic.claude-opus-4-7'
} as const

async function sha256Hex(donnees: string | Uint8Array): Promise<string> {
  const buf = typeof donnees === 'string' ? encodeur.encode(donnees) : donnees
  const empreinte = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(empreinte)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(cle: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', cle, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, encodeur.encode(message)))
}

// Clé de signature dérivée : date → région → service → requête.
// Chaque étape signe la précédente ; c'est ce qui limite la portée d'une clé
// interceptée à un seul jour, une seule région, un seul service.
async function cleDeSignature(secret: string, date: string, region: string, service: string) {
  let k = encodeur.encode(`AWS4${secret}`)
  k = await hmac(k, date)
  k = await hmac(k, region)
  k = await hmac(k, service)
  return await hmac(k, 'aws4_request')
}

export type MessageClaude = { role: 'user' | 'assistant'; content: { text: string }[] }

export interface OptionsBedrock {
  modele?: string
  systeme?: string
  messages: MessageClaude[]
  maxTokens?: number
  temperature?: number
}

// DEUX FAÇONS DE S'AUTHENTIFIER, par ordre de simplicité.
//
//  1. BEDROCK_TOKEN — une clé d'API Bedrock (préfixe « ABSK »), envoyée telle
//     quelle en en-tête Authorization. AWS l'a introduite précisément pour
//     éviter la signature. C'est la voie recommandée.
//
//  2. BEDROCK_ACCESS_KEY_ID + BEDROCK_SECRET_ACCESS_KEY — signature SigV4
//     complète, conservée pour qui préfère un utilisateur IAM classique.
//
// ⚠️ Prenez une clé de LONGUE DURÉE. Celles générées par défaut dans la console
// expirent en douze heures : le site cesserait de fonctionner du jour au
// lendemain, sans que rien n'ait changé dans le code.
function jetonPorteur(): string | null {
  return Deno.env.get('BEDROCK_TOKEN') || Deno.env.get('BEDROCK_API_KEY') || null
}

export function bedrockConfigure(): boolean {
  return !!(
    jetonPorteur() ||
    (Deno.env.get('BEDROCK_ACCESS_KEY_ID') && Deno.env.get('BEDROCK_SECRET_ACCESS_KEY'))
  )
}

// Renvoie le texte produit, ou null si Bedrock n'est pas configuré.
// Lève une erreur si l'appel échoue : l'appelant décide alors du repli.
export async function appelerBedrock(opts: OptionsBedrock): Promise<string | null> {
  const porteur = jetonPorteur()
  const cleId = Deno.env.get('BEDROCK_ACCESS_KEY_ID')
  const cleSecrete = Deno.env.get('BEDROCK_SECRET_ACCESS_KEY')
  if (!porteur && !(cleId && cleSecrete)) return null

  const region = Deno.env.get('BEDROCK_REGION') || 'eu-west-3'
  const service = 'bedrock'
  const modele = opts.modele || MODELES.rapide
  const hote = `bedrock-runtime.${region}.amazonaws.com`
  // Le modèle contient « : » et « . » : il doit être encodé dans le chemin.
  const chemin = `/model/${encodeURIComponent(modele)}/converse`

  const corps = JSON.stringify({
    messages: opts.messages,
    ...(opts.systeme ? { system: [{ text: opts.systeme }] } : {}),
    inferenceConfig: {
      maxTokens: opts.maxTokens ?? 900,
      temperature: opts.temperature ?? 0.5
    }
  })

  const ctrlPorteur = new AbortController()

  // ---- Voie 1 : jeton porteur. Aucune signature, aucun calcul. -------------
  if (porteur) {
    const minuteur = setTimeout(() => ctrlPorteur.abort(), 30000)
    try {
      const res = await fetch(`https://${hote}${chemin}`, {
        method: 'POST',
        signal: ctrlPorteur.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${porteur}` },
        body: corps
      })
      if (!res.ok) throw new Error(`bedrock ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const data = await res.json()
      return data?.output?.message?.content?.[0]?.text?.trim() || null
    } finally {
      clearTimeout(minuteur)
    }
  }

  // ---- Voie 2 : signature SigV4 complète. ---------------------------------
  // Inatteignable en pratique (le garde-fou du haut l'a déjà exclu), mais
  // TypeScript ne le déduit pas seul : sans cette ligne, cleId reste
  // « string | undefined » jusque dans l'en-tête Authorization.
  if (!cleId || !cleSecrete) return null

  const maintenant = new Date()
  const amzDate = maintenant.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260802T101530Z
  const jour = amzDate.slice(0, 8)
  const empreinteCorps = await sha256Hex(corps)

  // --- Requête canonique : l'ordre et la casse comptent, au caractère près.
  const enTetesCanoniques =
    `content-type:application/json\n` +
    `host:${hote}\n` +
    `x-amz-content-sha256:${empreinteCorps}\n` +
    `x-amz-date:${amzDate}\n`
  const enTetesSignes = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const requeteCanonique = [
    'POST', chemin, '', enTetesCanoniques, enTetesSignes, empreinteCorps
  ].join('\n')

  const portee = `${jour}/${region}/${service}/aws4_request`
  const aSigner = [
    'AWS4-HMAC-SHA256', amzDate, portee, await sha256Hex(requeteCanonique)
  ].join('\n')

  const cle = await cleDeSignature(cleSecrete, jour, region, service)
  const signature = [...(await hmac(cle, aSigner))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')

  const ctrl = new AbortController()
  const minuteur = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(`https://${hote}${chemin}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Amz-Date': amzDate,
        'X-Amz-Content-Sha256': empreinteCorps,
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${cleId}/${portee}, ` +
          `SignedHeaders=${enTetesSignes}, Signature=${signature}`
      },
      body: corps
    })

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      // Le message le plus fréquent au démarrage : le formulaire d'usage
      // Anthropic n'a pas été soumis dans la console Bedrock.
      throw new Error(`bedrock ${res.status}: ${detail}`)
    }
    const data = await res.json()
    return data?.output?.message?.content?.[0]?.text?.trim() || null
  } finally {
    clearTimeout(minuteur)
  }
}
