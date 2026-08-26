import { supabase } from './supabase'
import { getPublicTenant } from './publicApi'

// Agent guide ANCRÉ sur le contenu publié (§3.3). Aucune écriture, périmètre limité (§3.4).
//
// Chemin nominal : Edge Function « guide-agent » (Gemini → Groq → fallback grounded,
// clé API côté serveur uniquement). Si la fonction est injoignable (réseau, non
// déployée), on se rabat sur la recherche ancrée LOCALE ci-dessous (askLocal) pour
// que le guide reste toujours fonctionnel. La logique de grounding est la même des
// deux côtés : le contenu publié reste la seule source de vérité.

// Appel de l'Edge Function (reformulation LLM ancrée, clé serveur). Renvoie { text, links }.
async function askRemote(question, scope = {}, cards = []) {
  const body = { question }
  // CLOISONNEMENT. Sans cette ligne le guide interroge le contenu publié de TOUTES
  // les organisations approuvées : la RLS (`tenant_is_public`) distingue « publié »
  // de « non publié », pas « chez moi » de « chez le voisin ». Un visiteur de la
  // chefferie A verrait donc les œuvres de la chefferie B.
  const tenantId = getPublicTenant()
  if (tenantId != null) body.tenantId = tenantId
  if (scope.museumId) body.museumId = scope.museumId
  if (scope.sectorId) body.sectorId = scope.sectorId
  // Œuvres du monde : c'est le NAVIGATEUR qui interroge les collections ouvertes
  // (The Met). Pattern déjà retenu ici — `freres` le fait « côté client, qui sait
  // déjà le faire », et le runtime Deno, lui, ne joint pas l'API du Met (mesuré).
  // On les transmet à l'IA pour qu'elle les présente et explique le lien.
  if (cards.length) body.cards = cards
  const { data, error } = await supabase.functions.invoke('guide-agent', { body })
  if (error) throw error
  if (!data || typeof data.text !== 'string') throw new Error('réponse invalide du guide')
  // `source` est conservé : c'est lui qui dit si le guide a VRAIMENT su répondre.
  // `cards` : œuvres apparentées trouvées dans les musées du monde (image + description).
  return {
    text: data.text,
    links: Array.isArray(data.links) ? data.links : [],
    cards: Array.isArray(data.cards) ? data.cards : [],
    source: data.source,
  }
}

// ---------------------------------------------------------------------------
// RÉÉCRITURE DES CHEMINS AU PRÉFIXE COURANT
//
// L'agent exprime ses chemins sur le site historique (`/site/objets/32`). Or une
// organisation peut être servie en `/c/<slug>/…` (développement, aperçu, et le
// domaine de plateforme). Laisser `/site` tel quel ferait sortir le visiteur de
// son organisation — pire, sur le domaine de plateforme `/site` redirige vers la
// vitrine (voir le beforeEnter du routeur) : le lien casse purement et simplement.
// ---------------------------------------------------------------------------
function auPrefixeCourant(chemin) {
  if (typeof window === 'undefined' || typeof chemin !== 'string') return chemin
  const m = /^\/c\/([^/]+)/.exec(window.location.pathname)
  return m ? chemin.replace(/^\/site(?=\/|$)/, `/c/${m[1]}`) : chemin
}

