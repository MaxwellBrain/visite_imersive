<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '@/services/supabase'
import { urlPubliqueTenant, PLATFORM_DOMAIN } from '@/services/host'
import '@/assets/public-site.css'

// Vitrine de la plateforme MUSÉA : présentation + inscription des organisations.
const tenants = ref([])

onMounted(async () => {
  // La RLS ne renvoie que les organisations approuvées.
  const { data } = await supabase
    .from('tenants').select('slug, nom, type').eq('statut', 'approuve').order('id').limit(8)
  tenants.value = data || []
})

const atouts = [
  { icon: 'pi-building', k: 'a1' },
  { icon: 'pi-box', k: 'a2' },
  { icon: 'pi-volume-up', k: 'a3' },
  { icon: 'pi-shopping-bag', k: 'a4' },
  { icon: 'pi-sitemap', k: 'a5' },
  { icon: 'pi-qrcode', k: 'a6' }
]
</script>

<template>
  <div class="pf" style="--site-primary:#0e6f5c">
    <!-- En-tête -->
    <header class="pf-top">
      <span class="pf-logo"><span class="pf-logo__mark">M</span> MUSÉA</span>
      <nav class="pf-top__nav">
        <router-link to="/site">{{ $t('platform.demo') }}</router-link>
        <router-link to="/login" class="pf-top__login">{{ $t('platform.login') }}</router-link>
      </nav>
    </header>

    <!-- Hero -->
    <section class="pf-hero">
      <div class="pf-hero__in">
        <span class="pf-badge">{{ $t('platform.badge') }}</span>
        <h1>{{ $t('platform.heroTitle') }}</h1>
        <p>{{ $t('platform.heroLead') }}</p>
        <div class="pf-ctas">
          <router-link to="/inscription" class="ps-btn">
            {{ $t('platform.cta') }} <i class="pi pi-arrow-right" />
          </router-link>
          <router-link to="/site" class="ps-btn ps-btn--line pf-ghost">{{ $t('platform.seeDemo') }}</router-link>
        </div>
        <p class="pf-free"><i class="pi pi-check-circle" /> {{ $t('platform.freeNote') }}</p>
      </div>
    </section>

    <!-- Ce que la plateforme apporte -->
    <section class="ps-wrap">
      <span class="ps-over">{{ $t('platform.featuresOver') }}</span>
      <h2 class="pf-h2">{{ $t('platform.featuresTitle') }}</h2>
      <div class="pf-grid">
        <article v-for="a in atouts" :key="a.k" class="pf-card ps-card">
          <span class="pf-card__ic"><i :class="`pi ${a.icon}`" /></span>
          <strong>{{ $t(`platform.${a.k}`) }}</strong>
          <p>{{ $t(`platform.${a.k}d`) }}</p>
        </article>
      </div>
    </section>

    <!-- Comment ça marche -->
    <section class="ps-wrap">
      <span class="ps-over">{{ $t('platform.stepsOver') }}</span>
      <h2 class="pf-h2">{{ $t('platform.stepsTitle') }}</h2>
      <ol class="pf-steps">
        <li v-for="n in 4" :key="n">
          <span class="pf-steps__n">{{ n }}</span>
          <div>
            <strong>{{ $t(`platform.s${n}`) }}</strong>
            <p>{{ $t(`platform.s${n}d`) }}</p>
          </div>
        </li>
      </ol>
    </section>

    <!-- Organisations déjà en ligne -->
    <section v-if="tenants.length" class="ps-wrap">
      <span class="ps-over">{{ $t('platform.tenantsOver') }}</span>
      <h2 class="pf-h2">{{ $t('platform.tenantsTitle') }}</h2>
      <div class="pf-tenants">
        <!-- Chaque organisation a SON site sur SON sous-domaine : on quitte donc
             la plateforme, d'où `<a>` plutôt que `<router-link>`. Et c'est cette
             adresse-là qu'on affiche, celle qu'elle communiquera. -->
        <a v-for="t in tenants" :key="t.slug" :href="urlPubliqueTenant(t.slug)" class="pf-tenant ps-card">
          <i class="pi pi-building" />
          <span>
            <strong>{{ t.nom }}</strong>
            <small>{{ t.slug }}.{{ PLATFORM_DOMAIN }}</small>
          </span>
          <i class="pi pi-arrow-right pf-tenant__go" />
        </a>
      </div>
    </section>

    <!-- Appel final -->
    <section class="pf-final">
      <div class="pf-final__in">
        <h2>{{ $t('platform.finalTitle') }}</h2>
        <p>{{ $t('platform.finalLead') }}</p>
        <router-link to="/inscription" class="ps-btn pf-final__btn">
          {{ $t('platform.cta') }} <i class="pi pi-arrow-right" />
        </router-link>
      </div>
    </section>

    <footer class="pf-foot">
      © {{ new Date().getFullYear() }} MUSÉA — {{ $t('platform.footer') }}
    </footer>
  </div>
