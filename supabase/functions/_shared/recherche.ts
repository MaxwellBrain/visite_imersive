// LA RECHERCHE ANCRÉE — l'outil que les deux voies partagent.
//
// LE PÉRIMÈTRE NE TIENT PAS À UNE CONSIGNE, MAIS À LA RÉÉCRITURE. Le modèle
// propose un sujet ; le serveur y accroche les termes de la pièce avant
// d'envoyer quoi que ce soit. « Comment fond-on le laiton » part en « comment
// fond-on le laiton Bandjoun Cameroun ». Le modèle ne rédige jamais la requête
// finale, et c'est tout l'intérêt : une consigne de prompt se contourne, une
// requête réécrite par le serveur, non.
//
// POURQUOI WIKIPÉDIA SEULEMENT, et pas les catalogues de musées que ce projet
// interroge ailleurs. Mesuré dans ce dépôt (note de `guide-agent` sur le Met) :
// le runtime Deno ne joint pas tous les hôtes que le navigateur atteint. Les
// API de collections sont donc appelées CÔTÉ CLIENT dans MUSÉA, jamais depuis
// une Edge Function. Wikipédia, elle, répond — mesuré le 2026-08-29.

import type { Ancrage } from './dossier.ts'
import { termesAncrage } from './dossier.ts'

/**
 * LE GARDE-FOU DE SUJET — le cercle 3, mais du côté de la machine.
 *
 * Le prompt interdit déjà à la pièce de sortir de son monde. Cette liste existe
 * parce qu'une consigne de prompt cède sous l'insistance, et qu'un visiteur qui
 * s'amuse finit toujours par essayer. Elle ne prétend pas être exhaustive :
 * elle attrape les intentions qui n'ont AUCUN rapport avec un musée, celles
 * pour lesquelles il n'existe aucune lecture charitable.
 *
 * Elle ne bloque pas la conversation — seulement la RECHERCHE. L'objet reste
 * libre de répondre « ça, je ne le sais pas » ; il ne peut simplement pas aller
 * le chercher.
 */
const HORS_SUJET = new RegExp([
  'météo|meteo|weather|température|temperature',
  'bourse|action|crypto|bitcoin|cours de l|prix du|acheter|vendre',
  'actualité|actualite|news|élection|election|président|guerre en',
  'code|javascript|python|programm|serveur|bug|api ',
  'recette|cuisine|restaurant|hôtel|hotel|vol pour|train pour',
  'symptôme|symptome|maladie|médicament|medicament|docteur|santé|sante',
  'football|match|score|championnat',
].join('|'), 'i')

/** Le schéma d'outil, au format OpenAI — utilisé tel quel par la voie texte. */
export const OUTIL_CHERCHER = {
  type: 'function',
  function: {
    name: 'chercher',
    description:
      "Chercher un fait précis sur TON MONDE — une technique, un matériau, un usage, " +
      "une culture, une institution qui conserve une pièce apparentée. " +
      "N'appelle cet outil QUE pour ce qui touche à ton monde ou au patrimoine ; " +
      "jamais pour ce qui te concerne toi (ta fiche fait foi), jamais pour un sujet " +
      "étranger au musée. Ne l'appelle pas si tu sais déjà répondre.",
    parameters: {
      type: 'object',
      properties: {
        sujet: {
          type: 'string',
          description:
            "Le sujet à vérifier, en trois à huit mots. N'y mets pas ton propre nom " +
            "d'inventaire : les termes de ta culture et de ta région sont ajoutés " +
            "automatiquement.",
        },
      },
      required: ['sujet'],
    },
  },
}

export type Reference = { titre: string; extrait: string; url: string; source: string }

const DELAI_MS = 4000

