// VAPI — le laissez-passer et les outils.
//
// CE QUI CHANGE PAR RAPPORT À xAI, ET CE QUI NE CHANGE PAS.
//
// Ne change pas : le garde-fou. Un objet publié est exigé, un plafond par
// empreinte d'IP est appliqué, et le jeton est court. Ces trois règles valent
// pour n'importe quel fournisseur facturé à la minute derrière un point
// d'entrée public — elles étaient écrites pour xAI, elles servent telles quelles.
//
// Change : la manière dont le prompt atteint l'agent. Chez xAI, le navigateur
// posait lui-même les `instructions` dans `session.update` ; notre serveur les
// rédigeait, mais c'est le client qui les transmettait. Ici, l'assistant Vapi
// APPELLE NOTRE SERVEUR pour obtenir son dossier. Le texte ne transite plus par
// le navigateur du tout.
//
// ⚠️ CE QUE CELA NE PROTÈGE TOUJOURS PAS. Le SDK web laisse le client passer
// des `assistantOverrides`, et Vapi le dit sans détour : ce n'est pas une
// frontière de sécurité. Un visiteur curieux peut donc réécrire la consigne de
// l'assistant depuis la console. Ce qu'il NE PEUT PAS faire, en revanche, c'est
// obtenir autre chose que le dossier d'une pièce PUBLIÉE — l'outil ci-dessous
// ne sert que cela. Le risque résiduel est donc la consommation de minutes, pas
// la falsification du patrimoine ; et c'est le plafond par empreinte qui le
// borne. Il faut le savoir plutôt que de croire le contraire.

/**
 * LES NOMS DE SECRETS SONT TOLÉRANTS, comme ailleurs dans ce dépôt
 * (`GROQ_API_KEY || GROK_API_KEY`, `BEDROCK_TOKEN || BEDROCK_API_KEY`).
 *
 * Un secret posé à la main dans un tableau de bord se nomme rarement du premier
 * coup comme la documentation l'imaginait. Accepter quelques orthographes coûte
 * trois lignes ; une clé introuvable coûte une demi-journée, parce que l'erreur
 * ne se voit qu'au premier visiteur.
 */
function premier(...noms: string[]): string | null {
  for (const n of noms) {
    const v = Deno.env.get(n)
    if (v && v.trim()) return v.trim()
  }
  return null
}

export const clePrivee = () =>
  premier('VAPI_PRIVATE_KEY', 'VAPI_API_KEY', 'VAPI_SECRET_KEY', 'VAPI_KEY', 'VAPIPRIVATEKEY')

export const assistantId = () =>
  premier('VAPI_ASSISTANT_ID', 'VAPI_ASSISTANT', 'VAPIASSISTANTID')

const orgIdConfigure = () =>
  premier('VAPI_ORG_ID', 'VAPI_ORGANIZATION_ID', 'VAPI_ORGID', 'VAPIORGID')

/** Ce que la fonction a cherché — pour que le diagnostic soit lisible sans nous. */
export const NOMS_ATTENDUS = {
  cle: 'VAPI_PRIVATE_KEY (ou VAPI_API_KEY, VAPI_SECRET_KEY, VAPI_KEY)',
  assistant: 'VAPI_ASSISTANT_ID (ou VAPI_ASSISTANT)',
  org: 'VAPI_ORG_ID (facultatif — déduit de la clé privée si absent)',
}

// ---------------------------------------------------------------- JWT ------
const enc = new TextEncoder()

function base64url(donnees: Uint8Array | string): string {
  const o = typeof donnees === 'string' ? enc.encode(donnees) : donnees
  let s = ''
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * SIGNER LE JETON À LA MAIN, plutôt que d'ajouter une bibliothèque.
 *
 * Un JWT HS256 tient en trois lignes de base64url et un HMAC — que la plateforme
 * fournit déjà (`crypto.subtle`), et que ce dépôt utilise ailleurs pour signer
 * les requêtes AWS. Faire entrer une dépendance externe DANS LE CHEMIN QUI
 * DÉLIVRE LES LAISSEZ-PASSER serait le seul endroit du projet où l'on ne
 * voudrait pas d'un paquet qu'on ne relit pas.
 */
async function signerJwt(charge: Record<string, unknown>, secret: string, dureeS: number): Promise<string> {
  const entete = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const maintenant = Math.floor(Date.now() / 1000)
  const corps = base64url(JSON.stringify({ ...charge, iat: maintenant, exp: maintenant + dureeS }))
  const cle = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cle, enc.encode(`${entete}.${corps}`)))
  return `${entete}.${corps}.${base64url(signature)}`
}

