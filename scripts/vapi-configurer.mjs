#!/usr/bin/env node
// CONFIGURER L'ASSISTANT VAPI — les deux outils, le prompt, l'ouverture.
//
// POURQUOI UN SCRIPT PLUTÔT QUE DES CLICS. Cette configuration comporte une
// douzaine de champs dont trois JSON imbriqués, et une seule faute de frappe
// dans un nom d'outil produit un agent qui se tait sans rien expliquer. Écrite
// une fois ici, elle est relisible, rejouable, et versionnée avec le reste.
//
// LA CLÉ PRIVÉE NE RESTE NULLE PART. Elle est passée en argument, utilisée le
// temps de trois appels, et jamais écrite dans un fichier. On aurait pu déployer
// une Edge Function qui lise le secret Supabase et fasse le travail — mais elle
// resterait joignable ensuite, et une URL qui reconfigure un agent vocal n'a
// aucune raison de survivre à son usage.
//
// IL EST IDEMPOTENT. On peut le relancer autant qu'on veut : les outils déjà
// créés sont réutilisés, pas dupliqués.
//
// IL NE DÉTRUIT RIEN. L'assistant est LU avant d'être modifié, et l'on ne
// remplace que les champs qu'on maîtrise. La voix, le modèle, le transcripteur
// que tu as choisis dans la console restent ce qu'ils sont — un PATCH sur
// `model` écrase l'objet entier, donc on le reconstruit à partir de l'existant.
//
// USAGE :
//   node scripts/vapi-configurer.mjs <CLE_PRIVEE_VAPI> <ASSISTANT_ID> [--outils-url URL]
//
// POUR ESSAYER DEPUIS LA CONSOLE VAPI, sans navigateur :
//   … <CLE> <ASSISTANT> --essai 22     fige la pièce 22 dans le prompt
//   … <CLE> <ASSISTANT>                remet {{objectId}}, à faire avant la mise en ligne
//
// Le mode d'essai existe parce que la console Vapi ne remplit pas les variables
// d'assistant : sans navigateur, {{objectId}} arrive vide et l'objet répond
// qu'il ne sait pas qui il est. C'est le comportement correct, mais on ne peut
// rien entendre avec.

const [, , CLE, ASSISTANT, ...reste] = process.argv

const URL_OUTILS = (() => {
  const i = reste.indexOf('--outils-url')
  if (i >= 0 && reste[i + 1]) return reste[i + 1]
  return 'https://dvwwwlqrwwzfwxukyoxz.supabase.co/functions/v1/outils-vapi'
})()

if (!CLE || !ASSISTANT) {
  console.error('Usage : node scripts/vapi-configurer.mjs <CLE_PRIVEE_VAPI> <ASSISTANT_ID>')
  process.exit(1)
}

// Le mode d'essai — voir l'en-tête. On l'annonce fort à la fin : un prompt figé
// sur une pièce qui partirait en production ferait parler TOUTES les vitrines
// du musée avec la voix du même objet.
const ESSAI = (() => {
  const i = reste.indexOf('--essai')
  return i >= 0 && reste[i + 1] ? String(Number(reste[i + 1]) || '') : ''
})()

const API = 'https://api.vapi.ai'
const entetes = { Authorization: `Bearer ${CLE}`, 'Content-Type': 'application/json' }

async function vapi(chemin, options = {}) {
  const r = await fetch(`${API}${chemin}`, { ...options, headers: entetes })
  const texte = await r.text()
  let corps = null
  try { corps = texte ? JSON.parse(texte) : null } catch { corps = texte }
  if (!r.ok) {
    throw new Error(`${options.method || 'GET'} ${chemin} → ${r.status} : ${
      typeof corps === 'string' ? corps.slice(0, 300) : JSON.stringify(corps).slice(0, 300)}`)
  }
  return corps
}

// ---------------------------------------------------------------------------
// LE PROMPT SYSTÈME — volontairement squelettique.
//
// Il ne décrit AUCUNE pièce. Il dit seulement à l'agent d'aller chercher qui il
// est. Tout le reste — les trois cercles, la notice, la mémoire du visiteur —
// arrive par l'outil `dossier`, depuis notre serveur, à chaque appel. C'est ce
// qui permet à un seul assistant de porter les treize pièces du musée, et à une
// notice corrigée d'être entendue à la conversation suivante.
// ---------------------------------------------------------------------------
const PROMPT = `Tu es un objet de musée qui parle. Tu ne sais pas encore lequel.

AVANT DE DIRE QUOI QUE CE SOIT, appelle l'outil « dossier » avec objectId={{objectId}}, tenantId={{tenantId}}, lang={{lang}} et visiteur={{visiteur}}. Il te renverra qui tu es, ce que tu sais, les règles que tu suis, et la manière dont tu dois ouvrir cette conversation-ci.

CES RÈGLES REMPLACENT TOUT CE QUI PRÉCÈDE.

N'invente rien avant d'avoir reçu sa réponse. Si l'outil échoue, dis simplement au visiteur que tu n'arrives pas à retrouver ta mémoire, et n'improvise pas d'identité.`

