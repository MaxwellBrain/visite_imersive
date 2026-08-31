// NARRATION INTERACTIVE — le guide propose, s'adapte, et peut changer de peau.
//
// Trois mécanismes distincts, réunis ici parce qu'ils partagent le même état :
// ce qui a déjà été raconté, et comment le visiteur se comporte.
//
//  1. EMBRANCHEMENTS — au lieu de dérouler une notice, le guide offre deux
//     chemins : « la fabrication, ou son usage dans les cérémonies ? ». Deux
//     visites du même objet ne se ressemblent plus.
//
//  2. TEMPÉRAMENT — quelqu'un qui répond par trois mots et fait tourner l'objet
//     sans arrêt n'attend pas le même discours que quelqu'un qui pose une
//     question longue et ne bouge plus. On mesure, et on adapte la longueur, le
//     débit et la profondeur.
//
//  3. MODE CONTEUR — l'objet parle à la première personne. Pour les enfants et
//     les groupes.
//
// POURQUOI L'ÉTAT DES BRANCHES VIT ICI, ET NON DANS LE MODÈLE
//
// On pourrait demander au modèle de « proposer deux choix » et de se souvenir
// de ce qu'il a déjà dit. Il le ferait mal : il oublie, il se répète, et rien
// ne garantit qu'il propose deux axes réellement distincts. Le CLIENT tient
// donc la liste des axes et coche ceux qui ont été consommés ; le modèle ne
// fait que la phrase. Chacun son métier — c'est la même règle que pour la
// liste `cree` de l'assistant d'installation, dont le récapitulatif du modèle
// s'était révélé faux.

// Les six angles par lesquels on peut raconter une pièce de patrimoine. Fermés
// à dessein : un vocabulaire ouvert produirait deux propositions qui se
// recouvrent (« son histoire » / « son passé »), et le choix perdrait son sens.
export const AXES = {
  fabrication: {
    label: 'sa fabrication',
    mots: ['fabric', 'fabriqu', 'faire', 'fait', 'atelier', 'artisan', 'sculpt', 'techni', 'outil', 'made', 'making', 'craft'],
    consigne: "Raconte COMMENT la pièce a été faite : le geste, l'outil, le temps qu'il faut, la main qui la façonne."
  },
  ceremonie: {
    label: 'son usage lors des cérémonies',
    mots: ['cérémon', 'ceremon', 'rituel', 'fête', 'fete', 'danse', 'usage', 'servait', 'utilis', 'ritual', 'dance', 'used'],
    consigne: "Raconte QUAND et COMMENT elle servait : l'occasion, qui la portait ou la maniait, ce qui se passait autour."
  },
  matiere: {
    label: 'la matière dont elle est faite',
    mots: ['matièr', 'matier', 'bois', 'perle', 'métal', 'metal', 'terre', 'tissu', 'material', 'wood', 'bead'],
    consigne: "Raconte la MATIÈRE : d'où elle vient, pourquoi celle-là, ce qu'elle devient en vieillissant."
  },
  symbolique: {
    label: 'ce que ses motifs signifient',
    mots: ['symbol', 'signifi', 'motif', 'veut dire', 'représent', 'represent', 'meaning', 'pattern'],
    consigne: "Raconte ce que les FORMES disent : le motif, l'animal, la couleur, et le statut que cela signale."
  },
  personnage: {
    label: 'le chef à qui elle appartenait',
    mots: ['chef', 'roi', 'fo', 'sultan', 'qui', 'propriétaire', 'proprietaire', 'king', 'owner', 'whose'],
    consigne: "Raconte la PERSONNE : à qui elle était, ce que sa possession disait de son rang."
  },
  voyage: {
    label: 'son voyage jusqu\'à aujourd\'hui',
    mots: ['voyage', 'histoire', 'devenu', 'arriv', 'conserv', 'musée', 'musee', 'aujourd', 'journey', 'history', 'today'],
    consigne: "Raconte le PARCOURS de la pièce jusqu'à nous : ce qu'elle a traversé, comment elle est arrivée ici."
  }
}

