<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'

// ============================================================================
// GALERIE PUBLIQUE D'UNE PIÈCE — plusieurs vues à côté de la notice.
// ----------------------------------------------------------------------------
// CE QUE LA FICHE MONTRAIT AVANT : une image. Une seule. Pour un masque dont le
// revers porte la marque de l'atelier, pour une statuette dont le profil dit
// l'essentiel du geste, c'est une amputation — et le visiteur n'avait aucun
// moyen de savoir qu'il manquait quelque chose.
//
// LA VUE DE COUVERTURE VIENT EN PREMIER, toujours. Elle est déjà celle des
// listes et des cartes de partage : la retrouver en tête de galerie évite au
// visiteur de se demander s'il a changé d'objet en arrivant sur la fiche.
//
// LA LÉGENDE EST AFFICHÉE, pas seulement mise en `alt`. « Revers, marque
// d'inventaire » n'est pas une béquille d'accessibilité : c'est l'information
// qui transforme une deuxième photo en deuxième regard.
// ============================================================================

const props = defineProps({
  // Vue de couverture (colonne `photo`).
  cover: { type: String, default: '' },
  // Vues complémentaires (colonne `photos`) : [{ url, legende }].
  photos: { type: Array, default: () => [] },
  alt: { type: String, default: '' }
})

const vues = computed(() => {
  const liste = []
  if (props.cover) liste.push({ url: props.cover, legende: '' })
  for (const v of props.photos || []) {
    if (v?.url && typeof v.url === 'string') liste.push({ url: v.url, legende: v.legende || '' })
  }
  return liste
})

const index = ref(0)
const plein = ref(false)
const cadre = ref(null)
const erreurs = ref(new Set())

const courante = computed(() => vues.value[index.value] || null)
const multiple = computed(() => vues.value.length > 1)

// Un objet peut changer sous le composant (navigation d'une fiche à l'autre) :
// sans cette remise à zéro, la deuxième pièce s'ouvrirait sur la troisième vue
// de la première.
watch(() => props.cover + '|' + (props.photos || []).length, () => {
  index.value = 0
  erreurs.value = new Set()
})

function aller(i) {
  if (!vues.value.length) return
  index.value = (i + vues.value.length) % vues.value.length
}
const precedente = () => aller(index.value - 1)
const suivante = () => aller(index.value + 1)

// Une image dont l'URL est morte ne doit pas laisser un cadre vide sans
// explication — ni faire croire que la pièce n'a pas de photo.
function echec(url) {
  const s = new Set(erreurs.value)
  s.add(url)
  erreurs.value = s
}

// ---------------------------------------------------------------------------
// PLEIN ÉCRAN
//
// Le détail d'une trame ou d'une inscription ne se lit pas dans un cadre de
// 4/3 posé à côté d'un texte. Le plein écran affiche l'image ENTIÈRE
// (`contain`), là où la vignette la recadre (`cover`) : c'est là qu'on voit ce
// que le conservateur a photographié, et pas seulement ce qui tenait dans le
// cadre.
// ---------------------------------------------------------------------------
let dernierFocus = null

async function ouvrir() {
  if (!courante.value) return
  dernierFocus = document.activeElement
  plein.value = true
  // La page ne doit pas défiler derrière la visionneuse : le visiteur croirait
  // avoir perdu sa place dans la notice.
  document.body.style.overflow = 'hidden'
  await nextTick()
  cadre.value?.focus()
}

function fermer() {
  plein.value = false
  document.body.style.overflow = ''
  dernierFocus?.focus?.()
}

function auClavier(e) {
  if (e.key === 'Escape') fermer()
  else if (e.key === 'ArrowLeft') precedente()
  else if (e.key === 'ArrowRight') suivante()
}

// Un composant démonté alors que la visionneuse est ouverte (retour arrière du
// navigateur) laisserait la page bloquée en `overflow: hidden`.
onBeforeUnmount(() => { document.body.style.overflow = '' })
</script>

