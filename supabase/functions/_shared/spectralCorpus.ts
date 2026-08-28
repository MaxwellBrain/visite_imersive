// CORPUS DU GUIDE SPECTRAL — les seules sources qu'il ait le droit d'utiliser.
//
// Partagé entre les deux voies :
//   `guide-spectral`      rédaction à l'avance, relue, pour le repli hors ligne
//   `guide-spectral-live` improvisation devant le visiteur
//
// Il est ICI et pas dupliqué, parce que c'est la pièce sur laquelle repose tout
// l'ancrage. Deux copies finiraient par diverger, et le jour où l'une devient
// plus permissive que l'autre, c'est le guide en direct qui se met à inventer
// — sans que rien ne le signale.
//
// Le client passé en argument décide de ce qui est visible : jeton du
// conservateur pour la rédaction, clé anonyme pour la visite. Dans les deux
// cas, `published = true` est exigé explicitement : une notice non publiée
// n'est pas une notice validée, et n'a donc rien à faire dans la bouche du
// guide, même quand un conservateur connecté aurait le droit de la lire.

// deno-lint-ignore no-explicit-any
type Client = any

export type Source = { origine: string; texte: string; ref: Record<string, unknown> }

// Une notice de moins de vingt caractères utiles ne dit rien. La transmettre
// ferait croire au modèle qu'il a une source, et l'inviterait à broder autour
// d'un mot — c'est exactement le mécanisme qu'on cherche à empêcher.
const LONGUEUR_UTILE_MIN = 20

export async function resoudreNotices(
  supabase: Client,
  hotspot: { id: number; object_id?: number | null; notices?: unknown }
): Promise<Source[]> {
  const declarees: Array<Record<string, unknown>> =
    Array.isArray(hotspot.notices) ? [...hotspot.notices] : []

  // Le point rattaché à un objet apporte sa notice sans qu'on ait à la déclarer
  // deux fois : c'est le cas le plus courant, autant l'éviter au conservateur.
  if (
    hotspot.object_id &&
    !declarees.some((n) => n?.kind === 'objet' && n?.id === hotspot.object_id)
  ) {
    declarees.push({ kind: 'objet', id: hotspot.object_id })
  }

  const sources: Source[] = []
  for (const n of declarees) {
    if (n?.kind === 'note' && n?.texte) {
      sources.push({
        origine: n.auteur ? `note de terrain — ${n.auteur}` : 'note de terrain',
        texte: String(n.texte),
        ref: { kind: 'note', auteur: n.auteur ?? null }
      })
      continue
    }

    if (n?.kind === 'objet' && n?.id) {
      const { data } = await supabase
        .from('objects').select('id, nom, nom_commun, description, published')
        .eq('id', n.id).maybeSingle()
      if (data?.published) {
        sources.push({
          origine: `notice de l'objet « ${data.nom} »`,
          texte: [data.nom, data.nom_commun, data.description].filter(Boolean).join(' — '),
          ref: { kind: 'objet', id: data.id }
        })
      }
      continue
    }

    if (n?.kind === 'secteur' && n?.id) {
      const { data } = await supabase
        .from('sectors').select('id, nom, description, histoire, published')
        .eq('id', n.id).maybeSingle()
      if (data?.published) {
        sources.push({
          origine: `salle « ${data.nom} »`,
          texte: [data.description, data.histoire].filter(Boolean).join(' — '),
          ref: { kind: 'secteur', id: data.id }
        })
      }
    }
  }

  return sources.filter((s) => s.texte.trim().length > LONGUEUR_UTILE_MIN)
}

// Corpus ÉLARGI À LA CASE, pour les questions libres.
//
// Un visiteur qui demande « et le grenier, il servait à quoi ? » alors qu'il
// regarde le foyer n'a pas tort : il parle de la même maison. Restreindre la
// réponse aux notices du seul point regardé donnerait un guide obtus.
//
// On charge donc les notices de TOUS les points de la scène, en marquant
// lesquelles appartiennent au point regardé. Sept points, quelques notices
// chacun : cela reste très en deçà de ce qu'un modèle traite sans effort, et
// cela évite une recherche vectorielle dont personne n'a encore besoin ici.
export async function corpusDeLaScene(
  supabase: Client,
  sceneId: number,
  hotspotFocus: number | null
): Promise<{ sources: Source[]; focus: Set<number> }> {
  const { data: points } = await supabase
    .from('ar_hotspots').select('id, code, libelle, object_id, notices')
    .eq('scene_id', sceneId).order('priorite')

  const sources: Source[] = []
  const focus = new Set<number>()
  for (const p of points || []) {
    const s = await resoudreNotices(supabase, p)
    for (const src of s) {
      // On préfixe par le point : sans cela, le modèle reçoit vingt notices en
      // vrac et ne sait plus laquelle décrit ce que le visiteur a sous les yeux.
      const marquee = { ...src, origine: `${p.libelle} · ${src.origine}` }
      if (p.id === hotspotFocus) focus.add(sources.length)
      sources.push(marquee)
    }
  }
  return { sources, focus }
}
