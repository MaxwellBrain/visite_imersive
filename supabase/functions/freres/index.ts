// Edge Function « freres » — le cerveau du Cabinet de comparaison.
//
// CE QU'ELLE FAIT, ET POURQUOI EN QUATRE ACTIONS
//
// La chaîne est « retrieve then rerank » : on ramène large et bruité depuis les
// API de musées (côté client, qui sait déjà le faire), puis on ORDONNE avec du
// sens, puis on JUGE. Chaque étape a un coût et un mode de panne différents,
// d'où quatre actions séparées plutôt qu'un gros appel monolithique.
//
//   requete       — la fiche du conservateur → une requête structurée + un
//                   texte ANGLAIS dense, prêt à plonger.
//   plonger       — calcule les plongements des candidats mis en cache.
//   plonger_objet — calcule celui de NOTRE œuvre.
//   juger         — les 20 finalistes → garder/écarter + une phrase par lien.
//
// ─────────────────────────────────────────────────────────────────────────────
// DEUX MESURES QUI ONT DICTÉ CETTE CONCEPTION (faites sur ce projet, pas lues)
//
// 1. IL FAUT PLONGER EN ANGLAIS. Avec `gte-small`, une requête française classe
//    « peinture de moulin hollandais » DEVANT deux masques de théâtre. La même
//    requête en anglais range proprement : vrais frères ≥ 0,898, bruit ≤ 0,779.
//    L'étendue passe de 0,13 à 0,20. C'est pour cela que `requete` produit un
//    `texte_en` et que c'est LUI qu'on plonge, jamais le français.
//
// 2. LE PLAFOND DE CALCUL EST BAS. 18 plongements dans un appel passent en
//    1,7 s ; 20 déclenchent WORKER_RESOURCE_LIMIT. D'où des lots de 12, et un
//    cache GLOBAL (`objets_externes`) pour ne jamais repayer deux fois.
//
// ─────────────────────────────────────────────────────────────────────────────
// SÉCURITÉ : comme `setup-agent`, on écrit avec le JETON DE L'APPELANT, jamais
// avec la clé de service. Les RPC vérifient l'organisation ; un appel détourné
// ne peut donc rien écrire hors de la sienne — la base refuse, pas le prompt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Lot volontairement sous le plafond mesuré (18 passent, 20 non) : il faut de
// la marge pour un démarrage à froid, plus lent que le régime établi.
const LOT_PLONGEMENTS = 12

// ---------------------------------------------------------------------------
// Modèle de langage : Groq, comme `memory-search`.
//
// POURQUOI PAS BEDROCK ICI, alors que `object-ai` l'utilise en priorité :
// Bedrock n'est PAS configuré sur ce projet (mesuré — `object-ai` se rabat
// systématiquement sur Groq). Les deux chemins rendent donc aujourd'hui
// exactement le même texte, et la chaîne Bedrock n'ajouterait que du poids au
// déploiement. Pour l'activer plus tard : importer `../_shared/bedrock.ts` et
// tenter `appelerBedrock` avant `callGroq`, comme le fait `object-ai`. Trois
// lignes, et la qualité de rédaction française y gagnera nettement.
// ---------------------------------------------------------------------------
async function rediger(system: string, user: string, maxTokens = 1200): Promise<
  { texte: string; moteur: string } | null
> {
  const texte = await callGroq(system, user, maxTokens)
  return texte ? { texte, moteur: 'groq-llama-3.3' } : null
}

async function callGroq(system: string, user: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    })
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return (await res.json())?.choices?.[0]?.message?.content?.trim() || null
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Consignes
// ---------------------------------------------------------------------------

const SYSTEM_REQUETE = `Tu prépares la recherche d'objets apparentés dans les grandes collections mondiales (Metropolitan Museum, Art Institute of Chicago, Cleveland Museum, Victoria & Albert, Wikidata).

On te donne la fiche d'une œuvre, rédigée en français par un conservateur camerounais. Tu produis de quoi l'interroger.

CE QUI COMPTE :
- Ces catalogues indexent EN ANGLAIS, avec le vocabulaire de l'ethnographie et de l'histoire de l'art. « masque éléphant » n'y renvoie rien ; « Bamileke beaded elephant mask » et « mbap mteng » y renvoient beaucoup. Traduire ne suffit pas : il faut le mot du catalogue.
- Donne les appellations vernaculaires quand elles existent et que tu en es sûr (mbap mteng, kuosi, ndop, tugunga…). Si tu n'es pas sûr, ne l'invente pas.

CHAMPS :
- culture : le peuple ou l'aire culturelle en anglais (Bamileke, Bamum, Tikar, Bali, Grassfields…).
- pays : en anglais.
- type_objet : la catégorie de catalogue en anglais (mask, throne, headdress, pipe, textile, drum…).
- materiaux : liste, en anglais.
- periode : en anglais, telle qu'un catalogue l'écrirait (« 19th century », « early 20th century »). Vide si la fiche ne le dit pas — n'invente JAMAIS une datation.
- technique : en anglais (beadwork, lost-wax casting, carving, weaving…). Vide si inconnue.
- termes_en : 3 à 6 expressions de recherche en anglais, de la plus précise à la plus large.
- texte_en : UNE phrase anglaise dense qui décrit l'objet — culture, type, matériaux, technique, usage, période. C'est ce texte qui servira à la comparaison sémantique : il doit contenir les mots qui comptent, pas de tournure narrative, pas de nom de musée.

RÈGLE ABSOLUE : n'invente aucun fait absent de la fiche. Un champ vide est une réponse honnête.

Réponds UNIQUEMENT par un objet JSON valide :
{"culture":"...","pays":"...","type_objet":"...","materiaux":["..."],"periode":"...","technique":"...","termes_en":["..."],"texte_en":"..."}`

