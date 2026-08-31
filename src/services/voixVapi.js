// AGENT VOCAL TEMPS RÉEL — le navigateur parle à Vapi, Vapi parle à notre serveur.
//
// CE FICHIER REMPLACE `voixXai.js`, ET IL EST TROIS FOIS PLUS COURT. Tout ce
// qu'on avait écrit à la main pour xAI — capture PCM 16 bits, AudioWorklet,
// ordonnancement des fragments reçus, annulation de l'audio déjà programmé —
// disparaît. Vapi tient la conversation sur son propre transport (WebRTC), et
// ce module n'est plus qu'un branchement : un jeton, un identifiant de pièce,
// quatre évènements.
//
// LE PROMPT NE PASSE PLUS PAR ICI, ET C'EST LE VRAI GAIN. Chez xAI, le
// navigateur posait lui-même les instructions dans `session.update` : notre
// serveur les rédigeait, mais c'est ce fichier qui les transmettait, donc
// n'importe qui pouvait les remplacer depuis la console. Désormais l'assistant
// Vapi appelle `outils-vapi` et reçoit son dossier directement. Ce module ne
// connaît même pas le texte que la pièce va dire.
//
// CE QU'IL ENVOIE, EN REVANCHE : l'identifiant de la pièce regardée, et celui
// du visiteur. Ni l'un ni l'autre n'est un secret — le premier est déjà dans
// l'URL de la page, le second est tiré au sort par ce navigateur — et le
// serveur ne rend, pour n'importe quel identifiant, que le dossier d'une pièce
// PUBLIÉE.

import { ref } from 'vue'
import { getPublicTenant } from './publicApi'

/**
 * L'IDENTIFIANT DU VISITEUR — ce qui permet à la pièce de ne pas se répéter.
 *
 * Tiré au sort ici, gardé dans le stockage local, jamais transmis ailleurs qu'à
 * notre propre serveur. Il ne dit pas QUI vous êtes : il dit que ce
 * navigateur-là est déjà passé devant cette pièce-là. Vider son stockage
 * l'efface, et l'objet vous accueille de nouveau comme un inconnu.
 *
 * ON NE FAIT PAS ÉCHOUER LA SESSION SI LE STOCKAGE EST FERMÉ. Navigation
 * privée, réglages restrictifs, iframe cloisonnée : dans ces cas-là on renvoie
 * `null`, et le serveur se comporte exactement comme avant la mémoire. Un
 * visiteur sans souvenir vaut mieux qu'un visiteur sans voix.
 */
const CLE_VISITEUR = 'musea.visiteur'

