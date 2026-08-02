<script setup>
import { computed } from 'vue'

// Signale la rareté d'une œuvre à partir des exemplaires apparentés recensés
// dans les collections du monde (« Mémoire Réunifiée »).
//
// La logique : une pièce dont on ne retrouve aucun équivalent est exceptionnelle
// et mérite d'être mise en avant ; une pièce présente dans vingt musées est un
// type courant. Le nombre de PAYS où sont dispersés les frères raconte l'autre
// moitié de l'histoire — celle de l'exil des collections.

const props = defineProps({
  rarity: { type: Object, default: null },   // { nbFreres, nbPays, niveau, score }
  compact: { type: Boolean, default: false } // vignette de catalogue
})

const STYLES = {
  unique:       { ic: 'pi-star-fill', cls: 'is-unique' },
  tres_rare:    { ic: 'pi-star-fill', cls: 'is-tresrare' },
  rare:         { ic: 'pi-star',      cls: 'is-rare' },
  repandu:      { ic: 'pi-globe',     cls: 'is-repandu' },
  tres_repandu: { ic: 'pi-globe',     cls: 'is-tresrepandu' }
}

const style = computed(() => STYLES[props.rarity?.niveau] || null)
const libelle = computed(() => props.rarity ? `rarity.${props.rarity.niveau}` : null)
</script>

<template>
  <div v-if="rarity && style" class="rb" :class="[style.cls, { 'rb--compact': compact }]">
    <i :class="`pi ${style.ic}`" />
    <span class="rb__lbl">{{ $t(libelle) }}</span>
    <span v-if="!compact" class="rb__detail">
      <template v-if="rarity.nbFreres === 0">{{ $t('rarity.noneKnown') }}</template>
      <template v-else>
        {{ $t('rarity.counted', { n: rarity.nbFreres }) }}
        <template v-if="rarity.nbPays"> · {{ $t('rarity.countries', { n: rarity.nbPays }) }}</template>
      </template>
    </span>
  </div>
</template>

<style scoped>
.rb {
  display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.45rem 0.8rem; border-radius: 999px;
  font-size: 0.82rem; font-weight: 700; line-height: 1.3;
  border: 1px solid transparent;
}
.rb--compact { padding: 0.22rem 0.55rem; font-size: 0.7rem; gap: 0.3rem; }
.rb__detail { font-weight: 500; opacity: 0.85; }

/* Plus c'est rare, plus la couleur est chaude et affirmée. */
.is-unique       { background: #fdf3e0; border-color: #e8c97a; color: #7a5a10; }
.is-tresrare     { background: #fdf3e0; border-color: #edd9a6; color: #8a6a20; }
.is-rare         { background: #f2f6f2; border-color: #cfe0d2; color: #2f5c3e; }
.is-repandu      { background: #f4f5f7; border-color: #dfe3e8; color: #5c6470; }
.is-tresrepandu  { background: #f4f5f7; border-color: #e5e8ec; color: #79808b; }
</style>
