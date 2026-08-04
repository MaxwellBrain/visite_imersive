<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useObjectStore } from '@/stores/useObjectStore'

// EN ATTENTE DE PUBLICATION — le contrepoids de l'assistant d'installation.
//
// L'agent crée tout en BROUILLON : rien n'atteint le site public sans qu'un humain
// l'ait relu. Cet écran est l'endroit où ce geste se fait. On y montre le texte
// intégral produit par l'IA, car c'est précisément ce qu'il faut relire — un titre
// seul ne permet pas de repérer une description inventée.
//
// La CASCADE de publication est rappelée ici : une œuvre n'apparaît en ligne que si
// sa salle ET son musée le sont aussi. Publier une œuvre isolée ne la rend pas visible,
// et c'est le piège n°1 du projet.

const { t } = useI18n()
const museums = useMuseumStore()
const sectors = useSectorStore()
const objects = useObjectStore()
const confirm = useConfirm()
const toast = useToast()

const busy = ref(false)

onMounted(() => {
  if (!museums.items.length) museums.load()
  if (!sectors.items.length) sectors.load()
  if (!objects.items.length) objects.load()
})

const museesBrouillon = computed(() => museums.items.filter((m) => !m.published))
const sallesBrouillon = computed(() => sectors.items.filter((s) => !s.published))
const objetsBrouillon = computed(() => objects.items.filter((o) => !o.published))
const total = computed(() =>
  museesBrouillon.value.length + sallesBrouillon.value.length + objetsBrouillon.value.length)

const nomMusee = (id) => museums.items.find((m) => m.id === id)?.nom || '—'
const nomSalle = (id) => sectors.items.find((s) => s.id === id)?.nom || '—'

// Une œuvre ne sera VISIBLE que si sa salle et son musée sont publiés.
// On le signale au lieu de laisser croire qu'un clic suffit.
function bloquee(objet) {
  const salle = sectors.items.find((s) => s.id === objet.sectorId)
  if (!salle) return t('drafts.noRoom')
  if (!salle.published) return t('drafts.roomDraft', { nom: salle.nom })
  const musee = museums.items.find((m) => m.id === salle.museumId)
  if (musee && !musee.published) return t('drafts.museumDraft', { nom: musee.nom })
  return null
}

async function publier(type, item) {
  busy.value = true
  try {
    const patch = { ...item, published: true }
    if (type === 'musee') await museums.update(item.id, patch)
    else if (type === 'salle') await sectors.update(item.id, patch)
    else await objects.update(item.id, patch)
    toast.add({ severity: 'success', summary: t('drafts.published', { nom: item.nom }), life: 2200 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('drafts.failed'), detail: e.message, life: 3500 })
  } finally {
    busy.value = false
  }
}

