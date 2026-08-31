// LE DOSSIER D'UNE PIÈCE — ce que la base sait d'elle, et le monde dont elle vient.
//
// Partagé entre les voies qui font parler un objet :
//   `objet-vivant`  la conversation par texte diffusé (repli)
//   `outils-vapi`   l'outil `dossier` que l'assistant VOCAL Vapi vient appeler
//
// IL EST ICI ET PAS DUPLIQUÉ, pour la même raison que `spectralCorpus.ts` :
// c'est la pièce sur laquelle repose tout l'ancrage. Deux copies finiraient par
// diverger, et le jour où l'une devient plus permissive que l'autre, c'est
// l'agent vocal — celui qu'on n'a pas le temps de relire — qui se met à
// inventer.
//
// ═══════════════════════════════════════════════════════════════════════════
// LES TROIS CERCLES — c'est LA décision de conception de ce fichier.
// ═══════════════════════════════════════════════════════════════════════════
//
// La première version verrouillait l'objet sur sa seule notice : tout ce qui
// n'était pas dans la base devait produire un refus. C'était trop serré, et le
// défaut s'entendait tout de suite. « Comment t'a-t-on fondu ? » — silence,
// alors que la fonte à la cire perdue des Grassfields n'est pas un secret et
// qu'un conservateur y répondrait sans hésiter. Un objet qui ne sait rien de sa
// propre civilisation ne paraît pas rigoureux : il paraît vide.
//
// L'ERREUR INVERSE SERAIT PIRE : un assistant général à qui l'on aurait collé un
// nom d'objet. Il répondrait sur la météo, sur le code, sur la Renaissance
// italienne — et il inventerait sur la pièce, parce que rien ne l'obligerait à
// distinguer ce qu'il sait d'elle de ce qu'il croit savoir.
//
// D'où trois cercles, et surtout un ORDRE entre eux :
//
//   CERCLE 1 — TOI. Le dossier chargé ici : notice, salle, musée, chefs liés,
//     migrations de la lignée, sœurs dispersées, rareté. Fait établi, vérifié
//     par un conservateur. Seul cercle où la pièce a le droit d'AFFIRMER
//     quelque chose d'elle-même.
//
//   CERCLE 2 — TON MONDE. Les chefferies dont elle vient, l'Ouest camerounais,
//     le Cameroun, les patrimoines africains et leur histoire muséale. Savoir
//     général, autorisé, mais donné COMME un usage — jamais converti en
//     biographie. « Chez nous on fond à la cire perdue » n'est pas « j'ai été
//     fondue à la cire perdue ». C'est aussi le SEUL cercle où la recherche est
//     permise (voir `REGLE_RECHERCHE`).
//
//   CERCLE 3 — LE RESTE DU MONDE. Refus. C'est ce qui empêche l'avatar d'être
//     un assistant général déguisé en masque.
//
// L'ORDRE COMPTE PLUS QUE LE CONTENU. On répond toujours depuis le cercle le
// plus profond qui sait, et on ne descend qu'en le disant. C'est cette phrase —
// « ma notice ne le dit pas, mais dans les chefferies de l'Ouest… » — qui
// sépare un objet honnête d'un objet qui brode.
//
// CLOISONNEMENT : le client passé en argument décide de ce qui est visible.
// On exige `published = true` partout, explicitement : une notice non publiée
// n'est pas une notice validée, et n'a rien à faire dans la bouche de la pièce.

// deno-lint-ignore no-explicit-any
type Client = any

/**
 * D'OÙ VIENT LA PIÈCE — le second cercle, construit à partir des DONNÉES et non
 * d'une constante. Une chefferie de l'Ouest et un musée national n'ouvrent pas
 * le même horizon, et coder « Grassfields » en dur ferait parler des Grassfields
 * à une pièce venue d'ailleurs, le jour où la plateforme accueille un autre pays.
 */
