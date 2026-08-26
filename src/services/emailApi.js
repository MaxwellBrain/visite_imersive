import { supabase } from './supabase'

// E-mails transactionnels — l'envoi réel se fait dans l'Edge Function `send-email`
// (la clé du fournisseur reste côté serveur). Un envoi ne doit JAMAIS bloquer le parcours
// du visiteur : toute erreur est avalée et seulement tracée en console.
//
// Sans clé configurée, la fonction répond { skipped: true } et l'application continue.

async function send(payload) {
  try {
    const { data, error } = await supabase.functions.invoke('send-email', { body: payload })
    if (error) { console.warn('[email] envoi impossible :', error.message); return false }
    if (data?.skipped) return false          // aucune clé d'envoi posée : silencieux, c'est normal
    return !!data?.ok
  } catch (e) {
    console.warn('[email] envoi impossible :', e.message)
    return false
  }
}

// Identité visuelle de l'organisation, pour que l'e-mail ressemble à SON site.
function branding(settings, tenant) {
  return {
    marque: settings?.nomEntite || tenant?.nom || 'MUSÉA',
    couleur: settings?.couleurPrimaire || '#0e6f5c'
  }
}

// Reçu de commande, envoyé juste après le paiement.
export function sendOrderReceipt({ to, prenom, order, items, tenantId, settings, tenant, lien }) {
  if (!to) return Promise.resolve(false)
  return send({
    type: 'recu_commande',
    to,
    tenantId: tenantId ?? null,
    orderId: order?.id ?? null,
    prenom: prenom || '',
    total: order?.total ?? 0,
    devise: order?.devise || 'FCFA',
    date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
    items: (items || []).map((i) => ({ label: i.label, montant: i.montant })),
    lien,
    ...branding(settings, tenant)
  })
}

// Confirmation d'accès débloqué (pass ou audioguide).
export function sendAccessUnlocked({ to, prenom, libelle, expiration, tenantId, settings, tenant, lien }) {
  if (!to) return Promise.resolve(false)
  return send({
    type: 'acces_debloque',
    to, tenantId: tenantId ?? null,
    prenom: prenom || '', libelle, expiration: expiration || '', lien,
    ...branding(settings, tenant)
  })
}

// Accusé d'inscription d'une organisation (en attente de validation).
// `adresseSite` : l'adresse publique définitive (bandjoun.nexacode.store). C'est
// la première chose que le nouveau client cherche, et la seule qu'il ne peut pas
// deviner — on la lui écrit noir sur blanc plutôt que de le laisser la supposer.
export function sendTenantWelcome({ to, nomOrganisation, lien, adresseSite, tenantId }) {
  if (!to) return Promise.resolve(false)
  return send({
    type: 'bienvenue',
    to, nomOrganisation, lien,
    adresseSite: adresseSite || null,
    tenantId: tenantId ?? null,
    marque: 'MUSÉA', couleur: '#0e6f5c'
  })
}

// ALERTE AU SUPER-ADMIN — une organisation vient de s'inscrire et attend une
// décision. Aucun destinataire n'est passé : l'adresse de l'administrateur de la
// plateforme n'a pas à circuler dans le navigateur, la fonction de bord la
// résout depuis le secret SUPER_ADMIN_EMAIL.
// `tenantId` est VOLONTAIREMENT absent, et ce n'est pas un oubli : le journal
// `email_log` se lit avec `can_manage_tenant(tenant_id)`. Rattacher cette alerte
// à l'organisation qui vient de s'inscrire aurait laissé SON personnel y lire
// l'adresse du super-admin. Sans tenant, la ligne n'est lisible que par lui.
export function sendNouvelleOrganisation({ nomOrganisation, adresseSite, contactEmail, typeOrganisation, lien }) {
  return send({
    type: 'nouvelle_organisation',
    to: null,
    nomOrganisation, adresseSite, contactEmail, typeOrganisation, lien,
    marque: 'MUSÉA', couleur: '#0e6f5c'
  })
}

// Notification d'approbation : le site public de l'organisation est en ligne.
export function sendTenantApproved({ to, nomOrganisation, tenantId, lien }) {
  if (!to) return Promise.resolve(false)
  return send({
    type: 'organisation_approuvee',
    to, tenantId: tenantId ?? null, nomOrganisation, lien,
    marque: 'MUSÉA', couleur: '#0e6f5c'
  })
}

// Réponse du personnel à un message reçu dans la boîte de l'organisation.
// Comme pour les campagnes, on renvoie le booléen tel quel : la vue doit savoir
// si le visiteur a réellement été prévenu, pour l'afficher dans le fil.
export function sendMessageReply({ to, prenom, sujet, contenu, question, lien, tenantId, settings, tenant }) {
  if (!to) return Promise.resolve(false)
  return send({
    type: 'reponse_message',
    to, tenantId: tenantId ?? null,
    prenom: prenom || '', sujet, contenu,
    question: question || '', lien: lien || '',
    ...branding(settings, tenant)
  })
}

// Campagne adressée au public de l'organisation (V2 Phase 4).
// Contrairement aux e-mails transactionnels, on veut ici connaître l'issue de chaque
// envoi (pour le bilan de la campagne) : on renvoie donc le booléen tel quel.
export function sendCampaignEmail({ to, prenom, sujet, contenu, image, lien, lienTexte, desinscription, tenantId, settings, tenant }) {
  if (!to) return Promise.resolve(false)
  return send({
    type: 'campagne',
    to, tenantId: tenantId ?? null,
    prenom: prenom || '', sujet, contenu,
    image: image || '', lien: lien || '', lienTexte: lienTexte || '',
    desinscription: desinscription || '',
    ...branding(settings, tenant)
  })
}