export function identifiantVisiteur() {
  try {
    let v = localStorage.getItem(CLE_VISITEUR)
    if (!v) {
      v = (crypto.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(CLE_VISITEUR, v)
    }
    return v
  } catch {
    return null
  }
}

/**
 * Ouvre une session vocale sur une pièce.
 *
 * L'interface est IDENTIQUE à celle de l'ancien module xAI — mêmes états, mêmes
 * rappels, même valeur de retour. C'est délibéré : `ObjectGuideRobot.vue` pilote
 * un avatar avec quatre allures, et changer de fournisseur ne doit pas obliger à
 * réécrire l'animation.
 *
 * @param {object} opts
 *   objectId, tenantId, langue
 *   surEtat(etat)        'connexion' | 'ecoute' | 'parle' | 'pense' | 'inactif'
 *   surTexte(t, deQui)   transcription, pour la région lue par les lecteurs d'écran
 *   surFin(motif)        la session s'est terminée
 */
export function creerSessionVocale(opts = {}) {
  const etat = ref('inactif')
  const amplitude = ref(0)
  const derniereParole = ref('')

  let vapi = null
  let vivant = false

  const poser = (e) => { etat.value = e; opts.surEtat?.(e) }

  async function demarrer() {
    if (vivant) return { ok: true }
    poser('connexion')

    // 1. LE LAISSEZ-PASSER. Notre Edge Function vérifie que la pièce existe et
    //    est publiée, applique le plafond par empreinte, puis signe un JWT qui
    //    n'autorise QU'UN assistant. Rien de tout cela ne peut être court-circuité
    //    depuis ce fichier.
    let laissezPasser
    try {
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jeton-voix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          objectId: opts.objectId,
          // LE CLOISONNEMENT VIENT DE L'ORGANISATION CONSULTÉE, jamais d'une
          // prop du composant. Le layout public l'a résolue depuis le nom
          // d'hôte ; s'en remettre au `tenant_id` porté par la fiche laisserait
          // un visiteur de la chefferie A ouvrir une session facturée sur une
          // pièce de la chefferie B.
          tenantId: getPublicTenant() ?? opts.tenantId ?? null,
          lang: opts.langue || 'fr'
        })
      })
      laissezPasser = await r.json()
      if (!r.ok || !laissezPasser?.jeton) {
        // On remonte le MOTIF tel quel : « no_key » n'appelle pas la même action
        // que « trop_de_demandes », et l'appelant doit pouvoir le dire.
        return { ok: false, motif: laissezPasser?.error || `jeton ${r.status}` }
      }
    } catch (e) {
      return { ok: false, motif: 'reseau', detail: e?.message }
    }

    // 2. LE SDK, CHARGÉ SEULEMENT MAINTENANT. Vapi embarque Daily.co : plusieurs
    //    centaines de kilo-octets, pour une fonctionnalité que la plupart des
    //    visiteurs n'ouvriront jamais. L'importer statiquement les ferait tous
    //    payer, sur un site déjà lourd en 3D et sur des réseaux qui ne
    //    pardonnent pas.
    let Vapi
    try {
      Vapi = (await import('@vapi-ai/web')).default
    } catch (e) {
      console.warn('[voix vapi] SDK indisponible', e)
      return { ok: false, motif: 'sdk_indisponible' }
    }

    vivant = true
    vapi = new Vapi(laissezPasser.jeton)

    // ---- Les quatre allures de l'avatar ------------------------------------
    vapi.on('call-start', () => poser('ecoute'))

    // `speech-start` / `speech-end` portent sur l'ASSISTANT. C'est lui qu'on
    // anime : le visiteur, lui, se voit parler tout seul.
    vapi.on('speech-start', () => { if (vivant) poser('parle') })
    vapi.on('speech-end', () => { if (vivant) poser('ecoute') })

    // L'énergie réelle de sa voix, entre 0 et 1. C'est la seule animation de
    // tout l'avatar qui suive un son plutôt qu'une minuterie — c'est elle qui
    // fait qu'il paraît articuler au lieu de clignoter.
    vapi.on('volume-level', (v) => { amplitude.value = Math.min(1, Number(v) || 0) })

    vapi.on('message', (m) => {
      // Les transcriptions arrivent en deux temps : `partial` pendant que la
      // phrase se forme, `final` quand elle est arrêtée. On ne retient que les
      // finales — une région lue par un lecteur d'écran qui se réécrit à chaque
      // mot est illisible.
      if (m?.type !== 'transcript' || m?.transcriptType !== 'final') return
      const texte = String(m.transcript || '')
      if (!texte) return
      if (m.role === 'assistant') {
        derniereParole.value = texte
        opts.surTexte?.(texte, 'objet')
      } else {
        opts.surTexte?.(texte, 'visiteur')
      }
    })

    vapi.on('error', (e) => {
      console.warn('[voix vapi]', e?.errorMsg || e?.message || e)
      if (vivant) { opts.surFin?.('erreur'); arreter() }
    })
    vapi.on('call-end', () => { if (vivant) { opts.surFin?.('fin'); arreter() } })

    // 3. LA SESSION. `variableValues` remplit les {{…}} du prompt de
    //    l'assistant ; c'est par là que la pièce apprend QUI elle est, et le
    //    visiteur qu'elle a déjà rencontré.
    try {
      await vapi.start(laissezPasser.assistantId, {
        variableValues: {
          objectId: laissezPasser.objet?.id ?? opts.objectId,
          tenantId: laissezPasser.objet?.tenantId ?? '',
          lang: opts.langue || 'fr',
          visiteur: identifiantVisiteur() || '',
        },
      })
    } catch (e) {
      vivant = false
      // Le refus du micro est le cas le plus fréquent, et il ne se règle pas au
      // même endroit qu'une panne : autant le nommer.
      const motif = /permission|denied|notallowed/i.test(String(e?.message || e))
        ? 'micro_refuse' : 'demarrage'
      console.warn('[voix vapi] démarrage impossible', e)
      return { ok: false, motif, detail: e?.message }
    }

    poser('pense')
    return { ok: true, objet: laissezPasser.objet }
  }

  function arreter() {
    vivant = false
    amplitude.value = 0
    try { vapi?.removeAllListeners?.() } catch { /* déjà détaché */ }
    try { vapi?.stop() } catch { /* déjà fermée */ }
    vapi = null
    poser('inactif')
  }

  /**
   * COUPER LA PAROLE À LA MAIN.
   *
   * À utiliser avec parcimonie : chez Vapi, la vraie interruption est de PARLER.
   * Le serveur détecte la voix du visiteur et coupe l'agent de lui-même — c'est
   * tout l'intérêt d'être passé chez eux, et c'est plus naturel qu'un bouton.
   *
   * Ce bouton reste utile dans une salle bruyante, où la détection hésite. Le
   * SDK n'expose pas d'annulation de réponse : le seul levier est de faire taire
   * la sortie, puis de la rétablir pour la suite. On coupe donc le son plutôt
   * que la pensée — le visiteur, lui, n'entend pas la différence.
   */
  function interrompre() {
    if (!vapi || !vivant) return
    try {
      vapi.send({ type: 'control', control: 'mute-assistant' })
      amplitude.value = 0
      poser('ecoute')
      setTimeout(() => {
        try { vapi?.send({ type: 'control', control: 'unmute-assistant' }) } catch { /* session finie */ }
      }, 400)
    } catch (e) {
      console.warn('[voix vapi] interruption impossible', e)
    }
  }

  return { etat, amplitude, derniereParole, demarrer, arreter, interrompre }
}

// Le navigateur sait-il faire ce que demande cette voie ? Vapi passe par WebRTC ;
// sur un appareil trop ancien, mieux vaut ne rien proposer qu'un bouton mort.
export const voixTempsReelPossible =
  typeof window !== 'undefined' &&
  typeof RTCPeerConnection !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia
