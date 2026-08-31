import { ref } from 'vue'
import { ELEVENLABS_VOICES } from '@/constants/voices'

// Service de synthèse vocale (texte → audio) partagé.
//
// Deux moteurs, même API publique speak()/stop()/pause()/resume() :
//   1. « browser » (par défaut) : Web Speech API — audible immédiatement, sans clé ni coût.
//   2. « elevenlabs » : voix IA cloud ultra-naturelle via l'Edge Function `tts`
//      (clé ElevenLabs 100 % côté serveur). Activé quand VITE_TTS_PROVIDER=elevenlabs.
//      En cas d'échec (pas de clé, réseau, quota) → repli automatique sur la voix du navigateur.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null

const PROVIDER = import.meta.env.VITE_TTS_PROVIDER || 'browser' // défaut global : 'browser' | 'elevenlabs'
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
// La voix cloud est *techniquement disponible* dès que Supabase est configuré :
// chaque guide choisit ensuite son moteur (provider) dans l'ERP.
const cloudAvailable = !!SUPA_URL
const cloudEnabled = PROVIDER === 'elevenlabs' && cloudAvailable // défaut si le guide ne précise rien

// QUAND LE CLOUD A DIT NON UNE FOIS, ON ARRÊTE DE DEMANDER.
//
// Mesuré le 2026-08-28 : la clé ElevenLabs du projet est à court de crédits
// (« 0 credits remaining »). ElevenLabs répond 401, l'Edge Function traduit en
// 502, et le service se rabat sur la voix du navigateur — correctement. Sauf
// qu'il RECOMMENÇAIT à chaque phrase : 0,7 à 1,3 seconde d'aller-retour perdue
// AVANT CHAQUE RÉPLIQUE, plus un avertissement en console par phrase.
//
// C'était supportable pour un audioguide qu'on lance une fois. Ça ne l'est plus
// depuis que l'avatar 3D converse : le visiteur paie ce délai à chaque tour de
// parole, et c'est exactement le silence qu'on cherche à éliminer.
//
// On distingue donc deux échecs, parce qu'ils n'appellent pas la même conduite :
//   REFUS  (401/402/403/429, ou clé absente) — un ÉTAT, pas une panne. Il ne se
//          résoudra pas tout seul dans la minute : on cesse d'appeler pour la
//          durée de la session.
//   PANNE  (5xx, réseau) — passagère par nature : on retentera à la phrase
//          suivante, ce serait dommage de se priver du cloud pour un hoquet.
const REFUS_DEFINITIFS = new Set([401, 402, 403, 429])
const cloudRefuse = ref('')            // motif lisible ; vide = le cloud reste tentable

// Un guide utilise-t-il la voix cloud ? opts.provider ('browser'|'elevenlabs') prime sur le défaut global.
function wantsCloud(opts = {}) {
  const p = opts.provider || PROVIDER
  return p === 'elevenlabs' && cloudAvailable && !cloudRefuse.value
}

const supported = ref(!!synth || cloudAvailable)
const speaking = ref(false)
const paused = ref(false)
const voices = ref([])

let keepAlive = null
let userPaused = false
let audioEl = null // <audio> pour la voix cloud (MP3)
let audioUrl = null

// ---------- Voix navigateur ----------
function refreshVoices() { if (synth) voices.value = synth.getVoices() || [] }
if (synth) {
  refreshVoices()
  try { synth.addEventListener('voiceschanged', refreshVoices) } catch { /* Safari ancien */ }
}

const LANG_MAP = { fr: 'fr-FR', en: 'en-US', ewo: 'fr-FR', fub: 'fr-FR', bbj: 'fr-FR' }
const TIMBRE_PITCH = { standard: 1, grave: 0.6, douce: 1.4, robot: 0.2 }
function toBcp47(lang) { return LANG_MAP[lang] || lang || 'fr-FR' }

