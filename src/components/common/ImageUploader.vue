<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import { compresserImage, poidsLisible } from '@/services/image'

const { t } = useI18n()

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: '' },
  height: { type: String, default: '180px' }
})
const effLabel = computed(() => props.label || t('uploader.defaultLabel'))
const emit = defineEmits(['update:modelValue'])

const inputRef = ref(null)
const failed = ref(false)
const busy = ref(false)
const poids = ref('')

function pick() {
  inputRef.value?.click()
}

// L'image est REDIMENSIONNÉE avant d'être encodée. Sans cela, la photo d'un
// téléphone part en base64 à sa taille d'origine : ~360 Ko mesurés en
// production pour une seule image, d'où plus de dix secondes d'enregistrement.
async function onFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  busy.value = true
  try {
    const dataUrl = await compresserImage(file)
    failed.value = false
    poids.value = poidsLisible(dataUrl)
    emit('update:modelValue', dataUrl)
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}

function clear() {
  emit('update:modelValue', '')
  poids.value = ''
  if (inputRef.value) inputRef.value.value = ''
}
</script>

<template>
  <div class="uploader">
    <div
      class="uploader__preview"
      :style="{ height }"
      @click="pick"
    >
      <img
        v-if="modelValue && !failed"
        :src="modelValue"
        :alt="effLabel"
        @error="failed = true"
      />
      <div v-else class="uploader__placeholder">
        <i class="pi pi-image" />
        <span>{{ $t('uploader.clickToLoad', { label: effLabel.toLowerCase() }) }}</span>
      </div>

      <div v-if="busy" class="uploader__busy">
        <i class="pi pi-spin pi-spinner" /> {{ $t('uploader.optimizing') }}
      </div>
    </div>

    <div class="uploader__actions">
      <Button
        type="button"
        size="small"
        :label="modelValue ? $t('uploader.change') : $t('uploader.choose')"
        icon="pi pi-upload"
        :loading="busy"
        outlined
        @click="pick"
      />
      <span v-if="poids" class="uploader__poids">{{ poids }}</span>
      <Button
        v-if="modelValue"
        type="button"
        size="small"
        :label="$t('uploader.remove')"
        icon="pi pi-times"
        severity="secondary"
        text
        @click="clear"
      />
    </div>

    <input
      ref="inputRef"
      type="file"
      accept="image/*"
      class="uploader__input"
      @change="onFile"
    />
  </div>
</template>

<style scoped>
.uploader__busy {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: color-mix(in srgb, var(--vi-surface, #fff) 82%, transparent);
  font-size: 0.85rem; color: var(--vi-muted);
}
.uploader__poids { font-size: 0.75rem; color: var(--vi-muted); align-self: center; }
.uploader__preview {
  position: relative;
  border: 2px dashed var(--vi-border);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: var(--vi-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s ease;
}

.uploader__preview:hover {
  border-color: var(--p-primary-400, #818cf8);
}

.uploader__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.uploader__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--vi-muted);
  font-size: 0.85rem;
}

.uploader__placeholder i {
  font-size: 1.8rem;
  opacity: 0.6;
}

.uploader__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}

.uploader__input {
  display: none;
}
</style>
