<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Slider from 'primevue/slider'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import { useToast } from 'primevue/usetoast'
import {
  PLAN_ORBITES, FORMATS,
  creerCampagne, ajouterCliche, soumettre, mesurerNettete
} from '@/services/photogrammetryApi'

// IMPORT DE PHOTOS EXISTANTES.
//
// Complète la capture en direct plutôt qu'elle ne la remplace : sur le terrain,
// un agent photographie souvent avec l'appareil du musée — reflex ou téléphone —
// puis revient au bureau avec une carte mémoire. Lui demander de tout refaire
// devant le navigateur serait absurde.
//
// LA VÉRIFICATION EST LE CŒUR DE CET ÉCRAN. Un lot importé n'a bénéficié
// d'aucun garde-fou au moment du déclenchement : personne n'a vu le voyant de
// netteté. On mesure donc APRÈS COUP, photo par photo, et on montre le verdict
// avant de téléverser quoi que ce soit. Découvrir qu'un tiers du lot est flou
// après une heure de calcul est le pire scénario.
//
// RÉPARTITION EN ORBITES : on suit l'ORDRE DES FICHIERS. Un opérateur tourne
// autour de l'objet tour par tour, donc les noms se suivent (IMG_001…IMG_056).
// Découper en trois tiers reconstitue les trois hauteurs sans rien demander.
// L'ordre est ajustable si le lot a été trié autrement.

const props = defineProps({
  visible: { type: Boolean, default: false },
  objectId: { type: Number, required: true },
  objectNom: { type: String, default: '' }
})
const emit = defineEmits(['update:visible', 'termine'])

const { t } = useI18n()
const toast = useToast()

const entree = ref(null)
const photos = ref([])            // { fichier, nom, nettete, largeur, hauteur, garder, orbite }
const analyse = ref(false)
const progression = ref(0)
const envoi = ref(false)
const formats = ref(['glb', 'usdz'])
// Plus haut que celui de la capture en direct (80), et ce n'est pas un caprice :
// mesuré sur ce projet, un même damier flouté donne 54 en canvas brut mais 82
// une fois encodé en JPEG. La compression réintroduit des artefacts haute
// fréquence qui gonflent la variance du laplacien. Un fichier importé est
// TOUJOURS déjà compressé, contrairement à une frame lue en direct — appliquer
// le même seuil laisserait donc passer des photos franchement floues.
const seuil = ref(120)

// Sous cette résolution, le moteur manque de points saillants pour apparier
// deux vues. La plupart des téléphones dépassent largement ce seuil ; il attrape
// surtout les images déjà redimensionnées pour le web ou reçues par messagerie.
const LARGEUR_MIN = 1024

const total = computed(() => photos.value.length)
const retenues = computed(() => photos.value.filter((p) => p.garder))
const floues = computed(() => photos.value.filter((p) => p.nettete < seuil.value).length)
const petites = computed(() => photos.value.filter((p) => Math.max(p.largeur, p.hauteur) < LARGEUR_MIN).length)
const minRequis = 50
const assez = computed(() => retenues.value.length >= minRequis)

const repartitionPrevue = computed(() => {
  const n = retenues.value.length
  if (!n) return []
  const poids = PLAN_ORBITES.reduce((s, o) => s + o.cible, 0)
  return PLAN_ORBITES.map((o) => ({
    cle: o.cle,
    n: Math.max(1, Math.round((o.cible / poids) * n))
  }))
})

function ouvrirSelecteur() {
  entree.value.value = ''
  entree.value.click()
}

// Lit un fichier image et en mesure la netteté. On passe par createImageBitmap
// quand il existe : c'est nettement plus rapide qu'un <img> pour 50 fichiers,
// et cela évite d'attendre un cycle de rendu par photo.
async function mesurer(fichier) {
  const bitmap = await creerBitmap(fichier)
  const nettete = Math.round(mesurerNettete(bitmap, bitmap.width, bitmap.height))
  const r = { largeur: bitmap.width, hauteur: bitmap.height, nettete }
  if (bitmap.close) bitmap.close()
  return r
}

function creerBitmap(fichier) {
  if (window.createImageBitmap) return createImageBitmap(fichier)
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(fichier)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_illisible')) }
    img.src = url
  })
}

