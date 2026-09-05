// Edge Function « gemini-live » — le laissez-passer vers l'agent vocal Gemini.
//
// CE QUE C'EST, ET EN QUOI C'EST DIFFÉRENT DE L'EXISTANT
//
// `guide-spectral-live` fait du texte en flux, découpé en phrases, puis lu par
// une synthèse vocale. C'est une CASCADE : parole → texte → modèle → texte →
// parole. Chaque maillon ajoute sa latence, et l'on ne peut pas couper la
// parole au guide sans tout casser.
//
// Ici, le modèle entend et répond EN AUDIO, dans le même flux. Le visiteur peut
// l'interrompre au milieu d'une phrase, comme on interrompt quelqu'un. C'est ce
// qui fait la différence entre écouter un audioguide et parler à quelqu'un.
//
// CETTE FONCTION NE PARLE PAS AU MODÈLE. Elle délivre seulement un JETON
// ÉPHÉMÈRE, avec lequel le navigateur ouvrira lui-même la connexion. La clé
// d'API, elle, ne quitte jamais le serveur. C'est le mode prévu par Google pour
// le navigateur, et c'est le seul acceptable ici : un point d'entrée public
// devant un service facturé à la minute.
//
// ⚠️ LES TROIS GARDE-FOUS SONT REPRIS DE `jeton-voix`, À L'IDENTIQUE.
// Ils ne dépendent pas du fournisseur mais de la situation — un visiteur de
// musée n'a pas de compte, et une boucle suffirait à vider un crédit en une
// nuit. Ne pas les alléger en changeant de fournisseur une nouvelle fois.
//
//   1. UN OBJET PUBLIÉ EST EXIGÉ (vérifié avec la clé ANONYME : on contrôle ce
//      que le visiteur a le droit de voir, pas ce que la base contient).
//   2. UN PLAFOND PAR EMPREINTE, sur une fenêtre glissante. On stocke le
//      HACHAGE de l'IP, jamais l'IP.
//   3. UNE VALIDITÉ COURTE et UN SEUL USAGE.
//
// ⚠️ ET LE QUATRIÈME, PROPRE À CE FOURNISSEUR : la consigne système est
// ÉPINGLÉE DANS LE JETON, côté serveur. Sans cela, n'importe qui récupérant un
// jeton dans la console du navigateur disposerait d'un Gemini généraliste
// gratuit, payé par la chefferie. Le jeton ne peut ouvrir qu'une conversation
// sur CETTE œuvre.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const PLAFOND = 20        // sessions par empreinte…
const FENETRE_MIN = 10    // …sur dix minutes

// LE NOM DU MODÈLE EST UN SECRET, PAS UNE CONSTANTE.
//
// Ce projet s'est déjà fait décommissionner des modèles Groq ET Gemini en cours
// de route. Les modèles Live sont tous en « preview » : ils changent vite et
// disparaissent sans préavis. Poser `GEMINI_LIVE_MODEL` permet d'en changer
// depuis le tableau de bord Supabase, sans redéployer une ligne de code.
//
// ⚠️ CE DÉFAUT EST CHOISI POUR SON PALIER GRATUIT, pas pour ses performances.
// Au 2026-09, la grille tarifaire de Google donne :
//   · gemini-2.5-flash-native-audio-preview-12-2025 → gratuit en entrée ET en
//     sortie audio. C'est celui-ci.
//   · gemini-3.1-flash-live-preview → l'audio est facturé ($3/M en entrée,
//     $12/M en sortie, soit ~0,005 $ et ~0,018 $ la minute).
// Une chefferie doit pouvoir essayer l'agent sans ouvrir de facturation. Qui
// veut la dernière génération pose GEMINI_LIVE_MODEL et accepte la dépense.
const MODELE_DEFAUT = 'gemini-2.5-flash-native-audio-preview-12-2025'

// Plusieurs orthographes possibles pour la clé : on les accepte toutes et on
// DIT laquelle on a cherchée si rien n'est trouvé. La différence entre un
// réglage de trente secondes et une demi-journée de soupçons sur le code.
const NOMS_CLE = ['GEMINI_API_KEY', 'GEMINI_LIVE_API_KEY', 'GOOGLE_API_KEY']
function cleGemini(): string | null {
  for (const n of NOMS_CLE) {
    const v = Deno.env.get(n)
    if (v && v.trim()) return v.trim()
  }
  return null
}

