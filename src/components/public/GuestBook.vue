<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
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

// LA MOYENNE, AVANT LES MESSAGES.
//
// Quatre cartes disent « des gens sont venus ». Une note moyenne dit « et ils
// ont aimé » — en un coup d'œil, avant même qu'on ait lu une ligne. C'est ce
// que cherche un visiteur qui hésite à réserver.
const moyenne = computed(() => {
  const notes = reviews.value.map((r) => r.note).filter((n) => n > 0)
  if (!notes.length) return null
  return notes.reduce((a, b) => a + b, 0) / notes.length
})
// Une décimale, virgule française via la locale du navigateur.
const moyenneAffichee = computed(() =>
  moyenne.value == null ? '' : moyenne.value.toLocaleString(undefined, {
    minimumFractionDigits: 1, maximumFractionDigits: 1
  }))

// Teinte de la pastille, dérivée du nom. Toutes identiques, les avatars
// donnaient un mur uniforme où l'on ne distinguait plus une voix d'une autre.
// On ne sort pas de la couleur du locataire — seule la proportion change, si
// bien que le mur reste à la marque du musée.
const MELANGES = [10, 17, 24, 31, 38]
function teinte(nom) {
  let somme = 0
  for (const c of String(nom || '?')) somme += c.codePointAt(0)
  return MELANGES[somme % MELANGES.length]
}

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

    <!-- La note d'ensemble : ce que le visiteur veut savoir avant de lire. -->
    <div v-if="moyenne" class="gb-score">
      <strong class="gb-score__n">{{ moyenneAffichee }}</strong>
      <div class="gb-score__r">
        <span class="gb-score__stars" :aria-label="`${moyenneAffichee} / 5`">
          <i
            v-for="n in 5" :key="n"
            :class="n <= Math.round(moyenne) ? 'pi pi-star-fill' : 'pi pi-star'"
          />
        </span>
        <span class="gb-score__c">{{ $t('guestbook.count', reviews.length) }}</span>
      </div>
    </div>

    <!-- LES VOIX D'ABORD, LE FORMULAIRE ENSUITE.
         La disposition précédente mettait le formulaire à gauche, donc en
         premier : on demandait au visiteur d'écrire avant de lui avoir montré
         ce que les autres avaient dit. Un livre d'or convainc par ce qu'il
         contient, pas par son stylo. -->
    <div class="gb-list">
      <p v-if="!reviews.length" class="ps-muted gb-vide">{{ $t('guestbook.empty') }}</p>
      <article v-for="r in reviews" :key="r.id" class="gb-rev ps-card">
        <p class="gb-rev__msg">{{ r.message }}</p>
        <div class="gb-rev__head">
          <span
            class="gb-rev__av"
            :style="{ background: `color-mix(in srgb, var(--site-primary, #0e6f5c) ${teinte(r.nom)}%, #fff)` }"
          >{{ initials(r.nom) }}</span>
          <div class="gb-rev__who">
            <strong>{{ r.nom }}</strong>
            <span class="gb-rev__date">{{ dateFmt(r.createdAt) }}</span>
          </div>
          <span v-if="r.note" class="gb-rev__note" :aria-label="`${r.note} / 5`">
            <i v-for="n in 5" :key="n" :class="n <= r.note ? 'pi pi-star-fill' : 'pi pi-star'" />
          </span>
        </div>
      </article>
    </div>

    <div class="gb-grid">
      <!-- Formulaire -->
      <form class="gb-form ps-card" @submit.prevent="submit">
        <h3 class="gb-form__t">{{ $t('guestbook.formTitle') }}</h3>
        <div v-if="sent" class="gb-sent">
          <i class="pi pi-check-circle" />
          <strong>{{ $t('guestbook.thanks') }}</strong>
          <p>{{ $t('guestbook.moderationNote') }}</p>
          <button type="button" class="ps-link" @click="sent = false">{{ $t('guestbook.writeAnother') }}</button>
        </div>

        <template v-else>
          <label class="vi-req gb-lbl">{{ $t('guestbook.fName') }}</label>
          <input v-model="form.nom" type="text" class="gb-in" :aria-label="$t('guestbook.fName')" :placeholder="$t('guestbook.fNamePlaceholder')" maxlength="60" />

          <label class="gb-lbl">{{ $t('guestbook.fRating') }}</label>
          <div class="gb-stars">
            <button
              v-for="n in 5" :key="n" type="button" class="gb-star"
              :class="{ on: n <= form.note }" :aria-label="`${n}/5`" @click="form.note = n"
            ><i :class="n <= form.note ? 'pi pi-star-fill' : 'pi pi-star'" /></button>
          </div>

          <label class="vi-req gb-lbl">{{ $t('guestbook.fMessage') }}</label>
          <textarea v-model="form.message" class="gb-in gb-ta" rows="4" :aria-label="$t('guestbook.fMessage')" :placeholder="$t('guestbook.fMessagePlaceholder')" maxlength="600" />

          <p v-if="error" class="gb-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
          <button type="submit" class="ps-btn" :disabled="sending">
            <i :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-send'" /> {{ $t('guestbook.submit') }}
          </button>
          <p class="gb-note">{{ $t('guestbook.moderationNote') }}</p>
        </template>
      </form>

    </div>
  </section>
