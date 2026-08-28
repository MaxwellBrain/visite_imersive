// Edge Function « guide-spectral-live » — le guide qui PARLE EN DIRECT.
//
// Le visiteur pose les yeux sur un élément, ou pose une question à voix haute ;
// Claude rédige la réponse à cet instant, en tenant compte de ce qui a déjà été
// dit, et le texte part vers la synthèse vocale AU FIL DE SA PRODUCTION.
//
// TROIS CHOSES QUI EXPLIQUENT TOUT LE FICHIER
//
//  1. LA LATENCE EST LE SUJET. Un guide qui met trois secondes à répondre n'est
//     pas un guide, c'est un formulaire. D'où la diffusion (`appelerBedrockFlux`)
//     et, côté client, l'anticipation : la requête part AVANT que la fixation
//     du regard soit validée. Ce qu'on mesure et journalise, c'est le délai
//     avant le PREMIER MOT — pas avant le dernier.
//
//  2. PUBLIQUE, DONC ANONYME. Le visiteur n'a pas de compte. Le client Supabase
//     est construit avec la clé ANONYME : la RLS ne lui donne accès qu'au
//     contenu publié, et l'organisation est déduite de la SCÈNE, jamais du
//     corps de la requête. Envoyer un `tenantId` depuis le navigateur
//     laisserait choisir sa cible à qui sait forger une requête.
//
//  3. IL N'Y A PLUS DE RELECTURE AVANT. C'est le prix de l'improvisation, et il
//     faut le dire clairement. Ce qui la remplace tient en trois lignes de ce
//     fichier : le corpus est limité aux notices publiées, tout ce qui a été
//     dit est enregistré dans `ar_improvisations`, et l'aveu d'ignorance est
//     une réponse explicitement autorisée — c'est le garde-fou qui compte le
//     plus, parce qu'un modèle sommé de répondre répond toujours.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { appelerBedrockFlux, bedrockConfigure, MODELES } from '../_shared/bedrock.ts'
import { corpusDeLaScene, type Source } from '../_shared/spectralCorpus.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Au-delà, la conversation coûte plus en latence qu'elle ne rapporte en
// continuité : le visiteur ne se souvient pas non plus de sa quinzième phrase.
const TOURS_MEMOIRE = 8
const DELAI_MAX_MS = 20000

// Hors sujet : on refuse AVANT d'appeler le modèle. Inutile de payer une
// inférence pour apprendre que la question portait sur le football.
const HORS_SUJET = /(m[eé]t[eé]o|actualit|[eé]lection|politiqu|football|\bfoot\b|recette|bitcoin|crypto|bourse|viagra|programm|javascript|python)/i

// Le guide a-t-il reconnu ne pas savoir ? Détecté après coup plutôt que
// demandé au modèle : lui faire produire un marqueur polluerait un texte qui
// part directement vers la synthèse vocale.
const AVEU = /(je ne (le )?sais pas|je l'ignore|je ne peux pas te (le )?dire|rien (ne|n'est) (dit|pr[eé]cis)|les notices n[e']|on ne me l'a pas)/i

