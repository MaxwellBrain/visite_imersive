// Edge Function « outils-vapi » — ce que l'assistant Vapi vient chercher chez nous.
//
// C'EST ICI QUE LE PROMPT VIT DÉSORMAIS, et c'est le vrai gain de cette
// migration. Chez xAI, notre serveur rédigeait les consignes mais c'est le
// NAVIGATEUR qui les transmettait dans `session.update` — un visiteur curieux
// pouvait donc les remplacer avant l'envoi. Ici, l'assistant appelle ce point
// d'entrée et reçoit son dossier directement. Le texte ne passe plus par le
// poste du visiteur.
//
// DEUX OUTILS, UNE SEULE FONCTION. Vapi identifie l'outil par son nom dans la
// charge utile ; deux fonctions déployées demanderaient deux URL à tenir à jour
// dans la console Vapi, pour un aiguillage de trois lignes. On garde une porte.
//
//   `dossier`    rend le prompt complet de la pièce — les trois cercles.
//   `recherche`  la recherche ancrée, celle-là même que la voie texte utilise.
//
// CE POINT D'ENTRÉE EST PUBLIC PAR NATURE : Vapi l'appelle depuis ses serveurs,
// sans clé Supabase. Deux remarques là-dessus :
//
//   1. IL NE RÉVÈLE RIEN QUI NE SOIT DÉJÀ PUBLIC. `dossierDe` n'accepte que des
//      objets `published = true`, avec la clé anonyme. Quelqu'un qui appellerait
//      cette URL à la main obtiendrait la notice d'une pièce exposée — celle
//      qu'il lit déjà sur le site.
//   2. UN SECRET PARTAGÉ EST ACCEPTÉ SI ON LE CONFIGURE (`VAPI_WEBHOOK_SECRET`
//      côté Supabase, `server.secret` côté Vapi). Il n'est pas exigé, parce
//      qu'un secret mal recopié couperait l'agent sans rien protéger de plus que
//      le point 1 ; mais dès qu'il est posé, il est vérifié.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { dossierDe, systeme, type Dossier } from '../_shared/dossier.ts'
import { chercher } from '../_shared/recherche.ts'
import { appelsDe, reponseOutils } from '../_shared/vapi.ts'
import { anglesDe, souvenirDe, consigneMemoire } from '../_shared/memoire.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-vapi-secret, x-vapi-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

/**
 * LE DOSSIER EST GARDÉ QUELQUES MINUTES, et ce n'est pas une optimisation
 * gratuite : c'est ce qui rend le second outil utilisable.
 *
 * `dossierDe` coûte une demi-douzaine de requêtes. L'outil `recherche` a besoin
 * du même ancrage que l'outil `dossier` — sans mémoire, chaque recherche
 * paierait donc une seconde fois la construction complète, AU MILIEU D'UNE
 * PHRASE PARLÉE. Une instance chaude sert toute la conversation : la retenir
 * trois minutes suffit à couvrir une visite.
 *
 * Trois minutes et pas davantage : un conservateur qui corrige une notice doit
 * s'entendre corrigé sans attendre le refroidissement de l'instance.
 */
const MEMOIRE_MS = 3 * 60 * 1000
const memoire = new Map<string, { quand: number; d: Dossier }>()

async function dossierRetenu(sb: any, objectId: number, tenantId: number | null): Promise<Dossier | null> {
  const cle = `${objectId}:${tenantId ?? ''}`
  const garde = memoire.get(cle)
  if (garde && Date.now() - garde.quand < MEMOIRE_MS) return garde.d
  const d = await dossierDe(sb, objectId, tenantId)
  if (d) {
    memoire.set(cle, { quand: Date.now(), d })
    // La carte ne doit pas grandir indéfiniment sur une instance qui vit
    // longtemps : au-delà de trente pièces, on jette les plus anciennes.
    if (memoire.size > 30) {
      const vieux = [...memoire.entries()].sort((a, b) => a[1].quand - b[1].quand)[0]
      if (vieux) memoire.delete(vieux[0])
    }
  }
  return d
}

