<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { pubSiblings } from '@/services/publicApi'
import { creerRelief, ANGLE_MAX_RELIEF, AMPLITUDE_DEFAUT } from '@/services/relief'

// LE CABINET DE COMPARAISON — côté visiteur.
//
// L'œuvre au centre, ses frères tout autour en planches suspendues. On tourne
// la tête, on s'approche d'une planche, on lit ce qui la relie à l'œuvre.
//
// POURQUOI PAS THREE.JS
//
// Deux raisons, et la seconde suffirait. D'abord npm est hors service sur ce
// poste (cf. MUSEA_MASTER_PLAN §6) : aucune dépendance n'est installable.
// Ensuite, pour DES PLANS disposés en arc, WebGL est un marteau-pilon : le
// compositeur du navigateur fait exactement cela en `transform: rotateY()`,
// accéléré par le GPU, sans boucle de rendu, sans perte de l'accessibilité
// (le texte reste du texte, sélectionnable et lisible par un lecteur d'écran)
// et sans pénalité au chargement. Le jour où il faudra le relief 2.5D — des
// sommets déplacés par une carte de profondeur —, alors il faudra WebGL.
//
// LA CONTRAINTE D'ANGLE, ELLE, EST DÉJÀ LÀ
//
// Le débattement est volontairement borné (±26°). C'est la même limite que
// celle qu'imposera le 2.5D : au-delà, les zones cachées d'une image plate
// apparaîtraient et s'étireraient. Poser la contrainte maintenant évite de
// concevoir une navigation qu'il faudra brider ensuite.

const props = defineProps({
  objectId: { type: [Number, String], required: true },
  nom: { type: String, default: '' },
  photo: { type: String, default: '' },
  // La fiche a souvent déjà chargé les frères (pour le décompte du bandeau) :
  // on les accepte plutôt que de refaire la même requête.
  deja: { type: Array, default: null }
})

const lignes = ref([])
const chargement = ref(true)
const angle = ref(0)          // degrés, pivot de la scène
const actif = ref(null)       // planche mise en avant
const filtre = ref(null)      // type de lien

const ANGLE_MAX = 26

onMounted(async () => {
  lignes.value = props.deja?.length ? props.deja : await pubSiblings(props.objectId)
  chargement.value = false
})

const typesPresents = computed(() => {
  const vus = new Set(lignes.value.map((f) => f.typeLien).filter(Boolean))
  return [...vus]
})

const visibles = computed(() =>
  filtre.value ? lignes.value.filter((f) => f.typeLien === filtre.value) : lignes.value
)

// Disposition en ARC, avec de légères variations de hauteur et de profondeur.
//
// L'irrégularité n'est pas un caprice : une grille régulière se lit comme un
// tableau, une disposition légèrement désordonnée se lit comme un espace. Les
// variations sont DÉTERMINISTES (dérivées de l'index) pour qu'une planche ne
// saute pas d'un rendu à l'autre.
// L'arc total est plafonné à 96°, soit ±48° au maximum. Mesuré : à 150°
// d'étendue, les planches des extrémités se retrouvaient à −75°, presque de
// profil — on ne voyait plus ni l'image ni le cartel. Au-delà de ~50°, une
// planche plate cesse d'être lisible ; c'est aussi la limite qu'imposera le
// relief 2.5D. Avec beaucoup de frères, on resserre l'écart plutôt que
// d'élargir le mur : c'est ce que fait un accrochage réel.
const ARC_MAX = 96

function placement(i, total) {
  const etendue = Math.min(ARC_MAX, 22 * Math.max(total - 1, 1))
  const pas = total > 1 ? etendue / (total - 1) : 0
  const rot = -etendue / 2 + i * pas
  return {
    rot,
    // Décalages pseudo-aléatoires mais stables : deux sinus de périodes
    // incommensurables donnent une irrégularité qui ne se répète pas.
    y: Math.sin(i * 1.7) * 26,
    z: 430 + Math.sin(i * 2.3) * 40
  }
}

function styleplanche(i, total) {
  const p = placement(i, total)
  return {
    transform: `rotateY(${p.rot}deg) translateZ(${p.z}px) translateY(${p.y}px)`
  }
}