// Le modèle glisse parfois du Markdown (`**gras**`) que la bulle affiche tel quel,
// puisqu'elle rend du texte brut. On le retire ici plutôt que de compter sur une
// consigne : selon le moteur qui répond, la consigne passe ou ne passe pas.
function sansMarkdown(t) {
  return String(t || '')
    .replace(/\*\*+([^*]+)\*\*+/g, '$1')   // **gras**
    .replace(/__([^_]+)__/g, '$1')          // __gras__
    .replace(/^#{1,6}\s+/gm, '')            // titres
}


// Applique les deux nettoyages à une réponse complète.
function normaliserReponse(r) {
  return {
    ...r,
    text: sansMarkdown(r.text),
    links: (r.links || []).map((l) => ({ ...l, to: auPrefixeCourant(l.to) })),
    cards: (r.cards || []).map((c) => (c.to ? { ...c, to: auPrefixeCourant(c.to) } : c)),
  }
}

// Journal des questions — anonyme, et surtout jamais bloquant.
//
// `source === 'grounded'` signifie que rien n'a été trouvé dans le contenu publié :
// le guide a servi sa réponse de repli. C'est exactement le signal utile pour le
// conservateur — une question à laquelle SES notices ne répondent pas.
function journaliser(question, scope, source) {
  if (!scope?.museumId && !scope?.sectorId && !scope?.objectId) return
  supabase.rpc('journaliser_question', {
    p_question: question,
    p_museum_id: scope.museumId ?? null,
    p_sector_id: scope.sectorId ?? null,
    p_object_id: scope.objectId ?? null,
    p_repondu: source !== 'grounded'
  }).then(() => {}, () => { /* un journal ne doit jamais gêner un visiteur */ })
}

// Point d'entrée : tente l'Edge Function, se rabat sur la recherche locale en cas d'échec.
// `scope` (optionnel) = { museumId, sectorId } : ancre la réponse au musée / à la salle courants.
export async function ask(question, scope = {}) {
  const q = (question || '').trim()
  if (!q) return { text: 'Posez-moi une question sur nos musées, nos objets ou la généalogie des chefs.', links: [] }

  // Étape 1 — les collections du monde, depuis le navigateur (voir askRemote).
  // On la lance quand le visiteur le demande explicitement (« ailleurs », « dans le
  // monde », « similaire »…) ; jamais sur une salutation ni hors périmètre.
  let cards = []
  if (!GREET.test(q) && !OUT.test(q) && WORLD.test(q)) {
    try { cards = await searchMondeMet(q) } catch { /* jamais bloquant */ }
  }

  try {
    const brut = await askRemote(q, scope, cards)
    // L'IA a rédigé le texte ; on garantit que les vignettes suivent.
    if (cards.length && !(brut.cards || []).length) brut.cards = cards
    journaliser(q, scope, brut.source)
    return normaliserReponse(brut)
  } catch (e) {
    console.warn('[guide] Edge Function indisponible, repli local :', e?.message || e)
    const r = await askLocal(q, scope)
    // Recherche mondiale même en repli : à la demande, ou quand le local ne trouve
    // rien de précis. Les collections ouvertes (The Met) sont interrogeables depuis
    // le navigateur (CORS autorisé) — le visiteur reçoit une œuvre « cousine ».
    if (!GREET.test(q) && !OUT.test(q) && (WORLD.test(q) || !(r.links || []).length)) {
      try {
        const cards = await searchMondeMet(q)
        if (cards.length) {
          r.cards = cards
          const c = cards[0]
          r.text = `${r.text} Pour aller plus loin : au ${c.source}, on conserve « ${c.title} »${c.subtitle ? ` (${c.subtitle})` : ''} — une pièce de la même famille, à voir ci-dessous.`
        }
      } catch { /* la recherche mondiale ne doit jamais bloquer la réponse locale */ }
    }
    journaliser(q, scope, 'grounded')   // repli local : on n'a pas su répondre par l'IA
    return normaliserReponse(r)
  }
}

const WORLD = /(monde|ailleurs|[eé]tranger|autres?\s+mus[eé]es?|international|diaspora|similaire|apparent|fr[eè]re|comparer|comparaison|met(ropolitan)?|louvre|exemple|dispers|semblable|proche|[eé]quivalent|m[eê]me\s+type)/i

// Recherche mondiale compacte (The Met, sans clé, dép. Afrique/Océanie/Amériques).
const MET = 'https://collectionapi.metmuseum.org/public/collection/v1'
// Recherche fiable : filtrer par géolocalisation (geoLocation=Cameroon) — mesuré
// bien plus propre que q=Bamileke (bruité) ou departmentId=5 (renvoie 0).
function typeMonde(q) {
  const src = (q || '').toLowerCase()
  const map = {
    masque: 'mask', trône: 'throne', trone: 'throne', tabouret: 'stool', siège: 'stool',
    statue: 'figure', statuette: 'figure', sculpture: 'figure', textile: 'textile', tissu: 'textile',
    perle: 'beadwork', perlage: 'beadwork', pipe: 'pipe', tambour: 'drum', coiffe: 'headdress',
    bracelet: 'bracelet', collier: 'necklace', calebasse: 'vessel', poterie: 'ceramic',
    elephant: 'elephant', éléphant: 'elephant', leopard: 'leopard', léopard: 'leopard', buffle: 'buffalo',
  }
  for (const [fr, en] of Object.entries(map)) if (src.includes(fr)) return en
  return '*'
}
async function metJson(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    return r.ok ? await r.json() : null
  } catch { return null } finally { clearTimeout(t) }
}
export async function searchMondeMet(q) {
  const type = typeMonde(q)
  let s = await metJson(`${MET}/search?hasImages=true&geoLocation=Cameroon&q=${encodeURIComponent(type)}`)
  let ids = (s?.objectIDs || [])
  if (!ids.length) {
    s = await metJson(`${MET}/search?hasImages=true&geoLocation=Cameroon&q=*`)
    ids = (s?.objectIDs || [])
  }
  // Beaucoup d'œuvres n'ont pas de visuel : on pioche au hasard (au lieu de suivre
  // l'ordre du catalogue) pour tomber vite sur des pièces illustrées, et on borne
  // le nombre d'essais pour que le visiteur ne patiente jamais.
  ids = ids.sort(() => Math.random() - 0.5).slice(0, 8)
  const cards = []
  for (const id of ids) {
    if (cards.length >= 2) break
    const o = await metJson(`${MET}/objects/${id}`)
    if (!o || !o.primaryImageSmall) continue
    cards.push({
      title: o.title || 'Œuvre',
      subtitle: [o.culture, o.objectDate].filter(Boolean).join(', ') || o.country || '',
      description: [o.culture, o.period, o.objectDate, o.medium].filter(Boolean).join(' · '),
      image: o.primaryImageSmall,
      url: o.objectURL,
      source: 'The Metropolitan Museum of Art (New York)',
    })
  }
  return cards
}