// CHOIX DE LA VOIX — et pourquoi ce n'est pas « la première qui parle la langue ».
//
// C'est ce que faisait ce code : un `find` sur la langue, et l'affaire était
// close. Sur Windows, l'ordre d'énumération met en tête les vieilles voix SAPI5,
// si bien que le guide s'exprimait avec **Microsoft Hortense** — la plus
// métallique du lot, celle qui fait immédiatement « machine ». Deux voix
// nettement meilleures étaient pourtant installées juste derrière.
//
// L'écart de qualité ne tient pas à la langue mais à la GÉNÉRATION du moteur :
//
//   neurales   « … Online (Natural) » (Edge/Windows 11), « Google … », Siri,
//              « Premium/Enhanced » (Apple) — synthèse par réseau de neurones,
//              prosodie continue. C'est le seul vrai saut de qualité.
//   classiques Microsoft Julie, Paul, Thomas… — concaténatives, acceptables.
//   à éviter   Hortense, Zira, Hedda, eSpeak — les plus anciennes, hachées.
//
// On classe donc au lieu de prendre la première venue. Aucune n'est exclue : sur
// un poste qui n'a QUE Hortense, mieux vaut Hortense que le silence.
const VOIX_NEURALES = /(natural|neural|online|premium|enhanced|siri|google)/i
const VOIX_ANCIENNES = /(hortense|zira|hedda|espeak|pico|compact)/i

function qualiteVoix(v) {
  let note = 0
  if (VOIX_NEURALES.test(v.name)) note += 100
  // `localService === false` = voix servie par le réseau : sur Edge et Chrome,
  // ce sont exactement les neurales. Indice indépendant du nom, donc robuste
  // aux libellés localisés (« Naturel », « Natürlich »…).
  if (v.localService === false) note += 40
  if (VOIX_ANCIENNES.test(v.name)) note -= 80
  if (v.default) note += 5
  return note
}

// LANGUE DU PROJET. Quand aucune voix ne parle la langue demandée, on ne laisse
// PAS le navigateur choisir : il prend alors « une voix quelconque », et l'on a
// entendu du français lu par une voix espagnole. Mieux vaut une voix française —
// le contenu de cette plateforme l'est presque toujours.
const LANGUE_PROJET = 'fr'

function pickVoice(lang) {
  const want = toBcp47(lang).toLowerCase()
  const base = want.slice(0, 2)
  const candidates = (voices.value || []).filter(
    (v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(base)
  )
  // Aucune voix pour cette langue : on se rabat sur celle du projet plutôt que
  // de laisser la synthèse improviser. Voir LANGUE_PROJET.
  if (!candidates.length) {
    if (base === LANGUE_PROJET) return null
    const repli = (voices.value || []).filter(
      (v) => v.lang && v.lang.toLowerCase().startsWith(LANGUE_PROJET)
    )
    if (!repli.length) return null
    return repli.map((v) => ({ v, note: qualiteVoix(v) })).sort((a, b) => b.note - a.note)[0].v
  }
  return candidates
    .map((v) => ({
      v,
      // Le variant exact (fr-FR plutôt que fr-CA) départage à qualité égale,
      // mais ne prime jamais sur la génération du moteur.
      note: qualiteVoix(v) + (v.lang.toLowerCase().replace('_', '-') === want ? 10 : 0)
    }))
    .sort((a, b) => b.note - a.note)[0].v
}

// DEVINER LA LANGUE DU TEXTE, parce que la langue de l'INTERFACE ment.
//
// Le guide répond en français même lorsque le site est affiché en anglais : son
// prompt est français et le modèle s'y tient. On passait pourtant à la synthèse
// la locale de l'interface — donc une voix anglaise ânonnant du français. C'est
// le texte réellement prononcé qui fait autorité, pas le drapeau en haut de page.
//
// Un compte de mots-outils suffit largement ici : on ne distingue que deux
// langues, sur des phrases entières de guide de musée.
const MOTS_FR = /\b(le|la|les|des|une|un|du|de|et|est|dans|vous|qui|que|pour|avec|cette|ce|son|sa|sur|plus|au|aux|ne|pas|nous|elle|il)\b/gi
const MOTS_EN = /\b(the|and|is|are|of|to|in|you|that|this|for|with|it|its|on|as|was|were|at|from|have|has|his|her)\b/gi

export function devinerLangue(texte, defaut = 'fr') {
  const t = String(texte || '')
  // ⚠️ EN DESSOUS DE 40 CARACTÈRES, ON NE DEVINE PAS — on rend le défaut.
  //
  // Le seuil était à 12, ce qui suffisait quand on recevait la réponse entière.
  // Depuis la diffusion, on prononce PHRASE PAR PHRASE : « Bonjour ! » (9),
  // « C'est tout. » (11) passaient donc sous le seuil et repartaient sur la
  // locale de l'interface. Sur un navigateur annoncé en anglais, du français
  // était lu avec `lang="en-US"` — et faute de voix anglaise installée, la
  // synthèse tirait au sort. C'est de là que venaient les voix espagnoles.
  //
  // La vraie parade est en amont (deviner UNE FOIS par réponse, sur le texte
  // accumulé), mais le seuil doit être honnête : deux mots ne suffisent pas à
  // trancher une langue.
  if (t.trim().length < 40) return defaut
  const fr = (t.match(MOTS_FR) || []).length
  const en = (t.match(MOTS_EN) || []).length
  // Les accents tranchent les cas serrés : ils n'existent pratiquement pas en
  // anglais, et un texte français en compte toujours quelques-uns.
  const accents = (t.match(/[àâäéèêëîïôöùûüçœ]/gi) || []).length
  if (fr + accents > en) return 'fr'
  if (en > fr + accents) return 'en'
  return defaut
}

function cleanupAudio() {
  if (audioEl) { try { audioEl.pause() } catch { /* ignore */ } audioEl = null }
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null }
}

