<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ask, askStream } from '@/services/guideAgent'
import { useTts } from '@/services/tts'
import { useRouter } from 'vue-router'
import { creerNarration, personaConteur } from '@/services/narration'
import { intentionMontrer, secretPrononce } from '@/services/intentions'
import * as bruitages from '@/services/bruitages'
import { creerEcoute, estUnEcho, estUnOrdreDeSeTaire } from '@/services/ecoute'
import { creerSessionVocale, voixTempsReelPossible } from '@/services/voixVapi'

// Un état de narration par visionneuse ouverte : deux pièces regardées à la
// suite ne partagent ni leurs branches ni les mesures de comportement.
const recit = creerNarration()

// AVATAR VOCAL DU VISUALISEUR 3D — une conversation, pas une borne.
//
// TROIS RÈGLES, ET TOUT LE FICHIER EN DÉCOULE.
//
//  1. IL N'ÉCRIT RIEN. Aucune bulle, aucun fil, aucune suggestion à cliquer. Un
//     panneau de texte posé sur une pièce en 3D détourne exactement le regard
//     qu'on cherchait à capter.
//
//  2. IL PARLE LE PREMIER. Le visiteur qui arrive devant l'œuvre est accueilli
//     tout de suite, par son nom à elle, et reçoit une invitation à répondre.
//     Attendre qu'on le sollicite, c'est demander au visiteur de deviner qu'un
//     guide existe.
//
//  3. IL ÉCOUTE EN PERMANENCE, MÊME EN PARLANT. Aucun bouton d'enregistrement,
//     et surtout aucun tour de parole : le micro ne se ferme jamais. Vous
//     l'interrompez, il se tait — comme on coupe quelqu'un dans une vraie
//     conversation.
//
// CE QUE CE FICHIER A CORRIGÉ. Sa première version fermait le micro pendant que
// le guide parlait, de peur qu'il ne s'entende lui-même. La peur était fondée,
// la parade était mauvaise : elle rendait le guide ININTERROMPABLE. On ne
// pouvait ni le corriger, ni lui dire « attends », ni changer de sujet avant
// qu'il ait fini — c'est ce qui sépare un assistant d'un répondeur.
//
// La bonne parade est l'ANNULATION D'ÉCHO du navigateur (`services/ecoute.js`),
// doublée d'un garde-fou textuel : si ce qu'on entend ressemble trop à ce que le
// guide vient de dire, c'est lui, et on l'ignore.
//
// Ce qu'il réutilise : `guideAgent.ask()` pour la parole (ancrée sur le contenu
// PUBLIÉ du locataire, avec repli local) et `useTts()` pour la voix.
//
// ACCESSIBILITÉ. Le texte prononcé est présent dans le DOM, mais dans une région
// `sr-only` : invisible à l'œil, lisible par un lecteur d'écran. « Aucun texte
// affiché » porte sur ce qu'on VOIT ; cela n'oblige pas à rendre l'avatar muet
// pour qui ne l'entend pas.

const props = defineProps({
  objet: { type: String, default: '' },      // titre de l'objet regardé
  museumId: { type: [String, Number], default: null },
  sectorId: { type: [String, Number], default: null },
  // ACCUEIL SPONTANÉ — vrai côté VISITEUR, faux côté ERP, et la distinction
  // compte. Le visiteur qui ouvre une œuvre doit être salué (règle 2). Le
  // conservateur qui vérifie un maillage dans le back-office, lui, n'a pas
  // demandé qu'une voix se déclenche et que le navigateur réclame son micro :
  // là-bas, l'avatar attend qu'on touche la pièce, comme avant.
  auto: { type: Boolean, default: false },
  // L'OBJET CACHÉ — { mot, recit, indice }, tel qu'il vient de la fiche.
  // Vide = cette œuvre n'a pas de secret, et le mécanisme reste muet.
  secret: { type: Object, default: null },
  // L'identifiant de la pièce. SANS LUI, PAS D'AGENT TEMPS RÉEL : la session
  // vocale se noue autour d'un objet précis, dont le serveur charge le dossier
  // et la mémoire du visiteur. Absent, on reste sur le guide construit à la main.
  objectId: { type: [String, Number], default: null },
  tenantId: { type: [String, Number], default: null }
})

const { t, locale } = useI18n()
const router = useRouter()
const tts = useTts()

const visible = ref(false)
const reflechit = ref(false)
const ecoute = ref(false)
const derniereParole = ref('')     // pour les lecteurs d'écran uniquement
const coupe = ref(false)
const microRefuse = ref(false)     // permission refusée, ou pas de micro du tout

// `actif` commande la boucle. Le mettre à false est le SEUL moyen d'arrêter le
// cycle écoute → réponse → écoute : sans lui, `onend` relancerait le micro même
// après la fermeture du visualiseur.
let actif = false

// Le visiteur vient-il de couper la parole au guide ? Sert au retour visuel :
// une coupure demandée ne doit pas ressembler à une panne.
const coupeParLeVisiteur = ref(false)

const langue = computed(() => locale.value?.slice(0, 2) || 'fr')
const nom = computed(() => props.objet || '')
const perimetre = computed(() => ({
  museumId: props.museumId || undefined,
  sectorId: props.sectorId || undefined
}))

// Quatre états, quatre allures. C'est le SEUL retour visuel : sans lui, le
// visiteur ne sait pas si l'avatar réfléchit, s'il l'écoute, ou s'il est mort.
const allure = computed(() => {
  if (modeTempsReel.value) {
    const e = session.value?.etat?.value
    if (e === 'parle') return 'parle'
    if (e === 'connexion' || e === 'pense') return 'pense'
    if (e === 'ecoute') return 'ecoute'
    return 'repos'
  }
  if (tts.speaking.value) return 'parle'
  if (reflechit.value) return 'pense'
  if (ecoute.value) return 'ecoute'
  return 'repos'
})