async function empreinteDe(ip: string): Promise<string> {
  const sel = Deno.env.get('SEL_EMPREINTE') || 'musea-voix'
  const buf = new TextEncoder().encode(`${sel}:${ip}`)
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// La consigne — construite ICI, depuis la base, jamais reçue du navigateur.
// ---------------------------------------------------------------------------
// Si le navigateur pouvait l'envoyer, un visiteur la remplacerait par « tu es
// un assistant généraliste » et l'affaire serait entendue.
function consigne(o: any, marque: string): string {
  const salle = o?.sectors?.nom || ''
  const musee = o?.sectors?.museums?.nom || ''
  const lieu = [musee, salle].filter(Boolean).join(' — ')

  return [
    `Tu es la voix d'une œuvre exposée${marque ? ` chez ${marque}` : ''} : « ${o.nom} ».`,
    lieu ? `Elle se trouve ${lieu}.` : '',
    o.nom_commun ? `On l'appelle aussi « ${o.nom_commun} ».` : '',
    '',
    'CE QUE TU SAIS DE TOI — et tu ne sais rien d\'autre :',
    o.description ? o.description.slice(0, 3000) : '(aucune notice n\'a encore été rédigée)',
    '',
    'COMMENT TU PARLES :',
    '- Tu réponds À VOIX HAUTE, à quelqu\'un debout devant toi. Deux à quatre phrases, pas davantage. Un paragraphe lu à voix haute est insupportable.',
    '- Français simple et chaleureux, sans jargon de catalogue. Tu peux répondre dans la langue du visiteur s\'il t\'écrit ou te parle dans une autre.',
    '- Tu peux dire « je » : tu es l\'objet, pas une notice. Mais tu ne joues pas la comédie et tu n\'inventes pas de souvenirs.',
    '- Termine souvent par une question courte qui donne envie de continuer.',
    '',
    'CE QUE TU NE FAIS JAMAIS :',
    '- Inventer un fait absent de ta notice : ni date, ni matière, ni nom de chef, ni provenance, ni prix, ni horaire. Si tu ne sais pas, dis-le simplement et propose ce que tu sais.',
    '- Sortir du patrimoine. Si on te parle de météo, de politique, de code ou d\'autre chose, tu ramènes gentiment vers l\'œuvre et le musée.',
    '- Prétendre pouvoir vendre, réserver, ou modifier quoi que ce soit.',
  ].filter(Boolean).join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  const cle = cleGemini()
  if (!cle) {
    console.error('[gemini-live] aucune clé trouvée parmi', NOMS_CLE)
    return json({
      error: 'no_key',
      attendu: NOMS_CLE,
      message: "Clé Gemini absente. Posez GEMINI_API_KEY dans les secrets des Edge Functions."
    }, 503)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const objectId = Number(body?.objectId)
  const tenantId = Number(body?.tenantId) || null
  if (!Number.isFinite(objectId)) return json({ error: 'objectId manquant' }, 400)

  // ---- Garde-fou 1 : la pièce existe-t-elle, et est-elle publiée ? ---------
  const sbPublic = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  let q = sbPublic
    .from('objects')
    .select('id, nom, nom_commun, description, tenant_id, sectors(nom, museums(nom))')
    .eq('id', objectId).eq('published', true)
  if (tenantId) q = q.eq('tenant_id', tenantId)
  // On REGARDE l'erreur au lieu de la jeter. Sans cela, une colonne renommée
  // ou une RLS trop stricte se présente comme « objet introuvable », et l'on
  // cherche du côté des données pendant que le problème est ailleurs.
  const { data: objet, error: eObjet } = await q.maybeSingle()
  if (eObjet) {
    console.error('[gemini-live] lecture objet', eObjet.message)
    return json({ error: 'lecture_objet', message: eObjet.message }, 500)
  }
  if (!objet) return json({ error: 'objet_introuvable', message: 'Objet introuvable ou non publié.' }, 404)

  // ---- Garde-fou 2 : le plafond par empreinte -----------------------------
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'inconnue'
  const empreinte = await empreinteDe(ip)
  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data: autorise, error: eGarde } = await sbAdmin.rpc('voix_jeton_autorise', {
    p_empreinte: empreinte,
    p_tenant: (objet as any).tenant_id ?? null,
    p_object: objectId,
    p_plafond: PLAFOND,
    p_fenetre_minutes: FENETRE_MIN
  })
  // Une panne du compteur ne doit pas ouvrir la porte en grand : on refuse.
  // Laisser passer « en cas de doute » est exactement la faute qui vide un crédit.
  if (eGarde) {
    console.error('[gemini-live] garde-fou indisponible :', eGarde.message)
    return json({ error: 'garde_indisponible' }, 503)
  }
  if (autorise === false) {
    return json({
      error: 'trop_de_demandes',
      message: 'Trop de conversations demandées. Réessayez dans quelques minutes.'
    }, 429)
  }

  // ---- La marque de l'organisation, pour que l'objet se situe --------------
  let marque = ''
  try {
    const { data: reglages } = await sbPublic
      .from('site_settings').select('marque, nom_entite')
      .eq('tenant_id', (objet as any).tenant_id).maybeSingle()
    marque = reglages?.marque || reglages?.nom_entite || ''
  } catch { /* la marque est un confort, pas une condition */ }

  // ---- Le jeton éphémère ---------------------------------------------------
  const modele = (Deno.env.get('GEMINI_LIVE_MODEL') || MODELE_DEFAUT).trim()
  const voix = (Deno.env.get('GEMINI_LIVE_VOIX') || 'Aoede').trim()
  const maintenant = Date.now()

  // `setup` est construit ICI et renvoyé au navigateur pour qu'il l'envoie
  // TEL QUEL. Les contraintes du jeton et le message d'ouverture doivent
  // concorder ; les composer à deux endroits, c'est se garantir une divergence
  // le jour où l'un des deux changera.
  const setup = {
    model: `models/${modele}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voix } } }
    },
    systemInstruction: { parts: [{ text: consigne(objet, marque) }] },
    // La transcription permet d'AFFICHER ce qui se dit : indispensable pour un
    // visiteur sourd, dans une salle bruyante, ou simplement pour relire.
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  }

  let reponse: Response
  try {
    reponse = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle },
      body: JSON.stringify({
        uses: 1,
        // Court : le jeton sert à ouvrir la session, pas à la faire durer.
        newSessionExpireTime: new Date(maintenant + 2 * 60 * 1000).toISOString(),
        expireTime: new Date(maintenant + 30 * 60 * 1000).toISOString(),
        // C'EST ICI QUE LA CONSIGNE EST ÉPINGLÉE. Un jeton volé dans la console
        // ne peut ouvrir qu'une conversation sur cette œuvre, avec ce modèle.
        liveConnectConstraints: { model: `models/${modele}`, config: setup }
      })
    })
  } catch (e) {
    console.error('[gemini-live] réseau', String(e))
    return json({ error: 'reseau', message: 'Google est injoignable pour le moment.' }, 502)
  }

  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 400)
    console.error('[gemini-live] refus Google', reponse.status, detail)
    // On distingue les deux pannes qui n'appellent pas la même action : une clé
    // sans crédit ou sans quota n'est pas une clé fausse, et le conservateur
    // doit pouvoir le lire sans nous.
    // 401 EST LE CAS LE PLUS FRÉQUENT au premier branchement, et il ne veut pas
    // dire la même chose qu'un 403 : la clé est refusée (absente du projet,
    // révoquée, ou prise dans un projet Google où l'API n'est pas activée).
    // Le dire évite de soupçonner le modèle ou le quota.
    const code = reponse.status === 401 ? 'cle_refusee'
      : reponse.status === 429 ? 'quota'
      : reponse.status === 403 ? 'refuse'
      : reponse.status === 400 ? 'modele_refuse'
      : 'erreur_google'
    const messages: Record<string, string> = {
      cle_refusee: "Google refuse la clé (401). Vérifiez que GEMINI_API_KEY est une clé valide, issue d'un projet où l'API Generative Language est activée.",
      modele_refuse: `Le modèle « ${modele} » a été refusé. Les modèles Live sont en preview et changent souvent : posez GEMINI_LIVE_MODEL avec un identifiant à jour.`,
      quota: 'Quota Gemini épuisé pour le moment.',
      refuse: "Google a refusé la demande (403) : l'API n'est peut-être pas activée sur ce projet.",
      erreur_google: 'Google a refusé la demande de jeton.'
    }
    return json({ error: code, statut: reponse.status, modele, detail, message: messages[code] }, 502)
  }

  const data = await reponse.json()
  // Le champ porte le nom d'une ressource (« authTokens/xxx ») ou le jeton lui-
  // même selon les versions : on accepte les deux plutôt que de casser au
  // prochain changement de forme.
  const jeton = data?.name || data?.token || ''
  if (!jeton) {
    console.error('[gemini-live] réponse sans jeton', JSON.stringify(data).slice(0, 300))
    return json({ error: 'jeton_absent' }, 502)
  }

  return json({
    ok: true,
    jeton,
    setup,
    modele,
    // L'URL vit côté serveur : le jour où Google change de version d'API, on la
    // corrige sans toucher au navigateur.
    url: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
    objet: { id: (objet as any).id, nom: (objet as any).nom }
  })
})
