// Options partagées entre les formulaires de l'administration.

export const MUSEUM_TYPES = [
  'Art',
  'Histoire',
  'Sciences & Techniques',
  'Archéologie',
  'Ethnographie',
  'Histoire naturelle',
  'Autre'
]

export const VISIT_TYPES = [
  'Visite libre',
  'Visite guidée',
  'Visite guidée privée',
  'Atelier pédagogique'
]

// Devise du projet. Le patrimoine documenté est camerounais, le public visé
// aussi : le franc CFA d'Afrique centrale (XAF) est la devise par défaut, et
// c'est elle qu'on affiche partout où rien n'est précisé.
export const DEVISE_DEFAUT = 'FCFA'

// Les autres restent proposées pour une organisation qui vendrait à l'étranger.
export const CURRENCIES = ['FCFA', '€', '$', '£']

// Le franc CFA ne s'écrit pas avec de décimales, et se lit par tranches de
// mille. `Intl` avec un espace insécable fine évite « 4000FCFA ».
export function formatMontant(valeur, devise = DEVISE_DEFAUT) {
  const n = Number(valeur || 0)
  const decimales = devise === DEVISE_DEFAUT ? 0 : 2
  return `${n.toLocaleString('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  })} ${devise}`
}

// Un secteur peut être une salle interne ou un espace en plein air
// (ex. les cases Mousgoum reconstituées dans l'enceinte du musée).
export const SECTOR_LOCATIONS = ['Intérieur', 'Extérieur']

// Institutions partenaires auxquelles un musée peut être associé (données fédérées).
export const PARTNER_INSTITUTIONS = ['Grand Palais', 'RMN – Grand Palais', 'Musée du quai Branly']

// Relation entre un objet d'art et un individu (chef) de la généalogie.
export const OBJECT_CHEF_RELATIONS = ['possédé par', 'porté par', 'sculpté par', 'commandé par', 'offert par']

// Titres coutumiers proposés pour un individu de la généalogie.
export const GENEALOGY_TITLES = ["Sa Majesté le Fo'o", "Fo'o", 'Mafo', 'Notable', 'Prince', 'Princesse']

// Sources de la voix pour un assistant vocal (§5.1).
export const VOICE_SOURCES = [
  { label: 'Fichier importé', value: 'import' },
  { label: 'Enregistrement in-app', value: 'enregistrement' },
  { label: 'Synthèse vocale (TTS)', value: 'synthese' }
]

// Langues gérées (site + audio).
export const LANGUES = ['fr', 'en']
