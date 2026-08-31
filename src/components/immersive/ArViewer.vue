<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { demoModelUrl, demoModelInfo } from '@/services/glb'
import { qrSvg } from '@/services/qrcode'
import { chargerModelViewer } from '@/services/modelViewer'
import { useTts } from '@/services/tts'
import ObjectGuideRobot from '@/components/objects/ObjectGuideRobot.vue'
import { useGuideFocus } from '@/composables/useGuideFocus'
import * as ambiance from '@/services/ambiance'
import * as haptique from '@/services/haptique'
import { reglagesLumiere, msAvantProchainMoment } from '@/services/lumiere'
import { composerPoster, offrirPoster } from '@/services/poster'

// RÉALITÉ AUGMENTÉE — « Retour au pays ».
//
// La thèse du projet en dix secondes : on pointe le sol de la cour de la
// chefferie et l'objet exilé réapparaît.
//
// COMMENT LA RA FONCTIONNE ICI — le point que l'on comprend de travers une fois
// sur deux : ce n'est PAS le navigateur qui fait la réalité augmentée. Il ne
// fait que passer la main au système :
//
//   Android → intent vers SCENE VIEWER, l'application de Google adossée à
//             ARCore. C'est elle qui allume la caméra, détecte les plans et
//             pose l'objet. Elle télécharge le .glb elle-même, par son URL.
//   iOS     → le .usdz est remis à QUICK LOOK. Sans ce fichier, rien.
//   WebXR   → la seule voie qui s'exécute vraiment dans le navigateur, et la
//             moins fiable sur mobile.
//
// Trois conséquences : il faut DEUX fichiers (glb + usdz), le modèle doit être
// servi publiquement avec le bon type MIME puisqu'une AUTRE application vient
// le chercher, et le QR n'est pas un marqueur — le placement se fait par
// détection de plan, le QR n'est qu'un lien.
//
// L'ÉCHELLE. On laisse `ar-scale` en mode automatique, comme le projet de
// référence. « fixed » plaçait l'objet à sa taille réelle : intellectuellement
// juste, mais une case de six mètres posée dans une pièce devient un mur de
// texture, et le visiteur conclut que rien ne s'est affiché.
//
// Sur ordinateur, la RA est indisponible : au lieu d'un bouton grisé, on
// affiche un QR. Le jury scanne, l'objet apparaît dans la salle.

