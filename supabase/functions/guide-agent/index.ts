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
  return normaliser(q).split(' ').filter((w) => w.length > 3 && !STOP.has(w))
}

// ---------------------------------------------------------------------------
// APPARIEMENT TOLÉRANT AUX FAUTES DE FRAPPE
//
// POURQUOI. La recherche reposait sur `nom.ilike.%mot%`, c'est-à-dire une
// correspondance EXACTE de sous-chaîne. « masqe » ne trouvait rien, « elephant »
// sans accent non plus. Or le visiteur tape sur un téléphone, souvent vite et mal :
// un guide qui répond « je n'ai pas trouvé » pour une lettre de travers paraît
// stupide alors que l'œuvre est à trois mètres de lui.
//
// COMMENT. On charge le catalogue PUBLIÉ DU LOCATAIRE (quelques dizaines de lignes)
// et on apparie en mémoire. À cette échelle c'est instantané, et cela évite
// d'installer pg_trgm puis de maintenir un index dont personne n'a encore besoin.
// Le plafond est explicite : au-delà, il faudra une vraie recherche floue en base.
// ---------------------------------------------------------------------------
const PLAFOND_CATALOGUE = 400

function normaliser(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // accents : « éléphant » devient « elephant »
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Levenshtein BORNÉE : dès qu'une ligne entière dépasse le seuil, on abandonne.
// Connaître la valeur exacte d'une distance qui disqualifie déjà le candidat ne
// sert à rien, et ce calcul est refait des centaines de fois par question.
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prec = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cour = [i]
    let meilleur = i
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + cout)
      if (cour[j] < meilleur) meilleur = cour[j]
    }
    if (meilleur > max) return max + 1
    prec = cour
  }
  return prec[b.length]
}

// Indulgence proportionnelle à la longueur : une faute sur un mot court en fait
// souvent un AUTRE mot, alors qu'une faute sur « cérémonielle » reste sans ambiguïté.
function tolerance(mot: string): number {
  if (mot.length <= 4) return 0
  if (mot.length <= 7) return 1
  return 2
}

function scoreMot(mot: string, motsFiche: string[]): number {
  let meilleur = 0
  for (const m of motsFiche) {
    if (m === mot) return 1
    if (m.startsWith(mot) || mot.startsWith(m)) { meilleur = Math.max(meilleur, 0.85); continue }
    if (m.includes(mot)) { meilleur = Math.max(meilleur, 0.7); continue }
    const tol = tolerance(mot)
    if (tol > 0) {
      const d = distance(mot, m, tol)
      if (d <= tol) meilleur = Math.max(meilleur, 0.85 - 0.15 * d)
    }
  }
  return meilleur
}

// On EXIGE qu'au moins un mot colle vraiment, puis on classe à la SOMME.
//
// Pourquoi pas une moyenne : « peux-tu me décrire minutieusement le masque royal »
// contient trois mots utiles noyés dans du verbiage. Une moyenne ferait chuter la
// note à cause des mots sans rapport, et le guide ne trouverait plus rien dès que la
// question est polie. La somme, elle, récompense la fiche touchée par plusieurs mots.
const SEUIL_MOT = 0.6

function apparier<T>(mots: string[], fiches: T[], texte: (f: T) => string, limite: number): T[] {
  if (!mots.length || !fiches.length) return []
  const notes: Array<{ f: T; note: number }> = []
  for (const f of fiches) {
    const motsFiche = normaliser(texte(f)).split(' ').filter(Boolean)
    let somme = 0
    let meilleur = 0
    for (const mot of mots) {
      const s = scoreMot(mot, motsFiche)
      somme += s
      if (s > meilleur) meilleur = s
    }
    if (meilleur >= SEUIL_MOT) notes.push({ f, note: somme })
  }
  return notes.sort((a, b) => b.note - a.note).slice(0, limite).map((n) => n.f)
}

// Le visiteur demande à VOIR la collection, pas une œuvre précise :
// « montre-moi les objets de la Fondation », « quelles œuvres avez-vous ».
const QUOI = /\b(objets?|oeuvres?|pieces?|collections?|expositions?|masques?|statues?|trones?)\b/
const MONTRER = /\b(montre|montrez|montrer|voir|liste|lister|quel|quels|quelle|quelles|affiche|presente|presentez|tous|toutes|catalogue|avez)\b/

