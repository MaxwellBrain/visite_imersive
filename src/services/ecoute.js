// ÉCOUTE PLEINE-DUPLEX — le guide entend PENDANT qu'il parle.
//
// CE QUI ÉTAIT FAUX AVANT. La première version fermait le micro dès que le
// guide prenait la parole, au motif que le micro capterait les haut-parleurs et
// que le guide se répondrait à lui-même. La crainte est réelle, la solution
// était mauvaise : elle transforme une conversation en talkie-walkie. On ne
// peut plus l'interrompre, plus le corriger, plus lui dire « attends ». C'est
// exactement ce qui sépare un assistant vocal d'un répondeur.
//
// LA VRAIE SOLUTION EST DANS LE NAVIGATEUR : `echoCancellation`. C'est le même
// traitement que pour un appel visio — le navigateur connaît le signal qu'il
// envoie aux haut-parleurs et le soustrait de ce qu'il reçoit du micro. Le
// guide s'entend donc à peine, et la voix humaine ressort.
//
// DEUX OREILLES, ET ELLES NE FONT PAS LE MÊME MÉTIER
//
//   1. LE DÉTECTEUR D'ÉNERGIE (ce fichier) — notre propre flux micro, avec
//      annulation d'écho, analysé en continu. Il ne comprend RIEN ; il dit
//      seulement « quelqu'un parle, maintenant ». C'est lui qui déclenche la
//      coupure, parce qu'il répond en ~150 ms là où la transcription met une
//      seconde. C'est cette latence-là qu'on entend comme de la réactivité.
//
//   2. LA RECONNAISSANCE (SpeechRecognition) — elle, comprend. Elle tourne en
//      continu, en résultats intermédiaires, et fournit le texte. Mais elle
//      n'utilise PAS notre flux : elle ouvre le sien, sans garantie d'écho
//      annulé. Elle peut donc transcrire le guide lui-même — d'où le garde-fou
//      d'auto-écho, plus bas, qui est la pièce à ne pas retirer.
//
// Aucune dépendance : Web Audio et Web Speech sont dans le navigateur.

const MOTEUR_VOCAL =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

// Durée de parole continue exigée avant de déclarer une interruption. Trop bas,
// une toux coupe le guide ; trop haut, l'interruption paraît molle. 140 ms est
// à peu près la durée d'une syllabe.
const MS_POUR_INTERROMPRE = 140
const PERIODE_MS = 25

// Marge au-dessus du bruit de fond. Le seuil n'est PAS absolu : une salle de
// musée, une rue et un salon n'ont pas le même fond sonore, et un seuil fixe
// rendrait le guide sourd dans l'un et paranoïaque dans l'autre.
const MARGE_SUR_FOND = 2.6
const PLANCHER = 0.012          // en deçà, c'est du silence quoi qu'en dise le calcul

// Fin de prise de parole, pour Whisper : assez de silence pour qu'une
// respiration ne coupe pas la phrase en deux, assez peu pour ne pas faire
// attendre. 700 ms est la valeur qui sépare le mieux une pause d'une fin.
const MS_SILENCE_FIN = 700
// En deçà, ce n'est pas une phrase — c'est une porte, une toux, un raclement.
// L'envoyer coûterait un appel pour récolter une hallucination.
const MS_MINI_PAROLE = 350

/**
 * Mots qui coupent la parole, même sans que l'énergie suffise. C'est le geste
 * que le visiteur tente en premier — il le dit, il ne crie pas.
 */
const TAIRE = /\b(stop|chut|tais[- ]toi|taisez[- ]vous|arr[êe]te|arr[êe]tez|attends|attendez|silence|une\s+seconde|quiet|shut\s+up|hold\s+on|wait)\b/i

export function estUnOrdreDeSeTaire(phrase) {
  return TAIRE.test(String(phrase || ''))
}

// ---------------------------------------------------------------------------
// WHISPER — l'oreille de secours, celle qui couvre l'iPhone
// ---------------------------------------------------------------------------
// `SpeechRecognition` n'existe pas sur Safari iOS, ni sur Firefox, ni dans une
// WebView. Ce n'est pas « moins bon » là-bas : le guide vocal y est MUET. Or un
// musée qui pose des QR codes ne choisit pas le téléphone de ses visiteurs.
//
// On enregistre donc la prise de parole avec `MediaRecorder` — sur le flux micro
// DÉJÀ ouvert pour la détection d'énergie, sans second accès au micro — et on
// l'envoie à l'Edge Function `transcrire`.
//
// QUAND. Uniquement si `SpeechRecognition` manque. Elle est gratuite et
// instantanée là où elle existe ; Whisper coûte un appel et un aller-retour.
// On ne paie que là où l'on n'a pas le choix.

