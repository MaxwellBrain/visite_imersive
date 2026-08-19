<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useObjectStore } from '@/stores/useObjectStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useGenealogyStore } from '@/stores/useGenealogyStore'
import { normalise } from '@/services/genealogy'
import GenealogyTree from '@/components/genealogy/GenealogyTree.vue'
import Object3DViewer from '@/components/objects/Object3DViewer.vue'
import SiblingsFinder from '@/components/objects/SiblingsFinder.vue'
import PhotogrammetryCapture from '@/components/objects/PhotogrammetryCapture.vue'
import PhotogrammetryJobs from '@/components/objects/PhotogrammetryJobs.vue'
import PhotogrammetryImport from '@/components/objects/PhotogrammetryImport.vue'
import FreresCabinet from '@/components/objects/FreresCabinet.vue'
import ShareCardDialog from '@/components/objects/ShareCardDialog.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const objectStore = useObjectStore()
const sectorStore = useSectorStore()
const museumStore = useMuseumStore()
const genealogy = useGenealogyStore()

const object = computed(() => objectStore.getById(Number(route.params.id)))
const sector = computed(() => (object.value ? sectorStore.getById(object.value.sectorId) : null))
const museum = computed(() => (sector.value ? museumStore.getById(sector.value.museumId) : null))
const lien = computed(() => (object.value ? genealogy.linkForObject(object.value.id) : null))
const chef = computed(() => (lien.value ? genealogy.getIndividu(lien.value.individuId) : null))
const personnes = computed(() => normalise(genealogy.individus))

const viewer = reactive({ visible: false })
const partage = reactive({ visible: false })
const scan = reactive({ visible: false })
const importScan = reactive({ visible: false })
// Permet de rafraîchir la liste des campagnes dès qu'une prise de vue s'achève,
// sans recharger toute la fiche.
const jobsRef = ref(null)
const lieu = computed(() => `${museum.value?.nom ?? '—'} › ${sector.value?.nom ?? '—'}`)

// La liste ne transporte plus les médias lourds : cette fiche les demande pour
// le seul objet consulté. Sans cela, la photo et le bouton 3D disparaîtraient.
watch(
  object,
  (o) => {
    if (o && o.photo === undefined) objectStore.chargerMedias(o.id).catch(() => {})
  },
  { immediate: true }
)
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ object ? object.nom : $t('admin.objectDetail.notFound') }}</h1>
        <p v-if="object" class="vi-page__subtitle">
          <i class="pi pi-sitemap" /> {{ museum?.nom ?? '—' }} › {{ sector?.nom ?? '—' }}
        </p>
      </div>
      <Button :label="$t('admin.objectDetail.back')" icon="pi pi-arrow-left" outlined @click="router.push('/objets')" />
    </div>

    <div v-if="object" class="fiche">
      <!-- OBJET (gauche) -->
      <section class="fiche__col">
        <div class="fiche__media">
          <img v-if="object.photo" :src="object.photo" :alt="object.nom" />
          <div v-else class="fiche__ph"><i class="pi pi-box" /></div>
          <Tag
            :value="object.published ? $t('admin.common.published') : $t('admin.common.draft')"
            :severity="object.published ? 'success' : 'warn'"
            class="fiche__status"
          />
        </div>
        <p v-if="object.nomCommun" class="fiche__common">{{ object.nomCommun }}</p>
        <p class="fiche__desc">{{ object.description || $t('admin.objectDetail.noDescription') }}</p>
        <div class="fiche__actions">
          <!-- Un USDZ seul mérite aussi le bouton : il ouvre Quick Look sur iPhone.
               Le gater sur model3d seul rendait la RA inaccessible aux objets
               numérisés à l'iPhone, dont c'est pourtant le format natif. -->
          <Button
            v-if="object.model3d || object.model3dIos"
            :label="$t('admin.objectDetail.view3d')"
            icon="pi pi-box"
            @click="viewer.visible = true"
          />
          <!-- Numériser : produit le modèle qui alimentera justement le bouton 3D ci-dessus. -->
          <Button
            :label="object.model3d ? $t('admin.objectDetail.rescan') : $t('admin.objectDetail.scan3d')"
            icon="pi pi-camera"
            :outlined="!!object.model3d"
            @click="scan.visible = true"
          />
          <!-- Second chemin : les photos ont déjà été prises avec l'appareil du musée. -->
          <Button
            :label="$t('admin.objectDetail.importPhotos')"
            icon="pi pi-images"
            outlined
            @click="importScan.visible = true"
          />
          <Button :label="$t('admin.objectDetail.editObject')" icon="pi pi-pencil" outlined @click="router.push('/objets')" />
          <!-- Annoncer la pièce là où le public est vraiment : WhatsApp. -->
          <Button :label="$t('share.action')" icon="pi pi-whatsapp" outlined @click="partage.visible = true" />
        </div>
      </section>

      <!-- CHEF + ARBRE (droite) -->
      <section class="fiche__col">
        <template v-if="chef">
          <div class="chef">
            <img v-if="chef.photo" :src="chef.photo" :alt="chef.nom" class="chef__img" />
            <div v-else class="chef__img chef__img--ph"><i class="pi pi-user" /></div>
            <div class="chef__info">
              <Tag v-if="lien" :value="$t('admin.objectDetail.objectRel', { rel: lien.relation })" severity="info" class="chef__rel" />
              <h2 class="chef__nom">{{ genealogy.nomComplet(chef) }}</h2>
              <p v-if="chef.titre" class="chef__titre">{{ chef.titre }}</p>
              <p class="chef__meta">
                <span v-if="genealogy.vieOf(chef)"><i class="pi pi-calendar" /> {{ genealogy.vieOf(chef) }}</span>
                <span v-if="chef.lieuOrigine"><i class="pi pi-map-marker" /> {{ chef.lieuOrigine }}</span>
              </p>
              <p v-if="chef.biographie" class="chef__bio">{{ chef.biographie }}</p>
            </div>
          </div>
          <h3 class="fiche__gentitle">{{ $t('admin.objectDetail.tree') }}</h3>
          <GenealogyTree :people="personnes" :focus-id="chef.id" :height="420" />
        </template>

        <div v-else class="vi-empty">
          <i class="pi pi-share-alt" />
          <p>{{ $t('admin.objectDetail.noChef') }}</p>
          <Button :label="$t('admin.objectDetail.linkChef')" icon="pi pi-link" outlined @click="router.push('/objets')" />
        </div>
      </section>
    </div>

    <!-- LE CABINET : la chaîne qui PERSISTE et qu'un humain valide.
         C'est elle qui alimente le site public. -->
    <FreresCabinet v-if="object" :objet="object" class="siblings" />

    <!-- Mémoire réunifiée : exploration à la volée, rien n'est enregistré.
         Reste utile pour dégrossir un objet dont on ignore encore la culture,
         avant de lancer le cabinet. -->
    <PhotogrammetryJobs v-if="object" ref="jobsRef" :object-id="object.id" />

    <SiblingsFinder v-if="object" :objet="object" class="siblings" />

    <div v-else class="vi-empty">
      <i class="pi pi-exclamation-triangle" />
      <p>{{ $t('admin.objectDetail.gone') }}</p>
      <Button :label="$t('admin.objectDetail.backToObjects')" icon="pi pi-arrow-left" @click="router.push('/objets')" />
    </div>

    <Object3DViewer
      v-model:visible="viewer.visible"
      :src="object?.model3d || ''"
      :ios-src="object?.model3dIos || ''"
      :title="object?.nom || $t('viewer3d.defaultTitle')"
    />

    <PhotogrammetryCapture
      v-if="object"
      v-model:visible="scan.visible"
      :object-id="object.id"
      :object-nom="object.nom"
      @termine="jobsRef?.charger()"
    />

    <PhotogrammetryImport
      v-if="object"
      v-model:visible="importScan.visible"
      :object-id="object.id"
      :object-nom="object.nom"
      @termine="jobsRef?.charger()"
    />
    <ShareCardDialog v-model:visible="partage.visible" :object="object" :lieu="lieu" />
  </div>