// ---------------------------------------------------------------------------
// Mémoire de la conversation
// ---------------------------------------------------------------------------
// Six tours : assez pour que « et celui-là ? » ait un référent, assez peu pour
// que la consigne reste courte. Au-delà, on paie de la latence pour un contexte
// que le visiteur lui-même a oublié.
const TOURS_MEMOIRE = 6
const fil = ref([])                // [{ role: 'visiteur' | 'guide', texte }]

function retenir(role, texte) {
  fil.value.push({ role, texte })
  if (fil.value.length > TOURS_MEMOIRE) fil.value.splice(0, fil.value.length - TOURS_MEMOIRE)
}

function transcription() {
  if (!fil.value.length) return ''
  return 'CE QUI A DÉJÀ ÉTÉ DIT :\n' + fil.value
    .map((m) => `${m.role === 'guide' ? 'Toi' : 'Le visiteur'} : ${m.texte}`)
    .join('\n')
}

// Les règles d'élocution sont rappelées à chaque tour : selon le moteur qui
// répond (Gemini, Groq, ou le repli local), une consigne posée une seule fois au
// début ne survit pas au tour suivant.
//
// LA LANGUE EN FAIT PARTIE, et ce n'est pas un détail de confort. Le prompt de
// `guide-agent` est rédigé en français, et le modèle s'y tenait : sur un site
// affiché en anglais, il répondait quand même en français. La synthèse recevait
// alors la locale de l'interface — une voix anglaise ânonnant du français. On
// exige donc la langue explicitement, à chaque tour.
// La LONGUEUR et le TON ne sont plus fixes : ils suivent le tempérament déduit
// du comportement du visiteur (voir `services/narration.js`). C'est le point
// « commentaires affectifs » — un guide qui sert le même paragraphe à celui qui
// bouscule et à celui qui contemple se trompe deux fois.
const ELOCUTION = computed(() => {
  const r = recit.reglages()
  return `Réponds en ${langue.value === 'en' ? 'anglais' : 'français'}. ` +
    'Tu PARLES, tu n’écris pas : pas de liste, pas de titre, pas de gras, pas d’emoji, ' +
    `pas de parenthèses. ${r.motsMin} à ${r.motsMax} mots — le visiteur est debout. ` +
    `${r.ton} ` +
    'Ne dis jamais que tu es une intelligence artificielle.'
})

// LES LIBELLÉS DES CHEMINS SONT TRADUITS ICI, pas dans le service.
//
// `narration.js` ne connaît que des CLÉS ('fabrication', 'ceremonie'…) et les
// mots qui permettent de les reconnaître dans une phrase. Les libellés, eux,
// sont PRONONCÉS : ils doivent suivre la langue du visiteur. Les laisser dans
// le service produisait « Would you like to follow son voyage jusqu'à
// aujourd'hui ? » — du français au milieu d'une phrase anglaise.
function libelle(cle) { return t(`narration.axes.${cle}`) }
function localiser(deux) {
  return deux ? deux.map((d) => ({ cle: d.cle, label: libelle(d.cle) })) : null
}

// MODE CONTEUR — l'objet parle de lui-même, à la première personne.
// ---------------------------------------------------------------------------
// AGENT TEMPS RÉEL (Vapi) — la voie principale quand elle est disponible
// ---------------------------------------------------------------------------
// TOUT CE QUI SUIT DANS CE FICHIER devient un REPLI quand cette voie s'ouvre :
// le détecteur d'énergie, la découpe en phrases, la synthèse du navigateur, le
// tour de parole. Vapi fait tout cela sur son propre transport, avec une voix
// neuronale et une détection de tour côté serveur.
//
// ON NE SUPPRIME PAS LE REPLI POUR AUTANT. Il sert dans trois cas qui ne sont
// pas rares : pas de clé, plus de crédit, ou un navigateur sans WebRTC. Un
// musée dont le guide se tait parce qu'une facture n'est pas passée, c'est
// exactement ce qu'on veut éviter.
const session = ref(null)
const modeTempsReel = ref(false)
const amplitudeVoix = ref(0)        // 0..1, l'énergie réelle de la voix — anime l'avatar
const motifRepli = ref('')

async function tenterTempsReel() {
  if (!voixTempsReelPossible || !props.objectId) return false
  const s = creerSessionVocale({
    objectId: Number(props.objectId),
    tenantId: props.tenantId ? Number(props.tenantId) : null,
    langue: langue.value,
    surEtat: (e) => {
      // On traduit les états de la session vers les quatre allures de l'avatar.
      if (e === 'parle') { reflechit.value = false; ecoute.value = false }
      else if (e === 'ecoute') { reflechit.value = false; ecoute.value = true }
      else if (e === 'pense' || e === 'connexion') { reflechit.value = true; ecoute.value = false }
      else { reflechit.value = false; ecoute.value = false }
    },
    surTexte: (t, deQui) => {
      if (deQui === 'objet') { derniereParole.value = t; retenir('guide', t) }
      else if (t) retenir('visiteur', t)
    },
    surFin: () => { modeTempsReel.value = false }
  })
  const r = await s.demarrer()
  if (!r.ok) {
    motifRepli.value = r.motif || 'indisponible'
    // On NOMME la cause dans la console : « credit_absent » se règle sur la
    // console xAI, « micro_refuse » chez le visiteur. Les confondre coûte une
    // demi-journée, on l'a vécu deux fois cette semaine.
    console.warn('[avatar] agent temps réel indisponible :', motifRepli.value, '— repli sur le guide local')
    return false
  }
  session.value = s
  modeTempsReel.value = true
  // L'amplitude de SA voix pilote l'avatar : c'est la seule animation de tout
  // ce composant qui suive un son réel plutôt qu'une minuterie.
  watch(s.amplitude, (v) => { amplitudeVoix.value = v })
  return true
}

// Peut-on le couper, là, maintenant ? Seulement s'il a la parole ou s'il cherche
// ses mots : un bouton d'arrêt sur un guide silencieux ne commande rien.
const peutCouper = computed(() =>
  modeTempsReel.value ? (session.value?.etat?.value === 'parle' || reflechit.value)
                      : (tts.speaking.value || reflechit.value))

