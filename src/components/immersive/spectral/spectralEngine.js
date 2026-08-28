// MOTEUR DU GUIDE SPECTRAL — WebXR + Three.js
//
// Il fait quatre choses, et rien d'autre :
//   1. ancrer la case grandeur nature sur un sol réel (hit-test) ;
//   2. charger les modèles compressés (Draco + meshopt) ;
//   3. placer l'avatar image par image — jamais pile devant le visiteur ;
//   4. mesurer le regard et faire tourner la machine à états.
//
// Ce qui relève de la PAROLE (voix, sous-titres, proposition affichée) sort
// d'ici par `onAction` : le moteur ne connaît ni la synthèse vocale ni le DOM
// de l'interface. C'est ce qui permet au mode audio-seul de réutiliser tout le
// reste sans une ligne de rendu.
//
// POURQUOI PAS ViroReact NI @react-three/xr. Le dépôt est une application Vue.
// ViroReact suppose React Native — donc une seconde application, un second
// pipeline de compilation, un second magasin d'identifiants. @react-three/xr
// n'est qu'un liant React autour de ces mêmes appels WebXR. Three.js seul les
// expose directement et se laisse encapsuler dans un composant Vue de soixante
// lignes. Le renoncement porte sur le liant, jamais sur la technique.

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Quaternion, Matrix4, Box3,
  AnimationMixer, Clock, HemisphereLight, DirectionalLight, RingGeometry,
  MeshBasicMaterial, Mesh, DoubleSide, Color, SRGBColorSpace, LoopRepeat
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { creerColliders, creerSuiviRegard } from './gaze.js'
import { creerGuideSpectral, ETATS } from './avatarState.js'

// Le décodeur Draco est copié dans `public/draco/`. On ne le prend PAS sur un
// CDN : la visite doit fonctionner hors ligne, et une dépendance réseau au
// milieu du chargement d'un modèle laisse le visiteur devant un sol vide.
const CHEMIN_DRACO = '/draco/'

const AXE_Y = new Vector3(0, 1, 0)
const VITESSE_MARCHE = 1.5      // m/s — au-delà, l'avatar se « téléporte »

export function estWebXrDisponible() {
  if (typeof navigator === 'undefined' || !navigator.xr) return Promise.resolve(false)
  return navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
}

// ---------------------------------------------------------------------------
// Aspect « spectral »
// ---------------------------------------------------------------------------
// Semi-transparent, sans écriture de profondeur : l'avatar se laisse traverser
// du regard, et l'on évite les artefacts de tri que produirait un personnage
// translucide devant une paroi elle-même translucide.
//
// Fusion NORMALE, pas additive. L'additif fait un plus beau fantôme dans le
// noir — et disparaît complètement dans une cour à midi, c'est-à-dire là où
// cette visite se fera. On garde donc l'opacité, et on teinte.
function rendreSpectral(racine, { opacite = 0.55, teinte = '#9fe8d4' } = {}) {
  const couleur = new Color(teinte)
  racine.traverse((n) => {
    if (!n.isMesh || !n.material) return
    const multiple = Array.isArray(n.material)
    const clones = (multiple ? n.material : [n.material]).map((m) => {
      const c = m.clone()
      c.transparent = true
      c.opacity = opacite
      c.depthWrite = false
      c.toneMapped = false
      if (c.color) c.color.lerp(couleur, 0.45)
      if (c.emissive) { c.emissive.copy(couleur); c.emissiveIntensity = 0.35 }
      return c
    })
    n.material = multiple ? clones : clones[0]
    n.castShadow = false
    n.receiveShadow = false
    n.renderOrder = 10
  })
}

