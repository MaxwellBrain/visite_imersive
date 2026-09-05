// ============================================================================
// USDZ → GLB, DANS LE NAVIGATEUR.
// ----------------------------------------------------------------------------
// POURQUOI CE MODULE EXISTE
//
// Un iPhone (Object Capture, Polycam, Scaniverse) rend du .usdz. Aucun
// navigateur ne sait l'afficher : Quick Look est une application système
// d'Apple, pas une capacité du web. Un objet scanné à l'iPhone reste donc
// invisible partout ailleurs que sur un iPhone — et le champ « Modèle 3D » de
// l'ERP refusait le fichier sans autre issue que de convertir à la main.
//
// `scripts/usdz-vers-glb.py` faisait déjà ce travail, mais hors de l'ERP : il
// suppose Python, `usd-core`, et un poste de développeur. Un conservateur qui
// dépose un scan n'a rien de tout cela. Ce module porte le MÊME algorithme en
// JavaScript pour que la conversion ait lieu là où le fichier arrive.
//
// POURQUOI PAS LE SCRIPT PYTHON LUI-MÊME
//   L'ERP est une application statique (S3 + CloudFront) et les fonctions de
//   bord Supabase tournent sous Deno. Ni l'un ni l'autre n'exécute Python, et
//   `usd-core` est une extension C++ de 300 Mo. Faire tourner le script
//   supposerait un service conteneurisé de plus, à déployer et à payer, pour
//   une opération qui tient dans la page.
//
// CE QUI REND LE PORTAGE POSSIBLE
//   Un .usdz est une archive ZIP dont la spécification INTERDIT la compression
//   et impose l'alignement : les fichiers s'y lisent par simple découpe. Et les
//   scanners iPhone y écrivent du `.usda`, la forme TEXTE d'USD. Il n'y a donc
//   ni à décompresser, ni à décoder un format binaire — d'où un lecteur sans
//   la moindre dépendance, ce qui compte ici puisque npm est hors service sur
//   le poste (MUSEA_MASTER_PLAN §6).
//
// CE QU'IL NE FAIT PAS
//   Pas d'animation, pas de scène à plusieurs objets, pas de matériau
//   procédural. Un scan photogrammétrique n'en a pas : c'est un maillage unique
//   texturé, et c'est exactement ce cas qui est traité. Le `.usdc` (USD
//   binaire), que produisent certains autres outils, est détecté et refusé
//   explicitement plutôt que lu de travers.
// ============================================================================

import { buildGlb } from './glb'

// Codes d'erreur levés par ce module. Ils sont traduits par l'appelant : un
// message d'erreur en dur ici serait invisible au commutateur de langue.
export const ERREURS = {
  PAS_UN_ZIP: 'usdz_pas_une_archive',
  USDC_BINAIRE: 'usdz_binaire_usdc',
  PAS_DE_USD: 'usdz_sans_fichier_usd',
  PAS_DE_MAILLAGE: 'usdz_sans_maillage',
  PAS_DE_POINTS: 'usdz_sans_points'
}

// ---------------------------------------------------------------------------
// 1. LECTURE DE L'ARCHIVE
// ---------------------------------------------------------------------------
//
// On lit le catalogue de fin d'archive (« central directory ») plutôt que de
// parcourir les en-têtes locaux : c'est le seul endroit qui donne des tailles
// fiables. Un en-tête local peut annoncer zéro et renvoyer à un descripteur
// placé APRÈS les données — auquel cas on ne saurait pas où s'arrêter.

const SIG_FIN = 0x06054b50 // fin du catalogue
const SIG_ENTREE = 0x02014b50 // entrée du catalogue
const SIG_LOCAL = 0x04034b50 // en-tête local, juste avant les octets du fichier

