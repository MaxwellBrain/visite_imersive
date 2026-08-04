import { supabase } from './supabase'

// Agent guide ANCRÉ sur le contenu publié (§3.3). Aucune écriture, périmètre limité (§3.4).
//
// Chemin nominal : Edge Function « guide-agent » (Gemini → Groq → fallback grounded,
// clé API côté serveur uniquement). Si la fonction est injoignable (réseau, non
// déployée), on se rabat sur la recherche ancrée LOCALE ci-dessous (askLocal) pour
// que le guide reste toujours fonctionnel. La logique de grounding est la même des
// deux côtés : le contenu publié reste la seule source de vérité.

// Appel de l'Edge Function (reformulation LLM ancrée, clé serveur). Renvoie { text, links }.
async function askRemote(question, scope = {}) {
  const body = { question }
  if (scope.museumId) body.museumId = scope.museumId
  if (scope.sectorId) body.sectorId = scope.sectorId
  const { data, error } = await supabase.functions.invoke('guide-agent', { body })
  if (error) throw error
  if (!data || typeof data.text !== 'string') throw new Error('réponse invalide du guide')
  // `source` est conservé : c'est lui qui dit si le guide a VRAIMENT su répondre.
  return { text: data.text, links: Array.isArray(data.links) ? data.links : [], source: data.source }
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
  try {
    const r = await askRemote(q, scope)
    journaliser(q, scope, r.source)
    return r
  } catch (e) {
    console.warn('[guide] Edge Function indisponible, repli local :', e?.message || e)
    const r = await askLocal(q, scope)
    journaliser(q, scope, 'grounded')   // repli local : on n'a pas su répondre par l'IA
    return r
  }
}

const STOP = new Set([
  'avez', 'vous', 'avec', 'pour', 'dans', 'les', 'des', 'une', 'que', 'qui', 'est',
  'sur', 'par', 'mon', 'vos', 'nos', 'cette', 'quel', 'quelle', 'quels', 'quelles',
  'comment', 'montre', 'moi', 'raconte', 'parle', 'histoire', 'trouve', 'trouver',
  'the', 'and', 'ici', 'bonjour', 'salut', 'aussi', 'plus', 'tout', 'cela', 'votre'
])
const OUT = /(m[eé]t[eé]o|actualit|politiqu|football|foot |recette|cuisine|bitcoin|crypto|blague|programm|javascript|python|\bcode\b|viagra|bourse)/i

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

  const kw = keywords(q)
  if (!kw.length) {
    // Repli scopé : sans mot-clé mais dans un musée/salle, on présente le lieu.
    if (scope.sectorId) {
      const s = await supabase.from('sectors').select('nom,description,histoire').eq('id', scope.sectorId).maybeSingle()
      if (s.data) return { text: `« ${s.data.nom} » — ${s.data.histoire || s.data.description || ''}`.trim(), links: [] }
    }
    if (scope.museumId) {
      const m = await supabase.from('museums').select('nom,description,histoire').eq('id', scope.museumId).maybeSingle()
      if (m.data) return { text: `${m.data.nom} : ${m.data.histoire || m.data.description || ''}`.trim(), links: [] }
    }
    return { text: "Pouvez-vous préciser ? Je peux localiser un objet, présenter un musée ou raconter l'histoire d'un chef.", links: [] }
  }
  const orNom = kw.map((k) => `nom.ilike.%${k}%`).join(',')

  // 1) FAQ
  const faq = await supabase
    .from('faq').select('question,reponse').eq('visible', true)
    .or(kw.map((k) => `question.ilike.%${k}%`).join(',')).limit(1)
  if (faq.data?.length) return { text: faq.data[0].reponse, links: [] }

  // 2) Secteurs (localisation)
  const sec = await supabase
    .from('sectors').select('nom, museums(id,nom,published)').eq('published', true).or(orNom).limit(2)
  const secHit = (sec.data || []).filter((s) => s.museums?.published)
  if (secHit.length) {
    const s = secHit[0]
    return {
      text: `Oui : « ${s.nom} » se trouve au ${s.museums.nom}.`,
      links: [{ label: `Voir ${s.museums.nom}`, to: `/site/musees/${s.museums.id}` }]
    }
  }

  // 3) Objets
  const obj = await supabase
    .from('objects').select('id,nom,description,sectors(nom, museums(nom))').eq('published', true)
    .or(kw.map((k) => `nom.ilike.%${k}%,nom_commun.ilike.%${k}%`).join(',')).limit(3)
  if (obj.data?.length) {
    const first = obj.data[0]
    const loc = first.sectors?.museums?.nom ? ` (au ${first.sectors.museums.nom})` : ''
    const text = obj.data.length > 1
      ? `J'ai trouvé ${obj.data.length} objets correspondants :`
      : `« ${first.nom} »${loc}${first.description ? ' — ' + first.description : ''}`
    return { text, links: obj.data.map((o) => ({ label: o.nom, to: `/site/objets/${o.id}` })) }
  }

  // 4) Personnages
  const pers = await supabase
    .from('personnages').select('nom,prenom,titre,biographie').eq('published', true)
    .or(kw.map((k) => `nom.ilike.%${k}%,prenom.ilike.%${k}%,titre.ilike.%${k}%`).join(',')).limit(2)
  if (pers.data?.length) {
    const p = pers.data[0]
    const nom = p.prenom ? `${p.prenom} ${p.nom}` : p.nom
    return { text: `${p.titre ? p.titre + ' ' : ''}${nom}${p.biographie ? ' — ' + p.biographie : ''}`, links: [] }
  }

  // 5) Musées
  const mus = await supabase.from('museums').select('id,nom,description').eq('published', true).or(orNom).limit(2)
  if (mus.data?.length) {
    const m = mus.data[0]
    return { text: `${m.nom} : ${m.description || ''}`, links: [{ label: `Découvrir ${m.nom}`, to: `/site/musees/${m.id}` }] }
  }

  return {
    text: "Je n'ai pas trouvé cela dans nos collections publiées. Souhaitez-vous parcourir la liste des musées ?",
    links: [{ label: 'Voir les musées', to: '/site/musees' }]
  }
}
