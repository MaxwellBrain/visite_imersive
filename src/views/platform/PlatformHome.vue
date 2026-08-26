<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '@/services/supabase'
import { urlPubliqueTenant, PLATFORM_DOMAIN } from '@/services/host'
import { COLLECTIONS, INSTITUTIONS_IDENTIFIEES } from '@/services/sourcesInfo'
import '@/assets/public-site.css'

// Vitrine de la plateforme MUSÉA : présentation + inscription des organisations.
const tenants = ref([])

// LA DÉMONSTRATION VIT CHEZ ELLE, PAS ICI.
//
// Les deux boutons « Voir une démo » menaient à `/site`, qui charge « la
// première organisation approuvée » — soit le site de la Fondation, servi sur le
// domaine de la PLATEFORME. Un visiteur y voyait donc une institution là où on
// lui présente un hébergeur, et le même contenu existait à deux adresses.
// On l'envoie désormais sur le sous-domaine du locataire de démonstration.
const SLUG_DEMO = 'musea'
const urlDemo = urlPubliqueTenant(SLUG_DEMO)

// Ce que la plateforme héberge vraiment. Aucun de ces nombres n'est écrit en
// dur : une vitrine qui annonce des chiffres inventés se démonte au premier
// clic, et ceux-ci grandiront d'eux-mêmes à mesure que des institutions
// arrivent. Un seul appel les rapporte tous.
const chiffres = ref(null)

onMounted(async () => {
  // La RLS ne renvoie que les organisations approuvées et le contenu publié.
  const [orgs, stats] = await Promise.all([
    supabase.from('tenants')
      .select('slug, nom, type, logo, sigle, ville, region')
      .eq('statut', 'approuve').order('id').limit(12),
    supabase.rpc('statistiques_plateforme')
  ])
  tenants.value = orgs.data || []
  chiffres.value = (stats.data && stats.data[0]) || null
})

// L'initiale sert de logo tant qu'une organisation n'en a pas déposé : mieux
// vaut une pastille tenue qu'un cadre vide ou une image cassée.
function initiale(t) {
  return (t.sigle || t.nom || '?').trim().charAt(0).toUpperCase()
}
function lieu(t) {
  return [t.ville, t.region].filter(Boolean).join(', ')
}

// L'ordre compte : ce qui distingue la plateforme vient en premier. Un musée
// qui hésite ne lit pas les huit cartes — il lit les deux premières.
const atouts = [
  { icon: 'pi-box', k: 'a2' },          // 3D et réalité augmentée
  { icon: 'pi-volume-up', k: 'a3' },    // guide intelligent
  { icon: 'pi-building', k: 'a1' },     // musées et salles
  { icon: 'pi-sitemap', k: 'a5' },      // généalogie
  { icon: 'pi-qrcode', k: 'a6' },       // billetterie
  { icon: 'pi-shopping-bag', k: 'a4' }, // boutique
  { icon: 'pi-palette', k: 'a7' },      // identité visuelle
  { icon: 'pi-chart-line', k: 'a8' }    // fréquentation
]

// Les trois constats, dans l'ordre où une institution les rencontre.
const problemes = [
  { icon: 'pi-desktop', k: 'prob1' },
  { icon: 'pi-wallet', k: 'prob2' },
  { icon: 'pi-user-minus', k: 'prob3' }
]

// FAQ — repliée par défaut, ouverte par le visiteur. Le <details> natif s'en
// charge : ni JavaScript, ni bibliothèque, et le clavier fonctionne d'office.
const questions = [1, 2, 3, 4, 5]

// Photos d'illustration des dispositifs immersifs — Pexels, licence commerciale
// explicite, converties au format web. La première tient deux colonnes : deux
// visiteurs casqués dans une galerie, c'est l'image qui dit le mieux de quoi on
// parle, et elle montre un public africain plutôt qu'un décor européen.
const experiences = [
  { img: 'xp-vr-galerie.jpg', k: 'xp2', large: true },
  { img: 'xp-ar.jpg', k: 'xp1' },
  { img: 'xp-galerie.jpg', k: 'xp3' },
  { img: 'xp-patrimoine.jpg', k: 'xp4' },
  { img: 'xp-vr.jpg', k: 'xp5' }
]
</script>