</template>

<style scoped>
.gb-head { text-align: center; margin-bottom: 1.8rem; }
.gb-head .ps-over { margin-bottom: 0.4rem; }
.gb-title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0 0 0.5rem; color: #101210; }
.gb-lead { color: #5c615c; max-width: 560px; margin: 0 auto; }

/* La note d'ensemble, posée entre le titre et les voix. */
.gb-score {
  display: flex; align-items: center; justify-content: center; gap: 0.9rem;
  margin: 0 0 1.9rem;
}
.gb-score__n {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400;
  font-size: 3.1rem; line-height: 1; color: #101210;
  font-variant-numeric: tabular-nums;
}
.gb-score__r { display: flex; flex-direction: column; gap: 0.15rem; }
.gb-score__stars { color: #e0a800; font-size: 0.95rem; letter-spacing: 0.08em; }
.gb-score__c { font-size: 0.82rem; color: #7c817b; }

/* Le formulaire ne réclame plus la moitié de la section : il vient après les
   témoignages, dans une colonne étroite et centrée. */
.gb-grid { display: grid; grid-template-columns: minmax(0, 34rem); justify-content: center; margin-top: 2.2rem; }
@media (max-width: 880px) { .gb-grid { grid-template-columns: 1fr; } }

.gb-form { padding: 1.4rem 1.5rem 1.5rem; display: flex; flex-direction: column; }
.gb-form__t {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: 1.05rem; letter-spacing: 0.02em; color: #101210; margin: 0 0 1rem;
}
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

/* `auto-fit` : à quatre messages, `auto-fill` réservait des colonnes vides et
   les cartes se tassaient à gauche. */
.gb-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; align-content: start; }
.gb-vide { grid-column: 1 / -1; text-align: center; }

/* La carte se lit de haut en bas comme un témoignage : la parole, puis qui l'a
   dite. L'ordre inverse — signature d'abord — faisait ressembler chaque avis à
   une ligne de tableau. */
.gb-rev { padding: 1.3rem 1.3rem 1.1rem; display: flex; flex-direction: column; gap: 0.9rem; }

.gb-rev__msg {
  margin: 0; flex: 1;
  font-size: 1rem; line-height: 1.65; color: #2b302c;
  position: relative; padding-top: 1.5rem;
}
/* Le guillemet ouvrant : il signale une VOIX, et distingue d'un coup d'œil un
   livre d'or d'une liste de notes. */
.gb-rev__msg::before {
  content: '\201C';
  position: absolute; top: -0.55rem; left: -0.15rem;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 3.2rem; line-height: 1;
  color: color-mix(in srgb, var(--site-primary, #0e6f5c) 26%, #fff);
}

.gb-rev__head { display: flex; align-items: center; gap: 0.7rem; padding-top: 0.8rem; border-top: 1px solid #eef0ed; }
.gb-rev__av {
  width: 38px; height: 38px; border-radius: 50%; flex: 0 0 auto;
  color: var(--site-primary, #0e6f5c);
  display: flex; align-items: center; justify-content: center; font-weight: 800;
}
.gb-rev__who { min-width: 0; }
.gb-rev__who strong { display: block; font-size: 0.92rem; color: #101210; }
.gb-rev__date { font-size: 0.74rem; color: #7c817b; }
/* Les cinq positions sont toujours dessinées, les manquantes en creux : sans
   cela un 4/5 et un 5/5 se ressemblaient au premier coup d'œil. */
.gb-rev__note { margin-left: auto; color: #e0a800; font-size: 0.72rem; white-space: nowrap; letter-spacing: 0.06em; }
.gb-rev__note .pi-star { color: #dcdedb; }
</style>