type Link = { label: string; to: string }

// Une vignette. DEUX ORIGINES POSSIBLES, et il ne faut pas les confondre :
//   • `interne: true` + `to`  → une œuvre DE LA MAISON. S'ouvre dans le site.
//   • `url`                   → une pièce d'un musée étranger. S'ouvre dans un onglet.
// Les présenter pareil ferait passer nos propres œuvres pour des pièces du Met.
type Card = {
  title: string; subtitle?: string; description?: string; image?: string
  url?: string; to?: string; source?: string; interne?: boolean
}
type Ground = { blocks: string[]; links: Link[]; cards: Card[]; fallback: string; hits: number; culture?: string }
type Scope = { museumId?: number; sectorId?: number }

// ---------------------------------------------------------------------------
// Récupération LOCALE — CLOISONNÉE PAR LOCATAIRE.
//
// ⚠️ LE POINT CRITIQUE. La RLS autorise la lecture du contenu publié de TOUT
// locataire approuvé : `tenant_is_public()` distingue « publié » de « non publié »,
// PAS « chez moi » de « chez le voisin ». Sans le filtre ci-dessous, le guide d'une
// chefferie répondrait avec les œuvres d'une autre — exactement ce qu'on ne veut pas.
// Le site public applique déjà ce filtre (`scoped()` dans publicApi.js) ; le guide
// était le seul chemin qui le contournait.
// ---------------------------------------------------------------------------
async function retrieve(supabase: ReturnType<typeof createClient>, q: string, scope: Scope = {}, tenantId: number | null = null): Promise<Ground> {
  const mots = keywords(q)
  const blocks: string[] = []
  const links: Link[] = []
  const cartes: Card[] = []
  let fallback = ''
  let scopedHits = 0

  // Un seul endroit où le cloisonnement s'applique : toute requête y passe.
  const cloisonner = (r: any) => (tenantId ? r.eq('tenant_id', tenantId) : r)

  if (scope.museumId) {
    const m = await cloisonner(supabase
      .from('museums').select('id,nom,type,annee_fondation,description,histoire')
      .eq('id', scope.museumId).eq('published', true)).maybeSingle()
    if (m.data) {
      const md: any = m.data
      const meta = [md.type, md.annee_fondation ? `fondé en ${md.annee_fondation}` : ''].filter(Boolean).join(', ')
      blocks.push(`MUSÉE COURANT — « ${md.nom} »${meta ? ` (${meta})` : ''}${md.description ? `\n${md.description}` : ''}${md.histoire ? `\nHistoire : ${md.histoire}` : ''}`)
      scopedHits++
    }
  }
  if (scope.sectorId) {
    const s = await cloisonner(supabase
      .from('sectors').select('id,nom,emplacement,description,histoire,museums(nom)')
      .eq('id', scope.sectorId).eq('published', true)).maybeSingle()
    if (s.data) {
      const sd: any = s.data
      blocks.push(`SALLE COURANTE — « ${sd.nom} »${sd.emplacement ? ` (${sd.emplacement})` : ''}${sd.description ? `\n${sd.description}` : ''}${sd.histoire ? `\nHistoire : ${sd.histoire}` : ''}`)
      scopedHits++
    }
  }

  // Catalogue publié du locataire, chargé une fois puis apparié en mémoire.
  const [rObj, rSec, rMus, rPers, rFaq] = await Promise.all([
    cloisonner(supabase.from('objects')
      .select('id,sector_id,nom,nom_commun,description,photo,texte_indexe,sectors(nom,museums(nom))')
      .eq('published', true)).limit(PLAFOND_CATALOGUE),
    cloisonner(supabase.from('sectors')
      .select('id,nom,emplacement,description,histoire,museums(id,nom)')
      .eq('published', true)).limit(PLAFOND_CATALOGUE),
    cloisonner(supabase.from('museums')
      .select('id,nom,type,description,histoire')
      .eq('published', true)).limit(PLAFOND_CATALOGUE),
    cloisonner(supabase.from('personnages')
      .select('id,nom,prenom,titre,biographie')
      .eq('published', true)).limit(PLAFOND_CATALOGUE),
    cloisonner(supabase.from('faq')
      .select('question,reponse')
      .eq('visible', true)).limit(PLAFOND_CATALOGUE)
  ])

  // ⚠️ ON JOURNALISE LES ERREURS DE REQUÊTE, on ne les avale pas.
  //
  // C'est ce qui a masqué une panne totale : le select portait sur `objects.culture`
  // et `objects.origine`, deux colonnes INEXISTANTES. PostgREST rejetait la requête
  // (42703), `data` valait null, et `|| []` transformait l'erreur en « aucun objet ».
  // Le guide répondait alors de culture générale sans jamais citer une œuvre de la
  // maison, et rien nulle part ne disait pourquoi. Un repli silencieux sur une
  // erreur de SCHÉMA est un bug qui peut vivre des mois.
  for (const [nom, r] of [['objects', rObj], ['sectors', rSec], ['museums', rMus], ['personnages', rPers], ['faq', rFaq]] as any[]) {
    if (r?.error) console.error(`[guide-agent] lecture ${nom} échouée :`, r.error.message)
  }

  const objets: any[] = rObj.data || []
  const salles: any[] = rSec.data || []
  const musees: any[] = rMus.data || []
  const gens: any[] = rPers.data || []
  const faqs: any[] = rFaq.data || []

  // Vignette d'une œuvre DE LA MAISON. `to` (route interne) et non `url` : elle
  // s'ouvre dans le site, pas dans un onglet externe comme une pièce du Met.
  // On prend `photo` et JAMAIS `photo_thumb` : cette dernière contient parfois
  // une image en base64, qu'on ne veut pas faire transiter dans la réponse.
  const carte = (o: any): Card => ({
    title: o.nom,
    subtitle: [o.nom_commun, o.sectors?.museums?.nom].filter(Boolean).join(' — '),
    description: String(o.description || '').slice(0, 220),
    image: o.photo || undefined,
    to: `/site/objets/${o.id}`,
    source: o.sectors?.museums?.nom || 'Notre collection',
    interne: true
  })

  // Œuvres de la salle courante : contexte immédiat du visiteur.
  if (scope.sectorId) {
    for (const o of objets.filter((o) => o.sector_id === scope.sectorId).slice(0, 8)) {
      blocks.push(`Œuvre de la salle — « ${o.nom} »${o.nom_commun ? ` (${o.nom_commun})` : ''}${o.description ? ` — ${o.description}` : ''}`)
    }
  }

  const nQ = normaliser(q)
  const veutVoir = QUOI.test(nQ) && MONTRER.test(nQ)

  if (!mots.length && !veutVoir) {
    return {
      blocks, links, cards: cartes, hits: scopedHits,
      fallback: scopedHits
        ? "Je vous écoute : posez-moi une question sur ce que vous voyez ici."
        : "Je peux localiser un objet, présenter un musée, raconter l'histoire d'un chef, ou retrouver des œuvres apparentées dans les grands musées du monde.",
    }
  }

  for (const f of apparier(mots, faqs, (x: any) => `${x.question} ${x.reponse}`, 2) as any[]) {
    blocks.push(`FAQ — ${f.question}\n${f.reponse}`)
    if (!fallback) fallback = f.reponse
  }

  // OBJETS — le cœur du guide. On envoie au modèle TOUT ce qu'on sait de l'œuvre
  // (notice, mots-clés, emplacement) : c'est ce qui lui permet de décrire
  // précisément au lieu de paraphraser un titre.
  let objetsRetenus = apparier(mots, objets, (o: any) =>
    `${o.nom} ${o.nom_commun || ''} ${o.texte_indexe || ''} ${o.description || ''}`, 4)

  // « Montrez-moi vos objets » : aucune œuvre précise n'est visée, on présente la
  // collection. Sans cela le guide répondait « précisez » à une demande claire.
  if (!objetsRetenus.length && veutVoir) objetsRetenus = objets.slice(0, 4)

  for (const o of objetsRetenus as any[]) {
    const lieu = o.sectors?.museums?.nom
      ? ` (au ${o.sectors.museums.nom}${o.sectors?.nom ? `, salle « ${o.sectors.nom} »` : ''})`
      : ''
    blocks.push([
      `ŒUVRE DE NOTRE COLLECTION — « ${o.nom} »${o.nom_commun ? ` (${o.nom_commun})` : ''}${lieu}`,
      o.description ? `Notice : ${o.description}` : '(aucune notice rédigée)',
      o.texte_indexe ? `Mots-clés de la fiche : ${String(o.texte_indexe).slice(0, 300)}` : ''
    ].filter(Boolean).join('\n'))
    links.push({ label: o.nom, to: `/site/objets/${o.id}` })
    cartes.push(carte(o))
  }
  if (objetsRetenus.length && !fallback) {
    const f: any = objetsRetenus[0]
    fallback = objetsRetenus.length > 1
      ? `Voici ${objetsRetenus.length} œuvres de notre collection :`
      : `« ${f.nom} »${f.description ? ' — ' + f.description : ''}`
  }

  for (const s of apparier(mots, salles, (x: any) => `${x.nom} ${x.emplacement || ''} ${x.description || ''}`, 2) as any[]) {
    blocks.push(`Salle « ${s.nom} »${s.emplacement ? ` (${s.emplacement})` : ''}${s.museums?.nom ? ` — musée : ${s.museums.nom}` : ''}${s.histoire ? `\nHistoire : ${s.histoire}` : ''}`)
    if (s.museums?.id) links.push({ label: `Voir ${s.museums.nom}`, to: `/site/musees/${s.museums.id}` })
    if (!fallback) fallback = `« ${s.nom} » se trouve au ${s.museums?.nom || 'musée'}.`
  }

  for (const p of apparier(mots, gens, (x: any) => `${x.prenom || ''} ${x.nom} ${x.titre || ''} ${x.biographie || ''}`, 2) as any[]) {
    const nom = p.prenom ? `${p.prenom} ${p.nom}` : p.nom
    blocks.push(`Personnage — ${p.titre ? p.titre + ' ' : ''}${nom}${p.biographie ? ` : ${p.biographie}` : ''}`)
    links.push({ label: nom, to: `/site/personnages/${p.id}` })
    if (!fallback) fallback = `${p.titre ? p.titre + ' ' : ''}${nom}${p.biographie ? ' — ' + p.biographie : ''}`
  }

  let museesRetenus = apparier(mots, musees, (x: any) => `${x.nom} ${x.type || ''} ${x.description || ''}`, 2)
  if (!museesRetenus.length && veutVoir && !objetsRetenus.length) museesRetenus = musees.slice(0, 2)
  for (const m of museesRetenus as any[]) {
    blocks.push(`Musée « ${m.nom} »${m.type ? ` (${m.type})` : ''}${m.description ? ` — ${m.description}` : ''}${m.histoire ? `\nHistoire : ${m.histoire}` : ''}`)
    links.push({ label: `Découvrir ${m.nom}`, to: `/site/musees/${m.id}` })
    if (!fallback) fallback = `${m.nom} : ${m.description || ''}`
  }

  if (!fallback) {
    fallback = "Je n'ai pas de notice précise là-dessus dans nos salles, mais je peux vous éclairer avec plaisir sur l'art et l'histoire des chefferies."
  }
  const vus = new Set<string>()
  const uniqLinks = links.filter((l) => (vus.has(l.to) ? false : (vus.add(l.to), true))).slice(0, 5)

  return {
    blocks, links: uniqLinks, cards: cartes, fallback,
    hits: blocks.length,
    culture: String((objetsRetenus[0] as any)?.nom || '') || mots.join(' ')
  }
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
// Le nom de l'institution est INJECTÉ, jamais codé en dur.
//
// Il l'était — « Fondation Jean Félicien Gacha » — héritage du temps où la
// plateforme n'hébergeait qu'une organisation. Sur le site d'une chefferie, le
// guide se présentait donc sous le nom d'une AUTRE institution : au mieux déroutant,
// au pire il donnait l'impression que les collections étaient mélangées.
function systemePour(institution: string): string {
  return `Tu es un guide de musée ÉRUDIT, chaleureux et vivant de ${institution}, qui numérise le patrimoine des chefferies camerounaises : œuvres (masques, sculptures, trônes, textiles…), histoire des royaumes Grassfields (Bamiléké, Bamoun, Tikar…) et généalogie des chefs (fon).

TON RÔLE : accueillir, instruire et donner envie. Tu réponds TOUJOURS de façon utile — jamais un « désolé, je n'ai pas d'information ». Si un fait précis manque, tu apportes la culture générale pertinente et tu proposes une piste.

SALUTATIONS : si le visiteur dit bonjour / merci / ça va, réponds avec chaleur, présente-toi en une phrase et propose 2-3 choses que tu peux faire (localiser une œuvre, raconter un royaume, retrouver des œuvres apparentées dans les musées du monde).

ANCRAGE (strict) : les FAITS PROPRES À CETTE COLLECTION — noms d'œuvres exposées, datations précises, provenances, liens de parenté, où c'est exposé — proviennent UNIQUEMENT du CONTEXTE LOCAL. N'invente jamais un tel fait s'il n'y est pas.
CULTURE GÉNÉRALE : tu PEUX enrichir librement avec des connaissances établies sur l'art et l'histoire des chefferies (techniques : fonte à la cire perdue, perlage, sculpture ; symbolisme : léopard, buffle, python, araignée). Cela n'a pas besoin d'être dans le contexte.

ŒUVRES DU MONDE : si des « ŒUVRES APPARENTÉES (MUSÉES DU MONDE) » sont fournies, présente-les avec enthousiasme comme des « cousines » de nos pièces (« au Metropolitan Museum de New York, on conserve… »), en expliquant CE QUI les relie (même culture, même technique, même usage). Ne prétends pas qu'elles sont chez nous.

DÉCRIRE UNE ŒUVRE : quand le contexte contient une « ŒUVRE DE NOTRE COLLECTION », décris-la POUR DE VRAI, dans cet ordre :
1. ce qu'on voit — forme, matière, décor, couleurs, taille si elle est donnée ;
2. à quoi elle servait, et qui la portait ou l'utilisait ;
3. ce qu'elle signifie — symbolique des motifs, rang de son propriétaire ;
4. où la voir exactement dans nos salles.
Phrases COURTES et mots SIMPLES : le visiteur n'est pas ethnologue. Explique un terme savant la première fois que tu l'emploies. N'invente aucun détail absent de la notice : si elle est brève, décris ce qu'elle donne et dis franchement que la notice est succincte. Ne te contente JAMAIS de reformuler le titre.

PLUSIEURS ŒUVRES : si le contexte en contient plusieurs, présente-les en une phrase chacune et invite à cliquer sur les vignettes affichées sous ta réponse. Ne dis pas que tu ne peux pas montrer d'images : elles sont déjà là.

STYLE : français, ton incarné et cultivé, 2 à 5 phrases — jusqu'à huit pour la description détaillée d'une œuvre. Pas de listes sauf nécessité. Reste dans ton périmètre (patrimoine, œuvres, chefferies, généalogie, visite). Ne dis jamais que tu es une IA, ne prononce pas le mot « contexte ». Ne cite JAMAIS une autre institution que ${institution}, sauf pour les œuvres du monde expressément fournies.`
}

// Nom à afficher. `tenants.nom` fait foi ; sans locataire on garde le libellé
// historique pour ne pas changer le site d'origine.
async function institutionDe(supabase: ReturnType<typeof createClient>, tenantId: number | null): Promise<string> {
  if (!tenantId) return 'la Fondation Jean Félicien Gacha'
  const { data } = await supabase.from('tenants').select('nom').eq('id', tenantId).maybeSingle()
  return (data as any)?.nom || 'notre institution'
}

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
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
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
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
  const ctrl = new AbortController()
  const res = await withTimeout(fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: ctrl.signal,
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 800,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }), 9000, ctrl)
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content?.trim()
  return text || null
}

