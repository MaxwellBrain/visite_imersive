<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, SUPPORTED } from '@/i18n'

// variant: 'dark' (topbar sombre du site public) | 'light' (ERP)
const props = defineProps({ variant: { type: String, default: 'light' } })

const { locale } = useI18n()
const other = computed(() => SUPPORTED.find((l) => l !== locale.value) || 'en')

// Le catalogue de l'autre langue n'est chargé qu'ici, au premier basculement :
// il ne pèse plus sur le démarrage. D'où l'attente et l'état occupé — un
// téléchargement de ~40 Ko qui, sur réseau lent, mérite d'être signalé.
const bascule = ref(false)

async function toggle() {
  if (bascule.value) return
  bascule.value = true
  try {
    await setLocale(other.value)
  } finally {
    bascule.value = false
  }
}
</script>

<template>
  <button
    class="lang"
    :class="`lang--${props.variant}`"
    type="button"
    :disabled="bascule"
    :aria-label="$t('lang.switch')"
    :title="$t('lang.' + other)"
    @click="toggle"
  >
    <i class="pi pi-globe" />
    <span class="lang__code">{{ locale.toUpperCase() }}</span>
  </button>
</template>

<style scoped>
.lang { display: inline-flex; align-items: center; gap: 0.35rem; border: none; cursor: pointer; border-radius: 10px; padding: 0.4rem 0.6rem; font-weight: 700; font-size: 0.8rem; background: transparent; font-family: inherit; }
.lang__code { letter-spacing: 0.04em; }
.lang--dark { color: #f4ead4; }
.lang--dark:hover { background: rgba(255, 255, 255, 0.07); }
.lang--light { color: var(--vi-text, #4b4034); }
.lang--light:hover { background: rgba(0, 0, 0, 0.05); }
</style>