<template>
  <div v-if="vues.length" class="og">
    <!-- ---------- vue principale ---------- -->
    <div class="og__frame ps-card">
      <button
        type="button"
        class="og__zoom"
        :aria-label="$t('gallery.openFull')"
        @click="ouvrir"
      >
        <img
          v-if="courante && !erreurs.has(courante.url)"
          :src="courante.url"
          :alt="courante.legende || alt"
          @error="echec(courante.url)"
        />
        <span v-else class="og__ph"><i class="pi pi-image" /></span>
        <span class="og__loupe"><i class="pi pi-search-plus" /></span>
      </button>

      <!-- Les flèches sont posées SUR l'image, mais la bande de vignettes reste
           le moyen principal : on voit ce vers quoi on va. -->
      <template v-if="multiple">
        <button type="button" class="og__nav og__nav--prev" :aria-label="$t('gallery.previous')" @click="precedente">
          <i class="pi pi-chevron-left" />
        </button>
        <button type="button" class="og__nav og__nav--next" :aria-label="$t('gallery.next')" @click="suivante">
          <i class="pi pi-chevron-right" />
        </button>
        <span class="og__count">{{ index + 1 }} / {{ vues.length }}</span>
      </template>

      <!-- La pastille 3D / RA de la fiche vient se poser ici. -->
      <slot name="badge" />
    </div>

    <p v-if="courante?.legende" class="og__legende">{{ courante.legende }}</p>

    <!-- ---------- bande de vignettes ---------- -->
    <ul v-if="multiple" class="og__strip">
      <li v-for="(v, i) in vues" :key="v.url + i">
        <button
          type="button"
          class="og__thumb"
          :class="{ 'og__thumb--on': i === index }"
          :aria-label="v.legende || $t('gallery.viewN', { n: i + 1 })"
          :aria-current="i === index ? 'true' : undefined"
          @click="aller(i)"
        >
          <img v-if="!erreurs.has(v.url)" :src="v.url" :alt="v.legende || $t('gallery.viewN', { n: i + 1 })" loading="lazy" @error="echec(v.url)" />
          <span v-else class="og__ph og__ph--sm"><i class="pi pi-image" /></span>
        </button>
      </li>
    </ul>

    <!-- ---------- plein écran ---------- -->
    <div
      v-if="plein"
      ref="cadre"
      class="og__full"
      role="dialog"
      aria-modal="true"
      :aria-label="alt"
      tabindex="-1"
      @keydown="auClavier"
      @click.self="fermer"
    >
      <button type="button" class="og__close" :aria-label="$t('gallery.close')" @click="fermer">
        <i class="pi pi-times" />
      </button>

      <button v-if="multiple" type="button" class="og__fnav og__fnav--prev" :aria-label="$t('gallery.previous')" @click="precedente">
        <i class="pi pi-chevron-left" />
      </button>

      <figure class="og__fig">
        <img :src="courante.url" :alt="courante.legende || alt" />
        <figcaption v-if="courante.legende || multiple">
          <span v-if="courante.legende">{{ courante.legende }}</span>
          <small v-if="multiple">{{ index + 1 }} / {{ vues.length }}</small>
        </figcaption>
      </figure>

      <button v-if="multiple" type="button" class="og__fnav og__fnav--next" :aria-label="$t('gallery.next')" @click="suivante">
        <i class="pi pi-chevron-right" />
      </button>
    </div>
  </div>

  <!-- Aucune image : on garde le cadre plutôt que de laisser la colonne
       s'effondrer et déséquilibrer la fiche. -->
  <div v-else class="og__frame ps-card">
    <span class="og__ph"><i class="pi pi-box" /></span>
    <slot name="badge" />
  </div>
</template>

<style scoped>
.og__frame { position: relative; overflow: hidden; aspect-ratio: 4 / 3; }
.og__zoom {
  display: block; width: 100%; height: 100%; padding: 0; border: 0;
  background: none; cursor: zoom-in;
}
.og__zoom img { width: 100%; height: 100%; object-fit: cover; display: block; }
.og__ph {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; background: #eef0ed; color: #b9beb8; font-size: 2rem;
}
.og__ph--sm { font-size: 1rem; }

