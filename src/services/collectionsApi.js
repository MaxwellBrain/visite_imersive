// ============================================================================
// MÉMOIRE RÉUNIFIÉE — Module 1 : retrouver les « objets frères » dispersés
// ----------------------------------------------------------------------------
// Interroge les collections ouvertes du monde pour retrouver les objets
// apparentés à une pièce locale (même culture, même origine, même usage).
//
// SOURCES — toutes vérifiées : sans clé et CORS autorisé depuis le navigateur.
//   • The Met (New York)              collectionapi.metmuseum.org
//   • Art Institute of Chicago        api.artic.edu
//   • Cleveland Museum of Art         openaccess-api.clevelandart.org
//   • Victoria & Albert (Londres)     api.vam.ac.uk
//   • Wikidata (SPARQL)               query.wikidata.org
//        ↳ voie d'accès aux musées européens sans API. ATTENTION à ne pas
//          surestimer sa portée : mesuré le 2026-08-06, Wikidata référence
//          1414 objets d'origine camerounaise mais ne nomme le musée détenteur
//          (P195) que pour SIX institutions. Utile, pas suffisant.
//   • museum-digital                  nat.museum-digital.de
//        ↳ C'EST LA SOURCE QUI DONNE L'AMPLEUR : 22 institutions distinctes
//          relevées sur seulement 672 objets « Kamerun » parcourus (corpus
//          annoncé : 2311). Le Cameroun ayant été colonie allemande de 1884 à
//          1916, c'est en Allemagne que dort l'essentiel du patrimoine sorti
//          des chefferies.
//
//   • Europeana                       via l'Edge Function `europeana`
//        ↳ LA PLUS LARGE : plusieurs milliers d'institutions européennes.
//          Seule source passant par le serveur, car elle exige une clé — qui
//          n'a rien à faire dans un bundle public. Sa facette DATA_PROVIDER
//          énumère les institutions détentrices en UNE requête : c'est la
//          mesure de couverture la plus directe du dispositif.
//          Sans le secret EUROPEANA_API_KEY, l'adaptateur se retire en silence.
//
// Sources écartées pour l'instant (clé gratuite requise) :
//   Smithsonian (API_KEY_MISSING), Harvard (Unauthorized), Rijksmuseum.
//
// NOTATION — étape 1 : appariement lexical et structuré (référence de base).
// Chaque critère est explicite et justifié auprès du conservateur : c'est la
// « baseline » indispensable avant d'évaluer une approche par plongements
// sémantiques (voir scoreSemantic, point d'extension prévu plus bas).
// ============================================================================

// Seule dépendance du module : Europeana exige une clé, donc un relais serveur.
// Toutes les autres sources sont interrogées directement par le navigateur.
import { supabase } from './supabase'

const MET = 'https://collectionapi.metmuseum.org/public/collection/v1'
const ARTIC = 'https://api.artic.edu/api/v1'
const CLEVELAND = 'https://openaccess-api.clevelandart.org/api'
const VAM = 'https://api.vam.ac.uk/v2'
const WD_API = 'https://www.wikidata.org/w/api.php'
const WD_SPARQL = 'https://query.wikidata.org/sparql'

// Mots vides ignorés lors de la comparaison des titres (fr + en).
const VIDES = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'pour', 'sur',
  'the', 'of', 'a', 'an', 'and', 'for', 'from', 'with', 'to', 'in'
])

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const mots = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !VIDES.has(w))

// Recouvrement de vocabulaire entre deux textes (indice de Jaccard asymétrique).
function recouvrement(a, b) {
  const A = new Set(mots(a))
  const B = new Set(mots(b))
  if (!A.size || !B.size) return 0
  let communs = 0
  for (const w of A) if (B.has(w)) communs++
  return communs / A.size
}

// Extrait une année représentative d'une date de musée (« ca. 1800–80 » → 1800).
function annee(texte) {
  const m = String(texte || '').match(/(\d{3,4})/)
  return m ? Number(m[1]) : null
}

