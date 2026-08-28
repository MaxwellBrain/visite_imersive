// MACHINE À ÉTATS DU GUIDE SPECTRAL
//
// Ce fichier ne connaît ni Three.js, ni le DOM, ni WebXR. Il reçoit une
// PERCEPTION (le visiteur bouge-t-il ? que regarde-t-il ? le récit est-il
// fini ?) et rend des ACTIONS (« apparais », « dis ceci », « tais-toi »,
// « place-toi là »). Le moteur 3D les exécute, la vue les affiche.
//
// POURQUOI CETTE SÉPARATION. Le comportement décrit au cahier des charges est
// presque entièrement une affaire de temporisations : 3 secondes avant
// d'apparaître, 2 secondes de fixation, 6 secondes de silence, 12 secondes
// avant une relance. Mêlé au code de rendu, cela devient introuvable — on ne
// sait plus si le guide s'est tu par respect ou parce qu'une promesse a échoué.
// Isolé ici, le tempérament du guide se lit d'un bout à l'autre, et se teste
// sans casque ni téléphone : on fait avancer l'horloge à la main.
//
// LA RÈGLE QUI GOUVERNE TOUT LE RESTE : le guide se tait par défaut. Chaque
// prise de parole doit être justifiée par un geste du visiteur — un regard
// tenu, ou une stagnation. Un guide qui parle sans y avoir été invité est un
// guide qu'on éteint.

// ---------------------------------------------------------------------------
// États
// ---------------------------------------------------------------------------
export const ETATS = Object.freeze({
  INACTIF: 'inactif',               // avant tout : rien n'est ancré
  ANCRAGE: 'ancrage',               // la case est posée, le guide n'est pas encore là
  APPARITION: 'apparition',         // fondu d'arrivée + légère élévation
  SALUTATION: 'salutation',         // 8 à 12 s, puis silence
  ACCOMPAGNEMENT: 'accompagnement', // état de repos : il suit, décalé, et se tait
  APPROCHE: 'approche',             // il se déplace vers l'élément regardé
  ECOUTE: 'ecoute',                 // le visiteur lui parle : il se tait et écoute
  REFLEXION: 'reflexion',           // la parole est demandée, le premier mot n'est pas là
  RECIT: 'recit',                   // 15 à 35 s de micro-récit
  SILENCE: 'silence',               // silence respectueux : contemplation en cours
  PROPOSITION: 'proposition',       // « veux-tu que je te montre… »
  ADIEU: 'adieu',                   // geste d'au revoir + fondu
  TERMINE: 'termine'
})

// Réglages par défaut. Ceux qui viennent de `ar_avatar_configs` les écrasent ;
// les bornes, elles, sont tenues par les CHECK de la base (voir la migration).
export const DEFAUTS = Object.freeze({
  delaiApparitionMs: 3000,      // §1 — 2 500 à 3 500
  dureeApparitionMs: 1200,      // fondu + élévation
  salutationMaxS: 10,           // §2 — 8 à 12
  fixationMs: 2000,             // §4 — 1 800 à 2 200
  recitMaxS: 35,                // §5 — garde-fou dur
  silenceContemplatifS: 6,      // §6
  relanceStagnationS: 12,       // §7
  attenteReponseS: 8,           // combien de temps une proposition reste offerte
  approcheMaxMs: 2600,          // au-delà, il raconte d'où il est plutôt que d'attendre
  adieuMs: 2400,                // §8 — geste + fondu

  // ---- Parole en direct ----------------------------------------------------
  // `false` par défaut : la machine sert alors des textes relus, et c'est le
  // comportement de repli quand Bedrock manque. Le moteur bascule à `true`
  // quand l'improvisation est disponible.
  improvisation: false,
  // ANTICIPATION. On lance la génération à 800 ms de fixation, soit bien AVANT
  // que les 2 000 ms la valident. Le pari est presque toujours bon — un regard
  // tenu près d'une seconde se tient rarement moins de deux — et il achète
  // 1,2 s, auxquelles s'ajoutent les 2,6 s d'approche. Près de quatre secondes
  // de couverture : de quoi rendre la première phrase prête à temps.
  // Un regard qui se détourne annule la génération, il ne la paie donc pas.
  seuilAnticipationMs: 800,
  // Au-delà, on renonce à improviser et on se rabat sur un texte relu. Cinq
  // secondes de silence pendant que « le guide réfléchit », c'est déjà trop.
  reflexionMaxMs: 5000,

  // Un point déjà raconté ne se redéclenche pas tout de suite. Sans ce délai,
  // le visiteur qui revient sur ses pas déclenche la même voix en boucle.
  repriseHotspotS: 45,
  // Distance parcourue (m) au-delà de laquelle on considère que le visiteur
  // s'est DÉPLACÉ. Sous ce seuil, c'est le tremblement de la main.
  seuilDeplacementM: 0.28,
  // Éloignement du centre de la case qui vaut « il quitte la zone » (§8).
  rayonZoneM: 14,
  sortieZoneS: 3
})