const props = defineProps({
  objet: { type: Object, default: null },
  // Variante du modèle de démonstration quand l'objet n'a pas encore été numérisé.
  variante: { type: String, default: 'tabouret' },
  // Adresse à encoder dans le QR ; par défaut la page RA autonome de cet objet.
  lienMobile: { type: String, default: '' },
  // RÉALITÉ AUGMENTÉE SEULE. Le modèle reste chargé — il le faut pour lancer la
  // RA — mais on retire tout ce qui invite à le manipuler : rotation
  // automatique, contrôles de caméra, mention de la hauteur. Une case de six
  // mètres qu'on fait tourner dans un cadre devient un bibelot, et c'est
  // exactement le contresens que ce mode évite.
  arSeul: { type: Boolean, default: false },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop } = useTts()

const mv = ref(null)
const robot = ref(null)

// Ici, exister C'EST être ouvert : la vue RA n'a pas de prop `visible`, elle est
// montée quand on la regarde. L'avatar prend donc la parole dès le montage, et
// `useGuideFocus` la rend tout seul au démontage — y compris sur un retour
// arrière, où aucune fermeture propre n'a lieu.
const { prendreLaParole } = useGuideFocus()
prendreLaParole()

// Le robot se réveille au premier geste sur la pièce. `camera-change` ne se
// déclenche que si la caméra est manipulable — donc pas en mode « RA seule »,
// où le clic reste le seul signal. On garde les deux : ils couvrent chacun un
// cas que l'autre laisse passer.
// Un geste réel sur la pièce déclenche trois choses d'un coup : le guide se
// réveille, le contexte audio se débloque (les navigateurs l'exigent), et le
// doigt reçoit la matière.
function surGeste(e) {
  const vrai = !e || e?.detail?.source === 'user-interaction'
  if (!vrai) return
  robot.value?.reveiller()
  robot.value?.noterGeste()                  // alimente la mesure du tempérament
  ambiance.debloquer()
  demarrerAmbiance()
  haptique.matiere(props.objet?.matiere)     // bridé à ~9 Hz par le service
  suivreDistance()
}

// ------------------------------------------------------- PAYSAGE SONORE -----
//
// SPATIALISATION, ET CE QU'ELLE PEUT VRAIMENT FAIRE ICI. Dans une visionneuse
// à plateau tournant, la caméra orbite autour de la pièce EN LA REGARDANT :
// l'objet reste donc toujours devant l'auditeur, et l'azimut ne change jamais.
// Prétendre le contraire serait un trucage. Ce qui change réellement, c'est la
// DISTANCE : on s'approche, le son se rapproche. C'est cela qu'on restitue.
//
// La spatialisation à la tête — tourner sur soi et entendre la source rester en
// place — n'a de sens que là où l'appareil bouge indépendamment de la scène,
// c'est-à-dire dans la session WebXR du Guide Spectral. Elle y sera branchée
// avec le reste du parcours immersif.
// L'objet caché de cette pièce, s'il en a un. On ne transmet l'objet que
// lorsqu'il est COMPLET : un mot sans récit produirait une révélation muette.
const secretDeLObjet = computed(() => {
  const m = props.objet?.secret_mot
  const r = props.objet?.secret_recit
  return m && r ? { mot: m, recit: r, indice: props.objet?.secret_indice || '' } : null
})

const ambianceCoupee = ambiance.ambianceCoupee
// La fiche déclare-t-elle une ambiance, à l'un des trois niveaux ? Sert à ne
// PAS afficher un bouton qui ne commanderait rien.
const aUneAmbiance = computed(() => !!ambiance.ambiancePour({
  objet: props.objet,
  secteur: props.objet?.sectors,
  musee: props.objet?.sectors?.museums
}))

let ambianceLancee = false
function demarrerAmbiance() {
  if (ambianceLancee) return
  const choix = ambiance.ambiancePour({
    objet: props.objet,
    secteur: props.objet?.sectors,
    musee: props.objet?.sectors?.museums
  })
  if (!choix) return
  ambianceLancee = true
  ambiance.poser(choix.url, {
    volume: choix.volume,
    spatiale: choix.spatiale,
    position: [0, 0.5, -1.4]
  })
}

function suivreDistance() {
  const el = mv.value
  if (!el?.getCameraOrbit) return
  try {
    const o = el.getCameraOrbit()
    // `radius` est en mètres dans le repère de la scène : on le reporte tel
    // quel sur l'axe de profondeur, l'objet restant au centre.
    ambiance.placer(0, 0.5, -Math.max(0.4, Number(o.radius) || 1.4))
  } catch { /* orbite indisponible : la nappe reste à sa place */ }
}

// Le guide a la priorité absolue sur l'ambiance : deux sources qui se battent,
// et le visiteur coupe le son — donc perd les deux.
watch(ttsSpeaking, (parle) => { parle ? ambiance.baisser() : ambiance.remonter() })

function basculerAmbiance() {
  ambiance.debloquer()
  demarrerAmbiance()
  ambiance.basculerCoupure()
}

// ------------------------------------------------------- MODE PHOTO POSTER --
// Le visiteur cadre la pièce comme il l'entend, appuie, et repart avec une
// affiche aux couleurs de l'institution — QR compris, pour que l'image ramène
// à la collection au lieu de circuler seule.
const posterEnCours = ref(false)
const posterMsg = ref('')

async function prendrePoster() {
  if (posterEnCours.value) return
  posterEnCours.value = true
  posterMsg.value = ''
  haptique.geste('toucher')
  try {
    const affiche = await composerPoster(mv.value, {
      titre: titre.value,
      musee: props.objet?.sectors?.museums?.nom || '',
      lien: lien.value,
      couleur: '#0e6f5c'
    })
    const issue = await offrirPoster(affiche, `musea-${(titre.value || 'oeuvre').replace(/[^\w-]+/g, '-').toLowerCase()}.png`)
    if (issue !== 'annule') { haptique.geste('succes'); posterMsg.value = t('ar.posterOk') }
    // L'adresse blob n'est plus utile une fois le fichier remis : la garder
    // retiendrait l'image entière en mémoire pour rien.
    setTimeout(() => URL.revokeObjectURL(affiche.url), 4000)
  } catch (e) {
    haptique.geste('erreur')
    // On NOMME la cause quand on la connaît. « texture-non-cors » n'est pas une
    // panne mystérieuse : c'est un modèle servi sans en-tête CORS, et le
    // conservateur peut le corriger.
    posterMsg.value = e?.message === 'texture-non-cors' ? t('ar.posterCors') : t('ar.posterKo')
  } finally {
    posterEnCours.value = false
  }
}

function basculerNuit() {
  nuitAuMusee.value = !nuitAuMusee.value
  haptique.geste('toucher')
}

const arPossible = ref(null) // null = on ne sait pas encore
const charge = ref(false)
const statut = ref('')
const dimensions = ref(null)
const erreur = ref('')

// Modèle réellement affiché : celui de l'objet s'il existe, sinon la pièce de
// démonstration générée en mémoire. Une URL `blob:` héritée d'une ancienne
// version de l'ERP ne survit pas au rechargement : on la traite comme absente.
const modeleReel = computed(() => {
  const m = props.objet?.model3d || ''
  return m && !m.startsWith('blob:') ? m : ''
})
const demo = computed(() => !modeleReel.value)
const src = computed(() => modeleReel.value || demoModelUrl(props.variante))
const titre = computed(() => props.objet?.nom || demoModelInfo(props.variante).nom)

// iOS ne lit QUE le .usdz : sans lui, Quick Look refuse et le bouton RA ne
// s'affiche pas sur iPhone, quel que soit l'hébergement.
const srcIos = computed(() => {
  const u = props.objet?.model3d_ios || ''
  return u && !u.startsWith('blob:') ? u : ''
})
// Un tabouret se pose au sol, un masque s'accroche au mur. Sans cette
// distinction, model-viewer suppose le sol et couche les masques par terre.
const placement = computed(() => (props.objet?.ar_placement === 'wall' ? 'wall' : 'floor'))
// Correctif d'unité : un scan exporté en centimètres arriverait cent fois trop grand.
const echelle = computed(() => {
  const e = Number(props.objet?.ar_echelle)
  return Number.isFinite(e) && e > 0 ? e : 1
})
const echelleAttr = computed(() => `${echelle.value} ${echelle.value} ${echelle.value}`)

const hauteurCm = computed(() => {
  if (dimensions.value) return Math.round(dimensions.value.y * 100)
  return demo.value ? Math.round(demoModelInfo(props.variante).hauteur * 100) : null
})

// ------------------------------------------------------- réglages d'immersion
//
// Ils viennent tous de la fiche de l'objet (migration `ar_reglages_immersifs`)
// et retombent sur des valeurs par défaut si la colonne est vide ou si l'on
// regarde la pièce de démonstration. Le principe est celui du §8 de la recette :
// on ne calibre pas une ombre en redéployant. Un masque et une case n'ont pas
// le même contraste, et le bon réglage se trouve en regardant, sur un vrai
// téléphone, pas en raisonnant.
function reglage(cle, defaut) {
  const v = props.objet?.[cle]
  return v === null || v === undefined || v === '' ? defaut : v
}
const nombre = (cle, defaut) => {
  const n = Number(reglage(cle, defaut))
  return Number.isFinite(n) ? n : defaut
}

// L'ÉCHELLE, ET CE QU'ELLE ENGAGE.
//   fixed — l'objet apparaît à sa TAILLE RÉELLE et ne se redimensionne pas.
//           Pour une case obus, c'est le sujet même : on doit reculer pour la
//           voir entière, comme dans une cour. La rendre pinçable la ramènerait
//           au rang de maquette.
//   auto  — Scene Viewer pose l'objet à une taille commode et laisse pincer.
//           C'est ce qu'il faut pour un tabouret ou un masque, qu'on retourne.
// Le choix est donc porté par la FICHE, pas par le composant : c'est la seule
// façon que les deux cohabitent sans que l'un abîme l'autre.
const arScale = computed(() => (reglage('ar_scale', 'auto') === 'fixed' ? 'fixed' : 'auto'))

// Estimation de lumière réelle (WebXR). Principal facteur de crédibilité : sans
// elle, un objet correctement posé garde l'air d'un autocollant. Débrayable par
// objet, car c'est aussi une surface d'échec de plus sur un WebXR capricieux.
const xrEnv = computed(() => reglage('ar_xr_environment', true) !== false)

// ------------------------------------------------------- LUMIÈRE ADAPTATIVE --
// Les trois réglages d'éclairage ne sortent plus directement de la fiche : ils
// la traversent d'abord. Le moment de la journée chez LE VISITEUR module ce que
// le conservateur a posé — les deux se composent au lieu de s'écraser. Voir
// `services/lumiere.js` pour le détail des moments.
const nuitAuMusee = ref(false)
const momentActuel = ref('')
const tictac = ref(0)              // forcé à changer au passage d'un moment à l'autre

const lumiere = computed(() => {
  tictac.value                     // dépendance explicite : sans elle, pas de recalcul
  return reglagesLumiere({
    auto: reglage('lumiere_auto', true) !== false,
    nuit: nuitAuMusee.value,
    base: {
      exposure: nombre('ar_exposure', 1.05),
      ombre: nombre('ar_shadow_intensity', 1.4),
      douceur: nombre('ar_shadow_softness', 0.9)
    }
  })
})

const ombreForce = computed(() => lumiere.value.ombre)
const ombreDouceur = computed(() => lumiere.value.douceur)
const exposition = computed(() => lumiere.value.exposure)
const inertie = computed(() => nombre('ar_interpolation_decay', 200))
const orbite = computed(() => reglage('ar_camera_orbit', '0deg 75deg 105%'))
const orbiteMin = computed(() => reglage('ar_min_orbit', 'auto auto 60%'))
const orbiteMax = computed(() => reglage('ar_max_orbit', 'auto auto 180%'))

// L'affiche évite le carré noir pendant le téléchargement — un .glb de plusieurs
// mégaoctets en 4G, c'est plusieurs secondes de vide. On réutilise la photo de
// l'objet : elle existe déjà, elle est à la bonne échelle, et elle montre
// exactement ce qui va apparaître.
const affiche = computed(() => {
  const p = props.objet?.photo || ''
  return p && !p.startsWith('blob:') ? p : ''
})

// ANNOTATIONS ancrées dans le maillage. `normal` n'est pas décoratif : c'est lui
// qui permet à model-viewer de MASQUER un point passé derrière l'objet. Sans
// lui, les points d'une face cachée flottent par-dessus et le volume s'effondre.
const annotations = computed(() => {
  const a = props.objet?.ar_annotations
  const liste = Array.isArray(a) ? a : []
  return liste
    .filter((p) => p && typeof p.position === 'string')
    .slice(0, 12)                       // au-delà, la pièce disparaît sous les pastilles
    .map((p, i) => ({
      cle: `db-${i}`,
      position: p.position,
      normal: typeof p.normal === 'string' ? p.normal : '0 1 0',
      titre: p.titre || p.texte || ''
    }))
})

const lien = computed(() => {
  if (props.lienMobile) return props.lienMobile
  if (typeof window === 'undefined') return ''
  return window.location.href
})
// Sur un poste de développement, l'adresse est en localhost : un téléphone ne
// la joindra pas. On le dit plutôt que de laisser le jury scanner dans le vide.
const lienLocal = computed(() => /localhost|127\.0\.0\.1/.test(lien.value))

// Le QR n'a de sens que sur un ORDINATEUR : afficher un code à scanner sur un
// téléphone qui est déjà la bonne machine serait absurde. Quand la RA échoue sur
// un mobile, la cause est presque toujours l'une des deux ci-dessous, et le
// visiteur mérite qu'on la lui nomme.
const surMobile = computed(() =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 820)
)
const surIos = computed(() =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
)
const nonSecurise = computed(() =>
  typeof window !== 'undefined' && !window.isSecureContext
)
const qr = computed(() => {
  try { return qrSvg(lien.value, { size: 190 }) } catch { return '' }
})

