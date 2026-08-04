<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useObjectStore } from '@/stores/useObjectStore'
import { annonceObjet } from '@/services/aiService'
import {
  carteObjet, lienPublicObjet, lienWhatsApp, telecharger, partagerFichier
} from '@/services/carte'

// PARTAGER UNE ŒUVRE SUR WHATSAPP.
//
// Le conservateur ne veut pas « exporter un visuel » : il veut annoncer sa
// nouvelle pièce à ses contacts. L'écran suit donc cet ordre — je vois la carte,
// je relis le message, j'envoie — et non l'ordre des fichiers.
//
// Deux chemins d'envoi, et c'est volontaire :
//  · Partage natif (téléphone) : envoie l'IMAGE. C'est le vrai usage.
//  · wa.me (ordinateur) : n'accepte QUE du texte. On télécharge donc la carte
//    d'abord, et l'utilisateur la joint lui-même. Le dire est plus honnête que
//    de laisser croire à un envoi qui n'aura pas lieu.

const props = defineProps({
  visible: { type: Boolean, default: false },
  object: { type: Object, default: null },
  lieu: { type: String, default: '' }
})
const emit = defineEmits(['update:visible'])

const { t } = useI18n()
const toast = useToast()
const auth = useAuthStore()
const settings = useSettingsStore()
const objectStore = useObjectStore()

const carte = ref('')
const texte = ref('')
const parIa = ref(false)
const enCours = ref(false)
const enRedaction = ref(false)
const sansQr = ref(false)
const sansPhoto = ref(false)

