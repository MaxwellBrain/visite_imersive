// ============================================================================
// RAPPROCHEMENT — reconnaître deux écritures d'une même chose.
// ----------------------------------------------------------------------------
// LE PROBLÈME, DANS NOS DONNÉES. L'import refuse une œuvre quand le couple
// « musée › salle » ne correspond à rien de connu. Or un inventaire de musée
// n'écrit jamais deux fois pareil :
//
//     « Trésor royal »   « TRESOR ROYAL »   « Trésor Royal (salle 2) »
//     « Salle des masques »   « Masques, salle des »   « Salle des masque »
//
// Notre normalisation d'origine — minuscules, accents retirés, espaces réduits
// — attrape les deux premières. Elle échoue sur la ponctuation, sur l'ordre des
// mots, et sur la faute de frappe. Chaque échec rejette une ligne que le musée
// devra ressaisir à la main.
//
// LES DEUX FAMILLES, celles d'OpenRefine, et pourquoi on les enchaîne.
//
//   1. COLLISION DE CLÉ. On calcule une CLÉ qui ne garde que l'essentiel, et
//      deux valeurs qui produisent la même clé désignent la même chose. C'est
//      instantané — un simple index — et sans faux positif tant que la clé
//      reste conservatrice. C'est l'empreinte, et sa variante par n-grammes.
//
//   2. PLUS PROCHE VOISIN. On mesure une DISTANCE entre chaînes et on
//      rapproche celles qui sont assez près. Ça attrape ce que la clé rate —
//      la faute de frappe, la lettre en trop — mais c'est quadratique, et ça
//      invente des rapprochements si le rayon est trop large. D'où le
//      « blocage » : on ne compare que des chaînes partageant déjà un fragment.
//
// L'ORDRE EST LE SUJET. On essaie du plus sûr au plus permissif, et on s'arrête
// au premier succès. Un rapprochement obtenu par égalité stricte ne se discute
// pas ; un rapprochement obtenu par distance doit être signalé à l'écran, parce
// qu'il peut être faux. La méthode employée est donc rendue avec le résultat —
// c'est elle qui décide si le conservateur doit regarder.
//
// CE QU'ON NE FAIT PAS : fusionner d'autorité. Ce module PROPOSE. Deux salles
// réellement distinctes peuvent porter des noms voisins, et les confondre
// enverrait des œuvres dans la mauvaise pièce.
// ============================================================================

// -------------------------------------------------------------- clés ------

