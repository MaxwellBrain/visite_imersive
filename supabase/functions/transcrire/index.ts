// Edge Function « transcrire » — ENTENDRE LE VISITEUR, PARTOUT.
//
// POURQUOI ELLE EXISTE. Le guide vocal écoutait par `SpeechRecognition`, l'API
// du navigateur. Elle est gratuite et immédiate là où elle existe — et elle
// n'existe pratiquement pas ailleurs :
//
//   Chrome / Edge / Android   ✓
//   Safari iOS                ✗  ← le guide vocal est MUET sur iPhone
//   Firefox                   ✗
//   WebView (app intégrée)    ✗
//
// Ce n'est pas « moins bon sur iPhone » : c'est mort. Or un musée qui pose des
// QR codes ne choisit pas le téléphone de ses visiteurs.
//
// CE QU'ELLE FAIT. Elle prend un court enregistrement, le passe à Whisper chez
// Groq — la clé qui fait déjà parler le guide — et rend le texte. Rien de plus.
//
// POURQUOI PAS UN WEBSOCKET. La transcription en continu par flux donnerait
// ~1 s de mieux. Elle exige un serveur permanent, hors des Edge Functions qui
// sont faites pour des requêtes courtes. Ici on envoie UNE prise de parole,
// découpée côté navigateur par le détecteur d'énergie qui existe déjà : on
// couvre l'iPhone aujourd'hui, sans nouvelle infrastructure à héberger.
//
// GARDE-FOUS. Ce point d'entrée est public et coûte de l'argent à chaque appel.
// Il refuse donc ce qui n'est manifestement pas une prise de parole de visiteur :
// au-delà de la taille ou de la durée d'une phrase, ce n'est plus un guide vocal,
// c'est quelqu'un qui fait transcrire ses archives à vos frais.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Une phrase de visiteur pèse quelques dizaines de kilo-octets en Opus. 2 Mo
// laissent une marge confortable (une trentaine de secondes) tout en fermant la
// porte à l'envoi d'un fichier entier.
const TAILLE_MAX = 2 * 1024 * 1024

// Formats que MediaRecorder produit selon la plateforme, et que Whisper accepte.
// Safari sort du mp4/aac là où Chrome sort du webm/opus : les deux doivent
// passer, sinon on n'a fait que déplacer le problème d'iPhone.
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  const key = Deno.env.get('GROQ_API_KEY') || Deno.env.get('GROK_API_KEY')
  if (!key) {
    // Dégradation propre, comme partout ailleurs : le client repart sur l'API
    // du navigateur quand elle existe, et se tait proprement sinon.
    return json({ error: 'no_key', message: 'Aucune clé Groq configurée.' }, 503)
  }

  const typeBrut = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const ext = EXTENSIONS[typeBrut]
  if (!ext) return json({ error: 'format', message: `Type audio non accepté : ${typeBrut || 'absent'}` }, 415)

  const audio = await req.blob()
  if (!audio.size) return json({ error: 'vide' }, 400)
  if (audio.size > TAILLE_MAX) {
    return json({ error: 'trop_long', message: 'Enregistrement trop long pour une prise de parole.' }, 413)
  }

  const langue = new URL(req.url).searchParams.get('lang') === 'en' ? 'en' : 'fr'
  // `turbo` : nettement plus rapide, et la différence de qualité ne s'entend pas
  // sur une phrase de visiteur. Réglable par secret, comme les modèles de texte —
  // les identifiants se périment, ce projet l'a déjà vécu deux fois.
  const modele = Deno.env.get('GROQ_STT_MODEL') || 'whisper-large-v3-turbo'

  const fd = new FormData()
  fd.append('file', audio, `parole.${ext}`)
  fd.append('model', modele)
  fd.append('language', langue)          // borner la langue améliore nettement le français
  fd.append('response_format', 'json')
  fd.append('temperature', '0')

  let res: Response
  try {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    })
  } catch (e) {
    console.error('[transcrire] réseau', String(e))
    return json({ error: 'reseau' }, 502)
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    console.error(`[transcrire] groq ${res.status}`, detail)
    // On distingue le QUOTA du reste : c'est le cas fréquent, et le client peut
    // décider de ne pas réessayer pendant un moment plutôt que d'insister.
    return json({ error: res.status === 429 ? 'quota' : 'amont', status: res.status, detail }, 502)
  }

  const data = await res.json()
  const texte = String(data?.text || '').trim()
  return json({ texte, modele, langue })
})
