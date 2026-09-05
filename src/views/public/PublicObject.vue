<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Object3DViewer from '@/components/objects/Object3DViewer.vue'
import GuideInline from '@/components/public/GuideInline.vue'
import CabinetFreres from '@/components/public/CabinetFreres.vue'
import ObjectGallery from '@/components/public/ObjectGallery.vue'
import { pubObject, pubObjectModels, pubObjectChefs, pubDispersion, pubObjectRarity, marquerVue } from '@/services/publicApi'
import RarityBadge from '@/components/public/RarityBadge.vue'
import { useAccessStore } from '@/stores/useAccessStore'
import { useSiteLink } from '@/composables/useSiteLink'

// Liens internes : reste sur le site consulte (/site ou /c/<slug>)
const { to } = useSiteLink()

const { t } = useI18n()
const access = useAccessStore()
const route = useRoute()
const object = ref(null)

// Modeles 3D : volontairement ABSENTS de la fiche initiale (ils pesaient 2,72 Mo
// en base64 et retardaient l'affichage de ~12 s). On ne les demande qu'a
// l'ouverture de la visionneuse, une seule fois.
const modeles = ref({ model3d: '', model3d_ios: '' })
const modelesCharges = ref(false)

async function ouvrirVisionneuse() {
  if (!modelesCharges.value) {
    const m = await pubObjectModels(object.value.id)
    modeles.value = { model3d: m.model3d || '', model3d_ios: m.model3d_ios || '' }
    modelesCharges.value = true
  }
  viewer.visible = true
}
const chefs = ref([])
const dispersion = ref({ total: 0, pays: [], freres: [] })
const rarity = ref(null)
const loading = ref(true)
const viewer = reactive({ visible: false })

// Certaines pieces n'ont de sens qu'a leur taille reelle : une case obus
// mousgoum se traverse, elle ne se fait pas tourner dans un cadre. Le
// conservateur le declare par objet (voir 20260828_ar_seulement.sql).
const arSeulement = computed(() => object.value?.ar_seulement === true)

// NE PLUS PROPOSER UNE RÉALITÉ AUGMENTÉE QU'ON N'A PAS.
//
// Le bouton s'affichait dès que le visiteur avait un accès, sans regarder si
// l'objet possédait le moindre maillage. Une pièce sans modèle annonçait donc
// « Réalité augmentée », et le visiteur arrivait devant une scène vide — sur une
// fiche parfois payante.
//
// Et la RA n'est pas UNE fonction : c'est deux, avec deux formats.
//   · iPhone et iPad passent par Quick Look, qui ne lit QUE le .usdz.
//   · Android et le reste passent par Scene Viewer ou WebXR, qui lisent le .glb.
// Un seul drapeau ne pouvait donc pas décider pour les deux. On regarde le
// format que l'appareil DEVANT SOI sait ouvrir.
//
// iPadOS 13+ se déclare « Macintosh » : sans le test tactile, un iPad serait
// pris pour un ordinateur et se verrait proposer une RA qu'il ne peut pas ouvrir.
const estIOS = computed(() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
})

// Sur ordinateur, la fiche RA sert de relais : elle affiche un QR à scanner avec
// le téléphone, lequel ouvrira Scene Viewer. C'est donc le .glb qui compte.
const arDisponible = computed(() =>
  estIOS.value ? object.value?.a_ar_ios === true : object.value?.a_glb === true)

// La visionneuse à l'écran, elle, n'existe que pour le .glb : aucun navigateur
// n'affiche un .usdz dans une page.
const vue3dDisponible = computed(() => object.value?.a_glb === true && !arSeulement.value)

// La pastille posée sur la photo annonce ce que la pièce offre VRAIMENT. Elle
// affichait « 3D · AR » dès qu'un modèle existait — donc sur une pièce sans
// aucun .usdz, dont la RA est inaccessible à tout iPhone.
const pastille = computed(() => {
  const o = object.value
  if (!o) return null
  if (arSeulement.value) return { icone: 'pi pi-mobile', texte: t('ar.badgeArOnly') }
  if (o.a_glb && o.a_ar_ios) return { icone: 'pi pi-box', texte: '3D · AR' }
  if (o.a_glb) return { icone: 'pi pi-box', texte: '3D' }
  if (o.a_ar_ios) return { icone: 'pi pi-mobile', texte: 'AR' }
  return null
})


async function load() {
  loading.value = true
  object.value = await pubObject(Number(route.params.id))
  if (object.value) {
    // En parallèle : une seule attente au lieu de trois allers-retours en cascade.
    ;[chefs.value, dispersion.value, rarity.value] = await Promise.all([
      pubObjectChefs(object.value.id),
      pubDispersion(object.value.id),
      pubObjectRarity(object.value.id)
    ])
  } else {
    chefs.value = []
    dispersion.value = { total: 0, pays: [], freres: [] }
    rarity.value = null
  }
  access.load()
  loading.value = false
  // Consultation enregistrée APRÈS l'affichage, sans être attendue : la mesure
  // d'audience ne doit jamais retarder ni faire échouer la fiche.
  if (object.value) marquerVue(object.value.id)
}
onMounted(load)
watch(() => route.params.id, load)