// Repli déterministe CHALEUREUX (aucune clé LLM / échec des deux).
function fallbackChaleureux(q: string, g: Ground, cards: Card[], greeted: boolean, institution: string): string {
  if (greeted) {
    return `Bonjour et bienvenue ! Je suis le guide de ${institution}. Je peux localiser une œuvre, vous raconter l'histoire d'un royaume Grassfields, ou retrouver des pièces apparentées dans les grands musées du monde. Que souhaitez-vous découvrir ?`
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
    // Organisation affichée. Le site public la résout déjà par le nom d'hôte
    // (host.js) et la transmet ici. Absente → aucun cloisonnement, comportement
    // historique conservé pour le site mono-organisation d'origine.
    const tenantId = Number(body?.tenantId) || null

    if (!q) return json({ text: "Bonjour ! Posez-moi une question sur nos musées, nos œuvres, ou demandez-moi de retrouver des pièces apparentées dans les musées du monde.", links: [], cards: [], source: 'guard' })
    if (OUT.test(q)) {
      return json({
        // Garde-fou tiré AVANT toute requête : on ne connaît pas encore le nom de
        // l'institution, et l'aller-retour en base ne se justifie pas pour un refus.
        text: "Je suis le guide de ce musée : je réponds sur nos salles, nos œuvres et la généalogie des chefferies. En quoi puis-je vous éclairer sur le patrimoine ?",
        links: [], cards: [], source: 'guard',
      })
    }

    const greeted = GREET.test(q)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const [institution, g] = await Promise.all([
      institutionDe(supabase, tenantId),
      retrieve(supabase, q, scope, tenantId)
    ])

    // Recherche mondiale : à la demande explicite, ou quand le local est mince mais
    // que la question porte visiblement sur une œuvre/culture (et pas une salutation).
    const kwCount = keywords(q).length
    const wantWorld = !greeted && (WORLD.test(q) || (g.hits <= 1 && kwCount >= 1))
    // NOS œuvres d'abord : ce sont elles que le visiteur peut aller voir sur place.
    // Les pièces étrangères viennent ensuite, en élargissement.
    let cards: Card[] = [...g.cards]
    let mondiales: Card[] = []
    // Œuvres du monde fournies par le CLIENT (pattern déjà retenu dans ce projet :
    // `freres` note que les API de musées sont interrogées « côté client, qui sait
    // déjà le faire », et collectionsApi.js confirme le CORS navigateur). Mesuré
    // ici : le runtime Deno ne joint pas collectionapi.metmuseum.org, alors que le
    // navigateur l'atteint sans peine — on prend donc ce que le client a trouvé.
    if (Array.isArray(body?.cards) && body.cards.length) {
      mondiales = body.cards.slice(0, 3).map((c: any) => ({
        title: String(c?.title || 'Œuvre'),
        subtitle: c?.subtitle ? String(c.subtitle) : undefined,
        description: c?.description ? String(c.description) : undefined,
        image: c?.image ? String(c.image) : undefined,
        url: c?.url ? String(c.url) : undefined,
        source: c?.source ? String(c.source) : undefined,
      }))
    } else if (wantWorld) {
      // Tentative serveur (utile si l'egress s'ouvre un jour) : jamais bloquante.
      mondiales = await searchMonde(g.culture || '', q)
    }
    cards = cards.concat(mondiales).slice(0, 6)

    // On appelle le LLM dès qu'on a du contexte OU une salutation OU des œuvres du monde.
    const user = buildUserPrompt(q, g.blocks, mondiales)
    const systeme = systemePour(institution)
    let text: string | null = null
    let source = 'grounded'
    try { text = await callGemini(systeme, user); if (text) source = 'gemini' } catch (e) { console.error('[gemini]', String(e)) }
    if (!text) {
      try { text = await callGroq(systeme, user); if (text) source = 'groq' } catch (e) { console.error('[groq]', String(e)) }
    }
    if (!text) { text = fallbackChaleureux(q, g, mondiales, greeted, institution); source = 'grounded' }

    return json({ text, links: g.links, cards, source })
  } catch (e) {
    console.error('[guide-agent]', String(e))
    return json({ text: "Un petit contretemps technique — reformulez votre question, je reste à votre écoute.", links: [], cards: [], source: 'error' }, 200)
  }
})