// ---------------------------------------------------------------------------
export function creerMoteurSpectral({
  conteneur,                 // élément DOM : porte le canvas et sert de dom-overlay
  donnees,                   // { scene, hotspots, avatar } — voir services/spectral.js
  recitPour,                 // (hotspotId, fois) → récit publié | null
  onAction = () => {},       // parole, proposition, télémétrie
  onEtat = () => {},         // changement d'état de la machine
  onProgression = () => {}   // { phase, valeur } pendant le chargement
} = {}) {
  const cfgAvatar = donnees?.avatar || {}
  const cfgScene = donnees?.scene || {}
  const hotspots = donnees?.hotspots || []

  // ---- Three -------------------------------------------------------------
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)            // en session XR, c'est le runtime qui décide
  renderer.outputColorSpace = SRGBColorSpace
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  // 0,85 plutôt que 1 : un téléphone de milieu de gamme ne tient pas trente
  // images par seconde en pleine résolution avec un bâtiment texturé, et le
  // visiteur ne voit pas la différence à travers une caméra. À régler AVANT
  // `setSession` : après, le runtime a déjà alloué son tampon.
  renderer.xr.setFramebufferScaleFactor(0.85)

  const scene = new Scene()
  const camera = new PerspectiveCamera(70, 1, 0.05, 60)

  // Lumière neutre. L'estimation de lumière réelle est demandée en option plus
  // bas ; quand elle manque, ces deux sources évitent un modèle tout noir.
  scene.add(new HemisphereLight(0xffffff, 0x8d7b68, 1.1))
  const soleil = new DirectionalLight(0xffffff, 0.8)
  soleil.position.set(1, 4, 2)
  scene.add(soleil)

  // Réticule d'ancrage : l'anneau posé au sol tant que la case n'est pas placée.
  const reticule = new Mesh(
    new RingGeometry(0.14, 0.19, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x9fe8d4, side: DoubleSide, transparent: true, opacity: 0.9 })
  )
  reticule.matrixAutoUpdate = false
  reticule.visible = false
  scene.add(reticule)

  // Le bâtiment et tout ce qui lui est attaché vivent dans CE groupe. Ancrer la
  // case, c'est poser ce groupe une fois — les points chauds, exprimés en
  // mètres dans le repère du bâtiment, suivent sans le moindre recalcul.
  const groupeCase = new Group()
  groupeCase.visible = false
  scene.add(groupeCase)

  const groupeAvatar = new Group()
  groupeAvatar.visible = false
  scene.add(groupeAvatar)

  let colliders = null
  const occulteurs = []     // coque de la case : empêche de « voir à travers les murs »
  let mixer = null
  const clips = new Map()
  let clipCourant = null

  // ---- Chargeurs ---------------------------------------------------------
  const draco = new DRACOLoader().setDecoderPath(CHEMIN_DRACO)
  const gltf = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)

  // ---- Réglages QUI DÉPENDENT DE LA TAILLE DU BÂTIMENT --------------------
  //
  // Trois valeurs du tempérament sont calibrées pour un tolek de six mètres.
  // Elles ne se transposent pas : sur une enveloppe de vingt mètres, le rayon
  // du regard n'atteint plus la paroi d'en face, le guide prend congé alors
  // que le visiteur marche encore vers la sortie, et il commence son récit à
  // mi-chemin parce qu'il n'a pas eu le temps d'arriver.
  //
  // On les dérive donc de l'emprise, comme les points chauds le sont déjà en
  // base. Ce ne sont pas des réglages d'ambiance : ce sont des conséquences
  // géométriques, et elles n'ont rien à faire dans un formulaire.
  const emprise = Number(cfgScene.empriseM) || 6
  const rayonCase = emprise / 2

  const reglagesEchelle = {
    // Il faut pouvoir viser la paroi opposée depuis n'importe quel bord, plus
    // un peu de marge pour les points posés dehors (la sortie).
    porteeRegard: Math.max(12, emprise * 1.6),
    // « Quitter la zone » doit vouloir dire quitter le BÂTIMENT, pas atteindre
    // son seuil. Sur une case de vingt mètres, quatorze mètres, c'est encore
    // dedans.
    rayonZoneM: Math.max(14, emprise * 1.2),
    // Temps de marche réel jusqu'au point le plus éloigné, à 1,5 m/s, plus une
    // seconde de battement. Sans cela le guide parle en marchant.
    approcheMaxMs: Math.max(2600, Math.round((rayonCase / VITESSE_MARCHE) * 1000) + 1000)
  }

  // ---- État --------------------------------------------------------------
  const suivi = creerSuiviRegard({
    fixationMs: cfgAvatar.fixationMs,
    portee: reglagesEchelle.porteeRegard
  })
  const machine = creerGuideSpectral({
    config: {
      ...cfgAvatar,
      rayonZoneM: reglagesEchelle.rayonZoneM,
      approcheMaxMs: reglagesEchelle.approcheMaxMs
    },
    hotspots,
    recitPour,
    salutation: cfgAvatar.salutation || ''
  })

  let session = null
  let sourceHitTest = null
  let espaceLocal = null
  let ancreXr = null               // XRAnchor si le runtime la propose
  let ancree = false
  let poseValide = true
  let termine = false

  const horloge = new Clock()
  const posPrecedente = new Vector3()
  let posPrecedenteValide = false

  const cibleAvatar = new Vector3()
  let modeAvatar = 'suivre'        // 'suivre' | 'place'
  let cotePrefere = 1              // +1 à droite du visiteur, -1 à gauche
  let arriveEnPlace = false

  // Signaux venus de l'interface, consommés puis remis à zéro à chaque tick.
  let reponseEnAttente = null
  let recitTermine = false
  let demandeFin = false
  let questionEnAttente = ''
  let paroleCommencee = false
  let improvisationEchouee = false
  // `ecouteActive` est un NIVEAU, pas une impulsion : il vaut vrai tant que le
  // micro est ouvert. La machine sort de l'écoute quand il retombe, ce qui
  // couvre aussi bien la question posée que le visiteur qui renonce.
  let ecouteActive = false

  // Régulation d'images par seconde (voir `reguler`).
  let emaFrame = 16.7
  let palierPerf = 0
  let dernierPalierMs = 0
  let animationDemiFrequence = false
  let sauterRegard = false
  let accumAnim = 0
  let imagePaire = false

  // Dernier regard signalé à l'interface, pour ne pas la réveiller soixante
  // fois par seconde (voir `signalerRegard`).
  let dernierRegardId = null
  let dernierRegardPct = -1

  // Vecteurs réutilisés : allouer dans la boucle de rendu, c'est provoquer une
  // collecte mémoire toutes les quelques secondes — un à-coup parfaitement
  // visible en réalité augmentée.
  const vPos = new Vector3()
  const vAvant = new Vector3()
  const vTmp = new Vector3()
  const vCible = new Vector3()
  const qTmp = new Quaternion()
  const mTmp = new Matrix4()

  // -------------------------------------------------------------------------
  // Chargement
  // -------------------------------------------------------------------------
  async function charger() {
    onProgression({ phase: 'case', valeur: 0 })
    if (cfgScene.modeleUrl) {
      const res = await gltf.loadAsync(cfgScene.modeleUrl, (e) => {
        if (e.total) onProgression({ phase: 'case', valeur: e.loaded / e.total })
      })
      const m = res.scene
      m.scale.setScalar(cfgScene.echelle || 1)
      m.rotation.y = ((cfgScene.orientationDeg || 0) * Math.PI) / 180
      m.traverse((n) => {
        if (!n.isMesh) return
        n.castShadow = false
        n.receiveShadow = false
        occulteurs.push(n)
      })

      // POSER LE BÂTIMENT SUR LE SOL, PAS À TRAVERS.
      //
      // Un scan photogrammétrique sort centré sur son origine : sur la case
      // mousgoum du projet, les sommets vont de y = -3,2 à y = +3,2. Ancré tel
      // quel sur le plan détecté, la moitié du bâtiment passe sous le carrelage
      // et le visiteur se retrouve enseveli jusqu'à la taille.
      //
      // On mesure donc la boîte englobante APRÈS mise à l'échelle et rotation —
      // avant, elle décrirait un objet qui n'existe pas encore — et on remonte
      // le modèle de la hauteur de son point le plus bas. Aucun réglage à saisir
      // dans l'ERP : n'importe quel scan se pose correctement.
      const boite = new Box3().setFromObject(m)
      if (Number.isFinite(boite.min.y)) m.position.y -= boite.min.y

      groupeCase.add(m)
    }

    colliders = creerColliders(hotspots)
    groupeCase.add(colliders)

    onProgression({ phase: 'avatar', valeur: 0 })
    if (cfgAvatar.modeleUrl) {
      const res = await gltf.loadAsync(cfgAvatar.modeleUrl, (e) => {
        if (e.total) onProgression({ phase: 'avatar', valeur: e.loaded / e.total })
      })
      const a = res.scene
      a.scale.setScalar(cfgAvatar.echelle || 1)
      rendreSpectral(a, { opacite: cfgAvatar.opacite, teinte: cfgAvatar.teinte })
      groupeAvatar.add(a)
      if (res.animations?.length) {
        mixer = new AnimationMixer(a)
        for (const clip of res.animations) clips.set(nomDeClip(clip.name), clip)
      }
    }
    onProgression({ phase: 'pret', valeur: 1 })
  }

  // Ready Player Me exporte « Armature|mixamo.com|Layer0 », Blender exporte
  // « Idle.001 ». On ne peut pas imposer une convention à un fichier qu'on n'a
  // pas produit : on cherche donc par mot-clé, et tout le reste est « idle ».
  function nomDeClip(nom) {
    const n = String(nom || '').toLowerCase()
    if (/walk|marche/.test(n)) return 'walk'
    if (/talk|speak|parle/.test(n)) return 'talk'
    if (/greet|wave|salut/.test(n)) return 'greet'
    if (/bye|farewell|adieu/.test(n)) return 'farewell'
    // Le direct ajoute deux attitudes. Elles ne sont pas décoratives : sans
    // « think », l'attente de la première phrase ressemble à un plantage, et
    // sans « listen », rien ne dit au visiteur que le micro est ouvert.
    if (/think|reflex|idle_?think/.test(n)) return 'think'
    if (/listen|ecoute|hear/.test(n)) return 'listen'
    return 'idle'
  }

  function jouer(nom) {
    if (!mixer || clipCourant === nom) return
    // Tous les avatars n'ont pas cinq animations. Un modèle Ready Player Me
    // livré avec « idle » seul doit rester utilisable : on retombe dessus au
    // lieu de figer le personnage sur une pose de fin de clip.
    const clip = clips.get(nom) || clips.get('idle')
    if (!clip) return
    mixer.clipAction(clip).reset().setLoop(LoopRepeat, Infinity).fadeIn(0.35).play()
    const precedent = clipCourant && clips.get(clipCourant)
    if (precedent) mixer.clipAction(precedent).fadeOut(0.35)
    clipCourant = nom
  }

  // -------------------------------------------------------------------------
  // Session XR
  // -------------------------------------------------------------------------
  // DEUX TEMPS, ET C'EST INDISPENSABLE.
  //
  // `requestSession('immersive-ar')` exige une ACTIVATION UTILISATEUR : le
  // navigateur n'ouvre la caméra que dans la foulée immédiate d'un geste. Or
  // charger la case prend des secondes — treize méga-octets sur un réseau de
  // chefferie. En enchaînant les deux, l'attente consomme l'activation et
  // Chrome refuse la session : le visiteur appuie, patiente, et rien ne
  // s'ouvre. Le défaut est invisible en développement, où le modèle arrive en
  // trois cents millisecondes.
  //
  // On sépare donc : `preparer()` télécharge pendant que le visiteur lit la
  // marche à suivre, `demarrer()` ne fait plus qu'ouvrir la session — à un
  // geste de distance.
  let preparation = null
  function preparer() {
    if (!preparation) {
      conteneur.appendChild(renderer.domElement)
      preparation = charger()
    }
    return preparation
  }

  async function demarrer() {
    // Déjà chargé si l'interface a fait son travail ; sinon on attend ici, au
    // risque de perdre l'activation. Mieux vaut ce risque qu'un plantage.
    await preparer()

    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor', 'hit-test'],
      // `anchors` corrige la dérive : sans lui, la case glisse de quelques
      // centimètres par minute et finit par traverser un vrai mur.
      // `dom-overlay` affiche sous-titres et bouton « Terminer » PAR-DESSUS la
      // caméra — c'est lui qui rend l'accessibilité possible en session.
      optionalFeatures: ['anchors', 'dom-overlay', 'light-estimation'],
      domOverlay: { root: conteneur }
    })

    await renderer.xr.setSession(session)
    espaceLocal = renderer.xr.getReferenceSpace()

    const espaceViseur = await session.requestReferenceSpace('viewer')
    sourceHitTest = await session.requestHitTestSource({ space: espaceViseur })

    session.addEventListener('select', onTap)
    session.addEventListener('end', nettoyer)

    horloge.start()
    renderer.setAnimationLoop(boucle)
    return session
  }

  // Un appui sur l'écran : pose la case si elle ne l'est pas, répond « oui » à
  // une proposition en cours sinon. Deux gestes, un seul doigt — la réalité
  // augmentée ne laisse pas de place à une interface riche.
  function onTap() {
    if (!ancree) { ancrerIci(); return }
    if (machine.etat === ETATS.PROPOSITION) reponseEnAttente = 'oui'
  }

  function ancrerIci() {
    if (!reticule.visible) return
    groupeCase.position.setFromMatrixPosition(reticule.matrix)
    // Orientation : la case fait face au visiteur au moment de la pose. Il
    // vient de choisir son point de vue ; on le respecte plutôt que d'imposer
    // un nord qui ne veut rien dire dans une cour.
    renderer.xr.getCamera().getWorldDirection(vAvant)
    vAvant.y = 0
    if (vAvant.lengthSq() > 1e-4) {
      vAvant.normalize()
      groupeCase.rotation.y = Math.atan2(vAvant.x, vAvant.z) + Math.PI
    }
    groupeCase.visible = true
    ancree = true
    reticule.visible = false
    onAction({ type: 'ancre', position: groupeCase.position.toArray() })
  }

  // -------------------------------------------------------------------------
  // Placement de l'avatar (§3)
  // -------------------------------------------------------------------------
  // « 1,5 à 2 m, décalé, jamais pile devant » se calcule dans le plan du sol :
  // on part du visiteur, on tourne son axe de regard du décalage voulu, et on
  // avance de la distance voulue. Le choix du côté n'est pas cosmétique : du
  // mauvais côté, l'avatar se retrouve DANS une paroi.
  function calculerPoseSuivi(cible) {
    const cam = renderer.xr.getCamera()
    cam.getWorldPosition(vPos)
    cam.getWorldDirection(vAvant)
    vAvant.y = 0
    if (vAvant.lengthSq() < 1e-4) vAvant.set(0, 0, -1)
    vAvant.normalize()

    const dmin = cfgAvatar.distanceMinM ?? 1.5
    const dmax = cfgAvatar.distanceMaxM ?? 2.0
    const dist = (dmin + dmax) / 2
    const angle = (((cfgAvatar.decalageLateralDeg ?? 32) * Math.PI) / 180) * cotePrefere

    poser(cible, vPos, vAvant, angle, dist)

    // Si la position calculée sort de l'emprise de la case, on essaie l'autre
    // côté. Un guide planté dans un mur ruine l'illusion plus sûrement qu'un
    // guide mal placé.
    const rayonUtile = Math.max(0.8, (cfgScene.empriseM || 6) / 2 - 0.5)
    if (cible.distanceTo(groupeCase.position) > rayonUtile) {
      cotePrefere = -cotePrefere
      poser(cible, vPos, vAvant, -angle, dist)
      if (cible.distanceTo(groupeCase.position) > rayonUtile) {
        cible.sub(groupeCase.position).setLength(rayonUtile).add(groupeCase.position)
        cible.y = groupeCase.position.y
      }
    }
  }

  function poser(cible, origine, avant, angle, distance) {
    qTmp.setFromAxisAngle(AXE_Y, angle)
    vTmp.copy(avant).applyQuaternion(qTmp).multiplyScalar(distance)
    cible.copy(origine).add(vTmp)
    cible.y = groupeCase.position.y
  }

  // Pose de récit : à CÔTÉ de l'élément, jamais entre lui et le visiteur.
  function calculerPoseElement(cible, hotspotId, pose) {
    const h = hotspots.find((x) => x.id === hotspotId)
    if (!h) { calculerPoseSuivi(cible); return }
    const dx = pose?.dx ?? 0.9
    const dz = pose?.dz ?? 0.7
    cible.set((h.x || 0) + dx * cotePrefere, 0, (h.z || 0) + dz)
    groupeCase.localToWorld(cible)
    cible.y = groupeCase.position.y
  }

  // Déplacement amorti, plafonné à une vitesse de marche : un guide qui se
  // téléporte n'est plus un guide, c'est une interface.
  function deplacerAvatar(dt) {
    const p = groupeAvatar.position
    vTmp.copy(cibleAvatar).sub(p)
    const distance = vTmp.length()
    arriveEnPlace = distance < 0.25

    if (distance > 1e-3) {
      const k = 1 - Math.exp(-3.2 * dt)
      p.add(vTmp.setLength(Math.min(distance * k, VITESSE_MARCHE * dt)))
    }

    // Il fait face au visiteur. ATTENTION à la convention : pour un objet qui
    // n'est ni caméra ni lumière, Three.js construit la matrice avec la CIBLE
    // en premier argument. Inverser les deux fait tourner l'avatar de dos, et
    // le bug est invisible en lisant le code trop vite.
    renderer.xr.getCamera().getWorldPosition(vPos)
    vCible.copy(vPos).setY(p.y)
    mTmp.lookAt(vCible, p, AXE_Y)
    qTmp.setFromRotationMatrix(mTmp)
    groupeAvatar.quaternion.slerp(qTmp, 1 - Math.exp(-6 * dt))

    if (mixer && (clipCourant === 'idle' || clipCourant === 'walk')) {
      jouer(distance > 0.4 ? 'walk' : 'idle')
    }
  }

  // -------------------------------------------------------------------------
  // Régulation — trente images par seconde d'abord, beauté ensuite
  // -------------------------------------------------------------------------
  // Trois paliers, franchis dans cet ordre de nuisance croissante : foveation
  // (invisible), animation à 30 Hz (à peine perceptible sur une marche),
  // détection du regard une image sur deux (fixation validée ~60 ms plus tard).
  //
  // On ne redescend JAMAIS automatiquement : osciller entre deux qualités se
  // remarque bien davantage qu'une qualité constante et légèrement inférieure.
  function reguler(dtMs) {
    emaFrame = emaFrame * 0.94 + dtMs * 0.06
    if (palierPerf >= 3 || emaFrame <= 40) return   // 40 ms ≈ 25 images/s
    // Trois secondes entre deux paliers : sans ce délai, une seule secousse
    // (fin de décodage d'une texture, passage d'une notification) ferait
    // descendre les trois paliers d'affilée et dégraderait la visite entière
    // pour un incident d'une demi-seconde.
    const maintenant = performance.now()
    if (maintenant - dernierPalierMs < 3000) return
    dernierPalierMs = maintenant
    palierPerf += 1
    if (palierPerf === 1) { try { renderer.xr.setFoveation(1) } catch { /* runtime sans foveation */ } }
    if (palierPerf === 2) animationDemiFrequence = true
    if (palierPerf === 3) sauterRegard = true
    onAction({ type: 'perf', palier: palierPerf, msParImage: Math.round(emaFrame) })
  }

  // L'interface n'a pas besoin de soixante messages par seconde : on ne la
  // réveille qu'au changement de cible ou tous les 5 % de progression.
  function signalerRegard(regard) {
    const pct = Math.round(regard.progression * 20)
    if (regard.hotspotId === dernierRegardId && pct === dernierRegardPct) return
    dernierRegardId = regard.hotspotId
    dernierRegardPct = pct
    onAction({ type: 'regard', hotspotId: regard.hotspotId, progression: regard.progression })
  }

  // -------------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------------
  let dernierRegard = { hotspotId: null, dwellMs: 0, stable: false, valide: false, progression: 0 }

  function boucle(_t, frame) {
    const dt = Math.min(0.1, horloge.getDelta())
    const dtMs = dt * 1000
    imagePaire = !imagePaire
    reguler(dtMs)

    if (frame) {
      poseValide = !!frame.getViewerPose(espaceLocal)

      if (!ancree && sourceHitTest) {
        const hits = frame.getHitTestResults(sourceHitTest)
        if (hits.length) {
          const p = hits[0].getPose(espaceLocal)
          if (p) {
            reticule.visible = true
            reticule.matrix.fromArray(p.transform.matrix)
          }
          // Ancre matérielle si le runtime la propose : c'est elle qui empêche
          // la case de dériver pendant les dix minutes de la visite.
          if (!ancreXr && hits[0].createAnchor) {
            hits[0].createAnchor().then((a) => { ancreXr = a }, () => { /* non pris en charge */ })
          }
        } else {
          reticule.visible = false
        }
      }

      // Recalage sur l'ancre matérielle, quand elle existe.
      if (ancree && ancreXr) {
        const pa = frame.getPose(ancreXr.anchorSpace, espaceLocal)
        if (pa) groupeCase.position.setFromMatrixPosition(mTmp.fromArray(pa.transform.matrix))
      }
    }

    // ---- Perception ------------------------------------------------------
    const cam = renderer.xr.getCamera()
    cam.getWorldPosition(vPos)
    const deplacementM = posPrecedenteValide ? vPos.distanceTo(posPrecedente) : 0
    posPrecedente.copy(vPos)
    posPrecedenteValide = true

    if (ancree && colliders && !(sauterRegard && imagePaire)) {
      dernierRegard = suivi.evaluer(cam, colliders, occulteurs, sauterRegard ? dtMs * 2 : dtMs)
      signalerRegard(dernierRegard)
    }

    const res = machine.tick(dtMs, {
      ancre: ancree,
      perdu: !poseValide,
      regard: dernierRegard,
      deplacementM,
      distanceCentreM: ancree ? vPos.distanceTo(groupeCase.position) : 0,
      recitTermine,
      reponse: reponseEnAttente,
      arriveEnPlace,
      demandeFin,
      ecoute: ecouteActive,
      question: questionEnAttente,
      paroleCommencee,
      improvisationEchouee
    })
    reponseEnAttente = null
    recitTermine = false
    demandeFin = false
    questionEnAttente = ''
    paroleCommencee = false
    improvisationEchouee = false

    for (const a of res.actions) executer(a)

    // ---- Placement -------------------------------------------------------
    if (groupeAvatar.visible) {
      if (modeAvatar === 'suivre') calculerPoseSuivi(cibleAvatar)
      deplacerAvatar(dt)
    }

    if (mixer) {
      if (!animationDemiFrequence) {
        mixer.update(dt)
      } else {
        accumAnim += dt
        if (accumAnim >= 1 / 30) { mixer.update(accumAnim); accumAnim = 0 }
      }
    }

    renderer.render(scene, camera)
  }

  // -------------------------------------------------------------------------
  // Exécution des actions de la machine
  // -------------------------------------------------------------------------
  function executer(a) {
    switch (a.type) {
      case 'apparaitre':
        groupeAvatar.visible = true
        modeAvatar = 'suivre'
        calculerPoseSuivi(cibleAvatar)
        // L'élévation n'est pas décorative : arrivée depuis le sol, la
        // silhouette se lit comme une apparition et non comme un raté
        // d'affichage. L'amortissement de `deplacerAvatar` fait le reste.
        groupeAvatar.position.copy(cibleAvatar).setY(cibleAvatar.y - (a.elevationM || 0.35))
        onAction(a)
        break
      case 'masquer':
        groupeAvatar.visible = false
        onAction(a)
        break
      case 'suivre':
        modeAvatar = 'suivre'
        break
      case 'placer':
        modeAvatar = 'place'
        calculerPoseElement(cibleAvatar, a.hotspotId, a.pose)
        break
      case 'animer':
        jouer(a.clip)
        break
      case 'etat':
        onEtat(a)
        onAction(a)
        break
      default:
        onAction(a)
    }
  }

  // -------------------------------------------------------------------------
  function nettoyer() {
    if (termine) return
    termine = true
    renderer.setAnimationLoop(null)
    try { sourceHitTest?.cancel() } catch { /* déjà annulée */ }
    sourceHitTest = null
    if (session) {
      session.removeEventListener('select', onTap)
      session.removeEventListener('end', nettoyer)
    }
    session = null
    onAction({ type: 'session-terminee' })
  }

  return {
    preparer,
    demarrer,
    async arreter() {
      try { await session?.end() } catch { /* déjà close */ }
      nettoyer()
      renderer.dispose()
      draco.dispose()
      renderer.domElement.parentNode?.removeChild(renderer.domElement)
    },
    // La voix a fini de lire : c'est la vue qui le sait, c'est elle qui parle.
    signalerFinDeParole() { recitTermine = true },
    // Le premier mot vient d'être prononcé : la réflexion est finie, le récit
    // commence. C'est ce signal qui referme l'attente ouverte par « improviser ».
    signalerDebutDeParole() { paroleCommencee = true },
    // Le serveur a refusé ou échoué : inutile d'attendre le délai de réflexion.
    signalerEchecImprovisation() { improvisationEchouee = true },
    // Micro ouvert ou fermé. Ouvrir coupe la parole du guide sur-le-champ.
    ecouter(actif) { ecouteActive = !!actif },
    // Question transcrite (voix) ou saisie (clavier, mode audio-seul).
    poserQuestion(q) { questionEnAttente = String(q || '').trim() },
    repondre(r) { reponseEnAttente = r },
    // Demande explicite depuis l'interface : mode audio-seul, ou visiteur pour
    // qui viser du regard n'est pas un geste accessible.
    demanderPoint(id) {
      if (!machine.demander(id)) return false
      modeAvatar = 'place'
      return true
    },
    terminer() { demandeFin = true },
    get etat() { return machine.etat },
    get ancree() { return ancree },
    get renderer() { return renderer }
  }
}
