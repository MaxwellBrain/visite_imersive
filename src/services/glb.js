// Fabrique de fichiers .glb EN MÉMOIRE — zéro dépendance.
//
// Pourquoi : npm est hors service sur ce poste (MUSEA_MASTER_PLAN §6), donc pas
// de bibliothèque de géométrie. Et surtout, tant que le musée n'a pas numérisé
// ses pièces, aucun objet n'a de modèle 3D : la réalité augmentée serait
// indémontrable. On génère donc un objet de démonstration à la volée.
//
// Un .glb n'a rien de mystérieux : un en-tête de 12 octets, un bloc JSON qui
// décrit la scène, un bloc binaire qui contient les sommets. On écrit les trois.

const MAGIC = 0x46546c67 // « glTF »
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

const pad4 = (n) => (n + 3) & ~3

// ---------------------------------------------------------------------------
// Assemblage du conteneur
// ---------------------------------------------------------------------------
// Exporté : `usdz.js` réutilise ce conteneur pour les scans iPhone convertis.
// Un second assembleur GLB, ailleurs, finirait par diverger de celui-ci sur un
// détail (le bourrage du bloc JSON se fait avec des ESPACES, pas des zéros) —
// et un octet faux ici rend le fichier illisible sans le moindre message.
export function buildGlb(gltf, bin) {
  const jsonText = JSON.stringify(gltf)
  const jsonBytes = new TextEncoder().encode(jsonText)
  const jsonLen = pad4(jsonBytes.length)
  const binLen = pad4(bin.byteLength)
  const total = 12 + 8 + jsonLen + 8 + binLen

  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  view.setUint32(0, MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)

  view.setUint32(12, jsonLen, true)
  view.setUint32(16, JSON_CHUNK, true)
  bytes.set(jsonBytes, 20)
  // Le bourrage du bloc JSON se fait avec des espaces, celui du binaire avec des zéros.
  for (let i = jsonBytes.length; i < jsonLen; i++) bytes[20 + i] = 0x20

  const binStart = 20 + jsonLen
  view.setUint32(binStart, binLen, true)
  view.setUint32(binStart + 4, BIN_CHUNK, true)
  bytes.set(new Uint8Array(bin), binStart + 8)

  return buf
}

// ---------------------------------------------------------------------------
// Géométrie de révolution : un profil (rayon, hauteur) tourné autour de l'axe Y.
// C'est exactement le geste du tourneur sur bois — d'où des formes qui « lisent »
// tout de suite comme des pièces sculptées.
// ---------------------------------------------------------------------------
function lathe(profile, segments = 48) {
  const positions = []
  const normals = []
  const indices = []

  // Normale de chaque point du profil : perpendiculaire à la tangente, vers
  // l'extérieur. Sur un point anguleux, on moyenne les deux segments voisins.
  const pn = profile.map((_, i) => {
    let nx = 0
    let ny = 0
    for (const [a, b] of [[i - 1, i], [i, i + 1]]) {
      if (a < 0 || b >= profile.length) continue
      const dr = profile[b][0] - profile[a][0]
      const dy = profile[b][1] - profile[a][1]
      const len = Math.hypot(dr, dy) || 1
      nx += dy / len
      ny += -dr / len
    }
    const len = Math.hypot(nx, ny) || 1
    return [nx / len, ny / len]
  })

  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (let p = 0; p < profile.length; p++) {
      const [r, y] = profile[p]
      positions.push(r * ca, y, r * sa)
      normals.push(pn[p][0] * ca, pn[p][1], pn[p][0] * sa)
    }
  }

  const rows = profile.length
  for (let s = 0; s < segments; s++) {
    for (let p = 0; p < rows - 1; p++) {
      const a = s * rows + p
      const b = (s + 1) * rows + p
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }

  // Disques de fermeture : sans eux, l'objet est creux et l'AR laisse voir
  // l'intérieur dès qu'on se penche au-dessus.
  const cap = (pIndex, up) => {
    const [r, y] = profile[pIndex]
    const centre = positions.length / 3
    positions.push(0, y, 0)
    normals.push(0, up ? 1 : -1, 0)
    const ring = []
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2
      ring.push(positions.length / 3)
      positions.push(r * Math.cos(a), y, r * Math.sin(a))
      normals.push(0, up ? 1 : -1, 0)
    }
    for (let s = 0; s < segments; s++) {
      if (up) indices.push(centre, ring[s], ring[s + 1])
      else indices.push(centre, ring[s + 1], ring[s])
    }
  }
  cap(profile.length - 1, true)
  cap(0, false)

  return { positions, normals, indices }
}

