import { supabase } from './supabase'

// AGENT VOCAL EN DIRECT — le visiteur parle à l'œuvre, l'œuvre lui répond.
//
// CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS
//
// Il ouvre une WebSocket vers l'API Live de Google, y pousse le micro et joue
// ce qui revient. Il ne connaît NI la clé d'API, NI la consigne donnée au
// modèle : les deux vivent dans l'Edge Function `gemini-live`, qui délivre un
// jeton éphémère à usage unique. Un jeton récupéré dans la console ne peut
// ouvrir qu'une conversation sur cette œuvre — pas un Gemini généraliste.
//
// AUCUNE DÉPENDANCE. Le SDK officiel ferait la même chose, mais npm est hors
// service sur ce poste (MUSEA_MASTER_PLAN §6) et le protocole tient en une
// WebSocket, deux AudioContext et du base64.
//
// LES DEUX FRÉQUENCES, QU'IL NE FAUT PAS CONFONDRE
//   entrée  : PCM 16 bits, 16 kHz — c'est ce qu'exige l'API.
//   sortie  : PCM 16 bits, 24 kHz — c'est ce qu'elle renvoie.
// Les jouer à la même fréquence donne une voix trop grave ou trop aiguë. C'est
// l'erreur qu'on fait une fois, et qu'on entend immédiatement.

const ECHANTILLON_ENTREE = 16000
const ECHANTILLON_SORTIE = 24000

// base64 ⇄ octets. `btoa` ne prend pas d'Uint8Array, et un `String.fromCharCode`
// appliqué d'un coup sur 100 000 octets fait sauter la pile d'appels : on
// découpe.
function versBase64(octets) {
  let s = ''
  const pas = 0x8000
  for (let i = 0; i < octets.length; i += pas) {
    s += String.fromCharCode.apply(null, octets.subarray(i, i + pas))
  }
  return btoa(s)
}