/** Minuscules, sans accents, espaces réduits. Le socle commun. */
export function base(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * EMPREINTE (fingerprint) — l'algorithme d'OpenRefine, dans l'ordre :
 * espaces rognés, minuscules, ponctuation et caractères de contrôle retirés,
 * caractères occidentaux ramenés à l'ASCII, découpage en mots, tri, dédoublonnage,
 * recollage.
 *
 * Le TRI est ce qui distingue l'empreinte d'une simple normalisation : il rend
 * « Salle des masques » et « Masques, salle des » identiques. C'est la méthode
 * la moins susceptible de produire un faux rapprochement — d'où sa place en
 * premier.
 */
export function empreinte(s) {
  const t = base(s).replace(/[^\p{L}\p{N}\s]/gu, ' ')
  const mots = [...new Set(t.split(/\s+/).filter(Boolean))].sort()
  return mots.join(' ')
}

/**
 * EMPREINTE PAR N-GRAMMES — même esprit, mais on découpe en fragments de `n`
 * caractères au lieu de mots, puis on trie et dédoublonne.
 *
 * Elle attrape ce que l'empreinte simple rate : l'espace manquant. « Trésorroyal »
 * et « Trésor royal » ne partagent aucun mot, mais presque tous leurs bigrammes.
 * En contrepartie elle rapproche plus large : elle vient donc APRÈS.
 */
export function empreinteNgram(s, n = 2) {
  const t = base(s).replace(/[^\p{L}\p{N}]/gu, '')
  if (t.length < n) return t
  const grammes = new Set()
  for (let i = 0; i <= t.length - n; i++) grammes.add(t.slice(i, i + n))
  return [...grammes].sort().join('')
}

// ---------------------------------------------------------- distance -----

/**
 * Distance de Levenshtein — le nombre de modifications (insertion, suppression,
 * substitution) séparant deux chaînes.
 *
 * `plafond` permet d'abandonner dès qu'on dépasse le seuil : on ne cherche pas
 * la distance exacte entre deux chaînes sans rapport, seulement à savoir si
 * elles sont proches. Sur un inventaire de deux mille lignes, cet abandon
 * précoce fait la différence entre une seconde et une minute.
 */
export function distance(a, b, plafond = Infinity) {
  const s = base(a)
  const t = base(b)
  if (s === t) return 0
  if (Math.abs(s.length - t.length) > plafond) return plafond + 1
  if (!s.length) return t.length
  if (!t.length) return s.length

  let prec = Array.from({ length: t.length + 1 }, (_, i) => i)
  let cour = new Array(t.length + 1)

  for (let i = 1; i <= s.length; i++) {
    cour[0] = i
    let minLigne = cour[0]
    for (let j = 1; j <= t.length; j++) {
      const cout = s[i - 1] === t[j - 1] ? 0 : 1
      cour[j] = Math.min(cour[j - 1] + 1, prec[j] + 1, prec[j - 1] + cout)
      if (cour[j] < minLigne) minLigne = cour[j]
    }
    // Toute la ligne dépasse déjà le plafond : la distance finale aussi.
    if (minLigne > plafond) return plafond + 1
    ;[prec, cour] = [cour, prec]
  }
  return prec[t.length]
}

// ------------------------------------------------------- rapprochement ---

// Longueur du fragment de blocage. Six caractères, comme OpenRefine : deux
// chaînes vraiment proches partagent presque toujours un tel fragment, et cela
// écarte l'immense majorité des comparaisons inutiles.
const BLOC = 6

function blocsDe(s) {
  const t = base(s).replace(/\s/g, '')
  if (t.length <= BLOC) return [t]
  const out = []
  for (let i = 0; i <= t.length - BLOC; i++) out.push(t.slice(i, i + BLOC))
  return out
}

/**
 * Prépare un index sur les valeurs connues. À construire UNE FOIS pour tout un
 * import : le refaire à chaque ligne rendrait le rapprochement quadratique.
 *
 * @param {Array<{cle: *, valeur: string}>} entrees ce à quoi on veut rapprocher
 */
export function indexRapprochement(entrees) {
  const exact = new Map()
  const parEmpreinte = new Map()
  const parNgram = new Map()
  const parBloc = new Map()

  const ajouter = (map, k, e) => {
    if (!k) return
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(e)
  }

  for (const e of entrees) {
    ajouter(exact, base(e.valeur), e)
    ajouter(parEmpreinte, empreinte(e.valeur), e)
    ajouter(parNgram, empreinteNgram(e.valeur), e)
    for (const b of blocsDe(e.valeur)) ajouter(parBloc, b, e)
  }
  return { entrees, exact, parEmpreinte, parNgram, parBloc }
}

/**
 * Rapproche une valeur des entrées connues, du plus sûr au plus permissif.
 *
 * @returns {{entree, methode, distance}|null} `methode` ∈ exact | empreinte |
 *   ngramme | distance. `null` si rien ne correspond — et c'est une réponse
 *   valable : mieux vaut refuser que ranger une œuvre dans la mauvaise salle.
 */
export function rapprocher(valeur, index, { rayon = 2, sansParentheses = false } = {}) {
  const v = String(valeur ?? '').trim()
  if (!v) return null

  // 1. égalité stricte, à la casse et aux accents près
  const e1 = index.exact.get(base(v))
  if (e1?.length === 1) return { entree: e1[0], methode: 'exact', distance: 0 }

  // 2. empreinte — ordre des mots et ponctuation indifférents
  const e2 = index.parEmpreinte.get(empreinte(v))
  if (e2?.length === 1) return { entree: e2[0], methode: 'empreinte', distance: 0 }

  // 3. n-grammes — espaces manquants, mots collés
  const e3 = index.parNgram.get(empreinteNgram(v))
  if (e3?.length === 1) return { entree: e3[0], methode: 'ngramme', distance: 0 }

  // 4. distance, sur les seuls candidats partageant un fragment (blocage)
  const candidats = new Set()
  for (const b of blocsDe(v)) for (const e of index.parBloc.get(b) || []) candidats.add(e)
  if (!candidats.size) return null

  let meilleur = null
  for (const e of candidats) {
    const d = distance(v, e.valeur, rayon)
    if (d <= rayon && (!meilleur || d < meilleur.distance)) meilleur = { entree: e, methode: 'distance', distance: d }
  }
  // Une ambiguïté ne se tranche pas au hasard : deux candidats à égale distance,
  // on renonce et on laisse le conservateur décider.
  if (meilleur) {
    const exaequo = [...candidats].filter((e) => e !== meilleur.entree && distance(v, e.valeur, rayon) === meilleur.distance)
    if (exaequo.length) return null
  }
  if (meilleur) return meilleur

  // 5. LA PARENTHÈSE, dernière chance.
  //
  // Un inventaire annote : « Trésor royal (salle 2) », « Cour royale [en
  // extérieur] », « Galerie des masques - vitrine 4 ». Le commentaire fait
  // échouer les quatre passes précédentes — il ajoute des mots à l'empreinte et
  // gonfle la distance — alors que le nom, lui, est là et entier.
  //
  // On retire donc ce qui est entre parenthèses ou crochets, et ce qui suit un
  // tiret isolé, puis on rejoue. Une seule fois : `sansParentheses` empêche la
  // récursion de tourner.
  if (!sansParentheses) {
    const nu = v.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s[-–—]\s.*$/, '').trim()
    if (nu && nu !== v) {
      const r = rapprocher(nu, index, { rayon, sansParentheses: true })
      // La méthode rendue dit « annotation » : ce rapprochement a demandé
      // d'ignorer une partie du texte, le conservateur doit pouvoir le voir.
      if (r) return { ...r, methode: 'annotation', ignore: v.slice(nu.length).trim() || v.replace(nu, '').trim() }
    }
  }
  return null
}

/**
 * REGROUPE des valeurs qui désignent probablement la même chose — le « cluster »
 * d'OpenRefine. Sert à repérer les doublons DANS un fichier, avant import.
 *
 * On ne fusionne rien : on rend les groupes, et l'écran les montre.
 */
export function regrouper(valeurs, { methode = 'empreinte' } = {}) {
  const clef = methode === 'ngramme' ? (v) => empreinteNgram(v) : (v) => empreinte(v)
  const paquets = new Map()
  for (const v of valeurs) {
    const k = clef(v)
    if (!k) continue
    if (!paquets.has(k)) paquets.set(k, [])
    paquets.get(k).push(v)
  }
  // Un groupe n'est intéressant que s'il contient des écritures DIFFÉRENTES :
  // deux fois exactement le même texte n'apprend rien sur l'orthographe.
  return [...paquets.values()]
    .map((g) => [...new Set(g)])
    .filter((g) => g.length > 1)
}
