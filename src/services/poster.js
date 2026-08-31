// MODE PHOTO « POSTER » — repartir avec une image, pas seulement un souvenir.
//
// Le visiteur cadre la pièce comme il l'entend, appuie, et reçoit une affiche
// aux couleurs de l'institution : la vue 3D ou RA, un bandeau, le nom de
// l'œuvre, celui du musée, et un QR qui ramène à la fiche. C'est la fonction la
// plus partagée de ce genre de dispositif, parce qu'elle produit un objet — et
// qu'un objet circule là où une visite ne circule pas.
//
// TOUT SE FAIT DANS UN CANEVAS, EN MÉMOIRE. Aucun service, aucun téléversement,
// aucune dépendance : `<model-viewer>` sait rendre sa vue courante en image, le
// reste est du dessin 2D. C'est ce qui permet à la fonction de marcher hors
// ligne et de ne rien coûter.
//
// LE PIÈGE QU'IL FAUT CONNAÎTRE — `toBlob()` de model-viewer échoue si le
// canevas WebGL a été « sali » par une texture servie sans en-tête CORS. C'est
// le même mécanisme qui oblige `PanoramaViewer` à demander le mode anonyme.
// On ne peut pas le contourner : on le NOMME, pour que l'échec soit lisible
// plutôt que mystérieux.

import { qrSvg } from './qrcode'

const LARGEUR = 1080          // format carré, celui que les réseaux recadrent le moins
const HAUTEUR = 1350          // 4:5 — le plus haut toléré sans rognage sur mobile
const MARGE = 48

