<script setup>
import { ref, computed, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { creerMoteurSpectral, estWebXrDisponible } from './spectralEngine'
import { ETATS } from './avatarState'
import {
  chargerScene, fabriquerSelecteurRecits, precharger, estPrechargee, tracer, viderFile
} from '@/services/spectral'
import { creerConversation, signaler as signalerParole } from '@/services/spectralLive'
import { supabase } from '@/services/supabase'
import { useTts } from '@/services/tts'

// GUIDE SPECTRAL — la vue.
//
// Elle ne calcule rien de spatial : le moteur lui envoie des actions, elle les
// traduit en voix, en sous-titres et en boutons. Cette frontière est ce qui
// rend le MODE AUDIO-SEUL possible : sans casque ni WebXR, la même machine à
// états sert la même parole, déclenchée par une liste de boutons au lieu du
// regard. L'accessibilité n'est pas un repli, c'est le même chemin de code.
//
// LA PIÈCE DÉLICATE : LA FILE DE PAROLE.
//
// En direct, le guide ne reçoit pas un texte mais un RUISSEAU de phrases. On ne
// peut pas les donner d'un coup à la synthèse vocale — elle couperait la
// précédente. On les empile donc, et on n'en prononce qu'une à la fois : quand
// la voix se tait, la suivante part. Tant qu'il reste des phrases OU que le
// flux n'est pas clos, le récit n'est pas fini. Confondre « la voix s'est tue »
// et « le guide a fini » ferait repartir la machine au milieu d'un récit.
//
// Le `dom-overlay` de WebXR affiche ce gabarit PAR-DESSUS le flux caméra
// pendant la session immersive : les sous-titres restent lisibles et le bouton
// « Terminer » reste atteignable, ce qui n'a rien d'évident en réalité augmentée.

const props = defineProps({
  sceneId: { type: [String, Number], required: true },
  // Force le mode sans réalité augmentée (accessibilité, ordinateur, iPhone).
  audioSeul: { type: Boolean, default: false }
})
const emit = defineEmits(['fin'])

const { t, locale } = useI18n()
const tts = useTts()

const conteneur = ref(null)
const moteur = shallowRef(null)

const donnees = ref(null)
const chargement = ref(true)
const erreur = ref('')
const progression = ref({ phase: '', valeur: 0 })

const xrDisponible = ref(false)
// Panneau de préparation : ce qui s'ouvre au premier appui, avant la caméra.
const briefing = ref(false)
const demarrage = ref(false)
const enSession = ref(false)
const etat = ref(ETATS.INACTIF)

const sousTitre = ref('')
const sousTitresActifs = ref(true)
const proposition = ref(null)
const viseeProgression = ref(0)
const viseeLibelle = ref('')
const ancree = ref(false)
const horsLigne = ref(false)
const prechargee = ref(false)
const preparation = ref(null)

// ---- Direct --------------------------------------------------------------
const microActif = ref(false)
const microDisponible = ref(false)
const questionSaisie = ref('')
const derniereParoleId = ref(null)     // pour le signalement
const paroleSignalee = ref(false)
const enDirect = ref(false)            // le guide improvise-t-il vraiment ?

let selecteur = () => null
let conversation = null
let reconnaissance = null

const langue = computed(() => locale.value?.slice(0, 2) || 'fr')
const modeSansAr = computed(() => props.audioSeul || !xrDisponible.value)
const hotspots = computed(() => donnees.value?.hotspots || [])
const improvise = computed(() => donnees.value?.avatar?.improvisation !== false)
const questionsOuvertes = computed(() =>
  improvise.value && donnees.value?.avatar?.questionsOuvertes !== false
)
// ---------------------------------------------------------------------------
// Diagnostic de l'appareil — dit AVANT, pas après
// ---------------------------------------------------------------------------
// Le pire écran de réalité augmentée est celui qui laisse appuyer, ouvre la
// caméra, puis échoue sans dire pourquoi. Ces trois causes couvrent la quasi-
// totalité des refus, et elles sont toutes connaissables à l'avance.
// Des CONSTANTES, pas des `computed` : ni le modèle de l'appareil ni la
// sécurité de la page ne changent pendant une visite. Un `computed` sur une
// source non réactive donne l'illusion qu'il se réévalue — il se calcule une
// fois et garde son résultat pour toujours. Mieux vaut le dire franchement.
const surMobile = typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 820)
const surIos = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const nonSecurise = typeof window !== 'undefined' && !window.isSecureContext

const empechement = computed(() => {
  if (nonSecurise) return 'https'
  // Safari n'expose pas `immersive-ar`, et aucun réglage n'y change rien : ce
  // n'est pas un manque de ce site, c'est une limite de la plateforme. Le dire
  // franchement vaut mieux qu'un bouton qui ne répond pas.
  if (surIos) return 'ios'
  if (!surMobile) return 'ordinateur'
  if (!xrDisponible.value) return 'arcore'
  return ''
})

