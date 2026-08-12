<script setup>
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import {
  campagnes, liensPhotos, deposerModele, cloturer, supprimerCampagne
} from '@/services/photogrammetryApi'

// SUIVI DES CAMPAGNES — le pont entre la prise de vue et le modèle fini.
//
// Le traitement est MANUEL et assumé comme tel : l'opérateur récupère les
// photos, reconstruit sur son poste (Meshroom, RealityCapture), puis redépose
// le modèle ici. C'est le seul chemin à coût nul, et il évite d'envoyer les
// images d'un patrimoine camerounais chez un prestataire tiers.
//
// Deux moyens de récupérer les photos, parce qu'aucun ne marche partout :
//   • le téléchargement séquentiel, simple mais que certains navigateurs
//     limitent au-delà de quelques fichiers ;
//   • un manifeste texte d'URL signées, à donner à `wget -i`. Moins joli,
//     mais fiable pour 50 fichiers et reprenable en cas de coupure.

const props = defineProps({
  objectId: { type: Number, required: true }
})

const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()

const liste = ref([])
const chargement = ref(true)
const occupe = ref(null)          // id de la campagne en cours de traitement
const entreeFichier = ref(null)
let cibleDepot = null             // { jobId, format }

async function charger() {
  chargement.value = true
  liste.value = await campagnes(props.objectId)
  chargement.value = false
}
onMounted(charger)

defineExpose({ charger })

const severite = (s) => ({
  capture: 'secondary', pret: 'info', en_cours: 'warn',
  termine: 'success', echec: 'danger'
}[s] || 'secondary')

const fmt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

