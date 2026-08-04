// Relief 2.5D — une photo plate qui révèle du volume quand la caméra bouge.
//
// CE QUE C'EST, ET CE QUE CE N'EST PAS
//
// Ce n'est PAS un scan. C'est un plan subdivisé dont chaque sommet est poussé
// vers le spectateur proportionnellement à une carte de profondeur. L'illusion
// est excellente de face et s'effondre de profil : les zones cachées de la
// photo n'existent pas, elles ne peuvent qu'être étirées. D'où le bridage de
// l'angle, qui n'est pas une limite subie mais la condition du procédé.
//
// POURQUOI CE FICHIER PLUTÔT QUE THREE.JS
//
// npm est hors service sur ce poste (MUSEA_MASTER_PLAN §6) : aucune dépendance
// n'est installable. Le projet a déjà fait ce choix une fois, pour le panorama
// 360 (`src/components/immersive/panorama.js`) — on reste dans la même veine,
// avec les mêmes conventions. Ce qu'il faut ici tient en un plan, deux textures
// et un déplacement de sommets : Three.js apporterait 600 Ko pour cela.
//
// LA CONTRAINTE TECHNIQUE À CONNAÎTRE
//
// Lire une texture DANS LE SHADER DE SOMMETS n'est pas garanti en WebGL 1 :
// `MAX_VERTEX_TEXTURE_IMAGE_UNITS` vaut 0 sur certains vieux GPU mobiles. On le
// vérifie au démarrage et, s'il vaut zéro, on renonce proprement — l'appelant
// affiche alors l'image plate, ce qui est exactement le second niveau de rendu
// prévu par la conception.

const VERT = `
attribute vec2 aPos;
uniform sampler2D uDepth;
uniform float uAmp;
uniform float uBias;
uniform mat4 uMvp;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  // L'image est stockée de haut en bas, la texture de bas en haut.
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  // Depth Anything rend le PROCHE en clair : un canal suffit, les trois sont
  // identiques sur une carte en niveaux de gris.
  float d = texture2D(uDepth, uv).r;
  gl_Position = uMvp * vec4(aPos, (d - uBias) * uAmp, 1.0);
}`

const FRAG = `
precision mediump float;
uniform sampler2D uColor;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uColor, vec2(vUv.x, 1.0 - vUv.y));
  // Le fond a été retiré à la segmentation : on ne dessine pas ses pixels,
  // sinon le mur du musée d'origine partirait en relief avec l'objet.
  if (c.a < 0.15) discard;
  gl_FragColor = c;
}`

// 128×128 quads = 16 641 sommets. Deux raisons à ce chiffre : c'est assez dense
// pour que le relief ne montre pas de facettes, et l'indice de sommet le plus
// grand reste sous 65 535 — au-delà, WebGL 1 exige l'extension OES_element_index_uint,
// que tous les appareils n'ont pas.
const SUBDIV = 128

function compiler(gl, type, source) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`shader : ${log}`)
  }
  return sh
}

// Grille de sommets en coordonnées -1..1, et ses indices de triangles.
function grille(n) {
  const pos = new Float32Array((n + 1) * (n + 1) * 2)
  let k = 0
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      pos[k++] = (x / n) * 2 - 1
      pos[k++] = (y / n) * 2 - 1
    }
  }
  const idx = new Uint16Array(n * n * 6)
  let i = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x
      const b = a + 1
      const c = a + (n + 1)
      const d = c + 1
      idx[i++] = a; idx[i++] = c; idx[i++] = b
      idx[i++] = b; idx[i++] = c; idx[i++] = d
    }
  }
  return { pos, idx }
}

// --- Algèbre minimale (quatre fonctions, pas une bibliothèque) --------------
function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ])
}

function multiplier(a, b) {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return o
}

// Vue : on recule la caméra, puis on fait tourner l'OBJET (c'est équivalent à
// une orbite et cela évite d'avoir à composer une matrice de vue inverse).
function vue(yaw, pitch, distance) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  const rotY = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1])
  const rotX = new Float32Array([1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1])
  const trans = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -distance, 1])
  return multiplier(trans, multiplier(rotX, rotY))
}

function chargerImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    // Sans en-tête CORS, `texImage2D` lève une SecurityError. On la demande ;
    // si le serveur refuse, onerror nous ramène avec null et l'appelant
    // retombe sur l'image plate.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function texture(gl, img, unite) {
  const t = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + unite)
  gl.bindTexture(gl.TEXTURE_2D, t)
  // CLAMP obligatoire : les images de musée ne sont pas en puissance de deux,
  // et WebGL 1 refuse alors REPEAT et les mipmaps.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  return t
}