// --------------------------------------------------------------------------
// Notation d'un candidat par rapport à l'objet local.
// Renvoie un score 0-100 et les raisons, pour que le conservateur puisse juger.
// --------------------------------------------------------------------------
export function scoreCandidat(local, cand) {
  let score = 0
  const raisons = []

  const cultureLocale = norm(local.culture)
  const cultureCand = norm([cand.culture, cand.region].filter(Boolean).join(' '))
  if (cultureLocale && cultureCand) {
    if (cultureCand.includes(cultureLocale) || cultureLocale.includes(cultureCand)) {
      score += 40
      raisons.push({ cle: 'culture', poids: 40, detail: cand.culture || cand.region })
    }
  }

  const paysLocal = norm(local.pays)
  if (paysLocal && norm(cand.origine).includes(paysLocal)) {
    score += 25
    raisons.push({ cle: 'pays', poids: 25, detail: cand.origine })
  }

  const recTitre = recouvrement(`${local.nom} ${local.nomCommun || ''}`, cand.title)
  if (recTitre > 0) {
    const p = Math.round(recTitre * 20)
    score += p
    if (p >= 4) raisons.push({ cle: 'titre', poids: p, detail: cand.title })
  }

  if (local.materiau) {
    const recMat = recouvrement(local.materiau, cand.medium)
    if (recMat > 0) {
      const p = Math.round(recMat * 10)
      score += p
      if (p >= 2) raisons.push({ cle: 'materiau', poids: p, detail: cand.medium })
    }
  }

  // Proximité chronologique : 10 points si moins d'un demi-siècle d'écart.
  const aLocal = annee(local.periode)
  const aCand = annee(cand.date)
  if (aLocal && aCand) {
    const ecart = Math.abs(aLocal - aCand)
    if (ecart <= 50) {
      const p = ecart <= 25 ? 10 : 5
      score += p
      raisons.push({ cle: 'periode', poids: p, detail: cand.date })
    }
  }

  if (cand.image) { score += 5; raisons.push({ cle: 'image', poids: 5 }) }

  return { score: Math.min(100, score), raisons }
}

// Point d'extension — étape 2 (contribution de recherche) :
// remplacer/compléter la note lexicale par une similarité de plongements
// (CLIP pour l'image, encodeur de phrases pour le texte). La signature reste
// identique, ce qui permet de comparer les deux approches sur le même jeu.
export async function scoreSemantic(/* local, cand */) {
  return null // non implémenté : voir PLAN_EVOLUTION.md
}

// --------------------------------------------------------------------------
// Forme commune renvoyée par tous les adaptateurs
//   { source, sourceLabel, externalId, title, culture, origine, paysMusee,
//     musee, inventaire, date, medium, image, url }
// --------------------------------------------------------------------------