function stop() {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null }
  userPaused = false
  if (synth) synth.cancel()
  cleanupAudio()
  speaking.value = false
  paused.value = false
}

function speakBrowser(content, opts) {
  if (!synth) return false
  const u = new SpeechSynthesisUtterance(content)
  u.lang = toBcp47(opts.lang)
  u.rate = Math.min(2, Math.max(0.5, Number(opts.rate) || 1))
  u.pitch = opts.pitch != null ? opts.pitch : (TIMBRE_PITCH[opts.timbre] ?? 1)
  const v = pickVoice(opts.lang)
  if (v) u.voice = v
  u.onstart = () => { speaking.value = true; paused.value = false }
  u.onend = () => { speaking.value = false; paused.value = false; if (keepAlive) { clearInterval(keepAlive); keepAlive = null } }
  u.onerror = () => { speaking.value = false; paused.value = false; if (keepAlive) { clearInterval(keepAlive); keepAlive = null } }
  speaking.value = true
  synth.speak(u)
  // Contournement du bug Chromium qui coupe la synthèse au bout de ~15 s.
  if (keepAlive) clearInterval(keepAlive)
  keepAlive = setInterval(() => {
    if (!synth.speaking) { clearInterval(keepAlive); keepAlive = null; return }
    if (userPaused) return
    synth.pause(); synth.resume()
  }, 9000)
  return true
}

