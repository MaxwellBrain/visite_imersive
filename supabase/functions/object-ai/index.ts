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
// Trois actions : `description` (réécriture), `seo` (métadonnées) et `annonce`
// (le message WhatsApp qui accompagne la carte de partage de l'œuvre).
//
// Deux moteurs : Claude via Amazon Bedrock d'abord — il écrit un bien meilleur
// français —, Groq en repli. Sans aucune clé → { ok:false }, et la saisie
// manuelle continue de fonctionner : jamais bloquant.

import { appelerBedrock, bedrockConfigure, MODELES } from '../_shared/bedrock.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// DEUX FOURNISSEURS, DANS CET ORDRE.
//
// Claude (via Bedrock) écrit un bien meilleur français que Llama : c'est
// exactement ce qu'on attend d'un cartel de musée. Mais il est facturé, et il
// exige que le formulaire d'usage Anthropic ait été soumis dans la console.
// Groq reste donc en second : gratuit, rapide, et déjà éprouvé ici.
//
// Le repli est SILENCIEUX pour l'utilisateur mais TRACÉ dans les journaux :
// une dégradation qu'on ne voit pas est une dégradation qu'on ne corrige jamais.
async function rediger(system: string, user: string, maxTokens = 900): Promise<
  { texte: string; moteur: string } | null
> {
  if (bedrockConfigure()) {
    try {
      const texte = await appelerBedrock({
        modele: MODELES.rapide,
        systeme: system,
        messages: [{ role: 'user', content: [{ text: user }] }],
        maxTokens,
        temperature: 0.5
      })
      if (texte) return { texte, moteur: 'claude-haiku-4.5' }
    } catch (e) {
      console.warn('[object-ai] Bedrock indisponible, repli sur Groq :', String(e).slice(0, 200))
    }
  }
  const texte = await callGroq(system, user, maxTokens)
  return texte ? { texte, moteur: 'groq-llama-3.3' } : null
}

async function callGroq(system: string, user: string, maxTokens = 900): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
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

