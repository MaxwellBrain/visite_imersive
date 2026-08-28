<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import ArViewer from '@/components/immersive/ArViewer.vue'
import { pubObject, pubObjectChefs, pubObjectModels } from '@/services/publicApi'
import { useSiteLink } from '@/composables/useSiteLink'
import { DEMO_VARIANTS } from '@/services/glb'

// Page de réalité augmentée autonome — c'est la cible du QR affiché sur
// l'ordinateur. Elle doit s'ouvrir vite sur un téléphone, d'où le parti pris :
// aucun chargement superflu, la RA d'abord, le contexte ensuite.
//
// L'identifiant « demo » ouvre la pièce générée en mémoire : la RA reste
// démontrable même sur une base vierge.

const route = useRoute()
const { to } = useSiteLink()

const objet = ref(null)
const chefs = ref([])
const loading = ref(true)

const estDemo = computed(() => String(route.params.id) === 'demo')
const museumId = computed(() => objet.value?.sectors?.museum_id ?? null)
// Une variante différente selon l'objet : deux pièces voisines n'ont pas la
// même silhouette, ce qui évite l'effet « catalogue d'un seul modèle ».
const variante = computed(() => {
  const n = Number(route.params.id)
  return DEMO_VARIANTS[(Number.isFinite(n) ? n : 0) % DEMO_VARIANTS.length]
})

async function load() {
  loading.value = true
  objet.value = null
  chefs.value = []
  if (!estDemo.value) {
    const fiche = await pubObject(Number(route.params.id))
    if (fiche) {
      // LE MAILLAGE N'EST PAS DANS LA FICHE. `pubObject` s'appuie sur
      // COLONNES_LISTE, d'où `model3d` est volontairement absent : le renvoyer
      // sur chaque liste transportait des méga-octets pour afficher une
      // vignette. Mais CETTE page-ci existe pour montrer le modèle — sans cet
      // appel, `ArViewer` ne voyait aucun maillage et servait la pièce de
      // démonstration, quand bien même le conservateur avait importé la sienne.
      const [medias, r] = await Promise.all([
        pubObjectModels(fiche.id),
        pubObjectChefs(fiche.id)
      ])
      objet.value = { ...fiche, ...medias }
      chefs.value = r.map((x) => x.personnages)
    }
  }
  loading.value = false
}
onMounted(load)
watch(() => route.params.id, load)

function chefLabel(p) {
  const nom = p.prenom ? `${p.prenom} ${p.nom}` : p.nom
  return p.titre ? `${p.titre} ${nom}` : nom
}
</script>

<template>
  <div class="arp">
    <div class="ps-wrap">
      <router-link :to="museumId ? to(`/musees/${museumId}`) : to('/musees')" class="ps-back ps-back--dark">
        <i class="pi pi-arrow-left" /> {{ $t('museum.allMuseums') }}
      </router-link>

      <p v-if="loading" class="ps-muted">{{ $t('common.loading') }}</p>

      <template v-else>
        <ArViewer :objet="objet" :variante="variante" :ar-seul="objet?.ar_seulement === true">
          <!-- Le fil ne s'arrête pas à l'objet : il remonte au chef, puis à la lignée. -->
          <div v-if="chefs.length" class="arp__thread">
            <span class="arp__lead"><i class="pi pi-sitemap" /> {{ $t('tour.threadLead') }}</span>
            <router-link v-for="c in chefs" :key="c.id" :to="to(`/personnages/${c.id}`)" class="arp__chef">
              <img v-if="c.portrait" :src="c.portrait" :alt="chefLabel(c)" />
              <span v-else class="arp__ph"><i class="pi pi-user" /></span>
              <span class="arp__n">
                <strong>{{ chefLabel(c) }}</strong>
                <small>{{ $t('tour.seeLineage') }}</small>
              </span>
              <i class="pi pi-arrow-right" />
            </router-link>
          </div>

          <template #actions>
            <router-link v-if="objet" :to="to(`/objets/${objet.id}`)" class="ps-btn ps-btn--sm ps-btn--line">
              <i class="pi pi-book" /> {{ $t('tour.fullRecord') }}
            </router-link>
          </template>
        </ArViewer>

        <!-- Le propos : ce que la réalité augmentée démontre, en une phrase. -->
        <section class="arp__thesis">
          <span class="ps-over">{{ $t('ar.thesisOver') }}</span>
          <p>{{ $t('ar.thesisText') }}</p>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.arp { padding-bottom: 2.5rem; }
.ps-back--dark { color: #5c615c; margin-bottom: 1.2rem; }
.ps-back--dark:hover { color: var(--site-primary, #0e6f5c); }

.arp__thread { margin-top: 1.2rem; border-top: 1px solid #e8e9e6; padding-top: 0.9rem; }
.arp__lead { display: block; font-size: 0.76rem; color: #7c817b; margin-bottom: 0.5rem; }
.arp__lead i { color: var(--gold, #c9a227); }
.arp__chef {
  display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0.6rem;
  border-radius: 10px; background: #f6f7f4; margin-bottom: 0.4rem;
}
.arp__chef:hover { background: #eef0ea; }
.arp__chef img, .arp__ph { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; flex: 0 0 42px; }
.arp__ph { display: flex; align-items: center; justify-content: center; background: #e3e6e0; color: #a9aea6; }
.arp__n { min-width: 0; flex: 1 1 auto; }
.arp__n strong { display: block; font-size: 0.9rem; color: #101210; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arp__n small { font-size: 0.72rem; color: var(--site-primary, #0e6f5c); font-weight: 700; }
.arp__chef > i { color: var(--site-primary, #0e6f5c); }

.arp__thesis {
  margin-top: 2rem; padding: 1.4rem 1.6rem;
  border-left: 4px solid var(--gold, #c9a227); background: #faf9f6; border-radius: 0 10px 10px 0;
}
.arp__thesis p { margin: 0.4rem 0 0; color: #3c403c; line-height: 1.75; max-width: 760px; }
</style>