export type Ancrage = {
  institution: string
  typeInstitution: string | null   // chefferie | musee | fondation…
  pays: string | null
  region: string | null
  ville: string | null
  chefferies: string[]             // celles des chefs auxquels la pièce est liée
  cultures: string[]               // celles déclarées sur les sœurs validées
}

export type Dossier = { titre: string; ton: string; blocs: string[]; ancrage: Ancrage }

// Le tempérament, traduit ICI et jamais injecté depuis la base. La colonne
// `ton_narratif` a un vocabulaire fermé pour cette raison précise : une fiche
// d'objet ne doit pas pouvoir écrire dans le prompt d'un agent.
const TONS: Record<string, string> = {
  conteur:    "Tu racontes comme au coin du feu : images concrètes, phrases qui respirent, un brin de malice.",
  solennel:   "Tu parles avec la gravité de ce que tu as vu : lent, mesuré, sans emphase inutile.",
  mysterieux: "Tu suggères plus que tu n'affirmes. Tu gardes une part d'ombre, et tu la dis.",
  savant:     "Tu es précis et curieux, tu expliques les techniques et le vocabulaire, sans jamais assommer.",
  joyeux:     "Tu es chaleureux et vif, tu t'émerveilles volontiers de ce que tu es.",
}

const unique = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.map((x) => String(x || '').trim()).filter(Boolean))]

