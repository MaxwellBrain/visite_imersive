<script setup>
// Documents juridiques de la PLATEFORME (nexacode.store) : conditions
// d'utilisation et politique de confidentialité. Une seule vue, deux documents :
// leur structure est identique, seul le contenu change.
//
// ⚠️ Ces textes décrivent fidèlement le fonctionnement réel du service (ce qui
// est collecté, où c'est hébergé, qui peut y accéder), mais ils n'ont pas été
// relus par un juriste. À faire valider avant d'ouvrir les inscriptions au
// public : une plateforme qui héberge les données d'institutions et encaisse
// des paiements pour elles engage sa responsabilité sur ces deux pages.
//
// À ne pas confondre avec `site_settings.mentions_legales` / `.confidentialite`,
// qui sont les textes de CHAQUE organisation, affichés sur SON site.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import '@/assets/public-site.css'

const route = useRoute()
const doc = computed(() => (route.name === 'platform-privacy' ? 'privacy' : 'terms'))
const sections = [1, 2, 3, 4, 5, 6]
</script>

<template>
  <div class="lg">
    <header class="lg-top">
      <router-link to="/" class="lg-logo"><span class="lg-logo__mark">M</span> MUSÉA</router-link>
    </header>

    <main class="lg-main">
      <h1>{{ $t(`legal.${doc}.title`) }}</h1>
      <p class="lg-lead">{{ $t(`legal.${doc}.lead`) }}</p>
      <p class="lg-maj">{{ $t('legal.updated') }}</p>

      <section v-for="n in sections" :key="n" class="lg-sec">
        <h2>{{ $t(`legal.${doc}.s${n}t`) }}</h2>
        <p>{{ $t(`legal.${doc}.s${n}b`) }}</p>
      </section>

      <p class="lg-contact">{{ $t('legal.contact') }}</p>
      <router-link to="/" class="ps-link lg-retour"><i class="pi pi-arrow-left" /> {{ $t('legal.back') }}</router-link>
    </main>
  </div>
</template>

<style scoped>
.lg { min-height: 100vh; background: #f6f7f5; color: #101210; font-family: 'Inter', system-ui, sans-serif; }
.lg-top { padding: 1rem clamp(1rem, 4vw, 3rem); background: #fff; border-bottom: 1px solid #e8e9e6; }
.lg-logo { display: inline-flex; align-items: center; gap: 0.6rem; font-family: 'Anton', sans-serif; font-size: 1.35rem; letter-spacing: 0.05em; color: #101210; text-decoration: none; }
.lg-logo__mark { width: 34px; height: 34px; border-radius: 50%; background: #101210; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
.lg-main { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
.lg-main h1 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 1.9rem; margin: 0 0 0.6rem; }
.lg-lead { font-size: 1rem; color: #4a504a; line-height: 1.6; margin: 0 0 0.5rem; }
.lg-maj { font-size: 0.8rem; color: #7c817b; margin: 0 0 2rem; }
.lg-sec { margin-bottom: 1.6rem; }
.lg-sec h2 { font-size: 1.05rem; margin: 0 0 0.4rem; }
.lg-sec p { margin: 0; line-height: 1.65; color: #333833; font-size: 0.92rem; }
.lg-contact { margin: 2rem 0 1.5rem; padding: 1rem 1.1rem; background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; font-size: 0.9rem; line-height: 1.6; }
.lg-retour { display: inline-flex; align-items: center; gap: 0.4rem; }
</style>