const STOP = new Set([
  'avez', 'vous', 'avec', 'pour', 'dans', 'les', 'des', 'une', 'que', 'qui', 'est',
  'sur', 'par', 'mon', 'vos', 'nos', 'cette', 'quel', 'quelle', 'quels', 'quelles',
  'comment', 'montre', 'moi', 'raconte', 'parle', 'histoire', 'trouve', 'trouver',
  'the', 'and', 'ici', 'bonjour', 'salut', 'aussi', 'plus', 'tout', 'cela', 'votre'
])
const OUT = /(m[eé]t[eé]o|actualit|politiqu|football|foot |recette|cuisine|bitcoin|crypto|blague|programm|javascript|python|\bcode\b|viagra|bourse)/i
const GREET = /^\s*(bonjour|bonsoir|salut|coucou|hello|hi|hey|yo|bonne\s+(journ[eé]e|soir[eé]e)|[çc]a\s+va|merci|au\s*revoir|ok|okay|d'accord)\b/i

function keywords(q) {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
}

// Recherche ANCRÉE locale (repli) — identique à la logique portée dans l'Edge Function.
async function askLocal(question, scope = {}) {
  const q = (question || '').trim()
  if (!q) return { text: 'Posez-moi une question sur nos musées, nos objets ou la généalogie des chefs.', links: [] }
  if (OUT.test(q)) {
    return {
      text: "Je suis le guide de la Fondation Jean Félicien Gacha : je réponds uniquement aux questions sur nos musées, nos objets et la généalogie des chefferies. En quoi puis-je vous aider sur le patrimoine ?",
      links: []
    }
  }

  // Salutation → accueil chaleureux (jamais « précisez »).
  if (GREET.test(q)) {
    return {
      text: "Bonjour et bienvenue ! Je suis le guide de la Fondation Jean Félicien Gacha. Je peux localiser une œuvre, raconter l'histoire d'un royaume Grassfields, ou retrouver des pièces apparentées dans les grands musées du monde. Que souhaitez-vous découvrir ?",
      links: [], cards: [],
    }
  }

  // Même cloisonnement que le chemin nominal : un repli qui fuite reste une fuite.
  const tid = getPublicTenant()
  const cl = (r) => (tid == null ? r : r.eq('tenant_id', tid))

  const kw = keywords(q)
  if (!kw.length) {
    // Repli scopé : sans mot-clé mais dans un musée/salle, on présente le lieu.
    if (scope.sectorId) {
      const s = await cl(supabase.from('sectors').select('nom,description,histoire').eq('id', scope.sectorId)).maybeSingle()
      if (s.data) return { text: `« ${s.data.nom} » — ${s.data.histoire || s.data.description || ''}`.trim(), links: [] }
    }
    if (scope.museumId) {
      const m = await cl(supabase.from('museums').select('nom,description,histoire').eq('id', scope.museumId)).maybeSingle()
      if (m.data) return { text: `${m.data.nom} : ${m.data.histoire || m.data.description || ''}`.trim(), links: [] }
    }
    return { text: "Pouvez-vous préciser ? Je peux localiser un objet, présenter un musée ou raconter l'histoire d'un chef.", links: [] }
  }
  const orNom = kw.map((k) => `nom.ilike.%${k}%`).join(',')

  // 1) FAQ
  const faq = await cl(supabase
    .from('faq').select('question,reponse').eq('visible', true)
    .or(kw.map((k) => `question.ilike.%${k}%`).join(','))).limit(1)
  if (faq.data?.length) return { text: faq.data[0].reponse, links: [] }

  // 2) Secteurs (localisation)
  const sec = await cl(supabase
    .from('sectors').select('nom, museums(id,nom,published)').eq('published', true).or(orNom)).limit(2)
  const secHit = (sec.data || []).filter((s) => s.museums?.published)
  if (secHit.length) {
    const s = secHit[0]
    return {
      text: `Oui : « ${s.nom} » se trouve au ${s.museums.nom}.`,
      links: [{ label: `Voir ${s.museums.nom}`, to: `/site/musees/${s.museums.id}` }]
    }
  }

  // 3) Objets
  const obj = await cl(supabase
    .from('objects').select('id,nom,description,sectors(nom, museums(nom))').eq('published', true)
    .or(kw.map((k) => `nom.ilike.%${k}%,nom_commun.ilike.%${k}%`).join(','))).limit(3)
  if (obj.data?.length) {
    const first = obj.data[0]
    const loc = first.sectors?.museums?.nom ? ` (au ${first.sectors.museums.nom})` : ''
    const text = obj.data.length > 1
      ? `J'ai trouvé ${obj.data.length} objets correspondants :`
      : `« ${first.nom} »${loc}${first.description ? ' — ' + first.description : ''}`
    return { text, links: obj.data.map((o) => ({ label: o.nom, to: `/site/objets/${o.id}` })) }
  }

  // 4) Personnages
  const pers = await cl(supabase
    .from('personnages').select('nom,prenom,titre,biographie').eq('published', true)
    .or(kw.map((k) => `nom.ilike.%${k}%,prenom.ilike.%${k}%,titre.ilike.%${k}%`).join(','))).limit(2)
  if (pers.data?.length) {
    const p = pers.data[0]
    const nom = p.prenom ? `${p.prenom} ${p.nom}` : p.nom
    return { text: `${p.titre ? p.titre + ' ' : ''}${nom}${p.biographie ? ' — ' + p.biographie : ''}`, links: [] }
  }

  // 5) Musées
  const mus = await cl(supabase.from('museums').select('id,nom,description').eq('published', true).or(orNom)).limit(2)
  if (mus.data?.length) {
    const m = mus.data[0]
    return { text: `${m.nom} : ${m.description || ''}`, links: [{ label: `Découvrir ${m.nom}`, to: `/site/musees/${m.id}` }] }
  }

  return {
    text: "Je n'ai pas trouvé cela dans nos collections publiées. Souhaitez-vous parcourir la liste des musées ?",
    links: [{ label: 'Voir les musées', to: '/site/musees' }]
  }
}
