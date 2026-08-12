// Edge Function « guide-agent » — guide IA du site visiteur, INTELLIGENT et chaleureux.
//
// Pipeline agentique :
//   1. Garde-fous + salutations (on ne renvoie JAMAIS « précisez » sur un bonjour).
//   2. Récupération LOCALE : contenu publié (musées, salles, objets, personnages, FAQ).
//   3. Récupération MONDIALE (à la demande) : « objets frères » via les collections
//      ouvertes du monde — The Met en priorité (API publique, sans clé, dép. Afrique).
//      Comme le Cabinet de comparaison de l'ERP, mais offert au visiteur.
//   4. LLM : reformule, instruit, présente même une œuvre absente du site avec sa
//      description. Grounding strict sur les FAITS PROPRES à la collection locale.
//   LLM primaire : Gemini (GEMINI_API_KEY) → fallback Groq (GROQ_API_KEY/GROK_API_KEY)
//   → fallback déterministe chaleureux (jamais d'erreur visible, jamais un « désolé »
//   sec). La clé API n'est JAMAIS exposée au frontend. verify_jwt=false (guide public,
//   lecture seule, sans effet de bord).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Hors périmètre — refus poli, sans appeler le LLM.
const OUT = /(m[eé]t[eé]o|actualit|politiqu|football|foot |recette|cuisine|bitcoin|crypto|blague|programm|javascript|python|\bcode\b|viagra|bourse)/i