async function jget(url: string): Promise<any> {
  const ctrl = new AbortController()
  // UNE RECHERCHE QUI TRAÎNE EST PIRE QU'UNE RECHERCHE QUI ÉCHOUE : le visiteur
  // attend devant une pièce, en silence. Quatre secondes, puis on abandonne et
  // l'objet répond avec ce qu'il a.
  const t = setTimeout(() => ctrl.abort(), DELAI_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MUSEA/1.0 (patrimoine)' } })
    if (!r.ok) throw new Error(`http ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

const sansBalises = (s: string) => String(s || '').replace(/<[^>]*>/g, '').trim()

async function wikipedia(langue: string, requete: string, limite: number): Promise<Reference[]> {
  const d = await jget(
    `https://${langue}.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(requete)}&srlimit=${limite}&format=json&origin=*`
  )
  return (d?.query?.search || []).map((r: any) => ({
    titre: String(r.title || ''),
    // On COUPE COURT : ce texte revient dans le prompt d'un agent qui doit
    // répondre en trois phrases. Un extrait long produit une récitation.
    extrait: sansBalises(r.snippet).slice(0, 280),
    url: `https://${langue}.wikipedia.org/?curid=${r.pageid}`,
    source: langue === 'fr' ? 'Wikipédia' : 'Wikipedia',
  }))
}

/**
 * CHERCHER, dans le monde de la pièce et nulle part ailleurs.
 *
 * Renvoie toujours un objet lisible par le modèle — jamais une exception. Une
 * panne de réseau, un egress fermé, un sujet hors périmètre : dans tous les cas
 * la pièce reçoit de quoi dire honnêtement qu'elle n'a rien trouvé.
 */
export async function chercher(
  sujetBrut: string,
  ancrage: Ancrage,
  langue: string
): Promise<{ requete: string; hors_sujet?: boolean; references: Reference[]; note?: string }> {
  const sujet = String(sujetBrut || '').trim().slice(0, 120)
  if (!sujet) {
    return { requete: '', references: [], note: "Aucun sujet fourni." }
  }

  if (HORS_SUJET.test(sujet)) {
    return {
      requete: sujet,
      hors_sujet: true,
      references: [],
      note: "Ce sujet est hors de ton monde. Ne cherche pas : dis au visiteur que ta " +
            "mémoire s'arrête au seuil de la cour, et ramène-le à toi.",
    }
  }

  // LA REQUÊTE RÉELLE. Le sujet du modèle, plus l'ancrage — dans cet ordre,
  // parce que les moteurs pèsent les premiers mots davantage.
  //
  // MESURÉ LE 2026-08-29 : « perlage sur toile technique Bandjoun Cameroun » ne
  // ramène RIEN, là où « ndop indigo Bandjoun Cameroun » ramène trois articles.
  // Trois termes d'ancrage sur un sujet déjà précis, et la requête se referme
  // sur le vide. On essaie donc du plus serré au plus large — mais on garde
  // TOUJOURS au moins un terme : c'est lui le verrou, et une requête nue
  // rendrait à la pièce un moteur de recherche généraliste.
  const termes = termesAncrage(ancrage)
  const essais = termes.length > 1
    ? [[sujet, ...termes].join(' '), [sujet, termes[termes.length - 1]].join(' ')]
    : [[sujet, ...termes].join(' ')]
  const requete = essais[0]

  // La langue du visiteur d'abord, l'anglais ensuite : sur les arts des
  // Grassfields, la Wikipédia anglophone est souvent la mieux fournie, et une
  // recherche française qui ne donne rien n'est pas une absence de source.
  const langues = langue === 'en' ? ['en', 'fr'] : ['fr', 'en']
  const refs: Reference[] = []
  let panne = ''

  let requeteAboutie = essais[0]
  for (const essai of essais) {
    for (const l of langues) {
      if (refs.length >= 3) break
      try {
        refs.push(...(await wikipedia(l, essai, 3 - refs.length)))
      } catch (e) {
        panne = String((e as any)?.message || e)
      }
    }
    if (refs.length) { requeteAboutie = essai; break }
  }

  if (!refs.length) {
    return {
      requete,
      references: [],
      note: panne
        ? "La recherche n'a pas abouti. Réponds avec ce que tu sais déjà, et dis que tu n'as pas pu vérifier."
        : "Rien trouvé sur ce sujet. Dis-le simplement et tiens-t'en à ce que tu sais.",
    }
  }

  return {
    // On rend la requête qui a ABOUTI, pas celle qu'on avait tentée d'abord :
    // c'est elle que le journal doit montrer quand on se demande d'où sort une
    // réponse.
    requete: requeteAboutie,
    references: refs.slice(0, 3),
    // MESURÉ LE 2026-08-29 : sans ces deux rappels, une réponse nourrie par une
    // recherche part en récitation de dix lignes et cite « (source : Wikipédia,
    // article X) » — deux fautes contre la règle 4, que le modèle oublie dès
    // qu'on lui met un texte de référence sous les yeux. On les redit ICI,
    // au plus près du texte fautif, plutôt que d'espérer que le prompt tienne.
    note: "Ces éléments viennent d'une encyclopédie, PAS de ta fiche : n'en tire aucun " +
          "fait sur toi-même. NOMME LA SOURCE DANS TA PHRASE — « les encyclopédies " +
          "disent que… » — jamais entre parenthèses, tu parles à voix haute. Et " +
          "réponds en DEUX À QUATRE PHRASES malgré ce que tu viens de lire.",
  }
}
