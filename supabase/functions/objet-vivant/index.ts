// Edge Function « objet-vivant » — L'ESPRIT D'UNE PIÈCE, et d'une seule.
//
// LA VOIE DE REPLI, par texte diffusé. La voie principale est désormais vocale
// et passe par Vapi (`jeton-voix` + `outils-vapi`) ; celle-ci reste le chemin
// quand il n'y a pas de crédit, pas de micro, ou pas de navigateur assez neuf.
//
// POURQUOI UNE FONCTION SÉPARÉE de `guide-agent` : LE VERROU EST STRUCTUREL,
// pas déclaratif. `guide-agent` construit son contexte par recherche de
// mots-clés sur tout le catalogue : demander « et le masque à côté ? » y
// injecte le masque, et aucune consigne de prompt ne fait oublier au modèle un
// texte qu'on vient de lui donner. Ici, le contexte est chargé PAR IDENTIFIANT.
//
// LE DOSSIER ET LES TROIS CERCLES VIENNENT DE `_shared/dossier.ts`, la recherche
// de `_shared/recherche.ts` — les mêmes modules que la voie vocale appelle. Ce
// fichier en tenait autrefois sa propre copie ; deux copies finissent par
// diverger, et le jour où l'une devient plus permissive que l'autre, c'est le
// repli — celui qu'on ne relit plus — qui se met à inventer.
//
// CE QU'IL N'A PAS, et c'est assumé : la mémoire du visiteur. Elle suppose un
// identifiant tenu par le navigateur, que cette voie ne reçoit pas encore.
//
// CLOISONNEMENT : clé anonyme + `published = true` partout.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { dossierDe, systeme } from '../_shared/dossier.ts'
import { OUTIL_CHERCHER, chercher } from '../_shared/recherche.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

type Fragment = { t?: string; appels?: any[] }

/**
 * LE FLUX GROQ, qui sait aussi rapporter un appel d'outil.
 *
 * ON GARDE LA DIFFUSION MÊME AVEC DES OUTILS, et c'est le point délicat. La
 * solution évidente — un premier appel non diffusé pour voir si le modèle veut
 * chercher, puis un second en diffusion — coûterait deux à trois secondes de
 * silence À CHAQUE TOUR, y compris les neuf sur dix où aucune recherche n'a
 * lieu. On paierait la recherche même quand elle n'arrive pas.
 *
 * Ici, on diffuse d'emblée. Quand le modèle décide d'appeler l'outil, il
 * n'émet PAS de texte — les fragments qui arrivent sont des `tool_calls`, qu'on
 * assemble par `index` (ils arrivent en morceaux, comme le texte). Le visiteur
 * n'a donc rien entendu, et rien n'a été gâché : on exécute, puis on relance un
 * second flux qui, lui, parle. Le silence n'est payé que lorsqu'on cherche
 * vraiment.
 */