// ANNONCE — le texte qui part sur WhatsApp avec la carte de l'œuvre.
//
// Registre volontairement différent du cartel : on ne rédige pas une notice, on
// donne envie de se déplacer. D'où les phrases courtes, le tutoiement du lecteur
// interdit malgré tout (on s'adresse à un public, pas à un ami), et une seule
// invitation finale — deux appels à l'action dans un message WhatsApp se
// neutralisent.
const SYSTEM_ANNONCE = `Tu écris le message WhatsApp qui accompagne la photo d'une œuvre d'un musée camerounais.

CONTRAINTES DE FORME :
- 250 caractères maximum, tout compris. Au-delà, WhatsApp replie le message et personne ne déplie.
- 2 ou 3 phrases courtes, séparées par des retours à la ligne simples.
- 1 à 3 émojis au total, jamais deux à la suite, jamais en début de ligne systématique.
- Se termine par UNE invitation à venir voir l'œuvre. Une seule.

CONTRAINTES DE FOND :
- N'invente aucun fait : ni date, ni matière, ni nom de chef, ni prix, ni horaire. Tu n'as que ce qu'on te donne.
- N'invente ni promotion, ni gratuité, ni événement.
- Pas de superlatif creux (« incontournable », « à ne pas manquer », « chef-d'œuvre absolu »).
- N'écris PAS le lien : il est ajouté après toi.
- Pas de mot-dièse à rallonge : deux au maximum, ou aucun.

Réponds UNIQUEMENT par un objet JSON valide :
{"texte": "le message, retours à la ligne compris"}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const action = String(body?.action || 'description')
  const nom = String(body?.nom || '').trim().slice(0, 200)
  const texte = String(body?.description || body?.text || '').trim().slice(0, 4000)

  // `annonce` fait exception : une œuvre fraîchement créée n'a souvent qu'un nom
  // et une salle, et c'est précisément à ce moment-là qu'on veut l'annoncer.
  if (!texte && action !== 'annonce') return json({ ok: false, error: 'empty_text' }, 400)
  if (action === 'annonce' && !texte && !nom) return json({ ok: false, error: 'empty_text' }, 400)

  // ------------------------------------------------------------- description
  if (action === 'description') {
    const user = [
      nom ? `Objet : ${nom}` : '',
      '',
      'Notes du conservateur :',
      texte
    ].filter(Boolean).join('\n')

    let sortie: { texte: string; moteur: string } | null = null
    try {
      sortie = await rediger(SYSTEM_DESCRIPTION, user, 900)
    } catch (e) {
      console.error('[object-ai/description]', String(e))
      // On remonte la CAUSE, pas seulement « llm_error ».
      // Un code d'erreur opaque oblige à fouiller les journaux du serveur pour
      // comprendre une panne que le message d'origine expliquait déjà.
      // Le détail ne contient que le statut HTTP et le corps de la réponse du
      // fournisseur : aucune clé n'y figure.
      return json({ ok: false, error: 'llm_error', detail: String(e).slice(0, 400) })
    }
    if (!sortie) return json({ ok: false, error: 'no_api_key' })
    const raw = sortie.texte

    try {
      const p = JSON.parse(raw)
      const out = String(p?.texte || '').trim()
      if (!out) return json({ ok: false, error: 'empty_result' })
      // Garde-fou : si le modèle a rendu un bloc compact malgré la consigne,
      // on ne prétend pas avoir amélioré la mise en forme.
      // `moteur` sert au diagnostic : il dit lequel des deux a réellement
      // répondu, sans quoi un repli permanent sur Groq passerait inaperçu.
      return json({
        ok: true,
        texte: out,
        paragraphes: out.split(/\n\s*\n/).length,
        moteur: sortie.moteur
      })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  // --------------------------------------------------------------------- seo
  if (action === 'seo') {
    const user = `Nom de l'objet : ${nom || '(non précisé)'}\n\nDescription :\n${texte}`

    let sortie: { texte: string; moteur: string } | null = null
    try {
      sortie = await rediger(SYSTEM_SEO, user, 400)
    } catch (e) {
      console.error('[object-ai/seo]', String(e))
      // On remonte la CAUSE, pas seulement « llm_error ».
      // Un code d'erreur opaque oblige à fouiller les journaux du serveur pour
      // comprendre une panne que le message d'origine expliquait déjà.
      // Le détail ne contient que le statut HTTP et le corps de la réponse du
      // fournisseur : aucune clé n'y figure.
      return json({ ok: false, error: 'llm_error', detail: String(e).slice(0, 400) })
    }
    if (!sortie) return json({ ok: false, error: 'no_api_key' })
    const raw = sortie.texte

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

  // ----------------------------------------------------------------- annonce
  if (action === 'annonce') {
    const lieu = String(body?.lieu || '').trim().slice(0, 200)
    const marque = String(body?.marque || '').trim().slice(0, 120)
    const user = [
      `Œuvre : ${nom || '(sans nom)'}`,
      lieu ? `Où la voir : ${lieu}` : '',
      marque ? `Institution : ${marque}` : '',
      body?.has3d ? 'Particularité : cette œuvre est consultable en 3D et en réalité augmentée.' : '',
      '',
      texte ? `Notice :\n${texte}` : 'Aucune notice disponible : appuie-toi uniquement sur le nom et le lieu.'
    ].filter(Boolean).join('\n')

    let sortie: { texte: string; moteur: string } | null = null
    try {
      sortie = await rediger(SYSTEM_ANNONCE, user, 400)
    } catch (e) {
      console.error('[object-ai/annonce]', String(e))
      // On remonte la CAUSE, pas seulement « llm_error ».
      // Un code d'erreur opaque oblige à fouiller les journaux du serveur pour
      // comprendre une panne que le message d'origine expliquait déjà.
      // Le détail ne contient que le statut HTTP et le corps de la réponse du
      // fournisseur : aucune clé n'y figure.
      return json({ ok: false, error: 'llm_error', detail: String(e).slice(0, 400) })
    }
    if (!sortie) return json({ ok: false, error: 'no_api_key' })

    try {
      const p = JSON.parse(sortie.texte)
      // La limite de 250 caractères est une CONSIGNE pour le modèle, pas une
      // garantie : on coupe nous-mêmes, et sur un espace, pour ne pas trancher
      // un mot au milieu.
      let out = String(p?.texte || '').trim().replace(/\n{3,}/g, '\n\n')
      if (!out) return json({ ok: false, error: 'empty_result' })
      if (out.length > 260) {
        const coupe = out.slice(0, 260)
        out = coupe.slice(0, Math.max(coupe.lastIndexOf(' '), 200)).trimEnd() + '…'
      }
      return json({ ok: true, texte: out, moteur: sortie.moteur })
    } catch {
      return json({ ok: false, error: 'bad_llm_json' })
    }
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
