<script setup>
// ŒUVRE EN 3D, QUI TOURNE SEULE, SUR LA PAGE D'ACCUEIL.
//
// Jusqu'ici la 3D vivait derrière un bouton : une photo, un clic, un dialogue.
// Le visiteur devait donc deviner qu'il y avait quelque chose à voir. Ici
// l'objet tourne de lui-même dès qu'il arrive à l'écran — c'est la promesse du
// site, autant la tenir tout de suite.
//
// QUAND LE COMPOSANT SE CHARGE-T-IL VRAIMENT
// `<model-viewer>` pèse ~230 Ko. Le charger au démarrage de la page le mettrait
// sur le chemin critique de TOUS les visiteurs, y compris ceux qui ne
// descendront jamais jusqu'ici. On attend donc que la carte entre dans le champ
// de vision : à ce moment, le visiteur regarde, et le téléchargement est justifié.
//
// La photo tient la place en attendant. Ce n'est pas un pis-aller : elle évite
// que la page saute quand la visionneuse prend le relais.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { chargerModelViewer } from '@/services/modelViewer'

const props = defineProps({
  objet: { type: Object, required: true },
  // Lien vers la fiche complète : c'est là qu'on voit vraiment l'œuvre.
  lien: { type: String, default: '' }
})

const cadre = ref(null)
const pret = ref(false)
const echec = ref(false)
let observateur = null
// Écouteurs à retirer au démontage : sans cela, quitter la page laisserait un
// gestionnaire de défilement attaché à un composant qui n'existe plus.
const nettoyages = []

async function charger() {
  try {
    await chargerModelViewer()
    pret.value = true
  } catch {
    // Le réseau a lâché, ou le module est bloqué : on garde la photo, qui
    // reste une image de l'œuvre. Mieux vaut ça qu'un cadre vide.
    echec.value = true
  }
}

// Déjà à l'écran ? On ne peut pas s'en remettre au seul IntersectionObserver :
// il ne signale rien tant que la page ne compose pas d'image (onglet en arrière-
// plan, fenêtre masquée, navigateur piloté). Sur un grand écran, la section peut
// aussi être visible d'emblée, sans le moindre défilement à observer.
function dejaVisible(el) {
  if (!el) return false
  const r = el.getBoundingClientRect()
  const h = window.innerHeight || document.documentElement.clientHeight
  return r.top < h + 200 && r.bottom > -200
}

onMounted(() => {
  if (!props.objet?.model3d) { echec.value = true; return }

  if (dejaVisible(cadre.value)) { charger(); return }

  // Sans IntersectionObserver (très vieux navigateur), on charge directement :
  // le comportement reste correct, seule l'économie disparaît.
  if (typeof IntersectionObserver === 'undefined') { charger(); return }

  observateur = new IntersectionObserver((entrees) => {
    if (entrees.some((e) => e.isIntersecting)) {
      observateur.disconnect()
      observateur = null
      charger()
    }
  }, { rootMargin: '200px' }) // on prend un peu d'avance sur le défilement

  if (cadre.value) observateur.observe(cadre.value)

  // Filet de sécurité : si l'observateur reste muet alors que la carte est
  // arrivée à l'écran (cas ci-dessus), on charge au défilement suivant.
  const auDefilement = () => {
    if (!pret.value && !echec.value && dejaVisible(cadre.value)) {
      window.removeEventListener('scroll', auDefilement)
      if (observateur) { observateur.disconnect(); observateur = null }
      charger()
    }
  }
  window.addEventListener('scroll', auDefilement, { passive: true })
  nettoyages.push(() => window.removeEventListener('scroll', auDefilement))
})

onBeforeUnmount(() => {
  if (observateur) observateur.disconnect()
  nettoyages.forEach((f) => f())
})

const visuel = props.objet.photo_thumb || props.objet.photo || ''
</script>

<template>
  <div ref="cadre" class="o3d">
    <!-- La visionneuse.
         `interaction-prompt="none"` : la main animée de model-viewer inviterait
         à toucher, alors que l'objet tourne déjà tout seul.
         `loading="eager"` : par défaut, model-viewer attend LUI AUSSI d'être
         visible avant de télécharger le .glb — deux attentes en série, et le
         modèle n'arrivait jamais dans certains contextes. Puisque le composant
         n'est monté qu'une fois la carte à l'écran, l'attente a déjà eu lieu :
         on charge sans plus tergiverser. Les modèles pèsent 28 à 37 Ko. -->
    <model-viewer
      v-if="pret"
      :src="objet.model3d"
      :ios-src="objet.model3d_ios || undefined"
      :alt="objet.nom"
      :poster="visuel || undefined"
      camera-controls
      auto-rotate
      auto-rotate-delay="0"
      rotation-per-second="18deg"
      interaction-prompt="none"
      loading="eager"
      reveal="auto"
      shadow-intensity="1"
      exposure="1.05"
      touch-action="pan-y"
      class="o3d__viewer"
    />

    <!-- En attente (ou en cas d'échec) : la photo de l'œuvre. -->
    <img v-else-if="visuel" :src="visuel" :alt="objet.nom" class="o3d__photo" loading="lazy" />
    <div v-else class="o3d__vide"><i class="pi pi-box" /></div>

    <span v-if="!pret && !echec" class="o3d__attente">
      <i class="pi pi-spin pi-spinner" /> {{ $t('home.obj3dLoading') }}
    </span>

    <div class="o3d__pied">
      <span class="o3d__nom">
        <strong>{{ objet.nom }}</strong>
        <small v-if="objet.nom_commun">{{ objet.nom_commun }}</small>
      </span>
      <a v-if="lien" :href="lien" class="o3d__voir">
        {{ $t('home.obj3dOpen') }} <i class="pi pi-arrow-right" />
      </a>
    </div>

    <span v-if="pret" class="o3d__badge"><i class="pi pi-sync" /> 3D</span>
  </div>
</template>

<style scoped>
.o3d { position: relative; border-radius: 14px; overflow: hidden; background: #14171a; display: flex; flex-direction: column; }
.o3d__viewer { width: 100%; height: 320px; background: radial-gradient(circle at 50% 40%, #24292d 0%, #14171a 70%); display: block; }
.o3d__photo { width: 100%; height: 320px; object-fit: cover; display: block; opacity: 0.85; }
.o3d__vide { height: 320px; display: grid; place-items: center; color: #4d555b; font-size: 2.4rem; }

.o3d__attente { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 0.45rem; background: rgba(0, 0, 0, 0.62); color: #e8eeeb; font-size: 0.78rem; padding: 0.4rem 0.8rem; border-radius: 999px; }

.o3d__pied { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.85rem 1rem; background: #101315; color: #fff; }
.o3d__nom { display: flex; flex-direction: column; min-width: 0; }
.o3d__nom strong { font-size: 0.95rem; line-height: 1.25; }
.o3d__nom small { font-size: 0.76rem; color: #97a3a0; }
.o3d__voir { display: inline-flex; align-items: center; gap: 0.35rem; flex: none; font-size: 0.8rem; font-weight: 700; text-decoration: none; color: var(--site-primary, #0e6f5c); background: rgba(255, 255, 255, 0.94); padding: 0.45rem 0.8rem; border-radius: 999px; }
.o3d__voir:hover { background: #fff; }

.o3d__badge { position: absolute; top: 0.7rem; left: 0.7rem; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.08em; padding: 0.28rem 0.55rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem; }

@media (max-width: 640px) {
  .o3d__viewer, .o3d__photo, .o3d__vide { height: 260px; }
}
</style>