const modeConteur = ref(false)
const persona = computed(() => (modeConteur.value ? personaConteur(nom.value) + ' ' : ''))

// ---------------------------------------------------------------------------
// Parole
// ---------------------------------------------------------------------------
function attendreFinDeParole(texte) {
  // On sonde plutôt qu'on n'écoute un évènement : `useTts` bascule entre la voix
  // du navigateur et la voix cloud (deux mécanismes de fin différents), et
  // n'expose qu'un état commun. C'est lui qui fait autorité.
  //
  // LE GARDE-FOU EST LA PARTIE IMPORTANTE. `speaking` passe à `true` avant même
  // que le son ne parte, et sa remise à `false` dépend d'un `onend` que rien ne
  // garantit : onglet mis en arrière-plan, synthèse coupée par le système, voix
  // cloud interrompue. Sans borne, l'attente ne finirait jamais — et comme c'est
  // elle qui rend la parole au visiteur, le guide resterait sourd pour de bon.
  // On borne donc au temps qu'il faut pour PRONONCER ce texte, avec de la marge.
  const mots = String(texte || '').split(/\s+/).filter(Boolean).length
  const plafond = Math.min(90000, Math.max(8000, mots * 520))
  return new Promise((resolve) => {
    const depart = Date.now()
    const bat = setInterval(() => {
      if (!tts.speaking.value || Date.now() - depart > plafond) { clearInterval(bat); resolve() }
    }, 150)
  })
}

/**
 * PRONONCER UNE PHRASE, et attendre qu'elle soit dite. C'est la brique du tour
 * en diffusion : on l'appelle une fois par phrase, à mesure qu'elles arrivent.
 *
 * Elle NE REMET PAS `coupeParLeVisiteur` à zéro — sans quoi la phrase suivante
 * effacerait l'interruption que la précédente venait d'enregistrer, et le guide
 * repartirait de plus belle après qu'on lui a demandé de se taire.
 */
async function prononcer(texte, langueImposee = null) {
  if (coupe.value || !texte) return
  try {
    // LA LANGUE EST DÉCIDÉE UNE FOIS PAR RÉPONSE, jamais phrase par phrase.
    //
    // C'est le bug que la diffusion avait introduit : « Bonjour ! » fait neuf
    // caractères, bien trop peu pour trancher une langue. Chaque phrase courte
    // repartait donc sur la locale de l'interface, et du français se retrouvait
    // annoncé `en-US` — la synthèse tirait alors une voix au hasard.
    const dite = langueImposee || tts.devinerLangue(texte, langue.value)
    await tts.speak(texte, { lang: dite, rate: recit.reglages().debit })
    await attendreFinDeParole(texte)
  } catch { /* la voix ne doit jamais faire échouer le tour de parole */ }
}

/** Une prise de parole ISOLÉE : le secret, un aveu d'échec, un avertissement. */
async function dire(texte) {
  coupeParLeVisiteur.value = false
  derniereParole.value = texte
  retenir('guide', texte)
  await prononcer(texte)
}

/**
 * Un tour complet : on interroge, on prononce, on rend la parole au visiteur.
 *
 * `journal` est ce qui atterrit dans `guide_questions` — la VRAIE phrase du
 * visiteur, jamais la consigne. `null` pour l'accueil : personne n'a rien
 * demandé, et une salutation dans le journal du conservateur est un faux signal.
 */
// ---------------------------------------------------------------------------
// UN TOUR DE PAROLE, EN DIFFUSION
// ---------------------------------------------------------------------------
// CE QUI CHANGE, ET POURQUOI C'EST LE PLUS SENSIBLE DE TOUT LE FICHIER.
//
// Avant, le guide attendait la réponse ENTIÈRE avant d'ouvrir la bouche : deux
// à quatre secondes de silence après chaque phrase du visiteur. Aucun réglage
// de modèle ne rattrape ce silence — il faut commencer à parler avant d'avoir
// fini de penser.
//
// LA VOIX DEVIENT LE TAMPON. On découpe le flux AUX FRONTIÈRES DE PHRASE et on
// prononce chacune dès qu'elle est complète. Pendant que la synthèse dit la
// première, le modèle écrit la deuxième. Le visiteur n'entend plus jamais le
// temps de calcul.
//
// POURQUOI À LA PHRASE, ET NON AU MOT. Prononcer les fragments tels qu'ils
// arrivent donnerait un débit haché et une intonation absurde : la synthèse a
// besoin de la phrase entière pour poser sa mélodie. La phrase est la plus
// petite unité qui sonne juste.
//
// SEUIL DE 12 CARACTÈRES : « Ah. » ou « Oui ! » en début de réponse
// produiraient une première prise de parole ridicule, aussitôt suivie d'une
// autre. On attend qu'il y ait de quoi dire.
const MIN_PHRASE = 12
let coupeFlux = null

function phrasesCompletes(tampon) {
  const sorties = []
  let reste = tampon
  let m
  while ((m = /^([\s\S]*?[.!?…])(\s+|$)/.exec(reste))) {
    const phrase = m[1].trim()
    if (phrase.length < MIN_PHRASE) break     // trop court : on attend la suite
    sorties.push(phrase)
    reste = reste.slice(m[0].length)
  }
  return { sorties, reste }
}