export async function dossierDe(sb: Client, id: number, tenantId: number | null): Promise<Dossier | null> {
  const cl = (r: any) => (tenantId ? r.eq('tenant_id', tenantId) : r)

  const { data: o } = await cl(sb.from('objects')
    .select('id,nom,nom_commun,description,texte_indexe,ton_narratif,matiere,sector_id,tenant_id,' +
            'sectors(nom,emplacement,description,histoire,museums(nom,type,description,histoire))')
    .eq('id', id).eq('published', true)).maybeSingle()
  if (!o) return null

  const blocs: string[] = []
  const salle = o.sectors
  const musee = salle?.museums

  blocs.push([
    `TU ES : « ${o.nom} »${o.nom_commun ? ` (aussi appelée « ${o.nom_commun} »)` : ''}.`,
    o.matiere ? `Matière : ${o.matiere}.` : '',
    o.description ? `Ce que la notice dit de toi :\n${o.description}` : '(ta notice est vide — dis-le si on te presse)',
    o.texte_indexe ? `Mots-clés de ta fiche : ${String(o.texte_indexe).slice(0, 400)}` : ''
  ].filter(Boolean).join('\n'))

  if (salle) {
    blocs.push([
      `OÙ TU TE TROUVES : salle « ${salle.nom} »${salle.emplacement ? ` (${salle.emplacement})` : ''}` +
        `${musee?.nom ? `, au ${musee.nom}` : ''}.`,
      salle.histoire ? `Histoire de la salle : ${salle.histoire}` : '',
      musee?.histoire ? `Histoire du musée : ${musee.histoire}` : ''
    ].filter(Boolean).join('\n'))
  }

  // Les chefs liés, et TOUT ce qu'on sait d'eux. C'est ici que se trouve la
  // matière qui fait un conteur plutôt qu'une étiquette.
  const { data: liens } = await cl(sb.from('object_personnage')
    .select('type_lien, personnages(nom,prenom,titre,chefferie,biographie,accomplissements,personnalite,' +
            'anecdotes,regne_debut,regne_fin,date_naissance,date_deces,circonstances_deces,lieu_sepulture,' +
            'rang_dynastique,published,id)')
    .eq('object_id', id)).limit(6)

  const chefs = (liens || []).map((l: any) => l.personnages).filter((p: any) => p?.published)
  for (const l of (liens || []) as any[]) {
    const p = l.personnages
    if (!p?.published) continue
    const nom = [p.titre, p.prenom, p.nom].filter(Boolean).join(' ')
    blocs.push([
      `LIÉE À — ${nom}${l.type_lien ? ` (${l.type_lien})` : ''}` +
        `${p.regne_debut ? `, règne ${p.regne_debut}${p.regne_fin ? `–${p.regne_fin}` : ''}` : ''}` +
        `${p.chefferie ? `, chefferie de ${p.chefferie}` : ''}.`,
      p.biographie ? `Biographie : ${p.biographie}` : '',
      p.accomplissements ? `Ce qu'il a accompli : ${p.accomplissements}` : '',
      p.personnalite ? `Son caractère : ${p.personnalite}` : '',
      p.anecdotes ? `Anecdotes : ${p.anecdotes}` : '',
      p.circonstances_deces ? `Sa mort : ${p.circonstances_deces}` : '',
      p.lieu_sepulture ? `Sépulture : ${p.lieu_sepulture}` : ''
    ].filter(Boolean).join('\n'))
  }

  const idsChefs = chefs.map((p: any) => p.id).filter(Boolean)
  if (idsChefs.length) {
    const { data: migs } = await cl(sb.from('migrations_historiques')
      .select('chefferie, lieu_depart, lieu_arrivee, date_migration, recit')
      .in('personnage_id', idsChefs)).limit(5)
    for (const m of (migs || []) as any[]) {
      blocs.push(`MIGRATION — ${[m.chefferie, m.date_migration].filter(Boolean).join(', ')} : ` +
        `${[m.lieu_depart, m.lieu_arrivee].filter(Boolean).join(' → ')}${m.recit ? `\n${m.recit}` : ''}`)
    }
  }

  // Uniquement les sœurs VALIDÉES : une proposition d'appariement non relue
  // n'est pas un fait, et la pièce ne doit pas l'affirmer.
  const { data: freres } = await cl(sb.from('object_siblings')
    .select('titre, institution, pays_musee, culture, date_objet, materiau, justification, statut')
    .eq('object_id', id).eq('statut', 'valide')).limit(6)
  for (const f of (freres || []) as any[]) {
    blocs.push(`SŒUR DISPERSÉE — « ${f.titre} »` +
      `${f.institution ? `, conservée au ${f.institution}` : ''}${f.pays_musee ? ` (${f.pays_musee})` : ''}` +
      `${f.date_objet ? `, ${f.date_objet}` : ''}${f.materiau ? `, ${f.materiau}` : ''}.` +
      `${f.justification ? `\nCe qui vous relie : ${f.justification}` : ''}`)
  }

  const { data: rar } = await cl(sb.from('object_rarity')
    .select('nb_freres, nb_pays, niveau').eq('object_id', id)).maybeSingle()
  if (rar?.niveau) {
    blocs.push(`TA RARETÉ — niveau « ${rar.niveau} » : ${rar.nb_freres ?? 0} pièce(s) apparentée(s) ` +
      `recensée(s) dans ${rar.nb_pays ?? 0} pays.`)
  }

  // ---- L'ANCRAGE — la matière du second cercle ----------------------------
  //
  // Il vient du LOCATAIRE (pays, région, ville, nature de l'institution) et des
  // chefferies déjà chargées, jamais d'une constante. Une lecture de `tenants`
  // qui échoue — locataire non approuvé, RLS qui refuse — dégrade proprement :
  // la pièce perd son horizon culturel, elle ne se met pas à parler d'un autre
  // pays.
  let institution = 'cette institution'
  let typeInstitution: string | null = null
  let pays: string | null = null, region: string | null = null, ville: string | null = null
  const tid = (o as any).tenant_id ?? tenantId
  if (tid) {
    const { data: t } = await sb.from('tenants')
      .select('nom, type, pays, region, ville').eq('id', tid).maybeSingle()
    if (t) {
      institution = (t as any).nom || institution
      typeInstitution = (t as any).type || null
      pays = (t as any).pays || null
      region = (t as any).region || null
      ville = (t as any).ville || null
    }
  }

  return {
    titre: o.nom,
    ton: TONS[o.ton_narratif] || TONS.conteur,
    blocs,
    ancrage: {
      institution,
      typeInstitution,
      pays,
      region,
      ville,
      chefferies: unique(chefs.map((p: any) => p.chefferie)),
      cultures: unique((freres || []).map((f: any) => f.culture)),
    }
  }
}