// Publication en masse, dans l'ORDRE de la cascade : musées, puis salles, puis œuvres.
// L'inverse laisserait des œuvres publiées mais invisibles.
function toutPublier() {
  confirm.require({
    message: t('drafts.allConfirm', { n: total.value }),
    header: t('drafts.allHeader'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('drafts.allAccept'),
    accept: async () => {
      busy.value = true
      let ok = 0
      try {
        for (const m of [...museesBrouillon.value]) { await museums.update(m.id, { ...m, published: true }); ok++ }
        for (const s of [...sallesBrouillon.value]) { await sectors.update(s.id, { ...s, published: true }); ok++ }
        for (const o of [...objetsBrouillon.value]) { await objects.update(o.id, { ...o, published: true }); ok++ }
        toast.add({ severity: 'success', summary: t('drafts.allDone', { n: ok }), life: 3000 })
      } catch (e) {
        toast.add({ severity: 'error', summary: t('drafts.failed'), detail: e.message, life: 4000 })
      } finally {
        busy.value = false
      }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('drafts.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('drafts.subtitle') }}</p>
      </div>
      <Button v-if="total" :label="$t('drafts.publishAll')" icon="pi pi-send"
              :loading="busy" @click="toutPublier" />
    </div>

    <Message severity="info" :closable="false" class="dr__note">
      {{ $t('drafts.reviewNote') }}
    </Message>

    <div v-if="!total" class="vi-empty">
      <i class="pi pi-check-circle" />
      <strong>{{ $t('drafts.emptyTitle') }}</strong>
      <p>{{ $t('drafts.empty') }}</p>
    </div>

    <template v-else>
      <!-- Musées -->
      <section v-if="museesBrouillon.length" class="dr__sec">
        <h2 class="dr__h"><i class="pi pi-building" /> {{ $t('drafts.museums', { n: museesBrouillon.length }) }}</h2>
        <article v-for="m in museesBrouillon" :key="m.id" class="dr__card">
          <div class="dr__b">
            <strong>{{ m.nom }}</strong>
            <span v-if="m.type" class="dr__meta">{{ m.type }}</span>
            <p v-if="m.description" class="dr__txt">{{ m.description }}</p>
          </div>
          <Button icon="pi pi-check" :label="$t('drafts.publish')" size="small"
                  :loading="busy" @click="publier('musee', m)" />
        </article>
      </section>

      <!-- Salles -->
      <section v-if="sallesBrouillon.length" class="dr__sec">
        <h2 class="dr__h"><i class="pi pi-sitemap" /> {{ $t('drafts.rooms', { n: sallesBrouillon.length }) }}</h2>
        <article v-for="s in sallesBrouillon" :key="s.id" class="dr__card">
          <div class="dr__b">
            <strong>{{ s.nom }}</strong>
            <span class="dr__meta">{{ nomMusee(s.museumId) }} · {{ s.emplacement }}</span>
            <p v-if="s.description" class="dr__txt">{{ s.description }}</p>
            <p v-if="s.histoire" class="dr__txt dr__txt--hist">{{ s.histoire }}</p>
          </div>
          <Button icon="pi pi-check" :label="$t('drafts.publish')" size="small"
                  :loading="busy" @click="publier('salle', s)" />
        </article>
      </section>

      <!-- Œuvres -->
      <section v-if="objetsBrouillon.length" class="dr__sec">
        <h2 class="dr__h"><i class="pi pi-box" /> {{ $t('drafts.objects', { n: objetsBrouillon.length }) }}</h2>
        <article v-for="o in objetsBrouillon" :key="o.id" class="dr__card">
          <div class="dr__b">
            <strong>{{ o.nom }}</strong>
            <span class="dr__meta">{{ nomSalle(o.sectorId) }}</span>
            <p v-if="o.description" class="dr__txt">{{ o.description }}</p>
            <Tag v-if="bloquee(o)" :value="bloquee(o)" severity="warn" class="dr__warn" />
          </div>
          <Button icon="pi pi-check" :label="$t('drafts.publish')" size="small"
                  :loading="busy" @click="publier('objet', o)" />
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dr__note { margin-bottom: 1.2rem; }
.dr__sec { margin-bottom: 1.8rem; }
.dr__h { display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vi-muted, #6B7280); margin: 0 0 0.7rem; }
.dr__h i { color: var(--p-primary-color); }
.dr__card {
  display: flex; align-items: flex-start; gap: 1rem;
  background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-left: 3px solid #E8A33D; border-radius: 10px;
  padding: 0.9rem 1.1rem; margin-bottom: 0.6rem;
}
.dr__b { flex: 1; min-width: 0; }
.dr__b strong { display: block; font-size: 1rem; color: var(--vi-text, #1B2A4A); }
.dr__meta { font-size: 0.78rem; color: var(--vi-muted, #6B7280); }
.dr__txt { margin: 0.45rem 0 0; font-size: 0.88rem; line-height: 1.55; color: #4b5563; }
.dr__txt--hist { padding-left: 0.7rem; border-left: 2px solid var(--vi-border, #E9EDF2); font-style: italic; }
.dr__warn { margin-top: 0.5rem; }
</style>
