<script setup>
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Slider from 'primevue/slider'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import {
  PLAN_ORBITES, TOTAL_VISE, FORMATS,
  creerCampagne, ajouterCliche, soumettre, repartition, mesurerNettete
} from '@/services/photogrammetryApi'

// CAPTURE GUIDÉE — numériser un objet en trois tours.
//
// LE PRINCIPE, tenu du terrain : la photogrammétrie ne demande pas du matériel,
// elle demande de la MÉTHODE. Trois orbites à des hauteurs différentes, un pas
// angulaire régulier, et surtout un recouvrement suffisant entre clichés
// voisins — c'est ce recouvrement qui permet au moteur de retrouver les
// positions de caméra. D'où le guidage explicite plutôt qu'un simple bouton.
//
// LE CONTRÔLE DE NETTETÉ N'EST PAS UN CONFORT. Une seule photo floue fausse
// l'appariement des points et peut faire échouer toute la campagne — après
// plusieurs minutes de calcul. On mesure donc à la prise de vue, quand refaire
// le cliché ne coûte qu'un geste.
//
// Le seuil dépend de l'appareil, de la lumière et de la matière : bois mat et
// perle brillante ne donnent pas les mêmes valeurs. On AFFICHE la mesure en
// direct et on laisse l'opérateur régler, plutôt que d'imposer un chiffre qui
// serait faux la moitié du temps.

const props = defineProps({
  visible: { type: Boolean, default: false },
  objectId: { type: Number, required: true },
  objectNom: { type: String, default: '' }
})
const emit = defineEmits(['update:visible', 'termine'])

const { t } = useI18n()
const toast = useToast()

const video = ref(null)
const flux = ref(null)
const camera = ref('idle')        // idle | demande | active | refusee | absente

const job = ref(null)
const formats = ref(['glb', 'usdz'])
const orbiteIdx = ref(0)
const comptes = ref({})           // { basse: n, mediane: n, haute: n }
const envoiEnCours = ref(false)
const soumission = ref(false)

const seuilNettete = ref(80)
const netteteLive = ref(0)
let boucleAnalyse = null

const orbite = computed(() => PLAN_ORBITES[orbiteIdx.value])
const prisesOrbite = computed(() => comptes.value[orbite.value?.cle] || 0)
const total = computed(() => Object.values(comptes.value).reduce((a, b) => a + b, 0))
const assezNet = computed(() => netteteLive.value >= seuilNettete.value)
const orbiteFinie = computed(() => prisesOrbite.value >= (orbite.value?.cible || 0))
const derniereOrbite = computed(() => orbiteIdx.value >= PLAN_ORBITES.length - 1)
const peutSoumettre = computed(() => total.value >= (job.value?.nbPhotosMin || 50))

const progression = computed(() =>
  Math.min(100, Math.round((total.value / TOTAL_VISE) * 100)))

// --------------------------------------------------------------- Caméra ----
async function ouvrirCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { camera.value = 'absente'; return }
  camera.value = 'demande'
  try {
    // `environment` demande la caméra arrière : sur un téléphone c'est celle
    // qu'on pointe vers l'objet. Une résolution élevée sert la reconstruction,
    // mais `ideal` laisse l'appareil se rabattre plutôt que d'échouer.
    flux.value = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      },
      audio: false
    })
    camera.value = 'active'
    await new Promise((r) => setTimeout(r, 0))
    if (video.value) {
      video.value.srcObject = flux.value
      await video.value.play().catch(() => {})
    }
    lancerAnalyse()
  } catch (e) {
    console.warn('[capture] camera', e.name)
    camera.value = e.name === 'NotAllowedError' ? 'refusee' : 'absente'
  }
}

function fermerCamera() {
  if (boucleAnalyse) { clearInterval(boucleAnalyse); boucleAnalyse = null }
  if (flux.value) {
    flux.value.getTracks().forEach((p) => p.stop())
    flux.value = null
  }
  if (video.value) video.value.srcObject = null
  camera.value = 'idle'
}

// Mesure continue, mais à cadence réduite : trois fois par seconde suffit à
// guider la main, et l'analyse pleine cadence chaufferait le téléphone pour rien.
function lancerAnalyse() {
  if (boucleAnalyse) clearInterval(boucleAnalyse)
  boucleAnalyse = setInterval(() => {
    const v = video.value
    if (!v || !v.videoWidth) return
    try {
      netteteLive.value = Math.round(mesurerNettete(v, v.videoWidth, v.videoHeight))
    } catch { /* une frame illisible ne doit pas casser la boucle */ }
  }, 330)
}

// --------------------------------------------------------------- Capture ---
async function demarrer() {
  try {
    job.value = await creerCampagne({ objectId: props.objectId, formats: formats.value })
    comptes.value = {}
    orbiteIdx.value = 0
    await ouvrirCamera()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.scan.failed'), detail: e.message, life: 4000 })
  }
}

