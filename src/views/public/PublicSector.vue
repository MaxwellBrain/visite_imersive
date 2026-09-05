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

// UNE ŒUVRE SANS PHOTO N'EST PAS UNE CARTE CASSÉE.
//
// Le carré gris et son icône générique donnaient la même image à toutes les
// pièces non photographiées : trois rectangles identiques, que l'œil lit comme
// un défaut d'affichage plutôt que comme un manque de photo. L'initiale, elle,
// distingue les cartes les unes des autres et se lit comme un parti pris —
// le temps que le musée prenne le cliché.
const initiale = (nom) => (nom || '?').trim().charAt(0).toUpperCase()

// UNE URL DE PHOTO QUI ÉCHOUE LAISSAIT UN TROU BLANC.
//
// Le repli ne se déclenchait que si la colonne `photo` était VIDE. Or le cas
// courant est l'autre : une adresse bien présente en base, mais qui ne répond
// pas — service d'images tiers coupé, fichier supprimé du stockage, réseau
// mobile capricieux. Le navigateur laisse alors un cadre vide, sans rien dire,
// et la salle a l'air cassée. On écoute donc l'échec de chargement.
const echecs = ref(new Set())
function photoEnEchec(id) {
  // Un Set muté ne redéclenche pas le rendu : on le remplace.
  echecs.value = new Set(echecs.value).add(id)
}
const aUneImage = (o) => !!o.photo && !echecs.value.has(o.id)

// Ce que la pièce offre vraiment : un .glb se voit à l'écran et en RA sur
// Android, un .usdz ne s'ouvre qu'en Quick Look sur iPhone. Annoncer « 3D · AR »
// pour l'un ou l'autre promettait une fonction sur deux.
function pastille(o) {
  if (o.a_glb && o.a_ar_ios) return '3D · AR'
  if (o.a_glb) return '3D'
  if (o.a_ar_ios) return 'AR'
  return null
}
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

        <h2 class="ps-title">{{ $t('sector.works', objets.length) }}</h2>

        <div v-if="objets.length" class="ocards">
          <router-link
            v-for="o in objets" :key="o.id"
            :to="to(`/objets/${o.id}`)"
            class="ocard ps-card ps-card--hover"
          >
            <div class="ocard__img">
              <img
                v-if="aUneImage(o)" :src="o.photo" :alt="o.nom"
                loading="lazy" decoding="async" @error="photoEnEchec(o.id)"
              />
              <div v-else class="ocard__ph" aria-hidden="true">{{ initiale(o.nom) }}</div>
              <!-- « 3D · AR » s'affichait dès qu'un modèle existait, quel qu'il
                   soit. La pastille dit maintenant ce que la pièce offre
                   réellement. Voir 20260902_ar_separee.sql. -->
              <span v-if="pastille(o)" class="ps-tag ps-tag--primary ocard__3d">{{ pastille(o) }}</span>
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

/* `auto-fit` et non `auto-fill` : avec `auto-fill`, une salle de trois œuvres
   laissait deux colonnes vides à droite et les cartes se serraient à gauche —
   la grille avait l'air interrompue. `auto-fit` replie les colonnes vides, les
   cartes occupent la largeur. */
.ocards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1.1rem; }
.ocard { display: flex; flex-direction: column; overflow: hidden; text-decoration: none; }

/* Carré plutôt que 4/3 : masques, trônes et statues sont VERTICAUX. Un cadre
   paysage les rognait en haut et en bas, c'est-à-dire précisément là où se
   trouve ce qu'on vient voir. */
.ocard__img { position: relative; aspect-ratio: 1 / 1; background: #f2f4f1; overflow: hidden; }
.ocard__img img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  transition: transform 0.4s ease;
}
.ocard:hover .ocard__img img { transform: scale(1.04); }

.ocard__ph {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #eaefe9, #dde5dd);
  color: #a8b5a8;
  font-size: 3.4rem; font-weight: 700; line-height: 1;
  user-select: none;
}

.ocard__3d { position: absolute; top: 0.6rem; left: 0.6rem; }
.ocard__b { padding: 0.85rem 0.95rem 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.ocard__b strong { color: #101210; font-size: 1.02rem; line-height: 1.3; }
.ocard:hover .ocard__b strong { text-decoration: underline; text-underline-offset: 3px; }
.ocard__b small { color: #7c817b; font-style: italic; font-size: 0.82rem; }

/* La rareté est un COMPLÉMENT, pas un titre. Remplie et dorée, elle criait plus
   fort que le nom de l'œuvre — et comme la plupart des pièces d'une chefferie
   sont uniques, la même pastille se répétait sur toute la grille jusqu'à ne
   plus rien signifier. Ici elle redevient une mention. */
.ocard__rar {
  align-self: flex-start; margin-top: 0.15rem;
  background: none; border: none; padding: 0;
  font-size: 0.74rem; opacity: 0.7;
}
.ps-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b9bdb7; font-size: 1.8rem; }
</style>