async function tour(consigne, journal, opts = {}) {
  if (reflechit.value) return
  reflechit.value = true
  coupeParLeVisiteur.value = false
  tts.stop()
  coupeFlux?.abort()
  const ctrl = new AbortController()
  coupeFlux = ctrl

  const file = []
  let tampon = ''
  let complet = ''
  let fini = false
  let riendit = true
  // Décidée une seule fois, dès qu'on a de quoi trancher (voir `prononcer`).
  let langueDite = null

  // Le CONSOMMATEUR tourne en parallèle du flux : il prononce ce qui est prêt
  // pendant que le reste arrive encore.
  const parler = (async () => {
    while (!ctrl.signal.aborted && (!fini || file.length)) {
      const phrase = file.shift()
      if (!phrase) { await new Promise((r) => setTimeout(r, 40)); continue }
      riendit = false
      await prononcer(phrase, langueDite || langue.value)
      // Le visiteur a coupé : on arrête TOUT, y compris le réseau. Sans cela le
      // serveur continuerait de produire une réponse que personne n'écoute.
      if (coupeParLeVisiteur.value) { ctrl.abort(); break }
    }
  })()

  try {
    for await (const evt of askStream(consigne, perimetre.value, { signal: ctrl.signal, journal })) {
      if (evt.erreur || evt.fin) break
      if (!evt.texte) continue
      tampon += evt.texte
      complet += evt.texte
      // `derniereParole` sert au garde-fou d'auto-écho : il doit connaître ce
      // qui est en train d'être dit, pas seulement ce qui a été dit.
      derniereParole.value = complet
      if (!langueDite && complet.length >= 60) langueDite = tts.devinerLangue(complet, langue.value)
      const { sorties, reste } = phrasesCompletes(tampon)
      for (const ph of sorties) file.push(ph)
      tampon = reste
    }
  } catch { /* le repli ci-dessous s'en charge */ }

  if (tampon.trim() && !ctrl.signal.aborted) file.push(tampon.trim())
  fini = true
  await parler

  if (complet.trim()) retenir('guide', complet.trim())
  // Rien n'est sorti du flux ET le visiteur n'a pas coupé : c'est une panne, et
  // le silence serait pire que l'aveu.
  if (riendit && !ctrl.signal.aborted && !coupeParLeVisiteur.value) {
    await dire(t('robot.echec'))
  }

  // FILET SUR LES DEUX CHEMINS. Le modèle n'atteint pas toujours sa question
  // finale ; si les deux libellés ne sont PAS dans ce qui a été dit, on les
  // prononce nous-mêmes. Seule phrase préfabriquée du tour de parole, et elle
  // ne sort que sur défaillance.
  if (opts.carillon && opts.branches?.length === 2 && !ctrl.signal.aborted) {
    const dit = complet.toLowerCase()
    const manquants = opts.branches.filter((b) => !dit.includes(b.label.toLowerCase().slice(0, 12)))
    if (manquants.length === 2) {
      await prononcer(t('robot.choix', { a: opts.branches[0].label, b: opts.branches[1].label }))
    }
  }

  // Le carillon PONCTUE la question, il ne la remplace pas : deux notes qui
  // montent disent « à toi » sans un mot. Après la phrase, jamais pendant.
  if (opts.carillon && !ctrl.signal.aborted) bruitages.question()

  reflechit.value = false
  if (coupeFlux === ctrl) coupeFlux = null
}

/**
 * L'avatar se manifeste et SALUE — appelé à l'ouverture du visualiseur, pas au
 * premier geste : on accueille quelqu'un qui arrive, on ne l'attend pas.
 *
 * La salutation n'est PAS préenregistrée. Un guide qui répète la même phrase
 * d'accueil se reconnaît en deux visites, et tout ce qui suit sonne alors comme
 * une machine. Elle passe par le modèle, comme le reste.
 */
function reveiller() {
  if (visible.value) return
  visible.value = true
  actif = true
  fil.value = []
  recit.reinitialiser()
  // Les oreilles s'ouvrent AVANT la première phrase, pas après : on doit
  // pouvoir couper le guide dès sa salutation. C'est précisément le moment où
  // quelqu'un de pressé veut le faire.
  // L'AGENT TEMPS RÉEL D'ABORD, ET LE GUIDE LOCAL SEULEMENT S'IL ÉCHOUE.
  //
  // ⚠️ CORRIGÉ LE 2026-08-29 : `tour()` était appelé ICI, sans attendre la
  // promesse. Les deux voies partaient donc EN MÊME TEMPS, et le jour où
  // l'agent temps réel s'ouvrait vraiment, le visiteur entendait DEUX VOIX se
  // parler dessus — celle de l'agent et la synthèse du navigateur. Le défaut
  // était invisible tant que l'agent ne fonctionnait pas.
  //
  // L'accueil local est donc désormais à l'intérieur du `then`, et il ne part
  // que si la voie temps réel a échoué.
  tenterTempsReel().then((ok) => {
    if (ok || !actif) return
    ouvrirLesOreilles()
    accueilLocal()
  })
}

/**
 * L'ACCUEIL DU GUIDE LOCAL — le repli, quand l'agent temps réel ne s'ouvre pas.
 *
 * LES DEUX CHEMINS SONT CHOISIS ICI, pas par le modèle. Lui laisser inventer
 * les choix produit deux propositions qui se recouvrent (« son histoire » /
 * « son passé »), et le choix perd son sens. Le client tient la liste des axes
 * et coche ceux qui ont servi ; le modèle ne fait que la phrase.
 */
function accueilLocal() {
  const deux = localiser(recit.proposerDeuxAxes())
  const choix = deux
    ? `Termine en lui proposant DEUX chemins, exactement ceux-ci et pas d’autres : ` +
      `« ${deux[0].label} » ou « ${deux[1].label} ». Formule-les naturellement, comme une question.`
    : `Termine en l’invitant à te poser une question.`

  tour(
    nom.value
      ? `${persona.value}Un visiteur vient d’arriver devant « ${nom.value} », qu’il regarde en 3D. ` +
        `Accueille-le à voix haute : salue-le, dis en une phrase ce qu’est cette pièce. ` +
        `${choix} ${ELOCUTION.value}`
      : `${persona.value}Un visiteur vient d’arriver. Accueille-le à voix haute, présente-toi en une phrase ` +
        `et demande-lui ce qui l’intéresse. ${ELOCUTION.value}`,
    null,
    { carillon: !!deux, branches: deux }
  )
}

/**
 * Le visiteur a choisi l'un des deux chemins. On développe CET axe, on le
 * marque consommé, et on en propose deux autres — la visite avance au lieu de
 * tourner sur les mêmes propositions.
 */
