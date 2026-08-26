// Edge Function « campaign-ai » — rédaction assistée d'une campagne e-mail (V2 Phase 4).
//
// Reçoit { sujet, type, organisation?, contexte?, langue? } → renvoie { sujet, contenu }.
// Le contenu est du TEXTE BRUT (paragraphes séparés par une ligne vide) : la mise en forme
// HTML est faite par `send-email`, pour que tous les e-mails gardent la même identité.
//
// LLM : Groq (clé serveur). Sans clé ou en cas d'échec → { ok:false } et l'ERP laisse
// simplement l'admin écrire à la main : la fonctionnalité n'est jamais bloquante.
// verify_jwt=true : réservé au personnel connecté (rédaction = action de back-office).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const INTENTION: Record<string, string> = {
  annonce: "une annonce générale adressée aux visiteurs de l'institution",
  exposition: "l'annonce d'une exposition ou d'un événement à venir",
  message: 'un message personnalisé adressé aux visiteurs'
}

const SYSTEM = `Tu rédiges des e-mails pour une institution culturelle (musée, chefferie, fondation) qui valorise le patrimoine des chefferies camerounaises.

RÈGLES :
- Écris un e-mail court : 2 à 4 paragraphes, 120 mots maximum au total.
- Ton chaleureux, cultivé et respectueux, jamais racoleur. Pas de superlatifs creux, pas d'emojis.
- N'invente AUCUN fait précis : ni date, ni horaire, ni tarif, ni nom d'œuvre qui ne te serait pas donné.
  Si une information manque, reste volontairement général plutôt que d'inventer.
- N'écris ni objet, ni salutation d'en-tête, ni signature, ni formule de désinscription :
  ils sont ajoutés automatiquement autour de ton texte.
- Réponds UNIQUEMENT avec un objet JSON valide : {"sujet": "...", "contenu": "..."}
  où "sujet" est une ligne d'objet de 60 caractères maximum et "contenu" le corps du message,
  paragraphes séparés par une ligne vide (\\n\\n). Aucun autre texte autour du JSON.`

async function callGroq(system: string, user: string): Promise<string | null> {
  // Accepte GROQ_API_KEY (correct) ou GROK_API_KEY (faute de frappe historique du secret).
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    })
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() || null
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const sujet = String(body?.sujet || '').trim().slice(0, 300)
  if (!sujet) return json({ ok: false, error: 'empty_subject' }, 400)

  const type = String(body?.type || 'annonce')
  const organisation = String(body?.organisation || '').slice(0, 120)
  const contexte = String(body?.contexte || '').slice(0, 1200)
  const langue = String(body?.langue || 'fr') === 'en' ? 'anglais' : 'français'

  const user = [
    `Institution : ${organisation || 'une institution culturelle'}`,
    `Nature du message : ${INTENTION[type] || INTENTION.annonce}`,
    `Sujet donné par l'administrateur : ${sujet}`,
    contexte ? `Informations vérifiées à utiliser (ne rien ajouter au-delà) :\n${contexte}` : '',
    `Rédige en ${langue}.`
  ].filter(Boolean).join('\n')

  let raw: string | null = null
  try {
    raw = await callGroq(SYSTEM, user)
  } catch (e) {
    console.error('[campaign-ai]', String(e))
    return json({ ok: false, error: 'llm_error' })
  }
  if (!raw) return json({ ok: false, error: 'no_api_key' })

  try {
    const parsed = JSON.parse(raw)
    const contenu = String(parsed?.contenu || '').trim()
    if (!contenu) return json({ ok: false, error: 'empty_result' })
    return json({ ok: true, sujet: String(parsed?.sujet || sujet).trim().slice(0, 150), contenu })
  } catch {
    // Le modèle n'a pas renvoyé de JSON exploitable : on garde le texte tel quel.
    return json({ ok: true, sujet, contenu: raw })
  }
})
