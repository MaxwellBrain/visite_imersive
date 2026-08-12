// Edge Function « europeana » — la source qui fait basculer la couverture.
//
// POURQUOI UNE FONCTION SERVEUR, alors que les autres catalogues sont
// interrogés directement depuis le navigateur (collectionsApi.js) :
// Europeana exige une clé. La règle du projet est qu'une clé ne descend JAMAIS
// dans le frontend — un bundle est lisible par tout le monde, et le quota de
// cette clé serait épuisé par le premier venu. D'où ce mince relais.
//
// CE QU'ELLE APPORTE, ET POURQUOI C'EST DÉCISIF (mesuré le 2026-08-06)
//   Wikidata ne nomme le musée détenteur que pour 6 institutions sur les 1414
//   objets camerounais qu'il connaît. museum-digital en apporte ~18-22.
//   Europeana, elle, fédère plusieurs milliers d'institutions européennes ET
//   — c'est le point clé — expose une FACETTE `DATA_PROVIDER` : une seule
//   requête énumère les institutions détentrices AVEC leur nombre d'objets,
//   sans avoir à parcourir le corpus. C'est la voie la plus courte vers
//   l'objectif des 40 sites, et le chiffre est vérifiable.
//
// Sans clé configurée : réponse 200 { skipped: true }. La recherche continue
// avec les autres sources — jamais bloquante, comme `send-email`.
//
// Secret attendu : EUROPEANA_API_KEY (gratuit — pro.europeana.eu/get-api)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const API = 'https://api.europeana.eu/record/v2/search.json'

// Un seul musée détient souvent l'essentiel d'un corpus. Sans plafond, il
// occuperait toute la place et la couverture institutionnelle resterait à 1.
const MAX_PAR_INSTITUTION = 3
const LIGNES = 100          // maximum accepté par Europeana en une requête
const FACETTE_MAX = 150     // institutions énumérées par la facette

const prem = (v: unknown): string =>
  Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const cle = Deno.env.get('EUROPEANA_API_KEY')
  if (!cle) return json({ skipped: true, reason: 'no_api_key' })

  // Termes fournis par l'appelant (déjà traduits en anglais par `memory-search`),
  // plus le pays. On construit une requête OR : Europeana indexe en plusieurs
  // langues, un seul terme raterait la moitié du corpus.
  const termes: string[] = (Array.isArray(body?.termes) ? body.termes : [])
    .map((t: unknown) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const pays = String(body?.pays || '').trim()
  const limite = Math.max(1, Math.min(Number(body?.limite) || 40, 100))

  const morceaux = [...new Set([pays, ...termes].filter(Boolean))]
    .map((t) => `"${t.replace(/"/g, '')}"`)
  if (!morceaux.length) return json({ ok: false, error: 'aucun_terme' }, 400)

  const requete = morceaux.join(' OR ')
  const url =
    `${API}?wskey=${encodeURIComponent(cle)}` +
    `&query=${encodeURIComponent(requete)}` +
    `&rows=${LIGNES}` +
    `&profile=facets` +
    `&facet=DATA_PROVIDER` +
    `&f.DATA_PROVIDER.facet.limit=${FACETTE_MAX}`

  let d: Record<string, any>
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    d = await r.json()
    // Europeana répond 200 avec success:false sur clé invalide : on ne peut pas
    // se fier au seul code HTTP.
    if (!r.ok || d?.success === false) {
      return json({ ok: false, error: 'europeana_error', detail: String(d?.message || r.status).slice(0, 200) }, 502)
    }
  } catch (e) {
    return json({ ok: false, error: 'reseau', detail: String(e).slice(0, 200) }, 502)
  }

  // ---- Les institutions, lues sur la FACETTE : c'est la mesure de couverture,
  // obtenue sans parcourir le corpus.
  const facette = (d?.facets || []).find((f: any) => f?.name === 'DATA_PROVIDER')
  const institutions = (facette?.fields || [])
    .map((f: any) => ({ nom: String(f?.label || '').trim(), n: Number(f?.count) || 0 }))
    .filter((i: any) => i.nom)

  // ---- Les objets, répartis pour ne pas laisser une institution tout occuper.
  const parInstitution = new Map<string, any[]>()
  for (const it of d?.items || []) {
    const musee = prem(it?.dataProvider) || prem(it?.provider) || 'Institution inconnue'
    if (!parInstitution.has(musee)) parInstitution.set(musee, [])
    parInstitution.get(musee)!.push(it)
  }

  const retenus: any[] = []
  for (let tour = 0; tour < MAX_PAR_INSTITUTION && retenus.length < limite; tour++) {
    for (const [musee, liste] of parInstitution) {
      if (retenus.length >= limite) break
      const it = liste[tour]
      if (!it) continue
      retenus.push({
        externalId: String(it?.id || it?.guid || '').replace(/^\//, ''),
        title: prem(it?.title),
        musee,
        paysMusee: prem(it?.country),
        date: prem(it?.year),
        medium: prem(it?.dcDescription).slice(0, 300),
        image: prem(it?.edmPreview),
        url: String(it?.guid || '').split('?')[0],
        inventaire: ''
      })
    }
  }

  return json({
    ok: true,
    total: Number(d?.totalResults) || 0,
    institutions,                       // liste complète issue de la facette
    nb_institutions: institutions.length,
    objets: retenus
  })
})