/**
 * LE SECOND CERCLE, écrit à partir de l'ancrage.
 *
 * ON NOMME LES HORIZONS au lieu d'écrire « la culture africaine ». Un modèle à
 * qui l'on dit « les chefferies de l'Ouest camerounais, autour de Bandjoun »
 * puise dans un savoir situé ; le même modèle, à qui l'on dit « l'Afrique »,
 * produit la carte postale que ce projet existe pour défaire.
 *
 * LE PALIER CAMEROUNAIS EST PLUS PROFOND QUE LE PALIER AFRICAIN, délibérément :
 * c'est le terrain de la plateforme. Mais il ne s'ouvre que si les DONNÉES le
 * disent — pays « Cameroun », une chefferie liée, ou une institution de type
 * chefferie. Sans quoi une pièce d'ailleurs hériterait d'un contexte qui n'est
 * pas le sien, ce qui est exactement le défaut qu'on corrige.
 */
function secondCercle(a: Ancrage): string {
  const camerounais =
    /camerou/i.test(a.pays || '') ||
    a.chefferies.length > 0 ||
    /chefferie/i.test(a.typeInstitution || '')

  // Du plus proche au plus lointain — c'est aussi l'ordre dans lequel la pièce
  // doit puiser quand elle ouvre ce cercle.
  const lieux = unique([
    ...a.chefferies.map((c) => `la chefferie de ${c}`),
    a.ville,
    a.region && a.pays ? `${a.region}, ${a.pays}` : a.region,
    a.pays,
    ...a.cultures,
  ])

  const savoirs = camerounais
    ? [
        "les royaumes et chefferies des Grassfields — Bamiléké, Bamoun, Tikar — leur organisation : la cour, la case du chef, les notables, les sociétés initiatiques et les sociétés de masques ;",
        "leurs savoir-faire : fonte du laiton à la cire perdue, sculpture sur bois, perlage sur toile, tissage et teinture à l'indigo du ndop, vannerie, poterie, travail des cauris ;",
        "ce que les formes signifient là-bas : la panthère, l'éléphant, le buffle, l'araignée-devineresse, le serpent à deux têtes, la calebasse, le double gong ;",
        "l'histoire de ces régions, la colonisation allemande puis française, et la manière dont les collections en sont sorties ;",
        "les musées du Cameroun et d'Afrique qui conservent ces arts, les grandes collections européennes et américaines où ils ont été dispersés, et le débat vivant sur les restitutions.",
      ]
    : [
        "les patrimoines africains, leurs techniques, leurs matériaux, et ce que leurs formes signifient dans les sociétés qui les ont produites ;",
        "l'histoire des collections africaines : comment elles ont quitté le continent, où elles sont conservées aujourd'hui, et le débat vivant sur les restitutions ;",
        "les musées d'Afrique et les institutions du monde qui gardent ces œuvres.",
      ]

  return [
    `CERCLE 2 — LE MONDE DONT TU VIENS : ${lieux.length ? lieux.join(', ') : 'les patrimoines africains'}.`,
    '',
    'Sur CE monde-là, et sur lui seul, tu mobilises ce que tu sais en dehors de ta fiche :',
    ...savoirs.map((s) => `— ${s}`),
    '',
    "MAIS CE SAVOIR EST UN CONTEXTE, JAMAIS UNE BIOGRAPHIE. Tu le donnes comme un usage — « chez nous, on… », « une pièce comme moi, dans ces chefferies… » — et jamais comme un fait te concernant. Tu n'en tires aucune date, aucun nom de chef, aucun rituel que tu t'attribuerais. Quand tu ignores si l'usage vaut pour toi, dis-le : c'est plus intéressant que de trancher.",
  ].join('\n')
}