const nombre = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  // Le secret partagé, s'il est configuré des DEUX côtés.
  const attendu = Deno.env.get('VAPI_WEBHOOK_SECRET')
  if (attendu) {
    const recu = req.headers.get('x-vapi-secret') || req.headers.get('x-vapi-signature') || ''
    if (recu !== attendu) {
      console.warn('[outils-vapi] secret partagé refusé')
      return json({ error: 'non autorisé' }, 401)
    }
  }

  let corps: any
  try { corps = await req.json() } catch { return json({ error: 'corps illisible' }, 400) }

  const appels = appelsDe(corps)
  if (!appels.length) {
    // Vapi envoie aussi des évènements de cycle de vie sur la même URL
    // (`status-update`, `end-of-call-report`…). Ils ne nous concernent pas, et
    // répondre par une erreur ferait apparaître des rouges dans le journal de
    // Vapi pour un fonctionnement parfaitement normal.
    return json({ results: [] })
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)

  // DEUX CLIENTS, ET LA DISTINCTION COMPTE. Le dossier se lit avec la clé
  // ANONYME : on ne sert que ce qu'un visiteur a le droit de voir. La mémoire,
  // elle, vit dans une table fermée à cette clé — RLS actif, aucune politique —
  // et n'est atteignable que par la clé de service. Les mélanger reviendrait à
  // ouvrir la notice non publiée en même temps que le souvenir.
  let sbAdmin: any = null
  const admin = () => (sbAdmin ??= createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!))

  const resultats: { id: string; resultat: unknown }[] = []

  for (const appel of appels) {
    const objectId = nombre(appel.args?.objectId)
    const tenantId = nombre(appel.args?.tenantId)
    const langue = appel.args?.lang === 'en' ? 'en' : 'fr'

    if (!objectId) {
      resultats.push({ id: appel.id, resultat:
        "Aucune pièce n'est désignée. Dis au visiteur que tu ne sais pas encore qui tu es, et demande-lui de rouvrir la fiche." })
      continue
    }

    const d = await dossierRetenu(sb, objectId, tenantId)
    if (!d) {
      resultats.push({ id: appel.id, resultat:
        "Cette pièce n'existe pas ou n'est pas publiée. Ne l'invente pas : dis-le au visiteur." })
      continue
    }

    if (appel.nom === 'dossier') {
      // LE PROMPT ENTIER, tel que `_shared/dossier.ts` le rédige — mot pour mot
      // celui de la voie texte. C'est ce qui garantit que les deux voies
      // racontent la même chose, et c'était déjà la raison d'être du module
      // partagé avant que Vapi n'entre en scène.
      //
      // PUIS LA MÉMOIRE, ajoutée À LA FIN et non fondue dedans. Le prompt est
      // le même pour tout le monde ; la consigne d'ouverture, elle, change à
      // chaque visite. Les garder séparés rend visible, en lisant le texte
      // envoyé, ce qui relève de la pièce et ce qui relève de la rencontre.
      const angles = anglesDe(d)
      const visiteur = String(appel.args?.visiteur || '').trim().slice(0, 100) || null
      const souvenir = await souvenirDe(admin(), visiteur, objectId, tenantId, angles)
      resultats.push({
        id: appel.id,
        resultat: systeme(d, langue, { voix: true, recherche: true }) + consigneMemoire(souvenir, angles),
      })
      continue
    }

    if (appel.nom === 'recherche' || appel.nom === 'chercher') {
      const r = await chercher(String(appel.args?.sujet || ''), d.ancrage, langue)
      resultats.push({ id: appel.id, resultat: r })
      continue
    }

    resultats.push({ id: appel.id, resultat: `Outil inconnu : ${appel.nom}.` })
  }

  return json(reponseOutils(resultats))
})