// ---------------------------------------------------------------- cycle ----
let poll = null
async function detecter() {
  const el = mv.value
  if (!el) return
  try { await customElements.whenDefined('model-viewer') } catch { /* ignore */ }
  // `canActivateAR` n'est fiable qu'une fois le composant initialisé : on
  // interroge quelques fois plutôt que de trancher trop tôt et d'afficher un QR
  // à un visiteur qui, lui, pourrait très bien lancer la RA.
  let essais = 0
  poll = setInterval(() => {
    if (!mv.value) return
    const ok = mv.value.canActivateAR
    if (ok || ++essais > 12) {
      arPossible.value = !!ok
      clearInterval(poll)
      poll = null
    }
  }, 250)
}

// ---------------------------------------------------- chargement du modèle ---
//
// TROIS MÉCANISMES POUR UNE SEULE QUESTION : « est-ce chargé ? ». Ce n'est pas
// de la ceinture-bretelles, chacun rattrape un cas que les autres laissent
// passer, et sans eux la vue reste bloquée sur son tourniquet.
//
//  1. L'ÉVÉNEMENT `load` — le cas nominal.
//  2. LA SONDE — `load` n'est jamais émis si le modèle était DÉJÀ en cache au
//     moment où l'on s'abonne. On interroge donc `loaded` par intervalle : le
//     visiteur qui revient sur une fiche est précisément celui qui a le modèle
//     en cache, et c'est lui qui restait devant un spinner éternel.
//  3. LE DÉLAI DE GARDE — un .glb de plusieurs mégaoctets sur un réseau lent
//     peut échouer SANS émettre `error`. Au bout de 90 s, on tranche et on
//     propose autre chose plutôt que de faire attendre indéfiniment.
const progression = ref(0)
let sonde = null
let garde = null

