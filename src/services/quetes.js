import { supabase } from './supabase'
import { scopeToTenant } from './tenant'

// QUÊTES — chasses au trésor.
//
// Côté visiteur, tout passe par des RPC : la lecture directe de `quest_steps` est
// volontairement FERMÉE, car une policy filtre des lignes et non des colonnes — la
// réponse attendue fuyait dans le JSON. Ne jamais rouvrir cette table au public.

// ---------- ERP ----------
export async function listerQuetes() {
  const { data, error } = await scopeToTenant(supabase.from('quests').select('*, museums(nom)'))
    .order('created_at', { ascending: false })
  if (error) { console.error('[quetes]', error.message); return [] }
  return (data || []).map((q) => ({
    id: q.id, museumId: q.museum_id, musee: q.museums?.nom || '',
    titre: q.titre, description: q.description, badgeNom: q.badge_nom,
    dureeMin: q.duree_min, published: q.published, genereParIa: q.genere_par_ia
  }))
}

export async function etapesErp(questId) {
  const { data, error } = await supabase
    .from('quest_steps').select('*, objects(nom, photo)').eq('quest_id', questId).order('ordre')
  if (error) { console.error('[quetes] etapes', error.message); return [] }
  return (data || []).map((s) => ({
    id: s.id, ordre: s.ordre, indice: s.indice, question: s.question,
    reponse: s.reponse, oeuvre: s.objects?.nom || '', photo: s.objects?.photo || ''
  }))
}

export async function genererQuete(museumId, combien = 4) {
  const { data, error } = await supabase.functions.invoke('quest-ai', { body: { museumId, combien } })
  if (error) return { ok: false, error: error.message }
  return data || { ok: false, error: 'vide' }
}

export async function publierQuete(id, published) {
  const { error } = await supabase.from('quests').update({ published }).eq('id', id)
  if (error) throw error
}

export async function supprimerQuete(id) {
  const { error } = await supabase.from('quests').delete().eq('id', id)
  if (error) throw error
}

// ---------- Visiteur ----------
export async function quetesDuMusee(museumId) {
  const { data, error } = await supabase.from('quests')
    .select('id, titre, description, badge_nom, duree_min')
    .eq('museum_id', museumId).eq('published', true).order('id')
  if (error) { console.error('[quetes] public', error.message); return [] }
  return (data || []).map((q) => ({
    id: q.id, titre: q.titre, description: q.description,
    badgeNom: q.badge_nom, dureeMin: q.duree_min
  }))
}

export async function quete(id) {
  const { data } = await supabase.from('quests')
    .select('id, titre, description, badge_nom, duree_min, museum_id, museums(nom)')
    .eq('id', id).eq('published', true).maybeSingle()
  return data && {
    id: data.id, titre: data.titre, description: data.description,
    badgeNom: data.badge_nom, dureeMin: data.duree_min,
    museumId: data.museum_id, musee: data.museums?.nom || ''
  }
}

// L'œuvre n'est révélée qu'une fois l'étape franchie : sinon on donnerait la solution.
export async function etapes(questId) {
  const { data, error } = await supabase.rpc('quete_etapes', { p_quest_id: questId })
  if (error) { console.error('[quetes] etapes', error.message); return [] }
  return (data || []).map((e) => ({
    stepId: e.step_id, ordre: e.ordre, indice: e.indice, question: e.question,
    objectId: e.object_id, fait: e.fait,
    oeuvre: e.objet_nom, photo: e.objet_photo, salle: e.salle
  }))
}

// C'est le SERVEUR qui juge la réponse — jamais le navigateur.
export async function valider(stepId, reponse = null) {
  const { data, error } = await supabase.rpc('quete_valider', { p_step_id: stepId, p_reponse: reponse })
  if (error) return { ok: false, raison: error.message }
  const r = Array.isArray(data) ? data[0] : data
  return { ok: !!r?.ok, raison: r?.raison, termine: !!r?.termine, badge: r?.badge }
}