// LE FILET À HALLUCINATIONS — textuel, et DÉLIBÉRÉMENT INCOMPLET.
//
// Whisper produit du texte sur du silence ou du bruit : artefact connu du
// modèle, pas un bug d'intégration. Mesuré ici même sur un signal de synthèse
// sans parole : « Merci. » au premier essai, « Oui. » au second.
//
// ⚠️ ET C'EST POURQUOI UNE LISTE NOIRE NE SUFFIT PAS. « Oui » est à la fois la
// production fantôme la plus fréquente ET la réponse la plus légitime à « veux-tu
// en savoir plus ? ». L'inscrire ici rendrait le guide sourd à l'acquiescement.
//
// La vraie barrière est donc ACOUSTIQUE, en amont (voir MS_MINI_PAROLE) : on
// n'envoie que ce qui contenait assez de parole. Cette liste ne retient que les
// artefacts qui ne sont JAMAIS une réponse de visiteur.
const HALLUCINATIONS = [
  /^merci\s*[.!]?$/i,
  /^sous-titr/i,                       // « Sous-titres réalisés par… »
  /amara\.org/i,
  /^(thank you|thanks)\s*[.!]?$/i,
  /^you\s*$/i,
  /^\s*[.…!?-]*\s*$/                   // ponctuation seule
]

export function estUneHallucination(texte) {
  const t = String(texte || '').trim()
  if (!t) return true
  return HALLUCINATIONS.some((r) => r.test(t))
}

