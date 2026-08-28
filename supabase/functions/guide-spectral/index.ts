// Edge Function « guide-spectral » — rédaction des micro-récits du Guide Spectral.
//
// APPELÉE DEPUIS L'ERP, JAMAIS DEPUIS LE SITE VISITEUR. Ce n'est pas un détail
// d'implémentation : la génération est une opération de CONSERVATION, pas de
// visite. Le visiteur ne lit que des textes déjà relus et publiés — servis
// directement par la base, sans passer par ici.
//
// TROIS GARANTIES, DANS CET ORDRE D'IMPORTANCE
//
//  1. CLOISONNEMENT. Le client Supabase est construit avec le JETON DE
//     L'APPELANT, jamais avec la clé de service. La RLS s'applique donc
//     intégralement : un conservateur de la chefferie A ne peut pas faire
//     rédiger un récit à partir des notices de la chefferie B, même en
//     forgeant l'identifiant du point chaud. Utiliser la clé de service ici
//     serait plus simple et ouvrirait un trou par lequel passe tout le reste.
//
//  2. ANCRAGE STRICT. Le corpus transmis au modèle est EXACTEMENT le contenu
//     du champ `notices` du point chaud, résolu vers des notices publiées.
//     Rien d'autre. Pas de recherche vectorielle élargie, pas de « culture
//     générale ». Quand le corpus ne suffit pas, le modèle doit le DIRE — et
//     le conservateur reçoit la liste de ce qui manque, ce qui vaut mieux
//     qu'un paragraphe plausible.
//
//  3. AUCUNE PUBLICATION. Les récits sont insérés en `en_relecture`. Le
//     déclencheur `ar_recits_exiger_validation` empêche de toute façon de les
//     publier sans relecteur identifié : cette fonction ne PEUT pas court-
//     circuiter la validation humaine, même modifiée par erreur.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { appelerBedrock, bedrockConfigure, MODELES } from '../_shared/bedrock.ts'
import { resoudreNotices } from '../_shared/spectralCorpus.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Débit de parole retenu : 2,6 mots par seconde. C'est celui d'un récit posé en
// français, pas celui d'une lecture de journal télévisé. 15 à 35 secondes
// donnent donc 40 à 90 mots — la fourchette imposée au modèle plus bas.
const MOTS_PAR_SECONDE = 2.6
const MOTS_MIN = 40
const MOTS_MAX = 90

// Ce que chaque point chaud est censé faire éprouver. Ce n'est pas du contenu :
// c'est une CONSIGNE DE CADRAGE, qui empêche les sept récits de se ressembler.
// Sans elle, le modèle raconte sept fois « la vie quotidienne dans la case ».
const ANGLES: Record<string, string> = {
  seuil: "le passage du dehors au dedans : qui entre, qui n'entre pas, ce que le seuil sépare.",
  foyer: "le centre : la chaleur, la fumée qui conserve la charpente, ce qui se décide autour du feu.",
  couchage: "l'intime : le repos, la place de chacun, ce que la nuit change à l'espace.",
  grenier: "la prévoyance : conserver, compter, tenir jusqu'à la récolte suivante.",
  poteaux: "la main de l'artisan : le geste, l'outil, ce que le décor dit du statut.",
  toit: "la technique et le ciel : comment la forme tient debout, ce qu'elle affronte.",
  sortie: "le retour au monde : ce que le visiteur emporte, et ce qui reste dans la case.",
}

