<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import EventsSection from '@/components/public/EventsSection.vue'
import GuestBook from '@/components/public/GuestBook.vue'
import { pubMuseum, pubSectors, pubMuseumChefs, pubTours, pubObjectCountBySector } from '@/services/publicApi'
import { useSiteLink } from '@/composables/useSiteLink'

// LA FICHE MUSÉE — première étape du parcours : musée → salle → œuvres.
//
// Elle présente le lieu, puis invite à entrer dans une salle. Elle ne liste
// volontairement PAS les œuvres : on ne voit une œuvre qu'en entrant là où elle
// est exposée. Le guide vocal et les offres d'accès n'y figurent plus non plus —
// la page dit ce qu'est ce musée, rien d'autre.

// Liens internes : reste sur le site consulte (/site ou /c/<slug>)
const { to } = useSiteLink()

const route = useRoute()
const museum = ref(null)
const sectors = ref([])
const chefs = ref([])
const tours = ref([])      // parcours immersifs publiés de ce musée
const nbObjets = ref({})   // nombre d'œuvres par salle, pour l'annoncer sur la carte
const loading = ref(true)

async function load() {
  loading.value = true
  sectors.value = []
  nbObjets.value = {}
  museum.value = await pubMuseum(Number(route.params.id))
  if (museum.value) {
    // En parallèle : trois allers-retours simultanés au lieu d'une cascade.
    const [secs, ch, trs] = await Promise.all([
      pubSectors(museum.value.id),
      pubMuseumChefs(museum.value.id),
      pubTours(museum.value.id)
    ])
    sectors.value = secs
    chefs.value = ch
    tours.value = trs
    // Une seule requête pour compter les œuvres de toutes les salles (pas de N+1).
    nbObjets.value = await pubObjectCountBySector(secs.map((s) => s.id))
  }
  loading.value = false
}

onMounted(load)
watch(() => route.params.id, load)

const age = computed(() => (museum.value?.annee_fondation ? new Date().getFullYear() - museum.value.annee_fondation : null))
</script>

<template>
  <div>
    <p v-if="loading" class="ps-wrap ps-muted">{{ $t('common.loading') }}</p>
    <template v-else-if="museum">
      <!-- Bandeau photo du musée -->
      <header class="ps-hero" :style="museum.photo ? { backgroundImage: `url(${museum.photo})` } : {}">
        <div class="ps-hero__in">
          <router-link :to="to('/musees')" class="ps-back"><i class="pi pi-arrow-left" /> {{ $t('museum.allMuseums') }}</router-link>
          <div>
            <span v-if="museum.type" class="ps-hero__over">{{ museum.type }}</span>
          </div>
          <h1>{{ museum.nom }}</h1>
          <p v-if="museum.annee_fondation" class="ps-hero__lead">
            {{ $t('museum.foundedIn', { year: museum.annee_fondation }) }}<span v-if="age"> · {{ $t('museum.yearsOld', { n: age }) }}</span>
          </p>
          <div class="mh-actions">
            <router-link :to="to(`/musees/${museum.id}/boutique`)" class="ps-btn">
              <i class="pi pi-shopping-bag" /> {{ $t('boutique.museumCta') }}
            </router-link>
          </div>
        </div>
      </header>

      <div class="ps-wrap">
        <p v-if="museum.description" class="m-desc">{{ museum.description }}</p>

        <!-- Visite immersive : l'expérience phare, donc en tête de page -->
        <section v-if="tours.length" class="tours">
          <article
            v-for="tr in tours"
            :key="tr.id"
            class="tourc"
            :style="tr.couverture ? { backgroundImage: `url(${tr.couverture})` } : {}"
          >
            <div class="tourc__in">
              <span class="tourc__over"><i class="pi pi-compass" /> {{ $t('tour.museumTitle') }}</span>
              <h3>{{ tr.titre }}</h3>
              <p>{{ tr.description || $t('tour.museumSub') }}</p>
              <div class="tourc__act">
                <router-link :to="to(`/visite/${tr.id}`)" class="ps-btn">
                  <i class="pi pi-play" /> {{ $t('tour.start') }}
                </router-link>
                <span v-if="tr.dureeMin" class="tourc__meta">{{ $t('tour.duration', { n: tr.dureeMin }) }}</span>
              </div>
            </div>
          </article>
        </section>

        <!-- Le parcours : après la description, on entre dans une salle.
             Les œuvres ne sont pas listées ici — on les découvre en entrant. -->
        <h2 class="ps-title">{{ $t('museum.rooms') }}</h2>
        <p class="m-roomlead">{{ $t('museum.roomsLead') }}</p>
        <div class="sectors">
          <router-link
            v-for="sec in sectors" :key="sec.id"
            :to="to(`/secteurs/${sec.id}`)"
            class="sector ps-card ps-card--hover"
          >
            <span class="sector__ic">
              <i :class="sec.emplacement === 'Extérieur' ? 'pi pi-cloud' : 'pi pi-home'" />
            </span>
            <div class="sector__b">
              <strong>{{ sec.nom }}</strong>
              <span class="sector__meta">
                {{ sec.emplacement }}
                <template v-if="nbObjets[sec.id]"> · {{ $t('museum.roomWorks', { n: nbObjets[sec.id] }) }}</template>
              </span>
              <span v-if="sec.description" class="sector__desc">{{ sec.description }}</span>
            </div>
            <i class="pi pi-arrow-right sector__go" />
          </router-link>
          <p v-if="!sectors.length" class="ps-muted">{{ $t('museum.noRooms') }}</p>
        </div>

        <template v-if="chefs.length">
          <h2 class="ps-title">{{ $t('museum.genealogyTitle') }}</h2>
          <p class="gen-sub">{{ $t('museum.genealogySub') }}</p>
          <div class="gen-cards">
            <router-link v-for="c in chefs" :key="c.id" :to="to(`/personnages/${c.id}`)" class="gen-card ps-card ps-card--hover">
              <img v-if="c.portrait" :src="c.portrait" :alt="c.nom" class="gen-card__img" />
              <div v-else class="gen-card__img gen-card__img--ph"><i class="pi pi-user" /></div>
              <div class="gen-card__b">
                <span v-if="c.titre" class="gen-card__titre">{{ c.titre }}</span>
                <strong>{{ c.prenom ? `${c.prenom} ${c.nom}` : c.nom }}</strong>
                <span v-if="c.regne_debut" class="gen-card__vie">{{ $t('museum.reign', { from: c.regne_debut, to: c.regne_fin ?? '…' }) }}</span>
                <span class="ps-link gen-card__cta">{{ $t('museum.seeStory') }} <i class="pi pi-arrow-right" /></span>
              </div>
            </router-link>
          </div>
        </template>

      </div>

      <!-- Agenda et livre d'or de ce musée -->
      <EventsSection :museum-id="museum.id" :limit="3" />
      <GuestBook :museum-id="museum.id" />
    </template>
    <div v-else class="ps-wrap ps-muted">{{ $t('museum.notFound') }}</div>
  </div>