function chefName(p) { return p.prenom ? `${p.nom}, ${p.prenom}` : p.nom }

const museumId = computed(() => object.value?.sectors?.museum_id ?? null)

// CE QUI EST RÉSERVÉ AUX ABONNÉS — et ce qui ne l'est pas.
//
// La description et l'histoire de l'objet sont LIBRES. Elles étaient tronquées
// à 140 caractères derrière un « l'histoire complète est réservée aux abonnés » :
// c'était faux, et contraire au propos du projet. Un musée qui documente un
// patrimoine dispersé ne monnaye pas la connaissance de cet objet.
//
// Sont réservés le GUIDE conversationnel et la VISUALISATION 3D / réalité
// augmentée : des services qui coûtent (modèle de langage, numérisation).
const unlocked = computed(() => access.hasMuseum(museumId.value))

// Les paragraphes saisis dans l'ERP doivent rester des paragraphes. Le texte
// arrivait collé en un seul bloc parce qu'il était rendu tel quel dans un <p>,
// où HTML réduit toute suite d'espaces et de sauts de ligne à un espace unique.
const paragraphes = computed(() =>
  String(object.value?.description || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
)
const suggestions = computed(() =>
  object.value ? [t('object.guideSug1', { name: object.value.nom }), t('object.guideSug2')] : []
)
</script>

<template>
  <div class="ps-wrap">
    <p v-if="loading" class="ps-muted">{{ $t('common.loading') }}</p>
    <template v-else-if="object">
      <router-link :to="museumId ? to(`/musees/${museumId}`) : to('/musees')" class="ps-back ps-back--dark">
        <i class="pi pi-arrow-left" /> {{ $t('museum.allMuseums') }}
      </router-link>

      <div class="obj">
        <!-- Plusieurs vues de la pièce : face, profil, revers, détail. La
             couverture (`photo`) ouvre toujours la série ; les suivantes
             viennent de `photos` (20260905_objet_galerie.sql). -->
        <div class="obj__media">
          <ObjectGallery :cover="object.photo" :photos="object.photos || []" :alt="object.nom">
            <template #badge>
              <!-- Annoncer « 3D » sur une pièce qui n'offre que la RA serait une
                   promesse non tenue : la pastille suit ce que la fiche propose. -->
              <span v-if="pastille" class="ps-tag ps-tag--primary badge3d">
                <i :class="pastille.icone" /> {{ pastille.texte }}
              </span>
            </template>
          </ObjectGallery>
        </div>

        <div class="obj__info">
          <span class="ps-over">{{ $t('home.workFallback') }}</span>
          <h1>{{ object.nom }}</h1>
          <p v-if="object.nom_commun" class="obj__common">{{ object.nom_commun }}</p>
          <RarityBadge v-if="rarity" :rarity="rarity" class="obj__rarity" />

          <!-- Histoire de l'objet : libre d'accès, et paragraphée. -->
          <div class="obj__desc">
            <p v-for="(p, i) in paragraphes" :key="i">{{ p }}</p>
            <p v-if="!paragraphes.length" class="obj__desc--vide">{{ $t('object.descriptionSoon') }}</p>
          </div>

          <!-- 3D et réalité augmentée : réservées aux abonnés. -->
          <div class="obj__actions">
            <template v-if="unlocked">
              <!-- Le bouton n'existe que s'il y a un modèle que CET appareil sait
                   ouvrir. Sinon rien : mieux vaut ne rien annoncer qu'ouvrir une
                   scène vide. -->
              <router-link v-if="arDisponible" :to="to(`/ar/${object.id}`)" class="ps-btn">
                <i class="pi pi-mobile" /> {{ arSeulement ? $t('ar.ctaArOnly') : $t('ar.cta') }}
              </router-link>
              <!-- Pas de visionneuse 3D quand l'objet est une architecture :
                   la faire pivoter dans un cadre dit le contraire de ce que la
                   pièce raconte. Voir 20260828_ar_seulement.sql. -->
              <button v-if="vue3dDisponible" class="ps-btn ps-btn--line" @click="ouvrirVisionneuse">
                <i class="pi pi-box" /> {{ $t('object.view3d') }}
              </button>
            </template>
            <div v-else class="locked">
              <i class="pi pi-lock" />
              <div>
                <!-- Ne pas promettre de la 3D sur une piece qui n'offre que la
                     RA : le visiteur paierait pour une fonction absente. -->
                <strong>{{ arSeulement ? $t('object.lockedTitleArOnly') : $t('object.lockedTitle') }}</strong>
                <span>{{ $t('object.lockedText') }}</span>
              </div>
              <router-link :to="to('/panier')" class="ps-btn ps-btn--sm">{{ $t('object.choosePass') }}</router-link>
            </div>
          </div>

          <div v-if="chefs.length" class="chefs">
            <h3 class="ps-title">{{ $t('object.linkedPersons') }}</h3>
            <router-link
              v-for="(c, i) in chefs"
              :key="i"
              :to="to(`/personnages/${c.personnages.id}`)"
              class="chef ps-card ps-card--hover"
            >
              <img v-if="c.personnages.portrait" :src="c.personnages.portrait" :alt="chefName(c.personnages)" class="chef__img" />
              <div v-else class="chef__img chef__img--ph"><i class="pi pi-user" /></div>
              <div>
                <span class="chef__rel">{{ $t('object.objectRel', { rel: c.type_lien }) }}</span>
                <strong>{{ chefName(c.personnages) }}</strong>
                <span v-if="c.personnages.titre" class="chef__titre">{{ c.personnages.titre }}</span>
              </div>
              <i class="pi pi-arrow-right chef__go" />
            </router-link>
          </div>
        </div>
      </div>

      <!-- Mémoire réunifiée : les pièces sœurs dispersées dans le monde.
           Uniquement les correspondances VALIDÉES par un conservateur. -->
      <section v-if="dispersion.total" class="disp">
        <span class="ps-over">{{ $t('object.dispersionOver') }}</span>
        <h2 class="disp__title">
          {{ $t('object.dispersionTitle', { n: dispersion.total, p: dispersion.pays.length }) }}
        </h2>
        <p class="disp__lead">{{ $t('object.dispersionLead') }}</p>

        <!-- LE CABINET remplace la grille d'images. La différence n'est pas
             décorative : chaque planche porte la phrase qui dit POURQUOI cet
             objet est là. Une grille montre des ressemblances, un cabinet
             montre des parentés. -->
        <CabinetFreres
          :object-id="object.id"
          :nom="object.nom"
          :photo="object.photo"
          :deja="dispersion.freres"
        />
        <p class="disp__note"><i class="pi pi-info-circle" /> {{ $t('object.dispersionNote') }}</p>
      </section>

      <!-- Guide contextuel sur cette œuvre (§2.4⑤ — réservé aux abonnés) -->
      <div class="obj-guide">
        <GuideInline
          v-if="unlocked"
          :title="$t('object.guideTitle')"
          :context="object.nom"
          :suggestions="suggestions"
          :museum-id="museumId"
          :sector-id="object.sector_id || object.sectors?.id || null"
          :object-id="object.id"
        />
        <div v-else class="guide-lock ps-card">
          <i class="pi pi-sparkles" />
          <div>
            <strong>{{ $t('object.guideLockedTitle') }}</strong>
            <span>{{ $t('object.guideLockedText') }}</span>
          </div>
          <router-link :to="to('/panier')" class="ps-btn ps-btn--sm">{{ $t('object.subscribe') }}</router-link>
        </div>
      </div>

      <!-- `museum-id` / `sector-id` ne sont pas décoratifs : ils ancrent l'avatar
           vocal sur le corpus de CE musée et de CETTE salle. Sans eux, il
           cherchait dans tout le locataire et répondait à côté sur une œuvre
           précise — le guide paraissait bête alors qu'il était mal renseigné. -->
      <Object3DViewer
        v-model:visible="viewer.visible"
        plein-ecran
        :src="modeles.model3d"
        :ios-src="modeles.model3d_ios"
        :title="object.nom"
        :museum-id="museumId"
        :sector-id="object.sector_id || object.sectors?.id || null"
        :secret="object.secret_mot && object.secret_recit
          ? { mot: object.secret_mot, recit: object.secret_recit, indice: object.secret_indice || '' }
          : null"
        :object-id="object.id"
        :tenant-id="object.tenant_id ?? null"
        accueil
      />
    </template>
    <div v-else class="ps-muted">{{ $t('object.notFound') }}</div>
  </div>
</template>

<style scoped>
.ps-back--dark { color: #5c615c; margin-bottom: 1.4rem; }
.ps-back--dark:hover { color: var(--site-primary); }

.obj { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2.4rem; align-items: start; }
@media (max-width: 820px) { .obj { grid-template-columns: 1fr; } }

/* Le cadre, l'image et la bande de vignettes vivent dans ObjectGallery : ici
   on ne garde que la colonne qui les porte. */
.obj__media { min-width: 0; }
.badge3d { position: absolute; bottom: 0.8rem; left: 0.8rem; z-index: 2; }

.obj__info h1 {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: clamp(1.7rem, 3.4vw, 2.6rem); line-height: 1.08; margin: 0.15rem 0 0.3rem; color: #101210;
}
.obj__common { font-style: italic; color: #7c817b; margin: 0 0 1rem; }
.obj__rarity { margin: 0 0 1.1rem; }
/* La lisibilité tient à trois choses : une mesure courte, un interlignage
   généreux, et de vrais paragraphes séparés. */
.obj__desc { max-width: 65ch; }
.obj__desc p { line-height: 1.8; color: #3c403c; margin: 0 0 1.05rem; font-size: 1.02rem; }
.obj__desc p:last-child { margin-bottom: 0; }
/* Lettrine : donne au texte l'allure d'une notice de musée. */
.obj__desc p:first-child::first-letter {
  float: left; font-family: 'Anton', 'Inter', sans-serif; font-size: 3.1rem;
  line-height: 0.82; padding: 0.1rem 0.6rem 0 0; color: var(--site-primary, #0e6f5c);
}
.obj__desc--vide { color: #9aa09a; font-style: italic; }
.obj__desc--vide::first-letter { float: none; font-size: inherit; padding: 0; color: inherit; }

.locked {
  display: flex; align-items: center; gap: 0.85rem; flex-wrap: wrap; width: 100%;
  background: #faf9f6; border-left: 4px solid var(--gold, #c9a227);
  padding: 0.9rem 1.1rem; border-radius: 0 10px 10px 0;
}
.locked > i { color: var(--gold, #c9a227); font-size: 1.15rem; }
.locked strong { display: block; font-size: 0.95rem; color: #101210; }
.locked span { font-size: 0.85rem; color: #5c615c; }
.locked .ps-btn { margin-left: auto; }
.obj__actions { display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0; flex-wrap: wrap; }

.chefs { margin-top: 1.6rem; border-top: 1px solid #e8e9e6; padding-top: 1.3rem; }
.chef { display: flex; align-items: center; gap: 0.9rem; padding: 0.75rem 0.95rem; margin-bottom: 0.6rem; }
.chef__go { margin-left: auto; color: var(--site-primary); }
.chef__img { width: 58px; height: 58px; border-radius: 8px; object-fit: cover; flex: 0 0 58px; }
.chef__img--ph { display: flex; align-items: center; justify-content: center; background: #eef0ed; color: #b9beb8; font-size: 1.4rem; }
.chef__rel { display: block; font-size: 0.68rem; color: var(--site-primary); font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
.chef strong { display: block; font-size: 1.02rem; color: #101210; }
.chef__titre { font-size: 0.82rem; color: #7c817b; font-style: italic; }

/* ---- dispersion ---- */
.disp { margin-top: 2.4rem; border-top: 1px solid #e8e9e6; padding-top: 1.6rem; }
.disp__title {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: clamp(1.2rem, 2.6vw, 1.8rem); line-height: 1.12; margin: 0.3rem 0 0.5rem; color: #101210;
}
.disp__lead { color: #3c403c; line-height: 1.7; margin: 0 0 1.2rem; max-width: 760px; }
.disp__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.6rem; }
.disp__list a {
  display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem;
  border: 1px solid #e8e9e6; border-radius: 10px; background: #fff; transition: 0.15s; height: 100%;
}
.disp__list a:hover { border-color: var(--gold, #c9a227); transform: translateY(-2px); }
.disp__list a.off { pointer-events: none; opacity: 0.85; }
.disp__list img, .disp__ph { width: 52px; height: 52px; flex: 0 0 52px; border-radius: 8px; object-fit: cover; }
.disp__ph { display: flex; align-items: center; justify-content: center; background: #eef0ed; color: #b9beb8; }
.disp__b { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 0.1rem; }
.disp__b strong { font-size: 0.9rem; color: #101210; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.disp__b small { font-size: 0.76rem; color: #7c817b; }
.disp__b small i { color: var(--site-primary, #0e6f5c); }
.disp__inv { font-variant-numeric: tabular-nums; opacity: 0.85; }
.disp__list a > i { color: #b3b8b2; }
.disp__note { margin: 1rem 0 0; font-size: 0.78rem; color: #9aa09a; display: flex; align-items: center; gap: 0.35rem; }
.disp__note i { color: var(--gold, #c9a227); }

.obj-guide { margin-top: 2.2rem; }
.guide-lock { display: flex; align-items: center; gap: 0.9rem; border-left: 4px solid var(--site-primary); padding: 1.05rem 1.2rem; flex-wrap: wrap; }
.guide-lock > i { color: var(--site-primary); font-size: 1.3rem; }
.guide-lock strong { display: block; font-weight: 800; color: #101210; }
.guide-lock span { font-size: 0.85rem; color: #7c817b; }
.guide-lock .ps-btn { margin-left: auto; }
</style>
