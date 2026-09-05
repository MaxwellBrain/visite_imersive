<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { compresserImage } from '@/services/image'
import { televerser } from '@/services/stockage'

// ============================================================================
// GALERIE DE VUES — plusieurs images pour un même objet.
// ----------------------------------------------------------------------------
// POURQUOI CE COMPOSANT EXISTE À CÔTÉ DE `ImageUploader`
//
// `ImageUploader` gère UNE image et une seule : sa valeur est une chaîne. La
// tordre en tableau aurait cassé ses onze autres usages (musée, produit,
// événement, portrait, réglages du site). Ici la valeur est une LISTE
// ORDONNÉE de `{ url, legende }`, et l'ordre du tableau est l'ordre
// d'affichage sur la fiche publique.
//
// LA LÉGENDE N'EST PAS UN ORNEMENT. « Profil droit », « revers », « détail de
// la coiffe » : c'est ce qui distingue une galerie d'une pile de photos. Une
// vue sans légende reste acceptée — mieux vaut une vue muette qu'une vue
// manquante — mais le champ est là, sous chaque image, au moment où l'on s'en
// souvient encore.
//
// CE QUE CE COMPOSANT NE FAIT PAS : supprimer le fichier du Storage quand on
// retire une vue. Retirer puis annuler la fiche laisserait sinon une URL en
// base pointant vers un fichier effacé — une image cassée en public. Le coût
// d'un fichier orphelin est très inférieur à celui d'une fiche abîmée.
// ============================================================================

const { t } = useI18n()

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  bucket: { type: String, default: 'photos' },
  // Plafond aligné sur la contrainte `objects_photos_forme` (12 en base). On
  // s'arrête plus tôt côté écran : au-delà d'une poignée de vues, la fiche
  // publique devient un catalogue et le visiteur ne les regarde plus.
  max: { type: Number, default: 8 }
})
const emit = defineEmits(['update:modelValue'])

const inputRef = ref(null)
const enCours = ref(0)       // nombre de fichiers restant à téléverser
const total = ref(0)
const erreur = ref('')

const vues = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))
const reste = computed(() => Math.max(0, props.max - vues.value.length))
const plein = computed(() => reste.value === 0)

function maj(liste) {
  emit('update:modelValue', liste)
}

function choisir() {
  if (plein.value || enCours.value) return
  inputRef.value?.click()
}

// Les fichiers partent UN PAR UN, pas en parallèle. Un conservateur qui dépose
// six photos de reflex depuis une connexion de musée saturerait le lien, et
// c'est l'échec le plus difficile à comprendre : rien ne bouge, puis tout
// échoue. En série, la progression est lisible et un échec n'emporte que sa
// propre image.
async function onFiles(event) {
  const fichiers = Array.from(event.target.files || []).slice(0, reste.value)
  if (!fichiers.length) return

  erreur.value = ''
  total.value = fichiers.length
  enCours.value = fichiers.length
  const ajoutees = []

  for (const fichier of fichiers) {
    try {
      const dataUrl = await compresserImage(fichier)
      const blob = await (await fetch(dataUrl)).blob()
      const url = await televerser(
        new File([blob], fichier.name || 'vue.jpg', { type: blob.type }),
        props.bucket
      )
      ajoutees.push({ url, legende: '' })
    } catch (e) {
      // Une image qui échoue ne doit pas emporter les cinq autres : on la
      // signale et on continue.
      console.warn('[galerie]', fichier.name, e?.message || e)
      erreur.value = t('gallery.uploadFailed', { name: fichier.name })
    } finally {
      enCours.value -= 1
    }
  }

  if (ajoutees.length) maj([...vues.value, ...ajoutees])
  total.value = 0
  if (inputRef.value) inputRef.value.value = ''
}

function retirer(i) {
  maj(vues.value.filter((_, j) => j !== i))
}

function deplacer(i, delta) {
  const j = i + delta
  if (j < 0 || j >= vues.value.length) return
  const liste = vues.value.slice()
  ;[liste[i], liste[j]] = [liste[j], liste[i]]
  maj(liste)
}

function legender(i, valeur) {
  maj(vues.value.map((v, j) => (j === i ? { ...v, legende: valeur } : v)))
}
</script>

