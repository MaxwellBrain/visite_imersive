// LA MÉMOIRE DU VISITEUR — pour que la pièce ne se répète pas.
//
// LE DÉFAUT QU'ELLE CORRIGE, et il est plus profond qu'il n'en a l'air. On
// demande à l'objet d'ouvrir sur son détail le plus frappant ; il obéit, et il
// choisit donc TOUJOURS LE MÊME. Un message d'accueil composé par le modèle
// change la tournure des phrases, jamais le sujet. Le visiteur qui revient
// entend une variation sur le même thème, et l'illusion tombe : ce n'est plus
// quelqu'un, c'est un disque.
//
// LE REMÈDE N'EST PAS DE DEMANDER AU MODÈLE DE VARIER. On l'a essayé ailleurs
// dans ce projet : « surprends-le », « change d'angle » produisent une variété
// de surface pendant deux tours, puis le modèle retombe sur ce qui lui paraît
// le plus saillant. La variété doit être DÉCIDÉE, pas espérée — et pour être
// décidée, il faut se souvenir. C'est le rôle de `visiteur_angle` en base :
// elle tient la liste des angles déjà servis et rend le suivant.
//
// CE QU'ON RETIENT : le sujet dont la PIÈCE a parlé. Jamais ce que le visiteur
// a dit — pas une phrase, pas un mot. Une conversation devant une vitrine n'a
// pas à laisser de trace ; ce qu'on garde, c'est ce qu'on a déjà raconté, pour
// ne pas le raconter deux fois.

import type { Dossier } from './dossier.ts'

export type Angle = { cle: string; titre: string }

/**
 * LES ANGLES D'UNE PIÈCE — un par bloc du premier cercle.
 *
 * On les dérive des marqueurs que `dossierDe` écrit en tête de chaque bloc
 * plutôt que de tenir une liste en double. Le jour où un bloc s'ajoute — une
 * campagne de restauration, un dépôt — il devient un angle sans qu'on y touche.
 *
 * LA CLÉ EST STABLE, le titre non. La clé part en base et doit survivre à une
 * réécriture de notice ; le titre n'est que ce qu'on prononce, et il peut
 * changer avec la fiche.
 */
export function anglesDe(d: Dossier): Angle[] {
  const compte: Record<string, number> = {}
  const angles: Angle[] = []

  for (const bloc of d.blocs) {
    const ligne = (bloc.split('\n')[0] || '').trim()
    let base = ''
    if (ligne.startsWith('TU ES'))                 base = 'identite'
    else if (ligne.startsWith('OÙ TU TE TROUVES')) base = 'lieu'
    else if (ligne.startsWith('LIÉE À'))           base = 'chef'
    else if (ligne.startsWith('MIGRATION'))        base = 'migration'
    else if (ligne.startsWith('SŒUR DISPERSÉE'))   base = 'soeur'
    else if (ligne.startsWith('TA RARETÉ'))        base = 'rarete'
    else continue

    compte[base] = (compte[base] || 0) + 1
    // Les blocs uniques gardent une clé nue ; ceux qui peuvent se répéter
    // (plusieurs chefs, plusieurs sœurs) sont numérotés.
    const cle = ['chef', 'migration', 'soeur'].includes(base) ? `${base}:${compte[base]}` : base
    angles.push({ cle, titre: titreDe(base, ligne) })
  }
  return angles
}

/**
 * CE QU'ON PRONONCE POUR DÉSIGNER UN ANGLE.
 *
 * Court, et surtout PARLABLE : ce texte entre dans une consigne que l'agent lit
 * à voix haute. « LIÉE À — Sa Majesté le Fo'o Jean-Félicien Gacha (a appartenu
 * à), règne 1980, chefferie de Bandjoun. » ne se dit pas ; « Sa Majesté le Fo'o
 * Jean-Félicien Gacha » se dit.
 */