function depuisBase64(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Demande un laissez-passer pour une œuvre. Renvoie { ok, jeton, setup, url… }
 * ou { ok:false, error, message } — jamais d'exception : l'appelant affiche.
 */
export async function demanderJeton(objectId, tenantId = null) {
  const { data, error } = await supabase.functions.invoke('gemini-live', {
    body: { objectId, tenantId }
  })
  if (error) {
    // `invoke` masque le corps des réponses d'erreur : on va le rechercher,
    // sinon le conservateur ne saurait jamais QUE la clé manque.
    try {
      const corps = await error.context?.json?.()
      if (corps) return { ok: false, ...corps }
    } catch { /* on garde le message générique */ }
    return { ok: false, error: 'reseau', message: error.message }
  }
  return data?.ok ? data : { ok: false, ...(data || { error: 'reponse_vide' }) }
}

/**
 * Ouvre la conversation. Renvoie un objet de commande :
 *   { fermer(), couperMicro(bool), etat }
 *
 * `ecouteurs` :
 *   onEtat(cle)              connexion | ecoute | parle | fermee
 *   onTexte({role, texte})   transcriptions, au fil de l'eau
 *   onErreur(message)
 */
export async function ouvrirConversation({ jeton, setup, url }, ecouteurs = {}) {
  const { onEtat = () => {}, onTexte = () => {}, onErreur = () => {} } = ecouteurs

  // ---- Micro d'abord ------------------------------------------------------
  // On demande l'autorisation AVANT d'ouvrir la WebSocket : si le visiteur
  // refuse, autant ne pas avoir consommé le jeton (il est à usage unique).
  let flux
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,   // sans quoi le modèle s'entend et se répond
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  } catch (e) {
    onErreur(e?.name === 'NotAllowedError' ? 'micro_refuse' : 'micro_indisponible')
    return null
  }

  // Deux contextes distincts : les fréquences d'entrée et de sortie diffèrent,
  // et un AudioContext n'en a qu'une.
  const ctxEntree = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: ECHANTILLON_ENTREE })
  const ctxSortie = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: ECHANTILLON_SORTIE })

  let ws = null
  let noeud = null
  let micCoupe = false
  let ferme = false

  // File de lecture : on enchaîne les morceaux bout à bout. `prochain` est la
  // date à laquelle le suivant doit commencer — sans elle, les morceaux se
  // superposeraient et la voix serait inintelligible.
  let prochain = 0
  const sources = new Set()

  function jouer(pcm16) {
    const n = pcm16.length
    const tampon = ctxSortie.createBuffer(1, n, ECHANTILLON_SORTIE)
    const canal = tampon.getChannelData(0)
    for (let i = 0; i < n; i++) canal[i] = pcm16[i] / 32768
    const src = ctxSortie.createBufferSource()
    src.buffer = tampon
    src.connect(ctxSortie.destination)
    const debut = Math.max(ctxSortie.currentTime, prochain)
    src.start(debut)
    prochain = debut + tampon.duration
    sources.add(src)
    src.onended = () => sources.delete(src)
  }

  // INTERRUPTION — le visiteur reprend la parole pendant que l'œuvre parle.
  // Le modèle nous prévient ; il faut alors FAIRE TAIRE ce qui est déjà
  // programmé, sinon on entend la fin d'une réponse abandonnée par-dessus la
  // suivante. C'est ce détail qui sépare une conversation d'un audioguide.
  function faireTaire() {
    for (const s of sources) { try { s.stop() } catch { /* déjà finie */ } }
    sources.clear()
    prochain = 0
  }

  onEtat('connexion')

  await new Promise((resolve, reject) => {
    // Le jeton éphémère se présente à la place de la clé, en paramètre.
    ws = new WebSocket(`${url}?access_token=${encodeURIComponent(jeton)}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      // Le `setup` vient du serveur et part TEL QUEL : il doit concorder avec
      // les contraintes épinglées dans le jeton.
      ws.send(JSON.stringify({ setup }))
      resolve()
    }
    ws.onerror = () => reject(new Error('websocket'))
  }).catch(() => {
    onErreur('connexion_impossible')
    flux.getTracks().forEach((t) => t.stop())
    ctxEntree.close(); ctxSortie.close()
    return null
  })

  if (!ws || ws.readyState !== WebSocket.OPEN) return null

  ws.onmessage = async (ev) => {
    // Les messages arrivent tantôt en texte, tantôt en Blob selon le navigateur.
    let brut = ev.data
    if (brut instanceof Blob) brut = await brut.text()
    else if (brut instanceof ArrayBuffer) brut = new TextDecoder().decode(brut)

    let msg
    try { msg = JSON.parse(brut) } catch { return }

    if (msg.setupComplete) { onEtat('ecoute'); return }

    const sc = msg.serverContent
    if (!sc) return

    if (sc.interrupted) { faireTaire(); onEtat('ecoute'); return }

    // Transcriptions : ce que le visiteur a dit, ce que l'œuvre répond.
    if (sc.inputTranscription?.text) onTexte({ role: 'visiteur', texte: sc.inputTranscription.text })
    if (sc.outputTranscription?.text) onTexte({ role: 'oeuvre', texte: sc.outputTranscription.text })

    for (const part of sc.modelTurn?.parts || []) {
      const b64 = part?.inlineData?.data
      if (!b64) continue
      const octets = depuisBase64(b64)
      // Vue alignée : l'API renvoie du 16 bits petit-boutiste, ce qui est déjà
      // l'ordre des machines visées. On évite une recopie inutile.
      jouer(new Int16Array(octets.buffer, octets.byteOffset, octets.byteLength >> 1))
      onEtat('parle')
    }

    if (sc.turnComplete) onEtat('ecoute')
  }

  ws.onclose = () => { if (!ferme) { onEtat('fermee'); nettoyer() } }

  // ---- Le micro part vers la WebSocket ------------------------------------
  try {
    await ctxEntree.audioWorklet.addModule('/pcm-capture.js')
  } catch (e) {
    onErreur('worklet_indisponible')
    nettoyer()
    return null
  }
  const source = ctxEntree.createMediaStreamSource(flux)
  noeud = new AudioWorkletNode(ctxEntree, 'pcm-capture', {
    processorOptions: { cible: ECHANTILLON_ENTREE }
  })
  noeud.port.onmessage = (e) => {
    if (micCoupe || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      realtimeInput: {
        audio: { data: versBase64(new Uint8Array(e.data)), mimeType: `audio/pcm;rate=${ECHANTILLON_ENTREE}` }
      }
    }))
  }
  source.connect(noeud)
  // On NE relie PAS le nœud à la destination : le brancher renverrait la voix
  // du visiteur dans ses propres enceintes, avec le larsen qui va avec.

  function nettoyer() {
    ferme = true
    try { noeud?.port.postMessage('stop') } catch { /* déjà arrêté */ }
    try { noeud?.disconnect() } catch { /* idem */ }
    flux.getTracks().forEach((t) => t.stop())
    faireTaire()
    if (ctxEntree.state !== 'closed') ctxEntree.close()
    if (ctxSortie.state !== 'closed') ctxSortie.close()
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close()
  }

  return {
    fermer() { onEtat('fermee'); nettoyer() },
    // Couper le micro n'arrête pas la session : on cesse simplement d'envoyer.
    couperMicro(v) { micCoupe = !!v },
    // Écrire quand on ne peut pas parler — salle bruyante, visiteur muet.
    envoyerTexte(texte) {
      if (!texte?.trim() || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: texte.trim() }] }],
          turnComplete: true
        }
      }))
    }
  }
}
