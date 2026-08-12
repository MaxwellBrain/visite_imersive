<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { pubMuseums, pubFeaturedObjects, pubFeaturedProducts, oeuvresPopulaires } from '@/services/publicApi'
import ProductCard from '@/components/public/ProductCard.vue'
import InstallPwa from '@/components/public/InstallPwa.vue'
import EventsSection from '@/components/public/EventsSection.vue'
import GuestBook from '@/components/public/GuestBook.vue'
import ContactForm from '@/components/public/ContactForm.vue'
import { useSiteLink } from '@/composables/useSiteLink'

// Liens internes : reste sur le site consulte (/site ou /c/<slug>)
const { to } = useSiteLink()

const { t } = useI18n()
const settings = useSettingsStore()
const museums = ref([])
const objects = ref([])
const products = ref([])
const favorites = ref(new Set())

// Visuel du hero : réglable dans l'ERP, avec repli sur la photo livrée.
const HERO_DEFAUT = '/hero/hero-main.jpg'

onMounted(async () => {
  if (!settings.settings) settings.load()
  ;[museums.value, objects.value, products.value] = await Promise.all([
    pubMuseums(), pubFeaturedObjects(6), pubFeaturedProducts(4)
  ])
  // MISE EN AVANT AUTOMATIQUE — les œuvres les plus consultées passent devant.
  // On ne remplace la sélection que si l'audience mesurée est SUFFISANTE : avec
  // deux ou trois visites, un « classement » ne serait que du bruit présenté comme
  // une tendance. En dessous du seuil, on garde la sélection éditoriale.
  const pop = await oeuvresPopulaires(null, 30, 6)
  const credible = pop.filter((o) => o.vues >= SEUIL_VUES)
  if (credible.length >= 3) {
    populaires.value = credible
    // On complète avec la sélection habituelle pour garder une grille pleine.
    const dejaLa = new Set(credible.map((o) => o.id))
    objects.value = [...credible, ...objects.value.filter((o) => !dejaLa.has(o.id))].slice(0, 6)
  }
})

// En dessous de ce nombre de consultations, une œuvre n'est pas « populaire » :
// elle a juste été vue une fois. Mieux vaut la sélection du conservateur qu'un
// classement fondé sur trois clics.
const SEUIL_VUES = 5
const populaires = ref([])
const estPopulaire = (id) => populaires.value.some((o) => o.id === id)

const s = computed(() => settings.settings || {})
const heroImage = computed(() => s.value.heroImage || s.value.imageFond || HERO_DEFAUT)

// Badges de réassurance : personnalisables par organisation depuis l'ERP.
// Tant qu'aucun badge n'est défini, on garde les textes traduits par défaut.
const BADGES_DEFAUT = [
  { icon: 'pi-verified', k: 'authentic' },
  { icon: 'pi-box', k: 'ar' },
  { icon: 'pi-sitemap', k: 'genealogy' }
]
const badges = computed(() => {
  const custom = Array.isArray(s.value.badges) ? s.value.badges.filter((b) => b?.titre) : []
  if (custom.length) {
    return custom.map((b) => ({ icon: b.icon || 'pi-verified', t: b.titre, s: b.sous_titre || '' }))
  }
  return BADGES_DEFAUT.map((b) => ({
    icon: b.icon,
    t: t(`home.badges.${b.k}`),
    s: t(`home.badges.${b.k}Sub`)
  }))
})

// Bande généalogie : même principe de repli.
const bande = computed(() => {
  const b = s.value.bandeGenealogie || {}
  return {
    over: b.over || t('publicLayout.nav.genealogy'),
    titre: b.titre || t('home.bandTitle'),
    lead: b.lead || t('home.bandLead'),
    cta: b.cta || t('home.bandCta')
  }
})

function toggleFav(id) {
  const set = new Set(favorites.value)
  set.has(id) ? set.delete(id) : set.add(id)
  favorites.value = set
}
</script>