function arreterSurveillance() {
  if (sonde) { clearInterval(sonde); sonde = null }
  if (garde) { clearTimeout(garde); garde = null }
}

function onLoad() {
  if (charge.value) return
  charge.value = true
  erreur.value = ''
  progression.value = 100
  arreterSurveillance()
  try { dimensions.value = mv.value?.getDimensions?.() || null } catch { dimensions.value = null }
}
function onError() {
  erreur.value = t('ar.loadFailed')
  charge.value = true
  arreterSurveillance()
}
function onProgress(e) {
  const p = Number(e?.detail?.totalProgress)
  if (Number.isFinite(p)) progression.value = Math.round(p * 100)
}

function surveillerChargement() {
  arreterSurveillance()
  sonde = setInterval(() => {
    const el = mv.value
    if (el && (el.loaded || el.model)) onLoad()
  }, 250)
  garde = setTimeout(() => {
    if (!charge.value) { erreur.value = t('ar.loadTimeout'); charge.value = true }
    arreterSurveillance()
  }, 90000)
}
function onArStatus(e) {
  statut.value = e?.detail?.status || ''
  // L'ancrage réussi est L'ÉVÉNEMENT du parcours — la pièce vient d'apparaître
  // dans la vraie pièce. Il mérite sa vibration, et elle passe outre
  // l'intervalle de sobriété du service.
  if (statut.value === 'object-placed' || statut.value === 'session-started') {
    haptique.geste('poser')
  }
}

// LANCEMENT — trois niveaux, du plus propre au plus brutal.
//
// `activateAR()` suffit dans le cas nominal. Mais sur un Android capricieux —
// version de Chrome ancienne, Services Google Play pour la RA en cours de mise
// à jour, WebView intégrée à une autre application — il échoue en silence, et
// le visiteur reste devant un bouton qui ne fait rien.
//
// D'où les deux recours. Le clic direct dans le `shadowRoot` contourne un
// model-viewer mal initialisé. L'`intent://` contourne model-viewer TOUT COURT
// et s'adresse à Scene Viewer, l'application de Google, en lui passant l'URL du
// modèle ; `S.browser_fallback_url` ramène le visiteur ici si l'application
// manque. Sur iPhone, on ouvre simplement le .usdz : c'est Quick Look qui prend.
async function lancerAr() {
  const el = mv.value
  erreur.value = ''
  try {
    if (el && typeof el.activateAR === 'function') { await el.activateAR(); return }
    // Le bouton projeté d'ABORD. Comme cette vue en fournit un (`slot="ar-button"`),
    // model-viewer n'en crée pas dans son `shadowRoot` : n'y chercher que là,
    // comme le fait le projet de référence, ne trouve jamais rien. On garde
    // quand même la recherche interne, pour le jour où le slot disparaîtra.
    const bouton =
      el?.querySelector('[slot="ar-button"]') ||
      el?.shadowRoot?.querySelector('[slot="ar-button"], button[part="default-ar-button"]')
    if (bouton) { bouton.click(); return }
    throw new Error('activateAR indisponible')
  } catch {
    if (surIos.value && srcIos.value) { window.location.href = srcIos.value; return }
    if (/Android/.test(navigator.userAgent) && src.value) {
      const retour = encodeURIComponent(window.location.href)
      // ABSOLUE, impérativement. Le modèle est référencé en chemin relatif —
      // c'est ce qui le garde sur l'origine de la page, donc hors CORS, quel
      // que soit le sous-domaine du locataire. Mais Scene Viewer est une
      // application Android distincte : elle n'a aucune page contre laquelle
      // résoudre « /modeles/… » et n'irait nulle part. On résout ici.
      const fichier = new URL(src.value, window.location.href).href
      window.location.href =
        `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(fichier)}` +
        `&mode=ar_preferred#Intent;scheme=https;` +
        `package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;` +
        `S.browser_fallback_url=${retour};end;`
      return
    }
    erreur.value = t('ar.launchFailed')
  }
}

