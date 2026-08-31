// BRUITAGES — de courts signaux sonores, SYNTHÉTISÉS et non téléchargés.
//
// Le mode Conteur demande « des effets sonores amusants ». La voie évidente
// serait d'embarquer des fichiers ; elle est mauvaise ici pour trois raisons :
// aucun fichier n'existe, chacun serait un téléchargement de plus avant le
// premier son, et il faudrait les héberger, les servir avec le bon type MIME,
// les mettre en cache. Un carillon, c'est deux oscillateurs et une enveloppe :
// on le fabrique à la volée, il pèse zéro octet et il part instantanément.
//
// CE QU'ON PEUT FAIRE SANS ÉCHANTILLON — et il faut connaître la limite. On
// synthétise très bien ce qui est TONAL (cloches, notes, glissandos) et ce qui
// est BRUITÉ (souffle, frottement). On ne synthétise pas un tambour ndop
// crédible : cela demanderait un enregistrement. Les signaux ci-dessous sont
// donc des PONCTUATIONS d'interface, pas de la musique traditionnelle — la
// confusion serait un contresens culturel autant que technique.
//
// SOBRIÉTÉ. Un bruitage à chaque phrase devient une sonnerie de jeu vidéo et
// détruit exactement le sérieux qu'on cherche. Ils ponctuent les MOMENTS : une
// question posée, un choix retenu, une découverte.

import { contexteAudio } from './ambiance'

// Volume plafond. Ces signaux passent PAR-DESSUS la parole du guide et
// l'ambiance : à volume égal ils écraseraient les deux.
const VOLUME = 0.12

function enveloppe(ctx, gain, duree, pic = VOLUME) {
  const t = ctx.currentTime
  gain.gain.setValueAtTime(0, t)
  // Attaque courte mais NON nulle : à zéro, la discontinuité produit un clic
  // audible, qui est le défaut caractéristique du son synthétisé à la main.
  gain.gain.linearRampToValueAtTime(pic, t + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duree)
}

function note(ctx, freq, depart, duree, type = 'sine', pic = VOLUME) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, ctx.currentTime + depart)
  o.connect(g).connect(ctx.destination)
  const t = ctx.currentTime + depart
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(pic, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duree)
  o.start(t)
  o.stop(t + duree + 0.02)
}

function pret() {
  const c = contexteAudio()
  if (!c) return null
  if (c.state === 'suspended') c.resume().catch(() => {})
  if (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null
  return c
}

/**
 * DEUX CHEMINS S'OUVRENT — joué quand le guide propose un choix de récit.
 * Deux notes qui montent : la forme mélodique dit « à toi » sans un mot, et
 * c'est ce qui évite d'ajouter « appuyez sur… » à un guide sans boutons.
 */
export function question() {
  const c = pret(); if (!c) return
  note(c, 587.33, 0, 0.22)      // ré5
  note(c, 783.99, 0.11, 0.30)   // sol5
}

/** CHOIX RETENU — une tierce descendante, brève, qui referme la parenthèse. */
export function choix() {
  const c = pret(); if (!c) return
  note(c, 880, 0, 0.16)         // la5
  note(c, 659.25, 0.09, 0.26)   // mi5
}

/**
 * DÉCOUVERTE — un carillon de trois notes pour l'objet caché et la fin d'une
 * quête. C'est le seul signal qui a le droit d'être un peu long.
 */
export function decouverte() {
  const c = pret(); if (!c) return
  note(c, 659.25, 0,    0.28)
  note(c, 987.77, 0.10, 0.28)
  note(c, 1318.5, 0.20, 0.55, 'sine', VOLUME * 0.8)
}

/**
 * SOUFFLE — bruit filtré et glissant, pour une transition ou l'entrée du
 * conteur. Fabriqué à partir de bruit blanc : c'est la seule façon d'obtenir
 * une texture non tonale sans échantillon.
 */
export function souffle(duree = 0.5) {
  const c = pret(); if (!c) return
  const n = Math.floor(c.sampleRate * duree)
  const tampon = c.createBuffer(1, n, c.sampleRate)
  const d = tampon.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = c.createBufferSource()
  src.buffer = tampon
  const filtre = c.createBiquadFilter()
  filtre.type = 'bandpass'
  filtre.frequency.setValueAtTime(600, c.currentTime)
  filtre.frequency.exponentialRampToValueAtTime(2400, c.currentTime + duree)
  filtre.Q.value = 1.2
  const g = c.createGain()
  enveloppe(c, g, duree, VOLUME * 0.55)
  src.connect(filtre).connect(g).connect(c.destination)
  src.start()
  src.stop(c.currentTime + duree + 0.02)
}

/** L'OBJET PREND LA PAROLE — signature du mode Conteur, montée légère. */
export function conteur() {
  const c = pret(); if (!c) return
  souffle(0.34)
  note(c, 523.25, 0.14, 0.20, 'triangle')
  note(c, 698.46, 0.24, 0.34, 'triangle')
}

export const bruitagesSupportes = typeof window !== 'undefined' &&
  !!(window.AudioContext || window.webkitAudioContext)