function suivreAxe(cle, ditParLeVisiteur) {
  recit.consommer(cle)
  bruitages.choix()
  const deux = localiser(recit.proposerDeuxAxes())
  const relance = deux
    ? `Puis propose-lui DEUX nouveaux chemins, exactement ceux-ci : « ${deux[0].label} » ou « ${deux[1].label} ».`
    : `Puis invite-le à te poser la question de son choix.`

  tour(
    [
      persona.value + (nom.value
        ? `Tu parles d’une pièce nommée « ${nom.value} », que le visiteur regarde en 3D.`
        : `Tu parles au visiteur.`),
      transcription(),
      `Il a choisi d’entendre : ${libelle(cle)}.`,
      recit.consigneAxe(cle),
      relance,
      ELOCUTION.value
    ].filter(Boolean).join('\n\n'),
    ditParLeVisiteur,
    { carillon: !!deux, branches: deux }
  )
}

// ---------------------------------------------------------------------------
// ÉCOUTE PLEINE-DUPLEX — il entend PENDANT qu'il parle, et se tait si on parle
// ---------------------------------------------------------------------------
//
// C'EST LA RÈGLE QUI A CHANGÉ. La version précédente fermait le micro dès que
// le guide prenait la parole : on ne pouvait ni l'interrompre, ni le corriger,
// ni lui dire « attends ». Un talkie-walkie, pas une conversation.
//
// Le micro reste maintenant ouvert en permanence. Le détecteur d'énergie de
// `services/ecoute.js` — sur un flux à ANNULATION D'ÉCHO, sans quoi le guide
// s'entendrait lui-même — signale en ~150 ms que quelqu'un parle, et la voix
// s'arrête net. C'est ce délai-là qu'on perçoit comme de la réactivité.
let oreilles = null

function traiterPhrase(dit) {
  if (!actif || !dit) return

  // GARDE-FOU D'AUTO-ÉCHO. La reconnaissance ouvre son propre micro, hors de
  // notre annulation d'écho : sur un téléphone à haut-parleur, elle transcrit
  // parfois le guide. Sans ce test, il se répondrait à lui-même — et une boucle
  // de ce genre ne s'arrête jamais toute seule.
  if (estUnEcho(dit, derniereParole.value)) return

  // « Tais-toi » n'appelle pas de réponse : il appelle du SILENCE. Y répondre
  // par une phrase serait exactement ne pas avoir écouté.
  if (estUnOrdreDeSeTaire(dit)) { tts.stop(); return }

  retenir('visiteur', dit)
  recit.noterParole(dit)          // alimente la mesure du tempérament

  // LE MOT SECRET PASSE AVANT TOUT. Une fois, jamais deux : la surprise ne se
  // rejoue pas, et le guide qui la resservirait la transformerait en refrain.
  if (!secretRevele.value && props.secret?.mot && props.secret?.recit &&
      secretPrononce(dit, props.secret.mot)) {
    revelerSecret(dit); return
  }

  // « Montre-moi… » est une navigation, pas une question.
  const cible = intentionMontrer(dit)
  if (cible) { montrer(cible, dit); return }

  // A-t-il choisi l'un des deux chemins ? Sinon la phrase repart comme une
  // question ordinaire — et c'est le bon comportement : « et le grenier ? »
  // n'est pas un choix, c'est autre chose qu'il veut savoir.
  const axe = recit.reconnaitreChoix(dit)
  if (axe) { suivreAxe(axe, dit); return }

  // On rappelle DE QUOI on parle : sans le nom de la pièce, « à quoi ça
  // servait ? » n'a aucun référent et la réponse part ailleurs.
  tour(
    [
      persona.value + (nom.value
        ? `Tu es le guide, à côté d’un visiteur qui regarde « ${nom.value} » en 3D.`
        : `Tu es le guide, à côté d’un visiteur.`),
      transcription(),
      `Le visiteur vient de te dire à voix haute : « ${dit} »`,
      `Réponds-lui, puis relance la conversation par une question courte. ${ELOCUTION.value}`
    ].filter(Boolean).join('\n\n'),
    dit                                  // ← c'est CELA que le conservateur lira
  )
}

async function ouvrirLesOreilles() {
  if (oreilles || microRefuse.value) return
  oreilles = creerEcoute({
    langue: () => langue.value,

    // L'INTERRUPTION, et c'est le cœur du dispositif. On ne cherche pas à
    // comprendre avant de se taire : quelqu'un parle, on se tait. Comprendre
    // vient après, et prend une seconde de plus — une seconde pendant laquelle
    // un guide qui continue de parler donne l'impression de ne pas écouter.
    surInterruption: () => {
      if (tts.speaking.value) { tts.stop(); coupeParLeVisiteur.value = true }
      ecoute.value = true
    },

    // Aperçu : la transcription partielle. Elle ne déclenche rien — elle sert à
    // montrer que l'écoute est vivante, et à couper la voix même quand
    // l'énergie n'a pas suffi (voix douce, micro lointain).
    surApercu: (texte) => {
      ecoute.value = true
      if (tts.speaking.value && !estUnEcho(texte, derniereParole.value)) {
        tts.stop(); coupeParLeVisiteur.value = true
      }
    },

    surTexte: (texte) => { ecoute.value = false; traiterPhrase(texte.trim()) },

    surRefus: () => {
      const premiereFois = !microRefuse.value
      microRefuse.value = true
      // ON LE DIT. Corollaire d'avoir supprimé le bouton d'enregistrement :
      // sans micro, le visiteur n'a plus aucun moyen de s'adresser au guide, et
      // rien à l'écran ne le lui apprendrait puisque cet avatar n'affiche pas
      // de texte.
      if (premiereFois && !coupe.value) dire(t('robot.sansMicro'))
    }
  })
  await oreilles.demarrer()
}

function fermerLesOreilles() {
  try { oreilles?.arreter() } catch { /* déjà fermées */ }
  oreilles = null
  ecoute.value = false
}

// Couper le son coupe AUSSI l'écoute : un guide muet qui continuerait d'écouter
// tiendrait le micro ouvert sans rien en faire de perceptible.
function basculerSon() {
  coupe.value = !coupe.value
  if (coupe.value) { tts.stop(); fermerLesOreilles() }
  else ouvrirLesOreilles()
}