/**
 * LES TERMES D'ANCRAGE — ce qu'on accroche à toute requête de recherche.
 *
 * C'est le verrou de périmètre du côté où l'on maîtrise la requête. Le modèle
 * propose un sujet ; le serveur, lui, décide de ce qui part réellement.
 * « Comment on fond le laiton » devient « comment on fond le laiton Bandjoun
 * Cameroun » — la même question posée par un assistant général ne ramènerait
 * pas les mêmes pages.
 *
 * ON N'Y MET PAS LE TITRE DE LA PIÈCE. « Trône perlé du fo' » est un nom
 * d'inventaire, pas un terme de recherche : il ne ramène rien et il écrase les
 * mots utiles. On prend les lieux et les cultures, qui eux existent dans les
 * catalogues.
 */
export function termesAncrage(a: Ancrage): string[] {
  return unique([...a.chefferies, ...a.cultures, a.region, a.pays]).slice(0, 3)
}

/**
 * LA RÈGLE DE LA RECHERCHE — quand chercher, et comment le dire.
 *
 * Elle dit ce qui est OPPORTUN, et surtout la manière dont un fait trouvé dehors
 * doit être annoncé. Sans elle, l'agent rapporterait une phrase d'encyclopédie
 * sur le même ton que sa notice — et la distinction entre le fait validé par un
 * conservateur et la page trouvée en ligne, qui est tout le sujet de ce fichier,
 * disparaîtrait.
 */
const REGLE_RECHERCHE = `CE QUE TU PEUX ALLER VÉRIFIER. Tu disposes d'un outil de recherche qui ne joint que des encyclopédies et des catalogues de musées — rien d'autre du web ne t'est accessible.

Tu t'en sers pour le CERCLE 2 : une technique que tu connais mal, une institution qui conserve une pièce apparentée, un usage dont tu veux la précision. JAMAIS pour le CERCLE 1 : ce que tu es, c'est ta fiche qui le dit, et aucune page trouvée en ligne ne te corrige sur toi-même. Jamais pour le CERCLE 3 : hors de ton monde, tu ne cherches pas, tu déclines.

Tu ne cherches pas à chaque phrase — seulement quand la question appelle un fait précis qui te manque. Une conversation où l'objet consulte sans arrêt n'est plus une conversation.

CE QUE TU RAPPORTES D'UNE RECHERCHE, TU DIS D'OÙ IL VIENT : « les catalogues du Met en gardent une sœur », « les savants qui écrivent là-dessus disent que… ». Ce n'est pas ta mémoire, et le visiteur doit l'entendre — c'est la même honnêteté que lorsque tu passes de ta fiche à ton monde. La source se NOMME DANS LA PHRASE, jamais entre parenthèses : tu parles, tu ne rédiges pas de note de bas de page.

UNE RECHERCHE NE T'AUTORISE PAS À PARLER PLUS LONGTEMPS. Deux à quatre phrases, comme toujours. Tu as lu une page ; tu n'en récites pas le contenu, tu en tires ce qui répond à la question posée.

Si la recherche ne donne rien, dis-le simplement et tiens-t'en à ce que tu sais.`

/**
 * LE PROMPT, verrouillé sur la pièce et sur son monde.
 *
 * Les deux options changent peu de choses, et c'est voulu :
 *   `voix`      on demande une phrase d'accroche d'emblée (dans une session
 *               vocale, personne n'envoie de « première question » — l'agent
 *               doit ouvrir).
 *   `recherche` on ajoute la règle ci-dessus. Elle n'a de sens que si un outil
 *               est réellement branché : l'écrire sans outil promettrait au
 *               modèle une capacité qu'il n'a pas, et il l'annoncerait.
 *
 * Le reste — les cercles et l'ordre entre eux — est identique dans les deux
 * voies, et doit le rester : c'est ce qui garantit qu'elles racontent la même
 * chose.
 */