function titreDe(base: string, ligne: string): string {
  if (base === 'identite') return 'ce que tu es, ta matière et ta forme'
  if (base === 'lieu')     return 'la salle et le musée qui te conservent'
  if (base === 'rarete')   return 'ta rareté et les pièces qui te ressemblent'

  // Pour les blocs nommés, on prend ce qui suit le tiret, coupé au premier
  // séparateur : c'est le nom propre, et rien d'autre.
  const apres = ligne.split('—').slice(1).join('—').trim() || ligne
  const net = apres.split(/[(,.]/)[0].trim().slice(0, 70)
  if (base === 'chef')      return net || 'le chef auquel tu es liée'
  if (base === 'migration') return `la migration de ${net || 'ta lignée'}`
  if (base === 'soeur')     return `ta sœur dispersée ${net}`.trim()
  return net
}

export type Souvenir = { visites: number; choisi: string | null; deja: string[] }

/**
 * INTERROGER LA MÉMOIRE, sans jamais faire échouer l'appel.
 *
 * Une panne de la base ne doit pas empêcher une pièce de parler : dans le pire
 * des cas on retombe sur le comportement d'avant, qui n'était pas mauvais —
 * seulement répétitif. C'est l'inverse du garde-fou de `jeton-voix`, où le doute
 * imposait de refuser : ici, rien ne se paie à la minute et rien ne fuit.
 */
export async function souvenirDe(
  sbAdmin: any,
  visiteur: string | null,
  objectId: number,
  tenantId: number | null,
  angles: Angle[]
): Promise<Souvenir> {
  const vide: Souvenir = { visites: 0, choisi: null, deja: [] }
  if (!visiteur || !angles.length) return vide
  try {
    const { data, error } = await sbAdmin.rpc('visiteur_angle', {
      p_visiteur: visiteur,
      p_object: objectId,
      p_tenant: tenantId,
      p_angles: angles.map((a) => a.cle),
    })
    if (error) { console.error('[memoire]', error.message); return vide }
    const l = Array.isArray(data) ? data[0] : data
    return {
      visites: Number(l?.visites) || 0,
      choisi: l?.choisi ?? null,
      deja: Array.isArray(l?.deja) ? l.deja : [],
    }
  } catch (e) {
    console.error('[memoire] injoignable', String(e))
    return vide
  }
}

/**
 * LA CONSIGNE QU'ON AJOUTE AU DOSSIER.
 *
 * Elle est écrite POUR ÊTRE LUE PAR L'AGENT, pas pour être affichée. D'où le
 * ton impératif et les noms d'angles en clair : c'est la seule partie du prompt
 * qui change d'une visite à l'autre, et elle doit se comprendre sans contexte.
 *
 * LA DERNIÈRE PHRASE EST LA PLUS IMPORTANTE. Sans elle, un agent à qui l'on dit
 * « ne rouvre pas là-dessus » refuse ensuite de reparler du sujet quand le
 * visiteur le lui demande — et un objet qui vous oppose une fin de non-recevoir
 * sur ce qu'il vous a raconté la veille est pire que celui qui se répète.
 */
export function consigneMemoire(s: Souvenir, angles: Angle[]): string {
  if (!s.choisi) return ''
  const nom = (cle: string) => angles.find((a) => a.cle === cle)?.titre || cle
  const ouvrir = nom(s.choisi)

  if (s.visites <= 1) {
    return `\nOUVERTURE — première rencontre. Ouvre sur : ${ouvrir}. ` +
      `Un détail précis pris là, pas une généralité.`
  }

  const vus = s.deja.map(nom).filter(Boolean)
  return `\nMÉMOIRE — TU L'AS DÉJÀ RENCONTRÉ.

C'est sa ${s.visites}ᵉ venue devant toi.${vus.length ? ` Tu lui as déjà parlé de : ${vus.join(' ; puis ')}.` : ''}

NE ROUVRE PAS SUR CE QU'IL A DÉJÀ ENTENDU. Ouvre sur : ${ouvrir}.

Salue-le comme quelqu'un qui revient : une phrase, sans cérémonie, sans « bonjour et bienvenue ». Tu peux dire que tu le reconnais — c'est vrai.

MAIS S'IL TE REDEMANDE ce que tu lui as déjà raconté, redis-le volontiers et sans faire remarquer qu'il l'a déjà entendu. Cette consigne règle ce que TU choisis de raconter, jamais ce que tu acceptes de lui répondre.`
}