/**
 * MODE CONTEUR — l'objet se met à parler de lui-même.
 *
 * Le changement prend effet au tour SUIVANT, pas au milieu d'une phrase : on
 * ne coupe pas le guide en train de parler pour changer de locuteur, cela
 * s'entend comme un bug. Le bruitage marque la bascule, qui serait autrement
 * invisible sur un avatar sans texte.
 */
function basculerConteur() {
  modeConteur.value = !modeConteur.value
  if (modeConteur.value) bruitages.conteur()
  else bruitages.choix()
}

/**
 * Un geste du visiteur sur la pièce. Appelé par la visionneuse : c'est ELLE
 * qui voit les rotations, l'avatar ne les connaît pas. Sert uniquement à la
 * mesure du tempérament — quelqu'un qui manipule beaucoup en peu de temps
 * cherche, il ne contemple pas.
 */
function noterGeste() { recit.noterInteraction() }

/**
 * COUPER LE GUIDE SANS MICRO.
 *
 * L'interruption par la voix suppose un micro autorisé. Quand il ne l'est pas —
 * refus, matériel absent, navigateur restrictif — le guide devenait impossible
 * à arrêter : on subissait la réponse jusqu'au bout. C'est le défaut que ce
 * geste corrige.
 *
 * POURQUOI L'ORBE, ET PAS « UNE TAPE N'IMPORTE OÙ ». Une tape n'importe où
 * paraît plus généreux, mais dans cette vue le doigt sert d'abord à FAIRE
 * TOURNER la pièce : chaque rotation tuerait la réponse en cours. L'orbe, elle,
 * ne sert à rien d'autre, elle est déjà sous les yeux, et elle pulse quand il
 * parle — elle dit donc d'elle-même qu'on peut appuyer dessus.
 *
 * `Échap` fait la même chose au clavier.
 */
function interrompre() {
  if (modeTempsReel.value) {
    session.value?.interrompre()
    bruitages.choix()
    return
  }
  if (!tts.speaking.value && !reflechit.value) return
  tts.stop()
  coupeParLeVisiteur.value = true
  // On coupe AUSSI le réseau : sans cela le serveur continuerait de produire
  // une réponse que plus personne n'écoute.
  try { coupeFlux?.abort() } catch { /* déjà fermé */ }
  bruitages.choix()
}

function surTouche(e) { if (e.key === 'Escape') interrompre() }

// ---------------------------------------------------------------------------
// « Guide, montre-moi le trésor du roi »
// ---------------------------------------------------------------------------
// Une demande de MONSTRATION n'est pas une question : y répondre par un
// paragraphe est un contresens, la personne veut voir. On annonce en une
// phrase, puis on y va.
//
// LA RÉSOLUTION DU NOM EST DÉLÉGUÉE À `ask()`. Ce composant ne connaît pas le
// catalogue et n'a pas à le connaître ; l'agent, lui, sait déjà transformer un
// nom d'œuvre en lien — il le fait pour le chat depuis toujours. On lui pose la
// demande et on suit le premier lien qu'il rend.
async function montrer(cible, dit) {
  if (reflechit.value) return
  reflechit.value = true
  tts.stop()
  try {
    // ON N'ENVOIE PAS `ELOCUTION` ICI, et c'est délibéré : elle réclame 40 à 75
    // mots, ce qui contredirait « une phrase courte » dans la même consigne — et
    // le modèle suit alors la contrainte chiffrée. Une annonce de déplacement se
    // dit en une ligne ; le récit viendra sur la page d'arrivée.
    const r = await ask(
      `${persona.value}Le visiteur demande à VOIR : « ${cible} ». ` +
      `Annonce-lui en UNE SEULE phrase de moins de vingt mots que tu l'y emmènes, ` +
      `en nommant la pièce. S'il n'y a rien de tel dans la collection, dis-le en une phrase. ` +
      `Réponds en ${langue.value === 'en' ? 'anglais' : 'français'}. ` +
      `Tu parles : pas de liste, pas de mise en forme.`,
      perimetre.value,
      { journal: dit }
    )
    const lien = (r?.links || [])[0]
    await dire((r?.text || '').trim() || t('robot.echec'))
    if (lien?.to) {
      bruitages.souffle()
      // La navigation démonte ce composant : `fermer()` part tout seul par
      // `onBeforeUnmount`, la voix s'arrête et le micro se referme. Rien à
      // défaire à la main.
      router.push(lien.to)
      return
    }
  } catch {
    await dire(t('robot.echec'))
  } finally {
    reflechit.value = false
  }
}

// ---------------------------------------------------------------------------
// L'objet caché
// ---------------------------------------------------------------------------
// Le seul endroit de tout le guide vocal où la parole est ÉCRITE À L'AVANCE, et
// c'est délibéré : une surprise qu'on prépare ne doit pas pouvoir se tromper.
// Le texte du conservateur est prononcé mot pour mot, sans passer par le modèle.
const secretRevele = ref(false)

async function revelerSecret(dit) {
  secretRevele.value = true
  reflechit.value = true
  tts.stop()
  bruitages.decouverte()
  try {
    retenir('guide', props.secret.recit)
    await dire(props.secret.recit)
  } finally {
    reflechit.value = false
  }
}

/**
 * L'avatar se retire : il disparaît, se tait, et lâche le micro.
 *
 * EXPOSÉ, et ce n'est pas décoratif : `Object3DViewer` l'appelle à la fermeture
 * du dialogue. Tant qu'il ne l'était pas, `robot.value?.fermer()` levait une
 * TypeError (l'optional chaining ne protège que d'un `robot.value` nul, pas
 * d'une méthode absente) — et la voix continuait de raconter une pièce qui
 * n'était plus à l'écran, micro ouvert.
 */
function fermer() {
  actif = false
  visible.value = false
  tts.stop()
  fermerLesOreilles()
  // La session vocale est FACTURÉE À LA MINUTE : la laisser ouverte après la
  // fermeture du visualiseur coûterait de l'argent pour un guide que plus
  // personne n'écoute.
  try { session.value?.arreter() } catch { /* déjà fermée */ }
  session.value = null
  modeTempsReel.value = false
}

