import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

const KEY = 'musea-cart'

// Panier visiteur (persisté en localStorage) — items :
// { type: 'abonnement'|'assistant_vocal'|'don', refId, museumId, label, montant, devise }
export const useCartStore = defineStore('cart', () => {
  let saved = []
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]') } catch { saved = [] }
  const items = ref(Array.isArray(saved) ? saved : [])

  watch(items, (v) => localStorage.setItem(KEY, JSON.stringify(v)), { deep: true })

  const count = computed(() => items.value.length)
  const total = computed(() => items.value.reduce((s, i) => s + Number(i.montant || 0), 0))

  function add(item) {
    const dup = items.value.some(
      (x) => x.type === item.type && x.refId === item.refId && (x.museumId ?? null) === (item.museumId ?? null)
    )
    if (dup) return false
    items.value.push({ devise: 'FCFA', ...item })
    return true
  }
  function remove(index) { items.value.splice(index, 1) }
  function clear() { items.value = [] }

  return { items, count, total, add, remove, clear }
})
