// PAROLE EN DIRECT — consommation du flux et découpe en phrases.
//
// L'Edge Function `guide-spectral-live` renvoie le texte AU FIL de sa
// production. On ne peut pas le donner tel quel à la synthèse vocale : elle
// prononcerait « Le foy », puis « er central est », par fragments arbitraires.
//
// On recompose donc des PHRASES, et on ne rend une phrase que lorsqu'elle est
// entière. La première arrive en cinq à huit cents millisecondes ; pendant
// qu'elle est prononcée — deux à trois secondes — la suite finit de s'écrire.
// La voix devient le tampon : c'est ce qui rend le direct tenable.
//
// CE QUI SE PASSE QUAND ÇA RATE. Bedrock indisponible, quota épuisé, réseau
// coupé, musée qui a désactivé l'improvisation : le flux rend `{ repli: true }`
// et l'appelant retombe sur les récits relus de `ar_recits`. Le visiteur ne
// doit jamais entendre le silence d'une panne — au pire, il entend un texte
// écrit d'avance, ce qui reste un guide.

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// ---------------------------------------------------------------------------
// Découpe en phrases
// ---------------------------------------------------------------------------
// Deux pièges, qui ne se voient qu'en écoutant :
//
//  1. « M. » ou « 1. » ne terminent pas une phrase. D'où la longueur minimale :
//     un fragment de huit caractères n'est pas une phrase, c'est une abréviation.
//  2. Une phrase très longue sans ponctuation retarderait la première parole.
//     Au-delà d'un certain seuil, on coupe sur une virgule — moins joli, mais
//     préférable à trois secondes de silence.
const LONGUEUR_MIN = 24
const LONGUEUR_COUPURE = 220