// Salutations / courtoisie : on répond avec chaleur au lieu de demander de préciser.
const GREET = /^\s*(bonjour|bonsoir|salut|coucou|hello|hi|hey|yo|bonne\s+(journ[eé]e|soir[eé]e)|[çc]a\s+va|merci|au\s*revoir|ok|okay|d'accord)\b/i

// Intention « ailleurs dans le monde » → on interroge les collections mondiales.
const WORLD = /(monde|ailleurs|[eé]tranger|autres?\s+mus[eé]es?|international|diaspora|similaire|apparent|fr[eè]re|comparer|comparaison|met(ropolitan)?|louvre|exemple|dispers|semblable|proche|equivalent|équivalent|même\s+type)/i

const STOP = new Set([
  'avez', 'vous', 'avec', 'pour', 'dans', 'les', 'des', 'une', 'que', 'qui', 'est',
  'sur', 'par', 'mon', 'vos', 'nos', 'cette', 'quel', 'quelle', 'quels', 'quelles',
  'comment', 'montre', 'moi', 'raconte', 'parle', 'histoire', 'trouve', 'trouver',
  'the', 'and', 'ici', 'bonjour', 'salut', 'aussi', 'plus', 'tout', 'cela', 'votre',
])
function keywords(q: string): string[] {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
}

type Link = { label: string; to: string }
type Card = { title: string; subtitle?: string; description?: string; image?: string; url?: string; source?: string }
type Ground = { blocks: string[]; links: Link[]; fallback: string; hits: number; culture?: string }

type Scope = { museumId?: number; sectorId?: number }

// ---------------------------------------------------------------------------
// Récupération LOCALE (contenu publié). Renvoie aussi un indice de « culture »
// (mots-clés) qui sert à formuler la recherche mondiale.
// ---------------------------------------------------------------------------
async function retrieve(supabase: ReturnType<typeof createClient>, q: string, scope: Scope = {}): Promise<Ground> {
  const kw = keywords(q)
  const blocks: string[] = []
  const links: Link[] = []
  let fallback = ''
  let scopedHits = 0

  if (scope.museumId) {
    const m = await supabase
      .from('museums').select('id,nom,type,annee_fondation,description,histoire,published')
      .eq('id', scope.museumId).eq('published', true).maybeSingle()
    if (m.data) {
      const md: any = m.data
      const meta = [md.type, md.annee_fondation ? `fondé en ${md.annee_fondation}` : ''].filter(Boolean).join(', ')
      blocks.push(`MUSÉE COURANT — « ${md.nom} »${meta ? ` (${meta})` : ''}${md.description ? `\n${md.description}` : ''}${md.histoire ? `\nHistoire : ${md.histoire}` : ''}`)
      scopedHits++
    }
  }
  if (scope.sectorId) {
    const s = await supabase
      .from('sectors').select('id,nom,emplacement,description,histoire,published,museums(nom)')
      .eq('id', scope.sectorId).eq('published', true).maybeSingle()
    if (s.data) {
      const sd: any = s.data
      blocks.push(`SALLE COURANTE — « ${sd.nom} »${sd.emplacement ? ` (${sd.emplacement})` : ''}${sd.description ? `\n${sd.description}` : ''}${sd.histoire ? `\nHistoire : ${sd.histoire}` : ''}`)
      scopedHits++
    }
    const so = await supabase
      .from('objects').select('id,nom,nom_commun,description').eq('published', true).eq('sector_id', scope.sectorId).limit(8)
    for (const o of (so.data || []) as any[]) {
      blocks.push(`Œuvre de la salle — « ${o.nom} »${o.nom_commun ? ` (${o.nom_commun})` : ''}${o.description ? ` — ${o.description}` : ''}`)
    }
  }

  if (!kw.length) {
    return {
      blocks, links, hits: scopedHits,
      fallback: scopedHits
        ? "Je vous écoute : posez-moi une question sur ce que vous voyez ici."
        : "Je peux localiser un objet, présenter un musée, raconter l'histoire d'un chef, ou retrouver des œuvres apparentées dans les grands musées du monde.",
    }
  }
  const orNom = kw.map((k) => `nom.ilike.%${k}%`).join(',')
  let culture = ''

  const faq = await supabase
    .from('faq').select('question,reponse').eq('visible', true)
    .or(kw.map((k) => `question.ilike.%${k}%`).join(',')).limit(2)
  for (const f of faq.data || []) blocks.push(`FAQ — ${f.question}\n${f.reponse}`)
  if (faq.data?.length && !fallback) fallback = faq.data[0].reponse

  const sec = await supabase
    .from('sectors').select('nom, emplacement, museums(id,nom,published)').eq('published', true).or(orNom).limit(2)
  const secHit = (sec.data || []).filter((s: any) => s.museums?.published)
  for (const s of secHit as any[]) {
    blocks.push(`Salle « ${s.nom} » (${s.emplacement}) — musée : ${s.museums.nom}.`)
  }
  if (secHit.length && !fallback) {
    const s: any = secHit[0]
    fallback = `Oui : « ${s.nom} » se trouve au ${s.museums.nom}.`
    links.push({ label: `Voir ${s.museums.nom}`, to: `/site/musees/${s.museums.id}` })
  }

  const obj = await supabase
    .from('objects').select('id,nom,nom_commun,description,culture,origine,sectors(nom, museums(nom))').eq('published', true)
    .or(kw.map((k) => `nom.ilike.%${k}%,nom_commun.ilike.%${k}%`).join(',')).limit(3)
  for (const o of (obj.data || []) as any[]) {
    const loc = o.sectors?.museums?.nom ? ` (au ${o.sectors.museums.nom})` : ''
    blocks.push(`Œuvre « ${o.nom} »${o.nom_commun ? ` (${o.nom_commun})` : ''}${loc}${o.description ? ` — ${o.description}` : ''}`)
    links.push({ label: o.nom, to: `/site/objets/${o.id}` })
    if (!culture) culture = [o.culture, o.origine].filter(Boolean).join(' ')
  }
  if (obj.data?.length && !fallback) {
    const first: any = obj.data[0]
    const loc = first.sectors?.museums?.nom ? ` (au ${first.sectors.museums.nom})` : ''
    fallback = obj.data.length > 1
      ? `J'ai trouvé ${obj.data.length} objets correspondants :`
      : `« ${first.nom} »${loc}${first.description ? ' — ' + first.description : ''}`
  }

  const pers = await supabase
    .from('personnages').select('id,nom,prenom,titre,biographie').eq('published', true)
    .or(kw.map((k) => `nom.ilike.%${k}%,prenom.ilike.%${k}%,titre.ilike.%${k}%`).join(',')).limit(2)
  for (const p of (pers.data || []) as any[]) {
    const nom = p.prenom ? `${p.prenom} ${p.nom}` : p.nom
    blocks.push(`Personnage — ${p.titre ? p.titre + ' ' : ''}${nom}${p.biographie ? ` : ${p.biographie}` : ''}`)
    links.push({ label: nom, to: `/site/personnages/${p.id}` })
  }
  if (pers.data?.length && !fallback) {
    const p: any = pers.data[0]
    const nom = p.prenom ? `${p.prenom} ${p.nom}` : p.nom
    fallback = `${p.titre ? p.titre + ' ' : ''}${nom}${p.biographie ? ' — ' + p.biographie : ''}`
  }

  const mus = await supabase.from('museums').select('id,nom,description').eq('published', true).or(orNom).limit(2)
  for (const m of (mus.data || []) as any[]) {
    blocks.push(`Musée « ${m.nom} »${m.description ? ` — ${m.description}` : ''}`)
    links.push({ label: `Découvrir ${m.nom}`, to: `/site/musees/${m.id}` })
  }
  if (mus.data?.length && !fallback) {
    const m: any = mus.data[0]
    fallback = `${m.nom} : ${m.description || ''}`
  }

  if (!fallback) {
    fallback = "Je n'ai pas de notice précise là-dessus dans nos salles, mais je peux vous éclairer avec plaisir sur l'art et l'histoire des chefferies."
  }
  const seen = new Set<string>()
  const uniqLinks = links.filter((l) => (seen.has(l.to) ? false : (seen.add(l.to), true))).slice(0, 4)

  return { blocks, links: uniqLinks, fallback, hits: blocks.length, culture: culture || kw.join(' ') }
}

// ---------------------------------------------------------------------------
// Récupération MONDIALE — The Met (API publique, sans clé). On cible d'abord le
// département « Arts of Africa, Oceania, and the Americas » (id 5), puis on
// élargit. On ne garde que des œuvres AVEC image, et on en présente jusqu'à 2.
// ---------------------------------------------------------------------------
const MET = 'https://collectionapi.metmuseum.org/public/collection/v1'

async function fetchJson(url: string, ms = 6000): Promise<any | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(t) }
}