<template>
  <div>
    <!-- HERO façon boutique : photo + panneau couleur -->
    <section class="hero">
      <div class="hero__photo">
        <div class="hero__bg" :style="{ backgroundImage: `url(${heroImage})` }" />
        <div class="hero__shade" />
        <div class="hero__text">
          <span class="hero__badge">{{ $t('home.edition', { year: new Date().getFullYear() }) }}</span>
          <h1 v-if="s.heroTitre" class="hero__title">{{ s.heroTitre }}</h1>
          <h1 v-else class="hero__title">{{ $t('home.heroTitle1') }}<br />{{ $t('home.heroTitle2') }}</h1>
          <p class="hero__lead">{{ s.heroSousTitre || $t('home.heroLead') }}</p>
          <div class="hero__ctas">
            <router-link :to="s.heroCtaLien || to('/musees')" class="btn-solid">
              {{ s.heroCtaTexte || $t('home.heroCta') }} <i class="pi pi-arrow-right" />
            </router-link>
            <router-link :to="to('/boutiques')" class="btn-ghost">{{ $t('publicLayout.nav.boutiques') }}</router-link>
          </div>
        </div>
      </div>
    </section>

    <!-- Bande de réassurance -->
    <div class="badges">
      <div v-for="b in badges" :key="b.t" class="badge">
        <span class="badge__ic"><i :class="`pi ${b.icon}`" /></span>
        <div><strong>{{ b.t }}</strong><span>{{ b.s }}</span></div>
      </div>
    </div>

    <!-- Œuvres à la une -->
    <section v-if="objects.length" class="wrap">
      <div class="sec-head">
        <div>
          <span class="sec-over">{{ $t('home.edition', { year: new Date().getFullYear() }) }}</span>
          <h2>{{ $t('home.featured') }}</h2>
        </div>
      </div>
      <!-- Une seule œuvre : grande carte « vedette » qui occupe la largeur -->
      <router-link v-if="objects.length === 1" :to="to(`/objets/${objects[0].id}`)" class="spot">
        <div class="spot__img">
          <img v-if="objects[0].photo" :src="objects[0].photo" :alt="objects[0].nom" />
          <div v-else class="ph"><i class="pi pi-box" /></div>
          <span v-if="objects[0].model3d" class="work__3d">3D · AR</span>
        </div>
        <div class="spot__b">
          <span class="spot__over">{{ $t('home.edition', { year: new Date().getFullYear() }) }}</span>
          <h3>{{ objects[0].nom }}</h3>
          <p>{{ objects[0].description || objects[0].nom_commun || $t('home.workFallback') }}</p>
          <span class="spot__go">{{ $t('home.discoverWork') }} <i class="pi pi-arrow-right" /></span>
        </div>
      </router-link>

      <!-- Plusieurs œuvres : grille classique -->
      <div v-else class="works">
        <router-link v-for="o in objects" :key="o.id" :to="to(`/objets/${o.id}`)" class="work">
          <div class="work__img">
            <img v-if="o.photo" :src="o.photo" :alt="o.nom" />
            <div v-else class="ph"><i class="pi pi-box" /></div>
            <button class="work__fav" :class="{ on: favorites.has(o.id) }" @click.stop.prevent="toggleFav(o.id)" :aria-label="$t('common.favorite')">
              <i :class="favorites.has(o.id) ? 'pi pi-heart-fill' : 'pi pi-heart'" />
            </button>
            <span v-if="o.model3d" class="work__3d">3D · AR</span>
            <!-- Mise en avant automatique : l'œuvre est là parce que le public la regarde. -->
            <span v-if="estPopulaire(o.id)" class="work__hot"><i class="pi pi-chart-line" /> {{ $t('home.popular') }}</span>
          </div>
          <div class="work__b">
            <strong>{{ o.nom }}</strong>
            <span>{{ o.nom_commun || $t('home.workFallback') }}</span>
          </div>
        </router-link>
      </div>
    </section>

    <!-- Boutiques : produits en vedette -->
    <section v-if="products.length" class="wrap">
      <div class="sec-head">
        <div>
          <span class="sec-over">{{ $t('boutique.eyebrow') }}</span>
          <h2>{{ $t('home.shopTitle') }}</h2>
        </div>
        <router-link :to="to('/boutiques')" class="see">{{ $t('publicLayout.footer.allShops') }} <i class="pi pi-arrow-right" /></router-link>
      </div>
      <div class="prods">
        <ProductCard v-for="p in products" :key="p.id" :product="p" />
      </div>
    </section>

    <!-- Nos musées -->
    <section v-if="museums.length" class="wrap">
      <div class="sec-head">
        <div>
          <span class="sec-over">{{ $t('publicLayout.nav.museums') }}</span>
          <h2>{{ $t('home.ourMuseums') }}</h2>
        </div>
        <router-link :to="to('/musees')" class="see">{{ $t('home.allMuseums') }} <i class="pi pi-arrow-right" /></router-link>
      </div>
      <div class="museums">
        <router-link v-for="m in museums" :key="m.id" :to="to(`/musees/${m.id}`)" class="mcard">
          <div class="mcard__img">
            <img v-if="m.photo" :src="m.photo" :alt="m.nom" />
            <div v-else class="ph"><i class="pi pi-building" /></div>
            <span v-if="m.type" class="mcard__type">{{ m.type }}</span>
          </div>
          <div class="mcard__b">
            <strong>{{ m.nom }}</strong>
            <p>{{ m.description }}</p>
            <span class="mcard__go">{{ $t('home.heroCta') }} <i class="pi pi-arrow-right" /></span>
          </div>
        </router-link>
      </div>
    </section>

    <!-- Agenda : expositions & événements -->
    <EventsSection :limit="3" />

    <!-- Installer l'application (PWA) -->
    <InstallPwa />

    <!-- Livre d'or -->
    <GuestBook />

    <!-- Nous écrire : le message arrive dans la messagerie de l'ERP -->
    <section class="ps-wrap contact-sec">
      <div class="contact-sec__head">
        <span class="ps-over">{{ $t('contact.eyebrow') }}</span>
        <h2 class="contact-sec__title">{{ $t('contact.title') }}</h2>
        <p class="contact-sec__lead">{{ $t('contact.lead') }}</p>
      </div>
      <ContactForm compact class="contact-sec__form" />
    </section>

    <!-- Bande généalogie -->
    <section class="band">
      <div class="band__in">
        <div>
          <span class="band__over">{{ bande.over }}</span>
          <h2>{{ bande.titre }}</h2>
          <p>{{ bande.lead }}</p>
        </div>
        <router-link :to="to('/genealogie')" class="btn-solid">{{ bande.cta }} <i class="pi pi-arrow-right" /></router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ===== HERO ===== */