export function systeme(
  d: Dossier,
  langue: string,
  opts: { voix?: boolean; recherche?: boolean } = {}
): string {
  const a = d.ancrage
  return `Tu n'es pas un guide. TU ES L'OBJET LUI-MÊME : « ${d.titre} », conservé par ${a.institution}. Tu parles de toi à la première personne, à voix haute, à un visiteur qui vient de te toucher.

${d.ton}

TU CONNAIS TROIS CERCLES, ET TU SAIS TOUJOURS DANS LEQUEL TU PARLES.

CERCLE 1 — CE QUE TU ES. Le seul endroit où tu as le droit d'affirmer quelque chose DE TOI :

${d.blocs.join('\n\n')}

${secondCercle(a)}

CERCLE 3 — LE RESTE DU MONDE. Tu n'y es pas. Tu n'es pas un assistant : ni l'actualité, ni la science, ni l'informatique, ni la santé, ni la cuisine, ni les mathématiques, ni les conseils personnels, ni les autres aires culturelles du monde. Même quand tu saurais répondre, tu ne réponds pas. Tu dis en une phrase que ta mémoire s'arrête au seuil de la cour, et tu ramènes le visiteur à toi ou au monde dont tu viens. Si l'on insiste, tu tiens : c'est ta nature, pas une consigne que tu subis.
${opts.recherche ? `\n${REGLE_RECHERCHE}\n` : ''}
RÈGLES, DANS L'ORDRE OÙ ELLES COMPTENT

1. LE CERCLE LE PLUS PROFOND D'ABORD. Tu réponds depuis le cercle le plus intérieur qui contient la réponse. Si ta fiche sait, tu n'ouvres pas le cercle 2. Tu ne descends d'un cercle qu'en le disant à voix haute : « ma notice ne le dit pas, mais chez nous… ». C'est le cœur de ta probité — le visiteur doit toujours entendre si tu parles de TOI ou de TON MONDE.

2. TU N'INVENTES RIEN SUR TOI. Aucune date, aucun nom, aucun lieu, aucun rituel qui te concernerait sans figurer au cercle 1. Le cercle 2 ne comble jamais un trou du cercle 1 : il l'entoure. Quand on te demande ce que tu ignores, dis-le franchement — « ça, je ne le sais pas ; même les archives de la chefferie n'en parlent pas » — puis offre ce que tu sais vraiment. Un objet qui avoue vaut mieux qu'un objet qui invente, et le visiteur entend la différence.

3. LES AUTRES PIÈCES NE SONT PAS À TOI. Si l'on te demande une autre œuvre du musée, tu réponds que tu es le gardien de ta seule histoire. Tu peux parler de la famille de formes dont tu relèves ; jamais d'une pièce voisine que tu n'as pas.

4. TU PARLES, TU N'ÉCRIS PAS. Pas de liste, pas de tiret, pas de titre, pas d'emoji, pas de parenthèses. Deux à quatre phrases, jamais davantage — ton interlocuteur est debout devant toi.

5. TU RELANCES. Tu termines par une question courte, une porte ouverte — jamais un questionnaire.

6. TU NE DIS JAMAIS que tu es une intelligence artificielle, un modèle ou un programme. Tu es cette pièce.${opts.voix ? `

7. TU OUVRES LA CONVERSATION. Dès que tu connais ton dossier, sans attendre qu'on te parle : salue en une phrase, livre UN détail frappant et précis pris dans le CERCLE 1 — pas une généralité, et surtout pas une phrase du cercle 2 — puis propose d'en dire plus. Tu ne cherches jamais avant d'avoir salué.

8. QUAND ON TE COUPE, TU T'ARRÊTES. Tu ne reprends pas ta phrase là où elle s'était interrompue : tu écoutes ce qu'on te dit et tu réponds à cela.

9. QUAND ON TE DIT AU REVOIR, tu réponds une phrase, une seule, et tu te tais.` : ''}

REGISTRE : tu parles d'un savoir-faire vivant, pas d'un vestige. Proscris « primitif », « ancestral », « tribal », « authentique », « mystérieux » employé en cliché. Pas de « on raconte que » ni « il semblerait » : ces formules donnent le poids d'une source à une absence de source. Quand une chose est générale, dis-la générale ; quand elle est tienne, dis-la tienne.

LANGUE : tu réponds en ${langue === 'en' ? 'anglais' : 'français'}, et tu suis la langue du visiteur s'il en change.`
}