// Type d'objet FR → mot-clé de catalogue EN (sinon '*' = tout le Cameroun).
// MESURE : la recherche fiable du Met passe par `geoLocation=Cameroon` (240 œuvres,
// propres) ; `departmentId=5` combiné à `q` renvoie 0, et `q=Bamileke` seul est
// bruité (livre des morts égyptien en tête). On filtre donc par géolocalisation.
function typeMonde(culture: string, q: string): string {
  const src = `${culture} ${q}`.toLowerCase()
  const map: Record<string, string> = {
    masque: 'mask', trône: 'throne', trone: 'throne', tabouret: 'stool', siège: 'stool',
    statue: 'figure', statuette: 'figure', sculpture: 'figure', textile: 'textile', tissu: 'textile',
    perle: 'beadwork', perlage: 'beadwork', pipe: 'pipe', tambour: 'drum', coiffe: 'headdress',
    bracelet: 'bracelet', collier: 'necklace', calebasse: 'vessel', poterie: 'ceramic',
    elephant: 'elephant', éléphant: 'elephant', leopard: 'leopard', léopard: 'leopard', buffle: 'buffalo',
  }
  for (const [fr, en] of Object.entries(map)) if (src.includes(fr)) return en
  return '*'
}

async function searchMonde(culture: string, q: string): Promise<Card[]> {
  const type = typeMonde(culture, q)
  let s = await fetchJson(`${MET}/search?hasImages=true&geoLocation=Cameroon&q=${encodeURIComponent(type)}`)
  let ids: number[] = (s?.objectIDs || [])
  if (!ids.length) {
    s = await fetchJson(`${MET}/search?hasImages=true&geoLocation=Cameroon&q=*`)
    ids = (s?.objectIDs || [])
  }
  // Beaucoup d'œuvres n'ont pas de visuel : on pioche au hasard plutôt que de suivre
  // l'ordre du catalogue, et on borne les essais (latence maîtrisée côté visiteur).
  ids = ids.sort(() => Math.random() - 0.5).slice(0, 8)
  const cards: Card[] = []
  for (const id of ids) {
    if (cards.length >= 2) break
    const o = await fetchJson(`${MET}/objects/${id}`)
    if (!o || !o.primaryImageSmall) continue
    const desc = [o.culture, o.period, o.objectDate, o.medium].filter(Boolean).join(' · ')
    cards.push({
      title: o.title || 'Œuvre',
      subtitle: [o.culture, o.objectDate].filter(Boolean).join(', ') || o.country || '',
      description: desc,
      image: o.primaryImageSmall,
      url: o.objectURL,
      source: 'The Metropolitan Museum of Art (New York)',
    })
  }
  return cards
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------
const SYSTEM = `Tu es un guide de musée ÉRUDIT, chaleureux et vivant de la Fondation Jean Félicien Gacha, qui numérise le patrimoine des chefferies camerounaises : œuvres (masques, sculptures, trônes, textiles…), histoire des royaumes Grassfields (Bamiléké, Bamoun, Tikar…) et généalogie des chefs (fon).

TON RÔLE : accueillir, instruire et donner envie. Tu réponds TOUJOURS de façon utile — jamais un « désolé, je n'ai pas d'information ». Si un fait précis manque, tu apportes la culture générale pertinente et tu proposes une piste.

SALUTATIONS : si le visiteur dit bonjour / merci / ça va, réponds avec chaleur, présente-toi en une phrase et propose 2-3 choses que tu peux faire (localiser une œuvre, raconter un royaume, retrouver des œuvres apparentées dans les musées du monde).

ANCRAGE (strict) : les FAITS PROPRES À CETTE COLLECTION — noms d'œuvres exposées, datations précises, provenances, liens de parenté, où c'est exposé — proviennent UNIQUEMENT du CONTEXTE LOCAL. N'invente jamais un tel fait s'il n'y est pas.
CULTURE GÉNÉRALE : tu PEUX enrichir librement avec des connaissances établies sur l'art et l'histoire des chefferies (techniques : fonte à la cire perdue, perlage, sculpture ; symbolisme : léopard, buffle, python, araignée). Cela n'a pas besoin d'être dans le contexte.

ŒUVRES DU MONDE : si des « ŒUVRES APPARENTÉES (MUSÉES DU MONDE) » sont fournies, présente-les avec enthousiasme comme des « cousines » de nos pièces (« au Metropolitan Museum de New York, on conserve… »), en expliquant CE QUI les relie (même culture, même technique, même usage). Ne prétends pas qu'elles sont chez nous.

STYLE : français, ton incarné et cultivé, 2 à 5 phrases, pas de listes sauf nécessité. Reste dans ton périmètre (patrimoine, œuvres, chefferies, généalogie, visite). Ne dis jamais que tu es une IA, ne prononce pas le mot « contexte ».`

function buildUserPrompt(q: string, blocks: string[], cards: Card[]): string {
  let p = `CONTEXTE LOCAL (contenu publié du site) :\n${blocks.length ? blocks.join('\n') : '(rien de précis trouvé dans nos notices publiées)'}`
  if (cards.length) {
    p += `\n\nŒUVRES APPARENTÉES (MUSÉES DU MONDE) :\n` + cards.map((c, i) =>
      `${i + 1}. « ${c.title} » — ${c.subtitle || ''}${c.description ? ` — ${c.description}` : ''} [${c.source}]`).join('\n')
  }
  p += `\n\nQUESTION DU VISITEUR :\n${q}`
  return p
}

async function withTimeout(p: Promise<Response>, ms: number, ctrl: AbortController): Promise<Response> {
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await p } finally { clearTimeout(t) }
}