const SYSTEM_JUGER = `Tu es documentaliste dans un musée. On te soumet une œuvre camerounaise et une liste d'objets trouvés dans des collections étrangères, déjà classés par proximité sémantique. Tu tries et tu expliques.

POUR CHAQUE CANDIDAT :
- garder : true si le rapprochement se défend devant un conservateur, false sinon. Sois exigeant — un masque japonais et un masque camerounais ne sont pas apparentés parce que ce sont deux masques. La proximité de vocabulaire n'est pas une parenté.
- type_lien : exactement l'une de ces valeurs — meme_culture, meme_technique, meme_periode, meme_atelier, meme_usage.
- justification : UNE phrase française, 20 mots maximum, qui dit CE QUI relie les deux objets. Elle est affichée au public sous l'image, dans un musée : elle doit être précise et sobre.

CE QUE LA JUSTIFICATION NE DOIT JAMAIS ÊTRE :
- Une paraphrase du titre (« masque bamiléké, comme le vôtre »).
- Une affirmation invérifiable (« provient certainement du même atelier ») — dis « même technique de perlage » si c'est ce que tu vois.
- Une formule creuse (« témoigne de la richesse du patrimoine »).

Si tu écartes un candidat, mets une justification courte disant pourquoi : elle sert au conservateur, pas au public.

Réponds UNIQUEMENT par un objet JSON valide :
{"verdicts":[{"id":123,"garder":true,"type_lien":"meme_culture","justification":"..."}]}`