const reflechit = computed(() => etat.value === ETATS.REFLEXION)
const ecoute = computed(() => etat.value === ETATS.ECOUTE)

// En improvisation, TOUS les points sont racontables : le texte n'existe pas
// d'avance. Sans elle, seuls ceux qui portent un récit publié — mieux vaut une
// liste courte qu'un bouton muet.
const pointsRacontables = computed(() =>
  improvise.value ? hotspots.value : hotspots.value.filter((h) => !!selecteur(h.id, 0))
)

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
onMounted(async () => {
  xrDisponible.value = await estWebXrDisponible()
  microDisponible.value = !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  try {
    const d = await chargerScene(props.sceneId)
    if (!d) { erreur.value = t('spectral.introuvable'); return }
    // Le sélecteur AVANT les données : `pointsRacontables` l'interroge dès que
    // `donnees` est posé, et un sélecteur vide viderait la liste du parcours.
    selecteur = fabriquerSelecteurRecits(d.recits, langue.value)
    // Hors ligne, l'improvisation est impossible par construction : on bascule
    // sur les textes relus sans le dire au visiteur, qui n'a pas à le savoir.
    if (d.horsLigne) d.avatar.improvisation = false
    donnees.value = d
    horsLigne.value = !!d.horsLigne
    prechargee.value = await estPrechargee(d)
    conversation = creerConversation({
      sceneId: Number(props.sceneId),
      session: crypto.randomUUID?.() || String(Date.now()),
      lang: langue.value
    })
  } catch (e) {
    erreur.value = e?.message || t('common.error')
  } finally {
    chargement.value = false
  }
})

onBeforeUnmount(() => {
  arreterMicro()
  tts.stop()
  conversation?.annuler()
  moteur.value?.arreter()
  viderFile()
})

// ---------------------------------------------------------------------------
// FILE DE PAROLE
// ---------------------------------------------------------------------------
// `flux` porte la génération en cours. Son drapeau `actif` distingue une
// génération ANTICIPÉE — lancée à 800 ms de fixation, qu'on met de côté — d'une
// génération qu'on est en train de prononcer.
let flux = null
const filePhrases = []
let premierMotDit = false

function lancerFlux({ hotspot = null, question = '' } = {}) {
  const f = {
    hotspot, question,
    phrases: [], fini: false, repli: false, actif: false,
    id: null, texte: ''
  }
  flux = f
  ;(async () => {
    try {
      for await (const evt of conversation.parler({ hotspot, question })) {
        // Un flux remplacé entre-temps ne doit plus rien alimenter : c'est ce
        // qui empêche deux récits de se superposer quand le visiteur change
        // d'avis au milieu d'une génération.
        if (flux !== f) return
        if (evt.phrase) {
          f.phrases.push(evt.phrase)
          if (f.actif) { filePhrases.push(evt.phrase); pomper() }
        } else if (evt.repli) {
          f.repli = true; f.fini = true
          if (f.actif) echouer(f)
        } else if (evt.fin) {
          f.fini = true; f.id = evt.id; f.texte = evt.texte || ''
          // Un aveu d'ignorance est une information pour le conservateur, pas
          // un incident : répété sur un même point, c'est une notice à écrire.
          if (evt.aveu) tracer(props.sceneId, 'recit', { aveu: true }, hotspot?.id ?? null)
          if (f.actif) pomper()
        }
      }
    } catch {
      f.repli = true; f.fini = true
      if (f.actif) echouer(f)
    }
  })()
  return f
}

// Le flux préparé devient celui qu'on prononce.
function activerFlux(f) {
  if (!f) return
  f.actif = true
  premierMotDit = false
  paroleSignalee.value = false
  derniereParoleId.value = null
  sousTitre.value = ''
  filePhrases.length = 0
  if (f.repli) { echouer(f); return }
  filePhrases.push(...f.phrases)
  pomper()
}

// Une seule phrase à la fois. Quand la file se vide ET que le flux est clos,
// alors seulement le récit est terminé.
function pomper() {
  if (tts.speaking.value || pisteEnCours) return
  const phrase = filePhrases.shift()
  if (!phrase) {
    if (flux?.fini && flux.actif) {
      derniereParoleId.value = flux.id
      // La conversation ne retient que ce qui a été RÉELLEMENT prononcé : une
      // génération anticipée jamais entendue ferait croire au modèle qu'il a
      // déjà parlé de ce point.
      if (flux.texte) conversation.memoriser({ hotspot: flux.hotspot, question: flux.question, texte: flux.texte })
      moteur.value?.signalerFinDeParole()
    }
    return
  }
  sousTitre.value = sousTitre.value ? `${sousTitre.value} ${phrase}` : phrase
  if (!premierMotDit) {
    premierMotDit = true
    // C'est CE signal qui referme l'attente : la machine passe de « il
    // réfléchit » à « il raconte » au premier mot réellement prononcé, pas à
    // la réception du premier octet.
    moteur.value?.signalerDebutDeParole()
  }
  dire(phrase)
}