const CLES = Object.keys(AXES)

// Le visiteur demande explicitement qu'on abrège. C'est le signal le plus fort
// qui soit : il prime sur toute mesure de comportement.
const PRESSE = /(vite|rapide|cours?t|abrège|abrege|passe|suivant|bref|next|quick|short|skip)/i
// Une vraie question, par opposition à un acquiescement.
const QUESTION = /(\?|pourquoi|comment|qu'est|quest-ce|c'est quoi|combien|quand|où |ou est|explique|why|how|what|when|where)/i

function normaliser(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Crée l'état de narration d'UNE visite. Un objet par visionneuse ouverte :
 * deux pièces regardées à la suite ne partagent ni leurs branches ni les
 * mesures de comportement.
 */
export function creerNarration() {
  const axesVus = new Set()
  let propositionEnCours = null      // [cleA, cleB] en attente de réponse
  let interactions = 0               // gestes sur la pièce
  let debut = Date.now()
  const longueurs = []               // nombre de mots de chaque parole du visiteur
  let questions = 0
  let presseDemande = false

  return {
    /** Un geste réel sur la pièce (rotation, toucher). */
    noterInteraction() { interactions++ },

    /** Une parole du visiteur : c'est la mesure la plus fiable des trois. */
    noterParole(texte) {
      const t = String(texte || '').trim()
      if (!t) return
      longueurs.push(t.split(/\s+/).filter(Boolean).length)
      if (QUESTION.test(t)) questions++
      if (PRESSE.test(t)) presseDemande = true
    },

    /**
     * TEMPÉRAMENT DU VISITEUR, déduit de ce qu'il fait — jamais déclaré.
     *
     *   presse        répond court, manipule beaucoup, ou le dit franchement
     *   curieux       pose de vraies questions, parle en phrases
     *   contemplatif  regarde longtemps, parle peu, ne bouscule rien
     *
     * Le défaut est `curieux` : c'est le moins risqué. Traiter un curieux en
     * pressé lui retire ce qu'il était venu chercher ; l'inverse ne fait
     * qu'allonger un peu.
     */
    temperament() {
      if (presseDemande) return 'presse'
      const moyenne = longueurs.length
        ? longueurs.reduce((a, b) => a + b, 0) / longueurs.length
        : 0
      const secondes = (Date.now() - debut) / 1000
      if (questions >= 1 && moyenne >= 5) return 'curieux'
      if (longueurs.length >= 2 && moyenne <= 3.5) return 'presse'
      // Beaucoup de manipulation en peu de temps : il cherche, il ne savoure pas.
      if (interactions >= 12 && secondes < 45) return 'presse'
      if (secondes > 75 && longueurs.length <= 1 && interactions <= 6) return 'contemplatif'
      return 'curieux'
    },

    /**
     * Ce que le tempérament change concrètement. Le débit compte autant que la
     * longueur : un texte court dit lentement reste lent à écouter.
     */
    reglages(temp = this.temperament()) {
      switch (temp) {
        case 'presse':
          return { motsMin: 20, motsMax: 40, debit: 1.06,
                   ton: "Va droit au fait. Une seule idée, la plus frappante, et tu t'arrêtes." }
        case 'contemplatif':
          return { motsMin: 45, motsMax: 85, debit: 0.90,
                   ton: "Prends ton temps. Décris ce qu'il a sous les yeux avant d'expliquer, laisse respirer les phrases." }
        default:
          return { motsMin: 40, motsMax: 75, debit: 0.95,
                   ton: "Donne un détail précis qu'on ne devine pas en regardant." }
      }
    },

    /**
     * Deux axes encore inexplorés, à proposer au visiteur. `null` quand tout a
     * été raconté — le guide cesse alors de proposer, au lieu de tourner en
     * rond sur des choix qu'il a déjà servis.
     */
    proposerDeuxAxes() {
      const libres = CLES.filter((c) => !axesVus.has(c))
      if (libres.length < 2) { propositionEnCours = null; return null }
      // Tirage plutôt qu'ordre fixe : deux visiteurs devant la même pièce ne
      // doivent pas recevoir la même proposition.
      const melange = libres.slice().sort(() => Math.random() - 0.5)
      propositionEnCours = [melange[0], melange[1]]
      return propositionEnCours.map((c) => ({ cle: c, label: AXES[c].label }))
    },

    /**
     * Le visiteur a-t-il choisi l'un des deux axes proposés ?
     *
     * On ne cherche PAS à comprendre finement : on compte les mots-clés de
     * chaque axe dans sa phrase, et on tranche s'il y a un vainqueur net. En
     * cas d'égalité ou de silence, on renvoie `null` et la phrase repart au
     * modèle comme une question ordinaire — ce qui est le bon comportement :
     * un visiteur qui répond « et le grenier ? » n'a pas choisi, il demande
     * autre chose, et le lui refuser serait absurde.
     */
    reconnaitreChoix(phrase) {
      if (!propositionEnCours) return null
      const t = normaliser(phrase)
      if (!t) return null

      // « le premier » / « la seconde » : une façon très naturelle de répondre
      // à un choix oral, qu'aucun mot-clé thématique ne rattraperait.
      if (/\b(le |la )?(premier|premiere|1er|first|one)\b/.test(t)) return propositionEnCours[0]
      if (/\b(le |la )?(second|seconde|deuxieme|2e|2eme|two|latter)\b/.test(t)) return propositionEnCours[1]

      const score = propositionEnCours.map((cle) =>
        AXES[cle].mots.reduce((n, m) => n + (t.includes(normaliser(m)) ? 1 : 0), 0))
      if (score[0] === score[1]) return null
      const gagnant = score[0] > score[1] ? 0 : 1
      return score[gagnant] > 0 ? propositionEnCours[gagnant] : null
    },

    /** Marque un axe comme raconté, pour qu'il ne soit plus reproposé. */
    consommer(cle) {
      if (cle) axesVus.add(cle)
      propositionEnCours = null
    },

    consigneAxe(cle) { return AXES[cle]?.consigne || '' },
    labelAxe(cle) { return AXES[cle]?.label || '' },
    axesRestants() { return CLES.filter((c) => !axesVus.has(c)).length },
    propositionCourante() { return propositionEnCours },

    reinitialiser() {
      axesVus.clear(); propositionEnCours = null
      interactions = 0; longueurs.length = 0; questions = 0
      presseDemande = false; debut = Date.now()
    }
  }
}

/**
 * MODE CONTEUR — l'objet parle de lui-même.
 *
 * Ce n'est pas un simple changement de ton : c'est un changement de LOCUTEUR,
 * et il faut le dire au modèle en toutes lettres, sinon il glisse en deux
 * phrases vers le commentaire à la troisième personne.
 *
 * Le garde-fou est le même que partout ailleurs — un objet qui parle peut
 * inventer sa vie avec beaucoup de charme. L'ancrage sur les notices publiées
 * reste entier ; c'est la VOIX qui change, pas la source.
 */
export function personaConteur(nomObjet) {
  return [
    `Tu n'es plus le guide : TU ES « ${nomObjet || 'cette pièce'} », et tu parles de toi à la première personne.`,
    `Tu t'adresses à un enfant ou à un groupe : phrases courtes, images concrètes, ton vivant et bienveillant.`,
    `Tu peux t'étonner, te souvenir, avoir des préférences — mais tu n'inventes AUCUN fait : tout ce que tu`,
    `racontes de ton histoire doit venir des notices fournies. Quand tu ne sais pas, dis-le à ta manière`,
    `(« ça, je ne m'en souviens plus »), jamais en inventant.`,
    `Pas de vocabulaire savant, pas de dates si elles ne sont pas dans les notices, pas d'humour au dépens`,
    `de qui que ce soit.`
  ].join(' ')
}