<template>
  <div class="pf" style="--site-primary:#0e6f5c">
    <!-- En-tête -->
    <header class="pf-top">
      <span class="pf-logo"><span class="pf-logo__mark">M</span> MUSÉA</span>
      <nav class="pf-top__nav">
        <a :href="urlDemo">{{ $t('platform.demo') }}</a>
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
          <a :href="urlDemo" class="ps-btn ps-btn--line pf-ghost">{{ $t('platform.seeDemo') }}</a>
        </div>
        <p class="pf-free"><i class="pi pi-check-circle" /> {{ $t('platform.freeNote') }}</p>
      </div>
    </section>

    <!-- Ce que la plateforme héberge, en chiffres réels. Masqué tant qu'il n'y a
         rien à montrer : « 0 œuvre » dessert plus qu'il ne rassure. -->
    <section v-if="chiffres && chiffres.oeuvres > 0" class="pf-chiffres">
      <div class="pf-chiffres__in">
        <div><strong>{{ chiffres.organisations }}</strong><span>{{ $t('platform.kOrgs') }}</span></div>
        <div><strong>{{ chiffres.musees }}</strong><span>{{ $t('platform.kMuseums') }}</span></div>
        <div><strong>{{ chiffres.salles }}</strong><span>{{ $t('platform.kRooms') }}</span></div>
        <div><strong>{{ chiffres.oeuvres }}</strong><span>{{ $t('platform.kWorks') }}</span></div>
      </div>
    </section>

    <!-- LE CONSTAT — avant de proposer, nommer ce que l'institution vit déjà.
         C'est là qu'elle se reconnaît, et c'est ce qui rend la suite crédible. -->
    <section class="ps-wrap">
      <span class="ps-over">{{ $t('platform.probOver') }}</span>
      <h2 class="pf-h2">{{ $t('platform.probTitle') }}</h2>
      <div class="pf-probs">
        <article v-for="p in problemes" :key="p.k" class="pf-prob">
          <span class="pf-prob__ic"><i :class="`pi ${p.icon}`" /></span>
          <strong>{{ $t(`platform.${p.k}`) }}</strong>
          <p>{{ $t(`platform.${p.k}d`) }}</p>
        </article>
      </div>
      <p class="pf-prob__sol"><i class="pi pi-arrow-right" /> {{ $t('platform.probSolution') }}</p>
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

    <!-- L'EXPÉRIENCE VISITEUR — montrer plutôt que décrire.
         ⚠️ Ce sont des PHOTOS D'ILLUSTRATION de dispositifs immersifs existants,
         pas des captures de MUSÉA. Les légendes décrivent donc l'expérience et
         ne prétendent nulle part que ces images viennent de la plateforme. -->
    <section class="pf-xp">
      <div class="pf-xp__in">
        <span class="ps-over pf-xp__over">{{ $t('platform.xpOver') }}</span>
        <h2 class="pf-h2 pf-xp__h2">{{ $t('platform.xpTitle') }}</h2>
        <p class="pf-xp__lead">{{ $t('platform.xpLead') }}</p>
        <div class="pf-xp__grille">
          <figure v-for="x in experiences" :key="x.img" :class="['pf-xp__item', x.large && 'pf-xp__item--large']">
            <img :src="`/experience/${x.img}`" :alt="$t(`platform.${x.k}`)" loading="lazy" />
            <figcaption>
              <strong>{{ $t(`platform.${x.k}`) }}</strong>
              <span>{{ $t(`platform.${x.k}d`) }}</span>
            </figcaption>
          </figure>
        </div>
        <a :href="urlDemo" class="ps-btn pf-xp__cta">
          {{ $t('platform.seeDemo') }} <i class="pi pi-arrow-right" />
        </a>
      </div>
    </section>

    <!-- BANDE IMMERSIVE — le propos, en une image et trois phrases.
         L'image appartient au projet (public/hero), ce n'est pas le contenu
         d'une organisation hébergée : la plateforme se présente elle-même. -->
    <section class="pf-bande">
      <div class="pf-bande__in">
        <span class="pf-bande__over">{{ $t('platform.bandOver') }}</span>
        <h2>{{ $t('platform.bandTitle') }}</h2>
        <p>{{ $t('platform.bandLead') }}</p>
        <router-link to="/inscription" class="ps-btn">
          {{ $t('platform.cta') }} <i class="pi pi-arrow-right" />
        </router-link>
      </div>
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
          <span class="pf-tenant__logo">
            <img v-if="t.logo" :src="t.logo" :alt="t.nom" loading="lazy" />
            <span v-else>{{ initiale(t) }}</span>
          </span>
          <span class="pf-tenant__txt">
            <strong>{{ t.nom }}</strong>
            <small v-if="lieu(t)" class="pf-tenant__lieu"><i class="pi pi-map-marker" /> {{ lieu(t) }}</small>
            <small class="pf-tenant__url">{{ t.slug }}.{{ PLATFORM_DOMAIN }}</small>
          </span>
          <i class="pi pi-arrow-right pf-tenant__go" />
        </a>
      </div>
    </section>

    <!-- MÉMOIRE RÉUNIFIÉE — les collections interrogées.
         Pas de logos : ces institutions ne sont liées à MUSÉA par aucun accord,
         et afficher leurs marques laisserait croire le contraire. Leurs noms et
         la portée réellement mesurée suffisent. -->
    <section class="ps-wrap">
      <span class="ps-over">{{ $t('platform.sourcesOver') }}</span>
      <h2 class="pf-h2">{{ $t('platform.sourcesTitle') }}</h2>
      <!-- Ce que ces objets étaient avant la vitrine : portés, dansés, transmis.
           C'est ce lien-là qu'on cherche à rétablir en les retrouvant. -->
      <figure class="pf-vitrine">
        <img src="/experience/collections-cortege.jpg" :alt="$t('platform.sourcesCaption')" loading="lazy" />
        <figcaption>{{ $t('platform.sourcesCaption') }}</figcaption>
      </figure>
      <p class="pf-sources__lead">{{ $t('platform.sourcesLead', { n: INSTITUTIONS_IDENTIFIEES }) }}</p>
      <div class="pf-sources">
        <a v-for="c in COLLECTIONS" :key="c.cle" :href="c.url" target="_blank" rel="noopener"
           class="pf-source ps-card">
          <span class="pf-source__ic" :class="{ 'pf-source__ic--reseau': c.type === 'reseau' }">
            <i :class="c.type === 'reseau' ? 'pi pi-share-alt' : 'pi pi-building'" />
          </span>
          <span class="pf-source__txt">
            <strong>{{ c.nom }}</strong>
            <small>{{ $t(c.lieu) }}</small>
          </span>
          <span v-if="c.institutions" class="pf-source__n">
            {{ $t('platform.sourcesCount', { n: c.institutions }) }}
          </span>
          <span v-else-if="c.milliers" class="pf-source__n">{{ $t('platform.sourcesMany') }}</span>
        </a>
      </div>
      <p class="pf-sources__note"><i class="pi pi-info-circle" /> {{ $t('platform.sourcesNote') }}</p>
    </section>

    <!-- PREUVE SOCIALE — sans témoignage inventé. La plateforme démarre : on le
         dit, et on en fait une raison d'en être plutôt qu'un aveu. Le compteur
         est celui de la base, pas un chiffre d'ambiance. -->
    <section v-if="chiffres" class="ps-wrap pf-preuve">
      <div class="pf-preuve__in">
        <h2 class="pf-h2">{{ $t('platform.proofTitle') }}</h2>
        <p>{{ $t('platform.proofLead') }}</p>
        <span class="pf-preuve__n">
          <i class="pi pi-check-circle" /> {{ $t('platform.proofCount', { n: chiffres.organisations }) }}
        </span>
      </div>
    </section>

    <!-- QUESTIONS FRÉQUENTES — <details> natif : aucun script, et le clavier
         fonctionne sans qu'on ait à s'en occuper. -->
    <section class="ps-wrap">
      <span class="ps-over">{{ $t('platform.faqOver') }}</span>
      <h2 class="pf-h2">{{ $t('platform.faqTitle') }}</h2>
      <div class="pf-faq">
        <details v-for="q in questions" :key="q" class="pf-faq__item">
          <summary>{{ $t(`platform.faqQ${q}`) }}<i class="pi pi-chevron-down" /></summary>
          <p>{{ $t(`platform.faqR${q}`) }}</p>
        </details>
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
      <div class="pf-foot__cols">
        <div>
          <span class="pf-foot__t">{{ $t('platform.footNav') }}</span>
          <a :href="urlDemo">{{ $t('platform.demo') }}</a>
          <router-link to="/inscription">{{ $t('platform.cta') }}</router-link>
          <router-link to="/login">{{ $t('platform.login') }}</router-link>
        </div>
        <div>
          <span class="pf-foot__t">{{ $t('platform.footLegal') }}</span>
          <router-link to="/conditions">{{ $t('signup.termsLink') }}</router-link>
          <router-link to="/confidentialite">{{ $t('signup.privacyLink') }}</router-link>
        </div>
      </div>
      <p class="pf-foot__bas">
        © {{ new Date().getFullYear() }} MUSÉA — {{ $t('platform.footer') }} {{ $t('platform.footRights') }}
      </p>
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

