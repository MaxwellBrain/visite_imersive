// Carte de partage — la « carte de visite » d'une œuvre, prête pour WhatsApp.
//
// POURQUOI CE FICHIER EXISTE
//
// Au Cameroun, la promotion d'une exposition se fait sur WhatsApp, pas sur un
// communiqué de presse. Or coller un lien dans une conversation ne montre rien :
// l'aperçu Open Graph n'apparaît que si le destinataire a du réseau, que si le
// serveur répond assez vite, et jamais dans un statut. Une IMAGE, elle, part
// toujours, se voit dans la liste des discussions, et survit au transfert.
//
// On fabrique donc l'image nous-mêmes, dans le navigateur du conservateur :
// aucune dépendance (npm est hors service sur ce poste, cf. MUSEA_MASTER_PLAN §6),
// aucun aller-retour serveur, et le résultat est visible avant l'envoi.
//
// Le QR n'est pas décoratif : dans un statut WhatsApp ou sur une capture d'écran
// transférée, le lien n'est plus cliquable. Le QR reste, lui, scannable.

import { qrMatrix } from './qrcode'
import { canonicalOrigin } from './host'

// Carré 1080×1080 : WhatsApp recompresse et recadre agressivement les images qui
// ne sont ni carrées ni au format 9:16. Le carré traverse indemne le message,
// le statut et le partage vers Facebook. Un 1200×630 (format Open Graph) y serait
// rogné des deux côtés — donc amputé du nom de l'œuvre.
const COTE = 1080
const MARGE = 64
const PHOTO_H = 648 // 60 % : assez pour que l'œuvre domine, assez peu pour le texte
const QR_TAILLE = 200
const FOND = '#0E1211'

const SANS = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"

// ---------------------------------------------------------------------------
// Outils de dessin
// ---------------------------------------------------------------------------

// Le canvas ne patiente PAS après les polices web : dessiner avant leur
// chargement produit une carte en Times. On attend donc explicitement.
// `document.fonts` manque sur les navigateurs anciens — on n'échoue pas pour ça.
async function policesPretes() {
  try { await document.fonts?.ready } catch { /* police par défaut, tant pis */ }
}

function chargerImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    // Sans cet en-tête, une photo servie par un autre domaine « teinte » le canvas
    // et toDataURL lève une SecurityError. On le demande ; si le serveur refuse,
    // le onerror nous ramène ici avec null et la carte se dessine sans photo.
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Découpe le texte en lignes qui tiennent dans `largeur`, au plus `maxLignes`.
// La dernière ligne tronquée reçoit une ellipse : mieux vaut « Trône royal
// perlé de… » qu'un nom qui déborde de la carte.
function lignes(ctx, texte, largeur, maxLignes) {
  const mots = String(texte || '').trim().split(/\s+/).filter(Boolean)
  const out = []
  let ligne = ''
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot
    if (ctx.measureText(essai).width <= largeur || !ligne) { ligne = essai; continue }
    out.push(ligne)
    ligne = mot
    if (out.length === maxLignes) break
  }
  if (out.length < maxLignes && ligne) out.push(ligne)
  if (out.length === maxLignes && mots.length) {
    // Reste-t-il des mots non placés ? Alors on signale la coupe.
    const place = out.join(' ').split(/\s+/).length
    if (place < mots.length) {
      let derniere = out[maxLignes - 1]
      while (derniere && ctx.measureText(derniere + '…').width > largeur) {
        derniere = derniere.slice(0, -1)
      }
      out[maxLignes - 1] = derniere + '…'
    }
  }
  return out
}

// Interlettrage manuel : `ctx.letterSpacing` n'existe pas partout (Safari < 17),
// et une ligne de capitales sans respiration est illisible.
function texteEspace(ctx, texte, x, y, espace) {
  let curseur = x
  for (const c of String(texte)) {
    ctx.fillText(c, curseur, y)
    curseur += ctx.measureText(c).width + espace
  }
  return curseur - x - espace
}

function largeurEspacee(ctx, texte, espace) {
  const s = String(texte)
  if (!s) return 0
  let w = 0
  for (const c of s) w += ctx.measureText(c).width + espace
  return w - espace
}

// `ctx.roundRect` est récent (Chrome 99, Safari 16) : on trace à la main.
function rectArrondi(ctx, x, y, w, h, r) {
  const rayon = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rayon, y)
  ctx.arcTo(x + w, y, x + w, y + h, rayon)
  ctx.arcTo(x + w, y + h, x, y + h, rayon)
  ctx.arcTo(x, y + h, x, y, rayon)
  ctx.arcTo(x, y, x + w, y, rayon)
  ctx.closePath()
}