// Le regard suit la souris, borné. `pointermove` couvre souris ET stylet ;
// le tactile est traité à part pour ne pas confisquer le défilement vertical.
function suivre(e) {
  if (actif.value) return
  const r = e.currentTarget.getBoundingClientRect()
  const dx = (e.clientX - r.left) / r.width - 0.5
  angle.value = Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, -dx * ANGLE_MAX * 2))
}
function relacher() { if (!actif.value) angle.value = 0 }

let departX = null
function toucheDebut(e) { departX = e.touches[0]?.clientX ?? null }
function toucheBouge(e) {
  if (departX == null || actif.value) return
  const dx = (e.touches[0].clientX - departX) / 6
  angle.value = Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, dx))
}
function toucheFin() { departX = null }

function ouvrir(f) { actif.value = actif.value?.id === f.id ? null : f }
function fermer() { actif.value = null }

function auClavier(e) { if (e.key === 'Escape') fermer() }
onMounted(() => window.addEventListener('keydown', auClavier))
onBeforeUnmount(() => { window.removeEventListener('keydown', auClavier); libererRelief() })

// ---------------------------------------------------------------------------
// RELIEF 2.5D — uniquement sur la planche OUVERTE
// ---------------------------------------------------------------------------
// C'est la règle des deux niveaux de rendu : un maillage déplacé coûte 16 000
// sommets et deux textures. Multiplié par les vingt planches de l'arc, il tue
// un téléphone. On ne le paie donc que là où le visiteur regarde vraiment.
const toile = ref(null)
const reliefActif = ref(false)
let moteur = null
let boucle = 0
let yawRelief = 0
let pitchRelief = 0

const aDuRelief = computed(() => !!actif.value?.profondeur)

function libererRelief() {
  cancelAnimationFrame(boucle)
  boucle = 0
  moteur?.detruire()
  moteur = null
  reliefActif.value = false
}

watch(actif, async (f) => {
  libererRelief()
  if (!f?.profondeur) return
  await nextTick()
  if (!toile.value) return

  moteur = creerRelief(toile.value)
  // `creerRelief` renvoie null si l'appareil ne sait pas lire une texture dans
  // le shader de sommets. Ce n'est pas une panne : l'image plate reste affichée.
  if (!moteur) return

  const ok = await moteur.charger(f.image, f.profondeur)
  if (!ok) { libererRelief(); return }

  reliefActif.value = true
  const amp = f.amplitude || AMPLITUDE_DEFAUT
  const animer = () => {
    moteur?.rendre(yawRelief, pitchRelief, amp)
    boucle = requestAnimationFrame(animer)
  }
  animer()
})

// Parallaxe au survol, BORNÉE. Au-delà d'une vingtaine de degrés, les zones que
// la photo ne contient pas apparaissent et s'étirent — la limite est celle du
// procédé, pas un réglage de confort.
function bougerRelief(e) {
  if (!reliefActif.value) return
  const r = e.currentTarget.getBoundingClientRect()
  const dx = (e.clientX - r.left) / r.width - 0.5
  const dy = (e.clientY - r.top) / r.height - 0.5
  yawRelief = Math.max(-ANGLE_MAX_RELIEF, Math.min(ANGLE_MAX_RELIEF, dx * ANGLE_MAX_RELIEF * 2))
  pitchRelief = Math.max(-ANGLE_MAX_RELIEF, Math.min(ANGLE_MAX_RELIEF, -dy * ANGLE_MAX_RELIEF * 1.4))
}
function quitterRelief() { yawRelief = 0; pitchRelief = 0 }
</script>

