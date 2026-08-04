<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { pubSector, pubObjectsForSector, pubRarityFor } from '@/services/publicApi'
import { useSiteLink } from '@/composables/useSiteLink'
import RarityBadge from '@/components/public/RarityBadge.vue'

// LA SALLE — deuxième étape du parcours : musée → salle → œuvres.
//
// On n'affiche ici QUE les œuvres de cette salle. C'est ce qui donne au visiteur
// le sentiment de se déplacer dans le musée plutôt que de parcourir un catalogue :
// il entre quelque part, et ce qu'il voit dépend de l'endroit où il se trouve.

const route = useRoute()
const { to } = useSiteLink()

const secteur = ref(null)
const objets = ref([])
const rarete = ref({})
const loading = ref(true)

const musee = computed(() => secteur.value?.museums || null)

async function load() {
  loading.value = true
  objets.value = []
  rarete.value = {}
  secteur.value = await pubSector(Number(route.params.id))
  if (secteur.value) {
    objets.value = await pubObjectsForSector(secteur.value.id)
    // Une seule requête pour toute la salle, pas une par œuvre.
    rarete.value = await pubRarityFor(objets.value.map((o) => o.id))
  }
  loading.value = false
}
onMounted(load)
watch(() => route.params.id, load)
</script>

<template>
  <div class="sec">
    <div class="ps-wrap">
      <p v-if="loading" class="ps-muted">{{ $t('common.loading') }}</p>

      <template v-else-if="secteur">
        <router-link :to="musee ? to(`/musees/${musee.id}`) : to('/musees')" class="sec__back">
          <i class="pi pi-arrow-left" /> {{ musee?.nom || $t('museum.allMuseums') }}
        </router-link>

        <header class="sec__head">
          <span class="ps-over">
            <i :class="secteur.emplacement === 'Extérieur' ? 'pi pi-cloud' : 'pi pi-home'" />
            {{ secteur.emplacement }}
            <template v-if="secteur.etage != null"> · {{ $t('sector.floor', { n: secteur.etage }) }}</template>
          </span>
          <h1 class="sec__title">{{ secteur.nom }}</h1>
          <p v-if="secteur.description" class="sec__desc">{{ secteur.description }}</p>
        </header>

        <!-- Le récit de la salle : c'est lui qui fait la différence avec une liste. -->
        <section v-if="secteur.histoire" class="sec__story">
          <span class="ps-over">{{ $t('sector.storyTitle') }}</span>
          <p>{{ secteur.histoire }}</p>
        </section>

        <h2 class="ps-title">{{ $t('sector.works', { n: objets.length }) }}</h2>

        <div v-if="objets.length" class="ocards">
          <router-link
            v-for="o in objets" :key="o.id"
            :to="to(`/objets/${o.id}`)"
            class="ocard ps-card ps-card--hover"
          >
            <div class="ocard__img">
              <img v-if="o.photo" :src="o.photo" :alt="o.nom" loading="lazy" decoding="async" />
              <div v-else class="ps-ph"><i class="pi pi-box" /></div>
              <span v-if="o.model3d" class="ps-tag ps-tag--primary ocard__3d">3D · AR</span>
            </div>
            <div class="ocard__b">
              <strong>{{ o.nom }}</strong>
              <small v-if="o.nom_commun">{{ o.nom_commun }}</small>
              <RarityBadge v-if="rarete[o.id]" :rarity="rarete[o.id]" compact class="ocard__rar" />
            </div>
          </router-link>
        </div>
        <p v-else class="ps-muted">{{ $t('sector.noWorks') }}</p>
      </template>

      <p v-else class="ps-muted">{{ $t('sector.notFound') }}</p>
    </div>
  </div>
</template>

<style scoped>
.sec { padding: 1.6rem 0 3rem; }
.sec__back { display: inline-flex; align-items: center; gap: 0.45rem; color: #5c615c; font-size: 0.88rem; margin-bottom: 1.2rem; text-decoration: none; }
.sec__back:hover { color: var(--site-primary, #0e6f5c); }

.sec__head { margin-bottom: 1.6rem; }
.sec__title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0.4rem 0 0.6rem; color: #101210; }
.sec__desc { color: #5c615c; line-height: 1.7; max-width: 68ch; margin: 0; }

.sec__story { margin: 0 0 2rem; padding: 1.2rem 1.4rem; border-left: 4px solid var(--gold, #c9a227); background: #faf9f6; border-radius: 0 10px 10px 0; }
.sec__story p { margin: 0.4rem 0 0; color: #3c403c; line-height: 1.75; max-width: 72ch; }

.ocards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.1rem; }
.ocard { display: flex; flex-direction: column; overflow: hidden; text-decoration: none; }
.ocard__img { position: relative; aspect-ratio: 4 / 3; background: #f2f4f1; }
.ocard__img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ocard__3d { position: absolute; top: 0.6rem; left: 0.6rem; }
.ocard__b { padding: 0.85rem 0.95rem 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.ocard__b strong { color: #101210; font-size: 0.98rem; line-height: 1.3; }
.ocard__b small { color: #7c817b; font-style: italic; font-size: 0.82rem; }
.ocard__rar { align-self: flex-start; margin-top: 0.2rem; }
.ps-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b9bdb7; font-size: 1.8rem; }
</style>
