// PRIMEVUE, INSTALLÉ SEULEMENT QUAND UN ÉCRAN EN A BESOIN.
//
// MESURÉ le 2026-08-29 : sur les 339 ko du fragment applicatif, 300 venaient de
// PrimeVue — le thème, ses jetons de style, son cœur, ses icônes. Notre propre
// code en occupait 38.
//
// Or LE SITE PUBLIC NE S'EN SERT PAS. Les vues publiques ont leurs propres
// classes (`ps-*`, `su-*`, `sl__*`) et n'importent aucun composant PrimeVue —
// une seule exception subsistait, un toast dans la carte produit, qu'on a
// remplacé par une confirmation posée sur la carte elle-même. Chaque visiteur
// venu regarder une œuvre téléchargeait donc la bibliothèque de composants de
// l'ERP pour ne jamais l'utiliser.
//
// LE DÉCOUPAGE NE SUFFISAIT PAS. Tant que `main.js` importait PrimeVue en haut
// de fichier, l'outil de compilation devait le placer dans le chemin critique,
// quel que soit le fragment. Il fallait rendre l'import DYNAMIQUE pour qu'il
// devienne facultatif.
//
// L'INSTALLATION RESTE SYNCHRONE DU POINT DE VUE DES ÉCRANS QUI EN DÉPENDENT :
// le garde de route l'attend avant d'entrer sur une page d'administration. Un
// composant PrimeVue ne peut donc jamais se monter avant que le module soit là,
// et il n'y a pas de course possible.

// Une seule installation par session, et une seule promesse partagée : deux
// navigations rapprochées vers l'ERP ne doivent pas déclencher deux
// téléchargements ni deux `app.use()`.
let promesse = null

// L'application, deposee au demarrage. Le garde de route appelle l'installation
// sans avoir a transporter l'instance : elle n'a qu'un seul proprietaire, et le
// routeur n'a pas a en etre le facteur.
let application = null

export function enregistrerApp(app) {
  application = app
}

export function primeVuePret() {
  return promesse
}

/**
 * Installe PrimeVue sur l'application, une fois pour toutes.
 *
 * @param {import('vue').App} app
 * @returns {Promise<void>} résolue quand le thème et les services sont posés.
 */
export function installerPrimeVue(app = application) {
  if (promesse) return promesse
  if (!app) return Promise.reject(new Error('primevue : application non enregistrée'))

  promesse = (async () => {
    // Tout arrive ensemble : ces modules voyagent de toute façon dans le même
    // fragment, et les demander en parallèle évite d'enchaîner cinq allers-retours.
    const [
      { default: PrimeVue },
      { default: ToastService },
      { default: ConfirmationService },
      { default: Tooltip },
      { definePreset },
      { default: Aura },
    ] = await Promise.all([
      import('primevue/config'),
      import('primevue/toastservice'),
      import('primevue/confirmationservice'),
      import('primevue/tooltip'),
      import('@primevue/themes'),
      import('@primevue/themes/aura'),
    ])

    // Palette ERP « Génius » : orange #F26B21 (primaire) + navy #16223C.
    // Elle vit ici et non dans `main.js` : elle n'a de sens qu'avec le thème, et
    // la laisser là-bas ramènerait `definePreset` dans le chemin critique.
    const Marron = definePreset(Aura, {
      semantic: {
        primary: {
          50: '#fef3ec',
          100: '#fcdcc6',
          200: '#f9bd97',
          300: '#f69a67',
          400: '#f47f40',
          500: '#f26b21',
          600: '#d85817',
          700: '#b44513',
          800: '#8f3612',
          900: '#742d12',
          950: '#3f1507'
        }
      }
    })

    app.use(PrimeVue, {
      theme: {
        preset: Marron,
        options: { darkModeSelector: '.app-dark', cssLayer: false },
      },
    })
    app.use(ToastService)
    app.use(ConfirmationService)
    app.directive('tooltip', Tooltip)
  })()

  return promesse
}