// ---------------------------------------------------------------------------
// PROMPT SYSTÈME
// ---------------------------------------------------------------------------
// Il est long, et c'est délibéré. Les trois quarts de ses lignes ne décrivent
// pas ce qu'il faut écrire mais ce qu'il ne faut PAS écrire — parce que les
// défauts d'un texte de musée généré sont toujours les mêmes : la date inventée,
// l'adjectif exotisant, la formule « on raconte que » qui donne l'autorité d'une
// source à une absence de source.
function promptSysteme(langue: string) {
  return `Tu rédiges les paroles d'un guide de musée pour une visite en réalité augmentée, au Cameroun. Le visiteur se tient à l'intérieur d'une case traditionnelle reconstituée à taille réelle. Il vient de poser les yeux sur un élément précis ; tu écris ce que le guide lui dit à ce moment-là.

SOURCES — LA RÈGLE ABSOLUE
Tu ne disposes que des notices fournies dans le message. Elles ont été rédigées et validées par les conservateurs de cette institution. Tu n'as RIEN d'autre à ta disposition, et tu n'as pas le droit d'y ajouter quoi que ce soit :
- aucune date, aucun siècle, aucun chiffre, aucune mesure qui ne figure pas dans les notices ;
- aucun nom de personne, de dynastie, de village ou d'ethnie qui n'y figure pas ;
- aucune fonction rituelle, aucune croyance, aucun usage que les notices ne mentionnent pas ;
- aucune comparaison avec d'autres cultures, d'autres musées, d'autres objets.
Un fait absent des notices n'est pas un fait à retrouver : c'est un fait dont tu ne parles pas. Si les notices sont trop maigres pour tenir la durée demandée, ne comble pas — signale-le (voir SORTIE).

CE QUE TU ÉCRIS
- Un récit unique, continu, de ${MOTS_MIN} à ${MOTS_MAX} mots. C'est 15 à 35 secondes à voix haute : la limite haute n'est pas indicative, un visiteur debout décroche au-delà.
- Une seule idée par récit. Pas de résumé général de la case.
- Tu commences par le CONCRET : ce que le visiteur a sous les yeux, ce qu'il pourrait toucher, sentir, entendre. Jamais par une généralité historique.
- Tu t'adresses à lui au tutoiement, à voix humaine, sans jamais le nommer « visiteur ».
- Tu termines sur une note ouverte, sans poser de question qui attende une réponse : le guide n'est pas un questionnaire.

REGISTRE
- Français ${langue === 'en' ? '(traduis ensuite en anglais naturel, pas mot à mot)' : 'parlé, clair, digne'}.
- Tu parles d'une architecture et de savoir-faire vivants, pas d'un vestige. Proscris « primitif », « ancestral », « tribal », « authentique », « mystérieux », « âme africaine », et tout adjectif qui transforme une technique en curiosité.
- Pas de « on raconte que », « il semblerait », « la légende dit » : ces formules donnent le poids d'une source à une absence de source.
- Pas de superlatif publicitaire, pas d'exclamation, pas d'humour.
- Aucune mise en forme : ni titre, ni liste, ni gras, ni guillemets décoratifs, ni emoji. Ce texte sera prononcé, pas lu.
- Pas de salutation ni de formule d'adieu : le guide a déjà salué, il est au milieu de la visite.

SORTIE
Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme :
{"recits":[{"texte":"…","sources":[0,2]},{"texte":"…","sources":[1]}],"insuffisant":false,"manque":""}
- "sources" liste les INDICES des notices réellement utilisées dans ce récit. Un récit sans source est une invention : il ne doit pas exister.
- Si les notices ne permettent pas d'écrire ne serait-ce qu'un récit honnête de ${MOTS_MIN} mots, réponds {"recits":[],"insuffisant":true,"manque":"…"} où "manque" décrit en une phrase ce que le conservateur devrait documenter. C'est une réponse ATTENDUE, pas un échec : mieux vaut un point chaud muet qu'un point chaud qui ment.`
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'méthode non autorisée' }, 405)

  const autorisation = req.headers.get('Authorization') || ''
  if (!autorisation) return json({ error: 'authentification requise' }, 401)

  let corps: { hotspotId?: number; lang?: string; variantes?: number }
  try { corps = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const hotspotId = Number(corps.hotspotId)
  if (!Number.isFinite(hotspotId)) return json({ error: 'hotspotId manquant' }, 400)
  const langue = corps.lang === 'en' ? 'en' : 'fr'
  const variantes = Math.min(3, Math.max(1, Number(corps.variantes) || 2))

  // Client PORTANT LE JETON DE L'APPELANT : c'est lui qui fait respecter la RLS,
  // donc le cloisonnement entre organisations. Voir l'en-tête du fichier.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: autorisation } } }
  )

  // ---- Le point chaud, et rien que celui que l'appelant a le droit de voir --
  const { data: h, error: eh } = await supabase
    .from('ar_hotspots')
    .select('id, tenant_id, scene_id, code, libelle, notices, object_id')
    .eq('id', hotspotId)
    .maybeSingle()
  if (eh) return json({ error: eh.message }, 400)
  if (!h) return json({ error: 'point chaud introuvable ou hors de votre organisation' }, 404)

  // ---- Résolution des sources ---------------------------------------------
  const corpus = await resoudreNotices(supabase, h)
  if (!corpus.length) {
    return json({
      insuffisant: true,
      manque: "Aucune notice n'est rattachée à ce point chaud. Rattachez-y au moins un objet publié ou une note de terrain avant de demander un récit.",
      recits: []
    })
  }

  if (!bedrockConfigure()) {
    return json({ error: 'Bedrock n\'est pas configuré (secret BEDROCK_TOKEN absent).' }, 503)
  }

  // ---- Rédaction -----------------------------------------------------------
  const modele = MODELES.equilibre
  const message = [
    `POINT CHAUD : ${h.libelle} (code « ${h.code} »).`,
    ANGLES[h.code] ? `ANGLE ATTENDU : ${ANGLES[h.code]}` : '',
    '',
    'NOTICES VALIDÉES — numérotées, ce sont tes seules sources :',
    ...corpus.map((n, i) => `[${i}] (${n.origine}) ${n.texte}`),
    '',
    `Écris ${variantes} récit(s) DIFFÉRENT(S) sur ce point : un visiteur qui revient ne doit pas réentendre la même phrase. Chacun choisit un aspect distinct des notices.`
  ].filter(Boolean).join('\n')

  let brut: string | null
  try {
    brut = await appelerBedrock({
      modele,
      systeme: promptSysteme(langue),
      messages: [{ role: 'user', content: [{ text: message }] }],
      // Assez pour trois récits de 90 mots et leur enveloppe JSON.
      maxTokens: 1200,
      // Basse : on veut un texte fidèle aux notices, pas une variation créative.
      // La variété entre récits vient de la consigne, pas du hasard du décodage.
      temperature: 0.35
    })
  } catch (e) {
    return json({ error: `Bedrock : ${(e as Error).message}` }, 502)
  }

  const sortie = extraireJson(brut || '')
  if (!sortie) return json({ error: 'réponse du modèle illisible', brut: (brut || '').slice(0, 400) }, 502)
  if (sortie.insuffisant || !Array.isArray(sortie.recits) || !sortie.recits.length) {
    return json({ insuffisant: true, manque: sortie.manque || 'Notices trop maigres.', recits: [] })
  }

  // ---- Contrôle avant écriture --------------------------------------------
  // Le modèle respecte la consigne de longueur la plupart du temps ; « la
  // plupart du temps » ne suffit pas quand la base impose 15 à 35 secondes.
  // On écarte ici, plutôt que de laisser l'insertion échouer sur un CHECK.
  const retenus = []
  const ecartes = []
  for (const r of sortie.recits) {
    const texte = String(r?.texte || '').trim()
    const mots = texte.split(/\s+/).filter(Boolean).length
    const dureeS = Math.round(mots / MOTS_PAR_SECONDE)
    const sources = Array.isArray(r?.sources) ? r.sources.filter((i: unknown) => Number.isInteger(i)) : []
    if (!texte) continue
    if (mots < MOTS_MIN || mots > MOTS_MAX) { ecartes.push({ texte, mots, raison: 'longueur' }); continue }
    // Un récit sans source déclarée est, par construction, une invention.
    if (!sources.length) { ecartes.push({ texte, mots, raison: 'aucune source' }); continue }
    retenus.push({
      texte,
      duree_s: Math.min(35, Math.max(15, dureeS)),
      sources: sources.map((i: number) => corpus[i]).filter(Boolean).map((n) => n.ref)
    })
  }

  if (!retenus.length) {
    return json({ error: 'aucun récit conforme produit', ecartes }, 422)
  }

  // ---- Insertion EN RELECTURE ---------------------------------------------
  // On repart de la variante suivante pour ne pas écraser un récit déjà relu.
  const { data: existants } = await supabase
    .from('ar_recits').select('variante')
    .eq('hotspot_id', hotspotId).eq('lang', langue)
    .order('variante', { ascending: false }).limit(1)
  let variante = (existants?.[0]?.variante || 0) + 1

  const lignes = retenus.slice(0, 5 - (variante - 1)).map((r) => ({
    hotspot_id: hotspotId,
    lang: langue,
    variante: variante++,
    texte: r.texte,
    duree_s: r.duree_s,
    statut: 'en_relecture',
    genere_par: `bedrock:${modele}`,
    sources: r.sources
  }))

  if (!lignes.length) {
    return json({ error: 'cinq variantes existent déjà pour ce point ; supprimez-en une avant d\'en générer.' }, 409)
  }

  const { data: inseres, error: ei } = await supabase.from('ar_recits').insert(lignes).select()
  if (ei) return json({ error: ei.message }, 400)

  return json({
    recits: inseres,
    ecartes,
    // Rappelé explicitement dans la réponse : l'interface doit le redire au
    // conservateur, qui vient de voir un texte apparaître tout seul.
    avertissement: 'Ces récits sont en RELECTURE. Aucun visiteur ne les entendra tant qu\'ils n\'auront pas été validés puis publiés.'
  })
})

// La résolution des notices vit dans `_shared/spectralCorpus.ts` : c'est la
// pièce sur laquelle repose tout l'ancrage, et elle est commune à la rédaction
// à l'avance et à l'improvisation en direct. Deux copies finiraient par
// diverger, et le jour où l'une devient plus permissive que l'autre, c'est le
// guide qui se met à inventer sans que rien ne le signale.

// Le modèle encadre parfois son JSON d'une phrase ou d'un bloc de code, malgré
// la consigne. On extrait plutôt que de rejeter : refaire un appel coûte une
// seconde et de l'argent, découper une chaîne n'en coûte aucun.
function extraireJson(s: string): any | null {
  const nettoye = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(nettoye) } catch { /* on tente l'extraction */ }
  const debut = nettoye.indexOf('{')
  const fin = nettoye.lastIndexOf('}')
  if (debut < 0 || fin <= debut) return null
  try { return JSON.parse(nettoye.slice(debut, fin + 1)) } catch { return null }
}