/* Le dégradé reste posé PAR-DESSUS la photo : sans lui, le titre blanc devient
   illisible dès que l'image s'éclaircit. L'image donne l'atmosphère, le dégradé
   garantit la lecture.
   `hero-plateforme.jpg` est la version web de `hero-main.jpg` : celle-ci fait
   7952 × 5304 px pour 1,3 Mo, ce qui n'a aucun sens en fond d'écran. Ramenée à
   1920 px, elle pèse 113 Ko — 91 % de moins, et nette sur tous les écrans. */
.pf-hero {
  position: relative;
  background:
    linear-gradient(150deg, rgba(13, 15, 13, 0.90) 0%, rgba(18, 37, 31, 0.78) 50%, rgba(14, 111, 92, 0.62) 160%),
    url('/hero/hero-plateforme.jpg') center / cover no-repeat;
  color: #fff;
}

/* Motif de losanges — le vocabulaire graphique des tissus ndop et des façades
   de chefferie. Tracé en CSS : aucune image à télécharger, et il s'adapte à
   toutes les tailles d'écran. */
.pf-hero::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 6px;
  background:
    repeating-linear-gradient(135deg, var(--site-primary) 0 14px, #d4af37 14px 28px);
  opacity: 0.9;
}
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
.pf-tenant__logo { width: 46px; height: 46px; flex: none; border-radius: 10px; overflow: hidden; display: grid; place-items: center; background: color-mix(in srgb, var(--site-primary) 10%, #fff); color: var(--site-primary); font-family: 'Anton', sans-serif; font-size: 1.2rem; }
.pf-tenant__logo img { width: 100%; height: 100%; object-fit: cover; }
.pf-tenant__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.pf-tenant strong { display: block; font-size: 0.98rem; }
.pf-tenant small { color: #7c817b; font-size: 0.78rem; }
.pf-tenant__lieu i { font-size: 0.7rem; margin-right: 0.2rem; }
.pf-tenant__url { color: var(--site-primary) !important; }
.pf-tenant__go { color: var(--site-primary); flex: none; }

/* Bande immersive — le voile est assez dense pour que le texte tienne, assez
   léger pour qu'on reconnaisse l'architecture derrière. */
.pf-bande {
  background:
    linear-gradient(rgba(13, 15, 13, 0.74) 0%, rgba(13, 15, 13, 0.88) 100%),
    url('/hero/hero-4.jpg') center / cover no-repeat;
  color: #fff;
  margin-top: 3.5rem;
}
.pf-bande__in { max-width: 780px; margin: 0 auto; padding: clamp(3.5rem, 8vw, 5.5rem) 1.5rem; text-align: center; }
.pf-bande__over { display: inline-block; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #d4af37; margin-bottom: 0.9rem; }
.pf-bande h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.6rem, 4vw, 2.6rem); line-height: 1.1; margin: 0 0 1rem; }
.pf-bande p { color: #cfd6d1; line-height: 1.7; font-size: clamp(0.95rem, 1.4vw, 1.05rem); margin: 0 auto 1.8rem; max-width: 60ch; }

/* L'expérience visiteur — fond sombre : les photos y gagnent, et la section
   tranche avec les blocs de texte qui la précèdent. */
.pf-xp { background: #101210; color: #fff; }
.pf-xp__in { max-width: 1240px; margin: 0 auto; padding: clamp(2.6rem, 6vw, 4rem) 1.5rem; }
.pf-xp__over { color: #8fa9a1; }
.pf-xp__h2 { color: #fff; }
.pf-xp__lead { max-width: 68ch; color: #b9c4bf; line-height: 1.7; margin: -0.9rem 0 1.8rem; font-size: 0.96rem; }
.pf-xp__grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.9rem; }
.pf-xp__item { position: relative; margin: 0; border-radius: 12px; overflow: hidden; background: #1b1f1c; }
.pf-xp__item img { width: 100%; height: 100%; min-height: 190px; object-fit: cover; display: block; transition: transform 0.45s ease; }
.pf-xp__item:hover img { transform: scale(1.05); }
/* La première photo est la plus démonstrative : on lui donne deux colonnes
   quand la place le permet. */
@media (min-width: 760px) {
  .pf-xp__item--large { grid-column: span 2; grid-row: span 2; }
  .pf-xp__item--large img { min-height: 400px; }
}
.pf-xp__item figcaption { position: absolute; inset: auto 0 0 0; padding: 2.6rem 1rem 0.9rem; background: linear-gradient(transparent, rgba(0, 0, 0, 0.9)); display: flex; flex-direction: column; gap: 0.15rem; }
.pf-xp__item figcaption strong { font-size: 0.92rem; }
.pf-xp__item figcaption span { font-size: 0.78rem; color: #c3ccc8; line-height: 1.45; }
.pf-xp__cta { margin-top: 1.6rem; display: inline-flex; }

/* Vitrine illustrée de la section « Mémoire réunifiée » */
.pf-vitrine { margin: 0 0 1.6rem; border-radius: 12px; overflow: hidden; position: relative; }
.pf-vitrine img { width: 100%; height: clamp(180px, 30vw, 320px); object-fit: cover; display: block; }
.pf-vitrine figcaption { position: absolute; inset: auto 0 0 0; padding: 2.6rem 1.2rem 1rem; background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); color: #e9eeec; font-size: 0.86rem; line-height: 1.55; }

/* Collections interrogées */
.pf-sources__lead { max-width: 68ch; color: #5c615c; line-height: 1.65; margin: -0.9rem 0 1.6rem; font-size: 0.95rem; }
.pf-sources { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1rem; }
.pf-source { display: flex; align-items: center; gap: 0.85rem; padding: 1rem 1.1rem; transition: 0.15s; }
.pf-source:hover { transform: translateY(-3px); box-shadow: 0 16px 32px -18px rgba(10,20,15,0.3); }
.pf-source__ic { width: 42px; height: 42px; flex: none; border-radius: 10px; display: grid; place-items: center; background: #f0f2ef; color: #5c615c; font-size: 1.05rem; }
.pf-source__ic--reseau { background: color-mix(in srgb, var(--site-primary) 12%, #fff); color: var(--site-primary); }
.pf-source__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pf-source strong { font-size: 0.95rem; }
.pf-source small { color: #7c817b; font-size: 0.78rem; }
.pf-source__n { flex: none; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--site-primary); text-align: right; max-width: 8rem; line-height: 1.35; }
.pf-sources__note { display: flex; align-items: flex-start; gap: 0.4rem; margin: 1.2rem 0 0; font-size: 0.8rem; color: #7c817b; line-height: 1.55; }

/* Bandeau de chiffres — sobre et sombre, pour trancher avec les sections
   claires qui l'entourent sans ajouter une couleur de plus. */
.pf-chiffres { background: #101210; color: #fff; }
.pf-chiffres__in { max-width: 1240px; margin: 0 auto; padding: 2.2rem 1.5rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1.5rem; text-align: center; }
.pf-chiffres__in div { display: flex; flex-direction: column; gap: 0.25rem; }
.pf-chiffres strong { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; font-size: clamp(1.9rem, 4vw, 2.6rem); line-height: 1; }
.pf-chiffres span { font-size: 0.76rem; letter-spacing: 0.12em; text-transform: uppercase; color: #9aa39c; }

.pf-final { margin-top: 4rem; background: #0d0f0d; color: #fff; }
.pf-final__in { max-width: 1240px; margin: 0 auto; padding: 3.5rem 1.5rem; text-align: center; }
.pf-final h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.6rem, 3.5vw, 2.4rem); margin: 0 0 0.7rem; }
.pf-final p { color: #b9beb8; max-width: 560px; margin: 0 auto 1.8rem; line-height: 1.6; }
.pf-final__btn { display: inline-flex; }

/* ---------- Téléphone ----------
   Les grilles se replient déjà toutes seules (mesuré : une colonne pour les
   cartes, deux pour les chiffres). Ce qui manque, c'est la PRISE : les liens
   d'en-tête et de pied de page font 17 px de haut, soit un tiers de ce qu'un
   doigt vise sans se tromper. */
@media (max-width: 640px) {
  .pf-top { flex-wrap: wrap; gap: 0.6rem; }
  .pf-top__nav { gap: 0.8rem; }
  .pf-top__nav a,
  .pf-foot a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  /* Le bouton bordé garde sa boîte, on l'agrandit sans l'étirer. */
  .pf-top__login { padding: 0.7rem 1rem; }

  /* Un appel à l'action seul se rate sur un écran étroit : on le donne en
     pleine largeur, les deux l'un sous l'autre. */
  .pf-ctas { flex-direction: column; align-items: stretch; }
  .pf-ctas .ps-btn { justify-content: center; }
}

/* Le constat */
.pf-probs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.2rem; }
.pf-prob { border-left: 3px solid #e2e5e1; padding: 0.2rem 0 0.2rem 1.1rem; }
.pf-prob__ic { display: inline-flex; width: 34px; height: 34px; border-radius: 8px; background: #f0f2ef; color: #7c817b; align-items: center; justify-content: center; margin-bottom: 0.7rem; }
.pf-prob strong { display: block; font-size: 1rem; margin-bottom: 0.35rem; }
.pf-prob p { margin: 0; color: #5c615c; font-size: 0.9rem; line-height: 1.6; }
.pf-prob__sol { display: flex; align-items: flex-start; gap: 0.5rem; margin: 1.8rem 0 0; padding: 1rem 1.2rem; background: color-mix(in srgb, var(--site-primary) 8%, #fff); border-radius: 10px; font-size: 1rem; font-weight: 600; color: #16463b; }
.pf-prob__sol i { color: var(--site-primary); margin-top: 0.25rem; }

/* Preuve sociale */
.pf-preuve__in { background: #101210; color: #fff; border-radius: 14px; padding: clamp(2rem, 5vw, 3rem); text-align: center; }
.pf-preuve__in .pf-h2 { color: #fff; margin-bottom: 0.8rem; }
.pf-preuve__in p { color: #b9c4bf; line-height: 1.7; max-width: 62ch; margin: 0 auto 1.4rem; }
.pf-preuve__n { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 999px; padding: 0.5rem 1.1rem; font-size: 0.85rem; font-weight: 600; }
.pf-preuve__n i { color: #6fcbb2; }

/* Questions fréquentes */
.pf-faq { display: flex; flex-direction: column; gap: 0.6rem; }
.pf-faq__item { background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; overflow: hidden; }
.pf-faq__item summary { cursor: pointer; padding: 1rem 1.2rem; font-weight: 600; font-size: 0.96rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; list-style: none; }
.pf-faq__item summary::-webkit-details-marker { display: none; }
.pf-faq__item summary i { color: var(--site-primary); font-size: 0.8rem; transition: transform 0.25s ease; flex: none; }
.pf-faq__item[open] summary i { transform: rotate(180deg); }
.pf-faq__item p { margin: 0; padding: 0 1.2rem 1.1rem; color: #5c615c; line-height: 1.7; font-size: 0.92rem; }

/* Pied de page */
.pf-foot { padding: 2.4rem 1.5rem 1.6rem; font-size: 0.82rem; color: #7d827c; background: #0d0f0d; border-top: 1px solid #1e211e; }
.pf-foot__cols { max-width: 1240px; margin: 0 auto 1.8rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.6rem; }
.pf-foot__cols > div { display: flex; flex-direction: column; gap: 0.45rem; align-items: flex-start; }
.pf-foot__t { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #f0f2ef; margin-bottom: 0.25rem; }
.pf-foot a { color: #9aa39c; text-decoration: none; }
.pf-foot a:hover { color: #fff; }
.pf-foot__bas { max-width: 1240px; margin: 0 auto; padding-top: 1.2rem; border-top: 1px solid #1e211e; text-align: center; }
</style>