const lien = computed(() => (props.object ? lienPublicObjet(props.object.id, auth.tenant) : ''))
const marque = computed(() => settings.settings?.marque || settings.settings?.nomEntite || '')
const couleur = computed(() => settings.settings?.couleurPrimaire || '#0e6f5c')
const nomFichier = computed(() => {
  const base = (props.object?.nom || 'oeuvre')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base || 'oeuvre'}-musea.png`
})

// Le message complet = le texte rédigé + le lien. On ne demande pas le lien à
// l'IA : elle le déformerait tôt ou tard, et une URL fausse tue le partage.
const messageComplet = computed(() => `${texte.value.trim()}\n\n${lien.value}`)

// Mémorise l'œuvre affichée : changer d'œuvre doit REMETTRE À ZÉRO le message.
// Sans cela, on ouvre le trône, puis le masque, et on envoie à ses contacts le
// texte du trône avec la photo du masque.
const objetAffiche = ref(null)

watch(() => props.visible, (ouvert) => { if (ouvert) preparer() })

async function preparer() {
  if (!props.object) return
  if (objetAffiche.value !== props.object.id) {
    texte.value = ''
    parIa.value = false
    objetAffiche.value = props.object.id
  }
  enCours.value = true
  carte.value = ''
  try {
    if (!settings.settings) await settings.load()

    // La liste de l'ERP ne transporte que la vignette de 240 px : suffisante
    // pour un tableau, ridicule dans une carte de 1080. On demande la vraie
    // photo, une seule fois, au moment où on en a besoin.
    //
    // On interroge le STORE et non la prop : `chargerMedias` remplace l'objet
    // dans la liste, la prop garde donc l'ancienne référence sans photo et on
    // redemanderait la même image à chaque ouverture.
    if (objectStore.getById(props.object.id)?.photo === undefined) {
      await objectStore.chargerMedias(props.object.id).catch(() => {})
    }
    const o = objectStore.getById(props.object.id) || props.object

    const r = await carteObjet({
      nom: o.nom,
      nomCommun: o.nomCommun,
      photo: o.photo || o.photoThumb || '',
      lieu: props.lieu,
      marque: marque.value,
      couleur: couleur.value,
      lien: lien.value,
      has3d: !!(o.model3d || o.model3dName)
    })
    carte.value = r.dataUrl
    sansQr.value = !r.avecQr
    sansPhoto.value = !r.avecPhoto && !!(o.photo || o.photoThumb)
  } finally {
    enCours.value = false
  }
  if (!texte.value) rediger()
}

async function rediger() {
  if (!props.object) return
  enRedaction.value = true
  try {
    const o = objectStore.getById(props.object.id) || props.object
    const r = await annonceObjet({
      nom: o.nom,
      description: o.description,
      lieu: props.lieu,
      marque: marque.value,
      has3d: !!(o.model3d || o.model3dName)
    })
    texte.value = r.texte
    parIa.value = r.parIa
  } finally {
    enRedaction.value = false
  }
}

function telechargerCarte() {
  if (!carte.value) return
  telecharger(carte.value, nomFichier.value)
  toast.add({ severity: 'success', summary: t('share.downloaded'), life: 2200 })
}

async function partager() {
  // Sur téléphone : l'image part avec le texte, en un geste.
  const ok = await partagerFichier(carte.value, nomFichier.value, props.object?.nom || '', messageComplet.value)
  if (ok) return
  // Sur ordinateur : wa.me ne sait pas joindre de fichier. On enregistre la
  // carte, puis on ouvre WhatsApp avec le texte — et on l'explique.
  if (carte.value) telecharger(carte.value, nomFichier.value)
  window.open(lienWhatsApp(messageComplet.value), '_blank', 'noopener')
  toast.add({ severity: 'info', summary: t('share.attachHint'), life: 5000 })
}

async function copier() {
  try {
    await navigator.clipboard.writeText(messageComplet.value)
    toast.add({ severity: 'success', summary: t('share.copied'), life: 2000 })
  } catch {
    toast.add({ severity: 'warn', summary: t('share.copyFailed'), life: 3000 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="$t('share.title')"
    :style="{ width: '58rem', maxWidth: '96vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="sc">
      <!-- L'aperçu d'abord : c'est ce qui donne confiance avant d'envoyer -->
      <div class="sc__apercu">
        <div v-if="enCours" class="sc__attente"><i class="pi pi-spin pi-spinner" /></div>
        <img v-else-if="carte" :src="carte" :alt="$t('share.previewAlt')" />
        <div v-else class="sc__attente"><i class="pi pi-image" /></div>
      </div>

      <div class="sc__col">
        <p class="sc__intro">{{ $t('share.intro') }}</p>

        <label class="sc__label" for="sc-texte">
          {{ $t('share.messageLabel') }}
          <span v-if="parIa" class="sc__ia"><i class="pi pi-sparkles" /> {{ $t('share.byAi') }}</span>
        </label>
        <Textarea id="sc-texte" v-model="texte" rows="5" autoResize class="sc__ta" />

        <div class="sc__ligne">
          <Button
            :label="$t('share.rewrite')" icon="pi pi-refresh" severity="secondary" outlined size="small"
            :loading="enRedaction" @click="rediger"
          />
          <span class="sc__compte">{{ texte.length }} {{ $t('share.chars') }}</span>
        </div>

        <p v-if="!parIa && texte && !enRedaction" class="sc__avert">
          <i class="pi pi-info-circle" /> {{ $t('share.noAi') }}
        </p>

        <div class="sc__lien">
          <i class="pi pi-link" />
          <span>{{ lien }}</span>
        </div>

        <Message v-if="sansQr" severity="warn" :closable="false" class="sc__msg">{{ $t('share.noQr') }}</Message>
        <Message v-if="sansPhoto" severity="warn" :closable="false" class="sc__msg">{{ $t('share.noPhoto') }}</Message>

        <div class="sc__actions">
          <Button :label="$t('share.send')" icon="pi pi-whatsapp" :disabled="!carte" @click="partager" />
          <Button :label="$t('share.download')" icon="pi pi-download" outlined :disabled="!carte" @click="telechargerCarte" />
          <Button :label="$t('share.copy')" icon="pi pi-copy" text @click="copier" />
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.sc { display: grid; grid-template-columns: 300px 1fr; gap: 1.5rem; align-items: start; }
@media (max-width: 720px) { .sc { grid-template-columns: 1fr; } }

.sc__apercu {
  aspect-ratio: 1; border-radius: 14px; overflow: hidden;
  background: #0E1211; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--vi-border, #E9EDF2);
}
.sc__apercu img { width: 100%; height: 100%; object-fit: contain; display: block; }
.sc__attente { color: rgba(255,255,255,0.4); font-size: 2rem; }

.sc__col { display: flex; flex-direction: column; gap: 0.6rem; min-width: 0; }
.sc__intro { margin: 0; font-size: 0.87rem; color: var(--vi-muted, #6B7280); line-height: 1.5; }
.sc__label { font-size: 0.82rem; font-weight: 700; color: var(--vi-text, #1B2A4A); display: flex; align-items: center; gap: 0.5rem; }
.sc__ia { font-weight: 600; font-size: 0.72rem; color: var(--p-primary-color); display: inline-flex; align-items: center; gap: 0.25rem; }
.sc__ta { width: 100%; font-size: 0.9rem; }
.sc__ligne { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
.sc__compte { font-size: 0.75rem; color: var(--vi-muted, #6B7280); }
.sc__avert { margin: 0; font-size: 0.78rem; color: #8a6d3b; display: flex; gap: 0.35rem; align-items: flex-start; }
.sc__lien {
  display: flex; align-items: center; gap: 0.45rem; font-size: 0.76rem;
  color: var(--vi-muted, #6B7280); background: var(--vi-bg, #F6F8FB);
  border-radius: 8px; padding: 0.5rem 0.7rem; overflow: hidden;
}
.sc__lien span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc__msg { margin: 0; }
.sc__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.3rem; }
</style>
