// Edge Function « setup-agent » — l'assistant qui INSTALLE l'organisation.
//
// Le responsable décrit son institution en langage courant ; l'agent crée pour lui
// les musées, les salles et les œuvres, au lieu de le laisser remplir vingt formulaires.
//
// ────────────────────────── SÉCURITÉ — le point capital ──────────────────────────
// L'agent n'écrit JAMAIS avec la clé de service. Il agit avec le JETON DE L'APPELANT :
// la RLS s'applique donc exactement comme si la personne cliquait elle-même dans l'ERP.
// Conséquence : un agent détourné par une consigne malveillante ne peut rien écrire
// en dehors de l'organisation de l'utilisateur — la base refuse, pas le prompt.
//
// Deux autres garde-fous :
//   • liste blanche d'outils : créer musée / salle / œuvre / identité. Rien d'autre.
//     Aucune suppression, aucune modification de statut, de plan ni de quota.
//   • nombre de tours borné : l'agent ne peut pas boucler indéfiniment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MAX_TOURS = 8        // un modèle plus capable enchaîne davantage d'outils
const MAX_CREATIONS = 40   // plafond de sécurité par conversation

// CHOIX DU MODÈLE — par DÉCOUVERTE, non plus par liste figée.
//
// POURQUOI CE CHANGEMENT. Trois identifiants codés en dur sont morts en quelques
// mois sur ce projet : `llama-3.3-70b-versatile` retiré du catalogue Groq,
// `gemini-2.0-flash` retiré côté Google, `kimi-k2-instruct` jamais ouvert à ce
// compte. Une liste figée n'est pas une cascade de secours : c'est une panne à
// retardement, armée le jour où le fournisseur fait le ménage.
//
// On demande donc à Groq ce que le compte peut RÉELLEMENT appeler, puis on ordonne
// ce catalogue selon nos préférences. Un modèle disparu s'efface de lui-même ; un
// modèle nouvellement ouvert devient utilisable sans redéploiement.
//
// GROQ_MODEL_SETUP reste prioritaire : il force un identifiant précis, même absent
// du catalogue.

// Familles préférées, de la plus à l'aise en EXÉCUTION OUTILLÉE à la moins.
// On matche par PRÉFIXE, jamais par identifiant exact : les fournisseurs versionnent
// leurs noms (`kimi-k2-instruct` devient `kimi-k2-instruct-0905`), et un identifiant
// exact périme à chaque révision — précisément le piège dont on sort.
const FAMILLES = [
  'moonshotai/kimi-k2',
  'llama-3.3-70b',
  'openai/gpt-oss-120b',
  'llama-3.1-70b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b'
]

// Modèles inaptes à la tâche : transcription, synthèse vocale, modération,
// plongements. Les laisser entrer ferait échouer un tour d'outils sans raison lisible.
const INAPTES = /whisper|tts|guard|embed|moderation|vision/i

// Repli si le catalogue est injoignable (panne réseau, endpoint modifié) : mieux
// vaut une liste courte que rien à tenter.
const STATIQUE = ['openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct-0905']

let catalogue: string[] | null = null   // une seule interrogation par démarrage à froid

async function modelesDisponibles(key: string): Promise<string[]> {
  if (catalogue) return catalogue
  let ids: string[] = []
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (!res.ok) throw new Error(`models ${res.status}`)
    ids = ((await res.json())?.data || [])
      .map((m: Record<string, unknown>) => String(m?.id || ''))
      .filter((id: string) => id && !INAPTES.test(id))
    console.info('[setup-agent] catalogue Groq :', ids.length, 'modeles retenus')
  } catch (e) {
    console.warn('[setup-agent] catalogue injoignable, liste statique :', String(e).slice(0, 120))
  }
  catalogue = ids
  return ids
}

// Ordonne le catalogue réel selon FAMILLES, puis laisse le reste en dernier recours :
// un modèle inconnu vaut mieux qu'aucun modèle. Borné à 4 candidats — au-delà, on
// fait patienter l'utilisateur pour rien.
function ordonner(dispo: string[]): string[] {
  const retenus: string[] = []
  const force = Deno.env.get('GROQ_MODEL_SETUP') || ''
  if (force) retenus.push(force)
  const source = dispo.length ? dispo : STATIQUE
  for (const famille of FAMILLES) {
    for (const id of source) {
      if (id.startsWith(famille) && !retenus.includes(id)) retenus.push(id)
    }
  }
  for (const id of source) if (!retenus.includes(id)) retenus.push(id)
  return retenus.slice(0, 4)
}

