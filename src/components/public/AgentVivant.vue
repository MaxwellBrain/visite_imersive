<script setup>
import { ref, computed, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { demanderJeton, ouvrirConversation } from '@/services/geminiLive'

// PARLER À L'ŒUVRE.
//
// L'audioguide classique récite. Ici le visiteur POSE SA QUESTION, à voix
// haute, et peut couper la parole. C'est ce qui change la nature de la visite :
// il n'écoute plus un texte, il interroge un objet.
//
// TOUT EST FACULTATIF. Sans clé Gemini configurée, le bouton reste visible mais
// désactivé, et l'écran DIT ce qui manque — au conservateur, pas au visiteur.
// Le reste de la fiche continue de fonctionner : un agent absent n'a jamais
// empêché de regarder une œuvre.

const props = defineProps({
  objectId: { type: [Number, String], required: true },
  tenantId: { type: [Number, String], default: null },
  nom: { type: String, default: '' }
})

const { t } = useI18n()

const etat = ref('repos')       // repos | connexion | ecoute | parle | fermee
const erreur = ref('')
const detailErreur = ref('')
const lignes = ref([])
const micCoupe = ref(false)
const saisie = ref('')
let session = null
const zone = ref(null)

const enCours = computed(() => ['connexion', 'ecoute', 'parle'].includes(etat.value))

// Les fragments de transcription arrivent morceau par morceau. On les recolle
// sur la dernière ligne du même locuteur : sinon l'écran afficherait une ligne
// par syllabe, ce qui est illisible et saute sans arrêt.
function ajouterTexte({ role, texte }) {
  const derniere = lignes.value[lignes.value.length - 1]
  if (derniere && derniere.role === role) derniere.texte += texte
  else lignes.value.push({ role, texte, id: Date.now() + Math.random() })
  nextTick(() => { if (zone.value) zone.value.scrollTop = zone.value.scrollHeight })
}

async function demarrer() {
  erreur.value = ''
  detailErreur.value = ''
  lignes.value = []
  etat.value = 'connexion'

  const laissezPasser = await demanderJeton(Number(props.objectId), props.tenantId ? Number(props.tenantId) : null)
  if (!laissezPasser.ok) {
    etat.value = 'repos'
    erreur.value = laissezPasser.error || 'inconnue'
    // Le message du serveur est plus précis que le nôtre quand il existe :
    // il nomme le secret manquant ou le modèle refusé.
    detailErreur.value = laissezPasser.message || ''
    return
  }

  session = await ouvrirConversation(laissezPasser, {
    onEtat: (e) => { etat.value = e },
    onTexte: ajouterTexte,
    onErreur: (e) => { erreur.value = e; etat.value = 'repos' }
  })
  if (!session) etat.value = 'repos'
}

function arreter() {
  session?.fermer()
  session = null
  etat.value = 'repos'
}

function basculerMicro() {
  micCoupe.value = !micCoupe.value
  session?.couperMicro(micCoupe.value)
}

function envoyer() {
  const texte = saisie.value.trim()
  if (!texte || !session) return
  ajouterTexte({ role: 'visiteur', texte })
  session.envoyerTexte(texte)
  saisie.value = ''
}

onBeforeUnmount(arreter)
</script>

<template>
  <section class="av">
    <div class="av__tete">
      <span class="av__pastille" :class="etat" />
      <div>
        <h3 class="av__titre">{{ $t('agent.titre') }}</h3>
        <p class="av__sous">
          <template v-if="etat === 'repos'">{{ $t('agent.invite') }}</template>
          <template v-else-if="etat === 'connexion'">{{ $t('agent.connexion') }}</template>
          <template v-else-if="etat === 'parle'">{{ $t('agent.parle', { nom }) }}</template>
          <template v-else-if="etat === 'ecoute'">{{ $t('agent.ecoute') }}</template>
          <template v-else>{{ $t('agent.terminee') }}</template>
        </p>
      </div>
      <button v-if="!enCours" class="av__cta" @click="demarrer">
        <i class="pi pi-microphone" /> {{ $t('agent.demarrer') }}
      </button>
      <div v-else class="av__commandes">
        <button class="av__rond" :class="{ off: micCoupe }" :title="$t('agent.micro')" @click="basculerMicro">
          <i :class="micCoupe ? 'pi pi-microphone-slash' : 'pi pi-microphone'" />
        </button>
        <button class="av__rond av__rond--fin" :title="$t('agent.raccrocher')" @click="arreter">
          <i class="pi pi-times" />
        </button>
      </div>
    </div>

    <p v-if="erreur" class="av__erreur">
      <i class="pi pi-exclamation-triangle" />
      <span>
        {{ $t('agent.erreur.' + erreur, $t('agent.erreur.inconnue')) }}
        <em v-if="detailErreur">{{ detailErreur }}</em>
      </span>
    </p>

    <template v-if="enCours || lignes.length">
      <div ref="zone" class="av__fil">
        <p v-for="l in lignes" :key="l.id" class="av__ligne" :class="l.role">
          <strong>{{ l.role === 'visiteur' ? $t('agent.vous') : (nom || $t('agent.oeuvre')) }}</strong>
          {{ l.texte }}
        </p>
        <p v-if="!lignes.length" class="av__attente">{{ $t('agent.attente') }}</p>
      </div>

      <!-- Écrire reste possible : salle bruyante, visiteur muet, ou simple
           préférence. Le même agent répond, à voix haute. -->
      <form v-if="enCours" class="av__saisie" @submit.prevent="envoyer">
        <input v-model="saisie" type="text" :placeholder="$t('agent.ecrire')" />
        <button type="submit" :disabled="!saisie.trim()"><i class="pi pi-send" /></button>
      </form>
    </template>

    <p class="av__note">{{ $t('agent.note') }}</p>
  </section>
</template>

<style scoped>
.av { background: #0E1211; color: #fff; border-radius: 16px; padding: 1.1rem 1.25rem 1.2rem; margin: 2rem 0; }
.av__tete { display: flex; align-items: center; gap: 0.85rem; }
.av__titre { margin: 0; font-size: 1.05rem; font-family: var(--vi-serif, Fraunces, Georgia, serif); }
.av__sous { margin: 0.1rem 0 0; font-size: 0.82rem; color: rgba(255,255,255,0.6); }

/* La pastille dit l'état d'un coup d'œil : c'est ce qu'on regarde quand on
   attend une réponse, plus que le texte. */
.av__pastille { width: 11px; height: 11px; border-radius: 50%; background: rgba(255,255,255,0.28); flex: 0 0 auto; }
.av__pastille.connexion { background: #E8A33D; animation: bat 1s infinite; }
.av__pastille.ecoute { background: #2ecc71; }
.av__pastille.parle { background: var(--site-primary, #0e6f5c); animation: bat 0.7s infinite; }
@keyframes bat { 50% { opacity: 0.28; } }
@media (prefers-reduced-motion: reduce) { .av__pastille { animation: none !important; } }

.av__cta { margin-left: auto; background: var(--site-primary, #0e6f5c); color: #fff; border: 0;
  border-radius: 999px; padding: 0.6rem 1.15rem; font-family: inherit; font-size: 0.88rem;
  font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 0.45rem; }
.av__commandes { margin-left: auto; display: flex; gap: 0.45rem; }
.av__rond { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; }
.av__rond.off { background: #7a2b2b; border-color: #7a2b2b; }
.av__rond--fin { background: #7a2b2b; border-color: #7a2b2b; }

.av__erreur { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.9rem 0 0;
  font-size: 0.82rem; color: #f2c14e; }
.av__erreur em { display: block; font-style: normal; color: rgba(255,255,255,0.55); font-size: 0.76rem; margin-top: 0.2rem; }

.av__fil { margin-top: 1rem; max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
.av__ligne { margin: 0; font-size: 0.9rem; line-height: 1.5; }
.av__ligne strong { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(255,255,255,0.45); margin-bottom: 0.1rem; }
.av__ligne.visiteur { color: rgba(255,255,255,0.72); }
.av__ligne.oeuvre { color: #fff; }
.av__attente { margin: 0; font-size: 0.82rem; color: rgba(255,255,255,0.4); font-style: italic; }

.av__saisie { display: flex; gap: 0.45rem; margin-top: 0.8rem; }
.av__saisie input { flex: 1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 999px; padding: 0.55rem 0.95rem; color: #fff; font-family: inherit; font-size: 0.88rem; }
.av__saisie button { width: 40px; border-radius: 50%; border: 0; background: var(--site-primary, #0e6f5c); color: #fff; cursor: pointer; }
.av__saisie button:disabled { opacity: 0.4; cursor: default; }

.av__note { margin: 0.9rem 0 0; font-size: 0.72rem; color: rgba(255,255,255,0.38); line-height: 1.5; }
</style>