</template>

<style scoped>
.siblings { margin-top: 1.5rem; }
.fiche {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 1.5rem;
  align-items: start;
}
@media (max-width: 960px) {
  .fiche { grid-template-columns: 1fr; }
}
.fiche__col {
  background: var(--vi-surface);
  border: 1px solid var(--vi-border);
  border-radius: 16px;
  padding: 1.1rem 1.25rem 1.3rem;
  box-shadow: var(--vi-shadow-sm);
}
.fiche__media {
  position: relative;
  height: 260px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--vi-surface-2);
  margin-bottom: 0.9rem;
}
.fiche__media img { width: 100%; height: 100%; object-fit: cover; }
.fiche__ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--vi-muted); font-size: 3rem; }
.fiche__status { position: absolute; top: 0.7rem; left: 0.7rem; }
.fiche__common { margin: 0 0 0.5rem; font-style: italic; color: var(--vi-muted); }
.fiche__desc { margin: 0 0 1rem; line-height: 1.55; color: var(--vi-text); }
.fiche__actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

.chef { display: flex; gap: 1rem; margin-bottom: 1rem; }
.chef__img { width: 92px; height: 92px; border-radius: 12px; object-fit: cover; flex: 0 0 92px; }
.chef__img--ph { display: flex; align-items: center; justify-content: center; background: var(--vi-surface-2); color: var(--vi-muted); font-size: 2rem; }
.chef__info { min-width: 0; }
.chef__rel { margin-bottom: 0.3rem; }
.chef__nom { font-family: var(--vi-serif); margin: 0.15rem 0 0; font-size: 1.3rem; }
.chef__titre { margin: 0.1rem 0; color: var(--p-primary-color); font-style: italic; }
.chef__meta { display: flex; gap: 1rem; flex-wrap: wrap; color: var(--vi-muted); font-size: 0.82rem; margin: 0.3rem 0; }
.chef__meta i { margin-right: 0.25rem; }
.chef__bio { margin: 0.5rem 0 0; font-size: 0.9rem; line-height: 1.5; }
.fiche__gentitle { font-family: var(--vi-serif); font-weight: 600; font-size: 1.05rem; margin: 0.5rem 0 0.6rem; }
</style>
