// PAYSAGES SONORES — la couche qu'on ne remarque qu'en la coupant.
//
// Un objet posé en silence reste une image. La même pièce sur fond de cour, de
// forge ou de forêt cesse d'être un fichier : elle vient de quelque part. C'est
// l'effet le moins coûteux et le plus fort de tout le dispositif d'immersion.
//
// TROIS PARTIS PRIS, ET ILS COMMANDENT TOUT LE FICHIER.
//
//  1. WEB AUDIO, PAS <audio>. Une balise `<audio>` ne sait ni se spatialiser ni
//     se fondre proprement. Ici on veut les deux : la source reste ACCROCHÉE à
//     l'objet dans l'espace (tourner la tête la déplace), et le passage d'une
//     salle à l'autre se fait en fondu, jamais par une coupure.
//
//  2. L'AMBIANCE NE DOIT JAMAIS COUVRIR LA PAROLE. Le guide vocal a la
//     priorité absolue : dès qu'il parle, l'ambiance descend (`baisser()`) et
//     remonte quand il se tait. Sans cela on a construit deux sources qui se
//     battent, et le visiteur coupe le son — donc perd les deux.
//
//  3. RIEN NE DÉMARRE SANS GESTE. Les navigateurs suspendent l'AudioContext
//     tant que l'utilisateur n'a rien touché. On ne se bat pas contre cette
//     règle : on prépare tout, et on démarre au premier geste réel.
//
// Aucune dépendance : Web Audio est dans le navigateur depuis dix ans.

import { ref } from 'vue'

const SUPPORTE = typeof window !== 'undefined' &&
  !!(window.AudioContext || window.webkitAudioContext)

// Volume de repli quand la fiche n'en donne pas. Volontairement bas : une
// ambiance qu'on entend distinctement est une ambiance ratée.
const VOLUME_DEFAUT = 0.3
// Facteur appliqué pendant que le guide parle. Pas zéro : une coupure nette
// s'entend et attire l'attention, exactement ce qu'on cherche à éviter.
const ATTENUATION_PAROLE = 0.18
const FONDU_S = 1.4

export const ambianceActive = ref(false)   // une nappe joue-t-elle ?
export const ambianceCoupee = ref(false)   // le visiteur a-t-il coupé ?

let ctx = null
let couche = null          // { source, gain, panner, url }
let volumeCible = VOLUME_DEFAUT
let attenue = false

function contexte() {
  if (!SUPPORTE) return null
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext
    ctx = new C()
  }
  return ctx
}

// Partagé avec les bruitages du mode Conteur. Les navigateurs limitent le
// nombre d'AudioContext par page (six sur Chrome) et en ouvrir un second pour
// trois carillons serait un gaspillage qui finit par échouer en silence.
export { contexte as contexteAudio }

/**
 * À appeler depuis un vrai geste du visiteur (clic, toucher). Sans cela le
 * contexte reste suspendu et rien ne sortira — silencieusement, ce qui est le
 * piège classique de Web Audio.
 */
export function debloquer() {
  const c = contexte()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}

function rampe(gain, vers, duree = FONDU_S) {
  const c = contexte()
  if (!c || !gain) return
  const t = c.currentTime
  // `setValueAtTime` d'abord : sans lui, une rampe lancée pendant une rampe
  // repart de la valeur théorique et non de la valeur réellement atteinte, ce
  // qui produit un saut audible.
  gain.gain.cancelScheduledValues(t)
  gain.gain.setValueAtTime(gain.gain.value, t)
  gain.gain.linearRampToValueAtTime(vers, t + duree)
}

function detruire(c) {
  if (!c) return
  rampe(c.gain, 0, 0.6)
  const src = c.source
  setTimeout(() => {
    try { src.stop() } catch { /* déjà arrêtée */ }
    try { src.disconnect() } catch { /* déjà détachée */ }
  }, 700)
}

/**
 * Installe (ou remplace) la nappe sonore.
 *
 * @param {string}  url        fichier audio ; vide ⇒ on coupe proprement
 * @param {object}  opts
 * @param {number}  opts.volume     0..1, volume de croisière
 * @param {boolean} opts.spatiale   true ⇒ la source est placée dans l'espace
 * @param {Array}   opts.position   [x, y, z] en mètres, repère de la scène
 */