export function creerDecoupeur() {
  let tampon = ''

  return {
    // Rend les phrases devenues complètes, et garde le reste pour la suite.
    pousser(fragment) {
      tampon += fragment
      const phrases = []

      for (;;) {
        // Fin de phrase : ponctuation forte suivie d'une espace ou d'un guillemet.
        let coupe = -1
        const m = /[.!?…](\s|$)/g
        let r
        while ((r = m.exec(tampon)) !== null) {
          if (r.index + 1 >= LONGUEUR_MIN) { coupe = r.index + 1; break }
        }
        // Rien de net, mais le tampon s'allonge : on coupe sur une virgule.
        if (coupe < 0 && tampon.length > LONGUEUR_COUPURE) {
          const v = tampon.lastIndexOf(', ', LONGUEUR_COUPURE)
          if (v > LONGUEUR_MIN) coupe = v + 1
        }
        if (coupe < 0) break

        const phrase = tampon.slice(0, coupe).trim()
        tampon = tampon.slice(coupe).trimStart()
        if (phrase) phrases.push(phrase)
      }
      return phrases
    },
    // Ce qui reste à la fermeture du flux : la dernière phrase n'a pas
    // toujours de point, et elle doit être dite quand même.
    vider() {
      const reste = tampon.trim()
      tampon = ''
      return reste ? [reste] : []
    }
  }
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
// Elle porte l'historique : c'est ce qui distingue un guide d'une succession de
// monologues. Sans lui, le modèle redit au troisième point ce qu'il a dit au
// premier, et ne comprend pas « et celui-là ? ».
export function creerConversation({ sceneId, session, lang = 'fr' }) {
  const historique = []
  const dejaVus = []
  const debutVisite = Date.now()
  let enCours = null            // AbortController de la génération courante

  function annuler() {
    // Couper la génération quand le visiteur détourne le regard n'est pas une
    // politesse : sans cela, l'anticipation ferait payer chaque coup d'œil au
    // prix d'un récit entier.
    try { enCours?.abort() } catch { /* déjà terminée */ }
    enCours = null
  }

  // Générateur asynchrone. Rend :
  //   { phrase }                      une phrase prête à être prononcée
  //   { fin, id, latenceMs, aveu }    la génération est terminée
  //   { repli, raison }               il faut se rabattre sur un récit relu
  async function* parler({ hotspot = null, question = '' } = {}) {
    annuler()
    const ctrl = new AbortController()
    enCours = ctrl

    let res
    try {
      res = await fetch(`${SUPA_URL}/functions/v1/guide-spectral-live`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`
        },
        body: JSON.stringify({
          sceneId, session, lang,
          hotspotId: hotspot?.id ?? null,
          question: question || undefined,
          historique,
          contexte: {
            dejaVus,
            dureeVisiteS: Math.round((Date.now() - debutVisite) / 1000)
          }
        })
      })
    } catch (e) {
      // Y compris une annulation : l'appelant ne doit pas la traiter comme une
      // panne, mais dans les deux cas il n'y a rien à prononcer.
      yield { repli: true, raison: ctrl.signal.aborted ? 'annulée' : e.message }
      return
    }

    if (!res.ok || !res.body) {
      yield { repli: true, raison: `réponse ${res.status}` }
      return
    }

    // Une réponse JSON plutôt qu'un flux : c'est un refus explicite du serveur
    // (improvisation coupée, hors sujet, aucune notice). Il est structuré.
    if (!/text\/event-stream/i.test(res.headers.get('Content-Type') || '')) {
      const data = await res.json().catch(() => ({}))
      if (data.texte) { yield { phrase: data.texte }; yield { fin: true, id: null } }
      else yield { repli: true, raison: data.raison || data.error || 'réponse inattendue' }
      return
    }

    const decoupeur = creerDecoupeur()
    const lecteur = res.body.getReader()
    const decodeur = new TextDecoder()
    let reste = ''
    let complet = ''

    try {
      for (;;) {
        const { done, value } = await lecteur.read()
        if (value) reste += decodeur.decode(value, { stream: true })

        // Les événements SSE sont séparés par une ligne vide. Un événement peut
        // arriver en deux morceaux : on ne traite que ceux qui sont complets.
        let sep
        while ((sep = reste.indexOf('\n\n')) >= 0) {
          const bloc = reste.slice(0, sep)
          reste = reste.slice(sep + 2)
          if (!bloc.startsWith('data: ')) continue

          let evt
          try { evt = JSON.parse(bloc.slice(6)) } catch { continue }

          if (evt.t) {
            complet += evt.t
            for (const phrase of decoupeur.pousser(evt.t)) yield { phrase }
          } else if (evt.erreur || evt.repli) {
            yield { repli: true, raison: evt.erreur || evt.raison }
            return
          } else if (evt.fin) {
            for (const phrase of decoupeur.vider()) yield { phrase }
            // La mémorisation n'est PAS faite ici : une génération anticipée que
            // le visiteur n'entend jamais — il a détourné le regard une seconde
            // trop tôt — polluerait la conversation d'un tour qui n'a pas eu
            // lieu, et le modèle croirait avoir déjà parlé du foyer. C'est
            // l'appelant qui mémorise, quand il a réellement prononcé le texte.
            yield { fin: true, id: evt.id, latenceMs: evt.latenceMs, aveu: evt.aveu, texte: complet }
            return
          }
        }
        if (done) break
      }
      // Flux interrompu sans événement de fin : on prononce ce qu'on a.
      for (const phrase of decoupeur.vider()) yield { phrase }
      yield { fin: true, id: null, incomplet: true, texte: complet }
    } finally {
      enCours = null
    }
  }

  // L'historique nourrit le prompt du tour suivant. On y met le TOUR DU
  // VISITEUR tel que le serveur l'a compris — sa question, ou le fait qu'il ait
  // regardé tel point — pour que le modèle relise une conversation cohérente
  // plutôt qu'une liste de ses propres tirades.
  function memoriser({ hotspot, question, texte }) {
    historique.push({
      role: 'user',
      texte: question || `[il regarde ${hotspot?.libelle || 'un élément'}]`
    })
    historique.push({ role: 'assistant', texte })
    while (historique.length > 16) historique.shift()
    if (hotspot?.libelle && !dejaVus.includes(hotspot.libelle)) dejaVus.push(hotspot.libelle)
  }

  return {
    parler,
    annuler,
    memoriser,
    get dejaVus() { return dejaVus },
    get historique() { return historique }
  }
}

// ---------------------------------------------------------------------------
// Signalement
// ---------------------------------------------------------------------------
// Le seul geste d'écriture laissé au visiteur. Il compte : c'est lui qui
// remplace, côté public, la relecture qui n'a plus lieu avant. Une phrase
// signalée remonte immédiatement dans la file du conservateur.
export async function signaler(supabase, improvisationId, motif = '') {
  if (!improvisationId) return false
  const { error } = await supabase
    .from('ar_improvisations')
    .update({ signale: true, motif: motif.slice(0, 300) || null })
    .eq('id', improvisationId)
  return !error
}