// ---------------------------------------------------------------------------
// Géométrie libre — pour ce que le tour ne sait pas faire
//
// Un masque n'est pas une forme de révolution : il a une face, un dos, des
// oreilles. On part donc d'un ellipsoïde que l'on DÉFORME point par point,
// puis on recalcule les normales d'après la surface obtenue. Les déduire
// analytiquement obligerait à dériver chaque déformation à la main ; les
// moyenner depuis les faces donne le même résultat et accepte n'importe quel
// relief.
// ---------------------------------------------------------------------------
function calculerNormales(positions, indices) {
  const n = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3]
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    // Produit vectoriel : la normale de la face, pondérée par son aire.
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const s of [a, b, c]) { n[s] += nx; n[s + 1] += ny; n[s + 2] += nz }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l
  }
  return Array.from(n)
}

// Ellipsoïde paramétré, éventuellement déformé. `deform(p, u, v)` reçoit le
// point et ses coordonnées de surface, et renvoie le point déplacé.
function spheroid({ rx, ry, rz, segments = 48, rings = 32, deform = null }) {
  const positions = []
  const indices = []
  for (let j = 0; j <= rings; j++) {
    const v = j / rings
    const phi = v * Math.PI
    for (let i = 0; i <= segments; i++) {
      const u = i / segments
      const theta = u * Math.PI * 2
      let p = [
        rx * Math.sin(phi) * Math.sin(theta),
        ry * Math.cos(phi),
        rz * Math.sin(phi) * Math.cos(theta)
      ]
      if (deform) p = deform(p, u, v)
      positions.push(p[0], p[1], p[2])
    }
  }
  const parLigne = segments + 1
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * parLigne + i
      const b = a + parLigne
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return { positions, indices }
}

function transformer(mesh, { dx = 0, dy = 0, dz = 0, rotZ = 0 }) {
  const p = [...mesh.positions]
  for (let i = 0; i < p.length; i += 3) {
    let [x, y] = [p[i], p[i + 1]]
    if (rotZ) {
      const c = Math.cos(rotZ)
      const s = Math.sin(rotZ)
      ;[x, y] = [x * c - y * s, x * s + y * c]
    }
    p[i] = x + dx
    p[i + 1] = y + dy
    p[i + 2] += dz
  }
  return { positions: p, indices: mesh.indices }
}

// Concatène des maillages en conservant des groupes : chaque groupe deviendra
// une primitive, donc pourra porter sa propre matière.
function fusionner(groupes) {
  const positions = []
  const indices = []
  const plages = []
  for (const g of groupes) {
    const decalage = positions.length / 3
    const debut = indices.length
    positions.push(...g.mesh.positions)
    for (const idx of g.mesh.indices) indices.push(idx + decalage)
    plages.push({ nom: g.nom, debut, compte: indices.length - debut, couleur: g.couleur })
  }
  return { positions, indices, normals: calculerNormales(positions, indices), plages }
}

// ---------------------------------------------------------------------------
// Écriture d'un maillage dans un .glb complet
// ---------------------------------------------------------------------------
function meshToGlb({ positions, normals, indices }, { nom, couleur, rugosite = 0.72 }) {
  const pos = new Float32Array(positions)
  const nor = new Float32Array(normals)
  const idx = new Uint32Array(indices)

  const posLen = pad4(pos.byteLength)
  const norLen = pad4(nor.byteLength)
  const idxLen = pad4(idx.byteLength)
  const bin = new ArrayBuffer(posLen + norLen + idxLen)
  new Uint8Array(bin).set(new Uint8Array(pos.buffer), 0)
  new Uint8Array(bin).set(new Uint8Array(nor.buffer), posLen)
  new Uint8Array(bin).set(new Uint8Array(idx.buffer), posLen + norLen)

  // glTF impose min/max sur l'accesseur de position (calcul des boîtes englobantes).
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k]
      if (pos[i + k] > max[k]) max[k] = pos[i + k]
    }
  }

  const gltf = {
    asset: { version: '2.0', generator: 'MUSÉA — générateur interne' },
    scene: 0,
    scenes: [{ nodes: [0], name: nom }],
    nodes: [{ mesh: 0, name: nom }],
    meshes: [{ name: nom, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{
      name: 'matiere',
      pbrMetallicRoughness: { baseColorFactor: couleur, metallicFactor: 0.05, roughnessFactor: rugosite },
      doubleSided: false
    }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posLen, byteLength: nor.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posLen + norLen, byteLength: idx.byteLength, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' }
    ]
  }

  return buildGlb(gltf, bin)
}

