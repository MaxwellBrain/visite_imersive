import { supabase } from './supabase'

// ============================================================================
// DÉCISIONNEL — accès aux fonctions d'analyse de l'entrepôt de données.
// ----------------------------------------------------------------------------
// Tout le calcul est fait par PostgreSQL (ROLLUP, fenêtrage, auto-jointures) :
// ce module ne fait que transporter. C'est volontaire — descendre 10 000 lignes
// dans le navigateur pour les agréger en JavaScript serait plus lent, plus
// fragile, et ne passerait pas l'échelle.
//
// Les fonctions `bi_*` sont en SECURITY INVOKER : la RLS de l'appelant
// s'applique, un conservateur ne voit donc que les données de SON organisation.
// Aucune n'est bloquante : en cas d'échec on renvoie une valeur vide et
// l'interface affiche un état « aucune donnée » plutôt qu'une erreur.
// ============================================================================

async function appeler(nom, params = {}, defaut = []) {
  const { data, error } = await supabase.rpc(nom, params)
  if (error) {
    console.warn(`[bi] ${nom} :`, error.message)
    return defaut
  }
  return data ?? defaut
}

// Cube OLAP des ventes : détail par musée et par mois, PLUS les sous-totaux par
// musée et le total général, calculés en une passe par ROLLUP.
// Chaque ligne porte `niveau` — detail | sous_total_musee | total — qui permet
// à l'affichage de distinguer une ligne de données d'une ligne de synthèse.
export function cubeVentes({ depuis = null, jusqu = null } = {}) {
  return appeler('bi_cube_ventes', { p_depuis: depuis, p_jusqu: jusqu })
}

// Fréquentation mensuelle par musée, avec la part de chacun dans le mois.
export function frequentation({ depuis = null, jusqu = null } = {}) {
  return appeler('bi_frequentation', { p_depuis: depuis, p_jusqu: jusqu })
}

// Règles d'association sur les paniers : « qui achète A prend aussi B ».
// `supportMin` écarte les paires trop rares pour signifier quelque chose.
export function reglesPanier({ supportMin = 0.02, limite = 40 } = {}) {
  return appeler('bi_regles_panier', { p_support_min: supportMin, p_limite: limite })
}

// Objets consultés le même jour. À lire comme une tendance, pas comme un lien
// individuel : `object_views` est un compteur agrégé, sans identifiant de visiteur.
export function objetsCovus({ jours = 180, limite = 40 } = {}) {
  return appeler('bi_objets_covus', { p_jours: jours, p_limite: limite })
}

// Volumétrie et garde-fou statistique. Sert à AVERTIR quand les règles
// affichées reposent sur trop peu d'observations pour conclure.
export function fiabilite() {
  return appeler('bi_fiabilite', {}, null)
}

// Ampleur de la Mémoire Réunifiée (institutions balayées, pays détenteurs).
export function couvertureFreres() {
  return appeler('freres_couverture', { p_object_id: null }, null)
}

// ---------------------------------------------------------------------------
// Lecture du lift, partagée par les deux tableaux de règles.
// > 1 : les deux articles s'appellent l'un l'autre.
// ≈ 1 : rien à conclure — la paire n'est que le produit des popularités.
// < 1 : ils s'excluent plutôt.
// Le seuil de 1,2 est le repère usuel en fouille de données pour parler
// d'association « nette » ; en deçà, l'écart se confond avec le hasard.
// ---------------------------------------------------------------------------
export function lireLift(lift) {
  const v = Number(lift)
  if (!Number.isFinite(v)) return { cle: 'inconnu', severite: 'secondary' }
  if (v >= 1.2) return { cle: 'positif', severite: 'success' }
  if (v <= 0.8) return { cle: 'negatif', severite: 'danger' }
  return { cle: 'neutre', severite: 'secondary' }
}