// ---------------------------------------------------------------------------
// PROMPT SYSTÈME — parole vivante
// ---------------------------------------------------------------------------
// Il diffère de celui de la rédaction à l'avance sur un point qu'on n'attend
// pas : la PREMIÈRE PHRASE. En diffusion, elle est prononcée pendant que la
// suite s'écrit. Si elle commence par une subordonnée, la voix s'arrête au
// milieu d'une proposition et l'illusion tombe. C'est la contrainte la plus
// spécifique au direct, et la plus facile à oublier.
function promptDirect(opts: {
  persona: string
  sources: Source[]
  focus: Set<number>
  langue: string
}) {
  const { persona, sources, focus, langue } = opts

  const notices = sources.map((s, i) =>
    `[${i}]${focus.has(i) ? ' ★ CE QU\'IL REGARDE' : ''} (${s.origine}) ${s.texte}`
  ).join('\n')

  return `Tu es le guide d'un musée de chefferie camerounaise. Tu te tiens à côté d'un visiteur, à l'intérieur d'une case traditionnelle reconstituée à taille réelle, en réalité augmentée. Tu parles à voix haute, maintenant. Ce que tu écris sera prononcé tel quel, sans être relu par personne.
${persona ? `\nQUI TU ES\n${persona}\n` : ''}
TES SOURCES
Les notices ci-dessous ont été rédigées par les conservateurs de cette institution. Elles sont ton unique savoir sur cette case et sur ces objets. Tu n'as pas le droit d'y ajouter :
- une date, un siècle, un chiffre, une mesure ;
- un nom de personne, de dynastie, de village ou d'ethnie ;
- une fonction rituelle, une croyance, un usage ;
- une comparaison avec une autre culture, un autre musée, un autre objet.
Un fait absent des notices n'est pas un fait à retrouver dans ta mémoire : c'est un fait que tu ne connais pas.

${notices || '(aucune notice disponible)'}

NE PAS SAVOIR EST UNE RÉPONSE
Quand ce qu'on te demande sort des notices, dis-le en une phrase, sans t'excuser longuement, puis propose ce que tu sais vraiment s'il y a un lien : « Ça, je ne le sais pas. Ce que je peux te dire, c'est… ». Un guide qui avoue vaut mieux qu'un guide qui invente, et le visiteur entend la différence immédiatement. Ne comble jamais un vide par une généralité qui sonne juste.

COMMENT TU PARLES
- Ta PREMIÈRE PHRASE est courte et se suffit à elle-même. Elle sera prononcée pendant que tu rédiges la suite : ne commence jamais par une subordonnée, ni par une formule d'attente du type « alors », « eh bien », « c'est une bonne question ».
- Tu parles, tu n'écris pas. Aucune mise en forme : ni titre, ni liste, ni tiret, ni gras, ni guillemets décoratifs, ni emoji, ni parenthèses. Rien que des phrases.
- Tutoiement. Voix posée, sans familiarité forcée, sans jamais l'appeler « visiteur ».
- Tu pars du concret : ce qu'il a sous les yeux, ce qu'il pourrait toucher, sentir, entendre.
- Une seule idée à la fois. Tu n'es pas obligé de tout dire — tu seras encore là dans dix secondes.
- Tu ne répètes jamais ce que tu viens de dire, même autrement.
- Tu termines sans poser de question qui attende une réponse. Le guide n'est pas un questionnaire.

REGISTRE
Tu parles d'une architecture et de savoir-faire vivants, pas de vestiges. N'emploie jamais « primitif », « ancestral », « tribal », « authentique », « mystérieux », « âme africaine ». Pas de « on raconte que », « il semblerait », « la légende dit » : ces formules donnent le poids d'une source à une absence de source. Pas de superlatif publicitaire, pas d'exclamation, pas d'humour.

HORS DE TON DOMAINE
Météo, actualité, politique, ou ta propre nature technique : tu déclines en une phrase courtoise et tu ramènes à la case. Tu ne dis jamais que tu es un modèle de langage, une intelligence artificielle ou un programme. Tu es le guide de ce musée.

LANGUE
Tu réponds en ${langue === 'en' ? 'anglais naturel' : 'français'}.`
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'méthode non autorisée' }, 405)

  let corps: {
    sceneId?: number
    hotspotId?: number | null
    question?: string
    session?: string
    lang?: string
    historique?: Array<{ role: 'user' | 'assistant'; texte: string }>
    contexte?: { dejaVus?: string[]; dureeVisiteS?: number }
  }
  try { corps = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const sceneId = Number(corps.sceneId)
  if (!Number.isFinite(sceneId)) return json({ error: 'sceneId manquant' }, 400)
  const hotspotId = corps.hotspotId != null ? Number(corps.hotspotId) : null
  const question = (corps.question || '').trim().slice(0, 400)
  const langue = corps.lang === 'en' ? 'en' : 'fr'
  const session = corps.session || crypto.randomUUID()

  // Clé ANONYME : la RLS ne laisse voir que le contenu publié. Voir l'en-tête.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  )

  const { data: scene } = await supabase
    .from('ar_scenes').select('id, museum_id, titre, archetype')
    .eq('id', sceneId).eq('published', true).maybeSingle()
  if (!scene) return json({ error: 'scène introuvable ou non publiée', repli: true }, 404)

  const { data: cfg } = await supabase
    .from('ar_avatar_configs')
    .select('modele, persona, improvisation, questions_ouvertes, nom')
    .eq('museum_id', scene.museum_id).eq('published', true).maybeSingle()

  // Le musée a coupé l'improvisation : le client retombe sur `ar_recits`.
  // Ce n'est pas une erreur, c'est un réglage — d'où le 200.
  if (cfg && cfg.improvisation === false) {
    return json({ repli: true, raison: 'improvisation désactivée pour ce musée' })
  }
  if (question && cfg && cfg.questions_ouvertes === false) {
    return json({ repli: true, raison: 'questions libres désactivées pour ce musée' })
  }
  if (question && HORS_SUJET.test(question)) {
    return json({
      texte: `Ça, c'est en dehors de ce que je connais. Je suis là pour cette maison — demande-moi ce que tu vois.`,
      horsSujet: true
    })
  }
  if (!bedrockConfigure()) return json({ repli: true, raison: 'Bedrock non configuré' })

  // ---- Corpus -------------------------------------------------------------
  const { sources, focus } = await corpusDeLaScene(supabase, sceneId, hotspotId)
  if (!sources.length) {
    return json({ repli: true, raison: 'aucune notice validée sur cette scène' })
  }

  // ---- Le tour courant ----------------------------------------------------
  const { data: points } = await supabase
    .from('ar_hotspots').select('id, code, libelle').eq('scene_id', sceneId)
  const regarde = points?.find((p) => p.id === hotspotId)

  const dejaVus = (corps.contexte?.dejaVus || []).filter(Boolean)
  const minutes = Math.round((corps.contexte?.dureeVisiteS || 0) / 60)

  const situation = [
    regarde ? `Il regarde en ce moment : ${regarde.libelle}.` : '',
    dejaVus.length ? `Tu lui as déjà parlé de : ${dejaVus.join(', ')}. N'y reviens pas.` : '',
    minutes >= 1 ? `Il est là depuis environ ${minutes} minute(s).` : 'Il vient d\'arriver.'
  ].filter(Boolean).join(' ')

  const consigne = question
    // Une réponse qui s'étire cesse d'être une réponse : la borne est plus
    // basse que celle d'un récit, et c'est volontaire.
    ? `${situation}\n\nIl te demande : « ${question} »\n\nRéponds-lui en vingt-cinq à soixante-cinq mots.`
    : `${situation}\n\nRaconte-lui ce qu'il regarde, en quarante à quatre-vingt-dix mots. Choisis UN aspect, celui qui éclaire le mieux ce qu'il a sous les yeux.`

  const historique = (corps.historique || []).slice(-TOURS_MEMOIRE)
  const messages = [
    ...historique.map((h) => ({
      role: h.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: [{ text: String(h.texte || '').slice(0, 1200) }]
    })),
    { role: 'user' as const, content: [{ text: consigne }] }
  ]

  const modele = MODELES[(cfg?.modele || 'equilibre') as keyof typeof MODELES] || MODELES.equilibre

  // ---- Diffusion ----------------------------------------------------------
  const encodeur = new TextEncoder()
  const debut = Date.now()
  let latencePremierMot: number | null = null
  let complet = ''

  const ctrl = new AbortController()
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_MAX_MS)

  const flux = new ReadableStream({
    async start(controleur) {
      const envoyer = (o: unknown) =>
        controleur.enqueue(encodeur.encode(`data: ${JSON.stringify(o)}\n\n`))

      try {
        for await (const fragment of appelerBedrockFlux({
          modele,
          systeme: promptDirect({ persona: cfg?.persona || '', sources, focus, langue }),
          messages,
          // Assez pour quatre-vingt-dix mots et pas davantage : un plafond bas
          // est aussi une garantie de brièveté, quand la consigne ne suffit pas.
          maxTokens: 320,
          // Plus haute qu'en rédaction (0,35) : on veut une parole vivante, qui
          // ne resserve pas la même tournure au troisième point chaud. Le
          // garde-fou contre l'invention n'est pas la température, c'est le
          // corpus — le baisser n'ajouterait aucune sécurité.
          temperature: 0.7,
          signal: ctrl.signal
        })) {
          if (latencePremierMot === null) latencePremierMot = Date.now() - debut
          complet += fragment
          envoyer({ t: fragment })
        }

        // ---- Trace de ce qui a RÉELLEMENT été dit --------------------------
        // Écrite avant de fermer le flux : après la fermeture, rien ne garantit
        // que le runtime nous laisse encore travailler.
        let id: number | null = null
        if (complet.trim()) {
          const { data } = await supabase.from('ar_improvisations').insert({
            scene_id: sceneId,
            hotspot_id: hotspotId,
            session,
            question: question || null,
            texte: complet.trim(),
            lang: langue,
            modele,
            latence_ms: latencePremierMot,
            aveu: AVEU.test(complet),
            sources: sources.map((s) => s.ref)
          }).select('id').maybeSingle()
          id = data?.id ?? null
        }

        envoyer({ fin: true, id, latenceMs: latencePremierMot, aveu: AVEU.test(complet) })
      } catch (e) {
        // Bedrock indisponible, quota épuisé, délai dépassé : le client se
        // rabat sur les récits relus. Le visiteur ne doit jamais entendre le
        // silence d'une panne.
        envoyer({ erreur: String((e as Error).message).slice(0, 200), repli: true })
      } finally {
        clearTimeout(minuteur)
        controleur.close()
      }
    },
    cancel() {
      // Le visiteur a détourné le regard : on coupe la génération. Sans cela,
      // l'anticipation ferait payer chaque coup d'œil au prix d'un récit entier.
      clearTimeout(minuteur)
      ctrl.abort()
    }
  })

  return new Response(flux, {
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  })
})
