import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { scopeToTenant } from '@/services/tenant'

const aFrom = (r) => ({
  id: r.id,
  museumId: r.museum_id,
  titre: r.titre,
  source: r.source,
  prix: r.prix == null ? null : Number(r.prix),
  devise: r.devise,
  actif: r.actif,
  // Guide IA vocal
  langues: r.langues || ['fr', 'en'],
  modeInteraction: r.mode_interaction || 'narration',
  personnalisationNominative: r.personnalisation_nominative ?? true,
  modeleSalutation: r.modele_salutation || 'Bonjour {prenom}, bienvenue au {musee}.',
  sourceType: r.source_type || 'texte',
  scriptTexte: r.script_texte || '',
  timbreVoix: r.timbre_voix || 'standard',
  debit: r.debit == null ? 1 : Number(r.debit),
  ton: r.ton || 'neutre',
  audioSourceUrl: r.audio_source_url || '',
  audioTraitement: r.audio_traitement || 'tel_quel',
  provider: r.provider || 'elevenlabs',
  voiceId: r.voice_id || null,
  published: r.published ?? false
})
const aTo = (a) => ({
  museum_id: a.museumId,
  titre: a.titre ?? null,
  source: a.sourceType === 'audio' ? 'import' : 'synthese',
  prix: a.prix === '' || a.prix == null ? null : a.prix,
  devise: a.devise ?? 'FCFA',
  actif: a.actif ?? false,
  langues: a.langues && a.langues.length ? a.langues : ['fr'],
  mode_interaction: a.modeInteraction ?? 'narration',
  personnalisation_nominative: a.personnalisationNominative ?? true,
  modele_salutation: a.modeleSalutation ?? 'Bonjour {prenom}, bienvenue au {musee}.',
  source_type: a.sourceType ?? 'texte',
  script_texte: a.scriptTexte ?? null,
  timbre_voix: a.timbreVoix ?? 'standard',
  debit: a.debit == null || a.debit === '' ? 1 : a.debit,
  ton: a.ton ?? 'neutre',
  audio_source_url: a.audioSourceUrl ?? null,
  audio_traitement: a.audioTraitement ?? 'tel_quel',
  provider: a.provider ?? 'elevenlabs',
  voice_id: a.voiceId || null,
  published: a.published ?? false
})
const tFrom = (r) => ({
  id: r.id,
  assistantId: r.assistant_id,
  sectorId: r.sector_id,
  objectId: r.object_id,
  langue: r.langue,
  fichier: r.fichier,
  texte: r.texte,
  dureeSec: r.duree_sec,
  actif: r.actif
})
const tTo = (t) => ({
  assistant_id: t.assistantId,
  sector_id: t.sectorId ?? null,
  object_id: t.objectId ?? null,
  langue: t.langue ?? 'fr',
  fichier: t.fichier ?? null,
  texte: t.texte ?? null,
  duree_sec: t.dureeSec ?? null,
  actif: t.actif ?? true
})

export const useVoiceStore = defineStore('voice', () => {
  const assistants = ref([])
  const tracks = ref([])

  async function load() {
    const [a, t] = await Promise.all([
      scopeToTenant(supabase.from('voice_assistants').select('*')).order('id'),
      scopeToTenant(supabase.from('audio_tracks').select('*')).order('id')
    ])
    if (a.error) console.error('[voice] assistants', a.error.message)
    else assistants.value = a.data.map(aFrom)
    if (t.error) console.error('[voice] tracks', t.error.message)
    else tracks.value = t.data.map(tFrom)
  }

  async function addAssistant(d) {
    const { data: r, error } = await supabase.from('voice_assistants').insert(aTo(d)).select().single()
    if (error) throw error
    assistants.value.push(aFrom(r))
  }
  async function updateAssistant(id, d) {
    const { data: r, error } = await supabase.from('voice_assistants').update(aTo(d)).eq('id', id).select().single()
    if (error) throw error
    const i = assistants.value.findIndex((x) => x.id === id)
    if (i !== -1) assistants.value[i] = aFrom(r)
  }
  async function removeAssistant(id) {
    const { error } = await supabase.from('voice_assistants').delete().eq('id', id)
    if (error) throw error
    assistants.value = assistants.value.filter((x) => x.id !== id)
    tracks.value = tracks.value.filter((t) => t.assistantId !== id)
  }
  async function addTrack(d) {
    const { data: r, error } = await supabase.from('audio_tracks').insert(tTo(d)).select().single()
    if (error) throw error
    tracks.value.push(tFrom(r))
  }
  async function removeTrack(id) {
    const { error } = await supabase.from('audio_tracks').delete().eq('id', id)
    if (error) throw error
    tracks.value = tracks.value.filter((t) => t.id !== id)
  }
  const tracksFor = (assistantId) => tracks.value.filter((t) => t.assistantId === assistantId)

  return { assistants, tracks, load, addAssistant, updateAssistant, removeAssistant, addTrack, removeTrack, tracksFor }
})
