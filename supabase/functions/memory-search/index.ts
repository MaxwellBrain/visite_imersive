// Edge Function « memory-search » — le cerveau de la Mémoire Réunifiée (V2 Phase 5).
//
// Deux services, une seule fonction :
//
//  1. action « enrichir » : une requête en FRANÇAIS → les termes de recherche
//     réellement utiles. Ce n'est pas une simple traduction. Les collections
//     mondiales cataloguent en anglais, avec le vocabulaire de l'ethnographie :
//     chercher « masque éléphant » ne renvoie rien, « elephant mask » peu de
//     choses, « mbap mteng » et « Bamileke beadwork » beaucoup. Sans cette
//     étape, la recherche échoue non par manque de données mais par manque
//     de vocabulaire.
//
//  2. action « synthese » : à partir des correspondances trouvées, un bilan
//     rédigé. Contrainte non négociable : CHAQUE affirmation cite son musée et
//     son numéro d'inventaire, et l'incertitude est dite. Une synthèse qui
//     affirme sans source n'a aucune valeur dans un mémoire.
//
// LLM : Groq (clé serveur, jamais dans le navigateur). Sans clé → { ok:false }
// et l'ERP retombe sur la saisie manuelle : jamais bloquant.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ---------------------------------------------------------------------------
// Appel du modèle
// ---------------------------------------------------------------------------
async function callGroq(system: string, user: string, maxTokens = 700): Promise<string | null> {
  // Accepte GROQ_API_KEY (correct) ou GROK_API_KEY (faute de frappe historique du secret).
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2, // recherche documentaire : on veut de la constance, pas de l'imagination
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

// ---------------------------------------------------------------------------
// 1. Enrichissement de requête
// ---------------------------------------------------------------------------
const SYSTEM_ENRICHIR = `Tu es documentaliste spécialiste des arts d'Afrique subsaharienne, en particulier des chefferies de l'Ouest Cameroun (Bamiléké, Bamoun, Tikar, Bali).

Ta tâche : transformer une description d'objet en français en termes de recherche efficaces dans les catalogues de musées occidentaux, qui indexent en ANGLAIS avec le vocabulaire de l'ethnographie.

RÈGLES ABSOLUES :
- N'invente jamais un terme vernaculaire dont tu n'es pas sûr. Mieux vaut trois termes exacts que dix approximatifs.
- Si la culture ou le pays n'est pas déductible de la description, laisse la chaîne vide. Ne devine pas.
- Les termes anglais doivent être ceux employés dans les catalogues (« prestige stool » et non « royal chair »).
- Inclus le terme vernaculaire uniquement s'il est attesté et couramment employé dans la littérature.

Réponds UNIQUEMENT par un objet JSON valide :
{
  "termes_en": ["3 à 6 expressions de recherche en anglais, la plus précise d'abord"],
  "culture": "nom du groupe culturel en anglais, ou chaîne vide",
  "pays": "nom du pays en anglais, ou chaîne vide",
  "materiaux": ["matériaux en anglais"],
  "periode": "période probable, ex. '19th-20th century', ou chaîne vide",
  "synonymes": ["termes vernaculaires ou variantes orthographiques attestés"],
  "note": "une phrase en français expliquant les choix de vocabulaire, pour le conservateur"
}`

// ---------------------------------------------------------------------------
// 2. Synthèse sourcée
// ---------------------------------------------------------------------------
const SYSTEM_SYNTHESE = `Tu es documentaliste de musée. On te donne la liste des objets apparentés retrouvés dans des collections publiques, avec leur musée, leur pays et leur numéro d'inventaire.

Ta tâche : rédiger un bilan court et VÉRIFIABLE, en français.

RÈGLES ABSOLUES — leur non-respect rend la synthèse inutilisable dans un travail universitaire :
- N'affirme RIEN qui ne figure pas dans les données fournies. Aucune date, aucune provenance, aucune interprétation ajoutée.
- Chaque objet mentionné doit l'être avec son musée ET son numéro d'inventaire quand il est connu.
- Quand un numéro d'inventaire manque, écris-le explicitement (« inventaire non communiqué »).
- Les scores de correspondance sont des indices automatiques, pas des preuves : présente-les comme tels.
- Si les résultats sont trop hétérogènes pour conclure, dis-le. « Aucune conclusion possible » est une réponse valable.

Réponds UNIQUEMENT par un objet JSON valide :
{
  "resume": "2 à 4 phrases : combien d'objets, dans combien d'institutions, dans combien de pays",
  "points": ["3 à 5 constats, chacun citant musée et numéro d'inventaire"],
  "reserves": ["1 à 3 limites de cette recherche : homonymies, lacunes, indexation"],
  "confiance": "forte | moyenne | faible"
}`

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const action = String(body?.action || 'enrichir')

  // ---------------------------------------------------------------- enrichir
  if (action === 'enrichir') {
    const requete = String(body?.requete || '').trim().slice(0, 400)
    if (!requete) return json({ ok: false, error: 'empty_query' }, 400)

    const contexte = [
      `Description de l'objet (français) : ${requete}`,
      body?.culture ? `Culture indiquée par le conservateur : ${String(body.culture).slice(0, 80)}` : '',
      body?.pays ? `Pays indiqué par le conservateur : ${String(body.pays).slice(0, 80)}` : '',
      body?.materiau ? `Matériau indiqué : ${String(body.materiau).slice(0, 80)}` : '',
      body?.periode ? `Période indiquée : ${String(body.periode).slice(0, 80)}` : ''
    ].filter(Boolean).join('\n')

    let raw: string | null = null
    try {
      raw = await callGroq(SYSTEM_ENRICHIR, contexte, 500)
    } catch (e) {
      console.error('[memory-search/enrichir]', String(e))
      return json({ ok: false, error: 'llm_error' })
    }
    if (!raw) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(raw)
      const liste = (v: unknown, max: number) =>
        (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max)
      const termes = liste(p?.termes_en, 6)
      if (!termes.length) return json({ ok: false, error: 'empty_result' })
      return json({
        ok: true,
        termes_en: termes,
        culture: String(p?.culture || '').trim(),
        pays: String(p?.pays || '').trim(),
        materiaux: liste(p?.materiaux, 5),
        periode: String(p?.periode || '').trim(),
        synonymes: liste(p?.synonymes, 6),
        note: String(p?.note || '').trim().slice(0, 400)
      })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  // ---------------------------------------------------------------- synthese
  if (action === 'synthese') {
    const objet = String(body?.objet || '').trim().slice(0, 200)
    const brut = Array.isArray(body?.candidats) ? body.candidats : []
    if (!brut.length) return json({ ok: false, error: 'no_candidates' }, 400)

    // On n'envoie au modèle que le strict nécessaire : moins de jetons, et
    // surtout aucune donnée superflue qu'il pourrait se mettre à interpréter.
    const lignes = brut.slice(0, 30).map((c: Record<string, any>, i: number) =>
      [
        `${i + 1}.`,
        `titre="${String(c?.title || '').slice(0, 120)}"`,
        `musee="${String(c?.musee || c?.sourceLabel || '').slice(0, 90)}"`,
        `pays="${String(c?.paysMusee || '').slice(0, 60)}"`,
        `inventaire="${String(c?.inventaire || '').slice(0, 40) || 'non communiqué'}"`,
        `date="${String(c?.date || '').slice(0, 40)}"`,
        `matiere="${String(c?.medium || '').slice(0, 60)}"`,
        `score=${Number(c?.score) || 0}`
      ].join(' ')
    ).join('\n')

    const user = [
      `Objet de référence conservé par l'institution : ${objet || 'non précisé'}`,
      `Nombre de correspondances automatiques : ${brut.length}`,
      '',
      'Correspondances :',
      lignes
    ].join('\n')

    let raw: string | null = null
    try {
      raw = await callGroq(SYSTEM_SYNTHESE, user, 900)
    } catch (e) {
      console.error('[memory-search/synthese]', String(e))
      return json({ ok: false, error: 'llm_error' })
    }
    if (!raw) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(raw)
      const liste = (v: unknown, max: number) =>
        (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max)
      const resume = String(p?.resume || '').trim()
      if (!resume) return json({ ok: false, error: 'empty_result' })
      const confiance = ['forte', 'moyenne', 'faible'].includes(String(p?.confiance))
        ? String(p.confiance)
        : 'moyenne'
      return json({
        ok: true,
        resume,
        points: liste(p?.points, 5),
        reserves: liste(p?.reserves, 3),
        confiance
      })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
