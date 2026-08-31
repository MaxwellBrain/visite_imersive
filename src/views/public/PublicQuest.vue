<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { quete, etapes, valider } from '@/services/quetes'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSiteLink } from '@/composables/useSiteLink'

// LA CHASSE AU TRÉSOR — la visite devient active.
//
// Le visiteur reçoit un indice qui NE NOMME PAS l'œuvre : il doit la chercher des yeux
// dans la salle. Ce n'est qu'une fois l'étape validée que la pièce se révèle.
// C'est le serveur qui juge la réponse : valider côté navigateur rendrait la quête
// contournable en une ligne de console.

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const { to } = useSiteLink()

const q = ref(null)
const liste = ref([])
const saisies = ref({})     // stepId -> texte tapé
const erreurs = ref({})     // stepId -> message
const busy = ref(null)      // stepId en cours de validation
const chargement = ref(true)
const badgeGagne = ref(null)

const faites = computed(() => liste.value.filter((e) => e.fait).length)
const progression = computed(() =>
  liste.value.length ? Math.round((faites.value / liste.value.length) * 100) : 0)
const termine = computed(() => liste.value.length > 0 && faites.value === liste.value.length)
// On ne montre qu'une énigme à la fois : la suivante non résolue.
const courante = computed(() => liste.value.find((e) => !e.fait) || null)

async function charger() {
  chargement.value = true
  const id = Number(route.params.id)
  q.value = await quete(id)
  liste.value = q.value ? await etapes(id) : []
  chargement.value = false
}
onMounted(charger)
watch(() => route.params.id, charger)

async function repondre(etape) {
  erreurs.value[etape.stepId] = ''
  busy.value = etape.stepId
  try {
    const r = await valider(etape.stepId, saisies.value[etape.stepId] || null)
    if (!r.ok) {
      erreurs.value[etape.stepId] =
        r.raison === 'connexion_requise' ? t('quest.needLogin')
        : r.raison === 'mauvaise_reponse' ? t('quest.wrong')
        : t('quest.failed')
      return
    }
    if (r.badge) badgeGagne.value = r.badge
    await charger()
  } finally {
    busy.value = null
  }
}

function partager() {
  const texte = t('quest.shareText', { badge: badgeGagne.value, musee: q.value?.musee })
  if (navigator.share) navigator.share({ title: q.value?.titre, text: texte, url: location.href }).catch(() => {})
  else navigator.clipboard?.writeText(`${texte} ${location.href}`)
}
</script>

<template>
  <div class="qz">
    <div class="ps-wrap">
      <p v-if="chargement" class="ps-muted">{{ $t('common.loading') }}</p>

      <template v-else-if="q">
        <router-link :to="to(`/musees/${q.museumId}`)" class="qz__back">
          <i class="pi pi-arrow-left" /> {{ q.musee }}
        </router-link>

        <header class="qz__head">
          <span class="ps-over"><i class="pi pi-compass" /> {{ $t('quest.eyebrow') }}</span>
          <h1 class="qz__title">{{ q.titre }}</h1>
          <p v-if="q.description" class="qz__lead">{{ q.description }}</p>
          <span v-if="q.dureeMin" class="qz__meta">{{ $t('quest.duration', { n: q.dureeMin }) }}</span>
        </header>

        <!-- Progression -->
        <div class="qz__bar">
          <div class="qz__fill" :style="{ width: progression + '%' }" />
        </div>
        <p class="qz__count">{{ $t('quest.progress', { n: faites, t: liste.length }) }}</p>

        <!-- Badge obtenu -->
        <section v-if="termine" class="qz__win">
          <i class="pi pi-star-fill" />
          <div>
            <strong>{{ badgeGagne || q.badgeNom || $t('quest.done') }}</strong>
            <p>{{ $t('quest.wonText') }}</p>
          </div>
          <button class="ps-btn ps-btn--sm" @click="partager">
            <i class="pi pi-share-alt" /> {{ $t('quest.share') }}
          </button>
        </section>

        <!-- L'énigme en cours : une seule à la fois -->
        <section v-else-if="courante" class="qz__card">
          <span class="qz__num">{{ $t('quest.step', { n: faites + 1 }) }}</span>
          <p class="qz__indice">{{ courante.indice }}</p>

          <template v-if="courante.question">
            <label class="qz__q">{{ courante.question }}</label>
            <div class="qz__form">
              <input
                v-model="saisies[courante.stepId]"
                type="text"
                :aria-label="$t('quest.answerPlaceholder')" :placeholder="$t('quest.answerPlaceholder')"
                @keydown.enter="repondre(courante)"
              />
              <button class="ps-btn" :disabled="busy === courante.stepId" @click="repondre(courante)">
                <i :class="busy === courante.stepId ? 'pi pi-spin pi-spinner' : 'pi pi-check'" />
                {{ $t('quest.validate') }}
              </button>
            </div>
          </template>

          <!-- Sans question, on valide en déclarant avoir trouvé -->
          <button v-else class="ps-btn qz__found" :disabled="busy === courante.stepId" @click="repondre(courante)">
            <i :class="busy === courante.stepId ? 'pi pi-spin pi-spinner' : 'pi pi-eye'" />
            {{ $t('quest.found') }}
          </button>

          <p v-if="erreurs[courante.stepId]" class="qz__err">
            <i class="pi pi-times-circle" /> {{ erreurs[courante.stepId] }}
          </p>
          <p v-if="!auth.user" class="qz__hint">
            <i class="pi pi-info-circle" />
            {{ $t('quest.loginHint') }}
            <router-link :to="to('/connexion')">{{ $t('quest.loginLink') }}</router-link>
          </p>
        </section>

        <!-- Œuvres déjà trouvées : elles ne se révèlent qu'ici -->
        <section v-if="faites" class="qz__found-list">
          <h2 class="ps-title">{{ $t('quest.foundTitle', { n: faites }) }}</h2>
          <div class="qz__grid">
            <router-link
              v-for="e in liste.filter((x) => x.fait)" :key="e.stepId"
              :to="to(`/objets/${e.objectId}`)" class="qz__item"
            >
              <img v-if="e.photo" :src="e.photo" :alt="e.oeuvre" loading="lazy" decoding="async" />
              <div v-else class="qz__ph"><i class="pi pi-box" /></div>
              <div class="qz__item-b">
                <strong>{{ e.oeuvre }}</strong>
                <small>{{ e.salle }}</small>
              </div>
            </router-link>
          </div>
        </section>
      </template>

      <p v-else class="ps-muted">{{ $t('quest.notFound') }}</p>
    </div>
  </div>