// Variante à PLUSIEURS MATIÈRES.
//
// Un même maillage, découpé en primitives : chacune porte sa propre matière.
// C'est ce qui permet au masque d'avoir un corps en bois patiné et des yeux
// clairs, sans texture ni fichier annexe — une matière est ici quatre nombres.
function meshMultiToGlb({ positions, normals, indices, plages }, nom) {
  const pos = new Float32Array(positions)
  const nor = new Float32Array(normals)
  const idx = new Uint32Array(indices)

  const posLen = pad4(pos.byteLength)
  const norLen = pad4(nor.byteLength)
  const idxLen = pad4(idx.byteLength)
  const bin = new ArrayBuffer(posLen + norLen + idxLen)
  new Uint8Array(bin).set(new Uint8Array(pos.buffer), 0)
  new Uint8Array(bin).set(new Uint8Array(nor.buffer), posLen)
  new Uint8Array(bin).set(new Uint8Array(idx.buffer), posLen + norLen)

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k]
      if (pos[i + k] > max[k]) max[k] = pos[i + k]
    }
  }

  // Un accesseur d'indices par plage : c'est la découpe en primitives.
  const accessors = [
    { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' }
  ]
  const primitives = []
  const materials = []
  plages.forEach((p, i) => {
    accessors.push({
      bufferView: 2,
      byteOffset: p.debut * 4, // Uint32 : 4 octets par indice
      componentType: 5125,
      count: p.compte,
      type: 'SCALAR'
    })
    materials.push({
      name: p.nom,
      pbrMetallicRoughness: {
        baseColorFactor: p.couleur,
        metallicFactor: 0.04,
        roughnessFactor: p.rugosite ?? 0.68
      },
      doubleSided: false
    })
    primitives.push({
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2 + i,
      material: i
    })
  })

  const gltf = {
    asset: { version: '2.0', generator: 'MUSÉA — générateur interne' },
    scene: 0,
    scenes: [{ nodes: [0], name: nom }],
    nodes: [{ mesh: 0, name: nom }],
    meshes: [{ name: nom, primitives }],
    materials,
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posLen, byteLength: nor.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posLen + norLen, byteLength: idx.byteLength, target: 34963 }
    ],
    accessors
  }

  return buildGlb(gltf, bin)
}

// ---------------------------------------------------------------------------
// Objets de démonstration
//
// Dimensions en MÈTRES : c'est l'unité du glTF, et c'est ce qui permet à la
// réalité augmentée de poser la pièce à sa taille réelle dans la salle.
// ---------------------------------------------------------------------------

// Tabouret royal — assise ronde, fût sculpté à la taille marquée, socle épais.
// Hauteur 52 cm, dans les proportions des sièges d'apparat bamiléké.
const PROFIL_TABOURET = [
  [0.00, 0.000], [0.200, 0.000], [0.200, 0.035], [0.168, 0.055],
  [0.112, 0.090], [0.098, 0.150], [0.082, 0.240], [0.098, 0.330],
  [0.112, 0.380], [0.140, 0.400], [0.140, 0.425], [0.120, 0.440],
  [0.225, 0.470], [0.225, 0.520], [0.000, 0.520]
]

// Récipient rituel — panse pleine, col resserré, lèvre évasée. Hauteur 34 cm.
const PROFIL_RECIPIENT = [
  [0.000, 0.000], [0.090, 0.000], [0.105, 0.020], [0.140, 0.080],
  [0.152, 0.150], [0.138, 0.215], [0.098, 0.262], [0.086, 0.290],
  [0.104, 0.320], [0.112, 0.340], [0.000, 0.340]
]

const DEMOS = {
  tabouret: { profil: PROFIL_TABOURET, nom: 'Tabouret royal', couleur: [0.42, 0.26, 0.15, 1], hauteur: 0.52 },
  recipient: { profil: PROFIL_RECIPIENT, nom: 'Récipient rituel', couleur: [0.34, 0.29, 0.24, 1], hauteur: 0.34 }
}

export const DEMO_VARIANTS = Object.keys(DEMOS)
const cle = (v) => (DEMOS[v] ? v : 'tabouret')

// Construit le .glb. Fonction pure : aucune API du navigateur, elle tourne donc
// aussi sous Node — c'est ainsi que `scripts/build-demo-models.mjs` écrit les
// fichiers statiques livrés dans public/modeles/.
export function buildDemoGlb(variante = 'tabouret') {
  const d = DEMOS[cle(variante)]
  return meshToGlb(lathe(d.profil), { nom: d.nom, couleur: d.couleur })
}

// Adresse du modèle de démonstration.
//
// ⚠️ On sert un FICHIER STATIQUE, jamais une URL `blob:`. Sur Android, quand
// WebXR n'est pas disponible, model-viewer se rabat sur Scene Viewer — une
// application Android distincte, qui télécharge le modèle elle-même. Elle ne
// peut pas lire une adresse `blob:`, qui n'existe que dans l'onglet. Une démo
// en blob s'effondrerait donc sur une partie du parc, une fois déployée.
export function demoModelUrl(variante = 'tabouret') {
  return `/modeles/${cle(variante)}.glb`
}

export function demoModelInfo(variante = 'tabouret') {
  const d = DEMOS[cle(variante)]
  return { nom: d.nom, hauteur: d.hauteur }
}