const URL_TRANSCRIRE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcrire`

async function transcrire(blob, type, langue) {
  const r = await fetch(`${URL_TRANSCRIRE}?lang=${langue === 'en' ? 'en' : 'fr'}`, {
    method: 'POST',
    headers: {
      'Content-Type': type,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
    },
    body: blob
  })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d?.error || `transcrire ${r.status}`)
  }
  return (await r.json())?.texte || ''
}

// Le format dépend de la plateforme : Chrome sort du webm/opus, Safari du
// mp4/aac. On prend le premier que l'appareil sait produire — les deux sont
// acceptés côté serveur, sinon on n'aurait fait que déplacer le problème.
function formatDisponible() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t
  }
  return null
}

/**
 * Le texte entendu est-il l'écho de ce que le guide vient de dire ?
 *
 * GARDE-FOU CENTRAL. La reconnaissance ouvre son propre micro, hors de notre
 * annulation d'écho : sur un téléphone à haut-parleur, elle transcrit parfois
 * le guide. Sans ce test, il se répondrait à lui-même — et une boucle de ce
 * genre ne s'arrête jamais toute seule.
 *
 * On compare les MOTS, pas les chaînes : la transcription déforme toujours un
 * peu. Au-delà de la moitié des mots en commun, on considère que c'est lui.
 */
export function estUnEcho(entendu, ditParLeGuide) {
  const mots = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((m) => m.length > 3)
  const a = mots(entendu)
  if (a.length < 2) return false          // trop court pour conclure
  const b = new Set(mots(ditParLeGuide))
  if (!b.size) return false
  const communs = a.filter((m) => b.has(m)).length
  return communs / a.length > 0.5
}

/**
 * Ouvre les deux oreilles.
 *
 * @param {object} opts
 *   langue()            → 'fr' | 'en', lue à chaque redémarrage
 *   surInterruption()   → quelqu'un parle MAINTENANT (énergie). Appelé au plus
 *                         une fois par prise de parole.
 *   surTexte(texte)     → une phrase complète a été comprise
 *   surApercu(texte)    → transcription partielle, dès les premiers mots
 *   surRefus(motif)     → micro indisponible ; l'appelant dégrade
 */
export function creerEcoute(opts = {}) {
  let flux = null, ctx = null, analyseur = null, boucle = null
  let reco = null, relance = null
  let magneto = null, morceaux = [], formatAudio = null
  let framesSilence = 0
  // Millisecondes de parole RÉELLE dans l'enregistrement en cours. C'est cette
  // mesure — et non la taille du fichier — qui dit si l'on tient une phrase ou
  // un claquement de porte.
  let msParole = 0
  let actif = false
  let fond = 0.02              // bruit de fond estimé, réévalué en continu
  let framesParole = 0
  let interruptionSignalee = false
  let echantillons = null

  const langue = () => (opts.langue?.() === 'en' ? 'en-US' : 'fr-FR')

  // ---------------------------------------------------- oreille 1 : énergie --
  async function ouvrirMicro() {
    if (!navigator.mediaDevices?.getUserMedia) return false
    try {
      flux = await navigator.mediaDevices.getUserMedia({
        audio: {
          // LES TROIS QUI COMPTENT. `echoCancellation` est ce qui rend tout le
          // reste possible : sans elle, le guide s'entend et se coupe lui-même.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
    } catch (e) {
      opts.surRefus?.(e?.name === 'NotAllowedError' ? 'refus' : 'indisponible')
      return false
    }
    const C = window.AudioContext || window.webkitAudioContext
    ctx = new C()
    if (ctx.state === 'suspended') { try { await ctx.resume() } catch { /* geste requis */ } }
    analyseur = ctx.createAnalyser()
    analyseur.fftSize = 1024
    analyseur.smoothingTimeConstant = 0.2
    ctx.createMediaStreamSource(flux).connect(analyseur)
    echantillons = new Uint8Array(analyseur.fftSize)
    return true
  }

  function niveau() {
    analyseur.getByteTimeDomainData(echantillons)
    // Valeur efficace (RMS) autour de 128, qui est le zéro d'un signal 8 bits.
    let somme = 0
    for (let i = 0; i < echantillons.length; i++) {
      const v = (echantillons[i] - 128) / 128
      somme += v * v
    }
    return Math.sqrt(somme / echantillons.length)
  }

  function surveiller() {
    boucle = setInterval(() => {
      if (!analyseur) return
      const n = niveau()
      const seuil = Math.max(PLANCHER, fond * MARGE_SUR_FOND)

      if (n > seuil) {
        framesParole++
        framesSilence = 0
        if (framesParole * PERIODE_MS >= MS_POUR_INTERROMPRE && !interruptionSignalee) {
          interruptionSignalee = true
          opts.surInterruption?.()
        }
        // Whisper : c'est l'énergie qui décide QUAND enregistrer. On n'envoie
        // donc jamais du silence — ce qui économise les appels et, surtout,
        // évite les hallucinations du modèle sur du vide.
        if (magneto && magneto.state === 'inactive' &&
            framesParole * PERIODE_MS >= MS_POUR_INTERROMPRE) {
          morceaux = []
          msParole = 0
          try { magneto.start() } catch { /* déjà en cours */ }
        }
        if (magneto?.state === 'recording') msParole += PERIODE_MS
      } else {
        framesParole = 0
        framesSilence++
        interruptionSignalee = false
        // Le fond ne se met à jour QUE dans le silence : l'actualiser pendant
        // qu'on parle ferait monter le seuil jusqu'à rendre le micro sourd.
        fond = fond * 0.92 + n * 0.08
        // Fin de prise de parole : assez de silence pour qu'une respiration ne
        // coupe pas la phrase en deux, assez peu pour ne pas faire attendre.
        if (magneto && magneto.state === 'recording' &&
            framesSilence * PERIODE_MS >= MS_SILENCE_FIN) {
          try { magneto.stop() } catch { /* déjà arrêtée */ }
        }
      }
    }, PERIODE_MS)
  }

  // ----------------------------------------- oreille 2 : la reconnaissance --
  // ------------------------------------------ oreille 2 bis : Whisper ------
  // N'existe QUE si `SpeechRecognition` manque. C'est ce qui rend le guide
  // vocal utilisable sur iPhone, où l'API du navigateur est absente.
  function ouvrirMagnetophone() {
    formatAudio = formatDisponible()
    if (!formatAudio || !flux) return
    try { magneto = new MediaRecorder(flux, { mimeType: formatAudio }) }
    catch { magneto = null; return }

    magneto.ondataavailable = (e) => { if (e.data?.size) morceaux.push(e.data) }
    magneto.onstop = async () => {
      const blob = new Blob(morceaux, { type: formatAudio.split(';')[0] })
      const paroleMs = msParole
      morceaux = []
      msParole = 0
      // LA BARRIÈRE ACOUSTIQUE, et c'est elle qui compte.
      //
      // On ne juge PAS sur la taille du fichier : une seconde de bruit de fond
      // pèse autant qu'une seconde de parole. On juge sur le temps pendant
      // lequel l'énergie a réellement dépassé le seuil. En dessous de
      // MS_MINI_PAROLE, c'est une porte, une toux, un raclement de chaise — et
      // Whisper, à qui l'on demande de transcrire du bruit, invente une phrase.
      if (!actif || blob.size < 2000 || paroleMs < MS_MINI_PAROLE) return
      try {
        const texte = await transcrire(blob, formatAudio.split(';')[0], langue().slice(0, 2))
        // LE FILET À HALLUCINATIONS. Whisper invente sur du bruit ; « Merci. »
        // est sa production la plus fréquente, et c'est justement le mot qui
        // clôt une conversation. Le laisser passer ferait dire au revoir au
        // guide parce qu'une porte a claqué.
        if (!estUneHallucination(texte)) opts.surTexte?.(texte)
      } catch (e) {
        // Quota, réseau, format : jamais bloquant. Le visiteur peut réessayer,
        // et l'écoute reste ouverte.
        console.warn('[ecoute] transcription indisponible :', e?.message || e)
      }
    }
  }

  function ouvrirReconnaissance() {
    if (!MOTEUR_VOCAL) return
    const r = new MOTEUR_VOCAL()
    r.lang = langue()
    r.continuous = true          // on ne referme plus entre deux phrases
    r.interimResults = true      // et on réagit AVANT la fin de la phrase
    r.maxAlternatives = 1

    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const texte = (res[0]?.transcript || '').trim()
        if (!texte) continue
        if (res.isFinal) opts.surTexte?.(texte)
        else opts.surApercu?.(texte)
      }
    }
    r.onerror = (e) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'audio-capture') {
        actif = false
        opts.surRefus?.('refus')
      }
      // `no-speech` et `aborted` sont la vie normale d'une écoute permanente :
      // `onend` relancera.
    }
    r.onend = () => {
      if (!actif) return
      // Chrome referme la session même en mode continu, après un long silence
      // ou un changement de réseau. On la rouvre : c'est CE cycle qui fait
      // l'écoute permanente.
      clearTimeout(relance)
      relance = setTimeout(() => { try { r.start() } catch { /* déjà ouverte */ } }, 250)
    }
    reco = r
    try { r.start() } catch { /* déjà démarrée */ }
  }

  return {
    async demarrer() {
      if (actif) return true
      actif = true
      const micro = await ouvrirMicro()
      // L'ORDRE COMPTE : le magnétophone doit exister AVANT la surveillance,
      // sinon les premières trames d'énergie ne trouvent rien à démarrer.
      if (micro && !MOTEUR_VOCAL) ouvrirMagnetophone()
      if (micro) surveiller()
      ouvrirReconnaissance()
      // Le détecteur d'énergie peut manquer (permission refusée sur CE flux)
      // sans que la reconnaissance échoue : on reste utile, simplement moins
      // prompt à couper.
      return micro || !!reco
    },

    /** La langue a changé : la reconnaissance doit repartir avec la bonne. */
    rafraichirLangue() {
      if (reco) { try { reco.lang = langue(); reco.abort() } catch { /* onend relancera */ } }
    },

    arreter() {
      actif = false
      clearInterval(boucle); boucle = null
      clearTimeout(relance)
      try { if (magneto?.state === 'recording') magneto.stop() } catch { /* déjà arrêtée */ }
      magneto = null; morceaux = []
      try { reco?.abort() } catch { /* déjà arrêtée */ }
      reco = null
      try { flux?.getTracks().forEach((t) => t.stop()) } catch { /* déjà fermé */ }
      flux = null
      try { ctx?.close() } catch { /* déjà fermé */ }
      ctx = null
      analyseur = null
    },

    // Exposés pour le diagnostic : sans eux, un seuil mal réglé est invisible.
    diagnostic: () => ({
      fond, seuil: Math.max(PLANCHER, fond * MARGE_SUR_FOND), actif,
      micro: !!flux, reco: !!reco,
      // Quelle oreille écoute réellement ? Sans cette information, un guide
      // sourd sur iPhone reste un mystère.
      moteur: reco ? 'navigateur' : (magneto ? 'whisper' : 'aucun'),
      format: formatAudio || null
    })
  }
}

export const ecouteSupportee = !!MOTEUR_VOCAL