</template>

<style scoped>
.qz { padding: 1.6rem 0 3rem; }
.qz__back { display: inline-flex; align-items: center; gap: 0.45rem; color: #5c615c; font-size: 0.88rem; margin-bottom: 1.1rem; text-decoration: none; }
.qz__back:hover { color: var(--site-primary, #0e6f5c); }
.qz__head { margin-bottom: 1.3rem; }
.qz__title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.7rem, 4vw, 2.4rem); margin: 0.4rem 0 0.5rem; color: #101210; }
.qz__lead { color: #5c615c; line-height: 1.65; max-width: 66ch; margin: 0 0 0.4rem; }
.qz__meta { font-size: 0.8rem; color: #7c817b; }

.qz__bar { height: 8px; background: #e8ebe6; border-radius: 999px; overflow: hidden; }
.qz__fill { height: 100%; background: var(--site-primary, #0e6f5c); transition: width 0.4s ease; }
.qz__count { font-size: 0.82rem; color: #7c817b; margin: 0.4rem 0 1.4rem; }

.qz__card { background: #fff; border: 1px solid #e8e9e6; border-left: 4px solid var(--gold, #c9a227); border-radius: 12px; padding: 1.4rem 1.5rem; }
.qz__num { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold, #c9a227); }
.qz__indice { font-size: 1.08rem; line-height: 1.7; color: #101210; margin: 0.5rem 0 1.1rem; }
.qz__q { display: block; font-size: 0.88rem; font-weight: 700; color: #3c403c; margin-bottom: 0.5rem; }
.qz__form { display: flex; gap: 0.6rem; }
.qz__form input { flex: 1; border: 1px solid #dcdedb; border-radius: 8px; padding: 0.7rem 0.9rem; font-family: inherit; font-size: 0.95rem; }
.qz__form input:focus { outline: none; border-color: var(--site-primary, #0e6f5c); }
.qz__found { width: 100%; justify-content: center; }
.qz__err { color: #c0392b; font-size: 0.87rem; margin: 0.7rem 0 0; display: flex; align-items: center; gap: 0.4rem; }
.qz__hint { font-size: 0.82rem; color: #7c817b; margin: 0.8rem 0 0; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.qz__hint a { color: var(--site-primary, #0e6f5c); font-weight: 700; }

.qz__win { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; background: linear-gradient(120deg, #fdf6e3, #f7efdc); border: 1px solid #e8d9a8; border-radius: 14px; padding: 1.4rem 1.5rem; }
.qz__win > i { font-size: 2rem; color: var(--gold, #c9a227); }
.qz__win strong { display: block; font-size: 1.15rem; color: #6b4f10; }
.qz__win p { margin: 0.2rem 0 0; font-size: 0.9rem; color: #7a6532; }
.qz__win > div { flex: 1; min-width: 180px; }

.qz__found-list { margin-top: 2rem; }
.qz__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.9rem; }
.qz__item { background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; overflow: hidden; text-decoration: none; display: block; }
.qz__item img, .qz__ph { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
.qz__ph { background: #f2f4f1; display: flex; align-items: center; justify-content: center; color: #b9bdb7; font-size: 1.5rem; }
.qz__item-b { padding: 0.6rem 0.75rem 0.8rem; }
.qz__item-b strong { display: block; font-size: 0.9rem; color: #101210; line-height: 1.3; }
.qz__item-b small { color: #7c817b; font-size: 0.76rem; }
</style>
