import { supabase } from './supabase'

// ============================================================================
// SUPPRIMER, ET SAVOIR SI ÇA A MARCHÉ.
// ----------------------------------------------------------------------------
// LE PIÈGE. Quand une politique d'accès (RLS) refuse une suppression, PostgREST
// ne renvoie PAS d'erreur : il renvoie un succès portant sur zéro ligne.
//
//   supabase.from('museums').delete().eq('id', 23)
//     -> HTTP 204, error: null      ← indistinguable d'une vraie suppression
//
// Tous nos stores lisaient donc `error`, ne trouvaient rien, et retiraient la
// ligne de la liste affichée. L'utilisateur voyait la carte disparaître... et
// la retrouvait au rechargement suivant. C'est ce qui faisait dire que « le
// bouton supprimer ne fonctionne pas » : il fonctionnait, il mentait.
//
// LA PARADE tient en un mot : `.select()`. Demander les lignes supprimées force
// PostgREST à les renvoyer, et un tableau vide devient alors une information —
// celle qu'on attendait.
//
//   .delete().eq('id', 23).select('id')
//     -> HTTP 200, data: []         ← refus, enfin visible
//
// À utiliser pour toute suppression dont on attend un effet. Les nettoyages
// opportunistes — retirer des liens qui n'existent peut-être pas — n'ont rien
// à faire ici : zéro ligne y est un résultat normal.
// ============================================================================

/**
 * Exécute une suppression et EXIGE qu'elle ait porté sur au moins une ligne.
 *
 * @param {object} requete un `supabase.from(x).delete().eq(...)` non exécuté
 * @returns {Promise<number>} le nombre de lignes réellement supprimées
 * @throws si la base refuse, ou si rien n'a été supprimé
 */
export async function supprimerOuEchouer(requete) {
  const { data, error } = await requete.select('id')
  if (error) throw error
  if (!data || !data.length) {
    // Message reconnaissable par l'appelant, qui le traduit. Le cas quasi
    // unique : la ligne appartient à une autre organisation, ou le compte n'a
    // pas le rôle qu'il croit avoir.
    const e = new Error('suppression_refusee')
    e.code = 'suppression_refusee'
    throw e
  }
  return data.length
}

/** Raccourci pour le cas courant : supprimer une ligne par son identifiant. */
export function supprimerParId(table, id) {
  return supprimerOuEchouer(supabase.from(table).delete().eq('id', id))
}

// Le code interne n'a aucun sens pour un conservateur. Les vues affichaient
// `e.message` tel quel : « suppression_refusee » en détail d'une alerte ne dit
// pas quoi faire. On lui substitue une phrase, en gardant les vraies erreurs
// techniques telles quelles — elles, au moins, aident au diagnostic.
export function messageSuppression(e, t = null) {
  if (e?.code === 'suppression_refusee' || e?.message === 'suppression_refusee') {
    return t
      ? t('admin.common.suppression_refusee')
      : 'La base a refusé la suppression : cette fiche appartient sans doute à une autre organisation, ou votre compte n’a pas les droits. Rien n’a été supprimé.'
  }
  return e?.message || ''
}