const TYPES_LIEN = new Set([
  'meme_culture', 'meme_technique', 'meme_periode', 'meme_atelier', 'meme_usage'
])

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
  const action = String(body?.action || '')

  // ------------------------------------------------------------------ requete
  if (action === 'requete') {
    const fiche = [
      `Nom : ${String(body?.nom || '').slice(0, 200)}`,
      body?.nomCommun ? `Appellation courante : ${String(body.nomCommun).slice(0, 200)}` : '',
      body?.culture ? `Culture indiquée : ${String(body.culture).slice(0, 120)}` : '',
      body?.pays ? `Pays indiqué : ${String(body.pays).slice(0, 120)}` : '',
      body?.materiau ? `Matériaux indiqués : ${String(body.materiau).slice(0, 200)}` : '',
      body?.periode ? `Période indiquée : ${String(body.periode).slice(0, 120)}` : '',
      '',
      `Notice :\n${String(body?.description || '(aucune notice)').slice(0, 2500)}`
    ].filter(Boolean).join('\n')

    let sortie: { texte: string; moteur: string } | null = null
    try {
      sortie = await rediger(SYSTEM_REQUETE, fiche, 700)
    } catch (e) {
      console.error('[freres/requete]', String(e))
      return json({ ok: false, error: 'llm_error' })
    }
    if (!sortie) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(sortie.texte)
      const liste = (v: unknown) =>
        (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
      const texteEn = String(p?.texte_en || '').trim().slice(0, 600)
      // Sans `texte_en`, l'étape de reclassement n'a rien à comparer : autant
      // le dire tout de suite plutôt que de plonger une chaîne vide.
      if (!texteEn) return json({ ok: false, error: 'texte_en_manquant' })
      return json({
        ok: true,
        culture: String(p?.culture || '').trim().slice(0, 120),
        pays: String(p?.pays || '').trim().slice(0, 120),
        type_objet: String(p?.type_objet || '').trim().slice(0, 120),
        materiaux: liste(p?.materiaux),
        periode: String(p?.periode || '').trim().slice(0, 120),
        technique: String(p?.technique || '').trim().slice(0, 120),
        termes_en: liste(p?.termes_en),
        texte_en: texteEn,
        moteur: sortie.moteur
      })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  // --------------------------------------------------- plonger / plonger_objet
  if (action === 'plonger' || action === 'plonger_objet') {
    const autorisation = req.headers.get('Authorization') || ''
    if (!autorisation) return json({ ok: false, error: 'non_authentifie' }, 401)

    // Jeton de l'APPELANT : les RPC appliquent alors sa RLS, comme s'il
    // cliquait lui-même. Jamais la clé de service.
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: autorisation } } }
    )

    let session: any
    try {
      // @ts-ignore : global fourni par l'Edge Runtime Supabase, pas par Deno.
      session = new Supabase.ai.Session('gte-small')
    } catch (e) {
      console.error('[freres/plonger] modèle indisponible', String(e))
      return json({ ok: false, error: 'embeddings_indisponibles' })
    }
    const plonger = (t: string) => session.run(t, { mean_pool: true, normalize: true })

    if (action === 'plonger_objet') {
      const texte = String(body?.texte || '').trim().slice(0, 600)
      const objectId = Number(body?.objectId)
      if (!texte || !objectId) return json({ ok: false, error: 'parametres_manquants' }, 400)
      const v = await plonger(texte)
      const { error } = await sb.rpc('objet_plonger', {
        p_object_id: objectId, p_embedding: v, p_texte: texte
      })
      if (error) return json({ ok: false, error: error.message })
      return json({ ok: true, dimensions: v.length })
    }

    // Lot de candidats. On demande à la base CE QU'IL RESTE à faire plutôt que
    // de faire confiance à la liste du client : deux conservateurs peuvent
    // lancer la même recherche en même temps.
    const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : null
    const { data: aFaire, error: eLire } = await sb.rpc('externes_a_plonger', {
      p_ids: ids, p_limite: LOT_PLONGEMENTS
    })
    if (eLire) return json({ ok: false, error: eLire.message })
    if (!aFaire?.length) return json({ ok: true, plonges: 0, restants: 0 })

    let plonges = 0
    for (const ligne of aFaire) {
      try {
        const v = await plonger(String(ligne.texte_indexe).slice(0, 600))
        const { error } = await sb.rpc('externe_plonger', { p_id: ligne.id, p_embedding: v })
        if (!error) plonges++
      } catch (e) {
        // Un candidat qui échoue ne doit pas emporter le lot : il sera repris
        // au tour suivant puisqu'il reste sans plongement.
        console.warn('[freres/plonger] candidat ignoré', ligne.id, String(e).slice(0, 120))
      }
    }

    const { data: reste } = await sb.rpc('externes_a_plonger', { p_ids: ids, p_limite: 1 })
    return json({ ok: true, plonges, restants: reste?.length ? 1 : 0 })
  }

  // -------------------------------------------------------------------- juger
  if (action === 'juger') {
    const candidats = (Array.isArray(body?.candidats) ? body.candidats : []).slice(0, 20)
    if (!candidats.length) return json({ ok: false, error: 'aucun_candidat' }, 400)

    const notre = [
      `Notre œuvre : ${String(body?.nom || '').slice(0, 200)}`,
      body?.culture ? `Culture : ${String(body.culture).slice(0, 120)}` : '',
      body?.materiau ? `Matériaux : ${String(body.materiau).slice(0, 200)}` : '',
      body?.periode ? `Période : ${String(body.periode).slice(0, 120)}` : '',
      body?.description ? `Notice : ${String(body.description).slice(0, 1200)}` : ''
    ].filter(Boolean).join('\n')

    const liste = candidats.map((c: any) => {
      const champs = [
        c?.titre && `titre: ${String(c.titre).slice(0, 160)}`,
        c?.culture && `culture: ${String(c.culture).slice(0, 80)}`,
        c?.pays && `pays: ${String(c.pays).slice(0, 60)}`,
        c?.date_objet && `date: ${String(c.date_objet).slice(0, 60)}`,
        c?.materiau && `matériaux: ${String(c.materiau).slice(0, 120)}`,
        c?.source && `collection: ${String(c.source).slice(0, 40)}`
      ].filter(Boolean).join(' | ')
      return `id=${Number(c?.id)} — ${champs}`
    }).join('\n')

    let sortie: { texte: string; moteur: string } | null = null
    try {
      sortie = await rediger(SYSTEM_JUGER, `${notre}\n\nCandidats :\n${liste}`, 2000)
    } catch (e) {
      console.error('[freres/juger]', String(e))
      return json({ ok: false, error: 'llm_error' })
    }
    if (!sortie) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(sortie.texte)
      const connus = new Set(candidats.map((c: any) => Number(c?.id)))
      const verdicts = (Array.isArray(p?.verdicts) ? p.verdicts : [])
        .map((v: any) => ({
          id: Number(v?.id),
          garder: v?.garder === true,
          // Un type hors liste devient null plutôt que d'entrer tel quel : les
          // filtres du cabinet reposent sur ces cinq valeurs exactement.
          type_lien: TYPES_LIEN.has(String(v?.type_lien)) ? String(v.type_lien) : null,
          justification: String(v?.justification || '').trim().slice(0, 240)
        }))
        // Le modèle invente parfois un id : on n'en garde aucun qu'on n'ait
        // pas soumis, sinon on rattacherait une justification au mauvais objet.
        .filter((v: any) => connus.has(v.id))
      return json({ ok: true, verdicts, moteur: sortie.moteur })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
