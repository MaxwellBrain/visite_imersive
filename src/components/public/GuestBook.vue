<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { pubReviews, pubAddReview } from '@/services/publicApi'

// Livre d'or : les visiteurs laissent un mot, publié après modération dans l'ERP.
const props = defineProps({ museumId: { type: Number, default: null } })

const { t } = useI18n()
const reviews = ref([])
const form = reactive({ nom: '', message: '', note: 5 })
const sending = ref(false)
const sent = ref(false)
const error = ref('')

onMounted(async () => { reviews.value = await pubReviews(9, props.museumId) })

function dateFmt(d) { return d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '' }
function initials(n) { return (n || '?').trim().charAt(0).toUpperCase() }

async function submit() {
  error.value = ''
  if (!form.nom.trim() || !form.message.trim()) { error.value = t('guestbook.errRequired'); return }
  sending.value = true
  try {
    await pubAddReview({ nom: form.nom.trim(), message: form.message.trim(), note: form.note, museumId: props.museumId })
    sent.value = true
    form.nom = ''; form.message = ''; form.note = 5
  } catch (e) {
    error.value = e.message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="ps-wrap gb">
    <div class="gb-head">
      <span class="ps-over">{{ $t('guestbook.eyebrow') }}</span>
      <h2 class="gb-title">{{ $t('guestbook.title') }}</h2>
      <p class="gb-lead">{{ $t('guestbook.lead') }}</p>
    </div>

    <div class="gb-grid">
      <!-- Formulaire -->
      <form class="gb-form ps-card" @submit.prevent="submit">
        <div v-if="sent" class="gb-sent">
          <i class="pi pi-check-circle" />
          <strong>{{ $t('guestbook.thanks') }}</strong>
          <p>{{ $t('guestbook.moderationNote') }}</p>
          <button type="button" class="ps-link" @click="sent = false">{{ $t('guestbook.writeAnother') }}</button>
        </div>

        <template v-else>
          <label class="vi-req gb-lbl">{{ $t('guestbook.fName') }}</label>
          <input v-model="form.nom" type="text" class="gb-in" :placeholder="$t('guestbook.fNamePlaceholder')" maxlength="60" />

          <label class="gb-lbl">{{ $t('guestbook.fRating') }}</label>
          <div class="gb-stars">
            <button
              v-for="n in 5" :key="n" type="button" class="gb-star"
              :class="{ on: n <= form.note }" :aria-label="`${n}/5`" @click="form.note = n"
            ><i :class="n <= form.note ? 'pi pi-star-fill' : 'pi pi-star'" /></button>
          </div>

          <label class="vi-req gb-lbl">{{ $t('guestbook.fMessage') }}</label>
          <textarea v-model="form.message" class="gb-in gb-ta" rows="4" :placeholder="$t('guestbook.fMessagePlaceholder')" maxlength="600" />

          <p v-if="error" class="gb-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
          <button type="submit" class="ps-btn" :disabled="sending">
            <i :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-send'" /> {{ $t('guestbook.submit') }}
          </button>
          <p class="gb-note">{{ $t('guestbook.moderationNote') }}</p>
        </template>
      </form>

      <!-- Avis publiés -->
      <div class="gb-list">
        <p v-if="!reviews.length" class="ps-muted">{{ $t('guestbook.empty') }}</p>
        <article v-for="r in reviews" :key="r.id" class="gb-rev ps-card">
          <div class="gb-rev__head">
            <span class="gb-rev__av">{{ initials(r.nom) }}</span>
            <div>
              <strong>{{ r.nom }}</strong>
              <span class="gb-rev__date">{{ dateFmt(r.createdAt) }}</span>
            </div>
            <span v-if="r.note" class="gb-rev__note">
              <i v-for="n in r.note" :key="n" class="pi pi-star-fill" />
            </span>
          </div>
          <p class="gb-rev__msg">{{ r.message }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gb-head { text-align: center; margin-bottom: 1.8rem; }
.gb-head .ps-over { margin-bottom: 0.4rem; }
.gb-title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0 0 0.5rem; color: #101210; }
.gb-lead { color: #5c615c; max-width: 560px; margin: 0 auto; }

.gb-grid { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 1.6rem; align-items: start; }
@media (max-width: 880px) { .gb-grid { grid-template-columns: 1fr; } }

.gb-form { padding: 1.4rem 1.5rem 1.5rem; display: flex; flex-direction: column; }
.gb-lbl { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #5c615c; margin-bottom: 0.4rem; }
.gb-in {
  border: 1px solid #dcdedb; border-radius: 6px; padding: 0.7rem 0.85rem;
  font-family: inherit; font-size: 0.95rem; color: #101210; margin-bottom: 1rem; width: 100%;
}
.gb-in:focus { outline: none; border-color: var(--site-primary, #0e6f5c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-primary) 15%, transparent); }
.gb-ta { resize: vertical; line-height: 1.55; }
.gb-stars { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
.gb-star { background: none; border: none; cursor: pointer; font-size: 1.35rem; color: #d4d7d2; padding: 0.1rem; }
.gb-star.on { color: #e0a800; }
.gb-err { color: #c0392b; font-size: 0.85rem; margin: 0 0 0.7rem; }
.gb-note { font-size: 0.76rem; color: #7c817b; margin: 0.8rem 0 0; text-align: center; }
.gb-sent { text-align: center; padding: 1.5rem 0.5rem; }
.gb-sent > i { font-size: 2.6rem; color: var(--site-primary, #0e6f5c); }
.gb-sent strong { display: block; font-size: 1.15rem; margin: 0.7rem 0 0.3rem; color: #101210; }
.gb-sent p { color: #5c615c; font-size: 0.88rem; margin: 0 0 1rem; }
.gb-sent .ps-link { background: none; border: none; cursor: pointer; font-family: inherit; }

.gb-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; align-content: start; }
.gb-rev { padding: 1.1rem 1.2rem; }
.gb-rev__head { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.6rem; }
.gb-rev__av {
  width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto;
  background: color-mix(in srgb, var(--site-primary) 12%, #fff); color: var(--site-primary, #0e6f5c);
  display: flex; align-items: center; justify-content: center; font-weight: 800;
}
.gb-rev__head strong { display: block; font-size: 0.95rem; color: #101210; }
.gb-rev__date { font-size: 0.75rem; color: #7c817b; }
.gb-rev__note { margin-left: auto; color: #e0a800; font-size: 0.75rem; white-space: nowrap; }
.gb-rev__msg { margin: 0; font-size: 0.9rem; line-height: 1.6; color: #3c403c; }
</style>