// ---------------------------------------------------------------------------
// Panneau de préparation — trois étapes avant d'ouvrir la caméra
// ---------------------------------------------------------------------------
// Le bouton n'ouvre pas la caméra : il explique d'abord. Deux raisons, et la
// seconde compte plus que la première.
//
//  1. Un visiteur qui ignore qu'il doit BALAYER LE SOL pointe son téléphone
//     vers un mur, ne voit rien apparaître, et conclut que c'est cassé. La
//     détection de plan demande deux ou trois secondes de mouvement : c'est la
//     seule chose qu'il faut lui dire, et personne ne la devine.
//  2. Le diagnostic ne peut se dire QUE là. Sur un iPhone sans .usdz, la RA est
//     impossible ; le panneau le nomme, au lieu d'un bouton qui ne répond pas.
const guide = ref(false)
function ouvrirGuide() { erreur.value = ''; guide.value = true }
function fermerGuide() { guide.value = false }
function lancerDepuisGuide() {
  // On referme AVANT de lancer : le geste du visiteur est encore valide, et
  // model-viewer n'aime pas s'ouvrir sous une superposition.
  guide.value = false
  lancerAr()
}

// Ce qui empêchera la RA, su AVANT d'appuyer.
const empechementAr = computed(() => {
  if (nonSecurise.value) return 'https'
  if (!surMobile.value) return 'ordinateur'
  if (surIos.value && !srcIos.value) return 'ios'
  return ''
})

function raconter() {
  if (ttsSpeaking.value) { ttsStop(); return }
  const o = props.objet
  const texte = [
    titre.value,
    o?.description || (demo.value ? t('ar.demoStory') : ''),
    hauteurCm.value ? t('ar.spokenHeight', { n: hauteurCm.value }) : ''
  ].filter(Boolean).join('. ')
  ttsSpeak(texte, { lang: 'fr' })
}

// Cette vue EXISTE pour montrer un modele : le charger des son montage est
// justifie, contrairement au chargement global qui frappait toutes les pages.
// Un seul minuteur, reprogrammé à chaque bascule, plutôt qu'un sondage de
// l'heure en boucle. Une visite peut durer assez longtemps pour traverser un
// changement de lumière — et c'est un joli détail quand cela arrive tout seul.
let minuteurMoment = null
function programmerMoment() {
  clearTimeout(minuteurMoment)
  momentActuel.value = lumiere.value.moment
  minuteurMoment = setTimeout(() => {
    tictac.value++            // force le recalcul de `lumiere`
    programmerMoment()
  }, Math.min(msAvantProchainMoment() + 1000, 2147483000))
}

onMounted(() => {
  chargerModelViewer().catch(() => {})
  nextTick(detecter)
  surveillerChargement()
  programmerMoment()
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  clearTimeout(minuteurMoment)
  arreterSurveillance()
  ttsStop()
  // La nappe sonore ne doit JAMAIS survivre à la vue : une ambiance de forêt
  // qui continue sur la page suivante est le genre de détail qui fait fermer
  // l'onglet.
  ambiance.arreter()
  haptique.stopper()
})
watch(() => props.objet?.id, () => {
  charge.value = false
  dimensions.value = null
  erreur.value = ''
  progression.value = 0
  surveillerChargement()          // nouveau modèle, nouvelle surveillance
})
</script>