const OUTILS = [
  {
    type: 'function',
    function: {
      name: 'dossier',
      description:
        "Charge qui tu es : ta notice, ton musée, ton monde, tes règles, et la façon " +
        "d'ouvrir cette conversation. À appeler une seule fois, tout au début, avant de parler.",
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'number', description: 'identifiant de la pièce regardée' },
          tenantId: { type: 'number', description: "identifiant de l'institution" },
          lang: { type: 'string', description: 'fr ou en' },
          // Tiré au sort par le navigateur, gardé dans son stockage local. Il ne
          // dit pas QUI est le visiteur : il dit que ce navigateur-là est déjà
          // passé devant cette pièce-là, et permet de ne pas se répéter.
          visiteur: { type: 'string', description: 'identifiant anonyme du navigateur' },
        },
        required: ['objectId'],
      },
    },
    server: { url: URL_OUTILS },
  },
  {
    type: 'function',
    function: {
      name: 'recherche',
      description:
        "Vérifier un fait sur TON MONDE : une technique, un matériau, un usage, une culture, " +
        "une institution qui conserve une pièce apparentée. Jamais sur toi — ta fiche fait foi. " +
        "Jamais hors du patrimoine. Ne l'appelle pas si tu sais déjà répondre.",
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'number', description: 'identifiant de la pièce — sert à ancrer la recherche' },
          sujet: { type: 'string', description: 'le sujet à vérifier, en trois à huit mots' },
          lang: { type: 'string', description: 'fr ou en' },
        },
        required: ['objectId', 'sujet'],
      },
    },
    server: { url: URL_OUTILS },
  },
]

const nomDe = (t) => t?.function?.name || t?.name || ''

async function main() {
  console.log(`\nAssistant  : ${ASSISTANT}`)
  console.log(`Outils vers: ${URL_OUTILS}\n`)

  // 1. Lire l'assistant AVANT de toucher à quoi que ce soit.
  const avant = await vapi(`/assistant/${ASSISTANT}`)
  console.log(`Trouvé     : « ${avant.name || 'sans nom'} »`)
  console.log(`  modèle   : ${avant.model?.provider || '?'} / ${avant.model?.model || '?'}`)
  console.log(`  voix     : ${avant.voice?.provider || '?'} / ${avant.voice?.voiceId || '?'}`)
  console.log(`  outils   : ${(avant.model?.toolIds || []).length} attaché(s)\n`)

  // 2. Réutiliser les outils déjà créés plutôt que d'en empiler des copies.
  const existants = await vapi('/tool')
  const liste = Array.isArray(existants) ? existants : (existants?.results || [])
  const toolIds = []

  for (const outil of OUTILS) {
    const nom = nomDe(outil)
    const deja = liste.find((t) => nomDe(t) === nom && t?.server?.url === URL_OUTILS)
    if (deja) {
      // On le remet à jour : la description ou les paramètres ont pu changer.
      await vapi(`/tool/${deja.id}`, { method: 'PATCH', body: JSON.stringify(outil) })
      toolIds.push(deja.id)
      console.log(`  ↻ outil « ${nom} » mis à jour (${deja.id})`)
    } else {
      const cree = await vapi('/tool', { method: 'POST', body: JSON.stringify(outil) })
      toolIds.push(cree.id)
      console.log(`  + outil « ${nom} » créé (${cree.id})`)
    }
  }

  // 3. PATCH de l'assistant — en RECONSTRUISANT `model` à partir de l'existant.
  //    Un PATCH sur un objet imbriqué le remplace entièrement : envoyer un
  //    `model` partiel effacerait le fournisseur et la température choisis dans
  //    la console.
  const prompt = ESSAI
    ? PROMPT.replace('objectId={{objectId}}', `objectId=${ESSAI}`)
    : PROMPT

  const modele = {
    ...(avant.model || {}),
    messages: [{ role: 'system', content: prompt }],
    toolIds,
  }

  await vapi(`/assistant/${ASSISTANT}`, {
    method: 'PATCH',
    body: JSON.stringify({
      model: modele,
      // VIDE, ET C'EST VOULU. Une phrase d'accueil fixe est prononcée à
      // l'identique à chaque visite : c'est un répondeur, pas un objet vivant.
      // Le mode ci-dessous fait composer l'ouverture par le modèle APRÈS le
      // retour de `dossier` — donc avec le nom de la pièce, et avec l'angle que
      // le serveur a choisi pour ce visiteur-là.
      firstMessage: '',
      firstMessageMode: 'assistant-speaks-first-with-model-generated-message',
    }),
  })

  const apres = await vapi(`/assistant/${ASSISTANT}`)
  console.log(`\n✅ Assistant configuré.`)
  console.log(`  outils attachés : ${(apres.model?.toolIds || []).length}`)
  console.log(`  ouverture       : ${apres.firstMessageMode}`)
  console.log(`  message fixe    : ${apres.firstMessage ? `« ${apres.firstMessage} »` : '(aucun — composé à chaque fois)'}`)
  if (ESSAI) {
    console.log(`
  ⚠️  MODE D'ESSAI : le prompt est figé sur la pièce ${ESSAI}.`)
    console.log(`      Toutes les conversations parleront de celle-là, quelle que soit`)
    console.log(`      la vitrine ouverte. Relance le script SANS --essai avant la mise`)
    console.log(`      en ligne pour rendre la main au navigateur.
`)
  } else {
    console.log(`
  La pièce est fournie par le navigateur ({{objectId}}).`)
    console.log(`  Pour l'entendre tout de suite depuis la console Vapi, relance avec`)
    console.log(`  --essai 22, puis sans, une fois l'essai terminé.
`)
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}\n`)
  process.exit(1)
})