// L'accueil se déclenche AU MONTAGE, et non depuis le parent via le `ref` : le
// dialogue de PrimeVue ne rend son contenu qu'après sa transition d'ouverture,
// si bien qu'au moment où le parent voudrait appeler `reveiller()`, l'avatar
// n'existe pas encore. Ici, être monté C'EST être arrivé.
onMounted(() => {
  if (props.auto) reveiller()
  window.addEventListener('keydown', surTouche)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', surTouche)
  fermer()
})

defineExpose({ reveiller, fermer, noterGeste })
</script>

<template>
  <div v-if="visible" class="rb" :class="`rb--${allure}`">
    <!-- LA PRÉSENCE. Aucune parole écrite : une orbe dont l'état se lit d'un
         coup d'œil — elle respire au repos, se met à balayer quand elle vous
         écoute, s'anime en barres quand elle parle. -->
    <!-- L'orbe devient un BOUTON quand il parle : c'est le seul moyen de le
         couper SANS MICRO. Le reste du temps elle n'est qu'un témoin d'état, et
         elle laisse passer le doigt pour ne pas gêner la rotation de la pièce.
         `Échap` fait la même chose au clavier. -->
    <component
      :is="peutCouper ? 'button' : 'div'"
      class="rb__orbe"
      :class="{ 'rb__orbe--coupable': peutCouper }"
      :type="peutCouper ? 'button' : undefined"
      :role="peutCouper ? undefined : 'img'"
      :aria-label="peutCouper ? $t('robot.couper') : $t(`robot.etat.${allure}`)"
      @click="peutCouper && interrompre()"
    >
      <span class="rb__aurore" />
      <span class="rb__halo" /><span class="rb__halo" /><span class="rb__halo" />
      <span class="rb__sonar" />
      <span class="rb__eq"><i /><i /><i /><i /><i /></span>
      <span class="rb__coeur" />
    </component>

    <!-- Il ne reste QUE deux commandes. Le bouton d'enregistrement a disparu :
         l'écoute est permanente, il n'y a plus rien à déclencher. -->
    <div class="rb__actions">
      <button class="rb__btn" :aria-label="$t('robot.son')" :title="$t('robot.son')" @click="basculerSon">
        <i class="pi" :class="coupe ? 'pi-volume-off' : 'pi-volume-up'" />
      </button>

      <!-- Mode Conteur : l'objet parle de lui-même. Le seul réglage qui change
           QUI parle, d'où le bouton dédié plutôt qu'un menu. -->
      <button
        class="rb__btn"
        :class="{ 'rb__btn--on': modeConteur }"
        :aria-pressed="modeConteur"
        :aria-label="$t('robot.conteur')"
        :title="$t('robot.conteur')"
        @click="basculerConteur"
      >
        <i class="pi" :class="modeConteur ? 'pi-comment' : 'pi-book'" />
      </button>
      <button class="rb__btn" :aria-label="$t('common.close')" :title="$t('common.close')" @click="fermer">
        <i class="pi pi-times" />
      </button>
    </div>

    <!-- Invisible à l'œil, lue par les lecteurs d'écran. Voir l'en-tête. -->
    <p class="sr-only" aria-live="polite">{{ derniereParole }}</p>
  </div>
</template>

<style scoped>
/* IL NE DOIT PAS GÊNER — et « gêner », ici, a deux sens très concrets.
 *
 * 1. IL NE DOIT PAS INTERCEPTER LE GESTE. L'orbe est posée en absolu SUR le
 *    modèle. Opaque aux évènements, elle avalait les glissés qui commençaient
 *    sur elle : on essayait de faire tourner la pièce, elle restait immobile.
 *    D'où `pointer-events: none` sur le conteneur ET sur l'orbe — seuls les
 *    boutons le reprennent. On fait tourner l'objet « à travers » l'avatar.
 *
 * 2. IL NE DOIT PAS MASQUER LA PIÈCE. Tout est translucide et flouté : on voit
 *    le modèle au travers. Au repos l'orbe s'efface encore un peu ; elle ne
 *    reprend sa pleine présence que lorsqu'il se passe quelque chose. La
 *    présence suit l'action au lieu de la précéder. */
.rb { position: absolute; right: .8rem; bottom: .8rem; z-index: 20;
  display: flex; flex-direction: column; align-items: center; gap: .55rem;
  pointer-events: none; }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ---- L'orbe ------------------------------------------------------------- */
.rb__orbe--coupable { pointer-events: auto; cursor: pointer;
  border: 0; padding: 0; appearance: none; }
/* Quand il parle, l'orbe invite au doigt : un anneau clair qui dit qu'on peut
   appuyer. Sans ce signe, personne ne devine que le témoin est un bouton. */
.rb--parle .rb__orbe--coupable, .rb--pense .rb__orbe--coupable {
  box-shadow: 0 6px 22px rgba(0,0,0,.3), inset 0 0 18px rgba(120,240,200,.16),
              0 0 0 2px rgba(235,255,248,.45); }
.rb__orbe--coupable:active { transform: scale(.94); }

.rb__orbe { position: relative; width: 4rem; height: 4rem; border-radius: 50%;
  display: grid; place-items: center; overflow: hidden;
  background: rgba(8, 62, 45, .3);
  border: 1px solid rgba(190, 245, 225, .5);
  -webkit-backdrop-filter: blur(8px) saturate(1.35);
  backdrop-filter: blur(8px) saturate(1.35);
  box-shadow: 0 6px 22px rgba(0, 0, 0, .28), inset 0 0 18px rgba(120, 240, 200, .16);
  pointer-events: none;                        /* voir le point 1 de l'en-tête */
  opacity: .55; transform: scale(.9);
  transition: opacity .4s ease, transform .4s ease, border-color .4s ease; }