<template>
  <div class="arv" :class="{ 'arv--compact': compact }">
    <div class="arv__stage">
      <!-- RÉGLAGES RA.
           · ar-modes : SCENE VIEWER d'ABORD. C'est l'application de Google,
             adossée à ARCore : sur Android elle est plus stable que WebXR et
             surtout mieux éclairée. WebXR reste en second — il ne sert que là où
             Scene Viewer manque — et Quick Look récupère iOS de lui-même.
           · ar-scale : porté par la FICHE (`ar_scale`), pas écrit ici. `fixed`
             pose l'objet à sa taille réelle et interdit le pincement : c'est
             tout le propos d'une architecture, où l'on doit reculer pour voir.
             `auto` reste le bon choix pour un objet de main. Voir `arScale`.
           · xr-environment : estimation de la lumière RÉELLE de la pièce. C'est
             le principal facteur de crédibilité ; débrayable par objet, car
             c'est aussi une surface d'échec de plus en WebXR.
           · interaction-prompt="none" : la main animée de model-viewer passe
             par-dessus la pièce et fait « démo ». La rotation lente suffit à
             faire comprendre qu'on peut toucher. -->
      <model-viewer
        ref="mv"
        :src="src"
        :alt="titre"
        :poster="affiche || undefined"
        :camera-controls="arSeul ? undefined : true"
        :auto-rotate="arSeul ? undefined : true"
        auto-rotate-delay="2500"
        rotation-per-second="14deg"
        interaction-prompt="none"
        :camera-orbit="orbite"
        :min-camera-orbit="orbiteMin"
        :max-camera-orbit="orbiteMax"
        :interpolation-decay="inertie"
        :ios-src="srcIos || undefined"
        :ar-placement="placement"
        :ar-scale="arScale"
        :xr-environment="xrEnv || undefined"
        :scale="echelleAttr"
        ar
        ar-modes="scene-viewer webxr quick-look"
        loading="eager"
        reveal="auto"
        :shadow-intensity="ombreForce"
        :shadow-softness="ombreDouceur"
        :exposure="exposition"
        environment-image="neutral"
        touch-action="pan-y"
        class="arv__mv"
        @click="robot?.reveiller()"
        @camera-change="surGeste"
        @load="onLoad"
        @error="onError"
        @progress="onProgress"
        @ar-status="onArStatus"
      >
        <!-- ANNOTATIONS DE LA FICHE — relevées dans Blender, ou par
             `positionAndNormalFromPoint()` en cliquant sur le maillage.
             `data-visibility-attribute="visible"` demande à model-viewer de
             marquer lui-même les points qui passent DERRIÈRE l'objet : c'est ce
             qui les fait disparaître au lieu de flotter par-dessus. -->
        <button
          v-for="p in annotations"
          :key="p.cle"
          :slot="`hotspot-${p.cle}`"
          class="arv__pin"
          :data-position="p.position"
          :data-normal="p.normal"
          data-visibility-attribute="visible"
        >
          <span>{{ p.titre }}</span>
        </button>

        <!-- Repères de la pièce de démonstration : on ne les pose que faute
             d'annotations propres, et jamais sur un vrai modèle dont on ignore
             la géométrie. -->
        <template v-if="demo && !annotations.length">
          <button slot="hotspot-1" class="arv__pin" data-position="0 0.52 0" data-normal="0 1 0"
                  data-visibility-attribute="visible">
            <span>{{ $t('ar.pinSeat') }}</span>
          </button>
          <button slot="hotspot-2" class="arv__pin" data-position="0.09 0.24 0" data-normal="1 0 0"
                  data-visibility-attribute="visible">
            <span>{{ $t('ar.pinShaft') }}</span>
          </button>
        </template>

        <button slot="ar-button" class="arv__arbtn">
          <i class="pi pi-mobile" /> {{ $t('ar.launch') }}
        </button>

        <!-- Une progression CHIFFRÉE, pas un tourniquet. Sur un modèle de
             plusieurs mégaoctets en 4G, « 38 % » dit qu'il se passe quelque
             chose ; un rond qui tourne dit seulement qu'on attend. -->
        <div slot="progress-bar" class="arv__load" :class="{ on: !charge }">
          <i class="pi pi-spin pi-spinner" />
          <span>{{ progression > 0 ? $t('ar.loadingPct', { n: progression }) : $t('ar.loading') }}</span>
          <span class="arv__bar"><i :style="{ width: progression + '%' }" /></span>
        </div>
      </model-viewer>

      <span v-if="hauteurCm && !arSeul" class="arv__scale">
        <i class="pi pi-arrows-v" /> {{ $t('ar.realHeight', { n: hauteurCm }) }}
      </span>
      <span v-if="demo" class="arv__demo"><i class="pi pi-info-circle" /> {{ $t('ar.demoModel') }}</span>
      <ObjectGuideRobot
        ref="robot"
        :objet="titre"
        :museum-id="objet?.sectors?.museum_id ?? null"
        :sector-id="objet?.sector_id ?? null"
        :secret="secretDeLObjet"
        :object-id="objet?.id ?? null"
        :tenant-id="objet?.tenant_id ?? null"
        auto
      />

      <button v-if="compact" class="arv__x" :aria-label="$t('common.close')" @click="emit('close')">
        <i class="pi pi-times" />
      </button>
    </div>

    <div class="arv__side">
      <span class="arv__over">{{ $t('ar.over') }}</span>
      <h2>{{ titre }}</h2>
      <p class="arv__lead">{{ arSeul ? $t('ar.leadArOnly') : $t('ar.lead') }}</p>

      <!-- Chemin d'accès à la RA : soit on la lance, soit on passe au téléphone -->
      <!-- Le bouton reste offert même quand l'appareil ne suivra pas : c'est le
           panneau qui explique. Le masquer rendait le diagnostic inatteignable. -->
      <!-- Le bouton LANCE, il n'explique plus d'abord — comme dans le projet de
           référence. Un écran intercalé entre le geste du visiteur et la caméra
           coûte un tap, et surtout fait perdre l'activation par geste que
           certains Android exigent pour ouvrir Scene Viewer. Le conseil de
           balayage reste, en dessous, et le détail derrière un lien. -->
      <div v-if="arPossible === true || surMobile" class="arv__go">
        <button class="ps-btn" @click="lancerAr">
          <i class="pi pi-mobile" /> {{ $t('ar.launch') }}
        </button>
        <small>{{ $t('ar.launchHint') }}</small>
        <button class="arv__aide" type="button" @click="ouvrirGuide">
          <i class="pi pi-question-circle" /> {{ $t('ar.guideTitre') }}
        </button>
      </div>

      <!-- Sur ordinateur : on passe la main au téléphone par un QR. -->
      <div v-else-if="!surMobile" class="arv__qr">
        <div class="arv__qrimg" v-html="qr" />
        <div class="arv__qrtxt">
          <strong>{{ $t('ar.qrTitle') }}</strong>
          <span>{{ $t('ar.qrText') }}</span>
          <small v-if="lienLocal" class="arv__warn"><i class="pi pi-exclamation-triangle" /> {{ $t('ar.qrLocalhost') }}</small>
          <code v-else>{{ lien }}</code>
        </div>
      </div>

      <!-- Sur téléphone : on nomme la raison du refus au lieu d'un QR inutile. -->
      <div v-else-if="arPossible === false" class="arv__nope">
        <i class="pi pi-info-circle" />
        <div>
          <strong>{{ $t('ar.unavailable') }}</strong>
          <span v-if="nonSecurise">{{ $t('ar.needHttps') }}</span>
          <span v-else-if="surIos && !srcIos">{{ $t('ar.needIos') }}</span>
          <span v-else-if="surIos">{{ $t('ar.needIosOther') }}</span>
          <span v-else>{{ $t('ar.needArcore') }}</span>
        </div>
      </div>

      <p v-else class="arv__checking"><i class="pi pi-spin pi-spinner" /> {{ $t('ar.checking') }}</p>

      <div class="arv__actions">
        <button class="ps-btn ps-btn--sm ps-btn--line" @click="raconter">
          <i :class="ttsSpeaking ? 'pi pi-stop' : 'pi pi-volume-up'" />
          {{ ttsSpeaking ? $t('tour.stopGuide') : $t('ar.narrate') }}
        </button>

        <!-- L'ambiance ne se propose QUE si la fiche en déclare une : un bouton
             qui ne commande rien apprend au visiteur à ignorer la barre. -->
        <button
          v-if="aUneAmbiance"
          class="ps-btn ps-btn--sm ps-btn--line"
          :aria-pressed="!ambianceCoupee"
          @click="basculerAmbiance"
        >
          <i :class="ambianceCoupee ? 'pi pi-volume-off' : 'pi pi-headphones'" />
          {{ ambianceCoupee ? $t('ar.ambienceOff') : $t('ar.ambienceOn') }}
        </button>

        <!-- « Nuit au musée » n'est pas l'heure de nuit : c'est une mise en
             scène, plus sombre et plus contrastée. On la propose, jamais on ne
             l'impose. -->
        <button
          class="ps-btn ps-btn--sm ps-btn--line"
          :aria-pressed="nuitAuMusee"
          @click="basculerNuit"
        >
          <i :class="nuitAuMusee ? 'pi pi-sun' : 'pi pi-moon'" />
          {{ nuitAuMusee ? $t('ar.dayMode') : $t('ar.nightMode') }}
        </button>
        <!-- Repartir avec une image : c'est ce qui circule quand la visite,
             elle, ne circule pas. -->
        <button class="ps-btn ps-btn--sm ps-btn--line" :disabled="posterEnCours || !charge" @click="prendrePoster">
          <i :class="posterEnCours ? 'pi pi-spin pi-spinner' : 'pi pi-camera'" />
          {{ $t('ar.poster') }}
        </button>
        <slot name="actions" />
      </div>

      <p v-if="statut === 'session-started'" class="arv__status"><i class="pi pi-check-circle" /> {{ $t('ar.statusStarted') }}</p>
      <p v-else-if="statut === 'object-placed'" class="arv__status"><i class="pi pi-check-circle" /> {{ $t('ar.statusPlaced') }}</p>
      <p v-else-if="statut === 'failed'" class="arv__status arv__status--ko"><i class="pi pi-times-circle" /> {{ $t('ar.statusFailed') }}</p>
      <p v-if="erreur" class="arv__status arv__status--ko"><i class="pi pi-times-circle" /> {{ erreur }}</p>
      <p v-if="posterMsg" class="arv__status"><i class="pi pi-camera" /> {{ posterMsg }}</p>

      <slot />
    </div>

    <!-- ===================== Panneau de préparation ===================== -->
    <div v-if="guide" class="arg" role="dialog" aria-modal="true">
      <div class="arg__carte">
        <button class="arg__x" :aria-label="$t('common.close')" @click="fermerGuide">
          <i class="pi pi-times" />
        </button>
        <h3>{{ $t('ar.guideTitre') }}</h3>

        <p v-if="empechementAr" class="arg__alerte">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ $t(`ar.guideEmpeche.${empechementAr}`) }}</span>
        </p>

        <template v-else>
          <ol class="arg__etapes">
            <li>
              <span>1</span>
              <div><strong>{{ $t('ar.guide1') }}</strong><small>{{ $t('ar.guide1Sous') }}</small></div>
            </li>
            <li>
              <span>2</span>
              <div><strong>{{ $t('ar.guide2') }}</strong><small>{{ $t('ar.guide2Sous') }}</small></div>
            </li>
            <li>
              <span>3</span>
              <div><strong>{{ $t('ar.guide3') }}</strong><small>{{ $t('ar.guide3Sous') }}</small></div>
            </li>
          </ol>
          <button class="ps-btn arg__go" @click="lancerDepuisGuide">
            <i class="pi pi-video" /> {{ $t('ar.guideLancer') }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- Panneau de préparation -------------------------------------------- */
.arg { position: fixed; inset: 0; z-index: 60; display: flex;
  align-items: center; justify-content: center; padding: 1rem;
  background: rgba(0, 0, 0, .55); backdrop-filter: blur(3px); }
.arg__carte { position: relative; width: 100%; max-width: 23rem;
  padding: 1.4rem 1.25rem 1.25rem; border-radius: 1rem; background: #fff; color: #14181a;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .3); }
.arg__carte h3 { margin: 0 0 1rem; font-size: 1.12rem; }
.arg__x { position: absolute; top: .6rem; right: .6rem; width: 2rem; height: 2rem;
  border: 0; border-radius: 50%; background: rgba(0, 0, 0, .06); cursor: pointer; }
.arg__etapes { list-style: none; margin: 0 0 1.1rem; padding: 0;
  display: flex; flex-direction: column; gap: .55rem; }
.arg__etapes li { display: flex; gap: .75rem; align-items: flex-start;
  padding: .7rem .8rem; border-radius: .6rem; background: rgba(0, 0, 0, .04); }
.arg__etapes span { flex: 0 0 1.9rem; height: 1.9rem; display: grid; place-items: center;
  border-radius: 50%; background: rgba(11, 107, 75, .14); color: #0b6b4b; font-weight: 700; }
.arg__etapes strong { display: block; font-size: .95rem; }
.arg__etapes small { color: rgba(0, 0, 0, .6); line-height: 1.4; }
.arg__alerte { display: flex; gap: .6rem; align-items: flex-start; margin: 0 0 1rem;
  padding: .8rem .9rem; border-radius: .6rem;
  background: rgba(179, 38, 30, .08); color: #8c1d18; line-height: 1.45; }
.arg__go { width: 100%; justify-content: center; }

.arv { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 1.6rem; align-items: stretch; }
@media (max-width: 900px) { .arv { grid-template-columns: 1fr; } }

.arv__stage { position: relative; border-radius: 14px; overflow: hidden; background: #17171a; min-height: 380px; }
.arv--compact .arv__stage { min-height: 320px; }
.arv__mv { width: 100%; height: 100%; min-height: inherit; background: radial-gradient(circle at 50% 62%, #2b2b31 0%, #131316 72%); --poster-color: transparent; }

.arv__arbtn {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  border: none; background: var(--gold, #c9a227); color: #14140f;
  font-weight: 800; font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 0.62rem 1.15rem; border-radius: 999px; cursor: pointer;
  display: flex; align-items: center; gap: 0.45rem;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
}
.arv__pin {
  border: 2px solid #fff; background: rgba(20, 20, 15, 0.72); color: #fff;
  width: 22px; height: 22px; border-radius: 50%; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
}
.arv__pin span {
  position: absolute; left: 26px; top: 50%; transform: translateY(-50%);
  white-space: nowrap; font-size: 0.72rem; font-weight: 700;
  background: rgba(20, 20, 15, 0.82); padding: 0.22rem 0.55rem; border-radius: 999px;
  opacity: 0; transition: opacity 0.18s ease; pointer-events: none;
}
.arv__pin:hover span, .arv__pin:focus-visible span { opacity: 1; }

.arv__load { display: none; align-items: center; gap: 0.5rem; color: #cfc9bd; font-size: 0.85rem; }
.arv__load.on { display: flex; }
/* La barre double le pourcentage écrit : le chiffre dit où l'on en est, la
   barre dit s'il avance encore. Un téléchargement bloqué à 38 % ne se distingue
   d'un téléchargement lent que si l'on voit la progression s'arrêter. */
.arv__bar { position: relative; width: 8rem; height: 3px; border-radius: 2px;
  background: rgba(255, 255, 255, .16); overflow: hidden; }
.arv__bar i { position: absolute; inset: 0 auto 0 0; display: block;
  background: linear-gradient(90deg, #1a9c72, #7fe8c6); border-radius: 2px;
  transition: width .3s ease; }

.arv__scale, .arv__demo {
  position: absolute; display: inline-flex; align-items: center; gap: 0.35rem;
  background: rgba(10, 10, 8, 0.62); color: #ded9cf; font-size: 0.74rem;
  padding: 0.35rem 0.65rem; border-radius: 999px; backdrop-filter: blur(4px);
}
.arv__scale { top: 0.8rem; left: 0.8rem; }
.arv__demo { bottom: 0.8rem; left: 0.8rem; max-width: calc(100% - 1.6rem); }
.arv__scale i, .arv__demo i { color: var(--gold, #c9a227); }
.arv__x {
  position: absolute; top: 0.7rem; right: 0.7rem; width: 34px; height: 34px;
  border-radius: 50%; border: 0; cursor: pointer; background: rgba(10, 10, 8, 0.6); color: #fff;
}

/* ---------------- panneau ---------------- */
.arv__side { display: flex; flex-direction: column; }
.arv__over { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold, #c9a227); }
.arv__side h2 {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: clamp(1.4rem, 3vw, 2.1rem); line-height: 1.08; margin: 0.35rem 0 0.5rem; color: #101210;
}
.arv__lead { color: #3c403c; line-height: 1.7; margin: 0 0 1.2rem; font-size: 0.94rem; }

.arv__go { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; margin-bottom: 1.1rem; }
.arv__go small { color: #7c817b; font-size: 0.8rem; }
.arv__checking { color: #7c817b; font-size: 0.86rem; display: flex; align-items: center; gap: 0.45rem; }

/* Lien d'aide secondaire : discret, il ne doit pas concurrencer le bouton. */
.arv__aide {
  display: inline-flex; align-items: center; gap: 0.35rem;
  margin-top: 0.5rem; padding: 0; border: 0; background: none; cursor: pointer;
  font-size: 0.78rem; color: #7c817b; text-decoration: underline;
}
.arv__aide:hover { color: var(--site-primary, #0e6f5c); }

.arv__qr { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1.1rem; }
.arv__qrimg { flex: 0 0 auto; line-height: 0; border: 1px solid #e8e9e6; border-radius: 10px; padding: 6px; background: #fff; }
.arv__qrtxt { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.arv__qrtxt strong { font-size: 0.98rem; color: #101210; }
.arv__qrtxt span { font-size: 0.85rem; color: #5c615c; line-height: 1.55; }
.arv__qrtxt code { font-size: 0.72rem; color: #7c817b; word-break: break-all; }
.arv__warn { font-size: 0.76rem; color: #b4541a; line-height: 1.5; }

.arv__nope {
  display: flex; gap: 0.8rem; align-items: flex-start; margin-bottom: 1.1rem;
  background: #faf6ef; border-left: 4px solid var(--gold, #c9a227);
  padding: 0.9rem 1.05rem; border-radius: 0 10px 10px 0;
}
.arv__nope > i { color: var(--gold, #c9a227); font-size: 1.1rem; margin-top: 0.1rem; }
.arv__nope strong { display: block; font-size: 0.95rem; color: #101210; margin-bottom: 0.2rem; }
.arv__nope span { font-size: 0.85rem; color: #5c615c; line-height: 1.6; }

.arv__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: auto; padding-top: 0.6rem; }
.arv__status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: var(--site-primary, #0e6f5c); margin: 0.8rem 0 0; }
.arv__status--ko { color: #b03a2e; }
</style>
