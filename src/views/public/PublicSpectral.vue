<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SpectralGuide from '@/components/immersive/spectral/SpectralGuide.vue'
import { useSiteLink } from '@/composables/useSiteLink'

// Page autonome du Guide Spectral — c'est la cible du QR affiché sur
// l'ordinateur, comme pour la réalité augmentée d'un objet (`PublicAr.vue`).
// Elle doit s'ouvrir vite sur un téléphone : rien d'autre que la visite.
//
// `?audio=1` force le mode audio-seul. C'est aussi le lien à donner à qui ne
// peut pas tenir un téléphone à bout de bras : même contenu, même ordre.

const route = useRoute()
const router = useRouter()
const { to } = useSiteLink()

const sceneId = computed(() => route.params.id)
const audioSeul = computed(() => route.query.audio === '1')

function retour() {
  if (window.history.length > 1) router.back()
  else router.push(to('/musees'))
}
</script>

<template>
  <div class="sp">
    <router-link :to="to('/musees')" class="ps-back ps-back--dark">
      <i class="pi pi-arrow-left" /> {{ $t('museum.allMuseums') }}
    </router-link>
    <SpectralGuide :scene-id="sceneId" :audio-seul="audioSeul" @fin="retour" />
  </div>
</template>

<style scoped>
.sp { min-height: 70vh; }
</style>
