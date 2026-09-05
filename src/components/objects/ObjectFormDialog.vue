<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'
import { useObjectStore } from '@/stores/useObjectStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useGenealogyStore } from '@/stores/useGenealogyStore'
import { OBJECT_CHEF_RELATIONS } from '@/constants/options'
import { improveDescription, generateSeo } from '@/services/aiService'
import ImageUploader from '@/components/common/ImageUploader.vue'
import GalleryUploader from '@/components/common/GalleryUploader.vue'
import { vignette } from '@/services/image'
import Object3DViewer from '@/components/objects/Object3DViewer.vue'
import { televerser } from '@/services/stockage'
import { convertirUsdzEnGlb, ERREURS as ERREURS_USDZ } from '@/services/usdz'

const props = defineProps({
  visible: { type: Boolean, default: false },
  object: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()
const store = useObjectStore()
const sectorStore = useSectorStore()
const museumStore = useMuseumStore()
const genealogy = useGenealogyStore()
const toast = useToast()

const activeTab = ref('0')
const submitted = ref(false)
const improving = ref(false)
const generatingSeo = ref(false)
const preview3dVisible = ref(false)
const model3dInput = ref(null)
const model3dIosInput = ref(null)
// Étape de la conversion USDZ → GLB, ou null hors conversion. Un scan de 20 000
// sommets prend une centaine de millisecondes, mais un fichier lourd sur une
// machine lente peut occuper la page une seconde ou deux : sans ce témoin,
// l'utilisateur croit que son clic n'a rien fait et recommence.
const conversion = ref(null)

const form = reactive({
  museumId: null,
  sectorId: null,
  nom: '',
  nomCommun: '',
  description: '',
  photo: '',
  photoThumb: null,
  // Vues complementaires (migration 20260905_objet_galerie.sql). La photo
  // ci-dessus reste la COUVERTURE : c'est elle que voient les listes, les
  // vignettes et les cartes de partage.
  photos: [],
  model3d: null,
  model3dName: '',
  model3dIos: null,
  model3dIosName: '',
  arPlacement: 'floor',
  arEchelle: 1,
  arSeulement: false,
  published: false,
  chefId: null,
  chefRelation: 'possédé par',
  seo: { title: '', description: '', slug: '', keywords: [] }
})

const museumOptions = computed(() =>
  museumStore.items.map((m) => ({ label: m.nom, value: m.id }))
)
const sectorOptions = computed(() =>
  sectorStore.items
    .filter((s) => s.museumId === form.museumId)
    .map((s) => ({ label: s.nom, value: s.id }))
)
const chefOptions = computed(() =>
  genealogy.chefs().map((c) => ({
    label: `${genealogy.nomComplet(c)}${c.titre ? ` — ${c.titre}` : ''}`,
    value: c.id
  }))
)

const keywordsText = computed({
  get: () => form.seo.keywords.join(', '),
  set: (val) => {
    form.seo.keywords = val
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  }
})

const valid = computed(() => form.nom.trim() && form.sectorId != null)

function reset() {
  const obj = props.object
  const derivedMuseum = obj ? sectorStore.getById(obj.sectorId)?.museumId ?? null : null
  form.museumId = derivedMuseum
  form.sectorId = obj?.sectorId ?? null
  form.nom = obj?.nom ?? ''
  form.nomCommun = obj?.nomCommun ?? ''
  form.description = obj?.description ?? ''
  form.photo = obj?.photo ?? ''
  form.photoThumb = obj?.photoThumb ?? null
  form.photos = Array.isArray(obj?.photos) ? obj.photos.map((v) => ({ ...v })) : []
  form.model3d = obj?.model3d ?? null
  form.model3dName = obj?.model3dName ?? ''
  form.model3dIos = obj?.model3dIos ?? null
  form.model3dIosName = obj?.model3dIosName ?? ''
  form.arPlacement = obj?.arPlacement ?? 'floor'
  form.arEchelle = obj?.arEchelle ?? 1
  form.arSeulement = obj?.arSeulement ?? false
  form.published = obj?.published ?? false
  form.seo = {
    title: obj?.seo?.title ?? '',
    description: obj?.seo?.description ?? '',
    slug: obj?.seo?.slug ?? '',
    keywords: obj?.seo?.keywords ? [...obj.seo.keywords] : []
  }
  const lien = genealogy.linkForObject(obj?.id)
  form.chefId = lien?.individuId ?? null
  form.chefRelation = lien?.relation ?? 'possédé par'
  submitted.value = false
  activeTab.value = '0'
}

const chargementMedias = ref(false)

watch(
  () => props.visible,
  async (open) => {
    if (!open) return
    reset()
    // La liste ne transporte plus les médias lourds (voir useObjectStore) :
    // on les récupère à l'ouverture de la fiche, et pour ce seul objet.
    if (props.object?.id && props.object.photo === undefined) {
      chargementMedias.value = true
      try {
        const m = await store.chargerMedias(props.object.id)
        form.photo = m.photo || ''
        form.photos = Array.isArray(m.photos) ? m.photos.map((v) => ({ ...v })) : []
        form.model3d = m.model3d || null
        form.model3dIos = m.model3d_ios || null
      } catch { /* la fiche reste modifiable sans ses médias */ } finally {
        chargementMedias.value = false
      }
    }
  }
)

// La vignette suit la photo. Elle est produite ici, une fois, plutôt qu'à
// chaque affichage de la liste : ~8 Ko qui évitent de charger des centaines de
// kilo-octets par ligne de tableau.
watch(
  () => form.photo,
  async (photo) => {
    form.photoThumb = photo ? await vignette(photo) : null
  }
)

// Si on change de musée, on réinitialise le secteur s'il n'appartient plus à ce musée.
watch(
  () => form.museumId,
  () => {
    if (form.sectorId && !sectorOptions.value.some((s) => s.value === form.sectorId)) {
      form.sectorId = null
    }
  }
)

// Import du modèle 3D.
//
// ⚠️ Cette fonction utilisait `URL.createObjectURL(file)`. Une adresse `blob:`
// n'existe QUE dans l'onglet qui l'a créée : enregistrée en base, elle était
// morte au rechargement suivant et sur tout autre appareil. Aucun modèle 3D
// n'a donc jamais pu s'afficher en ligne, ni en réalité augmentée.
// On enregistre désormais le contenu lui-même, comme pour les photos.
// Plafond aligne sur celui du bucket `modeles` (50 Mo). Il valait 12 Mo tant
// que le modele partait en base64 dans la colonne — encodage qui ajoute encore
// un tiers au poids. Un scan photogrammetrique texture depasse couramment
// 20 Mo : la limite precedente le refusait sans raison technique.
const MODEL_MAX_MO = 50

// `champ` vaut 'model3d' (.glb, Android et navigateurs) ou 'model3dIos' (.usdz,
// Quick Look sur iPhone/iPad). Les deux sont nécessaires pour couvrir tout le parc :
// iOS ne lira jamais un .glb, Android ne lira jamais un .usdz.
// Reconnaît le format RÉEL d'un fichier 3D par sa signature, pas par son nom.
// Un .usdz est une archive ZIP (« PK.. »), un .glb commence par « glTF ».
// L'extension ment : elle est modifiable d'un clic, et un fichier renommé
// passerait un contrôle qui s'y fierait.
async function formatReel(file) {
  const tete = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const txt = String.fromCharCode(...tete)
  if (txt === 'glTF') return 'glb'
  if (txt.startsWith('PK')) return 'usdz'
  if (txt.trimStart().startsWith('{')) return 'gltf-json'
  return 'inconnu'
}

// Le modele part dans le Storage, PAS en base64. Mesure du 2026-08-19 : un
// maillage encode dans la colonne pesait 2,72 Mo, relus a chaque requete sur
// l'objet, et retardait sa fiche publique de 12 s. Ici la colonne ne recoit
// qu'une URL, et le fichier n'est telecharge qu'a l'ouverture de la 3D.
async function deposer(file, champ, ext) {
  const url = await televerser(file, 'modeles', { extensionForcee: ext })
  form[champ] = url
  form[`${champ}Name`] = file.name
}

// USDZ → GLB, dans la page. Renvoie le fichier converti, ou null si la lecture
// a échoué — l'échec est alors déjà expliqué à l'utilisateur.
async function convertirScan(file) {
  conversion.value = 'lecture'
  try {
    const { fichier, stats } = await convertirUsdzEnGlb(file, {
      onEtape: (etape) => { conversion.value = etape }
    })
    // Une UV mal interpolée ou une texture absente donne un modèle qui
    // s'affiche mais qui est FAUX. Se taire produirait un objet gris que
    // personne ne saurait expliquer trois semaines plus tard.
    for (const a of stats.avertissements) {
      toast.add({
        severity: 'warn',
        summary: t('admin.objects.usdzWarn'),
        detail: t(`admin.objects.usdzWarn_${a.code}`, a),
        life: 8000
      })
    }
    return fichier
  } catch (e) {
    const code = Object.values(ERREURS_USDZ).includes(e?.message) ? e.message : null
    console.warn('[usdz]', e?.message || e)
    toast.add({
      severity: 'error',
      summary: t('admin.objects.usdzFailed'),
      detail: code ? t(`admin.objects.${code}`) : (e?.message || ''),
      life: 10000
    })
    return null
  } finally {
    conversion.value = null
  }
}

async function lireModele(event, champ) {
  const file = event.target.files?.[0]
  // Le champ de fichier est vidé tout de suite : la suite est asynchrone et ne
  // relit jamais l'input, et sans cela redéposer le même fichier ne déclenche
  // aucun événement.
  event.target.value = ''
  if (!file) return

  const mo = file.size / (1024 * 1024)
  if (mo > MODEL_MAX_MO) {
    toast.add({
      severity: 'warn',
      summary: t('admin.objects.model3dTooBig', { n: MODEL_MAX_MO }),
      detail: t('admin.objects.model3dUseUrl', { n: mo.toFixed(1) }),
      life: 7000
    })
    return
  }

  // Le format se lit dans la SIGNATURE du fichier, pas dans son nom.
  const format = await formatReel(file)

  try {
    // ---------------------------------------------------------------- USDZ --
    //
    // Un USDZ dans le champ GLB était refusé : « ce fichier va dans le champ
    // iPhone ». Le contrôle était juste — aucun navigateur n'affiche un usdz —
    // mais il laissait le conservateur devant une impasse, puisque c'est
    // précisément ce que rend son iPhone. La conversion existait, hors de
    // l'ERP, dans `scripts/usdz-vers-glb.py` : il fallait un poste de
    // développeur pour s'en servir.
    //
    // Une seule dépose remplit donc maintenant LES DEUX champs : l'archive
    // telle quelle pour Quick Look (iOS), sa conversion pour tout le reste du
    // parc. Le musée n'a plus à savoir lequel va où.
    if (format === 'usdz') {
      // CHAQUE CHAMP RESTE MAÎTRE DE SON CONTENU.
      //
      // Une première version remplissait LES DEUX champs d'un seul dépôt : le
      // .usdz partait aussi vers le champ iPhone, en plus de sa conversion. Ce
      // n'est pas au formulaire d'en décider. La réalité augmentée iOS engage
      // le musée sur une fonction visible du public — elle se choisit, elle ne
      // s'active pas toute seule parce qu'un fichier avait le bon format.
      //
      // Le champ iPhone reçoit donc l'archive telle quelle, et lui seul. Le
      // champ « Modèle 3D » reçoit la conversion, et lui seul.
      if (champ === 'model3dIos') {
        await deposer(file, 'model3dIos', 'usdz')
        toast.add({ severity: 'success', summary: t('admin.objects.model3dLoaded'), detail: file.name, life: 2000 })
        return
      }

      const glb = await convertirScan(file)
      if (!glb) return
      await deposer(glb, 'model3d', 'glb')
      toast.add({
        severity: 'success',
        summary: t('admin.objects.usdzConverted'),
        detail: t('admin.objects.usdzConvertedDetail', { n: (glb.size / (1024 * 1024)).toFixed(1) }),
        life: 7000
      })
      return
    }

    // ----------------------------------------------------------- GLB / glTF --
    //
    // L'inverse reste une erreur, et sans remède : Quick Look ne lit que du
    // usdz, et convertir un GLB en usdz demanderait un encodeur USD complet.
    if (champ === 'model3dIos') {
      toast.add({
        severity: 'error',
        summary: t('admin.objects.model3dWrongSlot'),
        detail: t('admin.objects.model3dIsGlb'),
        life: 9000
      })
      return
    }
    if (format !== 'glb' && format !== 'gltf-json') {
      toast.add({
        severity: 'error',
        summary: t('admin.objects.model3dWrongSlot'),
        detail: t('admin.objects.model3dUnknown'),
        life: 9000
      })
      return
    }

    await deposer(file, 'model3d', 'glb')
    toast.add({ severity: 'success', summary: t('admin.objects.model3dLoaded'), detail: file.name, life: 2000 })
  } catch (e) {
    console.warn('[modele3d]', e?.message || e)
    toast.add({
      severity: 'error',
      summary: t('admin.objects.model3dFailed'),
      detail: e?.message || '',
      life: 5000
    })
  }
}

const onModel3dFile = (e) => lireModele(e, 'model3d')
const onModel3dIosFile = (e) => lireModele(e, 'model3dIos')

const placementOptions = computed(() => [
  { label: t('admin.objects.arFloor'), value: 'floor' },
  { label: t('admin.objects.arWall'), value: 'wall' }
])

async function runImprove() {
  if (!form.description.trim()) {
    toast.add({ severity: 'warn', summary: t('admin.objects.descFirst'), life: 2500 })
    return
  }
  improving.value = true
  try {
    form.description = await improveDescription({ nom: form.nom, description: form.description })
    toast.add({ severity: 'success', summary: t('admin.objects.descImproved'), life: 2000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.objects.aiFailed'), detail: e.message, life: 3000 })
  } finally {
    improving.value = false
  }
}

async function runSeo() {
  generatingSeo.value = true
  try {
    form.seo = await generateSeo({ nom: form.nom, description: form.description })
    toast.add({ severity: 'success', summary: t('admin.objects.seoGenerated'), life: 2000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.objects.aiFailed'), detail: e.message, life: 3000 })
  } finally {
    generatingSeo.value = false
  }
}

function close() {
  emit('update:visible', false)
}

// VERROU ANTI-DOUBLE-ENVOI.
//
// L'enregistrement pouvait durer plusieurs secondes ; pendant ce temps le
// bouton restait actif, et un second clic créait un DEUXIÈME objet. Ce n'était
// pas de l'impatience de l'utilisateur mais un défaut de l'interface : un
// bouton qui reste cliquable annonce qu'il reste quelque chose à faire.
const saving = ref(false)

async function save() {
  if (saving.value) return // garde-fou, même si le bouton est déjà désactivé
  submitted.value = true
  if (!valid.value) {
    activeTab.value = '0'
    return
  }
  saving.value = true
  const payload = {
    sectorId: form.sectorId,
    nom: form.nom,
    nomCommun: form.nomCommun,
    description: form.description,
    photo: form.photo,
    photoThumb: form.photoThumb,
    photos: form.photos,
    model3d: form.model3d,
    model3dName: form.model3dName,
    model3dIos: form.model3dIos,
    model3dIosName: form.model3dIosName,
    arPlacement: form.arPlacement,
    arEchelle: form.arEchelle,
    arSeulement: form.arSeulement,
    published: form.published,
    seo: { ...form.seo, keywords: [...form.seo.keywords] }
  }
  try {
    let savedId
    if (props.object) {
      await store.update(props.object.id, payload)
      savedId = props.object.id
      toast.add({ severity: 'success', summary: t('admin.objects.updated'), life: 2500 })
    } else {
      const created = await store.add(payload)
      savedId = created.id
      toast.add({ severity: 'success', summary: t('admin.objects.created'), detail: form.nom, life: 2500 })
    }
    await genealogy.setObjetLien(savedId, form.chefId, form.chefRelation)
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.museums.saveFailed'), detail: e.message, life: 3500 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="object ? $t('admin.objects.formEditTitle') : $t('admin.objects.formCreateTitle')"
    :style="{ width: '46rem', maxWidth: '96vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="0"><i class="pi pi-info-circle" /> {{ $t('admin.objects.tabGeneral') }}</Tab>
        <Tab value="1"><i class="pi pi-align-left" /> {{ $t('admin.objects.tabDescription') }}</Tab>
        <Tab value="2"><i class="pi pi-images" /> {{ $t('admin.objects.tabMedia') }}</Tab>
        <Tab value="3"><i class="pi pi-search" /> {{ $t('admin.objects.tabSeo') }}</Tab>
      </TabList>

      <TabPanels>
        <!-- GÉNÉRAL -->
        <TabPanel value="0">
          <div class="vi-row">
            <div class="vi-field">
              <label for="o-musee">{{ $t('admin.objects.fMuseum') }}</label>
              <Select
                id="o-musee"
                v-model="form.museumId"
                :options="museumOptions"
                option-label="label"
                option-value="value"
                :placeholder="$t('admin.objects.fMuseumPlaceholder')"
                filter
              />
            </div>
            <div class="vi-field">
              <label class="vi-req" for="o-secteur">{{ $t('admin.objects.fSector') }}</label>
              <Select
                id="o-secteur"
                v-model="form.sectorId"
                :options="sectorOptions"
                option-label="label"
                option-value="value"
                :placeholder="form.museumId ? $t('admin.objects.fSectorPlaceholder') : $t('admin.objects.fSectorFirst')"
                :disabled="!form.museumId"
                :invalid="submitted && form.sectorId == null"
              />
            </div>
          </div>

          <div class="vi-row">
            <div class="vi-field">
              <label class="vi-req" for="o-nom">{{ $t('admin.objects.fName') }}</label>
              <InputText
                id="o-nom"
                v-model="form.nom"
                :placeholder="$t('admin.objects.fNamePlaceholder')"
                :invalid="submitted && !form.nom.trim()"
              />
            </div>
            <div class="vi-field">
              <label for="o-commun">{{ $t('admin.objects.fCommon') }}</label>
              <InputText
                id="o-commun"
                v-model="form.nomCommun"
                :placeholder="$t('admin.objects.fCommonPlaceholder')"
              />
            </div>
          </div>

          <div class="vi-row">
            <div class="vi-field">
              <label for="o-chef">{{ $t('admin.objects.fChef') }}</label>
              <Select
                id="o-chef"
                v-model="form.chefId"
                :options="chefOptions"
                option-label="label"
                option-value="value"
                show-clear
                filter
                :placeholder="$t('admin.objects.fChefPlaceholder')"
              />
            </div>
            <div class="vi-field" style="flex: 0 1 190px">
              <label for="o-chef-rel">{{ $t('admin.objects.fRelation') }}</label>
              <Select
                id="o-chef-rel"
                v-model="form.chefRelation"
                :options="OBJECT_CHEF_RELATIONS"
                :disabled="!form.chefId"
              />
            </div>
          </div>

          <div class="publish-row">
            <ToggleSwitch v-model="form.published" input-id="o-pub" />
            <label for="o-pub">
              <strong>{{ $t('admin.objects.fPublishTitle') }}</strong>
              <span>{{ $t('admin.objects.fPublishHint') }}</span>
            </label>
          </div>
        </TabPanel>

        <!-- DESCRIPTION + IA -->
        <TabPanel value="1">
          <div class="vi-field">
            <div class="desc-head">
              <label for="o-desc">{{ $t('admin.objects.fDescLabel') }}</label>
              <Button
                size="small"
                :loading="improving"
                icon="pi pi-sparkles"
                :label="$t('admin.objects.improveAI')"
                outlined
                @click="runImprove"
              />
            </div>
            <Textarea
              id="o-desc"
              v-model="form.description"
              rows="7"
              auto-resize
              :placeholder="$t('admin.objects.fDescPlaceholder')"
            />
            <small>
              {{ $t('admin.objects.descAIHint') }}
            </small>
          </div>
        </TabPanel>

        <!-- MÉDIAS + 3D -->
        <TabPanel value="2">
          <div class="vi-row">
            <div class="vi-field">
              <label>{{ $t('admin.objects.fPhoto') }}</label>
              <ImageUploader v-model="form.photo" bucket="photos" :label="$t('admin.objects.fPhotoUploader')" />
              <small>{{ $t('admin.objects.fPhotoHint') }}</small>
            </div>
            <div class="vi-field">
              <label>{{ $t('admin.objects.fModel3d') }}</label>
              <div class="model3d-box">
                <i class="pi pi-box" />
                <span v-if="form.model3dName" class="model3d-name">{{ form.model3dName }}</span>
                <span v-else class="model3d-empty">{{ $t('admin.objects.model3dEmpty') }}</span>
                <div class="model3d-actions">
                  <Button
                    size="small"
                    icon="pi pi-upload"
                    :label="form.model3d ? $t('admin.objects.model3dChange') : $t('admin.objects.model3dLoad')"
                    outlined
                    @click="model3dInput?.click()"
                  />
                  <Button
                    v-if="form.model3d"
                    size="small"
                    icon="pi pi-eye"
                    :label="$t('admin.objects.view3d')"
                    text
                    @click="preview3dVisible = true"
                  />
                </div>
                <input
                  ref="model3dInput"
                  type="file"
                  accept=".glb,.gltf,.usdz,model/gltf-binary,model/gltf+json,model/vnd.usdz+zip"
                  style="display: none"
                  @change="onModel3dFile"
                />
              </div>

              <!-- La conversion tient dans la page : on montre l'étape en cours
                   plutôt qu'un sablier muet, parce qu'un scan lourd occupe le
                   navigateur une seconde ou deux et qu'un bouton qui ne répond
                   pas se reclique. -->
              <p v-if="conversion" class="model3d-conv">
                <i class="pi pi-spin pi-spinner" />
                {{ $t('admin.objects.usdzStep_' + conversion) }}
              </p>
              <small v-else class="model3d-conv-hint">
                <i class="pi pi-apple" /> {{ $t('admin.objects.usdzAccepted') }}
              </small>

              <!-- Un modèle lourd se sert mieux par adresse web que stocké en base. -->
              <label class="model3d-url-lbl">{{ $t('admin.objects.model3dUrl') }}</label>
              <InputText v-model="form.model3d" placeholder="https://…/objet.glb" />
              <small>{{ $t('admin.objects.model3dUrlHint', { n: MODEL_MAX_MO }) }}</small>

              <Message
                v-if="form.model3d && String(form.model3d).startsWith('blob:')"
                severity="warn"
                :closable="false"
                class="model3d-legacy"
              >
                {{ $t('admin.objects.model3dLegacy') }}
              </Message>
            </div>
          </div>

          <!-- ============ Vues complémentaires ============
               Une pièce ne se donne pas dans une seule image : face, profil,
               revers, détail. La couverture ci-dessus sert les listes ; ces
               vues-ci sont montrées à côté de la notice sur le site public. -->
          <fieldset class="gal-set">
            <legend><i class="pi pi-images" /> {{ $t('admin.objects.galleryTitle') }}</legend>
            <p class="gal-intro">{{ $t('admin.objects.galleryIntro') }}</p>
            <GalleryUploader v-model="form.photos" bucket="photos" :max="8" />
          </fieldset>

          <!-- ============ Réalité augmentée ============ -->
          <fieldset class="ar-set">
            <legend><i class="pi pi-mobile" /> {{ $t('admin.objects.arTitle') }}</legend>
            <p class="ar-intro">{{ $t('admin.objects.arIntro') }}</p>

            <div class="vi-field">
              <label>{{ $t('admin.objects.arIosFile') }}</label>
              <div class="model3d-box">
                <i class="pi pi-apple" />
                <span v-if="form.model3dIosName" class="model3d-name">{{ form.model3dIosName }}</span>
                <span v-else class="model3d-empty">{{ $t('admin.objects.arIosEmpty') }}</span>
                <div class="model3d-actions">
                  <Button
                    size="small"
                    icon="pi pi-upload"
                    :label="form.model3dIos ? $t('admin.objects.model3dChange') : $t('admin.objects.model3dLoad')"
                    outlined
                    @click="model3dIosInput?.click()"
                  />
                </div>
                <input
                  ref="model3dIosInput"
                  type="file"
                  accept=".usdz,model/vnd.usdz+zip"
                  style="display: none"
                  @change="onModel3dIosFile"
                />
              </div>
              <InputText v-model="form.model3dIos" placeholder="https://…/objet.usdz" class="ar-url" />
              <small>{{ $t('admin.objects.arIosHint') }}</small>
            </div>

            <!-- Une architecture ne se manipule pas : voir le commentaire de
                 la migration 20260828_ar_seulement.sql. -->
            <div class="vi-field ar-seul">
              <div class="ar-seul__ligne">
                <ToggleSwitch v-model="form.arSeulement" input-id="ar-seul" />
                <label for="ar-seul">{{ $t('admin.objects.arOnly') }}</label>
              </div>
              <small>{{ $t('admin.objects.arOnlyHint') }}</small>
            </div>

            <div class="vi-row">
              <div class="vi-field">
                <label>{{ $t('admin.objects.arPlacement') }}</label>
                <Select v-model="form.arPlacement" :options="placementOptions" option-label="label" option-value="value" />
                <small>{{ $t('admin.objects.arPlacementHint') }}</small>
              </div>
              <div class="vi-field" style="flex: 0 1 190px">
                <label>{{ $t('admin.objects.arScale') }}</label>
                <InputNumber
                  v-model="form.arEchelle"
                  :min="0.001"
                  :max="1000"
                  :min-fraction-digits="0"
                  :max-fraction-digits="3"
                />
                <small>{{ $t('admin.objects.arScaleHint') }}</small>
              </div>
            </div>
          </fieldset>
        </TabPanel>

        <!-- SEO + IA -->
        <TabPanel value="3">
          <Message severity="secondary" :closable="false" class="seo-hint">
            {{ $t('admin.objects.seoHint') }}
          </Message>
          <div class="desc-head">
            <span></span>
            <Button
              size="small"
              :loading="generatingSeo"
              icon="pi pi-sparkles"
              :label="$t('admin.objects.generateSeoAI')"
              outlined
              @click="runSeo"
            />
          </div>
          <div class="vi-field">
            <label for="seo-title">{{ $t('admin.objects.metaTitle') }}</label>
            <InputText id="seo-title" v-model="form.seo.title" />
          </div>
          <div class="vi-field">
            <label for="seo-desc">{{ $t('admin.objects.metaDescription') }}</label>
            <Textarea id="seo-desc" v-model="form.seo.description" rows="3" auto-resize />
          </div>
          <div class="vi-row">
            <div class="vi-field">
              <label for="seo-slug">{{ $t('admin.objects.slug') }}</label>
              <InputText id="seo-slug" v-model="form.seo.slug" />
            </div>
            <div class="vi-field">
              <label for="seo-kw">{{ $t('admin.objects.keywords') }}</label>
              <InputText id="seo-kw" v-model="keywordsText" />
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text :disabled="saving" @click="close" />
      <Button
        :label="$t('admin.common.save')"
        icon="pi pi-check"
        :loading="saving"
        :disabled="saving"
        @click="save"
      />
    </template>

    <Object3DViewer
      v-model:visible="preview3dVisible"
      :src="form.model3d"
      :title="form.nom || $t('admin.objects.preview3dTitle')"
    />
  </Dialog>
</template>

<style scoped>
.ar-seul__ligne { display: flex; align-items: center; gap: .6rem; }
.ar-seul__ligne label { margin: 0; cursor: pointer; }
.ar-set { border: 1px solid var(--p-content-border-color); border-radius: 10px; padding: 0.9rem 1.1rem 1.1rem; margin-top: 1.2rem; }
.ar-set legend { padding: 0 0.5rem; font-weight: 700; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.4rem; }
.ar-set legend i { color: var(--gold, #cda24e); }
.ar-intro { margin: 0 0 0.9rem; font-size: 0.83rem; color: var(--vi-muted); line-height: 1.6; }
/* Les vues complementaires reprennent l'encadre de la RA : meme niveau dans
   l'onglet Medias, donc meme traitement visuel. */
.gal-set { border: 1px solid var(--p-content-border-color); border-radius: 10px; padding: 0.9rem 1.1rem 1.1rem; margin-top: 1.2rem; }
.gal-set legend { padding: 0 0.5rem; font-weight: 700; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.4rem; }
.gal-set legend i { color: var(--gold, #cda24e); }
.gal-intro { margin: 0 0 0.9rem; font-size: 0.83rem; color: var(--vi-muted); line-height: 1.6; }
.ar-url { margin-top: 0.5rem; }
.model3d-url-lbl { display: block; margin-top: 0.7rem; }
.model3d-legacy { margin-top: 0.6rem; }
/* Conversion USDZ : le témoin d'étape prend la place de l'indication, jamais
   l'inverse — deux lignes qui se remplacent ne font pas sauter la mise en page. */
.model3d-conv,
.model3d-conv-hint {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.45rem 0 0;
  min-height: 1.15rem;
  font-size: 0.78rem;
  line-height: 1.4;
}
.model3d-conv { color: var(--gold, #cda24e); }
.model3d-conv-hint { color: var(--vi-muted); }
.publish-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem;
  background: var(--vi-bg);
  border-radius: 12px;
  margin-top: 0.5rem;
}
.publish-row label {
  display: flex;
  flex-direction: column;
}
.publish-row label span {
  font-size: 0.78rem;
  color: var(--vi-muted);
}
.desc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.seo-hint {
  margin-bottom: 0.75rem;
}
.model3d-box {
  border: 2px dashed var(--vi-border);
  border-radius: 12px;
  padding: 1.2rem;
  text-align: center;
  background: var(--vi-bg);
}
.model3d-box > i {
  font-size: 2rem;
  color: var(--vi-muted);
  display: block;
  margin-bottom: 0.5rem;
}
.model3d-name {
  font-weight: 600;
  word-break: break-all;
}
.model3d-empty {
  color: var(--vi-muted);
  font-size: 0.85rem;
}
.model3d-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.8rem;
  flex-wrap: wrap;
}
</style>