.hero { display: grid; grid-template-columns: 1fr; min-height: min(78vh, 680px); background: #0d0f0d; }
.hero__photo { position: relative; background: #171a17; display: flex; align-items: center; overflow: hidden; }
.hero__bg { position: absolute; inset: 0; background: center/cover no-repeat; }
.hero__shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(8,10,8,0.85) 0%, rgba(8,10,8,0.45) 55%, rgba(8,10,8,0.15) 100%); }
.hero__text { position: relative; z-index: 1; padding: 4rem clamp(1.25rem, 5vw, 4.5rem); max-width: 640px; }
.hero__badge {
  display: inline-block; background: var(--site-primary); color: #fff;
  padding: 0.4rem 0.9rem; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; border-radius: 4px;
}
.hero__title {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: clamp(2.6rem, 6.5vw, 5rem); line-height: 1.02; letter-spacing: 0.01em;
  color: #fff; margin: 1.2rem 0 1rem;
}
.hero__lead { color: #d6dad4; font-size: clamp(1rem, 1.4vw, 1.15rem); line-height: 1.65; max-width: 480px; margin: 0 0 1.8rem; }
.hero__ctas { display: flex; gap: 0.8rem; flex-wrap: wrap; }

.btn-solid {
  display: inline-flex; align-items: center; gap: 0.6rem;
  background: var(--site-primary); color: #fff; padding: 0.9rem 1.7rem;
  font-weight: 800; font-size: 0.85rem; letter-spacing: 0.1em; text-transform: uppercase; border-radius: 4px;
  transition: 0.15s;
}
.btn-solid:hover { filter: brightness(1.12); transform: translateY(-1px); }
.btn-ghost {
  display: inline-flex; align-items: center; gap: 0.6rem;
  border: 2px solid rgba(255,255,255,0.85); color: #fff; padding: 0.82rem 1.7rem;
  font-weight: 800; font-size: 0.85rem; letter-spacing: 0.1em; text-transform: uppercase; border-radius: 4px;
  transition: 0.15s;
}
.btn-ghost:hover { background: #fff; color: #0d0f0d; }

/* ===== Réassurance ===== */
.badges { background: #fff; border-bottom: 1px solid #e8e9e6; display: flex; justify-content: center; flex-wrap: wrap; gap: clamp(1.5rem, 5vw, 4.5rem); padding: 1.4rem 1.5rem; }
.badge { display: flex; align-items: center; gap: 0.85rem; }
.badge__ic { width: 46px; height: 46px; border-radius: 50%; background: color-mix(in srgb, var(--site-primary) 10%, #fff); color: var(--site-primary); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }
.badge strong { display: block; font-size: 0.92rem; color: #101210; }
.badge span { font-size: 0.78rem; color: #7c817b; }

/* ===== Sections ===== */
.wrap { max-width: 1240px; margin: 0 auto; padding: 3.4rem 1.5rem 0; }
.sec-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.6rem; }
.sec-over { display: block; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--site-primary); margin-bottom: 0.35rem; }
.sec-head h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 2.1rem); letter-spacing: 0.01em; margin: 0; color: #101210; }
.see {
  color: var(--site-primary); font-weight: 800; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 0.45rem; white-space: nowrap; transition: gap 0.18s;
}
.see:hover { gap: 0.8rem; }

/* Œuvre unique : carte vedette pleine largeur */
.spot {
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; overflow: hidden; transition: 0.18s;
}
.spot:hover { transform: translateY(-4px); box-shadow: 0 20px 44px -20px rgba(10,20,15,0.28); }
.spot__img { position: relative; min-height: 320px; background: #eef0ed; overflow: hidden; }
.spot__img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s; }
.spot:hover .spot__img img { transform: scale(1.04); }
.spot__b { padding: clamp(1.5rem, 4vw, 3rem); display: flex; flex-direction: column; justify-content: center; gap: 0.6rem; }
.spot__over { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--site-primary); }
.spot__b h3 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.6rem, 3.2vw, 2.4rem); margin: 0; color: #101210; line-height: 1.1; }
.spot__b p { margin: 0; color: #5c615c; line-height: 1.65; font-size: 0.95rem; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.spot__go { margin-top: 0.7rem; color: var(--site-primary); font-weight: 800; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 0.45rem; transition: gap 0.18s; }
.spot:hover .spot__go { gap: 0.8rem; }

/* Œuvres */
.works { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.3rem; }
.work { background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: 0.18s; }
.work:hover { transform: translateY(-4px); box-shadow: 0 20px 44px -20px rgba(10,20,15,0.28); }
.work__img { position: relative; aspect-ratio: 1/1; background: #eef0ed; overflow: hidden; }
.work__img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.work:hover .work__img img { transform: scale(1.05); }
.work__fav { position: absolute; top: 0.7rem; right: 0.7rem; width: 36px; height: 36px; border-radius: 50%; border: none; background: rgba(255,255,255,0.92); color: #c0392b; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; }
.work__fav.on { background: #c0392b; color: #fff; }
.work__hot { position: absolute; top: 0.7rem; left: 0.7rem; display: inline-flex; align-items: center; gap: 0.3rem;
  background: #fdf3e0; color: #7a5a10; border: 1px solid #e8c97a; font-size: 0.66rem; font-weight: 800;
  letter-spacing: 0.04em; padding: 0.24rem 0.55rem; border-radius: 999px; }
.work__3d { position: absolute; bottom: 0.7rem; left: 0.7rem; background: var(--site-primary); color: #fff; font-size: 0.66rem; font-weight: 800; letter-spacing: 0.08em; padding: 0.28rem 0.6rem; border-radius: 4px; }
.work__b { padding: 0.9rem 1rem 1.05rem; }
.work__b strong { font-size: 1rem; font-weight: 700; display: block; color: #101210; }
.work__b span { color: #7c817b; font-size: 0.8rem; }

/* Produits */
.prods { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.3rem; }

/* Musées */
.museums { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.4rem; }
.mcard { background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: 0.18s; }
.mcard:hover { transform: translateY(-4px); box-shadow: 0 20px 44px -20px rgba(10,20,15,0.28); }
.mcard__img { position: relative; height: 210px; background: #eef0ed; overflow: hidden; }
.mcard__img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.mcard:hover .mcard__img img { transform: scale(1.04); }
.mcard__type { position: absolute; top: 0.8rem; left: 0.8rem; background: #0d0f0d; color: #fff; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.3rem 0.65rem; border-radius: 4px; }
.mcard__b { padding: 1.1rem 1.2rem 1.3rem; display: flex; flex-direction: column; gap: 0.4rem; }
.mcard__b strong { font-size: 1.2rem; font-weight: 800; color: #101210; }
.mcard__b p { margin: 0; color: #5c615c; font-size: 0.9rem; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mcard__go { margin-top: 0.4rem; color: var(--site-primary); font-weight: 800; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 0.4rem; }

.ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b9beb8; font-size: 2rem; }

/* Bande généalogie */
/* Nous écrire — même gabarit centré que le livre d'or, formulaire en colonne étroite. */
.contact-sec { margin-top: 3.2rem; }
.contact-sec__head { text-align: center; margin-bottom: 1.6rem; }
.contact-sec__head .ps-over { margin-bottom: 0.4rem; }
.contact-sec__title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0 0 0.5rem; color: #101210; }
.contact-sec__lead { color: #5c615c; max-width: 560px; margin: 0 auto; }
.contact-sec__form { max-width: 560px; margin: 0 auto; }

.band { margin-top: 3.6rem; background: #0d0f0d; color: #fff; }
.band__in { max-width: 1240px; margin: 0 auto; padding: 3.2rem 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 2rem; flex-wrap: wrap; }
.band__over { display: block; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: color-mix(in srgb, var(--site-primary) 65%, #fff); margin-bottom: 0.4rem; }
.band h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0 0 0.6rem; color: #fff; }
.band p { margin: 0; max-width: 560px; color: #b9beb8; line-height: 1.6; }

@media (max-width: 880px) {
  .hero__text { padding-top: 5rem; padding-bottom: 5rem; }
  .spot { grid-template-columns: 1fr; }
  .spot__img { min-height: 230px; }
}
</style>