async function capturer() {
  const v = video.value
  if (!v || !v.videoWidth || !job.value || envoiEnCours.value) return

  if (!assezNet.value) {
    toast.add({ severity: 'warn', summary: t('admin.scan.tooBlurry'), life: 2200 })
    return
  }

  envoiEnCours.value = true
  try {
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)

    // 0.92 : la compression JPEG agressive efface les micro-détails dont le
    // moteur se sert pour apparier les points. On privilégie la qualité.
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))
    if (!blob) throw new Error('capture_impossible')

    const cle = orbite.value.cle
    const indice = (comptes.value[cle] || 0) + 1
    await ajouterCliche(job.value.id, {
      blob, orbite: cle, indice,
      nettete: netteteLive.value, largeur: c.width, hauteur: c.height
    })
    comptes.value = { ...comptes.value, [cle]: indice }
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.scan.shotFailed'), detail: e.message, life: 4000 })
  } finally {
    envoiEnCours.value = false
  }
}

function orbiteSuivante() {
  if (!derniereOrbite.value) orbiteIdx.value++
}

async function terminer() {
  soumission.value = true
  // La base fait foi sur le nombre reçu : on resynchronise avant de soumettre,
  // un téléversement ayant pu échouer sans que l'écran le reflète.
  comptes.value = await repartition(job.value.id)
  const r = await soumettre(job.value.id)
  soumission.value = false

  if (!r.ok) {
    toast.add({ severity: 'warn', summary: t('admin.scan.notEnough'), detail: r.error, life: 6000 })
    return
  }
  toast.add({ severity: 'success', summary: t('admin.scan.queued', { n: r.nb_photos }), life: 4000 })
  fermerCamera()
  emit('termine', job.value.id)
  emit('update:visible', false)
}

function fermer() {
  fermerCamera()
  emit('update:visible', false)
}

watch(() => props.visible, (v) => { if (!v) fermerCamera() })
onBeforeUnmount(fermerCamera)
</script>

