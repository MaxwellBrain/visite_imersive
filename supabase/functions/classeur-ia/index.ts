// Edge Function « classeur-ia » — ranger un tableau qu'on n'a pas écrit.
//
// CE QU'ELLE FAIT, ET CE QU'ELLE NE FAIT PAS
//
// Elle reçoit les EN-TÊTES d'un classeur et quelques lignes d'exemple, et elle
// répond : telle colonne du fichier correspond à tel champ de MUSÉA. Rien de
// plus. Elle ne réécrit aucune valeur, n'invente aucune notice, ne complète
// aucun champ vide.
//
// POURQUOI CETTE LIMITE EST LE CŒUR DU SUJET. Un modèle qui se trompe de
// colonne produit une erreur visible : les notices se retrouvent dans « nom »,
// on le voit à l'aperçu et on corrige. Un modèle autorisé à réécrire les
// VALEURS produirait des notices plausibles pour des pièces qu'il n'a jamais
// vues — et un musée publierait, sous son nom, des descriptions inventées.
// C'est irrattrapable, parce que rien ne le signale.
//
// La répartition est donc : l'IA décide OÙ VA chaque colonne, le code
// déterministe décide CE QUI EST VALIDE. Les vocabulaires contraints (matières,
// tons) restent normalisés côté client, contre une liste fermée.
//
// ELLE N'EST APPELÉE QU'EN RENFORT. La reconnaissance par titre et par alias
// couvre les fichiers ordinaires sans rien coûter. Cette fonction n'intervient
// que sur ce qui reste — un inventaire aux colonnes inattendues — et son échec
// n'est jamais bloquant : sans elle, les colonnes restent simplement absentes.
//
// verify_jwt : laissé actif. C'est une action de back-office, déclenchée par du
// personnel connecté, et facturée au jeton.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Un classeur peut avoir cent colonnes et dix mille lignes : on n'envoie que de
// quoi décider. Trois lignes suffisent à reconnaître une colonne de notices
// d'une colonne de dimensions, et cela borne la dépense.
const MAX_COLONNES = 60
const MAX_LIGNES = 3
const MAX_CELLULE = 160

function withTimeout<T>(p: Promise<T>, ms: number, ctrl: AbortController): Promise<T> {
  const t = setTimeout(() => ctrl.abort(), ms)
  return p.finally(() => clearTimeout(t)) as Promise<T>
}

const SYSTEME = `Tu ranges les colonnes d'un inventaire de musée dans les champs d'une application.

RÈGLES ABSOLUES
- Tu ne réécris JAMAIS une valeur. Tu ne fais que dire quelle colonne va dans quel champ.
- Une colonne du fichier ne peut servir qu'à UN champ.
- Si aucune colonne ne convient à un champ, réponds null pour ce champ. C'est une réponse correcte et fréquente : il vaut mieux un champ vide qu'un champ faux.
- N'utilise jamais une colonne déjà prise (liste fournie).
- Les colonnes qui ne correspondent à rien sont ignorées : ne force personne.

MÉTHODE
Regarde le nom de la colonne ET le contenu des exemples. Un en-tête « Notice »
contenant des phrases longues est une description ; un en-tête « Notice »
contenant « 12,4 cm » ne l'est pas.

RÉPONSE
Un objet JSON, et rien d'autre :
{"champs":{"<cle_du_champ>": <index de colonne ou null>, ...}}
Les index commencent à 0 et désignent la position dans la liste des en-têtes.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  let corps: any
  try { corps = await req.json() } catch { return json({ error: 'json' }, 400) }

  const entetes: string[] = (corps?.entetes || []).slice(0, MAX_COLONNES).map((h: unknown) => String(h ?? ''))
  const echantillon: string[][] = (corps?.echantillon || []).slice(0, MAX_LIGNES)
  const cibles: Array<{ cle: string; titre: string; aide?: string }> = corps?.cibles || []
  const prises: number[] = corps?.prises || []

  if (!entetes.length || !cibles.length) return json({ champs: {} })

  const tronque = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CELLULE)

  const tableau = [
    'EN-TÊTES DU FICHIER (index : nom)',
    ...entetes.map((h, i) => `  ${i} : ${tronque(h) || '(vide)'}`),
    '',
    'EXEMPLES DE LIGNES',
    ...echantillon.map((l, n) =>
      `  ligne ${n + 1} — ` + entetes.map((_, i) => `[${i}] ${tronque(l?.[i]) || '—'}`).join(' | ')),
    '',
    'CHAMPS À REMPLIR',
    ...cibles.map((c) => `  ${c.cle} — ${c.titre}${c.aide ? ` (${c.aide})` : ''}`),
    '',
    prises.length ? `COLONNES DÉJÀ PRISES, interdites : ${prises.join(', ')}` : 'Aucune colonne déjà prise.'
  ].join('\n')

  const texte = await appeler(SYSTEME, tableau)
  if (!texte) return json({ champs: {}, source: 'indisponible' })

  // Le modèle enrobe volontiers son JSON de ```json … ``` ou d'une phrase.
  const m = texte.match(/\{[\s\S]*\}/)
  if (!m) return json({ champs: {}, source: 'illisible' })

  let brut: any
  try { brut = JSON.parse(m[0]) } catch { return json({ champs: {}, source: 'illisible' }) }

  // ON NE FAIT PAS CONFIANCE À LA RÉPONSE. Un index hors bornes, une colonne
  // déjà prise ou un champ inconnu sont écartés ici : le client recevra une
  // correspondance utilisable, ou rien.
  const clesValides = new Set(cibles.map((c) => c.cle))
  const interdites = new Set(prises)
  const champs: Record<string, number> = {}
  for (const [k, v] of Object.entries(brut?.champs || {})) {
    if (!clesValides.has(k)) continue
    const i = Number(v)
    if (!Number.isInteger(i) || i < 0 || i >= entetes.length) continue
    if (interdites.has(i)) continue
    if (Object.values(champs).includes(i)) continue   // une colonne, un champ
    champs[k] = i
  }
  return json({ champs, source: 'ia' })
})

// Gemini d'abord, Groq en repli — même ordre et mêmes plafonds que `guide-agent`.
// Les identifiants de modèles se périment : ils restent pilotés par secret.
async function appeler(system: string, user: string): Promise<string | null> {
  try {
    const t = await callGemini(system, user)
    if (t) return t
  } catch (e) { console.warn('[classeur-ia] gemini', String(e)) }
  try {
    return await callGroq(system, user)
  } catch (e) { console.warn('[classeur-ia] groq', String(e)); return null }
}

async function callGemini(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'
  const ctrl = new AbortController()
  const res = await withTimeout(fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        // Température nulle : ranger des colonnes n'est pas un exercice de
        // style, et deux imports du même fichier doivent donner le même plan.
        generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' }
      })
    }
  ), 12000, ctrl)
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('').trim() || null
}

async function callGroq(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
  const ctrl = new AbortController()
  const res = await withTimeout(fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: ctrl.signal,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  }), 12000, ctrl)
  if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content?.trim() || null
}
