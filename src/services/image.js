// Compression d'image avant enregistrement — zéro dépendance.
//
// POURQUOI CE FICHIER EXISTE
//
// Les photos étaient envoyées telles quelles, encodées en base64, dans une
// colonne texte. Mesuré en production : une seule photo pesait 362 879
// caractères. Chaque enregistrement expédiait donc ~360 Ko, et la réponse les
// renvoyait — plus de 700 Ko d'aller-retour pour sauvegarder un objet, d'où les
// dix secondes d'attente.
//
// Un appareil photo de téléphone produit du 4000×3000. Or l'affichage le plus
// grand du site fait 1200 px de large : les trois quarts des pixels envoyés ne
// seront jamais vus. On redimensionne donc avant d'encoder.
//
// Note : le base64 lui-même gonfle de 33 %. Le vrai remède à terme est Supabase
// Storage (un fichier, une URL, aucune inflation) ; la compression réduit le
// problème d'un ordre de grandeur en attendant.

const MAX_DIMENSION = 1600 // large pour un plein écran, dérisoire pour un capteur
const QUALITE = 0.82 // au-delà, le poids grimpe sans gain visible
const SEUIL_PNG = 0.7 // en deçà, on garde la transparence plutôt que la taille

function chargerImage(fichier) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')) }
    img.src = url
  })
}

// Réduit une image et renvoie un data URL prêt à enregistrer.
// En cas d'échec (format exotique, navigateur ancien), on retombe sur le
// fichier d'origine : mieux vaut une photo lourde qu'aucune photo.
export async function compresserImage(fichier, options = {}) {
  const max = options.max || MAX_DIMENSION
  const qualite = options.qualite || QUALITE

  // Les images vectorielles n'ont rien à gagner à passer par un canvas :
  // le rendu les rasteriserait, donc les alourdirait.
  if (fichier.type === 'image/svg+xml') return lireTelQuel(fichier)

  try {
    const img = await chargerImage(fichier)
    const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))

    // Déjà petite ET déjà légère : la recompresser ne ferait que dégrader.
    if (ratio === 1 && fichier.size < 200 * 1024) return lireTelQuel(fichier)

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * ratio)
    canvas.height = Math.round(img.naturalHeight * ratio)

    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    // Un fond blanc évite qu'une transparence devienne noire en JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const jpeg = canvas.toDataURL('image/jpeg', qualite)

    // Un PNG à plat (logo, image détourée) peut battre le JPEG : on compare
    // vraiment au lieu de supposer.
    if (fichier.type === 'image/png') {
      const png = canvas.toDataURL('image/png')
      if (png.length < jpeg.length * SEUIL_PNG) return png
    }
    return jpeg
  } catch {
    return lireTelQuel(fichier)
  }
}

function lireTelQuel(fichier) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('lecture impossible'))
    reader.readAsDataURL(fichier)
  })
}

// Miniature carrée pour les listes de l'ERP.
//
// Elle existe pour que le tableau des objets reste illustré sans télécharger
// les photos en pleine résolution : ~8 Ko contre plusieurs centaines.
// Accepte un fichier ou un data URL déjà en mémoire.
export async function vignette(source, taille = 240) {
  try {
    const img = await (typeof source === 'string' ? chargerDataUrl(source) : chargerImage(source))
    const canvas = document.createElement('canvas')
    canvas.width = taille
    canvas.height = taille

    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, taille, taille)

    // Recadrage centré : on remplit le carré sans déformer le sujet.
    const cote = Math.min(img.naturalWidth, img.naturalHeight)
    ctx.drawImage(
      img,
      (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote,
      0, 0, taille, taille
    )
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return '' // une vignette manquante n'empêche jamais d'enregistrer
  }
}

function chargerDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = url
  })
}

// Poids approximatif d'un data URL, pour l'afficher à l'utilisateur.
export function poidsLisible(dataUrl) {
  if (!dataUrl) return ''
  // 4 caractères de base64 encodent 3 octets.
  const octets = Math.round((String(dataUrl).length * 3) / 4)
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`
}