const jget = async (url, opts) => {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

// ---- The Met (New York) --------------------------------------------------
// Coordonnées des musées à source fixe (Wikidata fournit les siennes).
const LIEUX = {
  met: { lat: 40.7794, lon: -73.9632 },
  artic: { lat: 41.8796, lon: -87.6237 },
  cleveland: { lat: 41.5085, lon: -81.6120 },
  vam: { lat: 51.4966, lon: -0.1722 }
}

// Coordonnées des pays d'origine — pour tracer le trajet depuis la terre natale.
export const PAYS_ORIGINE = {
  cameroon: { lat: 5.7, lon: 12.5, label: 'Cameroun' },
  cameroun: { lat: 5.7, lon: 12.5, label: 'Cameroun' },
  nigeria: { lat: 9.1, lon: 8.7, label: 'Nigeria' },
  benin: { lat: 9.3, lon: 2.3, label: 'Bénin' },
  ghana: { lat: 7.9, lon: -1.0, label: 'Ghana' },
  mali: { lat: 17.6, lon: -4.0, label: 'Mali' },
  congo: { lat: -4.0, lon: 21.8, label: 'Congo' },
  'democratic republic of the congo': { lat: -4.0, lon: 21.8, label: 'RD Congo' },
  gabon: { lat: -0.8, lon: 11.6, label: 'Gabon' },
  chad: { lat: 15.5, lon: 18.7, label: 'Tchad' },
  senegal: { lat: 14.5, lon: -14.5, label: 'Sénégal' },
  ivorycoast: { lat: 7.5, lon: -5.5, label: "Côte d'Ivoire" },
  "cote d'ivoire": { lat: 7.5, lon: -5.5, label: "Côte d'Ivoire" },
  burkinafaso: { lat: 12.2, lon: -1.6, label: 'Burkina Faso' },
  angola: { lat: -11.2, lon: 17.9, label: 'Angola' },
  ethiopia: { lat: 9.1, lon: 40.5, label: 'Éthiopie' },
  egypt: { lat: 26.8, lon: 30.8, label: 'Égypte' }
}

export function coordsPays(nomPays) {
  const k = norm(nomPays).replace(/\s+/g, '')
  return PAYS_ORIGINE[norm(nomPays)] || PAYS_ORIGINE[k] || null
}

const metAdapter = {
  cle: 'met',
  label: 'The Met — New York',
  paysMusee: 'États-Unis',
  async chercher(termes, limite) {
    const ids = new Set()
    for (const terme of termes) {
      if (ids.size >= limite) break
      const d = await jget(`${MET}/search?q=${encodeURIComponent(terme)}`)
      for (const id of d.objectIDs || []) {
        ids.add(id)
        if (ids.size >= limite) break
      }
    }
    const out = []
    const liste = [...ids]
    for (let i = 0; i < liste.length; i += 6) {
      const fiches = await Promise.all(
        liste.slice(i, i + 6).map((id) => jget(`${MET}/objects/${id}`).catch(() => null))
      )
      for (const d of fiches) {
        if (!d?.objectID) continue
        out.push({
          source: 'met', sourceLabel: this.label, paysMusee: this.paysMusee,
          musee: 'The Metropolitan Museum of Art',
          externalId: String(d.objectID),
          title: d.title || '',
          culture: d.culture || '',
          region: d.region || '',
          origine: d.country || d.region || '',
          inventaire: d.accessionNumber || '',
          date: d.objectDate || '',
          medium: d.medium || '',
          image: d.primaryImageSmall || d.primaryImage || '',
          url: d.objectURL || '',
          ...LIEUX.met
        })
      }
    }
    return out
  }
}

// ---- Art Institute of Chicago -------------------------------------------
const articAdapter = {
  cle: 'artic',
  label: 'Art Institute of Chicago',
  paysMusee: 'États-Unis',
  async chercher(termes, limite) {
    const champs = 'id,title,place_of_origin,medium_display,date_display,image_id,main_reference_number,artwork_type_title'
    const out = []
    const vus = new Set()
    for (const terme of termes) {
      if (out.length >= limite) break
      const d = await jget(
        `${ARTIC}/artworks/search?q=${encodeURIComponent(terme)}&limit=${Math.min(limite, 20)}&fields=${champs}`
      )
      for (const a of d.data || []) {
        if (vus.has(a.id) || out.length >= limite) continue
        vus.add(a.id)
        out.push({
          source: 'artic', sourceLabel: this.label, paysMusee: this.paysMusee,
          musee: 'Art Institute of Chicago',
          externalId: String(a.id),
          title: a.title || '',
          culture: a.place_of_origin || '',
          region: '',
          origine: a.place_of_origin || '',
          inventaire: a.main_reference_number || '',
          date: a.date_display || '',
          medium: a.medium_display || '',
          image: a.image_id ? `https://www.artic.edu/iiif/2/${a.image_id}/full/400,/0/default.jpg` : '',
          url: `https://www.artic.edu/artworks/${a.id}`,
          ...LIEUX.artic
        })
      }
    }
    return out
  }
}

// ---- Cleveland Museum of Art --------------------------------------------
const clevelandAdapter = {
  cle: 'cleveland',
  label: 'Cleveland Museum of Art',
  paysMusee: 'États-Unis',
  async chercher(termes, limite) {
    const out = []
    const vus = new Set()
    for (const terme of termes) {
      if (out.length >= limite) break
      const d = await jget(
        `${CLEVELAND}/artworks/?q=${encodeURIComponent(terme)}&limit=${Math.min(limite, 20)}`
      )
      for (const a of d.data || []) {
        if (vus.has(a.id) || out.length >= limite) continue
        vus.add(a.id)
        const cultureBrute = Array.isArray(a.culture) ? a.culture.join(', ') : (a.culture || '')
        out.push({
          source: 'cleveland', sourceLabel: this.label, paysMusee: this.paysMusee,
          musee: 'Cleveland Museum of Art',
          externalId: String(a.id),
          title: a.title || '',
          culture: cultureBrute,
          region: '',
          origine: cultureBrute,
          inventaire: a.accession_number || '',
          date: a.creation_date || '',
          medium: a.technique || a.medium || '',
          image: a.images?.web?.url || a.images?.print?.url || '',
          url: a.url || '',
          ...LIEUX.cleveland
        })
      }
    }
    return out
  }
}

// ---- Victoria & Albert (Londres) ----------------------------------------
const vamAdapter = {
  cle: 'vam',
  label: 'Victoria & Albert — Londres',
  paysMusee: 'Royaume-Uni',
  async chercher(termes, limite) {
    const out = []
    const vus = new Set()
    for (const terme of termes) {
      if (out.length >= limite) break
      const d = await jget(
        `${VAM}/objects/search?q=${encodeURIComponent(terme)}&page_size=${Math.min(limite, 20)}&images_exist=0`
      )
      for (const r of d.records || []) {
        const id = r.systemNumber
        if (!id || vus.has(id) || out.length >= limite) continue
        vus.add(id)
        const img = r._images?._primary_thumbnail || ''
        out.push({
          source: 'vam', sourceLabel: this.label, paysMusee: this.paysMusee,
          musee: 'Victoria and Albert Museum',
          externalId: String(id),
          title: r._primaryTitle || r.objectType || '',
          culture: r._primaryPlace || '',
          region: '',
          origine: r._primaryPlace || '',
          inventaire: r.accessionNumber || '',
          date: r._primaryDate || '',
          medium: r.objectType || '',
          image: img,
          url: `https://collections.vam.ac.uk/item/${id}/`,
          ...LIEUX.vam
        })
      }
    }
    return out
  }
}

// ---- Europeana : l'agrégateur le plus large -------------------------------
//
// Seule source à passer par le SERVEUR : Europeana exige une clé, et une clé
// n'a rien à faire dans un bundle lisible par tous. L'Edge Function `europeana`
// la détient et ne renvoie que des résultats normalisés.
//
// Sa facette DATA_PROVIDER énumère les institutions détentrices AVEC leur
// nombre d'objets, en une requête et sans parcourir le corpus : c'est la
// mesure de couverture la plus directe dont on dispose.
//
// Sans clé posée, la fonction répond { skipped: true } et l'adaptateur rend un
// tableau vide : les autres sources continuent, la recherche n'échoue pas.
let europeanaIndisponible = false   // évite de rappeler le serveur pour rien

const europeanaAdapter = {
  cle: 'europeana',
  label: 'Europeana — collections européennes',
  paysMusee: '',
  // Renseigné par le dernier appel : c'est la facette, pas un décompte des
  // objets ramenés. Sert à afficher l'ampleur réelle de la source.
  derniereCouverture: { institutions: [], total: 0 },
  async chercher(termes, limite, ctx = {}) {
    if (europeanaIndisponible) return []
    let data
    try {
      const r = await supabase.functions.invoke('europeana', {
        body: { termes, pays: ctx.pays || '', limite }
      })
      if (r.error) throw new Error(r.error.message)
      data = r.data
    } catch (e) {
      console.warn('[europeana] indisponible :', e.message)
      return []
    }
    if (data?.skipped) {
      // Pas de clé : inutile d'insister à chaque recherche de la session.
      europeanaIndisponible = true
      return []
    }
    if (!data?.ok) return []

    this.derniereCouverture = {
      institutions: data.institutions || [],
      total: data.total || 0
    }

    return (data.objets || []).map((o) => ({
      source: 'europeana',
      sourceLabel: o.musee || this.label,
      paysMusee: o.paysMusee || '',
      musee: o.musee || '',
      externalId: String(o.externalId || ''),
      title: o.title || '',
      culture: '',
      region: '',
      origine: ctx.pays || '',
      inventaire: o.inventaire || '',
      date: o.date || '',
      medium: o.medium || '',
      image: o.image || '',
      url: o.url || ''
    })).filter((o) => o.externalId)
  }
}

// ---- museum-digital : l'agrégateur qui apporte la DIVERSITÉ ---------------
//
// POURQUOI CETTE SOURCE EST DÉCISIVE (mesuré le 2026-08-06, pas supposé)
//
// L'objectif « couvrir au moins 40 institutions » est hors d'atteinte avec les
// sources précédentes : Wikidata ne connaît le musée détenteur (P195) que pour
// SIX institutions sur les 1414 objets camerounais qu'il référence, et le Met,
// l'Art Institute, Cleveland et le V&A ne sont qu'un musée chacun. Soit dix.
//
// museum-digital fédère des centaines de musées allemands : sur 672 objets
// « Kamerun » parcourus (le corpus en annonce 2311), on relève DÉJÀ 22
// institutions distinctes. Ce n'est pas un hasard historique : le Cameroun fut
// colonie allemande de 1884 à 1916, et c'est en Allemagne que se trouve
// l'essentiel du patrimoine des chefferies sorti du pays.
//
// DEUX CONTRAINTES MESURÉES, qui expliquent le code ci-dessous :
//  1. Le point d'accès ignore `limit` et rend 24 objets par page ; la
//     pagination se fait par `startwert`.
//  2. Il coupe (HTTP 503) dès qu'on l'interroge à 6 requêtes en parallèle.
//     On enchaîne donc les pages EN SÉRIE, avec une pause. C'est plus lent,
//     mais c'est le prix d'une source publique gratuite qu'on ne veut pas
//     maltraiter.
const MD = 'https://nat.museum-digital.de'
const MD_PAR_PAGE = 24
// La diversité vit dans la LONGUE TRAÎNE : les premières pages sont saturées par
// Berlin, les institutions rares n'apparaissent qu'en profondeur. 20 pages ≈ 480
// objets par terme, ce qui suffit à décrocher l'essentiel des petits musées.
const MD_PAGES_MAX = 20
const MD_PAUSE_MS = 160
// Le 503 se déclenche à 6 requêtes simultanées (mesuré) : on reste très en deçà.
const MD_PARALLELE = 2
// Un seul musée détient l'essentiel du corpus (Berlin : 572 objets sur 672).
// Sans plafond, il occuperait toute la place et la couverture resterait à 1.
const MD_MAX_PAR_INSTITUTION = 4

// Les catalogues allemands indexent en allemand : « Cameroon » n'y rend presque
// rien, « Kamerun » beaucoup. On ajoute donc l'exonyme quand on le connaît.
const EXONYMES_DE = {
  cameroon: 'Kamerun', cameroun: 'Kamerun', nigeria: 'Nigeria', congo: 'Kongo',
  'democratic republic of the congo': 'Kongo', ghana: 'Ghana', togo: 'Togo',
  benin: 'Benin', gabon: 'Gabun', chad: 'Tschad', tanzania: 'Tansania',
  namibia: 'Namibia', mali: 'Mali', senegal: 'Senegal'
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const museumDigitalAdapter = {
  cle: 'museumdigital',
  label: 'museum-digital — musées allemands',
  paysMusee: 'Allemagne',
  async chercher(termes, limite, ctx = {}) {
    const allemand = EXONYMES_DE[norm(ctx.pays || '')]
    // L'exonyme d'abord : c'est lui qui ramène le corpus colonial.
    const requetes = [...new Set([allemand, ...termes].filter(Boolean))].slice(0, 3)

    const unePage = async (terme, p) => {
      try {
        const lot = await jget(
          `${MD}/objects?s=${encodeURIComponent(terme)}&output=json&startwert=${p * MD_PAR_PAGE}`
        )
        return Array.isArray(lot) ? lot : []
      } catch {
        return [] // 503 ou coupure : on garde ce qu'on a plutôt que tout perdre
      }
    }

    const brut = []
    for (const terme of requetes) {
      let epuise = false
      for (let p = 0; p < MD_PAGES_MAX && !epuise; p += MD_PARALLELE) {
        const lots = await Promise.all(
          Array.from({ length: MD_PARALLELE }, (_, k) => p + k)
            .filter((n) => n < MD_PAGES_MAX)
            .map((n) => unePage(terme, n))
        )
        for (const lot of lots) {
          brut.push(...lot)
          // Page incomplète = fin du corpus pour ce terme, inutile d'insister.
          if (lot.length < MD_PAR_PAGE) epuise = true
        }
        if (!epuise) await pause(MD_PAUSE_MS)
      }
    }

    // Répartition : on prend au plus N objets par musée, en faisant plusieurs
    // tours. Un musée qui n'a qu'une pièce est ainsi représenté au même titre
    // qu'un musée qui en a 500 — c'est exactement ce qu'on cherche à montrer.
    const parInstitution = new Map()
    for (const o of brut) {
      if (!o?.objekt_id) continue
      const nom = o.institution_name || 'Institution inconnue'
      if (!parInstitution.has(nom)) parInstitution.set(nom, [])
      parInstitution.get(nom).push(o)
    }

    const retenus = []
    for (let tour = 0; tour < MD_MAX_PAR_INSTITUTION && retenus.length < limite; tour++) {
      for (const [, objets] of parInstitution) {
        if (retenus.length >= limite) break
        if (objets[tour]) retenus.push(objets[tour])
      }
    }

    return retenus.map((o) => ({
      source: 'museumdigital',
      sourceLabel: o.institution_name || this.label,
      paysMusee: this.paysMusee,
      musee: o.institution_name || '',
      externalId: String(o.objekt_id),
      title: o.objekt_name || '',
      culture: '',
      region: '',
      origine: ctx.pays || '',
      inventaire: o.objekt_inventarnr || '',
      date: '',
      medium: '',
      image: o.image ? `${MD}/${String(o.image).replace(/^\/+/, '')}` : '',
      url: `${MD}/object/${o.objekt_id}`
    }))
  }
}

// ---- Wikidata : les musées européens sans API ----------------------------
// Deux temps : on résout le pays d'origine en identifiant Wikidata (rapide),
// puis on liste les objets de ce pays conservés dans une collection.
async function wikidataPaysId(nomPays) {
  const d = await jget(
    `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(nomPays)}` +
    `&language=en&type=item&limit=1&format=json&origin=*`
  )
  return d.search?.[0]?.id || null
}

const wikidataAdapter = {
  cle: 'wikidata',
  label: 'Wikidata — musées d\'Europe',
  paysMusee: '',
  async chercher(termes, limite, ctx = {}) {
    const pays = ctx.pays || termes[1] || termes[0]
    if (!pays) return []
    const qid = await wikidataPaysId(pays)
    if (!qid) return []

    // P195 (« collection ») OU P276 (« lieu de conservation ») : beaucoup de
    // fiches n'emploient que la seconde. Mesuré sur le Cameroun (Q1009) le
    // 2026-08-06 : P195 seul → 6 institutions ; P195 ∪ P276 → 13. On double la
    // couverture pour le coût d'une UNION, sans rien relâcher sur la rigueur —
    // les deux propriétés désignent bien un détenteur.
    const sparql = `SELECT DISTINCT ?item ?itemLabel ?collLabel ?paysLabel ?coord ?inv ?img ?date WHERE {
      ?item wdt:P495 wd:${qid} .
      { ?item wdt:P195 ?coll } UNION { ?item wdt:P276 ?coll }
      OPTIONAL { ?item wdt:P217 ?inv }
      OPTIONAL { ?item wdt:P18 ?img }
      OPTIONAL { ?item wdt:P571 ?date }
      OPTIONAL { ?coll wdt:P17 ?pays }
      OPTIONAL { ?coll wdt:P625 ?coord }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT ${Math.max(60, Math.min(limite * 3, 200))}`

    const d = await jget(
      `${WD_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { Accept: 'application/sparql-results+json' } }
    )
    const v = (b, k) => b[k]?.value || ''
    // Wikidata renvoie « Point(longitude latitude) »
    const geo = (b) => {
      const m = v(b, 'coord').match(/Point\(([-\d.]+)\s+([-\d.]+)\)/)
      return m ? { lon: Number(m[1]), lat: Number(m[2]) } : {}
    }
    return (d.results?.bindings || []).map((b) => ({
      source: 'wikidata',
      sourceLabel: v(b, 'collLabel') || this.label,
      paysMusee: v(b, 'paysLabel'),
      musee: v(b, 'collLabel'),
      externalId: v(b, 'item').split('/').pop(),
      title: v(b, 'itemLabel'),
      culture: '',
      region: '',
      origine: pays,
      inventaire: v(b, 'inv'),
      date: v(b, 'date').slice(0, 10),
      medium: '',
      image: v(b, 'img'),
      url: v(b, 'item'),
      ...geo(b)
    }))
  }
}

export const SOURCES = [
  metAdapter, articAdapter, clevelandAdapter, vamAdapter,
  wikidataAdapter, museumDigitalAdapter, europeanaAdapter
]

// Couverture rapportée par Europeana lors de la dernière recherche : nombre
// d'institutions détentrices connues de l'agrégateur, lu sur sa facette.
// À distinguer des musées effectivement rapatriés dans les candidats.
export function couvertureEuropeana() {
  return europeanaAdapter.derniereCouverture
}
export const SOURCES_INFO = SOURCES.map((s) => ({ cle: s.cle, label: s.label }))

// --------------------------------------------------------------------------
// Recherche principale — toutes les sources sont interrogées EN PARALLÈLE.
//   local : { nom, nomCommun, culture, pays, materiau, periode }
//   opts  : { limite, scoreMin, sources: ['met', …], onProgress }
// --------------------------------------------------------------------------
export async function chercherFreres(local, opts = {}) {
  const { limite = 24, scoreMin = 25, sources = null, onProgress, termes: imposes = null } = opts

  // Les termes enrichis par `memory-search` (traduits et complétés du
  // vocabulaire de catalogage) priment sur la saisie brute : c'est tout l'objet
  // de la Phase 5. Sans eux, on retombe sur culture + pays + nom.
  const termes = (imposes && imposes.length ? imposes : [local.culture, local.pays, local.nom])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
  if (!termes.length) return { candidats: [], termes, sources: [], erreurs: [] }

  const actives = SOURCES.filter((s) => !sources || sources.includes(s.cle))
  let finies = 0
  const erreurs = []

  const resultats = await Promise.allSettled(
    actives.map(async (s) => {
      try {
        const r = await s.chercher(termes, limite, { pays: local.pays })
        return r
      } finally {
        finies++
        onProgress?.(finies, actives.length)
      }
    })
  )

  const fiches = []
  resultats.forEach((r, i) => {
    if (r.status === 'fulfilled') fiches.push(...r.value)
    else erreurs.push({ source: actives[i].cle, message: String(r.reason?.message || r.reason) })
  })

  // Dédoublonnage : une même œuvre peut remonter deux fois d'une même source.
  const vus = new Set()
  const candidats = fiches
    .filter((c) => {
      const k = `${c.source}:${c.externalId}`
      if (vus.has(k)) return false
      vus.add(k)
      return true
    })
    .map((c) => ({ ...c, ...scoreCandidat(local, c) }))
    .filter((c) => c.score >= scoreMin)
    .sort((a, b) => b.score - a.score)

  return { candidats, termes, sources: actives.map((s) => s.cle), erreurs }
}

// ============================================================================
// MÉMOIRE RÉUNIFIÉE — Module 2 : traces documentaires hors musées
// ----------------------------------------------------------------------------
// Un objet ne laisse pas de trace que dans les vitrines. Il en laisse dans les
// encyclopédies, les catalogues de vente, les publications. Ces résultats sont
// tenus SÉPARÉS des « frères » : ce sont des références bibliographiques, pas
// des objets. Les mêler fausserait la notation, le globe et le décompte.
//
// Sources sans clé, CORS vérifié :
//   • Wikipédia (fr + en)  — article encyclopédique
//   • Open Library         — ouvrages imprimés (« telle bibliothèque »)
//
// ⚠️ Jamais de moissonnage direct de Google : bloqué, fragile et juridiquement
// douteux. Pour aller plus loin, brancher Brave Search ou Tavily (clé gratuite)
// derrière la même interface — voir `braveAdapter` en fin de fichier.
// ============================================================================

// Les extraits de Wikipédia contiennent du balisage de surlignage : on le
// retire au lieu de l'injecter tel quel dans la page.
const sansBalises = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

function wikipediaAdapter(langue) {
  return {
    cle: `wikipedia-${langue}`,
    label: langue === 'fr' ? 'Wikipédia (français)' : 'Wikipedia (English)',
    type: 'article',
    async chercher(q, limite = 4) {
      if (!q) return []
      const d = await jget(
        `https://${langue}.wikipedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(q)}&srlimit=${limite}&format=json&origin=*`
      )
      return (d.query?.search || []).map((r) => ({
        source: this.cle,
        sourceLabel: this.label,
        type: 'article',
        titre: r.title,
        extrait: sansBalises(r.snippet),
        url: `https://${langue}.wikipedia.org/?curid=${r.pageid}`,
        auteur: '',
        annee: null
      }))
    }
  }
}

const openLibraryAdapter = {
  cle: 'openlibrary',
  label: 'Open Library — ouvrages',
  type: 'ouvrage',
  async chercher(q, limite = 4) {
    if (!q) return []
    const d = await jget(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
      `&limit=${limite}&fields=title,author_name,first_publish_year,key`
    )
    return (d.docs || []).map((b) => ({
      source: this.cle,
      sourceLabel: this.label,
      type: 'ouvrage',
      titre: b.title || '',
      extrait: '',
      url: b.key ? `https://openlibrary.org${b.key}` : '',
      auteur: (b.author_name || []).slice(0, 2).join(', '),
      annee: b.first_publish_year || null
    }))
  }
}

// Point d'accroche pour une recherche web généraliste. Volontairement non
// activé : il réclame une clé, donc une Edge Function pour la garder côté
// serveur. La forme de retour est déjà celle attendue par l'interface.
export const braveAdapter = {
  cle: 'brave',
  label: 'Brave Search',
  type: 'web',
  actif: false,
  async chercher() { return [] }
}

export const SOURCES_DOC = [wikipediaAdapter('fr'), wikipediaAdapter('en'), openLibraryAdapter]
export const SOURCES_DOC_INFO = SOURCES_DOC.map((s) => ({ cle: s.cle, label: s.label, type: s.type }))

// Recherche documentaire — mêmes garanties que la recherche d'objets : toutes
// les sources en parallèle, et l'échec de l'une n'empêche pas les autres.
//
// Les termes sont essayés UN PAR UN, du plus précis au plus large, et l'on
// s'arrête dès qu'une source a de quoi répondre. Les joindre en une seule
// requête produit une phrase trop spécifique : « Bamileke beadwork Cameroon »
// ne renvoie rien alors que « Bamileke » ramène un ouvrage de 1953.
export async function chercherReferences(termes, opts = {}) {
  const { limite = 4, sources = null } = opts
  const utiles = (termes || []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 4)
  if (!utiles.length) return { references: [], erreurs: [] }

  const actives = SOURCES_DOC.filter((s) => !sources || sources.includes(s.cle))
  const erreurs = []

  const interroger = async (s) => {
    for (const terme of utiles) {
      try {
        const r = await s.chercher(terme, limite)
        if (r.length) return r
      } catch (e) {
        erreurs.push({ source: s.cle, message: String(e?.message || e) })
        return []
      }
    }
    return []
  }

  const resultats = await Promise.all(actives.map(interroger))
  return { references: resultats.flat(), erreurs }
}

// --------------------------------------------------------------------------
// Points du globe : un marqueur par musée détenteur, plus le pays d'origine.
// C'est ce qui matérialise le trajet des objets hors de leur terre natale.
// --------------------------------------------------------------------------
export function pointsGlobe(candidats, nomPaysOrigine) {
  const parMusee = new Map()
  for (const c of candidats) {
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue
    const cle = c.musee || c.sourceLabel
    if (!parMusee.has(cle)) {
      parMusee.set(cle, {
        musee: cle, pays: c.paysMusee || '', lat: c.lat, lon: c.lon,
        total: 0, sources: new Set(), exemples: []
      })
    }
    const e = parMusee.get(cle)
    e.total++
    e.sources.add(c.source)
    if (e.exemples.length < 3 && c.title) e.exemples.push(c.title)
  }
  const lieux = [...parMusee.values()]
    .map((e) => ({ ...e, sources: [...e.sources] }))
    .sort((a, b) => b.total - a.total)

  return { origine: coordsPays(nomPaysOrigine), lieux }
}

// Répartition par pays détenteur — matière première de la carte de dispersion.
export function repartitionParPays(candidats) {
  const carte = new Map()
  for (const c of candidats) {
    const p = c.paysMusee || 'Inconnu'
    if (!carte.has(p)) carte.set(p, { pays: p, total: 0, musees: new Set() })
    const e = carte.get(p)
    e.total++
    if (c.musee) e.musees.add(c.musee)
  }
  return [...carte.values()]
    .map((e) => ({ pays: e.pays, total: e.total, musees: [...e.musees] }))
    .sort((a, b) => b.total - a.total)
}
