import { createI18n } from 'vue-i18n'

// CHARGEMENT DES LANGUES À LA DEMANDE
//
// Les deux catalogues pèsent 202 Ko de source (106 pour le français, 96 pour
// l'anglais) et étaient tous deux importés au démarrage. Un visiteur
// francophone téléchargeait donc l'intégralité du catalogue anglais pour rien —
// sur le bundle principal, celui qui bloque le tout premier affichage.
//
// POURQUOI C'EST SANS RISQUE ICI
// `fallbackLocale` servait de filet : une clé absente d'une langue se rabattait
// sur l'autre. Vérifié le 2026-08-20 — les deux catalogues comptent
// EXACTEMENT 2 061 clés, aucune absente d'un côté ni de l'autre. Le filet ne
// s'est jamais déclenché. On peut donc ne charger que la langue affichée.
//
// ⚠️ Si un jour une clé n'existe que dans une langue, le visiteur de l'autre
// verra la clé brute (« admin.nav.messages ») au lieu du texte traduit. Le
// contrôle de parité ci-dessus est donc à refaire après tout ajout massif.

export const SUPPORTED = ['fr', 'en']
const KEY = 'musea-lang'

function detectLocale() {
  const saved = localStorage.getItem(KEY)
  if (saved && SUPPORTED.includes(saved)) return saved
  const nav = (navigator.language || 'fr').slice(0, 2).toLowerCase()
  return SUPPORTED.includes(nav) ? nav : 'fr'
}

const locale = detectLocale()

// Import statique côté Vite : le motif littéral permet à l'outil de produire un
// morceau par langue. Un chemin entièrement variable l'empêcherait de savoir
// quels fichiers découper.
function chargerCatalogue(l) {
  return l === 'en' ? import('./en.js') : import('./fr.js')
}

const i18n = createI18n({
  legacy: false,            // API Composition (useI18n / $t)
  globalInjection: true,    // $t, $d… disponibles dans tous les templates
  locale,
  // Le repli pointe sur la langue affichée, et non sur l'autre : sans cela
  // vue-i18n réclamerait le second catalogue, ce qu'on cherche justement à éviter.
  fallbackLocale: locale,
  messages: {}              // rempli par prochargerLangue(), avant le montage
})

/**
 * Charge le catalogue de la langue affichée. À APPELER AVANT `app.mount()` :
 * sans lui, la première image de l'écran montrerait des clés brutes.
 *
 * Pourquoi pas un `await` en tête de module, plus court : la cible de
 * compilation du projet (Chrome 87, Safari 14) ne connaît pas le `await` de
 * haut niveau. La relever pour gagner trois lignes exclurait des navigateurs
 * encore répandus sur les appareils d'entrée de gamme.
 */
export async function prechargerLangue() {
  if (i18n.global.availableLocales.includes(locale)) return
  const m = await chargerCatalogue(locale)
  i18n.global.setLocaleMessage(locale, m.default)
}

// Change la langue, la mémorise et met à jour l'attribut <html lang>.
// Asynchrone désormais : le catalogue de la nouvelle langue peut rester à
// télécharger. Une fois chargé, il est conservé — rebasculer est immédiat.
export async function setLocale(nouvelle) {
  if (!SUPPORTED.includes(nouvelle)) return
  if (!i18n.global.availableLocales.includes(nouvelle)) {
    try {
      const m = await chargerCatalogue(nouvelle)
      i18n.global.setLocaleMessage(nouvelle, m.default)
    } catch (e) {
      // Réseau coupé pendant le changement : on reste dans la langue courante
      // plutôt que d'afficher une interface en clés brutes.
      console.warn('[i18n] catalogue indisponible :', nouvelle, e?.message || e)
      return
    }
  }
  i18n.global.locale.value = nouvelle
  i18n.global.fallbackLocale.value = nouvelle
  localStorage.setItem(KEY, nouvelle)
  document.documentElement.setAttribute('lang', nouvelle)
}

// Applique la langue détectée au <html> dès le chargement.
document.documentElement.setAttribute('lang', locale)

export default i18n