.rb--pense .rb__orbe, .rb--parle .rb__orbe, .rb--ecoute .rb__orbe,
.rb:hover .rb__orbe, .rb:focus-within .rb__orbe { opacity: 1; transform: scale(1); }

/* L'aurore : un dégradé conique qui tourne lentement sous le verre. C'est ce qui
   empêche l'orbe d'être un simple rond de couleur — la lumière y bouge même
   quand rien ne se passe. */
.rb__aurore { position: absolute; inset: -35%; border-radius: 50%;
  background: conic-gradient(from 0deg,
    rgba(26, 156, 114, 0), rgba(84, 232, 178, .5), rgba(16, 118, 190, .35),
    rgba(210, 180, 90, .3), rgba(26, 156, 114, 0));
  filter: blur(6px); animation: rb-tourne 14s linear infinite; }
@keyframes rb-tourne { to { transform: rotate(360deg) } }

/* Les halos disent le RYTHME : lents au repos, pressés quand il cherche. */
.rb__halo { position: absolute; inset: 0; border-radius: 50%;
  border: 1.5px solid rgba(180, 250, 220, .5); opacity: 0;
  animation: rb-halo 3s ease-out infinite; }
.rb__halo:nth-of-type(2) { animation-delay: 1s }
.rb__halo:nth-of-type(3) { animation-delay: 2s }
@keyframes rb-halo {
  0%   { transform: scale(.72); opacity: .6 }
  100% { transform: scale(1.5); opacity: 0 }
}

/* Le cœur respire : la preuve qu'il est vivant quand il ne fait rien. */
.rb__coeur { position: absolute; width: .5rem; height: .5rem; border-radius: 50%;
  background: rgba(235, 255, 248, .95); box-shadow: 0 0 12px rgba(150, 255, 220, .9);
  animation: rb-respire 3.4s ease-in-out infinite; }
@keyframes rb-respire {
  0%, 100% { transform: scale(.85); opacity: .65 }
  50%      { transform: scale(1.25); opacity: 1 }
}

/* ---- Il parle : un égaliseur, pas un rond qui clignote ------------------- */
.rb__eq { position: absolute; display: none; align-items: center; gap: 3px; height: 1.5rem; }
.rb__eq i { display: block; width: 3px; height: 100%; border-radius: 2px;
  background: linear-gradient(to top, rgba(120, 240, 200, .55), rgba(245, 255, 252, .95));
  transform: scaleY(.25); transform-origin: center;
  animation: rb-eq .62s ease-in-out infinite alternate; }
.rb__eq i:nth-child(2) { animation-delay: .13s }
.rb__eq i:nth-child(3) { animation-delay: .26s }
.rb__eq i:nth-child(4) { animation-delay: .07s }
.rb__eq i:nth-child(5) { animation-delay: .19s }
@keyframes rb-eq { from { transform: scaleY(.22) } to { transform: scaleY(1) } }

.rb--parle .rb__eq { display: flex; }
.rb--parle .rb__coeur { display: none; }
.rb--parle .rb__halo { animation-duration: 1.7s; border-color: rgba(255, 255, 255, .6); }
.rb--parle .rb__aurore { animation-duration: 6s; }

/* ---- Il cherche ses mots ------------------------------------------------- */
.rb--pense .rb__halo { animation-duration: 1s; }
.rb--pense .rb__aurore { animation-duration: 2.6s; }
.rb--pense .rb__coeur { animation-duration: 1s; }

/* ---- Il vous écoute : c'est à VOUS, et cela doit se voir sans ambiguïté --- */
.rb__sonar { position: absolute; inset: 0; border-radius: 50%; display: none;
  background: conic-gradient(from 0deg, rgba(255, 190, 120, .55), rgba(255, 190, 120, 0) 55%);
  animation: rb-tourne 1.5s linear infinite; }
.rb--ecoute .rb__sonar { display: block; }
.rb--ecoute .rb__orbe { background: rgba(122, 58, 12, .32);
  border-color: rgba(255, 208, 150, .75);
  box-shadow: 0 6px 22px rgba(0, 0, 0, .28), inset 0 0 20px rgba(255, 190, 120, .28); }
.rb--ecoute .rb__halo { animation-duration: 1.25s; border-color: rgba(255, 210, 160, .75); }
.rb--ecoute .rb__coeur { background: #fff3e2; box-shadow: 0 0 14px rgba(255, 190, 120, .95);
  animation-duration: 1.25s; }

/* ---- Commandes ---------------------------------------------------------- */
/* Deux boutons, et ce sont les seules zones qui interceptent le geste. Ils
   restent atteignables au doigt : pas de révélation au survol, qui n'existe pas
   sur mobile. */
.rb__actions { display: flex; gap: .35rem; pointer-events: auto; }
.rb__btn { display: grid; place-items: center; width: 2.1rem; height: 2.1rem;
  border: 1px solid rgba(255, 255, 255, .18); border-radius: 50%;
  background: rgba(0, 0, 0, .34); color: #fff;
  -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);
  font-size: .85rem; cursor: pointer; opacity: .55;
  transition: opacity .25s ease, background .25s ease; }
.rb:hover .rb__btn, .rb:focus-within .rb__btn { opacity: 1; }
.rb__btn:hover, .rb__btn:focus-visible { opacity: 1; background: rgba(0, 0, 0, .55); }
/* Mode Conteur actif : l'avatar ne montrant aucun texte, l'état doit se lire
   sur le bouton lui-meme, sinon rien ne dit que l'objet a pris la parole. */
.rb__btn--on { opacity: 1; background: rgba(11, 107, 75, .85);
  border-color: rgba(180, 250, 220, .55); }

/* Rien ne doit bouger pour qui a demandé que rien ne bouge : l'état reste
   lisible par la couleur et l'opacité, qui ne sont pas des animations. */
@media (prefers-reduced-motion: reduce) {
  .rb__aurore, .rb__halo, .rb__coeur, .rb__sonar, .rb__eq i { animation: none; }
  .rb__halo { opacity: .28; }
  .rb__eq i { transform: scaleY(.6); }
  .rb__orbe { transition: none; }
}
</style>
