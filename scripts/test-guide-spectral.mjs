// Banc d'essai de la machine à états du Guide Spectral.
//
//   node scripts/test-guide-spectral.mjs
//
// Aucun téléphone, aucun casque, aucune dépendance : la machine étant pure, on
// fait avancer l'horloge à la main et on vérifie que chaque clause du cahier
// des charges se produit bien — et surtout qu'elle ne se produit PAS quand elle
// ne doit pas. Le silence respectueux et l'absence de relance intempestive sont
// les deux comportements qu'on ne peut pas constater « à l'œil » sur le terrain :
// il faut les mesurer.

import { creerGuideSpectral, ETATS } from '../src/components/immersive/spectral/avatarState.js'

let reussis = 0
let echoues = 0
function verifier(nom, condition, detail = '') {
  if (condition) { reussis++; console.log(`  ok   ${nom}`) }
  else { echoues++; console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ''}`) }
}

const POINTS = [
  { id: 1, code: 'seuil', libelle: 'Le seuil', priorite: 1, poseAvatar: { dx: 0.8, dz: -0.6 } },
  { id: 2, code: 'foyer', libelle: 'Le foyer central', priorite: 2, poseAvatar: { dx: 1, dz: 0.4 } },
  { id: 3, code: 'toit', libelle: 'La voûte', priorite: 6, poseAvatar: { dx: 1.2, dz: 0.9 } }
]

// Deux variantes sur le foyer : on vérifiera qu'un retour ne rejoue pas la même.
const RECITS = {
  1: [{ id: 11, texte: 'seuil A', dureeS: 20 }],
  2: [{ id: 21, texte: 'foyer A', dureeS: 22 }, { id: 22, texte: 'foyer B', dureeS: 24 }],
  3: [{ id: 31, texte: 'toit A', dureeS: 25 }]
}
const recitPour = (id, fois = 0) => {
  const l = RECITS[id]
  return l ? l[fois % l.length] : null
}

function neuf(config = {}) {
  return creerGuideSpectral({
    config, hotspots: POINTS, recitPour, salutation: 'Bienvenue.'
  })
}

// Fait avancer l'horloge par pas de 100 ms et rend toutes les actions émises.
function avancer(m, ms, perception = {}) {
  const actions = []
  for (let t = 0; t < ms; t += 100) {
    const r = m.tick(100, { ancre: true, ...perception })
    actions.push(...r.actions)
  }
  return actions
}
const aPourType = (actions, type) => actions.some((a) => a.type === type)
const derniersEtats = (actions) => actions.filter((a) => a.type === 'etat').map((a) => a.vers)

// Perception « immobile et contemplatif » : arrêté, regard tenu sur un point.
const contemplation = (hotspotId = 3) => ({
  deplacementM: 0.01,
  regard: { hotspotId, dwellMs: 5000, stable: true }
})
// Perception « perdu » : arrêté, regard qui ne se pose sur rien.
const stagnation = { deplacementM: 0.02, regard: { hotspotId: null, dwellMs: 0, stable: false } }
// Perception « il marche » : rien ne se déclenche.
const marche = { deplacementM: 0.5, regard: { hotspotId: null, dwellMs: 0, stable: false } }

console.log('\n§1 — apparition différée après ancrage')
{
  const m = neuf()
  const avant = avancer(m, 2400, marche)
  verifier("rien n'apparaît avant 2,5 s", !aPourType(avant, 'apparaitre'))
  const apres = avancer(m, 900, marche)
  verifier('apparition entre 2,5 et 3,5 s', aPourType(apres, 'apparaitre'))
}

console.log('\n§2 — salutation courte, puis silence')
{
  const m = neuf()
  avancer(m, 4400, marche)            // apparition + fondu
  verifier('état salutation atteint', m.etat === ETATS.SALUTATION)
  const suite = avancer(m, 11000, marche)  // plafond à 10 s
  verifier('la salutation se coupe au plafond', aPourType(suite, 'taire'))
  verifier('retour en accompagnement', m.etat === ETATS.ACCOMPAGNEMENT)
}

console.log('\n§4 — le regard tenu déclenche le récit, le regard fuyant non')
{
  const m = neuf()
  avancer(m, 4400, marche)
  avancer(m, 200, { ...marche, recitTermine: true })   // salutation finie

  // Regard instable : la fixation ne doit RIEN déclencher.
  const instable = avancer(m, 3000, {
    deplacementM: 0.4, regard: { hotspotId: 2, dwellMs: 2500, stable: false }
  })
  verifier("un regard instable ne déclenche pas de récit", !aPourType(instable, 'dire'))

  // Regard tenu au-delà du seuil de fixation.
  const tenu = avancer(m, 500, {
    deplacementM: 0.02, regard: { hotspotId: 2, dwellMs: 2100, stable: true }
  })
  verifier('approche déclenchée', derniersEtats(tenu).includes(ETATS.APPROCHE))
  const raconte = avancer(m, 3000, { ...contemplation(2), arriveEnPlace: true })
  verifier('récit démarré', aPourType(raconte, 'dire'))
  const dire = raconte.find((a) => a.type === 'dire')
  verifier('récit du bon point', dire?.hotspotId === 2, `reçu ${dire?.hotspotId}`)
  verifier("l'avatar se place à côté de l'élément", aPourType(raconte, 'placer'))
}

console.log('\n§6 — silence respectueux : immobile + contemplatif > 6 s')
{
  const m = neuf()
  avancer(m, 4400, marche)
  avancer(m, 200, { ...marche, recitTermine: true })
  // On contemple le toit ; son récit sera d'abord raconté, puis on reste immobile.
  avancer(m, 500, contemplation(3))
  avancer(m, 3000, { ...contemplation(3), arriveEnPlace: true })
  avancer(m, 200, { ...contemplation(3), recitTermine: true })
  verifier('retour en accompagnement après le récit', m.etat === ETATS.ACCOMPAGNEMENT)

  // Immobile, le regard tenu sur un point DÉJÀ raconté : c'est la contemplation.
  // Le compteur repart de la fin du récit : cinq secondes plus tard, le guide
  // accompagne encore. Sans cette remise à zéro, il se serait tu à l'instant
  // même où il finissait sa phrase — un silence qui ne respecte rien.
  const trop_tot = avancer(m, 5000, contemplation(3))
  verifier('pas de silence dans les 6 s qui suivent le récit',
    m.etat === ETATS.ACCOMPAGNEMENT && !aPourType(trop_tot, 'taire'), `état ${m.etat}`)

  const apres = avancer(m, 2000, contemplation(3))
  verifier('passage en silence', m.etat === ETATS.SILENCE, `état ${m.etat}`)
  verifier('le guide se tait explicitement', aPourType(apres, 'taire'))
  const pendant = avancer(m, 20000, contemplation(3))
  verifier('AUCUNE parole pendant la contemplation prolongée', !aPourType(pendant, 'dire'))
  verifier('aucune relance pendant la contemplation', !aPourType(pendant, 'proposer'))
}

console.log('\n§7 — relance uniquement sur stagnation, jamais sur contemplation')
{
  const m = neuf()
  avancer(m, 4400, marche)
  avancer(m, 200, { ...marche, recitTermine: true })

  const avant12 = avancer(m, 11000, stagnation)
  verifier('rien avant 12 s', !aPourType(avant12, 'proposer'))
  const apres12 = avancer(m, 2000, stagnation)
  verifier('proposition après 12 s', aPourType(apres12, 'proposer'))
  const prop = apres12.find((a) => a.type === 'proposer')
  verifier('propose le point le plus prioritaire jamais entendu', prop?.hotspotId === 1, `reçu ${prop?.hotspotId}`)

  // Refus : le délai suivant doit DOUBLER (un guide qui insiste est subi).
  m.tick(100, { ancre: true, ...stagnation, reponse: 'non' })
  const apresRefus = avancer(m, 13000, stagnation)
  verifier('pas de relance immédiate après un refus', !aPourType(apresRefus, 'proposer'))
  const bienPlusTard = avancer(m, 12000, stagnation)
  verifier('relance seulement au délai doublé', aPourType(bienPlusTard, 'proposer'))
}

console.log('\n§5 — plafond de durée du récit')
{
  const m = neuf({ recitMaxS: 35 })
  avancer(m, 4400, marche)
  avancer(m, 200, { ...marche, recitTermine: true })
  avancer(m, 500, contemplation(1))
  avancer(m, 3000, { ...contemplation(1), arriveEnPlace: true })
  verifier('en récit', m.etat === ETATS.RECIT)
  // La voix ne signale jamais sa fin (cas d'un moteur vocal muet) : le garde-fou
  // doit reprendre la main plutôt que de laisser le guide figé pour toujours.
  const trop = avancer(m, 40000, contemplation(1))
  verifier('le plafond coupe le récit', aPourType(trop, 'taire'))
  // On vérifie la TRANSITION, pas l'état final : au bout de quarante secondes
  // d'immobilité totale, le guide a repris l'accompagnement puis basculé en
  // silence contemplatif. C'est la bonne suite — l'état final seul mentirait.
  const suite = derniersEtats(trop)
  verifier('retour en accompagnement', suite.includes(ETATS.ACCOMPAGNEMENT), `suite ${suite}`)
  verifier('puis silence, le visiteur étant resté figé', suite.includes(ETATS.SILENCE))
}

console.log("\nVariantes — un retour sur le même point ne rejoue pas le même texte")
{
  const m = neuf({ repriseHotspotS: 1 })
  avancer(m, 4400, marche)
  avancer(m, 200, { ...marche, recitTermine: true })

  const dits = []
  for (let passage = 0; passage < 2; passage++) {
    avancer(m, 500, contemplation(2))
    const a = avancer(m, 3000, { ...contemplation(2), arriveEnPlace: true })
    const d = a.find((x) => x.type === 'dire')
    if (d) dits.push(d.recitId)
    avancer(m, 200, { ...contemplation(2), recitTermine: true })
    avancer(m, 2000, marche)   // il s'éloigne, le délai de reprise s'écoule
  }
  verifier('deux passages, deux textes différents', dits.length === 2 && dits[0] !== dits[1], `reçus ${dits}`)
}

console.log('\n§8 — fin de visite')
{
  const m = neuf()
  avancer(m, 4400, marche)
  const fin = m.tick(100, { ancre: true, ...marche, demandeFin: true })
  verifier("geste d'au revoir", fin.actions.some((a) => a.type === 'animer' && a.clip === 'farewell'))
  verifier('fondu de sortie', aPourType(fin.actions, 'fondu'))
  const apres = avancer(m, 3000, marche)
  verifier('masquage puis état terminé', aPourType(apres, 'masquer') && m.etat === ETATS.TERMINE)
}

console.log('\nSortie de zone — il part sans appuyer sur Terminer')
{
  const m = neuf()
  avancer(m, 4400, marche)
  const proche = avancer(m, 2500, { ...marche, distanceCentreM: 13 })
  verifier("13 m ne suffisent pas à congédier le guide", !aPourType(proche, 'fondu'))
  const loin = avancer(m, 4000, { ...marche, distanceCentreM: 20 })
  verifier('au-delà du rayon et du délai, il prend congé', aPourType(loin, 'fondu'))
}


// ===========================================================================
// PAROLE EN DIRECT
// ---------------------------------------------------------------------------
// Ce que ces vérifications protègent, et qu'aucune relecture de code ne donne :
// le guide doit se TAIRE dès qu'on lui parle, ANTICIPER avant d'être sûr, et
// se rabattre sans bruit quand la génération traîne. Trois comportements qui,
// mal réglés, ne se remarquent qu'au moment où quelqu'un tient le téléphone.
// ===========================================================================
function neufDirect(config = {}) {
  return creerGuideSpectral({
    config: { improvisation: true, ...config },
    hotspots: POINTS, recitPour, salutation: 'Bienvenue.'
  })
}
function prete(m) {              // amène la machine en accompagnement
  avancer(m, 4400, marche)
  avancer(m, 200, { ...marche, recitTermine: true })
}
const regardSur = (id, dwellMs) => ({
  deplacementM: 0.02, regard: { hotspotId: id, dwellMs, stable: true }
})

console.log('\nAnticipation — la génération part avant la validation du regard')
{
  const m = neufDirect()
  prete(m)

  const tot = avancer(m, 300, regardSur(2, 400))
  verifier('rien à 400 ms de fixation', !aPourType(tot, 'preparer'))

  const lance = avancer(m, 300, regardSur(2, 900))
  verifier('préparation lancée à 900 ms', aPourType(lance, 'preparer'))
  verifier('avant la validation du regard', m.etat === ETATS.ACCOMPAGNEMENT)

  const relance = avancer(m, 500, regardSur(2, 1200))
  verifier('une seule requête par point', !aPourType(relance, 'preparer'))
}

console.log('\nAnticipation — un regard qui se détourne ne se paie pas')
{
  const m = neufDirect()
  prete(m)
  avancer(m, 300, regardSur(2, 900))
  const parti = avancer(m, 200, { ...marche, regard: { hotspotId: null, dwellMs: 0, stable: false } })
  verifier('la génération est annulée', aPourType(parti, 'annulerPreparation'))
}

console.log('\nRéflexion — le guide ne parle qu\'au premier mot reçu')
{
  const m = neufDirect()
  prete(m)
  avancer(m, 300, regardSur(2, 900))
  const valide = avancer(m, 300, regardSur(2, 2100))
  verifier('approche déclenchée', derniersEtats(valide).includes(ETATS.APPROCHE))

  const demande = avancer(m, 3000, { ...regardSur(2, 3000), arriveEnPlace: true })
  verifier('parole demandée au modèle', aPourType(demande, 'improviser'))
  verifier('état réflexion', m.etat === ETATS.REFLEXION, `état ${m.etat}`)
  verifier('aucun texte prononcé sans le modèle', !aPourType(demande, 'dire'))

  const parle = avancer(m, 200, { ...regardSur(2, 3200), paroleCommencee: true })
  verifier('passage en récit au premier mot', m.etat === ETATS.RECIT)
  verifier('animation de parole', parle.some((a) => a.type === 'animer' && a.clip === 'talk'))
}

console.log('\nRéflexion — repli silencieux quand la génération traîne')
{
  const m = neufDirect({ reflexionMaxMs: 2000 })
  prete(m)
  avancer(m, 300, regardSur(2, 900))
  avancer(m, 300, regardSur(2, 2100))
  // Le modèle ne répond jamais. Le point 2 a des récits relus : on doit les servir.
  // On observe la SUITE D'ACTIONS sur toute la fenêtre plutôt que l'état à un
  // instant choisi : l'assertion ne dépend plus du découpage du temps.
  const suite = avancer(m, 8000, { ...regardSur(2, 5000), arriveEnPlace: true })
  verifier('parole demandée au modèle', aPourType(suite, 'improviser'))
  verifier('repli annoncé', aPourType(suite, 'replier'))
  verifier('un texte relu prend le relais', aPourType(suite, 'dire'))
  verifier('le visiteur entend quelque chose', m.etat === ETATS.RECIT, `état ${m.etat}`)
}

console.log('\nRéflexion — sans texte de secours, il se tait plutôt que d\'attendre')
{
  // Le point 4 n'a aucun récit relu : le repli n'a rien à servir.
  const m = creerGuideSpectral({
    config: { improvisation: true, reflexionMaxMs: 2000 },
    hotspots: [...POINTS, { id: 4, code: 'sortie', libelle: 'La sortie', priorite: 7 }],
    recitPour, salutation: 'Bienvenue.'
  })
  prete(m)
  avancer(m, 300, regardSur(4, 900))
  avancer(m, 300, regardSur(4, 2100))
  const suite = avancer(m, 8000, { ...regardSur(4, 5000), arriveEnPlace: true })
  const repli = suite.find((a) => a.type === 'replier')
  verifier('repli annoncé, sans secours', repli && repli.secours === false)
  verifier('aucun texte servi au hasard', !aPourType(suite, 'dire'))
  verifier('retour en accompagnement', m.etat === ETATS.ACCOMPAGNEMENT, `état ${m.etat}`)
}

console.log('\nÉcoute — il se tait DÈS que le visiteur parle')
{
  const m = neufDirect()
  prete(m)
  avancer(m, 300, regardSur(2, 900))
  avancer(m, 300, regardSur(2, 2100))
  avancer(m, 3000, { ...regardSur(2, 3000), arriveEnPlace: true })
  avancer(m, 200, { ...regardSur(2, 3200), paroleCommencee: true })
  verifier('le guide raconte', m.etat === ETATS.RECIT)

  // Un seul pas d'horloge : l'interruption ne doit pas attendre.
  const coupe = m.tick(100, { ancre: true, ...regardSur(2, 3300), ecoute: true })
  verifier('il se tait au premier pas', aPourType(coupe.actions, 'taire'))
  verifier('état écoute', m.etat === ETATS.ECOUTE)
  verifier('animation d\'écoute', coupe.actions.some((a) => a.type === 'animer' && a.clip === 'listen'))

  const rien = avancer(m, 3000, { ...regardSur(2, 4000), ecoute: true })
  verifier('il ne dit rien pendant qu\'on lui parle', !aPourType(rien, 'dire') && !aPourType(rien, 'improviser'))
}

console.log('\nQuestion — elle prime, et ne consomme pas le point regardé')
{
  const m = neufDirect()
  prete(m)
  const pose = m.tick(100, {
    ancre: true, ...regardSur(2, 3000), ecoute: false, question: 'Qui dormait ici ?'
  })
  verifier('réponse demandée au modèle', aPourType(pose.actions, 'improviser'))
  const imp = pose.actions.find((a) => a.type === 'improviser')
  verifier('la question est transmise', imp?.question === 'Qui dormait ici ?')
  verifier('le point regardé sert de contexte', imp?.hotspotId === 2)
  verifier('état réflexion', m.etat === ETATS.REFLEXION)

  // La réponse finie, le point doit RESTER racontable : une question posée à
  // son sujet n'est pas son récit.
  avancer(m, 200, { ...regardSur(2, 3200), paroleCommencee: true })
  m.tick(100, { ancre: true, ...regardSur(2, 3400), recitTermine: true })

  const apres = avancer(m, 4000, { ...regardSur(2, 3400), arriveEnPlace: true })
  const spontanes = apres.filter((a) => a.type === 'improviser' && !a.question)
  verifier('le récit du point reste dû', spontanes.length === 1, `${spontanes.length} demande(s)`)
}

console.log('\nQuestion — en repli, il avoue au lieu de servir un texte au hasard')
{
  const m = neuf()   // improvisation coupée
  prete(m)
  const pose = m.tick(100, { ancre: true, ...regardSur(2, 3000), question: 'Qui dormait ici ?' })
  verifier('aucun récit détourné en réponse', !aPourType(pose.actions, 'dire'))
  verifier('il le dit franchement', aPourType(pose.actions, 'sansReponse'))
}

console.log(`\n${reussis} vérifications passées, ${echoues} en échec.`)
process.exit(echoues ? 1 : 0)