function lireArchive(buffer) {
  const vue = new DataView(buffer)
  const octets = new Uint8Array(buffer)

  // Le catalogue se termine par un enregistrement de 22 octets, suivi d'un
  // commentaire facultatif de 64 Ko au plus : on remonte donc depuis la fin.
  let fin = -1
  const plancher = Math.max(0, buffer.byteLength - 22 - 0xffff)
  for (let i = buffer.byteLength - 22; i >= plancher; i--) {
    if (vue.getUint32(i, true) === SIG_FIN) { fin = i; break }
  }
  if (fin === -1) throw new Error(ERREURS.PAS_UN_ZIP)

  const nombre = vue.getUint16(fin + 10, true)
  let p = vue.getUint32(fin + 16, true)

  const entrees = []
  for (let n = 0; n < nombre; n++) {
    if (vue.getUint32(p, true) !== SIG_ENTREE) break
    const methode = vue.getUint16(p + 10, true)
    const tailleCompressee = vue.getUint32(p + 20, true)
    const tailleReelle = vue.getUint32(p + 24, true)
    const lgNom = vue.getUint16(p + 28, true)
    const lgExtra = vue.getUint16(p + 30, true)
    const lgCommentaire = vue.getUint16(p + 32, true)
    const offsetLocal = vue.getUint32(p + 42, true)
    // Les noms USDZ sont en ASCII, mais UTF-8 les couvre et gère les rares
    // archives réencodées par un outil tiers.
    const nom = new TextDecoder('utf-8').decode(octets.subarray(p + 46, p + 46 + lgNom))
    entrees.push({ nom, methode, tailleCompressee, tailleReelle, offsetLocal })
    p += 46 + lgNom + lgExtra + lgCommentaire
  }
  return { entrees, vue, octets }
}

async function extraire(archive, entree) {
  const { vue, octets } = archive
  const o = entree.offsetLocal
  if (vue.getUint32(o, true) !== SIG_LOCAL) throw new Error(ERREURS.PAS_UN_ZIP)
  // La longueur des champs « nom » et « extra » DOIT se relire ici : le
  // catalogue et l'en-tête local n'ont pas forcément le même bourrage, et
  // l'alignement 64 octets d'USDZ se fait justement dans le champ « extra ».
  const lgNom = vue.getUint16(o + 26, true)
  const lgExtra = vue.getUint16(o + 28, true)
  const debut = o + 30 + lgNom + lgExtra
  const brut = octets.subarray(debut, debut + entree.tailleCompressee)

  if (entree.methode === 0) return brut // cas normal : USDZ interdit la compression

  // Repli pour une archive réécrite par un outil qui a ignoré la spécification.
  // `deflate-raw` est natif depuis Chrome 103 / Safari 16.4 : pas de dépendance.
  if (entree.methode === 8 && typeof DecompressionStream === 'function') {
    const flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(flux).arrayBuffer())
  }
  throw new Error(ERREURS.PAS_UN_ZIP)
}

// ---------------------------------------------------------------------------
// 2. LECTURE DU .usda
// ---------------------------------------------------------------------------

// Extrait tous les nombres d'un intervalle, dans l'ordre. Les vecteurs USD
// s'écrivent « (x, y, z) » : les parenthèses et les virgules ne portent aucune
// information une fois la taille du vecteur connue, on les ignore donc et on
// regroupe par 2 ou par 3 à la sortie.
//
// Balayage caractère par caractère plutôt qu'expression régulière : le tableau
// des points d'un scan pèse 2 Mo de texte, et une regex globale y construirait
// des dizaines de milliers d'objets de correspondance pour rien.
function nombres(texte, debut, fin) {
  const out = []
  let i = debut
  while (i < fin) {
    const c = texte.charCodeAt(i)
    const chiffre = c >= 48 && c <= 57
    if (chiffre || c === 45 /* - */ || c === 43 /* + */ || c === 46 /* . */) {
      let j = i + 1
      while (j < fin) {
        const d = texte.charCodeAt(j)
        if ((d >= 48 && d <= 57) || d === 46 || d === 101 /* e */ || d === 69 /* E */) { j++; continue }
        // Un signe n'appartient au nombre que s'il suit l'exposant : « 1e-05 ».
        const prec = texte.charCodeAt(j - 1)
        if ((d === 45 || d === 43) && (prec === 101 || prec === 69)) { j++; continue }
        break
      }
      const v = parseFloat(texte.slice(i, j))
      // Un « - » isolé (rare, mais un fichier tronqué en produit) donnerait NaN
      // et contaminerait toute la géométrie : on le laisse tomber.
      if (!Number.isNaN(v)) out.push(v)
      i = j
    } else i++
  }
  return out
}

