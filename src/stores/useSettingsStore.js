import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { scopeToTenant } from '@/services/tenant'
import { useAuthStore } from '@/stores/useAuthStore'

const fromRow = (r) => ({
  id: r.id,
  nomEntite: r.nom_entite,
  logo: r.logo,
  favicon: r.favicon,
  imageFond: r.image_fond,
  couleurPrimaire: r.couleur_primaire,
  couleurSecondaire: r.couleur_secondaire,
  accroche: r.accroche,
  contactEmail: r.contact_email,
  contactTel: r.contact_tel,
  adresse: r.adresse,
  reseaux: r.reseaux || {},
  langues: r.langues || ['fr', 'en'],
  langueDefaut: r.langue_defaut,
  authGoogle: r.auth_google,
  authEmail: r.auth_email,
  mentionsLegales: r.mentions_legales,
  confidentialite: r.confidentialite,
  // SEO & partage
  seoTitre: r.seo_titre,
  seoDescription: r.seo_description,
  seoMotsCles: r.seo_mots_cles,
  seoImage: r.seo_image,
  analyticsId: r.analytics_id,
  // Bandeau d'annonce
  bandeauActif: r.bandeau_actif ?? false,
  bandeauTexte: r.bandeau_texte,
  bandeauCouleur: r.bandeau_couleur,
  bandeauLien: r.bandeau_lien,
  // Accueil / Hero
  heroTitre: r.hero_titre,
  heroSousTitre: r.hero_sous_titre,
  heroCtaTexte: r.hero_cta_texte,
  heroCtaLien: r.hero_cta_lien,
  // Infos pratiques
  horaires: r.horaires,
  joursFermeture: r.jours_fermeture,
  tarifEntree: r.tarif_entree,
  mapsUrl: r.maps_url,
  // Maintenance
  maintenanceActif: r.maintenance_actif ?? false,
  maintenanceMessage: r.maintenance_message,
  // Pied de page
  footerTexte: r.footer_texte,
  footerLiens: r.footer_liens || [],
  // Marque et visuels — autrefois écrits en dur dans le code
  marque: r.marque,
  marqueInitiale: r.marque_initiale,
  heroImage: r.hero_image,
  loginImage: r.login_image,
  loginTitre: r.login_titre,
  loginSousTitre: r.login_sous_titre,
  // Blocs éditables (null = textes par défaut issus des traductions)
  badges: r.badges ?? null,
  bandeGenealogie: r.bande_genealogie ?? null,
  blocPwa: r.bloc_pwa ?? null
})
const toRow = (s) => ({
  nom_entite: s.nomEntite,
  logo: s.logo ?? null,
  favicon: s.favicon ?? null,
  image_fond: s.imageFond ?? null,
  couleur_primaire: s.couleurPrimaire ?? null,
  couleur_secondaire: s.couleurSecondaire ?? null,
  accroche: s.accroche ?? null,
  contact_email: s.contactEmail ?? null,
  contact_tel: s.contactTel ?? null,
  adresse: s.adresse ?? null,
  reseaux: s.reseaux ?? {},
  langues: s.langues ?? ['fr', 'en'],
  langue_defaut: s.langueDefaut ?? 'fr',
  auth_google: s.authGoogle ?? true,
  auth_email: s.authEmail ?? true,
  mentions_legales: s.mentionsLegales ?? null,
  confidentialite: s.confidentialite ?? null,
  seo_titre: s.seoTitre ?? null,
  seo_description: s.seoDescription ?? null,
  seo_mots_cles: s.seoMotsCles ?? null,
  seo_image: s.seoImage ?? null,
  analytics_id: s.analyticsId ?? null,
  bandeau_actif: s.bandeauActif ?? false,
  bandeau_texte: s.bandeauTexte ?? null,
  bandeau_couleur: s.bandeauCouleur ?? null,
  bandeau_lien: s.bandeauLien ?? null,
  hero_titre: s.heroTitre ?? null,
  hero_sous_titre: s.heroSousTitre ?? null,
  hero_cta_texte: s.heroCtaTexte ?? null,
  hero_cta_lien: s.heroCtaLien ?? null,
  horaires: s.horaires ?? null,
  jours_fermeture: s.joursFermeture ?? null,
  tarif_entree: s.tarifEntree ?? null,
  maps_url: s.mapsUrl ?? null,
  maintenance_actif: s.maintenanceActif ?? false,
  maintenance_message: s.maintenanceMessage ?? null,
  footer_texte: s.footerTexte ?? null,
  footer_liens: s.footerLiens ?? [],
  marque: s.marque ?? null,
  marque_initiale: s.marqueInitiale ?? null,
  hero_image: s.heroImage ?? null,
  login_image: s.loginImage ?? null,
  login_titre: s.loginTitre ?? null,
  login_sous_titre: s.loginSousTitre ?? null,
  badges: s.badges ?? null,
  bande_genealogie: s.bandeGenealogie ?? null,
  bloc_pwa: s.blocPwa ?? null,
  updated_at: new Date().toISOString()
})

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref(null)
  const tenantId = ref(null) // organisation dont on affiche les réglages
  let channel = null

  // Trois cas :
  //  1. tenantIdArg fourni  → site public d'une organisation précise (route /c/:slug)
  //  2. utilisateur rattaché → ERP : les réglages de SON organisation
  //  3. visiteur anonyme     → 1re organisation approuvée (site public historique)
  //
  // `force` : ces réglages étaient rechargés à CHAQUE navigation (le layout
  // public et plusieurs vues appellent `load()` au montage), pour une donnée
  // qui ne bouge presque jamais. Or un aller-retour vers Supabase coûte 323 à
  // 2 050 ms — mesuré le 2026-08-20. On saute donc l'appel si les réglages de
  // CETTE organisation sont déjà en mémoire.
  //
  // Sans risque de contenu périmé : l'abonnement temps réel ci-dessous
  // répercute toute modification, qu'elle vienne de l'ERP ou d'un autre onglet.
  async function load(tenantIdArg = null, { force = false } = {}) {
    const auth = useAuthStore()
    const dejaCharge = settings.value
      && (tenantIdArg == null || tenantId.value === tenantIdArg)
    if (dejaCharge && !force) return settings.value

    const base = supabase.from('site_settings').select('*')
    let q
    if (tenantIdArg != null) q = base.eq('tenant_id', tenantIdArg)
    else if (auth.tenantId != null || auth.isSuperAdmin) q = scopeToTenant(base)
    else q = base // la RLS ne renvoie déjà que les organisations approuvées
    const { data, error } = await q.order('id').limit(1).maybeSingle()
    if (error) console.error('[settings] load', error.message)
    else if (data) { settings.value = fromRow(data); tenantId.value = data.tenant_id ?? null }
    return settings.value
  }

  // Temps réel : toute modification enregistrée (depuis l'ERP ou un autre onglet)
  // est répercutée immédiatement sur le site public, sans rechargement.
  // On n'applique que les changements de l'organisation affichée.
  function subscribeRealtime() {
    if (channel) return
    channel = supabase
      .channel('site_settings_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, (payload) => {
        const row = payload.new
        if (!row || !row.id) return
        if (tenantId.value != null && row.tenant_id !== tenantId.value) return
        settings.value = fromRow(row)
      })
      .subscribe()
  }
  async function save(patch) {
    if (!settings.value) return
    const { data: r, error } = await supabase
      .from('site_settings')
      .update(toRow(patch))
      .eq('id', settings.value.id)
      .select()
      .single()
    if (error) throw error
    settings.value = fromRow(r)
  }

  // Vide les réglages (organisation introuvable ou non publiée) : évite qu'il
  // reste à l'écran le nom ou le branding de l'organisation précédente.
  function clear() {
    settings.value = null
    tenantId.value = null
  }

  return { settings, tenantId, load, save, subscribeRealtime, clear }
})