async function* groqFlux(system: string, messages: any[], outils: any[] | null): AsyncGenerator<Fragment> {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) throw new Error('groq: pas de clé')
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0.6, max_tokens: 900, stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
      ...(outils ? { tools: outils, tool_choice: 'auto' } : {}),
    }),
  })
  if (!res.ok || !res.body) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const lect = res.body.getReader()
  const dec = new TextDecoder()
  let reste = ''
  const enCours: any[] = []          // les appels d'outil, assemblés par index

  while (true) {
    const { done, value } = await lect.read()
    if (done) break
    reste += dec.decode(value, { stream: true })
    const blocs = reste.split('\n\n')
    reste = blocs.pop() || ''
    for (const b of blocs) {
      const l = b.split('\n').find((x) => x.startsWith('data:'))
      if (!l) continue
      const charge = l.slice(5).trim()
      if (charge === '[DONE]') {
        if (enCours.length) yield { appels: enCours.filter(Boolean) }
        return
      }
      try {
        const delta = JSON.parse(charge)?.choices?.[0]?.delta
        if (delta?.content) yield { t: delta.content }
        for (const a of delta?.tool_calls || []) {
          const i = a.index ?? 0
          enCours[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (a.id) enCours[i].id = a.id
          if (a.function?.name) enCours[i].function.name = a.function.name
          if (a.function?.arguments) enCours[i].function.arguments += a.function.arguments
        }
      } catch { /* fragment illisible : le flux continue */ }
    }
  }
  if (enCours.length) yield { appels: enCours.filter(Boolean) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const objectId = Number(body?.objectId)
  if (!Number.isFinite(objectId)) return json({ error: 'objectId manquant' }, 400)
  const tenantId = Number(body?.tenantId) || null
  const langue = body?.lang === 'en' ? 'en' : 'fr'
  const question = String(body?.question || '').trim().slice(0, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const d = await dossierDe(sb, objectId, tenantId)
  if (!d) return json({ error: 'objet introuvable ou non publié' }, 404)

  const historique = Array.isArray(body?.historique)
    ? body.historique.slice(-8).map((h: any) => ({
        role: h?.role === 'assistant' ? 'assistant' : 'user',
        content: String(h?.texte || '').slice(0, 1200)
      }))
    : []

  // L'ACCROCHE, quand aucune question n'est posée. Ce n'est PAS « bonjour, que
  // voulez-vous ? » : c'est un détail frappant, PRIS DANS LE PREMIER CERCLE, qui
  // donne envie d'en demander plus. C'est la première seconde qui décide si le
  // visiteur parle ou s'en va — et une généralité culturelle, si juste soit-elle,
  // ne la gagne pas : elle vaudrait pour n'importe quelle pièce de la salle.
  const consigne = question
    ? `Le visiteur vient de te dire à voix haute : « ${question} »\n\nRéponds-lui.`
    : `Le visiteur vient de te toucher. Salue-le en une phrase, puis livre-lui UN détail ` +
      `frappant et précis pris dans ce que tu sais de TOI — pas une généralité sur ton ` +
      `monde, et sans rien chercher. Termine en lui proposant d'en entendre davantage.`

  const sys = systeme(d, langue, { recherche: true })

  const enc = new TextEncoder()
  const flux = new ReadableStream({
    async start(c) {
      const envoyer = (o: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
      envoyer({ meta: { titre: d.titre, blocs: d.blocs.length } })

      let rien = true
      let sature = false
      const messages: any[] = [...historique, { role: 'user', content: consigne }]

      try {
        // DEUX TOURS AU PLUS, et le second sans outils. C'est ce qui garantit
        // qu'on ne peut pas boucler : une pièce qui cherche, puis cherche
        // encore, laisse le visiteur devant un silence qu'aucune animation ne
        // rattrape. Une recherche par prise de parole, c'est assez.
        for (let tour = 0; tour < 2; tour++) {
          let appels: any[] | null = null

          for await (const f of groqFlux(sys, messages, tour === 0 ? [OUTIL_CHERCHER] : null)) {
            if (f.t) { rien = false; envoyer({ t: f.t }) }
            if (f.appels?.length) appels = f.appels
          }

          if (!appels) break

          messages.push({ role: 'assistant', content: '', tool_calls: appels })
          for (const appel of appels) {
            let args: any = {}
            try { args = JSON.parse(appel.function?.arguments || '{}') } catch { /* args vides */ }
            const r = appel.function?.name === 'chercher'
              ? await chercher(args?.sujet || '', d.ancrage, langue)
              : { erreur: 'outil inconnu' }
            // On le dit au client : c'est ce qui lui permet d'afficher ou de
            // faire entendre que la pièce consulte, plutôt que de la laisser
            // muette pendant l'aller-retour.
            envoyer({ cherche: (r as any)?.requete || args?.sujet || '' })
            messages.push({
              role: 'tool',
              tool_call_id: appel.id,
              name: appel.function?.name,
              content: JSON.stringify(r),
            })
          }
        }
      } catch (e) {
        console.error('[objet-vivant]', String(e))
        // MESURÉ : le palier gratuit de Groq plafonne à 8 000 tokens PAR MINUTE
        // et 200 000 par jour, et le dossier d'une pièce en pèse déjà plus de
        // deux mille. Ce n'est pas une panne, c'est une file d'attente, et
        // l'objet doit le dire autrement.
        const cause = String(e).toLowerCase()
        if (cause.includes('429') || cause.includes('rate limit')) sature = true
      }

      // Le silence serait pire que l'aveu : la pièce dit qu'elle ne peut pas
      // parler, plutôt que de ne rien dire du tout.
      if (rien) {
        envoyer({ t: sature
          ? (langue === 'en'
              ? 'So many people are asking me at once. Give me a moment and ask again.'
              : "On me sollicite de toutes parts en ce moment. Laisse-moi un instant, puis redemande-moi.")
          : (langue === 'en'
              ? "I can't find my words right now. Ask me again in a moment."
              : "Je ne retrouve pas mes mots à l'instant. Redemande-moi dans un instant.") })
      }
      envoyer({ fin: true })
      c.close()
    }
  })
  return new Response(flux, {
    headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' }
  })
})