// Localise « <type>[] <nom> = [ … ] » et renvoie l'intervalle du contenu.
// L'ancrage se fait sur la déclaration ENTIÈRE : chercher le seul nom
// trouverait aussi le `[]` du type, placé juste avant lui.
function tableau(texte, motif) {
  const m = motif.exec(texte)
  if (!m) return null
  const debut = m.index + m[0].length
  const fin = texte.indexOf(']', debut)
  if (fin === -1) return null
  return { debut, fin, apres: texte.slice(fin + 1, fin + 260) }
}

// Bloc `def Mesh "…" { … }` : on compte les accolades en sautant les chaînes,
// car un nom de prim peut en contenir.
function premierMaillage(texte) {
  const m = /def\s+Mesh\s+"[^"]*"[^{]*\{/.exec(texte)
  if (!m) return null
  let profondeur = 1
  let i = m.index + m[0].length
  const debut = i
  while (i < texte.length && profondeur > 0) {
    const c = texte[i]
    if (c === '"') { i = texte.indexOf('"', i + 1); if (i === -1) break; i++; continue }
    if (c === '{') profondeur++
    else if (c === '}') profondeur--
    i++
  }
  return { texte: texte.slice(debut, i - 1), nombreMaillages: (texte.match(/def\s+Mesh\s+"/g) || []).length }
}

function lireUsda(source) {
  const maillage = premierMaillage(source)
  if (!maillage) throw new Error(ERREURS.PAS_DE_MAILLAGE)
  const t = maillage.texte
  const avertissements = []
  if (maillage.nombreMaillages > 1) {
    avertissements.push({ code: 'plusieurs_maillages', n: maillage.nombreMaillages })
  }

  // -- points --------------------------------------------------------------
  const spanPoints = tableau(t, /(?:point3f|float3|double3)\[\]\s+points\s*=\s*\[/)
  if (!spanPoints) throw new Error(ERREURS.PAS_DE_POINTS)
  const plats = nombres(t, spanPoints.debut, spanPoints.fin)
  const nbPoints = Math.floor(plats.length / 3)
  if (!nbPoints) throw new Error(ERREURS.PAS_DE_POINTS)
  const points = new Float32Array(plats.slice(0, nbPoints * 3))

  // -- faces ---------------------------------------------------------------
  const spanIdx = tableau(t, /int\[\]\s+faceVertexIndices\s*=\s*\[/)
  const spanCnt = tableau(t, /int\[\]\s+faceVertexCounts\s*=\s*\[/)
  const idx = spanIdx ? nombres(t, spanIdx.debut, spanIdx.fin) : []
  const counts = spanCnt ? nombres(t, spanCnt.debut, spanCnt.fin) : []

  // Triangulation en éventail : un polygone à n côtés donne n-2 triangles.
  // Les scans sont déjà triangulés, mais un maillage retouché ailleurs peut
  // contenir des quads — les ignorer produirait des trous dans la surface.
  const tris = []
  let curseur = 0
  for (const c of counts) {
    if (c >= 3) {
      const a = idx[curseur]
      for (let k = 1; k < c - 1; k++) tris.push(a, idx[curseur + k], idx[curseur + k + 1])
    }
    curseur += c
  }
  if (!tris.length) throw new Error(ERREURS.PAS_DE_MAILLAGE)

  // -- coordonnées de texture ----------------------------------------------
  //
  // Seule l'interpolation « vertex » est suivie : elle correspond 1:1 aux
  // points, c'est ce que produisent les scanners. Une UV « faceVarying »
  // demanderait de dédoubler des sommets — hors du cas traité ici, et une
  // texture posée de travers vaut moins qu'une couleur unie assumée.
  let uvs = null
  const spanUv = tableau(t, /(?:texCoord2f|float2)\[\]\s+primvars:st\d?\s*=\s*\[/)
  if (spanUv) {
    const interpolation = /interpolation\s*=\s*"([a-zA-Z]+)"/.exec(spanUv.apres)?.[1] || null
    const brut = nombres(t, spanUv.debut, spanUv.fin)
    const compte = Math.floor(brut.length / 2)
    if (interpolation === 'vertex' || (!interpolation && compte === nbPoints)) {
      if (compte === nbPoints) uvs = brut
      else avertissements.push({ code: 'uv_taille', n: compte })
    } else {
      avertissements.push({ code: 'uv_interpolation', valeur: interpolation })
    }
  }

  // -- normales ------------------------------------------------------------
  let normales = null
  const spanN = tableau(t, /(?:normal3f|float3)\[\]\s+(?:primvars:)?normals\s*=\s*\[/)
  if (spanN) {
    const brut = nombres(t, spanN.debut, spanN.fin)
    if (Math.floor(brut.length / 3) === nbPoints) normales = new Float32Array(brut.slice(0, nbPoints * 3))
  }

  // -- textures ------------------------------------------------------------
  //
  // Le rôle se lit dans le NOM du fichier, comme dans le script Python. USD
  // permettrait de suivre les connexions du shader jusqu'à l'entrée exacte,
  // mais tous les scanners nomment leurs cartes de la même façon, et remonter
  // le graphe entier pour retrouver une information déjà écrite dans le nom
  // serait payer cher une robustesse qu'on n'obtiendrait même pas.
  const chemins = {}
  const re = /asset\s+inputs:file\s*=\s*@([^@]+)@/g
  let m
  while ((m = re.exec(source))) {
    const rel = m[1].replace(/^\.\//, '')
    const bas = rel.toLowerCase()
    const role =
      bas.includes('color') || bas.includes('diffuse') || bas.includes('albedo') ? 'color'
        : bas.includes('normal') ? 'normal'
          : bas.includes('occlusion') || bas.includes('_ao') ? 'occlusion'
            : null
    if (role && !chemins[role]) chemins[role] = rel
  }

  // metersPerUnit : glTF s'exprime EN MÈTRES, sans exception. Un scan déclaré
  // en centimètres arriverait cent fois trop grand — l'objet remplirait la
  // pièce en réalité augmentée. Le cas est rare (les scanners iPhone écrivent
  // 1), mais il ne coûte qu'une multiplication.
  const mpu = parseFloat(/metersPerUnit\s*=\s*([0-9.eE+-]+)/.exec(source)?.[1] || '1')
  const echelle = Number.isFinite(mpu) && mpu > 0 ? mpu : 1
  if (echelle !== 1) {
    for (let i = 0; i < points.length; i++) points[i] *= echelle
    avertissements.push({ code: 'echelle', valeur: echelle })
  }

  return { points, tris, uvs, normales, chemins, avertissements }
}

// ---------------------------------------------------------------------------
// 3. NORMALES
// ---------------------------------------------------------------------------
//
// Accumulation du produit vectoriel NON normalisé de chaque triangle : sa
// longueur est proportionnelle à l'aire, si bien qu'une grande facette pèse
// davantage qu'une petite. Normaliser avant d'accumuler donnerait le même poids
// à un triangle minuscule qu'à un grand, et bosselerait la surface.
function normalesLissees(points, tris) {
  const n = points.length / 3
  const acc = new Float32Array(points.length)
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3
    const b = tris[i + 1] * 3
    const c = tris[i + 2] * 3
    const ux = points[b] - points[a]
    const uy = points[b + 1] - points[a + 1]
    const uz = points[b + 2] - points[a + 2]
    const vx = points[c] - points[a]
    const vy = points[c + 1] - points[a + 1]
    const vz = points[c + 2] - points[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const k of [a, b, c]) {
      acc[k] += nx
      acc[k + 1] += ny
      acc[k + 2] += nz
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const L = Math.hypot(acc[o], acc[o + 1], acc[o + 2])
    if (L > 1e-12) { acc[o] /= L; acc[o + 1] /= L; acc[o + 2] /= L }
    // Un sommet isolé ou dégénéré donnerait une longueur nulle. glTF refuse un
    // vecteur nul : on lui met une normale arbitraire, mais VALIDE.
    else { acc[o] = 0; acc[o + 1] = 1; acc[o + 2] = 0 }
  }
  return acc
}

// ---------------------------------------------------------------------------
// 4. ÉCRITURE DU GLB
// ---------------------------------------------------------------------------

function typeImage(octets) {
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'image/jpeg'
  if (octets[0] === 0x89 && octets[1] === 0x50 && octets[2] === 0x4e && octets[3] === 0x47) return 'image/png'
  return null // format inconnu : mieux vaut un modèle sans texture qu'un GLB illisible
}

function assembler({ points, tris, uvs, normales, images }) {
  const blocs = []
  let offset = 0
  const vues = []
  const accesseurs = []

  const ajouterVue = (octets, cible) => {
    // Chaque vue doit démarrer sur un multiple de 4 : les accesseurs de
    // flottants et d'entiers 32 bits sont lus par mots alignés.
    const bourrage = (4 - (offset % 4)) % 4
    if (bourrage) { blocs.push(new Uint8Array(bourrage)); offset += bourrage }
    const debut = offset
    blocs.push(octets)
    offset += octets.byteLength
    const v = { buffer: 0, byteOffset: debut, byteLength: octets.byteLength }
    if (cible) v.target = cible
    vues.push(v)
    return vues.length - 1
  }

  const brut = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)

  // POSITION — glTF EXIGE min/max sur cet accesseur : le moteur s'en sert pour
  // cadrer la caméra et tester la visibilité. Sans eux, model-viewer refuse le
  // fichier sans dire pourquoi.
  const mins = [Infinity, Infinity, Infinity]
  const maxs = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = points[i + k]
      if (v < mins[k]) mins[k] = v
      if (v > maxs[k]) maxs[k] = v
    }
  }
  accesseurs.push({
    bufferView: ajouterVue(brut(points), 34962),
    componentType: 5126,
    count: points.length / 3,
    type: 'VEC3',
    min: mins,
    max: maxs
  })

  const nrm = normales || normalesLissees(points, tris)
  accesseurs.push({
    bufferView: ajouterVue(brut(nrm), 34962), componentType: 5126, count: nrm.length / 3, type: 'VEC3'
  })

  const attributs = { POSITION: 0, NORMAL: 1 }
  if (uvs) {
    // USD place l'origine des UV en bas à gauche, glTF en haut à gauche. Sans
    // cette inversion la texture apparaît retournée verticalement — défaut
    // discret sur une surface unie, flagrant sur un décor peint.
    const uvb = new Float32Array(uvs.length)
    for (let i = 0; i < uvs.length; i += 2) {
      uvb[i] = uvs[i]
      uvb[i + 1] = 1 - uvs[i + 1]
    }
    accesseurs.push({
      bufferView: ajouterVue(brut(uvb), 34962), componentType: 5126, count: uvb.length / 2, type: 'VEC2'
    })
    attributs.TEXCOORD_0 = 2
  }

  const accIndices = accesseurs.length
  accesseurs.push({
    bufferView: ajouterVue(brut(new Uint32Array(tris)), 34963),
    componentType: 5125,
    count: tris.length,
    type: 'SCALAR'
  })

  const gltfImages = []
  const textures = []
  const parRole = {}
  for (const role of ['color', 'normal', 'occlusion']) {
    const octets = images[role]
    if (!octets) continue
    const mime = typeImage(octets)
    if (!mime) continue
    gltfImages.push({ bufferView: ajouterVue(octets), mimeType: mime })
    textures.push({ source: gltfImages.length - 1, sampler: 0 })
    parRole[role] = textures.length - 1
  }

  const pbr = { metallicFactor: 0, roughnessFactor: 1 }
  if (parRole.color != null) pbr.baseColorTexture = { index: parRole.color }
  else pbr.baseColorFactor = [0.8, 0.8, 0.8, 1]

  const materiau = { pbrMetallicRoughness: pbr, doubleSided: true }
  if (parRole.normal != null) materiau.normalTexture = { index: parRole.normal }
  if (parRole.occlusion != null) materiau.occlusionTexture = { index: parRole.occlusion }

  const gltf = {
    asset: { version: '2.0', generator: 'MUSEA usdz-vers-glb (navigateur)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'scan' }],
    meshes: [{ primitives: [{ attributes: attributs, indices: accIndices, material: 0 }] }],
    materials: [materiau],
    accessors: accesseurs,
    bufferViews: vues,
    buffers: [{ byteLength: offset }]
  }
  if (textures.length) {
    gltf.images = gltfImages
    gltf.textures = textures
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
  }

  const bin = new Uint8Array(offset)
  let p = 0
  for (const b of blocs) { bin.set(b, p); p += b.byteLength }
  return buildGlb(gltf, bin.buffer)
}

// ---------------------------------------------------------------------------
// 5. POINT D'ENTRÉE
// ---------------------------------------------------------------------------

/**
 * Convertit un .usdz en .glb, entièrement dans le navigateur.
 *
 * @param {File|Blob} fichier      l'archive .usdz
 * @param {object}    [options]
 * @param {(etape:string)=>void} [options.onEtape] progression, pour l'interface
 * @returns {Promise<{ fichier: File, stats: object }>}
 */
export async function convertirUsdzEnGlb(fichier, { onEtape = () => {} } = {}) {
  onEtape('lecture')
  const archive = lireArchive(await fichier.arrayBuffer())

  const entreeUsd = archive.entrees.find((e) => /\.usda?$/i.test(e.nom))
  if (!entreeUsd) {
    // Un .usdc est de l'USD BINAIRE (« crate ») : un autre format, qu'il
    // faudrait décoder entièrement. On le nomme au lieu de laisser l'utilisateur
    // devant un échec sans cause — le script Python, lui, sait le lire.
    const binaire = archive.entrees.some((e) => /\.usdc$/i.test(e.nom))
    throw new Error(binaire ? ERREURS.USDC_BINAIRE : ERREURS.PAS_DE_USD)
  }

  const octetsUsd = await extraire(archive, entreeUsd)
  // Certains outils rangent un .usdc sous une extension .usd : la signature
  // tranche, l'extension ment.
  if (octetsUsd[0] === 0x50 && octetsUsd[1] === 0x58 && octetsUsd[2] === 0x52) {
    throw new Error(ERREURS.USDC_BINAIRE)
  }

  onEtape('analyse')
  const source = new TextDecoder('utf-8').decode(octetsUsd)
  const { points, tris, uvs, normales, chemins, avertissements } = lireUsda(source)

  onEtape('textures')
  const images = {}
  const parNom = new Map(archive.entrees.map((e) => [e.nom.toLowerCase(), e]))
  for (const [role, rel] of Object.entries(chemins)) {
    const cle = rel.toLowerCase()
    const feuille = cle.split('/').pop()
    const entree = parNom.get(cle) || archive.entrees.find((e) => e.nom.toLowerCase().endsWith(feuille))
    if (entree) images[role] = await extraire(archive, entree)
    else avertissements.push({ code: 'texture_absente', valeur: rel })
  }

  onEtape('assemblage')
  const glb = assembler({ points, tris, uvs, normales, images })

  const nom = (fichier.name || 'modele.usdz').replace(/\.usdz$/i, '') + '.glb'
  return {
    fichier: new File([glb], nom, { type: 'model/gltf-binary' }),
    stats: {
      sommets: points.length / 3,
      triangles: tris.length / 3,
      uv: !!uvs,
      normalesCalculees: !normales,
      textures: Object.keys(images),
      octets: glb.byteLength,
      avertissements
    }
  }
}

// Reconnaît une archive USDZ par sa SIGNATURE, pas par son nom : une extension
// se change d'un clic, et le champ « Modèle 3D » de l'ERP se fie déjà au
// contenu réel pour la même raison.
export async function estUsdz(fichier) {
  const tete = new Uint8Array(await fichier.slice(0, 2).arrayBuffer())
  return tete[0] === 0x50 && tete[1] === 0x4b // « PK »
}
