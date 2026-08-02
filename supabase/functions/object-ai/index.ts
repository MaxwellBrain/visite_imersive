// Edge Function « object-ai » — rédaction des fiches d'objets.
//
// POURQUOI ELLE EXISTE
//
// Le bouton « améliorer avec l'IA » n'appelait aucune IA. Il exécutait un
// simulacre côté navigateur qui se contentait d'ajouter une phrase toute faite
// (« Pièce emblématique… ») — d'où l'impression, exacte, qu'il ne se passait
// rien. Pire, il appliquait `replace(/\s+/g, ' ')` : il écrasait les
// paragraphes que le conservateur venait de saisir.
//
// Deux actions : `description` (réécriture) et `seo` (métadonnées).
// LLM : Groq, clé serveur. Sans clé → { ok:false } et la saisie manuelle
// continue de fonctionner : jamais bloquant.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function callGroq(system: string, user: string, maxTokens = 900): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.55, // assez pour reformuler, pas assez pour broder
        max_tokens: maxTokens,
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

const SYSTEM_DESCRIPTION = `Tu rédiges les cartels d'un musée consacré au patrimoine des chefferies camerounaises (Bamiléké, Bamoun, Tikar, Bali).

On te donne les notes brutes d'un conservateur. Tu les transformes en une notice publiée, lisible par un visiteur qui ne connaît rien au sujet.

CE QUE TU DOIS FAIRE :
- Structurer en 2 à 4 PARAGRAPHES séparés par une ligne vide. C'est essentiel : un bloc compact ne se lit pas.
- Ordonner le propos : ce que l'on voit d'abord (forme, matière, décor), puis l'usage et le contexte, enfin ce que la pièce raconte.
- Élever le registre sans l'alourdir : phrases courtes, vocabulaire précis, aucun superlatif creux (« magnifique », « incontournable », « chef-d'œuvre absolu »).
- Conserver TOUS les faits donnés : dimensions, matériaux, noms, dates, provenance.

CE QUE TU NE DOIS JAMAIS FAIRE :
- Inventer un fait absent des notes : ni date, ni dimension, ni nom de chef, ni lieu de conservation, ni fonction rituelle non mentionnée.
- Ajouter une conclusion creuse du type « cette pièce invite le visiteur à découvrir son histoire ».
- Écrire à la première personne, ni t'adresser au lecteur.
- Rendre un texte plus court que les notes : tu structures et tu enrichis la formulation, tu ne résumes pas.

Si les notes sont trop maigres pour 2 paragraphes, écris-en un seul, correctement rédigé — c'est une réponse honnête.

Réponds UNIQUEMENT par un objet JSON valide :
{"texte": "les paragraphes, séparés par \\n\\n"}`

const SYSTEM_SEO = `Tu écris les métadonnées de référencement d'une fiche d'objet de musée.

RÈGLES :
- Le titre fait 60 caractères maximum, la description 155 maximum : au-delà, les moteurs tronquent.
- N'invente aucun fait. Tu ne disposes que du nom et de la description.
- Le slug est en minuscules, sans accent, mots séparés par des tirets.
- 4 à 8 mots-clés, en français, réellement présents dans le propos.

Réponds UNIQUEMENT par un objet JSON valide :
{"title": "...", "description": "...", "slug": "...", "keywords": ["..."]}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const action = String(body?.action || 'description')
  const nom = String(body?.nom || '').trim().slice(0, 200)
  const texte = String(body?.description || body?.text || '').trim().slice(0, 4000)

  if (!texte) return json({ ok: false, error: 'empty_text' }, 400)

  // ------------------------------------------------------------- description
  if (action === 'description') {
    const user = [
      nom ? `Objet : ${nom}` : '',
      '',
      'Notes du conservateur :',
      texte
    ].filter(Boolean).join('\n')

    let raw: string | null = null
    try {
      raw = await callGroq(SYSTEM_DESCRIPTION, user)
    } catch (e) {
      console.error('[object-ai/description]', String(e))
      return json({ ok: false, error: 'llm_error' })
    }
    if (!raw) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(raw)
      const out = String(p?.texte || '').trim()
      if (!out) return json({ ok: false, error: 'empty_result' })
      // Garde-fou : si le modèle a rendu un bloc compact malgré la consigne,
      // on ne prétend pas avoir amélioré la mise en forme.
      return json({ ok: true, texte: out, paragraphes: out.split(/\n\s*\n/).length })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  // --------------------------------------------------------------------- seo
  if (action === 'seo') {
    const user = `Nom de l'objet : ${nom || '(non précisé)'}\n\nDescription :\n${texte}`

    let raw: string | null = null
    try {
      raw = await callGroq(SYSTEM_SEO, user, 400)
    } catch (e) {
      console.error('[object-ai/seo]', String(e))
      return json({ ok: false, error: 'llm_error' })
    }
    if (!raw) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(raw)
      const mots = (Array.isArray(p?.keywords) ? p.keywords : [])
        .map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 8)
      return json({
        ok: true,
        title: String(p?.title || nom).trim().slice(0, 60),
        description: String(p?.description || '').trim().slice(0, 155),
        slug: String(p?.slug || '').trim().slice(0, 80),
        keywords: mots
      })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
