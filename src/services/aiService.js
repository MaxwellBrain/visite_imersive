/**
 * Service IA pour l'amélioration de description et la génération de SEO.
 *
 * ⚠️ SÉCURITÉ : on n'appelle JAMAIS Claude directement depuis le frontend
 * (la clé API serait exposée). Ces fonctions appellent un endpoint backend
 * (configuré via VITE_AI_API_BASE) qui, lui, détient la clé côté serveur.
 *
 * Tant qu'aucun backend n'est configuré, un fallback local (mock) est utilisé
 * pour que l'interface reste pleinement démontrable.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Exemple d'endpoint backend (Node/Express + SDK officiel @anthropic-ai/sdk) :
 *
 *   import Anthropic from '@anthropic-ai/sdk'
 *   const client = new Anthropic() // lit ANTHROPIC_API_KEY côté serveur
 *
 *   app.post('/ai/improve-description', async (req, res) => {
 *     const { text, nom } = req.body
 *     const msg = await client.messages.create({
 *       model: 'claude-opus-4-8',
 *       max_tokens: 1024,
 *       thinking: { type: 'adaptive' },
 *       system: "Tu es un médiateur culturel. Améliore et corrige la description " +
 *               "d'un objet de musée : style clair, vivant, sans inventer de faits.",
 *       messages: [{ role: 'user', content: `Objet : ${nom}\n\nDescription à améliorer :\n${text}` }],
 *     })
 *     res.json({ text: msg.content.find(b => b.type === 'text')?.text ?? text })
 *   })
 *
 *   // Pour le SEO, préférer une sortie structurée (output_config.format / json_schema)
 *   // afin d'obtenir directement { title, description, slug, keywords }.
 * ───────────────────────────────────────────────────────────────────────────
 */

const API_BASE = import.meta.env.VITE_AI_API_BASE || ''

// Edge Function « object-ai » (Groq, clé serveur). C'est elle qui fait le
// travail : le simulacre local d'autrefois se contentait d'ajouter une phrase
// toute faite, et aplatissait les paragraphes au passage.
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function appelerObjectAi(payload) {
  if (!SUPA_URL) return { ok: false, error: 'no_backend' }
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/object-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`
      },
      body: JSON.stringify(payload)
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    return await res.json()
  } catch (e) {
    console.warn('[object-ai]', e.message)
    return { ok: false, error: 'network' }
  }
}

function slugify(text) {
  return (text || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Erreur IA (${res.status})`)
  return res.json()
}

/** Améliore / corrige une description d'objet. */
export async function improveDescription({ nom, description }) {
  if (!description || !description.trim()) return description

  if (API_BASE) {
    const data = await postJson('/ai/improve-description', { nom, text: description })
    return data.text
  }

  const r = await appelerObjectAi({ action: 'description', nom, description })
  if (r.ok && r.texte) return r.texte

  // Sans clé ou en cas d'échec, on RENVOIE LE TEXTE INTACT.
  //
  // L'ancienne version fabriquait ici une fausse amélioration : elle collait une
  // phrase générique et aplatissait les sauts de ligne. Mieux vaut ne rien faire
  // et le dire que de dégrader le travail du conservateur en prétendant l'aider.
  const err = new Error(r.error === 'no_api_key' ? 'ai_no_key' : 'ai_unavailable')
  err.code = r.error
  throw err
}

/**
 * Rédige le message WhatsApp qui accompagne la carte de partage d'une œuvre.
 *
 * Renvoie toujours un texte, et dit LEQUEL des deux on a servi :
 *   { texte, parIa: true }  → l'Edge Function a répondu
 *   { texte, parIa: false } → repli factuel local (clé absente, réseau coupé)
 *
 * Le repli n'est pas un faux-semblant : il n'affirme rien qu'on ne sache déjà
 * (le nom, le lieu, la 3D). L'interface indique clairement qu'il n'est pas de
 * l'IA, à charge pour le conservateur de le retoucher — ce qu'il peut faire,
 * puisque le champ reste modifiable.
 */
export async function annonceObjet({ nom, description, lieu, marque, has3d }) {
  const r = await appelerObjectAi({
    action: 'annonce',
    nom,
    description: description || '',
    lieu: lieu || '',
    marque: marque || '',
    has3d: !!has3d
  })
  // Llama rend souvent « ligne 1 \n  ligne 2 » avec des espaces autour des sauts
  // de ligne. Sur WhatsApp cela se voit : chaque ligne paraît mal alignée.
  // On nettoie ici plutôt que dans la fonction serveur — c'est un défaut de
  // rendu du modèle, il peut réapparaître avec n'importe lequel.
  if (r.ok && r.texte) {
    const propre = String(r.texte)
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    return { texte: propre, parIa: true, moteur: r.moteur }
  }

  const ou = lieu ? `\nÀ voir ${lieu.includes('›') ? 'au ' + lieu.split('›')[0].trim() : lieu}.` : ''
  const ar = has3d ? '\nVisible en 3D et en réalité augmentée depuis votre téléphone. 📱' : ''
  return {
    texte: `✨ ${nom || 'Nouvelle pièce'} rejoint la collection${marque ? ` de ${marque}` : ''}.${ou}${ar}`,
    parIa: false,
    erreur: r.error
  }
}

/** Génère les métadonnées SEO à partir du nom + description. */
export async function generateSeo({ nom, description }) {
  if (API_BASE) {
    return postJson('/ai/generate-seo', { nom, description })
  }

  // Fallback local (mock).
  await delay(700)
  const base = (description || '').trim().replace(/\s+/g, ' ')
  const shortDesc = base.length > 150 ? `${base.slice(0, 147)}…` : base
  const keywords = buildKeywords(nom, base)
  return {
    title: nom ? `${nom} — MUSÉA` : 'Objet — MUSÉA',
    description:
      shortDesc ||
      `Découvrez ${nom || 'cet objet'} en visite immersive : histoire, contexte et modèle 3D.`,
    slug: slugify(nom) || slugify(base).slice(0, 40),
    keywords
  }
}

function buildKeywords(nom, description) {
  const stop = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'à', 'au', 'aux',
    'en', 'dans', 'sur', 'par', 'pour', 'avec', 'son', 'sa', 'ses', 'ce', 'cette'
  ])
  const words = `${nom || ''} ${description || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w))
  return [...new Set(words)].slice(0, 6)
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
