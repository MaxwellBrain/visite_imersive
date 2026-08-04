import { supabase } from './supabase'

// RÉSEAU INTER-INSTITUTIONS — partage consenti entre organisations.
//
// Tout passe par des RPC dédiées, jamais par une lecture directe des tables d'autrui :
// c'est la base qui décide ce qui traverse, pas le frontend. Les fonctions vérifient
// partenariat accepté + contenu publié, et déduisent l'organisation appelante du jeton.

export async function annuaire() {
  const { data, error } = await supabase.rpc('reseau_annuaire')
  if (error) { console.error('[reseau] annuaire', error.message); return [] }
  return (data || []).map((t) => ({
    tenantId: t.tenant_id, nom: t.nom, slug: t.slug, type: t.type,
    dejaLie: t.deja_lie, statut: t.statut
  }))
}

// Œuvres publiées chez les partenaires ayant accepté le lien.
export async function chercherOeuvres(termes = null) {
  const { data, error } = await supabase.rpc('reseau_chercher_oeuvres', { p_termes: termes || null })
  if (error) { console.error('[reseau] recherche', error.message); return [] }
  return (data || []).map((o) => ({
    id: o.object_id, nom: o.nom, nomCommun: o.nom_commun, description: o.description,
    photo: o.photo, salle: o.salle, musee: o.musee, organisation: o.organisation, slug: o.slug
  }))
}

// Liens de l'organisation, dans les deux sens (proposés et reçus).
export async function mesLiens(tenantId) {
  const { data, error } = await supabase
    .from('tenant_partnerships')
    .select('*, a:tenant_a(id,nom,slug), b:tenant_b(id,nom,slug)')
    .order('created_at', { ascending: false })
  if (error) { console.error('[reseau] liens', error.message); return [] }
  return (data || []).map((p) => ({
    id: p.id, statut: p.statut, message: p.message, createdAt: p.created_at,
    // « Reçu » = c'est l'autre qui a proposé : c'est à NOUS de décider.
    recu: p.tenant_b === tenantId,
    autre: p.tenant_b === tenantId ? p.a : p.b
  }))
}

export async function proposer(tenantId, cibleId, message = null) {
  const { error } = await supabase.from('tenant_partnerships')
    .insert({ tenant_a: tenantId, tenant_b: cibleId, message })
  if (error) throw error
}

// Seul le destinataire peut décider — la RLS le garantit, on ne s'y fie pas seul.
export async function decider(id, accepte) {
  const { error } = await supabase.from('tenant_partnerships')
    .update({ statut: accepte ? 'accepte' : 'refuse', decided_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function rompre(id) {
  const { error } = await supabase.from('tenant_partnerships').delete().eq('id', id)
  if (error) throw error
}