/**
 * L'IDENTIFIANT D'ORGANISATION, DÉDUIT PLUTÔT QUE RECOPIÉ.
 *
 * La clé privée désigne déjà l'organisation : demander en plus qu'on recopie son
 * identifiant à la main, c'est ajouter un endroit où se tromper d'un caractère —
 * et cette erreur-là ne se voit qu'au premier visiteur, sous la forme d'un jeton
 * refusé sans explication.
 *
 * On garde la valeur en mémoire du processus : une instance chaude d'Edge
 * Function sert plusieurs demandes, et cet aller-retour n'a aucune raison
 * d'être payé deux fois.
 */
let orgIdMemoire: string | null = null

export async function orgIdDe(cle: string): Promise<string | null> {
  const pose = orgIdConfigure()
  if (pose) return pose
  if (orgIdMemoire) return orgIdMemoire
  try {
    const r = await fetch('https://api.vapi.ai/assistant?limit=1', {
      headers: { Authorization: `Bearer ${cle}` }
    })
    if (!r.ok) {
      console.error('[vapi] découverte orgId :', r.status, (await r.text()).slice(0, 200))
      return null
    }
    const liste = await r.json()
    const id = Array.isArray(liste) ? liste[0]?.orgId : liste?.results?.[0]?.orgId
    if (id) orgIdMemoire = String(id)
    return orgIdMemoire
  } catch (e) {
    console.error('[vapi] découverte orgId injoignable :', String(e))
    return null
  }
}

/**
 * LE LAISSEZ-PASSER.
 *
 * `allowedAssistantIds` et `allowTransientAssistant: false` sont le cœur de la
 * chose : le jeton n'autorise QU'UN assistant, celui du musée, et interdit d'en
 * fabriquer un à la volée. Sans ces deux champs, un jeton qui fuite ouvre un
 * agent vocal quelconque, entièrement configurable, sur notre facture.
 *
 * QUINZE MINUTES, et c'est un compromis à mesurer. Chez xAI, soixante secondes
 * suffisaient : le jeton ne servait qu'à ouvrir la connexion. Ici, le SDK s'en
 * sert pendant la session ; trop court, il couperait une conversation en cours.
 * Trop long, il devient réutilisable s'il est intercepté. On commence prudent et
 * on ajustera sur ce qu'on observe.
 */
export const VALIDITE_S = 900

export async function jetonVapi(cle: string, org: string, assistant: string): Promise<string> {
  return await signerJwt({
    orgId: org,
    token: { tag: 'public' },
    restrictions: {
      allowedAssistantIds: [assistant],
      allowTransientAssistant: false,
    },
  }, cle, VALIDITE_S)
}

// -------------------------------------------------------------- outils ------

export type AppelOutil = { id: string; nom: string; args: Record<string, any> }

/**
 * LIRE LES APPELS D'OUTIL, quelle que soit la forme du jour.
 *
 * La documentation de Vapi montre `toolCallList[].name` / `.arguments`, mais on
 * rencontre aussi la forme OpenAI — `.function.name`, `.function.arguments` en
 * chaîne JSON. On accepte les deux plutôt que de casser au premier ajustement de
 * leur schéma : c'est la même précaution que pour le secret de xAI, qui arrivait
 * tantôt à la racine, tantôt sous `client_secret`.
 */
export function appelsDe(corps: any): AppelOutil[] {
  const liste = corps?.message?.toolCallList || corps?.message?.toolCalls || corps?.toolCallList || []
  return (Array.isArray(liste) ? liste : []).map((a: any) => {
    let args = a?.arguments ?? a?.function?.arguments ?? {}
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch { args = {} }
    }
    return {
      id: String(a?.id || a?.toolCallId || ''),
      nom: String(a?.name || a?.function?.name || ''),
      args: args && typeof args === 'object' ? args : {},
    }
  }).filter((a) => a.id && a.nom)
}

/** La réponse attendue par Vapi : un résultat par appel, relié par `toolCallId`. */
export function reponseOutils(resultats: { id: string; resultat: unknown }[]) {
  return {
    results: resultats.map((r) => ({
      toolCallId: r.id,
      // Toujours une CHAÎNE. Vapi accepte des objets selon les versions, mais le
      // modèle, lui, reçoit du texte dans tous les cas : autant décider nous-mêmes
      // de sa forme plutôt que de la laisser à une sérialisation implicite.
      result: typeof r.resultat === 'string' ? r.resultat : JSON.stringify(r.resultat),
    })),
  }
}