async function onFichiers(e) {
  const fichiers = [...(e.target.files || [])]
    .filter((f) => f.type.startsWith('image/'))
    // L'ordre des noms reconstitue l'ordre de prise de vue : c'est lui qui
    // permet de retrouver les trois tours.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  if (!fichiers.length) return

  analyse.value = true
  progression.value = 0
  const lot = []

  for (let i = 0; i < fichiers.length; i++) {
    const f = fichiers[i]
    try {
      const m = await mesurer(f)
      lot.push({ fichier: f, nom: f.name, ...m, garder: true })
    } catch {
      // Une image illisible est signalée, pas silencieusement écartée.
      lot.push({ fichier: f, nom: f.name, largeur: 0, hauteur: 0, nettete: 0, garder: false })
    }
    progression.value = Math.round(((i + 1) / fichiers.length) * 100)
  }

  photos.value = lot
  analyse.value = false
  appliquerSeuil()
}

// Décoche ce qui est sous le seuil ou trop petit. L'opérateur peut recocher :
// une photo un peu molle mais qui montre une face unique vaut parfois mieux
// qu'un trou dans le maillage.
function appliquerSeuil() {
  photos.value = photos.value.map((p) => ({
    ...p,
    garder: p.nettete >= seuil.value && Math.max(p.largeur, p.hauteur) >= LARGEUR_MIN
  }))
}

function basculer(p) {
  p.garder = !p.garder
}