<template>
  <section v-if="chargement || lignes.length" class="cf">
    <header class="cf__head">
      <h2 class="cf__titre">{{ $t('cabinet.public.titre') }}</h2>
      <p class="cf__sous">{{ $t('cabinet.public.sousTitre', { n: lignes.length }) }}</p>
    </header>

    <div v-if="typesPresents.length > 1" class="cf__filtres">
      <button :class="{ on: !filtre }" @click="filtre = null">{{ $t('cabinet.public.tous') }}</button>
      <button v-for="t in typesPresents" :key="t" :class="{ on: filtre === t }" @click="filtre = t">
        {{ $t('cabinet.lien.' + t) }}
      </button>
    </div>

    <div
      class="cf__scene" :class="{ 'cf__scene--zoom': actif }"
      @pointermove="suivre" @pointerleave="relacher"
      @touchstart.passive="toucheDebut" @touchmove.passive="toucheBouge" @touchend.passive="toucheFin"
    >
      <div class="cf__monde" :style="{ transform: `rotateY(${angle}deg)` }">
        <!-- L'œuvre, au centre, sur son socle -->
        <div class="cf__centre">
          <div class="cf__socle" />
          <img v-if="photo" :src="photo" :alt="nom" class="cf__oeuvre" />
          <div v-else class="cf__oeuvre cf__oeuvre--ph"><i class="pi pi-box" /></div>
        </div>

        <!-- Les frères, en arc -->
        <button
          v-for="(f, i) in visibles" :key="f.id"
          class="cf__planche" :class="{ estompe: actif && actif.id !== f.id, avant: actif?.id === f.id }"
          :style="styleplanche(i, visibles.length)"
          @click="ouvrir(f)"
        >
          <span class="cf__cadre">
            <img v-if="f.image" :src="f.image" :alt="f.titre" loading="lazy" />
            <span v-else class="cf__vide"><i class="pi pi-image" /></span>
          </span>
          <span class="cf__cartel">
            <strong>{{ f.titre }}</strong>
            <em>{{ f.musee || f.source }}</em>
            <span v-if="f.justification" class="cf__just">{{ f.justification }}</span>
          </span>
        </button>
      </div>

      <!-- Fiche dépliée -->
      <div v-if="actif" class="cf__fiche" @click.self="fermer">
        <div class="cf__fiche-corps">
          <!-- Deux niveaux de rendu : maillage déplacé si une carte de
               profondeur existe, simple image sinon. -->
          <div
            v-if="aDuRelief" class="cf__relief"
            @pointermove="bougerRelief" @pointerleave="quitterRelief"
          >
            <canvas ref="toile" class="cf__toile" />
            <!-- L'image reste dessous : si le moteur renonce (vieux GPU,
                 image d'un autre domaine sans CORS), on ne montre pas un
                 rectangle vide. -->
            <img v-show="!reliefActif" :src="actif.image" :alt="actif.titre" class="cf__toile-repli" />
            <span v-if="reliefActif" class="cf__relief-note">{{ $t('cabinet.public.relief') }}</span>
          </div>
          <img v-else-if="actif.image" :src="actif.image" :alt="actif.titre" />
          <div class="cf__fiche-txt">
            <strong>{{ actif.titre }}</strong>
            <p class="cf__fiche-meta">{{ [actif.culture, actif.pays].filter(Boolean).join(' · ') }}</p>
            <p v-if="actif.justification" class="cf__fiche-just">« {{ actif.justification }} »</p>
            <div class="cf__fiche-actions">
              <a v-if="actif.url" :href="actif.url" target="_blank" rel="noopener" class="cf__cta">
                {{ $t('cabinet.public.voirAuMusee') }} <i class="pi pi-external-link" />
              </a>
              <button class="cf__retour" @click="fermer">{{ $t('cabinet.public.fermer') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cf { margin: 2.5rem 0; }
.cf__head { text-align: center; margin-bottom: 1rem; }
.cf__titre { font-family: var(--vi-serif, Fraunces, Georgia, serif); font-size: 1.6rem; margin: 0 0 0.25rem; }
.cf__sous { margin: 0; font-size: 0.88rem; color: #6B7280; }

.cf__filtres { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; margin-bottom: 1.2rem; }
.cf__filtres button { background: #fff; border: 1px solid #E9EDF2; border-radius: 999px;
  padding: 0.38rem 0.9rem; font-family: inherit; font-size: 0.8rem; font-weight: 700;
  color: #6B7280; cursor: pointer; }
.cf__filtres button.on { background: var(--site-primary, #0e6f5c); border-color: var(--site-primary, #0e6f5c); color: #fff; }

/* La perspective vit sur le conteneur, la rotation sur le monde : c'est ce qui
   fait qu'une seule transformation déplace toute la scène. */
.cf__scene {
  position: relative; height: 460px; perspective: 1200px;
  background: radial-gradient(ellipse at 50% 62%, #1c2422 0%, #0E1211 72%);
  border-radius: 16px; overflow: hidden; touch-action: pan-y;
}
.cf__monde {
  position: absolute; inset: 0; transform-style: preserve-3d;
  transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.cf__centre { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); transform-style: preserve-3d; }
.cf__oeuvre { width: 168px; height: 168px; object-fit: cover; border-radius: 10px; display: block;
  box-shadow: 0 26px 50px rgba(0,0,0,0.6); }
.cf__oeuvre--ph { display: flex; align-items: center; justify-content: center;
  background: #263230; color: rgba(255,255,255,0.35); font-size: 2.2rem; }
/* Le socle : une ellipse floue. Elle ne dit pas « plancher », elle dit « posé ». */
.cf__socle { position: absolute; left: 50%; top: 100%; width: 210px; height: 34px;
  transform: translate(-50%, -6px); border-radius: 50%;
  background: radial-gradient(ellipse, rgba(0,0,0,0.65) 0%, transparent 70%); }

.cf__planche {
  position: absolute; left: 50%; top: 50%; width: 150px; margin: -110px 0 0 -75px;
  transform-style: preserve-3d; background: none; border: 0; padding: 0;
  cursor: pointer; font-family: inherit; text-align: center; color: #fff;
  transition: opacity 0.3s ease, filter 0.3s ease;
}
.cf__planche.estompe { opacity: 0.18; filter: blur(2px); pointer-events: none; }
.cf__planche.avant { opacity: 0; pointer-events: none; }
.cf__cadre { display: block; width: 150px; height: 150px; border-radius: 8px; overflow: hidden;
  background: #223; box-shadow: 0 16px 34px rgba(0,0,0,0.55); }
.cf__cadre img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cf__vide { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.3); font-size: 1.6rem; }
.cf__cartel { display: block; margin-top: 0.5rem; }
.cf__cartel strong { display: block; font-size: 0.8rem; line-height: 1.25;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cf__cartel em { display: block; font-size: 0.7rem; color: rgba(255,255,255,0.55); font-style: normal; margin-top: 0.15rem; }
.cf__just { display: block; margin-top: 0.3rem; font-size: 0.68rem; line-height: 1.3;
  color: rgba(255,255,255,0.72); font-style: italic; }

.cf__fiche { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(8,11,10,0.82); padding: 1.2rem; }
.cf__fiche-corps { display: flex; gap: 1.2rem; max-width: 620px; align-items: center; }
.cf__fiche-corps > img { width: 210px; height: 210px; object-fit: cover; border-radius: 10px; flex: 0 0 auto; }

/* Zone de relief : le canvas et l'image de repli occupent exactement la même
   place, l'un par-dessus l'autre. */
.cf__relief { position: relative; width: 240px; height: 240px; flex: 0 0 auto; cursor: crosshair; }
.cf__toile { width: 100%; height: 100%; display: block; }
.cf__toile-repli { position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; border-radius: 10px; }
.cf__relief-note { position: absolute; left: 50%; bottom: -4px; transform: translateX(-50%);
  font-size: 0.64rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); white-space: nowrap; }
.cf__fiche-txt { color: #fff; min-width: 0; }
.cf__fiche-txt strong { font-size: 1.1rem; display: block; }
.cf__fiche-meta { margin: 0.25rem 0 0.6rem; font-size: 0.82rem; color: rgba(255,255,255,0.6); }
.cf__fiche-just { margin: 0 0 0.9rem; font-size: 0.92rem; font-style: italic; line-height: 1.45; }
.cf__fiche-actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.cf__cta { background: var(--site-primary, #0e6f5c); color: #fff; text-decoration: none;
  border-radius: 8px; padding: 0.5rem 0.95rem; font-size: 0.85rem; font-weight: 700;
  display: inline-flex; align-items: center; gap: 0.4rem; }
.cf__retour { background: none; border: 1px solid rgba(255,255,255,0.3); color: rgba(255,255,255,0.8);
  border-radius: 8px; padding: 0.5rem 0.95rem; font-family: inherit; font-size: 0.85rem; cursor: pointer; }

@media (max-width: 640px) {
  .cf__scene { height: 400px; }
  .cf__fiche-corps { flex-direction: column; text-align: center; }
  .cf__fiche-corps img { width: 150px; height: 150px; }
}

/* Respecte le réglage système : une scène qui pivote sous le curseur est
   exactement le genre de mouvement que ce réglage existe pour supprimer. */
@media (prefers-reduced-motion: reduce) {
  .cf__monde { transition: none; }
}
</style>
