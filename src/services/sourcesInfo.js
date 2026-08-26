// ============================================================================
// LES COLLECTIONS INTERROGÉES — fiche d'identité, pour l'affichage public
// ----------------------------------------------------------------------------
// Ce module ne sert QU'À présenter les sources ; il ne sait pas les interroger.
// C'est délibéré : la vitrine est la page la plus visitée du site, et importer
// `collectionsApi` pour trois libellés y ferait entrer les sept adaptateurs,
// leurs requêtes et le client Supabase.
//
// ⚠️ À TENIR D'ACCORD avec `SOURCES` dans src/services/collectionsApi.js —
// même précaution que RESERVED_SUBDOMAINS / slugs_reserves. Une source ajoutée
// là-bas et oubliée ici ne s'affichera pas ; l'inverse afficherait une source
// qui n'est jamais interrogée, ce qui serait pire.
//
// VOCABULAIRE : ce ne sont pas des « partenaires ». Aucun accord ne lie ces
// institutions à MUSÉA : ce sont des collections ouvertes, interrogées par
// leurs API publiques. Les présenter autrement serait faux.
// ============================================================================

export const COLLECTIONS = [
  {
    cle: 'met',
    nom: 'The Met',
    // Clé i18n : la vitrine est bilingue, un lieu écrit en dur y mélangerait
    // les langues (« Londres » au milieu d'une page anglaise).
    lieu: 'platform.locNewYork',
    url: 'https://www.metmuseum.org',
    type: 'musee'
  },
  {
    cle: 'artic',
    nom: 'Art Institute of Chicago',
    lieu: 'platform.locChicago',
    url: 'https://www.artic.edu',
    type: 'musee'
  },
  {
    cle: 'cleveland',
    nom: 'Cleveland Museum of Art',
    lieu: 'platform.locCleveland',
    url: 'https://www.clevelandart.org',
    type: 'musee'
  },
  {
    cle: 'vam',
    nom: 'Victoria & Albert Museum',
    lieu: 'platform.locLondon',
    url: 'https://www.vam.ac.uk',
    type: 'musee'
  },
  {
    cle: 'museum-digital',
    nom: 'museum-digital',
    lieu: 'platform.locGermany',
    url: 'https://nat.museum-digital.de',
    type: 'reseau',
    // Mesuré le 2026-08-06 sur 672 objets « Kamerun » parcourus. Le Cameroun
    // ayant été colonie allemande de 1884 à 1916, c'est en Allemagne que dort
    // l'essentiel du patrimoine sorti des chefferies.
    institutions: 22
  },
  {
    cle: 'europeana',
    nom: 'Europeana',
    lieu: 'platform.locEurope',
    url: 'https://www.europeana.eu',
    type: 'reseau',
    // Chiffre annoncé par l'agrégateur lui-même, pas une mesure de notre côté :
    // sa facette DATA_PROVIDER énumère les institutions détentrices.
    milliers: true
  },
  {
    cle: 'wikidata',
    nom: 'Wikidata',
    lieu: 'platform.locIntl',
    url: 'https://www.wikidata.org',
    type: 'reseau',
    // 1414 objets d'origine camerounaise référencés, mais le musée détenteur
    // (P195) n'est nommé que pour six institutions. Utile, pas suffisant.
    institutions: 6
  }
]

// Ce qu'on peut affirmer sans exagérer : le nombre d'institutions RÉELLEMENT
// identifiées à ce jour. Les milliers annoncés par Europeana n'y entrent pas —
// ils décrivent son catalogue, pas ce que nos recherches ont ramené.
export const INSTITUTIONS_IDENTIFIEES =
  COLLECTIONS.filter((c) => c.type === 'musee').length +
  COLLECTIONS.reduce((n, c) => n + (c.institutions || 0), 0)
