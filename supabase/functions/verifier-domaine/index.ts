// ============================================================================
// VÉRIFICATION D'UN DOMAINE PERSONNALISÉ
// ----------------------------------------------------------------------------
// Le drapeau `domain_verified` décide de l'organisation servie à une adresse
// (`usePublicTenantStore.resolveByDomain`). Le cocher à la main, sans preuve,
// revient à laisser n'importe quelle organisation revendiquer le domaine d'une
// autre. On exige donc une PREUVE DE POSSESSION.
//
// CE QUE LE CLIENT DOIT POSER CHEZ SON HÉBERGEUR DNS :
//
//     _musea.<son-domaine>   TXT   musea-verification=<jeton>
//
// Seul le détenteur du domaine peut créer cet enregistrement. Le jeton est
// propre à l'organisation, secret, et régénéré dès que le domaine change.
//
// POURQUOI UNE FONCTION DE BORD ET PAS LE NAVIGATEUR
// Le navigateur ne sait pas interroger le DNS. On passe donc par DNS-over-HTTPS,
// côté serveur, chez deux résolveurs indépendants : si le premier ne répond pas,
// le second tranche. Un seul résolveur, c'est une panne qui ressemble à un refus.
//
// QUI PEUT APPELER : le super-admin, ou le personnel de l'organisation concernée
// (c'est lui qui pose l'enregistrement, il doit pouvoir vérifier son travail).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const PREFIXE_TXT = '_musea'
const CLE_TXT = 'musea-verification='

type Reponse = { Answer?: Array<{ name: string; type: number; data: string }>; Status?: number }

// Deux résolveurs publics, interrogés l'un après l'autre. Le format de réponse
// est le même (JSON DNS), seul l'en-tête d'acceptation change.
async function resoudre(nom: string, type: 'TXT' | 'CNAME' | 'A'): Promise<string[]> {
  const sources = [
    { url: `https://dns.google/resolve?name=${encodeURIComponent(nom)}&type=${type}`, headers: {} },
    {
      url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nom)}&type=${type}`,
      headers: { accept: 'application/dns-json' }
    }
  ]

  for (const source of sources) {
    try {
      const r = await fetch(source.url, { headers: source.headers })
      if (!r.ok) continue
      const data = (await r.json()) as Reponse
      if (!data.Answer) return []
      // Les valeurs TXT reviennent entre guillemets, parfois découpées en
      // plusieurs morceaux par le résolveur : on recolle et on nettoie.
      return data.Answer.map((a) => String(a.data || '').replace(/^"|"$/g, '').replace(/" "/g, ''))
    } catch {
      // résolveur injoignable : on tente le suivant
    }
  }
  throw new Error('resolveurs_injoignables')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { tenantId } = await req.json()
    if (!tenantId) return json({ ok: false, raison: 'tenant_manquant' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const autorisation = req.headers.get('Authorization') || ''

    // Droit d'appel : on interroge la base AVEC le jeton de l'appelant, donc
    // avec ses propres droits. `can_manage_tenant` répond pour le super-admin
    // comme pour le personnel de l'organisation.
    const commeAppelant = createClient(url, anon, {
      global: { headers: { Authorization: autorisation } }
    })
    const { data: autorise, error: eDroit } = await commeAppelant
      .rpc('can_manage_tenant', { p_tenant_id: tenantId })
    if (eDroit || !autorise) return json({ ok: false, raison: 'interdit' }, 403)

    // Le jeton ne doit pas transiter par le navigateur de l'appelant : on le lit
    // ici, avec la clé de service.
    const admin = createClient(url, service)
    const { data: ligne } = await admin
      .from('tenant_domain_verification')
      .select('domaine, jeton')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!ligne?.domaine) return json({ ok: false, raison: 'aucun_domaine' }, 400)

    const attendu = `${CLE_TXT}${ligne.jeton}`
    const nomTxt = `${PREFIXE_TXT}.${ligne.domaine}`

    let trouves: string[] = []
    let erreurDns = ''
    try {
      trouves = await resoudre(nomTxt, 'TXT')
    } catch (e) {
      erreurDns = (e as Error).message
    }

    const possede = trouves.some((v) => v.trim() === attendu)

    // Le ROUTAGE est une autre question que la POSSESSION : un domaine peut être
    // prouvé sans pointer encore vers la plateforme. On le rapporte pour que le
    // client sache ce qu'il lui reste à faire, mais il ne conditionne rien.
    let routage: string[] = []
    try {
      routage = await resoudre(ligne.domaine, 'CNAME')
      if (!routage.length) routage = await resoudre(ligne.domaine, 'A')
    } catch { /* le routage reste inconnu, ce n'est pas bloquant */ }

    const resultat = erreurDns ? `dns_indisponible:${erreurDns}`
      : possede ? 'verifie_par_txt'
      : trouves.length ? 'txt_present_mais_different'
      : 'txt_absent'

    await admin.from('tenant_domain_verification').update({
      dernier_essai: new Date().toISOString(),
      dernier_resultat: resultat,
      verifie_le: possede ? new Date().toISOString() : null
    }).eq('tenant_id', tenantId)

    // On ne RETIRE jamais une vérification acquise sur un échec passager de
    // résolution : une panne DNS de quelques minutes couperait le site du client.
    if (possede) {
      await admin.from('tenants').update({ domain_verified: true }).eq('id', tenantId)
    }

    return json({
      ok: possede,
      resultat,
      domaine: ligne.domaine,
      enregistrement: { nom: nomTxt, type: 'TXT', valeur: attendu },
      trouve: trouves,
      routage
    })
  } catch (e) {
    return json({ ok: false, raison: (e as Error).message }, 500)
  }
})
