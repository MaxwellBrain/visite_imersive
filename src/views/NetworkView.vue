<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/useAuthStore'
import { annuaire, chercherOeuvres, mesLiens, proposer, decider, rompre } from '@/services/reseau'

// RÉSEAU — deux volets : avec qui je suis lié, et ce que cela me donne à voir.
//
// L'intérêt du module « Mémoire Réunifiée » est de retrouver les objets frères dispersés
// dans le monde. Le réseau ajoute ce que ces API ne diront jamais : les pièces sœurs qui
// se trouvent chez une institution VOISINE, sur la plateforme. Réunir ce qui est à portée
// avant de chercher à Berlin.

const { t } = useI18n()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

const onglet = ref('liens')      // liens | oeuvres
const liens = ref([])
const orgs = ref([])
const oeuvres = ref([])
const recherche = ref('')
const busy = ref(false)
const chargement = ref(true)

const recus = computed(() => liens.value.filter((l) => l.recu && l.statut === 'propose'))
const actifs = computed(() => liens.value.filter((l) => l.statut === 'accepte'))
const envoyes = computed(() => liens.value.filter((l) => !l.recu && l.statut === 'propose'))
// On ne propose que ce qui n'est pas déjà lié, dans un sens ou dans l'autre.
const disponibles = computed(() => orgs.value.filter((o) => !o.dejaLie))

async function charger() {
  chargement.value = true
  ;[liens.value, orgs.value] = await Promise.all([mesLiens(auth.tenantId), annuaire()])
  chargement.value = false
}
onMounted(charger)

async function agir(fn, succes) {
  busy.value = true
  try {
    await fn()
    await charger()
    toast.add({ severity: 'success', summary: succes, life: 2400 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('network.failed'), detail: e.message, life: 3800 })
  } finally {
    busy.value = false
  }
}

const envoyerDemande = (org) =>
  agir(() => proposer(auth.tenantId, org.tenantId), t('network.sent', { nom: org.nom }))

const repondre = (lien, accepte) =>
  agir(() => decider(lien.id, accepte), accepte ? t('network.accepted') : t('network.refused'))

function couper(lien) {
  confirm.require({
    message: t('network.breakConfirm', { nom: lien.autre?.nom }),
    header: t('network.breakHeader'), icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('network.break'), acceptClass: 'p-button-danger',
    accept: () => agir(() => rompre(lien.id), t('network.broken'))
  })
}