// ---------- Voix IA cloud (ElevenLabs via Edge Function) ----------
async function speakCloud(content, opts) {
  const res = await fetch(`${SUPA_URL}/functions/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`
    },
    body: JSON.stringify({ text: content, voiceId: opts.voiceId || undefined, lang: opts.lang || 'fr' })
  })
  if (!res.ok) {
    // LE CORPS PORTE LE VRAI VERDICT. L'Edge Function rend 502 aussi bien pour
    // une panne que pour un quota épuisé — on ne peut donc pas trancher sur son
    // seul code. Elle transmet en revanche la réponse d'ElevenLabs :
    //   { error: 'elevenlabs_error', status: 401, detail: '…quota_exceeded…' }
    // C'est ce `status`-là qui dit s'il faut réessayer ou renoncer.
    let amont = null
    try { amont = await res.clone().json() } catch { /* corps non JSON : on s'en tient au code */ }
    const statutAmont = Number(amont?.status) || res.status
    const quota = /quota|credit/i.test(String(amont?.detail || ''))
    if (res.status === 503 || REFUS_DEFINITIFS.has(statutAmont)) {
      cloudRefuse.value = amont?.error === 'no_api_key'
        ? 'clé ElevenLabs absente'
        : quota ? 'quota ElevenLabs épuisé' : `ElevenLabs refuse (${statutAmont})`
      // Une fois, pas à chaque phrase : au-delà, l'avertissement noie la console
      // et masque les vraies erreurs.
      console.warn(`[tts] voix cloud abandonnée pour cette session — ${cloudRefuse.value}. Repli sur la voix du navigateur.`)
    }
    throw new Error(`tts cloud ${res.status}${amont?.status ? ` (amont ${amont.status})` : ''}`)
  }
  const blob = await res.blob()
  if (!blob || !/audio/i.test(blob.type)) throw new Error('tts cloud : réponse non audio')
  audioUrl = URL.createObjectURL(blob)
  audioEl = new Audio(audioUrl)
  audioEl.onplay = () => { speaking.value = true; paused.value = false }
  audioEl.onended = () => { speaking.value = false; paused.value = false; cleanupAudio() }
  audioEl.onerror = () => { speaking.value = false; paused.value = false }
  await audioEl.play()
}

// ---------- API publique ----------
async function speak(text, opts = {}) {
  const content = String(text || '').trim()
  if (!content) return false
  stop()
  speaking.value = true // retour visuel immédiat le temps de charger la voix cloud
  if (wantsCloud(opts)) {
    try { await speakCloud(content, opts); return true }
    catch (e) {
      // Un refus définitif a déjà été signalé (une fois) dans speakCloud, et il a
      // coupé le cloud pour la session. Ici on ne parle donc que des pannes
      // passagères, qu'on retentera à la phrase suivante.
      if (!cloudRefuse.value) console.warn('[tts] voix cloud indisponible, repli navigateur :', e.message)
    }
  }
  const ok = speakBrowser(content, opts)
  if (!ok) speaking.value = false
  return ok
}

function pause() {
  if (audioEl && !audioEl.paused) { audioEl.pause(); paused.value = true; return }
  if (synth && synth.speaking && !synth.paused) { userPaused = true; synth.pause(); paused.value = true }
}
function resume() {
  if (audioEl && audioEl.paused) { audioEl.play(); paused.value = false; return }
  if (synth && synth.paused) { userPaused = false; synth.resume(); paused.value = false }
}

// Voix cloud proposées dans l'ERP. Si la clé ElevenLabs a la permission « Voices: Read »,
// on renvoie la bibliothèque complète du compte ; sinon on garde la sélection vérifiée.
async function listVoices() {
  if (cloudAvailable) {
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
        body: JSON.stringify({ action: 'voices' })
      })
      if (res.ok) {
        const d = await res.json()
        if (Array.isArray(d?.voices) && d.voices.length) {
          return d.voices.map((v) => ({
            id: v.id,
            name: v.name,
            hint: [v.labels?.gender, v.labels?.age, v.labels?.accent].filter(Boolean).join(' · ')
          }))
        }
      }
    } catch { /* permission absente ou réseau : on garde la liste vérifiée */ }
  }
  return ELEVENLABS_VOICES
}

export function useTts() {
  // `voixPour` est exposée pour que l'on puisse VÉRIFIER le choix — de l'extérieur
  // du service, la voix retenue est autrement invisible : elle disparaît dans une
  // `SpeechSynthesisUtterance` qu'on ne peut plus interroger.
  // `cloudRefuse` est exposé pour que l'ERP puisse DIRE pourquoi la voix IA ne
  // sort pas — « quota ElevenLabs épuisé » vaut mieux qu'un sélecteur de voix
  // qui semble marcher et ne change rien à ce qu'on entend.
  return { supported, speaking, paused, voices, provider: PROVIDER, cloudEnabled, cloudAvailable, cloudRefuse, speak, stop, pause, resume, refreshVoices, listVoices, voixPour: pickVoice, devinerLangue }
}