// Recadrage « cover » : on remplit la zone sans jamais déformer l'œuvre.
function dessinerCouvrant(ctx, img, x, y, w, h) {
  const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * ratio
  const dh = img.naturalHeight * ratio
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  // Cadrage centré en largeur, remonté en hauteur : sur une photo d'objet, le
  // sujet est presque toujours dans le tiers supérieur.
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * 0.35, dw, dh)
  ctx.restore()
}

// QR dessiné module par module, sur fond clair : un QR sombre sur fond sombre
// n'est lu par aucun téléphone.
function dessinerQr(ctx, lien, x, y, taille) {
  let m
  try {
    m = qrMatrix(lien)
  } catch {
    return false // lien trop long pour la version 6 : on se passe du QR
  }
  const quiet = 4
  const n = m.length + quiet * 2
  const pas = taille / n

  ctx.fillStyle = '#FFFFFF'
  rectArrondi(ctx, x - 10, y - 10, taille + 20, taille + 20, 14)
  ctx.fill()

  ctx.fillStyle = '#101210'
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (!m[r][c]) continue
      // +1 sur les côtés : sans ce chevauchement, l'arrondi du sous-pixel laisse
      // des filets blancs entre les modules et le QR devient illisible.
      ctx.fillRect(x + (c + quiet) * pas, y + (r + quiet) * pas, pas + 1, pas + 1)
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// La carte
// ---------------------------------------------------------------------------

/**
 * Dessine la carte et renvoie { dataUrl, avecPhoto, avecQr }.
 * Rien ici ne lève : une carte imparfaite vaut mieux qu'un bouton qui échoue.
 */
export async function carteObjet({
  nom = '',
  nomCommun = '',
  photo = '',
  lieu = '',
  marque = '',
  couleur = '#0e6f5c',
  lien = '',
  has3d = false
} = {}) {
  await policesPretes()
  const img = await chargerImage(photo)

  const canvas = document.createElement('canvas')
  canvas.width = COTE
  canvas.height = COTE
  const ctx = canvas.getContext('2d')
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = FOND
  ctx.fillRect(0, 0, COTE, COTE)

  // ---- Zone haute : l'œuvre -------------------------------------------------
  if (img) {
    dessinerCouvrant(ctx, img, 0, 0, COTE, PHOTO_H)
  } else {
    // Sans photo, on ne laisse pas un trou noir : un aplat de la couleur de la
    // maison avec l'initiale, ce qui reste une carte présentable.
    ctx.fillStyle = couleur
    ctx.fillRect(0, 0, COTE, PHOTO_H)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.font = `700 300px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.fillText((nom || marque || '?').trim().charAt(0).toUpperCase(), COTE / 2, PHOTO_H / 2 + 105)
    ctx.textAlign = 'left'
  }

  // Fondu vers le bas : sans lui, la photo se termine par une arête nette qui
  // fait « collage » au lieu de « carte ».
  const fondu = ctx.createLinearGradient(0, PHOTO_H - 220, 0, PHOTO_H)
  fondu.addColorStop(0, 'rgba(14,18,17,0)')
  fondu.addColorStop(1, FOND)
  ctx.fillStyle = fondu
  ctx.fillRect(0, PHOTO_H - 220, COTE, 220)

  // ---- Zone basse ----------------------------------------------------------
  // Les deux blocs (texte à gauche, QR à droite) sont CENTRÉS verticalement
  // dans le bandeau. Sans cela, un nom court laissait un large vide en bas et
  // la carte paraissait tronquée plutôt que composée.
  const ZONE_H = COTE - PHOTO_H
  const qrBlocH = QR_TAILLE + 42
  const qrX = COTE - MARGE - QR_TAILLE
  const qrY = PHOTO_H + Math.round((ZONE_H - qrBlocH) / 2)
  const avecQr = lien ? dessinerQr(ctx, lien, qrX, qrY, QR_TAILLE) : false
  if (avecQr) {
    ctx.font = `600 20px ${SANS}`
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.textAlign = 'center'
    ctx.fillText('Scannez', qrX + QR_TAILLE / 2, qrY + QR_TAILLE + 34)
    ctx.textAlign = 'left'
  }

  // La colonne s'arrête avant le QR, sinon le nom passerait dessous.
  const colonne = (avecQr ? qrX - 44 : COTE - MARGE) - MARGE

  // Mesure AVANT de dessiner : on ne peut pas centrer ce qu'on n'a pas mesuré.
  // La police doit être posée avant chaque measureText, d'où l'ordre ici.
  ctx.font = `700 58px ${SERIF}`
  const titre = lignes(ctx, nom, colonne, 2)
  const sousTitre = [nomCommun, lieu].filter(Boolean).join(' · ')

  const hBloc =
    6 + 40 +                       // filet d'accent + respiration
    (marque ? 54 : 0) +            // ligne d'institution
    64 * Math.max(titre.length, 1) + // titre
    (sousTitre ? 44 : 0) +
    (has3d ? 58 : 0)

  let y = PHOTO_H + Math.max(46, Math.round((ZONE_H - hBloc) / 2))

  ctx.fillStyle = couleur
  ctx.fillRect(MARGE, y, 64, 6)
  y += 46

  if (marque) {
    ctx.font = `700 24px ${SANS}`
    ctx.fillStyle = couleur
    texteEspace(ctx, marque.toUpperCase().slice(0, 34), MARGE, y, 3)
    y += 54
  }

  ctx.font = `700 58px ${SERIF}`
  ctx.fillStyle = '#FFFFFF'
  for (const l of titre) {
    ctx.fillText(l, MARGE, y)
    y += 64
  }

  if (sousTitre) {
    ctx.font = `400 27px ${SANS}`
    ctx.fillStyle = 'rgba(255,255,255,0.60)'
    ctx.fillText(lignes(ctx, sousTitre, colonne, 1)[0] || '', MARGE, y + 8)
    y += 44
  }

  // Pastille 3D/AR : c'est l'argument qui fait cliquer, il doit se voir.
  if (has3d) {
    ctx.font = `800 20px ${SANS}`
    const libelle = '3D · RÉALITÉ AUGMENTÉE'
    const w = largeurEspacee(ctx, libelle, 2) + 36
    ctx.fillStyle = couleur
    rectArrondi(ctx, MARGE, y + 6, w, 44, 22)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    texteEspace(ctx, libelle, MARGE + 18, y + 35, 2)
  }

  // toDataURL échoue si une photo d'un autre domaine a teinté le canvas. On ne
  // laisse pas remonter l'exception : on redessine sans photo, ce qui donne une
  // carte moins belle mais bien réelle.
  try {
    return { dataUrl: canvas.toDataURL('image/png'), avecPhoto: !!img, avecQr }
  } catch {
    if (!img) return { dataUrl: '', avecPhoto: false, avecQr }
    const repli = await carteObjet({ nom, nomCommun, photo: '', lieu, marque, couleur, lien, has3d })
    return { ...repli, avecPhoto: false }
  }
}

// ---------------------------------------------------------------------------
// Partage
// ---------------------------------------------------------------------------

// Adresse publique de la fiche. Sur le sous-domaine de l'organisation les pages
// sont servies à la racine ; en local elles vivent sous /site.
export function lienPublicObjet(objectId, tenant) {
  const origine = canonicalOrigin(tenant)
  if (origine) return `${origine}/objets/${objectId}`
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/site/objets/${objectId}`
}

// wa.me : le seul point d'entrée WhatsApp qui marche partout (web, Android, iOS)
// sans application installée côté bureau.
export function lienWhatsApp(texte) {
  return `https://wa.me/?text=${encodeURIComponent(texte)}`
}

export function telecharger(dataUrl, nomFichier) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = nomFichier
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Partage natif (téléphone, ordinateur récent) : envoie l'IMAGE elle-même, ce
// que wa.me ne sait pas faire — une URL ne peut pas transporter une pièce jointe.
// Renvoie false si l'appareil ne sait pas partager de fichier ; l'appelant se
// rabat alors sur téléchargement + wa.me.
export async function partagerFichier(dataUrl, nomFichier, titre, texte) {
  try {
    if (!navigator.canShare || !dataUrl) return false
    const blob = await (await fetch(dataUrl)).blob()
    const fichier = new File([blob], nomFichier, { type: 'image/png' })
    if (!navigator.canShare({ files: [fichier] })) return false
    await navigator.share({ files: [fichier], title: titre, text: texte })
    return true
  } catch (e) {
    // AbortError = l'utilisateur a fermé le sélecteur. Ce n'est pas un échec :
    // on renvoie true pour ne pas déclencher un second partage dans son dos.
    return e?.name === 'AbortError'
  }
}