async function explorer() {
  busy.value = true
  oeuvres.value = await chercherOeuvres(recherche.value.trim() || null)
  busy.value = false
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('network.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('network.subtitle') }}</p>
      </div>
    </div>

    <div class="nw__tabs">
      <button :class="{ on: onglet === 'liens' }" @click="onglet = 'liens'">
        {{ $t('network.tabLinks') }}
        <span v-if="recus.length" class="nw__badge">{{ recus.length }}</span>
      </button>
      <button :class="{ on: onglet === 'oeuvres' }" @click="onglet = 'oeuvres'; explorer()">
        {{ $t('network.tabWorks') }}
      </button>
    </div>

    <!-- ─────────── Volet 1 : les liens ─────────── -->
    <template v-if="onglet === 'liens'">
      <Message severity="info" :closable="false" class="nw__note">{{ $t('network.consentNote') }}</Message>

      <p v-if="chargement" class="vi-muted">{{ $t('common.loading') }}</p>

      <template v-else>
        <!-- Demandes reçues : c'est NOUS qui décidons -->
        <section v-if="recus.length" class="nw__sec">
          <h2 class="nw__h"><i class="pi pi-inbox" /> {{ $t('network.received', { n: recus.length }) }}</h2>
          <article v-for="l in recus" :key="l.id" class="nw__card nw__card--pending">
            <div class="nw__b">
              <strong>{{ l.autre?.nom }}</strong>
              <span class="nw__meta">{{ $t('network.wantsToShare') }}</span>
            </div>
            <div class="nw__act">
              <Button :label="$t('network.accept')" icon="pi pi-check" size="small"
                      :loading="busy" @click="repondre(l, true)" />
              <Button :label="$t('network.refuse')" icon="pi pi-times" size="small"
                      severity="secondary" text :loading="busy" @click="repondre(l, false)" />
            </div>
          </article>
        </section>

        <section v-if="actifs.length" class="nw__sec">
          <h2 class="nw__h"><i class="pi pi-link" /> {{ $t('network.active', { n: actifs.length }) }}</h2>
          <article v-for="l in actifs" :key="l.id" class="nw__card nw__card--ok">
            <div class="nw__b">
              <strong>{{ l.autre?.nom }}</strong>
              <span class="nw__meta">{{ $t('network.sharing') }}</span>
            </div>
            <Button icon="pi pi-times" text rounded severity="danger"
                    :aria-label="$t('network.break')" @click="couper(l)" />
          </article>
        </section>

        <section v-if="envoyes.length" class="nw__sec">
          <h2 class="nw__h"><i class="pi pi-send" /> {{ $t('network.sentTitle', { n: envoyes.length }) }}</h2>
          <article v-for="l in envoyes" :key="l.id" class="nw__card">
            <div class="nw__b">
              <strong>{{ l.autre?.nom }}</strong>
              <span class="nw__meta">{{ $t('network.awaiting') }}</span>
            </div>
            <Tag :value="$t('network.pending')" severity="warn" />
          </article>
        </section>

        <section class="nw__sec">
          <h2 class="nw__h"><i class="pi pi-building" /> {{ $t('network.directory') }}</h2>
          <p v-if="!disponibles.length" class="vi-muted">{{ $t('network.noOrgs') }}</p>
          <article v-for="o in disponibles" :key="o.tenantId" class="nw__card">
            <div class="nw__b">
              <strong>{{ o.nom }}</strong>
              <span class="nw__meta">{{ o.type || '—' }} · {{ o.slug }}</span>
            </div>
            <Button :label="$t('network.propose')" icon="pi pi-plus" size="small"
                    severity="secondary" outlined :loading="busy" @click="envoyerDemande(o)" />
          </article>
        </section>
      </template>
    </template>

    <!-- ─────────── Volet 2 : les œuvres du réseau ─────────── -->
    <template v-else>
      <Message severity="info" :closable="false" class="nw__note">{{ $t('network.worksNote') }}</Message>

      <div class="nw__search">
        <InputText v-model="recherche" :placeholder="$t('network.searchPlaceholder')"
                   @keydown.enter="explorer" />
        <Button icon="pi pi-search" :label="$t('network.search')" :loading="busy" @click="explorer" />
      </div>

      <p v-if="!oeuvres.length && !busy" class="vi-muted nw__empty">{{ $t('network.noWorks') }}</p>

      <div v-else class="nw__grid">
        <article v-for="o in oeuvres" :key="o.id" class="nw__work">
          <div class="nw__work-img">
            <img v-if="o.photo" :src="o.photo" :alt="o.nom" loading="lazy" decoding="async" />
            <div v-else class="nw__ph"><i class="pi pi-box" /></div>
          </div>
          <div class="nw__work-b">
            <strong>{{ o.nom }}</strong>
            <small v-if="o.nomCommun">{{ o.nomCommun }}</small>
            <span class="nw__work-loc"><i class="pi pi-map-marker" /> {{ o.musee }} · {{ o.salle }}</span>
            <Tag :value="o.organisation" severity="secondary" class="nw__work-org" />
          </div>
        </article>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nw__tabs { display: flex; gap: 0.4rem; margin-bottom: 1.1rem; }
.nw__tabs button {
  background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 999px; padding: 0.5rem 1.1rem; font-family: inherit; font-size: 0.88rem;
  font-weight: 700; color: var(--vi-muted, #6B7280); cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.45rem;
}
.nw__tabs button.on { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }
.nw__badge { background: #E8A33D; color: #fff; border-radius: 999px; padding: 0 0.4rem; font-size: 0.72rem; }

.nw__note { margin-bottom: 1.1rem; }
.nw__sec { margin-bottom: 1.6rem; }
.nw__h { display: flex; align-items: center; gap: 0.5rem; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vi-muted, #6B7280); margin: 0 0 0.65rem; }
.nw__h i { color: var(--p-primary-color); }

.nw__card {
  display: flex; align-items: center; gap: 1rem;
  background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 10px; padding: 0.85rem 1.1rem; margin-bottom: 0.55rem;
}
.nw__card--pending { border-left: 3px solid #E8A33D; }
.nw__card--ok { border-left: 3px solid #2f7d4a; }
.nw__b { flex: 1; min-width: 0; }
.nw__b strong { display: block; color: var(--vi-text, #1B2A4A); }
.nw__meta { font-size: 0.78rem; color: var(--vi-muted, #6B7280); }
.nw__act { display: flex; gap: 0.4rem; }

.nw__search { display: flex; gap: 0.6rem; margin-bottom: 1.2rem; }
.nw__search :deep(input) { flex: 1; }
.nw__empty { padding: 1.5rem 0; }

.nw__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 1rem; }
.nw__work { background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2); border-radius: 10px; overflow: hidden; }
.nw__work-img { aspect-ratio: 4 / 3; background: var(--vi-surface-2, #F1F3F6); }
.nw__work-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nw__ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b9bdb7; font-size: 1.7rem; }
.nw__work-b { padding: 0.75rem 0.9rem 0.9rem; display: flex; flex-direction: column; gap: 0.25rem; }
.nw__work-b strong { font-size: 0.94rem; color: var(--vi-text, #1B2A4A); line-height: 1.3; }
.nw__work-b small { color: var(--vi-muted, #6B7280); font-style: italic; font-size: 0.8rem; }
.nw__work-loc { font-size: 0.76rem; color: var(--vi-muted, #6B7280); }
.nw__work-org { align-self: flex-start; margin-top: 0.25rem; }
</style>