/**
 * Crée le moteur sur un canvas. Renvoie null si l'appareil ne sait pas
 * déplacer des sommets d'après une texture — ce n'est pas une panne, c'est le
 * cas prévu : l'appelant affiche l'image plate.
 */
export function creerRelief(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
  if (!gl) return null

  // LE contrôle qui décide de tout. Zéro = pas de lecture de texture dans le
  // shader de sommets = pas de déplacement possible.
  if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) return null

  let prog
  try {
    prog = gl.createProgram()
    gl.attachShader(prog, compiler(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compiler(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  } catch {
    return null
  }
  gl.useProgram(prog)

  const { pos, idx } = grille(SUBDIV)
  const bufPos = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos)
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const bufIdx = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)

  const uMvp = gl.getUniformLocation(prog, 'uMvp')
  const uAmp = gl.getUniformLocation(prog, 'uAmp')
  const uBias = gl.getUniformLocation(prog, 'uBias')
  gl.uniform1i(gl.getUniformLocation(prog, 'uColor'), 0)
  gl.uniform1i(gl.getUniformLocation(prog, 'uDepth'), 1)

  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(0, 0, 0, 0)

  let texCouleur = null
  let texProfondeur = null
  let pret = false

  async function charger(urlCouleur, urlProfondeur) {
    pret = false
    const [c, d] = await Promise.all([chargerImage(urlCouleur), chargerImage(urlProfondeur)])
    // Les deux sont nécessaires : sans profondeur il n'y a pas de relief, et
    // sans couleur il n'y a rien à montrer. On ne bricole pas un demi-rendu.
    if (!c || !d) return false
    try {
      texCouleur = texture(gl, c, 0)
      texProfondeur = texture(gl, d, 1)
    } catch {
      return false   // image d'un autre domaine sans CORS
    }
    pret = true
    return true
  }

  /**
   * @param yaw   radians, déjà borné par l'appelant
   * @param pitch radians
   * @param amp   amplitude du relief, en unités du plan (0.08 à 0.15 = la zone utile)
   */
  function rendre(yaw, pitch, amp = 0.12) {
    if (!pret) return
    const l = canvas.clientWidth || 300
    const h = canvas.clientHeight || 300
    // Le canvas suit la densité de l'écran, plafonnée à 2 : au-delà on paie
    // quatre fois les pixels pour un gain que personne ne voit.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(l * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(l * dpr)
      canvas.height = Math.round(h * dpr)
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    const mvp = multiplier(perspective(38, canvas.width / canvas.height, 0.1, 20), vue(yaw, pitch, 3.05))
    gl.uniformMatrix4fv(uMvp, false, mvp)
    // ×2 : `amp` est exprimée dans l'échelle du cahier des charges, qui vise un
    // plan de largeur 1 (« 0,08 à 0,15 de la largeur du plan »). Notre grille
    // va de −1 à +1, elle fait donc DEUX unités de large. Sans ce facteur, le
    // relief sort deux fois trop faible — mesuré : l'effet devenait invisible.
    gl.uniform1f(uAmp, amp * 2)
    // On centre le déplacement sur la profondeur médiane : sans ce recentrage,
    // toute l'image avancerait en bloc au lieu de se creuser.
    gl.uniform1f(uBias, 0.5)

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texCouleur)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texProfondeur)
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0)
  }

  function detruire() {
    if (texCouleur) gl.deleteTexture(texCouleur)
    if (texProfondeur) gl.deleteTexture(texProfondeur)
    gl.deleteBuffer(bufPos)
    gl.deleteBuffer(bufIdx)
    gl.deleteProgram(prog)
    // Sans cela, l'onglet accumule les contextes WebGL et le navigateur finit
    // par abandonner le plus ancien — au milieu d'une visite.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  return { charger, rendre, detruire, get pret() { return pret } }
}

// Au-delà de ~20° autour de la normale, les zones que la photo ne contient pas
// deviennent visibles et s'étirent. C'est la limite du procédé, pas un réglage
// de confort : on la respecte au lieu de la corriger après coup.
export const ANGLE_MAX_RELIEF = (20 * Math.PI) / 180

// Amplitude par défaut. Mesure du cahier des charges : en deçà de 0,08 l'effet
// ne se voit pas, au-delà de 0,15 l'objet se déforme en pâte à modeler et les
// bords se déchirent. Réglable par œuvre — une tapisserie et un buste ne
// demandent pas la même valeur.
export const AMPLITUDE_DEFAUT = 0.12