async function callGemini(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash'
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
        generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
      }),
    },
  ), 9000, ctrl)
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('').trim()
  return text || null
}

async function callGroq(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) return null
  const model = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile'
  const ctrl = new AbortController()
  const res = await withTimeout(fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: ctrl.signal,
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 500,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }), 9000, ctrl)
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content?.trim()
  return text || null
}

// Repli déterministe CHALEUREUX (aucune clé LLM / échec des deux).
function fallbackChaleureux(q: string, g: Ground, cards: Card[], greeted: boolean): string {
  if (greeted) {
    return "Bonjour et bienvenue ! Je suis le guide de la Fondation Jean Félicien Gacha. Je peux localiser une œuvre, vous raconter l'histoire d'un royaume Grassfields, ou retrouver des pièces apparentées dans les grands musées du monde. Que souhaitez-vous découvrir ?"
  }
  let t = g.fallback
  if (cards.length) {
    const c = cards[0]
    t += ` Et pour aller plus loin : au ${c.source}, on conserve « ${c.title} »${c.subtitle ? ` (${c.subtitle})` : ''} — une œuvre de la même famille, que je vous montre ci-dessous.`
  }
  return t
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const q = String(body?.question || '').trim()
    const scope: Scope = {
      museumId: Number(body?.museumId) || undefined,
      sectorId: Number(body?.sectorId) || undefined,
    }

    if (!q) return json({ text: "Bonjour ! Posez-moi une question sur nos musées, nos œuvres, ou demandez-moi de retrouver des pièces apparentées dans les musées du monde.", links: [], cards: [], source: 'guard' })
    if (OUT.test(q)) {
      return json({
        text: "Je suis le guide de la Fondation Jean Félicien Gacha : je réponds sur nos musées, nos œuvres et la généalogie des chefferies. En quoi puis-je vous éclairer sur le patrimoine ?",
        links: [], cards: [], source: 'guard',
      })
    }

    const greeted = GREET.test(q)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const g = await retrieve(supabase, q, scope)

    // Recherche mondiale : à la demande explicite, ou quand le local est mince mais
    // que la question porte visiblement sur une œuvre/culture (et pas une salutation).
    const kwCount = keywords(q).length
    const wantWorld = !greeted && (WORLD.test(q) || (g.hits <= 1 && kwCount >= 1))
    let cards: Card[] = []
    // Œuvres du monde fournies par le CLIENT (pattern déjà retenu dans ce projet :
    // `freres` note que les API de musées sont interrogées « côté client, qui sait
    // déjà le faire », et collectionsApi.js confirme le CORS navigateur). Mesuré
    // ici : le runtime Deno ne joint pas collectionapi.metmuseum.org, alors que le
    // navigateur l'atteint sans peine — on prend donc ce que le client a trouvé.
    if (Array.isArray(body?.cards) && body.cards.length) {
      cards = body.cards.slice(0, 3).map((c: any) => ({
        title: String(c?.title || 'Œuvre'),
        subtitle: c?.subtitle ? String(c.subtitle) : undefined,
        description: c?.description ? String(c.description) : undefined,
        image: c?.image ? String(c.image) : undefined,
        url: c?.url ? String(c.url) : undefined,
        source: c?.source ? String(c.source) : undefined,
      }))
    } else if (wantWorld) {
      // Tentative serveur (utile si l'egress s'ouvre un jour) : jamais bloquante.
      cards = await searchMonde(g.culture || '', q)
    }

    // On appelle le LLM dès qu'on a du contexte OU une salutation OU des œuvres du monde.
    const user = buildUserPrompt(q, g.blocks, cards)
    let text: string | null = null
    let source = 'grounded'
    try { text = await callGemini(SYSTEM, user); if (text) source = 'gemini' } catch (e) { console.error('[gemini]', String(e)) }
    if (!text) {
      try { text = await callGroq(SYSTEM, user); if (text) source = 'groq' } catch (e) { console.error('[groq]', String(e)) }
    }
    if (!text) { text = fallbackChaleureux(q, g, cards, greeted); source = 'grounded' }

    return json({ text, links: g.links, cards, source })
  } catch (e) {
    console.error('[guide-agent]', String(e))
    return json({ text: "Un petit contretemps technique — reformulez votre question, je reste à votre écoute.", links: [], cards: [], source: 'error' }, 200)
  }
})