/* La loupe dit que l'image s'ouvre. Sans elle, rien n'indique que ce cadre est
   cliquable — et personne ne clique sur une photo par hasard. */
.og__loupe {
  position: absolute; top: 0.7rem; right: 0.7rem;
  width: 2rem; height: 2rem; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(16, 18, 16, 0.55); color: #fff; font-size: 0.8rem;
  opacity: 0; transition: opacity 0.18s ease;
}
.og__frame:hover .og__loupe, .og__zoom:focus-visible .og__loupe { opacity: 1; }

.og__nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 2.2rem; height: 2.2rem; border: 0; border-radius: 999px;
  background: rgba(16, 18, 16, 0.5); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.18s ease, background 0.18s ease;
}
.og__frame:hover .og__nav, .og__nav:focus-visible { opacity: 1; }
.og__nav:hover { background: rgba(16, 18, 16, 0.78); }
.og__nav--prev { left: 0.6rem; }
.og__nav--next { right: 0.6rem; }
/* Sur écran tactile il n'y a pas de survol : les flèches restent visibles. */
@media (hover: none) {
  .og__nav, .og__loupe { opacity: 1; }
}

.og__count {
  position: absolute; top: 0.7rem; left: 0.7rem;
  padding: 0.12rem 0.5rem; border-radius: 999px;
  background: rgba(16, 18, 16, 0.55); color: #fff;
  font-size: 0.72rem; font-variant-numeric: tabular-nums;
}

.og__legende {
  margin: 0.55rem 0 0; font-size: 0.84rem; color: #5c615c;
  font-style: italic; line-height: 1.5;
}

.og__strip {
  list-style: none; display: flex; gap: 0.5rem; margin: 0.7rem 0 0; padding: 0.15rem;
  overflow-x: auto; scrollbar-width: thin;
}
.og__thumb {
  width: 68px; height: 52px; flex: 0 0 68px; padding: 0; cursor: pointer;
  border: 2px solid transparent; border-radius: 8px; overflow: hidden;
  background: #eef0ed; transition: border-color 0.15s ease, opacity 0.15s ease;
  opacity: 0.72;
}
.og__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.og__thumb:hover { opacity: 1; }
.og__thumb--on { border-color: var(--site-primary, #0e6f5c); opacity: 1; }

/* ---------- plein écran ---------- */
.og__full {
  position: fixed; inset: 0; z-index: 1200;
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: rgba(8, 10, 9, 0.94); padding: 1.2rem;
}
.og__fig { margin: 0; max-width: min(1200px, 92vw); max-height: 88vh; display: flex; flex-direction: column; gap: 0.7rem; }
/* `contain` et non `cover` : en plein écran on montre l'image entière, c'est
   tout l'intérêt d'y être. */
.og__fig img { max-width: 100%; max-height: 78vh; object-fit: contain; border-radius: 6px; }
.og__fig figcaption {
  display: flex; align-items: baseline; justify-content: center; gap: 0.7rem;
  color: #e7e9e6; font-size: 0.9rem; text-align: center;
}
.og__fig figcaption small { color: #9aa09a; font-variant-numeric: tabular-nums; }

.og__close {
  position: absolute; top: 1rem; right: 1rem;
  width: 2.4rem; height: 2.4rem; border: 0; border-radius: 999px; cursor: pointer;
  background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 1rem;
}
.og__close:hover { background: rgba(255, 255, 255, 0.26); }
.og__fnav {
  width: 2.8rem; height: 2.8rem; flex: 0 0 2.8rem; border: 0; border-radius: 999px; cursor: pointer;
  background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 1.1rem;
}
.og__fnav:hover { background: rgba(255, 255, 255, 0.26); }
@media (max-width: 640px) {
  .og__fnav { position: absolute; bottom: 1.2rem; }
  .og__fnav--prev { left: 20%; }
  .og__fnav--next { right: 20%; }
}
</style>
