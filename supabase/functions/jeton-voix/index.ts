// Edge Function « jeton-voix » — le laissez-passer vers l'agent vocal.
//
// ELLE A CHANGÉ DE FOURNISSEUR, PAS DE MÉTIER. Elle délivrait un secret éphémère
// xAI ; elle signe désormais un JWT Vapi. Les trois garde-fous, eux, n'ont pas
// bougé d'une ligne — ils ne dépendaient pas du fournisseur mais de la
// situation : un point d'entrée public, devant un service facturé à la minute.
//
// ⚠️ CE POINT D'ENTRÉE EST NÉCESSAIREMENT PUBLIC — le visiteur d'un musée n'a
// pas de compte. Et chaque jeton ouvre une conversation FACTURÉE À LA MINUTE.
// Une boucle suffirait à vider le crédit d'une chefferie en une nuit, sans que
// personne s'en aperçoive avant la facture. D'où :
//
//   1. UN OBJET PUBLIÉ EST EXIGÉ. On ne délivre pas de jeton « en général » :
//      on en délivre un pour une pièce précise, qui existe et qui est publiée.
//   2. UN PLAFOND PAR EMPREINTE, dans une fenêtre glissante. On stocke le
//      HACHAGE de l'IP, jamais l'IP : on compte un usage, on ne suit personne.
//   3. UNE VALIDITÉ COURTE, et un jeton qui n'autorise QU'UN assistant.
//
// CE QUI A DISPARU : la construction du dossier. Elle coûtait une demi-douzaine
// de requêtes à chaque demande de jeton, avant même que le visiteur ait parlé.
// L'assistant Vapi va maintenant le chercher lui-même auprès de `outils-vapi`,
// au moment où il en a besoin. Ce point d'entrée est donc devenu court, et c'est
// tant mieux : c'est le premier aller-retour d'une conversation, celui que le
// visiteur attend debout devant la vitrine.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { clePrivee, assistantId, orgIdDe, jetonVapi, VALIDITE_S, NOMS_ATTENDUS } from '../_shared/vapi.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const PLAFOND = 20            // jetons par empreinte…
const FENETRE_MIN = 10        // …sur dix minutes

// L'empreinte n'est PAS réversible, et le sel l'empêche d'être devinée par
// force brute sur l'espace des adresses IPv4 — qui est petit.
async function empreinteDe(ip: string): Promise<string> {
  const sel = Deno.env.get('SEL_EMPREINTE') || 'musea-voix'
  const buf = new TextEncoder().encode(`${sel}:${ip}`)
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  // ---- Les secrets, et un diagnostic qui se lit sans nous -----------------
  //
  // Un secret posé à la main se nomme rarement du premier coup comme la
  // documentation l'imaginait. Plutôt qu'un « 503 » muet, on dit CE QU'ON A
  // CHERCHÉ : c'est la différence entre un réglage de trente secondes et une
  // demi-journée passée à soupçonner le code.
  const cle = clePrivee()
  const assistant = assistantId()
  if (!cle || !assistant) {
    console.error('[jeton-voix] secrets manquants', { cle: !!cle, assistant: !!assistant })
    return json({
      error: 'no_key',
      manquant: [!cle && 'cle_privee', !assistant && 'assistant_id'].filter(Boolean),
      attendu: NOMS_ATTENDUS,
      message: 'Secrets Vapi absents ou nommés autrement.'
    }, 503)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const objectId = Number(body?.objectId)
  const tenantId = Number(body?.tenantId) || null
  if (!Number.isFinite(objectId)) return json({ error: 'objectId manquant' }, 400)

  // ---- Garde-fou 1 : la pièce existe-t-elle, et est-elle publiée ? ---------
  // Clé ANONYME à dessein : on vérifie ce que le VISITEUR a le droit de voir,
  // pas ce que la base contient.
  const sbPublic = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  let q = sbPublic.from('objects').select('id, nom, tenant_id').eq('id', objectId).eq('published', true)
  if (tenantId) q = q.eq('tenant_id', tenantId)
  const { data: objet } = await q.maybeSingle()
  if (!objet) return json({ error: 'objet introuvable ou non publié' }, 404)

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
  // Le contraire — laisser passer « en cas de doute » — est exactement la faute
  // qui vide un crédit.
  if (eGarde) {
    console.error('[jeton-voix] garde-fou indisponible :', eGarde.message)
    return json({ error: 'garde_indisponible' }, 503)
  }
  if (autorise === false) {
    return json({ error: 'trop_de_demandes', message: 'Trop de sessions vocales demandées. Réessayez dans quelques minutes.' }, 429)
  }

  // ---- Le jeton ------------------------------------------------------------
  const org = await orgIdDe(cle)
  if (!org) {
    // Deux causes possibles, et le journal les distingue déjà : soit la clé est
    // refusée par Vapi, soit aucun assistant n'existe encore et la découverte
    // n'a rien sur quoi s'appuyer. Dans les deux cas, poser `VAPI_ORG_ID` à la
    // main débloque immédiatement.
    return json({
      error: 'org_introuvable',
      message: "Impossible de déduire l'organisation depuis la clé privée. Posez VAPI_ORG_ID."
    }, 502)
  }

  let jeton: string
  try {
    jeton = await jetonVapi(cle, org, assistant)
  } catch (e) {
    console.error('[jeton-voix] signature du JWT', String(e))
    return json({ error: 'signature' }, 500)
  }

  return json({
    jeton,
    assistantId: assistant,
    expire_dans_s: VALIDITE_S,
    // Ce que le navigateur transmettra en variables d'assistant. L'identifiant
    // n'est pas un secret — il est déjà dans l'URL de la page — et il ne donne
    // accès qu'à une pièce PUBLIÉE, puisque `outils-vapi` n'en sert pas d'autre.
    objet: { id: (objet as any).id, nom: (objet as any).nom, tenantId: (objet as any).tenant_id ?? null }
  })
})