// -------------------------------------------------- Récupérer les photos ---
async function telecharger(job) {
  occupe.value = job.id
  try {
    const liens = await liensPhotos(job.id)
    if (!liens.length) {
      toast.add({ severity: 'warn', summary: t('admin.scan.noPhotos'), life: 3000 })
      return
    }
    // Un délai entre deux déclenchements : sans lui, Chrome interrompt la série
    // au bout de quelques fichiers en la prenant pour un téléchargement abusif.
    for (const l of liens) {
      const a = document.createElement('a')
      a.href = l.url
      a.download = l.nom
      document.body.appendChild(a)
      a.click()
      a.remove()
      await new Promise((r) => setTimeout(r, 350))
    }
    toast.add({ severity: 'success', summary: t('admin.scan.downloading', { n: liens.length }), life: 4000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.scan.failed'), detail: e.message, life: 4000 })
  } finally {
    occupe.value = null
  }
}

// Repli fiable : un fichier texte d'URL, à passer à `wget -i liste.txt`.
async function manifeste(job) {
  occupe.value = job.id
  try {
    const liens = await liensPhotos(job.id)
    const texte = liens.map((l) => l.url).join('\n')
    const blob = new Blob([texte], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `campagne-${job.id}-photos.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Sans révocation, le blob reste en mémoire tant que l'onglet vit.
    URL.revokeObjectURL(url)
    toast.add({ severity: 'info', summary: t('admin.scan.manifestReady', { n: liens.length }), life: 5000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.scan.failed'), detail: e.message, life: 4000 })
  } finally {
    occupe.value = null
  }
}

// ---------------------------------------------------- Déposer le modèle ----
function choisirFichier(job, format) {
  cibleDepot = { jobId: job.id, format }
  entreeFichier.value.value = ''
  entreeFichier.value.click()
}

async function onFichier(e) {
  const f = e.target.files?.[0]
  if (!f || !cibleDepot) return
  const { jobId, format } = cibleDepot
  occupe.value = jobId
  try {
    await deposerModele(jobId, props.objectId, format, f)
    toast.add({ severity: 'success', summary: t('admin.scan.modelUploaded', { f: format.toUpperCase() }), life: 3500 })
    await charger()
  } catch (err) {
    toast.add({ severity: 'error', summary: t('admin.scan.uploadFailed'), detail: err.message, life: 6000 })
  } finally {
    occupe.value = null
    cibleDepot = null
  }
}

async function terminer(job) {
  const r = await cloturer(job.id)
  if (!r.ok) {
    // La base refuse « terminé » sans modèle : le message est ici pédagogique.
    toast.add({ severity: 'warn', summary: t('admin.scan.needModel'), life: 5000 })
    return
  }
  toast.add({ severity: 'success', summary: t('admin.scan.closed'), life: 2500 })
  charger()
}

function supprimer(job) {
  confirm.require({
    message: t('admin.scan.deleteConfirm', { n: job.nbPhotos }),
    header: t('admin.scan.confirm'), icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('admin.common.delete'),
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await supprimerCampagne(job.id)
        toast.add({ severity: 'info', summary: t('admin.scan.deleted'), life: 2500 })
        charger()
      } catch (e) {
        toast.add({ severity: 'error', summary: t('admin.scan.failed'), detail: e.message, life: 4000 })
      }
    }
  })
}

const aucune = computed(() => !chargement.value && !liste.value.length)
</script>

<template>
  <div v-if="!aucune" class="pj">
    <h3 class="pj__titre">{{ $t('admin.scan.jobsTitle') }}</h3>

    <div v-if="chargement" class="pj__vide"><i class="pi pi-spin pi-spinner" /></div>

    <article v-for="j in liste" :key="j.id" class="pj__item">
      <div class="pj__tete">
        <Tag :value="$t(`admin.scan.st_${j.statut}`)" :severity="severite(j.statut)" />
        <span class="pj__n">{{ $t('admin.scan.photoCount', { n: j.nbPhotos }) }}</span>
        <span class="pj__date">{{ fmt(j.createdAt) }}</span>
        <span class="pj__formats">{{ j.formats.join(' · ').toUpperCase() }}</span>
      </div>

      <Message v-if="j.erreur" severity="error" :closable="false" class="pj__err">{{ j.erreur }}</Message>

      <div class="pj__modeles" v-if="j.resultatGlb || j.resultatUsdz || j.resultatObj">
        <a v-if="j.resultatGlb" :href="j.resultatGlb" target="_blank" rel="noopener">GLB</a>
        <a v-if="j.resultatUsdz" :href="j.resultatUsdz" target="_blank" rel="noopener">USDZ</a>
        <a v-if="j.resultatObj" :href="j.resultatObj" target="_blank" rel="noopener">OBJ</a>
      </div>

      <div class="pj__actions">
        <Button :label="$t('admin.scan.download')" icon="pi pi-download" size="small" outlined
                :loading="occupe === j.id" @click="telecharger(j)" />
        <Button :label="$t('admin.scan.manifest')" icon="pi pi-list" size="small" text
                :loading="occupe === j.id" @click="manifeste(j)" />
        <Button label="GLB" icon="pi pi-upload" size="small" severity="secondary"
                :loading="occupe === j.id" @click="choisirFichier(j, 'glb')" />
        <Button label="USDZ" icon="pi pi-upload" size="small" severity="secondary"
                :loading="occupe === j.id" @click="choisirFichier(j, 'usdz')" />
        <Button v-if="j.statut !== 'termine'" :label="$t('admin.scan.close')" icon="pi pi-check"
                size="small" severity="success" text @click="terminer(j)" />
        <Button icon="pi pi-trash" size="small" text severity="danger"
                :aria-label="$t('admin.common.delete')" @click="supprimer(j)" />
      </div>
    </article>

    <p class="pj__aide">{{ $t('admin.scan.manualHint') }}</p>

    <!-- Une seule entrée fichier pour tous les dépôts : la cible est mémorisée
         au clic, ce qui évite d'en instancier une par bouton et par campagne. -->
    <input ref="entreeFichier" type="file" class="pj__input"
           accept=".glb,.usdz,.obj,model/gltf-binary" @change="onFichier" />
  </div>
</template>

<style scoped>
.pj { margin-top: 1.6rem; }
.pj__titre { font-size: 1rem; margin: 0 0 0.7rem; }
.pj__vide { padding: 1.2rem; text-align: center; color: var(--vi-muted, #6B7280); }

.pj__item {
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 0.6rem;
}
.pj__tete { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
.pj__n { font-weight: 600; font-variant-numeric: tabular-nums; }
.pj__date, .pj__formats { font-size: 0.78rem; color: var(--vi-muted, #6B7280); }
.pj__formats { margin-left: auto; letter-spacing: 0.04em; }
.pj__err { margin: 0.5rem 0 0; }

.pj__modeles { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.pj__modeles a {
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 14%, transparent);
  color: var(--p-primary-color, #0e6f5c); text-decoration: none;
}
.pj__modeles a:hover { text-decoration: underline; }

.pj__actions { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.6rem; }
.pj__aide { font-size: 0.78rem; color: var(--vi-muted, #6B7280); line-height: 1.5; margin: 0.6rem 0 0; }
.pj__input { display: none; }
</style>