</template>

<style scoped>
.pf { min-height: 100vh; background: #f6f7f5; color: #101210; font-family: 'Inter', system-ui, sans-serif; }

.pf-top { display: flex; align-items: center; justify-content: space-between; padding: 1rem clamp(1rem, 4vw, 3rem); background: #fff; border-bottom: 1px solid #e8e9e6; }
.pf-logo { display: inline-flex; align-items: center; gap: 0.6rem; font-family: 'Anton', sans-serif; font-size: 1.4rem; letter-spacing: 0.05em; }
.pf-logo__mark { width: 36px; height: 36px; border-radius: 50%; background: #101210; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
.pf-top__nav { display: flex; align-items: center; gap: 1.4rem; }
.pf-top__nav a { font-size: 0.8rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #101210; }
.pf-top__login { border: 2px solid #101210; border-radius: 4px; padding: 0.5rem 1rem; }
.pf-top__login:hover { background: #101210; color: #fff; }

.pf-hero { background: linear-gradient(150deg, #0d0f0d 0%, #12251f 55%, var(--site-primary) 160%); color: #fff; }
.pf-hero__in { max-width: 1240px; margin: 0 auto; padding: clamp(3rem, 8vw, 6rem) 1.5rem; }
.pf-badge { display: inline-block; background: var(--site-primary); color: #fff; padding: 0.4rem 0.9rem; border-radius: 4px; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
.pf-hero h1 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(2.2rem, 6vw, 4.2rem); line-height: 1.04; margin: 1.2rem 0 1rem; max-width: 15ch; }
.pf-hero p { color: #cfd4ce; font-size: clamp(1rem, 1.5vw, 1.2rem); line-height: 1.65; max-width: 620px; margin: 0 0 2rem; }
.pf-ctas { display: flex; gap: 0.8rem; flex-wrap: wrap; }
.pf-ghost { color: #fff; border-color: rgba(255,255,255,0.85); }
.pf-free { margin: 1.6rem 0 0 !important; font-size: 0.88rem; color: #9fd8c6 !important; }
.pf-free i { margin-right: 0.4rem; }

.pf-h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0 0 1.6rem; }

.pf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.2rem; }
.pf-card { padding: 1.3rem 1.4rem; }
.pf-card__ic { width: 48px; height: 48px; border-radius: 50%; background: color-mix(in srgb, var(--site-primary) 10%, #fff); color: var(--site-primary); display: flex; align-items: center; justify-content: center; font-size: 1.25rem; margin-bottom: 0.9rem; }
.pf-card strong { display: block; font-size: 1.05rem; margin-bottom: 0.35rem; }
.pf-card p { margin: 0; color: #5c615c; font-size: 0.9rem; line-height: 1.55; }

.pf-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.2rem; }
.pf-steps li { display: flex; gap: 0.9rem; }
.pf-steps__n { width: 34px; height: 34px; border-radius: 50%; background: var(--site-primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; flex: 0 0 auto; }
.pf-steps strong { display: block; margin-bottom: 0.3rem; }
.pf-steps p { margin: 0; color: #5c615c; font-size: 0.88rem; line-height: 1.55; }

.pf-tenants { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.pf-tenant { display: flex; align-items: center; gap: 0.85rem; padding: 1rem 1.1rem; transition: 0.15s; }
.pf-tenant:hover { transform: translateY(-3px); box-shadow: 0 16px 32px -18px rgba(10,20,15,0.3); }
.pf-tenant > i:first-child { color: var(--site-primary); font-size: 1.2rem; }
.pf-tenant span { flex: 1; min-width: 0; }
.pf-tenant strong { display: block; font-size: 0.98rem; }
.pf-tenant small { color: #7c817b; font-size: 0.78rem; }
.pf-tenant__go { color: var(--site-primary); }

.pf-final { margin-top: 4rem; background: #0d0f0d; color: #fff; }
.pf-final__in { max-width: 1240px; margin: 0 auto; padding: 3.5rem 1.5rem; text-align: center; }
.pf-final h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.6rem, 3.5vw, 2.4rem); margin: 0 0 0.7rem; }
.pf-final p { color: #b9beb8; max-width: 560px; margin: 0 auto 1.8rem; line-height: 1.6; }
.pf-final__btn { display: inline-flex; }

.pf-foot { text-align: center; padding: 1.4rem; font-size: 0.8rem; color: #7d827c; background: #0d0f0d; border-top: 1px solid #1e211e; }
</style>