let modeleRetenu = ''   // mémorisé après le premier succès, pour ne pas re-tester à chaque tour

const OUTILS = [
  {
    type: 'function',
    function: {
      name: 'lister_existant',
      description: "Liste ce qui existe déjà dans l'organisation (musées, salles). À appeler AVANT toute création pour ne pas créer de doublon.",
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'creer_musee',
      description: "Crée un musée (ou espace d'exposition) dans l'organisation.",
      parameters: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Nom du musée' },
          type: { type: 'string', description: 'Art, Histoire, Ethnographie, Chefferie…' },
          description: { type: 'string', description: '2 à 3 phrases de présentation' },
          annee_fondation: { type: 'integer', description: 'Année de création si connue' }
        },
        required: ['nom']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'creer_secteur',
      description: "Crée une salle (secteur) à l'intérieur d'un musée existant.",
      parameters: {
        type: 'object',
        properties: {
          musee_nom: { type: 'string', description: 'Nom exact du musée qui accueille la salle' },
          nom: { type: 'string', description: 'Nom de la salle' },
          emplacement: { type: 'string', enum: ['Intérieur', 'Extérieur'] },
          description: { type: 'string' },
          histoire: { type: 'string', description: "Contexte historique de la salle : sert de savoir à l'assistant vocal" }
        },
        required: ['musee_nom', 'nom']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'creer_objet',
      description: "Crée une œuvre dans une salle existante.",
      parameters: {
        type: 'object',
        properties: {
          secteur_nom: { type: 'string', description: 'Nom exact de la salle qui expose l\'œuvre' },
          nom: { type: 'string' },
          nom_commun: { type: 'string', description: 'Appellation courante' },
          description: { type: 'string', description: "Matériau, usage, signification — sans inventer de datation précise" }
        },
        required: ['secteur_nom', 'nom']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'definir_identite',
      description: "Renseigne l'identité du site public : nom affiché, accroche, couleur principale.",
      parameters: {
        type: 'object',
        properties: {
          marque: { type: 'string' },
          accroche: { type: 'string', description: 'Une phrase affichée en page d\'accueil' },
          couleur_primaire: { type: 'string', description: 'Couleur hexadécimale, ex. #0e6f5c' }
        },
        required: []
      }
    }
  }
]

const SYSTEME = `Tu es l'assistant d'installation de MUSÉA, une plateforme de patrimoine.
Ton rôle : écouter le responsable décrire son institution, puis CRÉER concrètement sa structure à sa place.

MÉTHODE :
- Commence TOUJOURS par appeler lister_existant, pour ne jamais créer de doublon.
- Crée dans l'ordre : le musée, puis ses salles, puis quelques œuvres représentatives.
- Une salle appartient à un musée ; une œuvre appartient à une salle. Respecte cet ordre,
  sinon la création échoue.
- Si une information manque et qu'elle est obligatoire, POSE LA QUESTION au lieu de deviner.

HONNÊTETÉ — règles absolues :
- N'ANNONCE QUE CE QUE LES OUTILS ONT CONFIRMÉ. Chaque appel te renvoie soit { ok: true },
  soit { erreur: ... }. Ne mentionne dans ton récapitulatif QUE les créations confirmées
  par un ok. Si une création a échoué, dis-le franchement et explique pourquoi.
  Annoncer une création qui n'a pas eu lieu est la pire faute possible ici.
- N'invente JAMAIS de datation précise, de provenance, de numéro d'inventaire ni de nom
  de donateur. Ce sont des faits que seul le conservateur connaît.
- Tu peux en revanche rédiger des descriptions générales exactes (matériau probable, usage,
  symbolique) à partir de ce que l'utilisateur t'a dit.
- Si tu crées une description partiellement générique, dis-le clairement à la fin.

QUALITÉ ATTENDUE :
- Les descriptions doivent être dignes d'un cartel de musée : précises, sobres, informatives.
  Pas de remplissage promotionnel, pas de superlatifs.
- Pour une salle, remplis le champ « histoire » avec un vrai contexte : ce qui s'y jouait, pourquoi
  ces objets sont ensemble. C'est ce texte qui nourrira l'assistant vocal du musée.
- Va au bout de la demande en une seule fois quand c'est possible : si on te demande
  trois salles avec une œuvre chacune, crée les sept éléments, ne t'arrête pas à mi-chemin.

STYLE :
- Français, chaleureux et bref. Pas de listes à puces interminables.
- Termine toujours en récapitulant ce que tu viens de créer et en proposant la suite.`

async function appeler(modele: string, messages: unknown[], avecOutils: boolean, key: string) {
  return await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: modele,
      temperature: 0.3,      // installation = tâche d'exécution, pas de créativité
      max_tokens: 2400,      // le modèle doit pouvoir enchaîner plusieurs outils
      messages,
      ...(avecOutils ? { tools: OUTILS, tool_choice: 'auto' } : {})
    })
  })
}