function echouer(f) {
  enDirect.value = false
  // On ne fait pas attendre le délai de réflexion pour une panne déjà connue :
  // la machine se rabat immédiatement sur un texte relu s'il en existe un.
  moteur.value?.signalerEchecImprovisation()
  if (flux === f) flux = null
}

watch(() => tts.speaking.value, (parle, avant) => {
  if (avant && !parle) pomper()
})

// ---------------------------------------------------------------------------
// Voix
// ---------------------------------------------------------------------------
let pisteEnCours = null
function arreterPiste() {
  try { pisteEnCours?.pause() } catch { /* rien à arrêter */ }
  pisteEnCours = null
}

function dire(texte, audioUrl = null) {
  if (!texte) return
  const av = donnees.value?.avatar || {}
  if (audioUrl) { jouerPiste(audioUrl, texte); return }
  tts.speak(texte, {
    lang: langue.value,
    // `polly` n'a pas encore de voie propre : il emprunte celle d'ElevenLabs,
    // seule synthèse cloud câblée dans `tts.js`.
    provider: av.voixProvider === 'polly' ? 'elevenlabs' : av.voixProvider,
    voiceId: av.voixId || undefined,
    rate: av.debit || 0.95
  })
}

function jouerPiste(url, texte) {
  arreterPiste()
  const a = new Audio(url)
  pisteEnCours = a
  a.onended = () => { pisteEnCours = null; pomper() }
  a.onerror = () => { pisteEnCours = null; dire(texte) }
  a.play().catch(() => { pisteEnCours = null; dire(texte) })
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
// Premier appui : on N'OUVRE PAS la caméra. On explique, et on télécharge
// pendant que le visiteur lit — c'est ce temps-là qui rend l'ouverture
// instantanée au second appui, et qui préserve son geste (voir `preparer`
// dans le moteur).
function ouvrirBriefing() {
  if (!donnees.value) return
  erreur.value = ''
  briefing.value = true
  if (empechement.value) return
  try {
    const m = creerMoteurSpectral({
      conteneur: conteneur.value,
      donnees: donnees.value,
      recitPour: selecteur,
      onAction: traiterAction,
      onEtat: (a) => { etat.value = a.vers },
      onProgression: (p) => { progression.value = p }
    })
    moteur.value = m
    m.preparer().catch((e) => { erreur.value = e?.message || t('spectral.erreurSession') })
  } catch (e) {
    erreur.value = e?.message || t('spectral.erreurSession')
  }
}

async function entrer() {
  if (!donnees.value || demarrage.value) return
  erreur.value = ''
  // Le chargement du modèle précède l'ouverture de la session : sans ce témoin,
  // le visiteur appuie sur « Entrer » et attend huit méga-octets devant un
  // bouton qui n'a pas bougé.
  demarrage.value = true
  try {
    // Le moteur a été créé et le modèle chargé par le briefing. S'il ne l'a pas
    // été (appel direct), `demarrer` retombe sur `preparer` de lui-même.
    const m = moteur.value || creerMoteurSpectral({
      conteneur: conteneur.value,
      donnees: donnees.value,
      recitPour: selecteur,
      onAction: traiterAction,
      onEtat: (a) => { etat.value = a.vers },
      onProgression: (p) => { progression.value = p }
    })
    moteur.value = m
    await m.demarrer()
    briefing.value = false
    enSession.value = true
    tracer(props.sceneId, 'ancrage', { debut: true })
  } catch (e) {
    // Le refus le plus fréquent : la page n'est pas en HTTPS, ou l'accès à la
    // caméra a été refusé. Le dire précisément évite un « réessayez » dont
    // personne ne sait quoi faire.
    erreur.value = /secure|https/i.test(e?.message || '')
      ? t('spectral.erreurHttps')
      : (e?.message || t('spectral.erreurSession'))
    tracer(props.sceneId, 'echec_ancrage', { message: String(e?.message || e).slice(0, 200) })
  } finally {
    demarrage.value = false
  }
}

// Le modèle est-il là ? C'est ce qui décide si « Lancer » est offert.
const pret = computed(() => progression.value.phase === 'pret')

const messageChargement = computed(() => {
  const p = progression.value
  const pct = Math.round((p.valeur || 0) * 100)
  const quoi = p.phase === 'avatar' ? t('spectral.chargeGuide') : t('spectral.chargeCase')
  if (demarrage.value) return t('spectral.ouvertureSession')
  return p.phase === 'pret' ? t('spectral.pret') : `${quoi} ${pct} %`
})

// ---------------------------------------------------------------------------
// Actions du moteur
// ---------------------------------------------------------------------------
function traiterAction(a) {
  switch (a.type) {
    // ---- Direct ----------------------------------------------------------
    case 'preparer': {
      // Le regard se pose, la génération part — bien avant d'être validée.
      const h = hotspots.value.find((x) => x.id === a.hotspotId)
      if (h && conversation) lancerFlux({ hotspot: h })
      break
    }

    case 'annulerPreparation':
      // Le regard s'est détourné : on coupe, donc on ne paie pas.
      if (flux && !flux.actif) { conversation?.annuler(); flux = null }
      break

    case 'improviser': {
      const h = a.hotspotId != null ? hotspots.value.find((x) => x.id === a.hotspotId) : null
      enDirect.value = true
      // Le flux anticipé correspond-il à ce qu'on nous demande ? Si oui, il a
      // déjà une seconde d'avance, et c'est tout l'intérêt de l'anticipation.
      const utilisable = flux && !flux.actif && !a.question &&
        flux.hotspot?.id === a.hotspotId && !flux.question
      activerFlux(utilisable ? flux : lancerFlux({ hotspot: h, question: a.question || '' }))
      tracer(props.sceneId, 'recit', { direct: true, anticipe: !!utilisable }, a.hotspotId)
      break
    }

    case 'replier':
      enDirect.value = false
      tracer(props.sceneId, 'recit', { repli: true, secours: !!a.secours }, a.hotspotId)
      break

    case 'sansReponse':
      // Aucun texte préécrit ne répond à une question. On le dit, brièvement.
      sousTitre.value = t('spectral.sansReponse')
      premierMotDit = true
      dire(sousTitre.value)
      break

    // ---- Commun ----------------------------------------------------------
    case 'dire':
      // Voie « texte relu » : une seule phrase entière, pas de file à alimenter.
      sousTitre.value = a.texte
      premierMotDit = true
      dire(a.texte, a.audioUrl)
      if (a.kind === 'recit') tracer(props.sceneId, 'recit', { recitId: a.recitId }, a.hotspotId)
      break

    case 'taire':
      // Les TROIS voies de parole : synthèse, piste enregistrée, et la file de
      // phrases encore à venir. En oublier une laisserait le guide finir sa
      // pensée par-dessus le silence qu'on vient de lui demander.
      tts.stop()
      arreterPiste()
      filePhrases.length = 0
      if (flux?.actif) { conversation?.annuler(); flux = null }
      sousTitre.value = ''
      break

    case 'proposer': {
      // §7 — discrète : une phrase, deux boutons, et elle disparaît d'elle-même.
      proposition.value = { hotspotId: a.hotspotId, libelle: a.libelle }
      const phrase = t('spectral.proposition', { quoi: a.libelle })
      sousTitre.value = phrase
      dire(phrase)
      tracer(props.sceneId, 'proposition', {}, a.hotspotId)
      break
    }

    case 'retirerProposition':
      proposition.value = null
      break

    case 'regard': {
      viseeProgression.value = a.progression || 0
      const h = hotspots.value.find((x) => x.id === a.hotspotId)
      viseeLibelle.value = h ? h.libelle : ''
      break
    }

    case 'etat':
      if (a.vers === ETATS.SILENCE) tracer(props.sceneId, 'silence', {})
      if (a.vers === ETATS.TERMINE) {
        tracer(props.sceneId, 'fin', { motif: a.motif || 'inconnu' })
        quitter()
      }
      break

    case 'ancre':
      // Un accesseur du moteur ne serait pas réactif : la consigne d'ancrage
      // resterait affichée alors que la case est posée.
      ancree.value = true
      tracer(props.sceneId, 'ancrage', { ok: true })
      break

    case 'perf':
      // C'est le seul moyen de savoir, sur le parc réel, quels appareils n'y
      // arrivent pas. Sans cette trace, on optimise à l'aveugle.
      tracer(props.sceneId, 'perf', { palier: a.palier, msParImage: a.msParImage })
      break

    case 'session-terminee':
      enSession.value = false
      break

    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Micro et questions
// ---------------------------------------------------------------------------
// La reconnaissance vocale du navigateur est la seule disponible sans clé ni
// coût. Elle n'existe pas partout, et son comportement en session immersive
// n'est garanti nulle part : le champ de saisie reste donc offert en secours,
// et le guide reste entièrement utilisable sans micro.
function basculerMicro() {
  if (microActif.value) { arreterMicro(); return }
  const Moteur = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Moteur) return

  const r = new Moteur()
  r.lang = langue.value === 'en' ? 'en-US' : 'fr-FR'
  r.interimResults = false
  r.maxAlternatives = 1
  r.continuous = false

  r.onresult = (e) => {
    const dit = e.results?.[0]?.[0]?.transcript || ''
    if (dit.trim()) poser(dit)
  }
  // `onend` couvre aussi bien la question posée que le silence : dans les deux
  // cas le micro se referme, et la machine sort de l'écoute.
  r.onend = () => { microActif.value = false; moteur.value?.ecouter(false) }
  r.onerror = () => { microActif.value = false; moteur.value?.ecouter(false) }

  reconnaissance = r
  microActif.value = true
  // On coupe la parole du guide AVANT d'ouvrir le micro : sa propre voix serait
  // sinon la première chose que la reconnaissance entendrait.
  moteur.value?.ecouter(true)
  try { r.start() } catch { microActif.value = false; moteur.value?.ecouter(false) }
}

function arreterMicro() {
  try { reconnaissance?.stop() } catch { /* déjà arrêtée */ }
  reconnaissance = null
  microActif.value = false
  moteur.value?.ecouter(false)
}

let dernierPointSansAr = null

function poser(question) {
  const q = String(question || '').trim()
  if (!q) return
  questionSaisie.value = ''
  sousTitre.value = ''
  // En session, la question passe par la machine à états : c'est elle qui fait
  // taire le guide, le met en réflexion et ordonne la réponse.
  if (moteur.value) { moteur.value.poserQuestion(q); return }

  // Mode audio-seul : pas de moteur 3D, on s'adresse directement au service.
  if (!conversation || !questionsOuvertes.value) return
  enDirect.value = true
  const h = hotspots.value.find((x) => x.id === dernierPointSansAr) || null
  activerFlux(lancerFlux({ hotspot: h, question: q }))
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
function repondre(oui) {
  proposition.value = null
  moteur.value?.repondre(oui ? 'oui' : 'non')
}

function demanderPoint(h) {
  if (!modeSansAr.value) { moteur.value?.demanderPoint(h.id); return }

  dernierPointSansAr = h.id
  sousTitre.value = ''
  if (improvise.value && conversation) {
    enDirect.value = true
    activerFlux(lancerFlux({ hotspot: h }))
    tracer(props.sceneId, 'recit', { direct: true, mode: 'audio' }, h.id)
    return
  }
  const recit = selecteur(h.id, 0)
  if (!recit) return
  sousTitre.value = recit.texte
  premierMotDit = true
  dire(recit.texte, recit.audioUrl)
  tracer(props.sceneId, 'recit', { recitId: recit.id, mode: 'audio' }, h.id)
}

async function signalerLaParole() {
  if (!derniereParoleId.value || paroleSignalee.value) return
  paroleSignalee.value = await signalerParole(supabase, derniereParoleId.value)
}

function fermerBriefing() {
  briefing.value = false
  // Le moteur reste en mémoire avec son modèle : rouvrir le panneau ne
  // retéléchargera pas treize méga-octets.
}

function quitter() {
  briefing.value = false
  arreterMicro()
  tts.stop()
  arreterPiste()
  conversation?.annuler()
  viderFile()
  moteur.value?.arreter()
  moteur.value = null
  enSession.value = false
  emit('fin')
}

function terminer() {
  // On passe par la machine à états plutôt que de fermer sec : le visiteur a
  // droit au geste d'au revoir (§8). C'est trois secondes, et c'est la
  // différence entre une visite qui se termine et une application qu'on ferme.
  if (moteur.value) moteur.value.terminer()
  else quitter()
}

async function preparerHorsLigne() {
  preparation.value = { faits: 0, total: 1 }
  const r = await precharger(donnees.value, (p) => { preparation.value = p })
  preparation.value = null
  prechargee.value = !!r.ok
}
</script>

<template>
  <div class="sg" ref="conteneur">
    <!-- ================= Avant la session ================= -->
    <div v-if="!enSession" class="sg-accueil">
      <p v-if="chargement" class="sg-info">{{ $t('common.loading') }}</p>
      <p v-else-if="erreur" class="sg-erreur">{{ erreur }}</p>

      <template v-else-if="donnees">
        <h2 class="sg-titre">{{ donnees.scene.titre }}</h2>
        <p v-if="donnees.scene.description" class="sg-desc">{{ donnees.scene.description }}</p>

        <!-- L'emprise au sol AVANT d'entrer : la seule information qui évite au
             visiteur de poser une case de six mètres dans un couloir. -->
        <p class="sg-emprise">
          <i class="pi pi-arrows-alt" />
          {{ $t('spectral.emprise', { m: donnees.scene.empriseM, h: donnees.scene.hauteurM }) }}
        </p>
        <p v-if="improvise" class="sg-badge sg-badge--direct">
          <i class="pi pi-bolt" /> {{ $t('spectral.enDirect') }}
        </p>
        <p v-if="horsLigne" class="sg-badge">{{ $t('spectral.horsLigne') }}</p>

        <div class="sg-actions">
          <!-- LE BOUTON EST TOUJOURS LA, meme quand l'appareil ne suivra pas.
               Le masquer rendait le diagnostic inatteignable : sur un iPhone,
               `navigator.xr` n'existe pas, donc le bouton disparaissait, donc
               le visiteur n'apprenait jamais POURQUOI. C'est le panneau qui
               explique — comme le fait la fiche de reference. -->
          <button v-if="!audioSeul" class="sg-btn sg-btn--fort" @click="ouvrirBriefing">
            <i class="pi pi-sign-in" /> {{ $t('spectral.entrer') }}
          </button>

          <button v-if="!prechargee" class="sg-btn" :disabled="!!preparation" @click="preparerHorsLigne">
            <i class="pi pi-download" />
            {{ preparation
              ? $t('spectral.preparationEnCours', { n: preparation.faits, t: preparation.total })
              : $t('spectral.preparer') }}
          </button>
          <p v-else class="sg-badge sg-badge--ok">{{ $t('spectral.prete') }}</p>
        </div>

        <!-- Mode audio-seul : la visite entière, sans caméra. -->
        <section v-if="modeSansAr && pointsRacontables.length" class="sg-liste">
          <h3>{{ $t('spectral.parcours') }}</h3>
          <button v-for="h in pointsRacontables" :key="h.id" class="sg-point" @click="demanderPoint(h)">
            <i class="pi pi-volume-up" /> {{ h.libelle }}
          </button>

          <form v-if="questionsOuvertes" class="sg-question" @submit.prevent="poser(questionSaisie)">
            <input v-model="questionSaisie" type="text" :placeholder="$t('spectral.questionPlaceholder')"
                   :aria-label="$t('spectral.poserQuestion')" maxlength="400" />
            <button type="submit" class="sg-btn" :disabled="!questionSaisie.trim()">
              <i class="pi pi-send" /> <span class="sr-only">{{ $t('common.send') }}</span>
            </button>
          </form>

          <p v-if="sousTitre" class="sg-reponse" aria-live="polite">{{ sousTitre }}</p>
        </section>
      </template>
    </div>

    <!-- ================= Panneau de préparation ================= -->
    <!-- Il ne sert pas qu'à rassurer : il donne au modèle le temps d'arriver, et
         il garde le geste du visiteur intact pour l'ouverture de la caméra. -->
    <div v-if="briefing && !enSession" class="sg-brief" role="dialog" aria-modal="true">
      <div class="sg-brief__carte">
        <button class="sg-brief__x" :aria-label="$t('common.close')" @click="fermerBriefing">
          <i class="pi pi-times" />
        </button>
        <h3>{{ $t('spectral.briefTitre') }}</h3>

        <p v-if="empechement" class="sg-brief__alerte">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ $t(`spectral.empeche.${empechement}`) }}</span>
        </p>

        <template v-else>
          <ol class="sg-brief__etapes">
            <li>
              <span>1</span>
              <div>
                <strong>{{ $t('spectral.brief1') }}</strong>
                <small>{{ $t('spectral.brief1Sous') }}</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>{{ $t('spectral.brief2') }}</strong>
                <small>{{ $t('spectral.brief2Sous') }}</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>{{ $t('spectral.brief3') }}</strong>
                <small>{{ $t('spectral.brief3Sous') }}</small>
              </div>
            </li>
          </ol>

          <p class="sg-brief__place">
            <i class="pi pi-arrows-alt" />
            {{ $t('spectral.emprise', { m: donnees.scene.empriseM, h: donnees.scene.hauteurM }) }}
          </p>

          <button class="sg-btn sg-btn--fort sg-brief__go"
                  :disabled="!pret || demarrage" @click="entrer">
            <i class="pi" :class="pret && !demarrage ? 'pi-video' : 'pi-spin pi-spinner'" />
            {{ pret && !demarrage ? $t('spectral.lancer') : messageChargement }}
          </button>
          <p v-if="erreur" class="sg-erreur">{{ erreur }}</p>
        </template>
      </div>
    </div>

    <!-- ================= Pendant la session (dom-overlay) ================= -->
    <div v-else class="sg-hud">
      <!-- Anneau de visée : sans lui, le visiteur ne comprend pas pourquoi le
           guide se met soudain à parler. C'est le retour qui rend la mécanique
           du regard intelligible plutôt que magique. -->
      <div v-if="viseeProgression > 0.02" class="sg-visee">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle class="sg-visee-fond" cx="22" cy="22" r="19" />
          <circle class="sg-visee-arc" cx="22" cy="22" r="19"
                  :style="{ strokeDashoffset: 119 - 119 * viseeProgression }" />
        </svg>
        <span class="sg-visee-nom">{{ viseeLibelle }}</span>
      </div>

      <p v-if="!ancree" class="sg-consigne">{{ $t('spectral.consigneAncrage') }}</p>

      <div v-if="proposition" class="sg-proposition">
        <p>{{ $t('spectral.proposition', { quoi: proposition.libelle }) }}</p>
        <div>
          <button class="sg-btn sg-btn--fort" @click="repondre(true)">{{ $t('spectral.oui') }}</button>
          <button class="sg-btn" @click="repondre(false)">{{ $t('spectral.plusTard') }}</button>
        </div>
      </div>

      <!-- Deux états de la parole, deux retours distincts. Sans eux, le
           visiteur ne sait pas si le guide l'a entendu ou s'il a planté — et
           c'est toujours « planté » qu'on conclut. -->
      <p v-if="ecoute" class="sg-etatparole sg-etatparole--ecoute" aria-live="polite">
        <i class="pi pi-microphone" /> {{ $t('spectral.jecoute') }}
      </p>
      <p v-else-if="reflechit" class="sg-etatparole" aria-live="polite">
        <span class="sg-points" aria-hidden="true"><i /><i /><i /></span>
        {{ $t('spectral.reflechit') }}
      </p>

      <p v-if="sousTitresActifs && sousTitre" class="sg-soustitre" aria-live="polite">{{ sousTitre }}</p>

      <div class="sg-barre">
        <button class="sg-icone" :aria-pressed="sousTitresActifs"
                :title="$t('spectral.sousTitres')" @click="sousTitresActifs = !sousTitresActifs">
          <i class="pi" :class="sousTitresActifs ? 'pi-comment' : 'pi-comment-slash'" />
        </button>

        <button v-if="questionsOuvertes && microDisponible" class="sg-icone"
                :class="{ 'sg-icone--actif': microActif }" :aria-pressed="microActif"
                :title="$t('spectral.poserQuestion')" @click="basculerMicro">
          <i class="pi pi-microphone" />
        </button>

        <!-- Le signalement : le seul geste d'écriture laissé au visiteur, et ce
             qui remplace, côté public, la relecture qui n'a plus lieu avant. -->
        <button v-if="enDirect && derniereParoleId" class="sg-icone"
                :disabled="paroleSignalee" :title="$t('spectral.signaler')"
                @click="signalerLaParole">
          <i class="pi" :class="paroleSignalee ? 'pi-check' : 'pi-flag'" />
        </button>

        <button class="sg-icone sg-icone--fin" @click="terminer">
          <i class="pi pi-times" /> {{ $t('spectral.terminer') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sg { position: relative; width: 100%; min-height: 60vh; }
.sg :deep(canvas) { position: fixed; inset: 0; width: 100%; height: 100%; }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; }

.sg-accueil { padding: 1.25rem; max-width: 42rem; margin: 0 auto; }
.sg-titre { margin: 0 0 .35rem; font-size: 1.4rem; }
.sg-desc { margin: 0 0 .75rem; opacity: .85; line-height: 1.5; }
.sg-emprise { display: flex; gap: .5rem; align-items: center; font-size: .92rem; opacity: .8; }
.sg-info { opacity: .75; }
.sg-erreur { color: #b3261e; }
.sg-badge { display: inline-flex; align-items: center; gap: .35rem; padding: .2rem .55rem;
  border-radius: 999px; background: rgba(0, 0, 0, .08); font-size: .8rem; }
.sg-badge--ok { background: rgba(16, 122, 87, .14); color: #0b6b4b; }
.sg-badge--direct { background: rgba(11, 107, 75, .12); color: #0b6b4b; }

.sg-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin: 1rem 0; }
.sg-btn { display: inline-flex; align-items: center; gap: .45rem; padding: .6rem 1rem;
  border: 1px solid rgba(0, 0, 0, .18); border-radius: .6rem; background: #fff;
  font: inherit; cursor: pointer; }
.sg-btn--fort { background: #0b6b4b; border-color: #0b6b4b; color: #fff; }
.sg-btn[disabled] { opacity: .6; cursor: default; }

.sg-liste { margin-top: 1.25rem; }
.sg-liste h3 { font-size: 1rem; margin: 0 0 .5rem; }
.sg-point { display: flex; align-items: center; gap: .5rem; width: 100%; margin-bottom: .4rem;
  padding: .65rem .8rem; border: 1px solid rgba(0, 0, 0, .14); border-radius: .5rem;
  background: #fff; font: inherit; text-align: left; cursor: pointer; }

.sg-question { display: flex; gap: .5rem; margin-top: .8rem; }
.sg-question input { flex: 1; min-width: 0; padding: .6rem .75rem; font: inherit;
  border: 1px solid rgba(0, 0, 0, .2); border-radius: .5rem; }
.sg-reponse { margin-top: .9rem; padding: .8rem .9rem; border-radius: .6rem;
  background: rgba(0, 0, 0, .05); line-height: 1.55; }

/* ---- Panneau de préparation -------------------------------------------- */
.sg-brief { position: fixed; inset: 0; z-index: 50; display: flex;
  align-items: center; justify-content: center; padding: 1rem;
  background: rgba(0, 0, 0, .55); backdrop-filter: blur(3px); }
.sg-brief__carte { position: relative; width: 100%; max-width: 24rem;
  padding: 1.4rem 1.25rem 1.25rem; border-radius: 1rem; background: #fff;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .3); }
.sg-brief__carte h3 { margin: 0 0 1rem; font-size: 1.15rem; }
.sg-brief__x { position: absolute; top: .6rem; right: .6rem; width: 2rem; height: 2rem;
  border: 0; border-radius: 50%; background: rgba(0, 0, 0, .06); cursor: pointer; }

.sg-brief__etapes { list-style: none; margin: 0 0 1rem; padding: 0;
  display: flex; flex-direction: column; gap: .6rem; }
.sg-brief__etapes li { display: flex; gap: .75rem; align-items: flex-start;
  padding: .7rem .8rem; border-radius: .6rem; background: rgba(0, 0, 0, .04); }
.sg-brief__etapes span { flex: 0 0 1.9rem; height: 1.9rem; display: grid; place-items: center;
  border-radius: 50%; background: rgba(11, 107, 75, .14); color: #0b6b4b; font-weight: 700; }
.sg-brief__etapes strong { display: block; font-size: .95rem; }
.sg-brief__etapes small { color: rgba(0, 0, 0, .6); line-height: 1.4; }

.sg-brief__alerte { display: flex; gap: .6rem; align-items: flex-start; margin: 0 0 1rem;
  padding: .8rem .9rem; border-radius: .6rem;
  background: rgba(179, 38, 30, .08); color: #8c1d18; line-height: 1.45; }
.sg-brief__place { display: flex; gap: .5rem; align-items: center; margin: 0 0 1rem;
  font-size: .88rem; opacity: .8; }
.sg-brief__go { width: 100%; justify-content: center; }

/* ---- Superposition en session ------------------------------------------ */
.sg-hud { position: fixed; inset: 0; pointer-events: none;
  display: flex; flex-direction: column; justify-content: flex-end; }
.sg-hud button { pointer-events: auto; }

.sg-visee { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: .3rem; }
.sg-visee svg { width: 44px; height: 44px; }
.sg-visee circle { fill: none; stroke-width: 3; }
.sg-visee-fond { stroke: rgba(255, 255, 255, .35); }
.sg-visee-arc { stroke: #9fe8d4; stroke-linecap: round; stroke-dasharray: 119;
  transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .1s linear; }
.sg-visee-nom { font-size: .78rem; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, .8); }

.sg-consigne, .sg-soustitre { margin: 0 1rem .75rem; padding: .6rem .85rem;
  border-radius: .6rem; background: rgba(0, 0, 0, .62); color: #fff;
  font-size: 1.02rem; line-height: 1.45; text-align: center; }
.sg-soustitre { max-height: 30vh; overflow-y: auto; pointer-events: auto; }

.sg-etatparole { margin: 0 1rem .4rem; padding: .4rem .8rem; border-radius: 999px;
  background: rgba(0, 0, 0, .5); color: #cfe9df; font-size: .85rem;
  align-self: center; display: inline-flex; align-items: center; gap: .45rem; }
.sg-etatparole--ecoute { background: rgba(11, 107, 75, .85); color: #fff; }

/* Trois points qui respirent : la seule animation du gabarit, et elle a un
   rôle — dire que quelque chose se passe pendant que rien ne se voit. */
.sg-points { display: inline-flex; gap: 3px; }
.sg-points i { width: 5px; height: 5px; border-radius: 50%; background: currentColor;
  animation: sg-respire 1.1s infinite ease-in-out; }
.sg-points i:nth-child(2) { animation-delay: .15s; }
.sg-points i:nth-child(3) { animation-delay: .3s; }
@keyframes sg-respire { 0%, 60%, 100% { opacity: .3 } 30% { opacity: 1 } }

.sg-proposition { margin: 0 1rem .6rem; padding: .75rem .9rem; border-radius: .7rem;
  background: rgba(255, 255, 255, .95); pointer-events: auto; }
.sg-proposition p { margin: 0 0 .55rem; }
.sg-proposition div { display: flex; gap: .5rem; }

.sg-barre { display: flex; align-items: center; justify-content: space-between;
  gap: .5rem; padding: .6rem 1rem calc(.6rem + env(safe-area-inset-bottom)); }
.sg-icone { display: inline-flex; align-items: center; gap: .4rem; padding: .5rem .8rem;
  border: 0; border-radius: 999px; background: rgba(0, 0, 0, .62); color: #fff;
  font: inherit; cursor: pointer; }
.sg-icone--actif { background: #0b6b4b; }
.sg-icone--fin { background: rgba(179, 38, 30, .9); }
.sg-icone[disabled] { opacity: .55; cursor: default; }

@media (prefers-reduced-motion: reduce) {
  .sg-visee-arc { transition: none; }
  .sg-points i { animation: none; opacity: .7; }
}
</style>