async function importer() {
  envoi.value = true
  progression.value = 0
  let job = null
  try {
    job = await creerCampagne({ objectId: props.objectId, formats: formats.value })

    // Répartition par tiers, dans l'ordre des fichiers.
    const liste = retenues.value
    const plan = repartitionPrevue.value
    let curseur = 0
    const parOrbite = {}
    for (const o of plan) {
      parOrbite[o.cle] = liste.slice(curseur, curseur + o.n)
      curseur += o.n
    }
    // Le reliquat d'arrondi rejoint le dernier tour plutôt que d'être perdu.
    if (curseur < liste.length) {
      const derniere = plan[plan.length - 1].cle
      parOrbite[derniere] = [...parOrbite[derniere], ...liste.slice(curseur)]
    }

    let faits = 0
    for (const [orbite, groupe] of Object.entries(parOrbite)) {
      for (let i = 0; i < groupe.length; i++) {
        const p = groupe[i]
        await ajouterCliche(job.id, {
          blob: p.fichier, orbite, indice: i + 1,
          nettete: p.nettete, largeur: p.largeur, hauteur: p.hauteur
        })
        faits++
        progression.value = Math.round((faits / liste.length) * 100)
      }
    }

    const r = await soumettre(job.id)
    if (!r.ok) {
      toast.add({ severity: 'warn', summary: t('admin.scan.notEnough'), detail: r.error, life: 6000 })
    } else {
      toast.add({ severity: 'success', summary: t('admin.scan.queued', { n: r.nb_photos }), life: 4000 })
      emit('termine', job.id)
      fermer()
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.scan.importFailed'), detail: e.message, life: 6000 })
  } finally {
    envoi.value = false
  }
}

function fermer() {
  photos.value = []
  progression.value = 0
  emit('update:visible', false)
}
</script>

<template>
  <Dialog :visible="visible" modal :style="{ width: '52rem', maxWidth: '96vw' }"
          :header="$t('admin.scan.importTitle', { nom: objectNom })"
          @update:visible="fermer">

    <p class="im-lead">{{ $t('admin.scan.importLead', { n: minRequis }) }}</p>

    <div v-if="!total" class="im-depot">
      <i class="pi pi-images" />
      <strong>{{ $t('admin.scan.pickFiles') }}</strong>
      <p>{{ $t('admin.scan.pickHint') }}</p>
      <Button :label="$t('admin.scan.browse')" icon="pi pi-folder-open" @click="ouvrirSelecteur" />
    </div>

    <template v-else>
      <!-- Bilan du lot -->
      <div class="vi-stats im-bilan">
        <div class="vi-stat">
          <span class="vi-stat__label">{{ $t('admin.scan.imported') }}</span><strong>{{ total }}</strong>
        </div>
        <div class="vi-stat">
          <span class="vi-stat__label">{{ $t('admin.scan.kept') }}</span>
          <strong :class="assez ? 'im-ok' : 'im-ko'">{{ retenues.length }}</strong>
        </div>
        <div class="vi-stat">
          <span class="vi-stat__label">{{ $t('admin.scan.blurryCount') }}</span><strong>{{ floues }}</strong>
        </div>
        <div class="vi-stat">
          <span class="vi-stat__label">{{ $t('admin.scan.smallCount') }}</span><strong>{{ petites }}</strong>
        </div>
      </div>

      <Message v-if="!assez" severity="warn" :closable="false" class="im-msg">
        {{ $t('admin.scan.needMore', { n: minRequis - retenues.length }) }}
      </Message>
      <Message v-else severity="success" :closable="false" class="im-msg">
        {{ $t('admin.scan.readyToSend', { n: retenues.length }) }}
      </Message>

      <div class="im-seuil">
        <label>
          <span>{{ $t('admin.scan.threshold', { n: seuil }) }}</span>
          <Slider v-model="seuil" :min="10" :max="300" @change="appliquerSeuil" />
        </label>
        <small>{{ $t('admin.scan.thresholdHint') }}</small>
      </div>

      <div class="im-repartition" v-if="retenues.length">
        <span v-for="o in repartitionPrevue" :key="o.cle">
          <Tag :value="$t(`admin.scan.orbit_${o.cle}`)" severity="secondary" /> {{ o.n }}
        </span>
      </div>

      <div class="im-grille">
        <button v-for="p in photos" :key="p.nom" type="button"
                class="im-vignette" :class="{ 'is-hors': !p.garder }"
                :title="p.nom" @click="basculer(p)">
          <span class="im-vignette__nom">{{ p.nom }}</span>
          <span class="im-vignette__meta">
            {{ p.largeur }}×{{ p.hauteur }} · {{ p.nettete }}
          </span>
          <i :class="p.garder ? 'pi pi-check-circle' : 'pi pi-times-circle'" />
        </button>
      </div>

      <ProgressBar v-if="envoi || analyse" :value="progression" class="im-progres" />
    </template>

    <input ref="entree" type="file" multiple accept="image/*" class="im-input" @change="onFichiers" />

    <template #footer>
      <Button :label="$t('admin.common.cancel')" text @click="fermer" />
      <Button v-if="total" :label="$t('admin.scan.addMore')" icon="pi pi-plus" outlined
              :disabled="analyse || envoi" @click="ouvrirSelecteur" />
      <Button v-if="total" :label="$t('admin.scan.sendImport', { n: retenues.length })"
              icon="pi pi-upload" :disabled="!assez || envoi || analyse"
              :loading="envoi" @click="importer" />
    </template>
  </Dialog>
</template>

<style scoped>
.im-lead { color: var(--vi-muted, #6B7280); line-height: 1.55; margin: 0 0 1rem; }

.im-depot {
  border: 2px dashed var(--p-content-border-color, #d1d5db); border-radius: 14px;
  padding: 2.4rem 1.5rem; text-align: center; color: var(--vi-muted, #6B7280);
}
.im-depot i { font-size: 2.4rem; }
.im-depot strong { display: block; margin: 0.7rem 0 0.3rem; color: inherit; font-size: 1.02rem; }
.im-depot p { margin: 0 0 1.1rem; font-size: 0.86rem; }

.im-bilan { margin-bottom: 0.8rem; }
.im-ok { color: var(--p-green-600, #16a34a); }
.im-ko { color: var(--p-orange-600, #ea580c); }
.im-msg { margin: 0 0 0.8rem; }

.im-seuil label { display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.8rem; color: var(--vi-muted, #6B7280); }
.im-seuil small { display: block; margin-top: 0.45rem; color: var(--vi-muted, #6B7280); font-size: 0.74rem; line-height: 1.45; }

.im-repartition { display: flex; gap: 0.9rem; flex-wrap: wrap; margin: 0.9rem 0 0.5rem; font-size: 0.82rem; }

.im-grille {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.45rem; max-height: 18rem; overflow-y: auto; margin-top: 0.6rem;
  padding: 0.2rem;
}
.im-vignette {
  position: relative; text-align: left; cursor: pointer; font: inherit;
  border: 1px solid var(--p-content-border-color, #e5e7eb); border-radius: 8px;
  background: var(--p-content-background, #fff); padding: 0.45rem 1.7rem 0.45rem 0.55rem;
  display: flex; flex-direction: column; gap: 0.1rem; color: inherit;
}
.im-vignette.is-hors { opacity: 0.45; border-style: dashed; }
.im-vignette__nom { font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.im-vignette__meta { font-size: 0.7rem; color: var(--vi-muted, #6B7280); font-variant-numeric: tabular-nums; }
.im-vignette i { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); font-size: 0.9rem; }
.im-vignette .pi-check-circle { color: var(--p-green-500, #22c55e); }
.im-vignette .pi-times-circle { color: var(--p-surface-400, #9ca3af); }

.im-progres { margin-top: 0.9rem; }
.im-input { display: none; }
</style>