</template>

<style scoped>
.mh-actions { margin-top: 1.4rem; }
.m-desc { font-size: 1.05rem; line-height: 1.75; color: #3c403c; max-width: 820px; margin: 0 0 1.2rem; }
.m-guide { margin: 1.2rem 0 0.4rem; }

.tours { display: grid; gap: 1rem; margin: 1.6rem 0 0.4rem; }
.tourc { position: relative; border-radius: 12px; overflow: hidden; background: #0d0f0d center/cover no-repeat; }
.tourc::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(8, 10, 8, 0.92) 0%, rgba(8, 10, 8, 0.62) 65%, rgba(8, 10, 8, 0.35) 100%);
}
.tourc__in { position: relative; z-index: 1; padding: 1.8rem 1.7rem; max-width: 640px; }
.tourc__over {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold, #c9a227);
}
.tourc h3 {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: clamp(1.3rem, 3vw, 2rem); line-height: 1.1; color: #fff; margin: 0.5rem 0 0.4rem;
}
.tourc p { color: #cfd4ce; line-height: 1.65; margin: 0 0 1.2rem; font-size: 0.94rem; }
.tourc__act { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.tourc__meta { color: #9a9a90; font-size: 0.82rem; }

.offers { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 1.1rem; margin: 1.5rem 0 0.4rem; }
.ag-wrap { margin: 1.2rem 0 0.4rem; }
.offer { display: flex; gap: 1rem; padding: 1.15rem 1.2rem; }
.offer__ic {
  width: 46px; height: 46px; border-radius: 50%; flex: 0 0 auto;
  background: color-mix(in srgb, var(--site-primary) 10%, #fff); color: var(--site-primary);
  display: flex; align-items: center; justify-content: center; font-size: 1.2rem;
}
.offer__b { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
.offer__b strong { font-size: 1.02rem; font-weight: 800; color: #101210; }
.offer__lock { font-size: 0.8rem; color: #7c817b; }
.offer__lock i { color: #c0392b; margin-right: 0.2rem; }
.offer__ok { color: var(--site-primary); font-weight: 800; font-size: 0.9rem; }

.gen-sub { margin: -0.5rem 0 1.1rem; color: #5c615c; font-size: 0.92rem; }
.gen-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 1.1rem; }
.gen-card { display: flex; gap: 0.9rem; padding: 0.9rem; }
.gen-card__img { width: 74px; height: 74px; border-radius: 8px; object-fit: cover; flex: 0 0 74px; }
.gen-card__img--ph { display: flex; align-items: center; justify-content: center; background: #eef0ed; color: #b9beb8; font-size: 1.6rem; }
.gen-card__b { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.gen-card__titre { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--site-primary); font-weight: 800; }
.gen-card__b strong { font-size: 1.02rem; font-weight: 800; color: #101210; }
.gen-card__vie { font-size: 0.78rem; color: #7c817b; }
.gen-card__cta { margin-top: auto; font-size: 0.72rem; }

.m-roomlead { color: #5c615c; margin: -0.4rem 0 1.1rem; font-size: 0.94rem; }
.sectors { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 1rem; }
.sector {
  display: flex; align-items: center; gap: 0.9rem; padding: 1.05rem 1.2rem;
  text-decoration: none; transition: transform 0.15s ease;
}
.sector:hover { transform: translateY(-2px); }
.sector__ic {
  flex: 0 0 auto; width: 46px; height: 46px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--site-primary) 10%, #fff);
  color: var(--site-primary); font-size: 1.15rem;
}
.sector__b { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.sector__b strong { font-size: 1rem; color: #101210; }
.sector__meta { font-size: 0.78rem; color: #7c817b; font-weight: 600; }
.sector__desc {
  font-size: 0.82rem; color: #5c615c; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sector__go { color: var(--site-primary); flex: 0 0 auto; }

.ocards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.2rem; }
.ocard { overflow: hidden; text-align: center; }
.ocard__img { position: relative; aspect-ratio: 1/1; background: #eef0ed; overflow: hidden; }
.ocard__img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.ocard:hover .ocard__img img { transform: scale(1.05); }
.ocard__3d { position: absolute; bottom: 0.6rem; left: 0.6rem; }
.ocard strong { display: block; padding: 0.7rem 0.6rem 0.1rem; font-size: 0.95rem; font-weight: 700; color: #101210; }
.ocard small { display: block; padding: 0 0.6rem 0.8rem; color: #7c817b; font-size: 0.75rem; }
</style>