function svgVersImage(svg) {
  return new Promise((resolve) => {
    if (!svg) return resolve(null)
    const img = new Image()
    // `onload` SUFFIT, et il faut s'y tenir. J'avais d'abord attendu `decode()`,
    // pour être sûr que l'image soit « prête à peindre » — mais `decode()` ne se
    // résout JAMAIS dans un onglet masqué : le navigateur diffère le décodage
    // tant que rien n'est visible, et toute la composition restait suspendue.
    // Or `drawImage` sur une image chargée fonctionne, visible ou non.
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    // Filet : un SVG malformé n'émet parfois NI load NI error. Sans borne, le
    // poster ne se composerait jamais et le bouton tournerait indéfiniment.
    setTimeout(() => resolve(null), 3000)
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

// Découpe un titre trop long sans couper les mots. Un nom d'œuvre déborde vite :
// « Masque-éléphant mbap mteng » ne tient pas sur une ligne à cette taille.
function lignes(ctx, texte, largeurMax, maxLignes = 2) {
  const mots = String(texte || '').split(/\s+/).filter(Boolean)
  const out = []
  let courante = ''
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot
    if (ctx.measureText(essai).width <= largeurMax || !courante) courante = essai
    else { out.push(courante); courante = mot }
    if (out.length === maxLignes) break
  }
  if (courante && out.length < maxLignes) out.push(courante)
  // Le dernier mot coupé se signale par des points de suspension, plutôt que de
  // laisser croire que le titre s'arrête là.
  if (out.length === maxLignes && mots.join(' ') !== out.join(' ')) {
    out[maxLignes - 1] = out[maxLignes - 1].replace(/\s*\S*$/, '…')
  }
  return out
}

/**
 * Compose l'affiche.
 *
 * @param {HTMLElement} modelViewer  l'élément <model-viewer> à photographier
 * @param {object} opts
 *   titre, musee, lien (encodé en QR), couleur (accent), marque
 * @returns {Promise<{ blob: Blob, url: string }>}
 */
export async function composerPoster(modelViewer, opts = {}) {
  if (!modelViewer?.toBlob) throw new Error('visionneuse-absente')

  // 1. La vue courante, telle que le visiteur l'a cadrée.
  let vue
  try {
    vue = await modelViewer.toBlob({ idealAspect: false, mimeType: 'image/png' })
  } catch {
    // Message NOMMÉ : c'est presque toujours une texture sans CORS, et le
    // conservateur doit pouvoir le corriger au lieu de deviner.
    throw new Error('texture-non-cors')
  }
  const photo = await createImageBitmap(vue)

  const c = document.createElement('canvas')
  c.width = LARGEUR
  c.height = HAUTEUR
  const ctx = c.getContext('2d')

  const accent = opts.couleur || '#0e6f5c'

  // 2. Fond. Un dégradé sombre plutôt qu'un aplat : la pièce s'y détache, et
  //    l'affiche ne ressemble pas à une capture d'écran.
  const fond = ctx.createLinearGradient(0, 0, 0, HAUTEUR)
  fond.addColorStop(0, '#14110d')
  fond.addColorStop(1, '#241f18')
  ctx.fillStyle = fond
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR)

  // 3. La vue, recadrée en « cover » dans la zone haute — sans jamais déformer.
  const zoneH = HAUTEUR - 300
  const ech = Math.max(LARGEUR / photo.width, zoneH / photo.height)
  const pw = photo.width * ech
  const ph = photo.height * ech
  ctx.drawImage(photo, (LARGEUR - pw) / 2, (zoneH - ph) / 2, pw, ph)

  // Voile bas : il garantit que le texte reste lisible quelle que soit la pièce
  // photographiée. Sans lui, un modèle clair rend le titre invisible.
  const voile = ctx.createLinearGradient(0, zoneH - 220, 0, HAUTEUR)
  voile.addColorStop(0, 'rgba(20,17,13,0)')
  voile.addColorStop(0.45, 'rgba(20,17,13,.92)')
  voile.addColorStop(1, '#14110d')
  ctx.fillStyle = voile
  ctx.fillRect(0, zoneH - 220, LARGEUR, HAUTEUR - zoneH + 220)

  // 4. Filet d'accent — la seule touche de couleur de l'institution.
  ctx.fillStyle = accent
  ctx.fillRect(MARGE, HAUTEUR - 252, 96, 6)

  // 5. Textes.
  ctx.textBaseline = 'top'
  ctx.fillStyle = 'rgba(255,255,255,.62)'
  ctx.font = '600 26px Georgia, serif'
  ctx.fillText(String(opts.musee || opts.marque || '').toUpperCase().slice(0, 42), MARGE, HAUTEUR - 226)

  ctx.fillStyle = '#fdfbf7'
  ctx.font = '700 62px Georgia, serif'
  const largeurTitre = LARGEUR - MARGE * 2 - 200      // on réserve la place du QR
  const l = lignes(ctx, opts.titre || '', largeurTitre)
  l.forEach((ligne, i) => ctx.fillText(ligne, MARGE, HAUTEUR - 178 + i * 68))

  // 6. Le QR : c'est lui qui fait de l'affiche un lien vers la collection.
  //    Sans lui, l'image circule sans jamais ramener personne.
  if (opts.lien) {
    const img = await svgVersImage(qrSvg(opts.lien, { size: 150 }))
    if (img) {
      const x = LARGEUR - MARGE - 150
      const y = HAUTEUR - 190
      ctx.fillStyle = '#fdfbf7'
      ctx.fillRect(x - 10, y - 10, 170, 170)         // marge blanche : un QR sans
      ctx.drawImage(img, x, y, 150, 150)             // quiet zone ne se lit pas
    }
  }

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('composition-impossible')
  return { blob, url: URL.createObjectURL(blob) }
}

/**
 * Propose l'affiche au visiteur. Deux voies, dans cet ordre :
 *
 *  1. LE PARTAGE NATIF (`navigator.share` avec fichier). Sur téléphone, c'est
 *     le geste attendu : la photo part vers WhatsApp, les messages, la galerie.
 *  2. LE TÉLÉCHARGEMENT, partout ailleurs.
 *
 * On ne tente le partage QUE si le navigateur déclare savoir partager CE
 * fichier : `canShare` est le seul test fiable, `share` existant sur des
 * navigateurs qui refusent les fichiers.
 */
export async function offrirPoster({ blob, url }, nomFichier = 'musea.png') {
  const fichier = new File([blob], nomFichier, { type: 'image/png' })
  if (navigator.canShare?.({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier] }); return 'partage' }
    catch (e) {
      // L'utilisateur a fermé la feuille de partage : ce n'est pas une panne,
      // et lui imposer un téléchargement derrière serait impoli.
      if (e?.name === 'AbortError') return 'annule'
    }
  }
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  return 'telecharge'
}