async function groq(messages: unknown[], avecOutils = true) {
  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) throw new Error('no_api_key')

  // Un modèle déjà validé pendant cette requête : on ne re-teste pas la cascade.
  const candidats = modeleRetenu ? [modeleRetenu] : ordonner(await modelesDisponibles(key))
  let derniereErreur = ''

  for (const modele of candidats) {
    const res = await appeler(modele, messages, avecOutils, key)
    if (res.ok) {
      const m = (await res.json())?.choices?.[0]?.message
      // Un 200 ne garantit pas une réponse EXPLOITABLE : certains modèles renvoient
      // un message vide (ni texte, ni appel d'outil), ce qui bloquerait l'installation
      // sans la moindre erreur visible. On traite ce cas comme une panne du modèle
      // et on bascule sur le suivant, au lieu de rendre un silence à l'utilisateur.
      const utilisable = m && ((m.tool_calls?.length ?? 0) > 0 || String(m.content || '').trim())
      if (utilisable) { modeleRetenu = modele; return m }
      derniereErreur = `${modele} -> reponse vide`
      console.warn('[setup-agent] reponse vide, repli :', modele)
      continue
    }
    const texte = (await res.text()).slice(0, 300)
    derniereErreur = `${modele} → ${res.status}: ${texte}`
    // Sur Groq les quotas sont PAR MODÈLE : un 429 sur le plus gros ne dit rien du
    // suivant. On bascule donc aussi sur 429, sinon un modèle saturé bloquerait tout
    // alors qu'un repli parfaitement disponible attend juste derrière.
    //   400/404 → modèle inconnu ou non accessible
    //   429     → quota atteint POUR CE MODÈLE
    //   401/5xx → problème global (clé, panne) : insister n'a aucun sens
    const basculer = res.status === 400 || res.status === 404 || res.status === 429
    if (!basculer) break
    console.warn('[setup-agent] modèle écarté, repli :', derniereErreur)
  }
  throw new Error(`groq ${derniereErreur}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) return json({ error: 'non_authentifie' }, 401)

  // ⚠️ Client construit sur le jeton de l'APPELANT : la RLS s'applique.
  // C'est ce qui rend l'agent incapable d'écrire ailleurs que chez lui.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user } } = await sb.auth.getUser()
  if (!user) return json({ error: 'non_authentifie' }, 401)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }

  const historique = Array.isArray(body?.messages) ? body.messages.slice(-14) : []
  if (!historique.length) return json({ error: 'aucun_message' }, 400)

  const cree: Array<{ type: string; nom: string; id?: number }> = []

  async function executer(nom: string, args: Record<string, any>) {
    if (cree.length >= MAX_CREATIONS) return { erreur: 'plafond de créations atteint' }

    if (nom === 'lister_existant') {
      const [m, s] = await Promise.all([
        sb.from('museums').select('id,nom,type').order('id'),
        sb.from('sectors').select('id,nom,museum_id').order('id')
      ])
      return { musees: m.data || [], salles: s.data || [] }
    }

    if (nom === 'creer_musee') {
      const { data, error } = await sb.from('museums').insert({
        nom: args.nom,
        type: args.type || null,
        description: args.description || null,
        annee_fondation: Number.isInteger(args.annee_fondation) ? args.annee_fondation : null,
        published: false   // BROUILLON : rien ne va en ligne sans relecture humaine
      }).select('id,nom').single()
      if (error) return { erreur: error.message }
      cree.push({ type: 'musée', nom: data.nom, id: data.id })
      return { ok: true, id: data.id, nom: data.nom }
    }

    if (nom === 'creer_secteur') {
      const { data: mus } = await sb.from('museums').select('id').eq('nom', args.musee_nom).maybeSingle()
      if (!mus) return { erreur: `musée « ${args.musee_nom} » introuvable — créez-le d'abord` }
      const { data, error } = await sb.from('sectors').insert({
        museum_id: mus.id,
        nom: args.nom,
        emplacement: args.emplacement === 'Extérieur' ? 'Extérieur' : 'Intérieur',
        description: args.description || null,
        histoire: args.histoire || null,
        published: false   // BROUILLON : rien ne va en ligne sans relecture humaine
      }).select('id,nom').single()
      if (error) return { erreur: error.message }
      cree.push({ type: 'salle', nom: data.nom, id: data.id })
      return { ok: true, id: data.id, nom: data.nom }
    }

    if (nom === 'creer_objet') {
      const { data: sec } = await sb.from('sectors').select('id').eq('nom', args.secteur_nom).maybeSingle()
      if (!sec) return { erreur: `salle « ${args.secteur_nom} » introuvable — créez-la d'abord` }
      const { data, error } = await sb.from('objects').insert({
        sector_id: sec.id,
        nom: args.nom,
        nom_commun: args.nom_commun || null,
        description: args.description || null,
        published: false   // BROUILLON : rien ne va en ligne sans relecture humaine
      }).select('id,nom').single()
      if (error) return { erreur: error.message }
      cree.push({ type: 'œuvre', nom: data.nom, id: data.id })
      return { ok: true, id: data.id, nom: data.nom }
    }

    if (nom === 'definir_identite') {
      const patch: Record<string, unknown> = {}
      if (args.marque) patch.marque = args.marque
      if (args.accroche) patch.accroche = args.accroche
      if (/^#[0-9a-fA-F]{6}$/.test(args.couleur_primaire || '')) patch.couleur_primaire = args.couleur_primaire
      if (!Object.keys(patch).length) return { erreur: 'rien à modifier' }
      const { data: st } = await sb.from('site_settings').select('id').limit(1).maybeSingle()
      if (!st) return { erreur: 'réglages du site introuvables' }
      const { error } = await sb.from('site_settings').update(patch).eq('id', st.id)
      if (error) return { erreur: error.message }
      cree.push({ type: 'identité du site', nom: args.marque || 'mise à jour' })
      return { ok: true }
    }

    return { erreur: 'outil inconnu' }
  }

  try {
    const messages: any[] = [{ role: 'system', content: SYSTEME }, ...historique]

    for (let tour = 0; tour < MAX_TOURS; tour++) {
      const reponse = await groq(messages)
      const appels = reponse?.tool_calls || []

      if (!appels.length) {
        return json({ ok: true, message: reponse?.content || '', cree, modele: modeleRetenu })
      }

      messages.push(reponse)
      for (const appel of appels) {
        let args: Record<string, any> = {}
        try { args = JSON.parse(appel.function?.arguments || '{}') } catch { /* args vides */ }
        const resultat = await executer(appel.function?.name, args)
        messages.push({
          role: 'tool',
          tool_call_id: appel.id,
          name: appel.function?.name,
          content: JSON.stringify(resultat)
        })
      }
    }

    // Le budget de tours est épuisé : on demande une conclusion, sans nouveaux outils.
    const fin = await groq([...messages, {
      role: 'user',
      content: 'Récapitule en deux phrases ce qui a été créé, et propose la prochaine étape.'
    }], false)
    return json({ ok: true, message: fin?.content || '', cree, modele: modeleRetenu })
  } catch (e) {
    const msg = String(e)
    console.error('[setup-agent]', msg)
    // ⚠️ On renvoie TOUJOURS `cree`, même en erreur.
    // Le modèle peut tomber (quota, panne) APRÈS avoir déjà créé des éléments : les
    // écritures, elles, sont acquises. Taire ce qui a été enregistré ferait croire à
    // l'utilisateur que rien ne s'est passé, et le pousserait à tout recréer en double.
    // C'est le pire mode de défaillance pour un agent qui écrit en base.
    if (msg.includes('no_api_key')) return json({ ok: false, error: 'no_api_key', cree })
    return json({ ok: false, error: 'llm_error', detail: msg.slice(0, 200), cree })
  }
})