<template>
  <Dialog :visible="visible" modal :style="{ width: '46rem', maxWidth: '96vw' }"
          :header="$t('admin.scan.title', { nom: objectNom })"
          @update:visible="fermer">

    <!-- ÉTAPE 1 — réglages, avant d'allumer la caméra -->
    <template v-if="!job">
      <p class="sc-lead">{{ $t('admin.scan.intro', { n: TOTAL_VISE }) }}</p>

      <div class="sc-plan">
        <div v-for="o in PLAN_ORBITES" :key="o.cle" class="sc-plan__item">
          <span class="sc-plan__elev">{{ o.elevation }}</span>
          <strong>{{ $t(`admin.scan.orbit_${o.cle}`) }}</strong>
          <span class="sc-plan__n">{{ $t('admin.scan.shots', { n: o.cible }) }}</span>
        </div>
      </div>

      <h4 class="sc-h4">{{ $t('admin.scan.formats') }}</h4>
      <div class="sc-formats">
        <label v-for="f in FORMATS" :key="f.cle" class="sc-format">
          <input type="checkbox" :value="f.cle" v-model="formats" />
          <span>
            <strong>{{ f.label }}</strong>
            <small>{{ f.note }}</small>
          </span>
        </label>
      </div>

      <Message severity="info" :closable="false" class="sc-note">
        {{ $t('admin.scan.methodNote') }}
      </Message>
    </template>

    <!-- ÉTAPE 2 — prise de vue -->
    <template v-else>
      <div class="sc-etat">
        <div class="sc-etat__barre">
          <span :style="{ width: `${progression}%` }" />
        </div>
        <span class="sc-etat__txt">
          {{ $t('admin.scan.progress', { n: total, t: TOTAL_VISE }) }}
        </span>
      </div>

      <div class="sc-orbite">
        <Tag :value="$t(`admin.scan.orbit_${orbite.cle}`)" severity="contrast" />
        <span class="sc-orbite__elev">{{ orbite.elevation }}</span>
        <span class="sc-orbite__n">{{ prisesOrbite }} / {{ orbite.cible }}</span>
      </div>
      <p class="sc-consigne">{{ $t(`admin.scan.hint_${orbite.cle}`) }}</p>

      <div class="sc-scene">
        <video v-show="camera === 'active'" ref="video" playsinline muted class="sc-video" />

        <div v-if="camera === 'active'" class="sc-hud" :class="{ 'is-flou': !assezNet }">
          <span class="sc-hud__pastille" />
          {{ assezNet ? $t('admin.scan.sharp') : $t('admin.scan.blurry') }}
          <small>{{ netteteLive }}</small>
        </div>

        <div v-if="camera === 'refusee'" class="sc-vide">
          <i class="pi pi-video" />
          <strong>{{ $t('admin.scan.denied') }}</strong>
          <p>{{ $t('admin.scan.deniedHint') }}</p>
        </div>
        <div v-else-if="camera === 'absente'" class="sc-vide">
          <i class="pi pi-exclamation-triangle" />
          <strong>{{ $t('admin.scan.noCamera') }}</strong>
          <p>{{ $t('admin.scan.noCameraHint') }}</p>
        </div>
        <div v-else-if="camera === 'demande'" class="sc-vide">
          <i class="pi pi-spin pi-spinner" />
          <p>{{ $t('admin.scan.asking') }}</p>
        </div>
      </div>

      <div class="sc-seuil">
        <label>
          <span>{{ $t('admin.scan.threshold', { n: seuilNettete }) }}</span>
          <Slider v-model="seuilNettete" :min="10" :max="300" />
        </label>
        <small class="sc-seuil__aide">{{ $t('admin.scan.thresholdHint') }}</small>
      </div>
    </template>

    <template #footer>
      <template v-if="!job">
        <Button :label="$t('admin.common.cancel')" text @click="fermer" />
        <Button :label="$t('admin.scan.start')" icon="pi pi-camera"
                :disabled="!formats.length" @click="demarrer" />
      </template>
      <template v-else>
        <Button :label="$t('admin.common.cancel')" text @click="fermer" />
        <Button v-if="!derniereOrbite" :label="$t('admin.scan.nextOrbit')" icon="pi pi-arrow-right"
                :severity="orbiteFinie ? 'primary' : 'secondary'"
                :outlined="!orbiteFinie" @click="orbiteSuivante" />
        <Button :label="$t('admin.scan.shoot')" icon="pi pi-camera"
                :disabled="camera !== 'active' || envoiEnCours"
                :loading="envoiEnCours" @click="capturer" />
        <Button :label="$t('admin.scan.finish')" icon="pi pi-check" severity="success"
                :disabled="!peutSoumettre" :loading="soumission" @click="terminer" />
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.sc-lead { color: var(--vi-muted, #6B7280); line-height: 1.55; margin: 0 0 1rem; }
.sc-h4 { margin: 1.2rem 0 0.5rem; font-size: 0.95rem; }
.sc-note { margin-top: 1rem; }

.sc-plan { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.7rem; }
.sc-plan__item {
  border: 1px solid var(--p-content-border-color, #e5e7eb); border-radius: 10px;
  padding: 0.7rem 0.8rem; display: flex; flex-direction: column; gap: 0.15rem;
}
.sc-plan__elev { font-size: 0.72rem; color: var(--vi-muted, #6B7280); font-variant-numeric: tabular-nums; }
.sc-plan__n { font-size: 0.78rem; color: var(--vi-muted, #6B7280); }

.sc-formats { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.5rem; }
.sc-format { display: flex; align-items: flex-start; gap: 0.5rem; cursor: pointer; padding: 0.5rem 0.6rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb); border-radius: 8px; }
.sc-format span { display: flex; flex-direction: column; }
.sc-format small { color: var(--vi-muted, #6B7280); font-size: 0.74rem; }

.sc-etat { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.8rem; }
.sc-etat__barre { flex: 1; height: 8px; border-radius: 999px; background: var(--p-surface-200, #e5e7eb); overflow: hidden; }
.sc-etat__barre span { display: block; height: 100%; background: var(--p-primary-color, #0e6f5c); transition: width 0.2s; }
.sc-etat__txt { font-size: 0.82rem; color: var(--vi-muted, #6B7280); white-space: nowrap; font-variant-numeric: tabular-nums; }

.sc-orbite { display: flex; align-items: center; gap: 0.6rem; }
.sc-orbite__elev { font-size: 0.8rem; color: var(--vi-muted, #6B7280); font-variant-numeric: tabular-nums; }
.sc-orbite__n { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.sc-consigne { margin: 0.4rem 0 0.8rem; font-size: 0.86rem; color: var(--vi-muted, #6B7280); line-height: 1.5; }

.sc-scene { position: relative; background: #0d0f0d; border-radius: 12px; overflow: hidden; min-height: 16rem;
  display: flex; align-items: center; justify-content: center; }
.sc-video { width: 100%; max-height: 26rem; object-fit: contain; display: block; }

.sc-hud {
  position: absolute; left: 0.7rem; bottom: 0.7rem;
  display: inline-flex; align-items: center; gap: 0.45rem;
  background: rgba(0, 0, 0, 0.62); color: #fff; padding: 0.3rem 0.7rem;
  border-radius: 999px; font-size: 0.8rem;
}
.sc-hud small { opacity: 0.7; font-variant-numeric: tabular-nums; }
.sc-hud__pastille { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; }
.sc-hud.is-flou .sc-hud__pastille { background: #f97316; }

.sc-vide { color: #cbd0ca; text-align: center; padding: 2.5rem 1.5rem; }
.sc-vide i { font-size: 2.2rem; }
.sc-vide strong { display: block; margin: 0.6rem 0 0.3rem; color: #fff; }
.sc-vide p { margin: 0; font-size: 0.85rem; }

.sc-seuil { margin-top: 0.9rem; }
.sc-seuil label { display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.8rem; color: var(--vi-muted, #6B7280); }
.sc-seuil__aide { display: block; margin-top: 0.45rem; color: var(--vi-muted, #6B7280); font-size: 0.74rem; line-height: 1.45; }
</style>