export async function poser(url, opts = {}) {
  if (!SUPPORTE) return false
  const c = contexte()
  if (!c) return false

  // Même nappe déjà en place : on ne la relance pas. Un `poser()` appelé à
  // chaque rendu redémarrerait le fichier en boucle, ce qui s'entend
  // immédiatement comme un bégaiement.
  if (couche && couche.url === url) {
    volumeCible = Number(opts.volume) || VOLUME_DEFAUT
    if (!attenue && !ambianceCoupee.value) rampe(couche.gain, volumeCible)
    return true
  }

  if (couche) { detruire(couche); couche = null; ambianceActive.value = false }
  if (!url) return false

  let mem
  try {
    const rep = await fetch(url, { mode: 'cors' })
    if (!rep.ok) throw new Error(String(rep.status))
    mem = await c.decodeAudioData(await rep.arrayBuffer())
  } catch {
    // Fichier absent, CORS refusé, format illisible : une ambiance manquante
    // n'est jamais un incident. On se tait, la visite continue.
    return false
  }

  volumeCible = Number(opts.volume) || VOLUME_DEFAUT
  const source = c.createBufferSource()
  source.buffer = mem
  source.loop = true

  const gain = c.createGain()
  gain.gain.value = 0                         // on monte en fondu, jamais sec

  let panner = null
  if (opts.spatiale !== false && c.createPanner) {
    panner = c.createPanner()
    panner.panningModel = 'HRTF'              // vraie spatialisation binaurale
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 40
    panner.rolloffFactor = 1.2
    const [x, y, z] = opts.position || [0, 0.6, -1.2]
    // `setPosition` est déprécié mais reste le SEUL chemin sur Safari : les
    // AudioParam positionX/Y/Z n'y existent pas. On tente le moderne, on
    // retombe sur l'ancien.
    if (panner.positionX) {
      panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z
    } else { panner.setPosition(x, y, z) }
    source.connect(gain).connect(panner).connect(c.destination)
  } else {
    source.connect(gain).connect(c.destination)
  }

  try { source.start(0) } catch { return false }
  couche = { source, gain, panner, url }
  ambianceActive.value = true
  if (!ambianceCoupee.value) rampe(gain, attenue ? volumeCible * ATTENUATION_PAROLE : volumeCible)
  return true
}

/**
 * Déplace la source dans l'espace — appelé quand la caméra tourne autour de
 * l'objet. C'est ce qui fait que le son « reste » sur la pièce au lieu de
 * suivre la tête, et c'est toute la différence avec une piste stéréo.
 */
export function placer(x, y, z) {
  const p = couche?.panner
  if (!p) return
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z }
  else p.setPosition(x, y, z)
}

/** Oriente l'auditeur. En RA, c'est la caméra du téléphone qui commande. */
export function ecouteurVers(x, y, z, hautX = 0, hautY = 1, hautZ = 0) {
  const c = contexte()
  const l = c?.listener
  if (!l) return
  if (l.forwardX) {
    l.forwardX.value = x; l.forwardY.value = y; l.forwardZ.value = z
    l.upX.value = hautX; l.upY.value = hautY; l.upZ.value = hautZ
  } else if (l.setOrientation) {
    l.setOrientation(x, y, z, hautX, hautY, hautZ)
  }
}

/** Le guide prend la parole : l'ambiance s'efface derrière lui. */
export function baisser() {
  attenue = true
  if (couche && !ambianceCoupee.value) rampe(couche.gain, volumeCible * ATTENUATION_PAROLE, 0.35)
}

/** Le guide s'est tu : l'ambiance revient, lentement pour ne pas se signaler. */
export function remonter() {
  attenue = false
  if (couche && !ambianceCoupee.value) rampe(couche.gain, volumeCible, 2.2)
}

/** Coupure décidée par le visiteur — elle prime sur tout le reste. */
export function basculerCoupure() {
  ambianceCoupee.value = !ambianceCoupee.value
  if (!couche) return
  rampe(couche.gain, ambianceCoupee.value ? 0 : (attenue ? volumeCible * ATTENUATION_PAROLE : volumeCible), 0.5)
  return ambianceCoupee.value
}

/** Fin de visite : on retire la nappe et on rend le contexte audio. */
export function arreter() {
  if (couche) { detruire(couche); couche = null }
  ambianceActive.value = false
  attenue = false
}

/**
 * Choisit l'ambiance la plus PRÉCISE disponible : œuvre, puis salle, puis
 * musée. Le conservateur pose une fois l'ambiance de sa cour et ne la redit
 * que là où elle change.
 */
export function ambiancePour({ objet, secteur, musee } = {}) {
  const candidats = [
    { url: objet?.ambiance_url, volume: objet?.ambiance_volume, spatiale: objet?.ambiance_spatiale !== false },
    { url: secteur?.ambiance_url, volume: secteur?.ambiance_volume, spatiale: false },
    { url: musee?.ambiance_url, volume: musee?.ambiance_volume, spatiale: false }
  ]
  const t = candidats.find((c) => c.url && !String(c.url).startsWith('blob:'))
  return t || null
}

export const ambianceSupportee = SUPPORTE