// Un guide qui insiste est un guide qu'on subit. Chaque refus double le délai
// avant la relance suivante, jusqu'à ne pratiquement plus rien proposer.
const PALIERS_REFUS = [1, 2, 4, 8]

// ---------------------------------------------------------------------------
// Fabrique
// ---------------------------------------------------------------------------
//
// `config`   — réglages issus de ar_avatar_configs (millisecondes / secondes).
// `hotspots` — [{ id, code, priorite, poseAvatar }] triés ou non.
// `recitPour(hotspotId)` — rend { id, texte, dureeS, audioUrl } ou null quand
//              aucun récit PUBLIÉ n'existe pour ce point. Un point sans récit
//              validé n'est jamais raconté : c'est là que se matérialise la
//              règle « validation humaine avant publication ».
export function creerGuideSpectral({ config = {}, hotspots = [], recitPour = () => null, salutation = '' } = {}) {
  const C = { ...DEFAUTS, ...config }

  let etat = ETATS.INACTIF
  let tEtat = 0            // ms passées dans l'état courant
  let horloge = 0          // ms depuis le début de la session

  // Mémoire de séance
  const racontes = new Map()   // hotspotId → { dernier: ms, fois: n }
  let refus = 0                // nombre de propositions déclinées
  let prochaineRelanceS = C.relanceStagnationS
  let cibleCourante = null     // hotspot visé (approche / récit / proposition)
  let recitCourant = null
  let demandeHotspot = null    // point réclamé depuis l'interface, consommé au tick
  let anticipe = null          // point dont la génération a déjà été lancée
  let questionEnCours = ''     // question posée, le temps d'y répondre

  // Compteurs d'inactivité, remis à zéro par tout geste du visiteur.
  let immobileMs = 0
  let sansEvenementMs = 0      // temps sans récit, sans regard tenu, sans déplacement
  let horsZoneMs = 0

  const actions = []
  const emettre = (type, charge = {}) => { actions.push({ type, ...charge }) }

  function aller(nouvel, charge = {}) {
    if (nouvel === etat) return
    emettre('etat', { de: etat, vers: nouvel, ...charge })
    etat = nouvel
    tEtat = 0
  }

  // Un point est racontable s'il porte un récit publié et qu'on ne vient pas
  // d'en parler. `fois` sert à servir une VARIANTE différente au retour.
  function racontable(hotspotId) {
    if (hotspotId == null) return false
    const vu = racontes.get(hotspotId)
    if (vu && horloge - vu.dernier < C.repriseHotspotS * 1000) return false
    // En improvisation, il y a toujours quelque chose à dire : le texte n'est
    // pas écrit d'avance, il se rédige au moment où on le demande. Exiger un
    // récit préenregistré rendrait la moitié des points muets.
    if (C.improvisation) return true
    return !!recitPour(hotspotId, vu ? vu.fois : 0)
  }

  function hotspotById(id) {
    return hotspots.find((h) => h.id === id) || null
  }

  // Le point proposé lors d'une relance : le plus prioritaire jamais raconté.
  // À défaut, le plus anciennement entendu. On ne propose jamais « la sortie »
  // à quelqu'un qui vient d'arriver — d'où le tri par priorité.
  function meilleureProposition() {
    const candidats = hotspots
      .filter((h) => racontable(h.id))
      .sort((a, b) => {
        const va = racontes.get(a.id)
        const vb = racontes.get(b.id)
        if (!va !== !vb) return va ? 1 : -1          // jamais entendu d'abord
        return (a.priorite ?? 0) - (b.priorite ?? 0)
      })
    return candidats[0] || null
  }

  // Deux voies, un seul point d'entrée. En improvisation, la machine ne connaît
  // PAS le texte : elle demande à parler et attend le premier mot (REFLEXION).
  // En repli, le texte existe déjà et la parole commence à l'instant (RECIT).
  function engagerParole({ hotspot = null, question = '' } = {}) {
    cibleCourante = hotspot
    anticipe = null
    sansEvenementMs = 0

    const vu = hotspot ? racontes.get(hotspot.id) : null
    // Une QUESTION ne consomme pas le point : le visiteur peut demander autre
    // chose que ce qu'il regarde, et il aura toujours droit au récit de
    // l'élément ensuite. Seule une narration spontanée le marque comme vu.
    if (hotspot && !question) {
      racontes.set(hotspot.id, { dernier: horloge, fois: (vu ? vu.fois : 0) + 1 })
    }
    if (hotspot) {
      emettre('placer', { pose: hotspot.poseAvatar || null, hotspotId: hotspot.id, mode: 'cote' })
    }

    if (C.improvisation) {
      recitCourant = null
      questionEnCours = question || ''
      aller(ETATS.REFLEXION, { hotspotId: hotspot?.id ?? null, question: question || null })
      emettre('improviser', { hotspotId: hotspot?.id ?? null, question: question || null })
      emettre('animer', { clip: 'think' })
      return
    }

    // ---- Repli : un texte relu, écrit d'avance --------------------------
    // Aucun texte préécrit ne répond à une question libre. Plutôt que de servir
    // un récit sans rapport, le guide dit franchement qu'il ne peut pas : c'est
    // la même honnêteté qu'en direct, appliquée à une panne.
    if (question) {
      emettre('sansReponse', { question })
      aller(ETATS.ACCOMPAGNEMENT)
      return
    }
    const recit = hotspot ? recitPour(hotspot.id, vu ? vu.fois : 0) : null
    if (!recit) { aller(ETATS.ACCOMPAGNEMENT); return }
    recitCourant = recit
    aller(ETATS.RECIT, { hotspotId: hotspot.id })
    emettre('dire', { texte: recit.texte, audioUrl: recit.audioUrl || null, kind: 'recit', hotspotId: hotspot.id, recitId: recit.id })
    emettre('animer', { clip: 'talk' })
  }

  // Conservé sous son ancien nom : c'est le point d'entrée de l'approche.
  function demarrerRecit(hotspot) { engagerParole({ hotspot }) }

  function taire(raison) {
    emettre('taire', { raison })
  }

  // Le guide vient de finir de parler. Les compteurs d'inactivité repartent de
  // zéro, et ce n'est pas un détail : sans cela, un visiteur resté immobile
  // pendant un récit de trente secondes bascule en « silence contemplatif » à
  // l'instant précis où le guide se tait. Les six secondes du §6 se comptent
  // APRÈS la dernière phrase — c'est ce qui fait la différence entre un guide
  // qui respecte un temps de contemplation et un guide qui s'éteint.
  function finDeParole() {
    immobileMs = 0
    sansEvenementMs = 0
    prochaineRelanceS = C.relanceStagnationS
  }

  // -------------------------------------------------------------------------
  // Le pas d'horloge. `dt` en millisecondes.
  //
  // `p` (perception) :
  //   ancre           bool    la case est posée et suivie
  //   perdu           bool    le suivi a décroché (on suspend tout)
  //   regard          { hotspotId, dwellMs, stable }  — voir gaze.js
  //   deplacementM    number  distance parcourue depuis le dernier pas
  //   distanceCentreM number  éloignement du centre de la case
  //   recitTermine    bool    la voix a fini de lire
  //   reponse         'oui' | 'non' | null   réponse à une proposition
  //   demandeFin      bool    le visiteur a appuyé sur « Terminer »
  // -------------------------------------------------------------------------
  function tick(dt, p = {}) {
    actions.length = 0
    horloge += dt
    tEtat += dt

    const bouge = (p.deplacementM || 0) > C.seuilDeplacementM
    immobileMs = bouge ? 0 : immobileMs + dt
    if (bouge) sansEvenementMs = 0
    else sansEvenementMs += dt

    // ---- Sorties valables depuis n'importe quel état -----------------------
    if (etat !== ETATS.ADIEU && etat !== ETATS.TERMINE) {
      if (p.demandeFin) {
        taire('fin demandée')
        emettre('animer', { clip: 'farewell' })
        emettre('fondu', { vers: 0, dureeMs: C.adieuMs })
        aller(ETATS.ADIEU, { motif: 'bouton' })
        return rendu()
      }
      // §8 — quitter la zone. On temporise : traverser le seuil pour regarder
      // dehors n'est pas partir, et un guide qui s'évapore à chaque pas de côté
      // donne le sentiment de le perdre.
      horsZoneMs = (p.distanceCentreM || 0) > C.rayonZoneM ? horsZoneMs + dt : 0
      if (horsZoneMs > C.sortieZoneS * 1000 && etat !== ETATS.INACTIF && etat !== ETATS.ANCRAGE) {
        taire('sortie de zone')
        emettre('animer', { clip: 'farewell' })
        emettre('fondu', { vers: 0, dureeMs: C.adieuMs })
        aller(ETATS.ADIEU, { motif: 'zone' })
        return rendu()
      }
    }

    // Le suivi a décroché : on masque plutôt que de laisser un fantôme flotter
    // à un endroit faux. Le guide revient quand l'ancre est retrouvée.
    if (p.perdu && etat !== ETATS.INACTIF && etat !== ETATS.TERMINE) {
      emettre('masquer', { raison: 'suivi perdu' })
      taire('suivi perdu')
      aller(ETATS.ANCRAGE)
      return rendu()
    }

    // Le visiteur PARLE : le guide se tait, à l'instant. Rien n'est plus
    // pénible qu'une voix de synthèse qui poursuit sa phrase pendant qu'on
    // essaie de l'interrompre. C'est ce qui fait qu'on renonce à parler aux
    // assistants vocaux.
    if (p.ecoute && etat !== ETATS.ECOUTE &&
        etat !== ETATS.ADIEU && etat !== ETATS.TERMINE && etat !== ETATS.INACTIF) {
      taire('le visiteur parle')
      emettre('animer', { clip: 'listen' })
      aller(ETATS.ECOUTE)
      return rendu()
    }

    // Une question posée prime sur tout : c'est la seule parole que le visiteur
    // ait explicitement sollicitée.
    const questionPosee = String(p.question || '').trim()
    if (questionPosee && etat !== ETATS.ADIEU && etat !== ETATS.TERMINE && etat !== ETATS.INACTIF) {
      taire('question posée')
      engagerParole({
        // Le point regardé n'est qu'un CONTEXTE : « et celui-là, il servait à
        // quoi ? » n'a de sens que si l'on sait ce qu'il a sous les yeux.
        hotspot: p.regard?.hotspotId != null ? hotspotById(p.regard.hotspotId) : null,
        question: questionPosee
      })
      return rendu()
    }

    // Demande explicite du visiteur (liste des points, mode audio-seul). Elle
    // prime sur tout sauf la fin de visite : c'est la seule parole qu'il ait
    // vraiment sollicitée, et la faire attendre serait absurde.
    if (demandeHotspot != null) {
      const h = hotspotById(demandeHotspot)
      demandeHotspot = null
      if (h && etat !== ETATS.ADIEU && etat !== ETATS.TERMINE && etat !== ETATS.INACTIF) {
        cibleCourante = h
        taire('nouvelle demande')
        emettre('placer', { pose: h.poseAvatar || null, hotspotId: h.id, mode: 'cote' })
        emettre('animer', { clip: 'walk' })
        aller(ETATS.APPROCHE, { hotspotId: h.id, motif: 'demande' })
        return rendu()
      }
    }

    switch (etat) {
      // ---------------------------------------------------------------------
      case ETATS.INACTIF:
        if (p.ancre) aller(ETATS.ANCRAGE)
        break

      // §1 — délai avant apparition. Il n'est pas décoratif : le visiteur vient
      // de voir un bâtiment surgir, il a besoin de ces trois secondes pour lui.
      case ETATS.ANCRAGE:
        if (!p.ancre) break
        if (tEtat >= C.delaiApparitionMs) {
          emettre('apparaitre', { dureeMs: C.dureeApparitionMs, elevationM: 0.35 })
          emettre('animer', { clip: 'idle' })
          aller(ETATS.APPARITION)
        }
        break

      case ETATS.APPARITION:
        if (tEtat >= C.dureeApparitionMs) {
          if (salutation) {
            emettre('animer', { clip: 'greet' })
            emettre('dire', { texte: salutation, kind: 'salutation' })
          }
          aller(ETATS.SALUTATION)
        }
        break

      // §2 — salutation COURTE. Deux sorties : la voix s'est tue, ou le plafond
      // est atteint. Le plafond est un garde-fou, pas la durée visée : une voix
      // de synthèse lente ne doit pas transformer « bonjour » en conférence.
      case ETATS.SALUTATION:
        if (p.recitTermine || tEtat >= C.salutationMaxS * 1000) {
          if (!p.recitTermine) taire('salutation trop longue')
          emettre('animer', { clip: 'idle' })
          finDeParole()
          aller(ETATS.ACCOMPAGNEMENT)
        }
        break

      // ---------------------------------------------------------------------
      // §3 — état de repos. Il suit, décalé, et il SE TAIT.
      // ---------------------------------------------------------------------
      case ETATS.ACCOMPAGNEMENT: {
        emettre('suivre', {})

        const g = p.regard

        // ANTICIPATION. La génération part à 800 ms de fixation, avant que les
        // 2 000 ms la valident. C'est ce qui fait la différence entre un guide
        // qui répond et un guide qui charge : quand le regard est confirmé, la
        // première phrase est déjà rédigée. Un regard qui se détourne annule la
        // requête, donc ne la paie pas.
        if (C.improvisation && g && g.stable && g.hotspotId != null &&
            g.dwellMs >= C.seuilAnticipationMs && anticipe !== g.hotspotId &&
            racontable(g.hotspotId)) {
          anticipe = g.hotspotId
          emettre('preparer', { hotspotId: g.hotspotId })
        }
        if (anticipe != null && (!g || !g.stable || g.hotspotId !== anticipe)) {
          emettre('annulerPreparation', { hotspotId: anticipe })
          anticipe = null
        }

        // §4 — regard tenu sur un point : c'est la seule invitation à parler
        // que le visiteur n'a pas à formuler.
        if (g && g.stable && g.dwellMs >= C.fixationMs && racontable(g.hotspotId)) {
          const h = hotspotById(g.hotspotId)
          if (h) {
            cibleCourante = h
            emettre('placer', { pose: h.poseAvatar || null, hotspotId: h.id, mode: 'cote' })
            emettre('animer', { clip: 'walk' })
            aller(ETATS.APPROCHE, { hotspotId: h.id })
            break
          }
        }

        // §6 — silence respectueux. Le visiteur est arrêté et il regarde :
        // il n'attend rien de nous. Ne rien faire est ici le comportement.
        if (immobileMs >= C.silenceContemplatifS * 1000 && g && g.stable) {
          taire('contemplation')
          emettre('animer', { clip: 'idle' })
          aller(ETATS.SILENCE)
          break
        }

        // §7 — relance. Uniquement sur une STAGNATION : ni déplacement, ni
        // regard tenu, ni récit récent. C'est le visiteur perdu, pas le visiteur
        // absorbé — la nuance tient entièrement au `g.stable` ci-dessus.
        if (sansEvenementMs >= prochaineRelanceS * 1000) {
          const cible = meilleureProposition()
          if (cible) {
            cibleCourante = cible
            emettre('proposer', { hotspotId: cible.id, libelle: cible.libelle, code: cible.code })
            aller(ETATS.PROPOSITION, { hotspotId: cible.id })
          } else {
            // Plus rien à montrer : on n'insiste pas, et on n'y revient plus.
            sansEvenementMs = 0
            prochaineRelanceS = C.relanceStagnationS * PALIERS_REFUS[PALIERS_REFUS.length - 1]
          }
        }
        break
      }

      // ---------------------------------------------------------------------
      case ETATS.APPROCHE:
        // Il marche vers l'élément. S'il n'y arrive pas (visiteur au milieu du
        // chemin, place trop étroite), il raconte quand même : mieux vaut un
        // guide mal placé qu'un guide qui reste coincé.
        if (p.arriveEnPlace || tEtat >= C.approcheMaxMs) {
          if (cibleCourante) demarrerRecit(cibleCourante)
          else aller(ETATS.ACCOMPAGNEMENT)
        }
        break

      // Le guide écoute. Il ne fait RIEN d'autre : pas d'animation d'attente
      // bavarde, pas de relance. Il sort d'ici par la question (garde-fou
      // global) ou par l'abandon du visiteur.
      case ETATS.ECOUTE:
        emettre('suivre', { discret: true })
        if (!p.ecoute) {
          emettre('animer', { clip: 'idle' })
          finDeParole()
          aller(ETATS.ACCOMPAGNEMENT)
        }
        break

      // La parole a été demandée, le premier mot n'est pas encore arrivé.
      // Cet état existe pour une seule raison : donner un VISAGE à l'attente.
      // Sans lui, le guide reste figé une seconde et l'on croit à un bug ; avec
      // lui, il a l'air de chercher ses mots, ce qu'il fait.
      case ETATS.REFLEXION:
        emettre('suivre', { discret: true })
        if (p.paroleCommencee) {
          emettre('animer', { clip: 'talk' })
          aller(ETATS.RECIT, { hotspotId: cibleCourante?.id ?? null })
        } else if (p.improvisationEchouee || tEtat >= C.reflexionMaxMs) {
          // Deux façons d'arriver ici : le serveur a dit non tout de suite
          // (Bedrock coupé, quota, hors ligne), ou il n'a rien dit du tout. La
          // première n'a aucune raison d'attendre le délai de la seconde : cinq
          // secondes de silence pour une panne déjà connue seraient gratuites.
          // Trop long. On se rabat sur un texte relu s'il en existe un pour ce
          // point : mieux vaut une phrase écrite d'avance qu'un guide muet.
          const vu = cibleCourante ? racontes.get(cibleCourante.id) : null
          const secours = cibleCourante && !questionEnCours
            ? recitPour(cibleCourante.id, vu ? Math.max(0, vu.fois - 1) : 0)
            : null
          emettre('replier', { hotspotId: cibleCourante?.id ?? null, secours: !!secours })
          if (secours) {
            recitCourant = secours
            emettre('dire', {
              texte: secours.texte, audioUrl: secours.audioUrl || null,
              kind: 'recit', hotspotId: cibleCourante.id, recitId: secours.id
            })
            emettre('animer', { clip: 'talk' })
            aller(ETATS.RECIT, { hotspotId: cibleCourante.id, motif: 'repli' })
          } else {
            taire('génération trop lente')
            emettre('animer', { clip: 'idle' })
            finDeParole()
            aller(ETATS.ACCOMPAGNEMENT)
          }
        }
        break

      // §5 — récit. Trois façons d'en sortir, et une seule est la bonne :
      // que le texte se termine.
      case ETATS.RECIT: {
        const plafond = Math.min(C.recitMaxS, recitCourant?.dureeS ? recitCourant.dureeS + 6 : C.recitMaxS)
        if (p.recitTermine) {
          emettre('animer', { clip: 'idle' })
          finDeParole()
          aller(ETATS.ACCOMPAGNEMENT)
        } else if (bouge && tEtat > 2500 && (p.deplacementM || 0) > C.seuilDeplacementM * 3) {
          // Le visiteur s'en va au milieu d'une phrase : il a répondu. On
          // s'arrête net plutôt que de le poursuivre en parlant.
          taire('le visiteur se déplace')
          emettre('animer', { clip: 'idle' })
          finDeParole()
          aller(ETATS.ACCOMPAGNEMENT)
        } else if (tEtat >= plafond * 1000) {
          taire('plafond de durée')
          emettre('animer', { clip: 'idle' })
          finDeParole()
          aller(ETATS.ACCOMPAGNEMENT)
        }
        break
      }

      // §6 — silence total. On ne joue même pas d'animation d'attente bavarde.
      // Il en sort si le visiteur bouge, ou s'il pose les yeux sur AUTRE CHOSE :
      // ce regard-là est une question.
      case ETATS.SILENCE: {
        emettre('suivre', { discret: true })
        const g = p.regard
        const nouveauRegard = g && g.stable && g.dwellMs >= C.fixationMs && racontable(g.hotspotId)
        if (bouge || nouveauRegard) {
          sansEvenementMs = 0
          aller(ETATS.ACCOMPAGNEMENT)
        }
        break
      }

      // §7 — la proposition attend, elle ne se répète pas.
      case ETATS.PROPOSITION:
        if (p.reponse === 'oui' && cibleCourante) {
          refus = 0
          prochaineRelanceS = C.relanceStagnationS
          emettre('placer', { pose: cibleCourante.poseAvatar || null, hotspotId: cibleCourante.id, mode: 'cote' })
          emettre('animer', { clip: 'walk' })
          aller(ETATS.APPROCHE, { hotspotId: cibleCourante.id })
        } else if (p.reponse === 'non' || bouge || tEtat >= C.attenteReponseS * 1000) {
          emettre('retirerProposition', {})
          refus = Math.min(refus + 1, PALIERS_REFUS.length - 1)
          prochaineRelanceS = C.relanceStagnationS * PALIERS_REFUS[refus]
          sansEvenementMs = 0
          aller(ETATS.ACCOMPAGNEMENT)
        }
        break

      case ETATS.ADIEU:
        if (tEtat >= C.adieuMs) {
          emettre('masquer', { raison: 'fin de visite' })
          aller(ETATS.TERMINE)
        }
        break

      case ETATS.TERMINE:
      default:
        break
    }

    return rendu()
  }

  function rendu() {
    return {
      etat,
      cible: cibleCourante,
      actions: actions.slice(),
      // Utile au débogage sur téléphone, où aucun profileur n'est disponible.
      debug: { horloge, tEtat, immobileMs, sansEvenementMs, prochaineRelanceS, refus }
    }
  }

  return {
    tick,
    get etat() { return etat },
    get racontes() { return racontes },
    // Le visiteur peut demander un point depuis l'interface (mode audio-only,
    // ou accessibilité : viser du regard n'est pas donné à tout le monde).
    // La demande est mise EN ATTENTE, pas exécutée sur-le-champ : `tick` vide
    // sa liste d'actions à chaque pas, et celles qu'on empilerait ici seraient
    // perdues au pas suivant. On dépose une intention, le tick la consomme.
    demander(hotspotId) {
      if (!hotspotById(hotspotId)) return false
      demandeHotspot = hotspotId
      return true
    },
    reinitialiser() {
      etat = ETATS.INACTIF; tEtat = 0; horloge = 0
      racontes.clear(); refus = 0; prochaineRelanceS = C.relanceStagnationS; demandeHotspot = null
      cibleCourante = null; recitCourant = null; anticipe = null; questionEnCours = ''
      immobileMs = 0; sansEvenementMs = 0; horsZoneMs = 0
    }
  }
}