<template>
  <div class="gal">
    <ul v-if="vues.length" class="gal__list">
      <li v-for="(v, i) in vues" :key="v.url + i" class="gal__item">
        <div class="gal__thumb">
          <img :src="v.url" :alt="v.legende || $t('gallery.viewN', { n: i + 1 })" loading="lazy" />
          <span class="gal__rank">{{ i + 1 }}</span>
        </div>

        <InputText
          :model-value="v.legende"
          :placeholder="$t('gallery.captionPlaceholder')"
          class="gal__legende"
          size="small"
          @update:model-value="legender(i, $event)"
        />

        <div class="gal__tools">
          <Button
            type="button"
            icon="pi pi-arrow-left"
            text
            rounded
            size="small"
            :disabled="i === 0"
            :aria-label="$t('gallery.moveBefore')"
            v-tooltip.bottom="$t('gallery.moveBefore')"
            @click="deplacer(i, -1)"
          />
          <Button
            type="button"
            icon="pi pi-arrow-right"
            text
            rounded
            size="small"
            :disabled="i === vues.length - 1"
            :aria-label="$t('gallery.moveAfter')"
            v-tooltip.bottom="$t('gallery.moveAfter')"
            @click="deplacer(i, 1)"
          />
          <Button
            type="button"
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="danger"
            :aria-label="$t('gallery.removeView')"
            v-tooltip.bottom="$t('gallery.removeView')"
            @click="retirer(i)"
          />
        </div>
      </li>
    </ul>

    <p v-else class="gal__vide">
      <i class="pi pi-images" />
      {{ $t('gallery.empty') }}
    </p>

    <div class="gal__actions">
      <Button
        type="button"
        size="small"
        icon="pi pi-plus"
        :label="$t('gallery.add')"
        outlined
        :disabled="plein"
        :loading="enCours > 0"
        @click="choisir"
      />
      <small v-if="enCours" class="gal__etat">
        {{ $t('gallery.uploading', { done: total - enCours + 1, total }) }}
      </small>
      <small v-else-if="plein" class="gal__etat">{{ $t('gallery.full', { max }) }}</small>
      <small v-else class="gal__etat">{{ $t('gallery.remaining', { n: reste }) }}</small>
    </div>

    <small v-if="erreur" class="gal__erreur"><i class="pi pi-exclamation-triangle" /> {{ erreur }}</small>

    <input
      ref="inputRef"
      type="file"
      accept="image/*"
      multiple
      class="gal__input"
      @change="onFiles"
    />
  </div>
</template>

<style scoped>
.gal__list {
  list-style: none;
  margin: 0 0 0.7rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
}
.gal__item {
  border: 1px solid var(--vi-border);
  border-radius: 10px;
  padding: 0.5rem;
  background: var(--vi-surface, #fff);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.gal__thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 7px;
  overflow: hidden;
  background: var(--vi-bg);
}
.gal__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Le rang est affiché parce que l'ordre du tableau EST l'ordre d'affichage
   public : sans repère, les flèches déplacent à l'aveugle. */
.gal__rank {
  position: absolute; top: 0.35rem; left: 0.35rem;
  min-width: 1.35rem; height: 1.35rem; padding: 0 0.3rem;
  border-radius: 999px; background: rgba(16, 18, 16, 0.72); color: #fff;
  font-size: 0.72rem; font-weight: 700; line-height: 1.35rem; text-align: center;
}
.gal__legende { width: 100%; font-size: 0.8rem; }
.gal__tools { display: flex; justify-content: center; gap: 0.1rem; }
.gal__vide {
  display: flex; align-items: center; gap: 0.5rem;
  margin: 0 0 0.7rem; padding: 0.85rem 1rem;
  border: 2px dashed var(--vi-border); border-radius: 10px;
  color: var(--vi-muted); font-size: 0.85rem;
}
.gal__vide i { font-size: 1.2rem; opacity: 0.6; }
.gal__actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.gal__etat { color: var(--vi-muted); font-size: 0.76rem; }
.gal__erreur { display: block; margin-top: 0.5rem; color: var(--p-red-500, #ef4444); font-size: 0.78rem; }
.gal__input { display: none; }
</style>
