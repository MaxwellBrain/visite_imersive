<script setup>
// IMPORT D'UN FONDS — les deux boutons, l'aperçu, et l'écriture en cascade.
//
// EXTRAIT EN COMPOSANT PARCE QU'IL A DEUX PORTES D'ENTRÉE. Le classeur crée des
// musées, des salles ET des œuvres : une fondation qui démarre le cherche dans
// « Musées », un conservateur qui complète son inventaire le cherche dans
// « Objets ». Laisser la fonction dans un seul écran, c'est la rendre
// introuvable pour la moitié des usages — et la dupliquer, c'est se condamner à
// corriger deux fois le même défaut.
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useObjectStore } from '@/stores/useObjectStore'

const { t } = useI18n()
const toast = useToast()
const museums = useMuseumStore()
const sectors = useSectorStore()
const objects = useObjectStore()

const fichier = ref(null)
const etat = reactive({
  export: false, lecture: false, ecriture: false,
  apercu: false, analyse: null, problemes: [], absentes: [],
  plans: [], transformations: [], doublons: [], fichiers: [], total: 0,
  // L'écran de traitement, et le classeur nettoyé qui en sort.
  traitement: null, nettoye: null, importe: false
})

// Ce que l'import créerait, table par table. Sert l'aperçu ET le bouton de
// confirmation : on ne propose pas « créer » quand il n'y a rien à créer.
const aCreer = computed(() => {
  const a = etat.analyse
  const m = a?.musees.length || 0
  const s = a?.salles.length || 0
  const o = a?.objets.length || 0
  return { musees: m, salles: s, objets: o, total: m + s + o }
})

async function exporterModele() {
  etat.export = true
  try {
    const { modeleClasseur } = await import('@/services/objetsClasseur')
    const { telechargerClasseur } = await import('@/services/xlsx')
    telechargerClasseur(
      modeleClasseur({ musees: museums.items, salles: sectors.items, objets: objects.items }),
      `musea-fonds-${new Date().toISOString().slice(0, 10)}`
    )
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.objects.exportEchec'), detail: e?.message || '', life: 6000 })
  } finally {
    etat.export = false
  }
}

// Le fichier est conservé : corriger un rangement impose de le relire en
// entier, puisque c'est la colonne source de chaque valeur qui change.
let dernierLot = []
// Les corrections sont indexées par SOURCE (« n°fichier:table ») : deux fichiers
// n'ont pas les mêmes en-têtes, et un rangement corrigé sur l'un n'a aucun sens
// sur l'autre.
const corrections = reactive({})
const modifie = computed(() =>
  Object.values(corrections).some((t) => Object.keys(t).length > 0))

function choix(source, c) {
  const f = corrections[source]?.[c.cle]
  if (f !== undefined) return String(f)
  return String(c.index ?? -1)
}
function corriger(source, cle, valeur) {
  if (!corrections[source]) corrections[source] = {}
  corrections[source][cle] = Number(valeur)
}
async function relire() {
  if (dernierLot.length) await analyser(dernierLot)
}

async function analyser(lot) {
  etat.lecture = true
  try {
    const { analyserLot } = await import('@/services/objetsClasseur')
    const r = await analyserLot(lot, {
      musees: museums.items, salles: sectors.items, objets: objects.items, corrections,
      onEtape: (e) => { etat.traitement = e }
    })
    // Le classeur nettoyé est fabriqué TOUT DE SUITE, pas au clic sur
    // « Télécharger » : le travail est déjà fait, et une seconde d'attente à ce
    // moment-là donnerait l'impression que le bouton n'a pas répondu.
    const { classeurNettoye } = await import('@/services/objetsClasseur')
    etat.nettoye = classeurNettoye(r)
    Object.assign(etat, {
      analyse: r, problemes: r.problemes, absentes: r.absentes || [],
      plans: r.plans || [], transformations: r.transformations || [],
      doublons: r.doublons || [],
      fichiers: r.fichiers || [], total: r.total, apercu: true
    })
  } catch (err) {
    console.warn('[fonds]', err?.message || err)
    toast.add({ severity: 'error', summary: t('admin.objects.importEchec'), detail: err?.message || '', life: 8000 })
  } finally {
    etat.lecture = false
    etat.traitement = null
  }
}

// Le classeur nettoyé reste disponible APRÈS l'import : c'est tout l'intérêt.
// Le musée le récupère quand il veut, sans redéposer ses fichiers ni relancer
// l'analyse.
async function telechargerNettoye() {
  if (!etat.nettoye) return
  const { telechargerClasseur } = await import('@/services/xlsx')
  telechargerClasseur(etat.nettoye, `musea-nettoye-${new Date().toISOString().slice(0, 10)}`)
}

async function onFichier(e) {
  const lot = [...(e.target.files || [])]
  e.target.value = ''
  if (!lot.length) return
  dernierLot = lot
  // Un nouveau lot repart d'un plan neuf : les corrections portaient sur les
  // colonnes des fichiers précédents, et n'ont aucun sens ici.
  for (const k of Object.keys(corrections)) delete corrections[k]
  await analyser(lot)
}

async function confirmer() {
  etat.ecriture = true
  try {
    const { importerFonds } = await import('@/services/objetsClasseur')
    const r = await importerFonds(etat.analyse, { musees: museums.items, salles: sectors.items })
    // Les trois stores ont bougé : n'en recharger qu'un laisserait les autres
    // périmés, et le prochain import recréerait des doublons.
    await Promise.all([museums.load(), sectors.load(), objects.load()])
    // On NE ferme PAS : le conservateur doit pouvoir récupérer le classeur
    // nettoyé après coup. Fermer d'autorité le lui ferait perdre.
    etat.importe = true
    toast.add({
      severity: 'success',
      summary: t('admin.objects.importFait', { n: r.objets }),
      detail: t('admin.objects.importCascade', { m: r.musees, s: r.salles }),
      life: 7000
    })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.objects.importEchec'), detail: e?.message || '', life: 9000 })
  } finally {
    etat.ecriture = false
  }
}
</script>

<template>
  <Button
    :label="$t('admin.objects.exportModele')" icon="pi pi-download"
    outlined severity="secondary" :loading="etat.export" @click="exporterModele"
  />
  <Button
    :label="$t('admin.objects.importer')" icon="pi pi-upload"
    outlined severity="secondary" :loading="etat.lecture" @click="fichier?.click()"
  />
  <input
    ref="fichier" type="file"
    multiple
    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
    style="display: none" @change="onFichier"
  />

  <!-- ÉCRAN DE TRAITEMENT.
       Lire dix fichiers, interroger le modèle et normaliser deux mille lignes
       prend plusieurs secondes. Sans cet écran, la fenêtre paraît figée : on
       reclique, on redépose, on ferme au milieu de l'analyse. Il est modal et
       sans bouton de fermeture — interrompre une analyse à mi-course ne donne
       rien d'utilisable. -->
  <Dialog
    :visible="etat.lecture" modal :closable="false" :draggable="false"
    :show-header="false" :style="{ width: '24rem', maxWidth: '92vw' }"
  >
    <div class="imp-splash">
      <i class="pi pi-spin pi-cog" />
      <strong>{{ $t('admin.objects.splashTitre') }}</strong>
      <p>{{ $t('admin.objects.splash_' + (etat.traitement?.phase || 'lecture')) }}</p>
      <span v-if="etat.traitement?.detail" class="imp-splash__d">{{ etat.traitement.detail }}</span>
      <div v-if="etat.traitement?.sur > 1" class="imp-splash__jauge">
        <span :style="{ width: Math.round((etat.traitement.n / etat.traitement.sur) * 100) + '%' }" />
      </div>
      <small>{{ $t('admin.objects.splashNote') }}</small>
    </div>
  </Dialog>

  <!-- On MONTRE avant d'écrire : importer deux cents lignes sans les avoir vues
       est le meilleur moyen de polluer un catalogue, et rien ne permet de
       revenir en arrière ensuite. -->
  <Dialog
    v-model:visible="etat.apercu" modal :header="$t('admin.objects.importTitre')"
    :style="{ width: '38rem', maxWidth: '95vw' }"
  >
    <p v-if="etat.fichiers.length > 1" class="imp-fichiers">
      <i class="pi pi-folder-open" /> {{ $t('admin.objects.impFichiers', etat.fichiers.length) }} —
      {{ etat.fichiers.join(' · ') }}
    </p>
    <!-- LE TRAVAIL, RENDU. Le nettoyage a coûté du temps machine ; il ne doit
         pas rester prisonnier de cette fenêtre. Le classeur est prêt AVANT
         l'import, et le reste après : on le récupère quand on veut. -->
    <div v-if="etat.nettoye" class="imp-pret">
      <i class="pi pi-check-circle" />
      <div>
        <strong>{{ $t('admin.objects.pretTitre') }}</strong>
        <span>{{ $t('admin.objects.pretLead', { ko: Math.max(1, Math.round(etat.nettoye.size / 1024)) }) }}</span>
      </div>
      <Button
        :label="$t('admin.objects.pretTelecharger')" icon="pi pi-download"
        size="small" outlined @click="telechargerNettoye"
      />
    </div>

    <p class="imp-resume">{{ $t('admin.objects.importResume', { t: etat.total }) }}</p>
    <ul class="imp-bilan">
      <li><b>{{ aCreer.musees }}</b> {{ $t('admin.objects.impMusees') }}</li>
      <li><b>{{ aCreer.salles }}</b> {{ $t('admin.objects.impSalles') }}</li>
      <li><b>{{ aCreer.objets }}</b> {{ $t('admin.objects.impObjets') }}</li>
    </ul>

    <!-- ═══ NETTOYAGE ET UNIFICATION ═══
         L'étape qui manquait. Avant, l'import décidait seul du rangement et de
         la normalisation, et n'en rendait aucun compte : on découvrait le
         résultat en base. Ici tout est posé — quelle colonne va où, par quel
         moyen, avec un exemple de ce qui atterrira dedans, et quelles valeurs
         ont été réécrites. Chaque ligne est corrigeable. -->
    <section v-if="etat.plans.length" class="imp-net">
      <header class="imp-net__t">
        <i class="pi pi-sparkles" />
        <strong>{{ $t('admin.objects.netTitre') }}</strong>
        <button v-if="modifie" class="imp-net__relire" @click="relire">
          <i :class="etat.lecture ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
          {{ $t('admin.objects.netRelire') }}
        </button>
      </header>

      <div v-for="p in etat.plans" :key="p.cle" class="imp-net__onglet">
        <h4><i class="pi pi-file" /> {{ p.fichier }} <span>› {{ p.onglet }}</span></h4>
        <div class="imp-net__scroll">
          <table>
            <thead>
              <tr>
                <th>{{ $t('admin.objects.netChamp') }}</th>
                <th>{{ $t('admin.objects.netColonne') }}</th>
                <th>{{ $t('admin.objects.netOrigine') }}</th>
                <th>{{ $t('admin.objects.netExemple') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in p.plan" :key="c.cle" :class="{ 'is-vide': c.index === null }">
                <td>{{ c.champ }}</td>
                <td>
                  <select :value="choix(p.cle, c)" @change="corriger(p.cle, c.cle, $event.target.value)">
                    <option value="-1">{{ $t('admin.objects.netAucune') }}</option>
                    <option v-for="(h, i) in p.entetes" :key="i" :value="i">{{ h || `(colonne ${i + 1})` }}</option>
                  </select>
                </td>
                <td>
                  <span v-if="c.origine" class="imp-net__src" :class="'src--' + c.origine">
                    {{ $t('admin.objects.netSrc_' + c.origine) }}
                  </span>
                  <span v-else class="imp-net__src src--vide">{{ $t('admin.objects.netSrc_vide') }}</span>
                </td>
                <td class="imp-net__ex">{{ c.exemple || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-for="(t, i) in etat.transformations" :key="'t' + i" class="imp-net__tr">
        <strong>{{ $t('admin.objects.netReecrit', { champ: t.champ, n: t.total }) }}</strong>
        <ul>
          <li v-for="(e, k) in t.exemples" :key="k">
            <span class="de">{{ e.de }}</span> <i class="pi pi-arrow-right" /> <b>{{ e.vers }}</b>
          </li>
        </ul>
      </div>
    </section>

    <!-- ÉTAGE 2 : LES DOUBLONS PROBABLES.
         La méthode classique (clé exacte) est déjà appliquée à l'écriture. Ce
         bloc montre ce qu'elle ne peut pas voir : la même œuvre ressaisie sans
         référence, ou déjà au catalogue. Trois classes, dont une — « à revoir »
         — qui existe précisément parce que le modèle ne tranche pas seul. -->
    <div v-if="etat.doublons.length" class="imp-dbl">
      <strong>{{ $t('admin.objects.dblTitre', etat.doublons.length) }}</strong>
      <p class="imp-dbl__note">{{ $t('admin.objects.dblNote') }}</p>
      <ul>
        <li v-for="(d, i) in etat.doublons.slice(0, 10)" :key="i" :class="'est--' + d.classe">
          <span class="imp-dbl__c">{{ $t('admin.objects.dbl_' + d.classe) }}</span>
          <span class="imp-dbl__p">« {{ d.a.nom }} » ≈ « {{ d.b.nom }} »</span>
          <span class="imp-dbl__s">{{ d.score }} bits · {{ d.b.source === 'catalogue' ? $t('admin.objects.dblCatalogue') : $t('admin.objects.dblFichier') }}</span>
        </li>
      </ul>
      <small v-if="etat.doublons.length > 10">{{ $t('admin.objects.importReste', { n: etat.doublons.length - 10 }) }}</small>
    </div>

    <!-- CE QUE LE FICHIER NE CONTENAIT PAS.
         Ce n'est pas une erreur : ces champs resteront simplement vides, et le
         conservateur les remplira dans l'ERP. Mais il doit le SAVOIR avant de
         confirmer — un champ manquant qu'on ne signale pas se découvre trois
         semaines plus tard, sur le site public. -->
    <div v-if="etat.absentes.length" class="imp-abs">
      <strong>{{ $t('admin.objects.impAbsentes') }}</strong>
      <p v-for="(a, i) in etat.absentes" :key="i">
        <b>{{ a.onglet }}</b> — {{ a.colonnes.join(', ') }}
      </p>
      <small>{{ $t('admin.objects.impAbsentesNote') }}</small>
    </div>

    <div v-if="etat.problemes.length" class="imp-pb">
      <strong>{{ $t('admin.objects.importProblemes', etat.problemes.length) }}</strong>
      <ul>
        <li v-for="(p, i) in etat.problemes.slice(0, 12)" :key="i">
          <b>{{ p.onglet ? p.onglet + ' · ' : '' }}{{ $t('admin.objects.importLigne', { n: p.ligne }) }}</b>
          {{ $t('admin.objects.impErr_' + p.motif) }}
          <em v-if="p.detail">— {{ p.detail }}</em>
        </li>
      </ul>
      <small v-if="etat.problemes.length > 12">
        {{ $t('admin.objects.importReste', { n: etat.problemes.length - 12 }) }}
      </small>
    </div>

    <template #footer>
      <template v-if="etat.importe">
        <span class="imp-fait"><i class="pi pi-check" /> {{ $t('admin.objects.importDejaFait') }}</span>
        <Button :label="$t('common.close')" @click="etat.apercu = false" />
      </template>
      <template v-else>
        <Button :label="$t('common.cancel')" text @click="etat.apercu = false" />
        <Button
          :label="$t('admin.objects.importConfirmer', { n: aCreer.total })"
          icon="pi pi-check" :disabled="!aCreer.total || etat.ecriture"
          :loading="etat.ecriture" @click="confirmer"
        />
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.imp-splash { text-align: center; padding: 1.6rem 0.6rem 0.8rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.imp-splash > i { font-size: 2.2rem; color: var(--p-primary-color, #0e6f5c); }
.imp-splash strong { font-size: 1.02rem; }
.imp-splash p { margin: 0; font-size: 0.9rem; opacity: 0.8; }
.imp-splash__d { font-size: 0.8rem; opacity: 0.6; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imp-splash__jauge { width: 100%; height: 4px; border-radius: 2px; background: var(--p-content-border-color, #e3e5e1); overflow: hidden; }
.imp-splash__jauge span { display: block; height: 100%; background: var(--p-primary-color, #0e6f5c); transition: width 0.25s; }
.imp-splash small { font-size: 0.76rem; opacity: 0.6; margin-top: 0.2rem; }

.imp-pret {
  display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.9rem;
  padding: 0.7rem 0.9rem; border-radius: 6px;
  background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 10%, transparent);
}
.imp-pret > i { font-size: 1.3rem; color: var(--p-primary-color, #0e6f5c); }
.imp-pret div { display: flex; flex-direction: column; min-width: 0; }
.imp-pret strong { font-size: 0.9rem; }
.imp-pret span { font-size: 0.8rem; opacity: 0.75; }
.imp-pret .p-button { margin-left: auto; flex: none; }
.imp-fait { margin-right: auto; font-size: 0.86rem; opacity: 0.75; }

.imp-fichiers { margin: 0 0 0.6rem; font-size: 0.84rem; opacity: 0.8; }
.imp-net__onglet h4 i { font-size: 0.75rem; opacity: 0.6; }
.imp-net__onglet h4 span { opacity: 0.6; font-weight: 400; }
.imp-resume { margin: 0 0 0.7rem; font-size: 0.95rem; }
/* Le bilan en trois lignes : le lecteur doit voir d'un coup d'œil que l'import
   touche aussi les musées et les salles, et pas seulement les œuvres. */
.imp-bilan {
  list-style: none; margin: 0 0 1rem; padding: 0.7rem 0.9rem;
  background: var(--vi-surface-2, rgba(127, 127, 127, 0.07)); border-radius: 6px;
  display: flex; flex-wrap: wrap; gap: 0.35rem 1.6rem;
}
.imp-bilan li { font-size: 0.92rem; }
.imp-bilan b { font-variant-numeric: tabular-nums; }

/* Nettoyage : un tableau dense, mais chaque ligne doit rester relisable —
   c'est le dernier moment où une erreur de rangement se rattrape. */
.imp-net {
  border: 1px solid var(--p-content-border-color, #dcdedb);
  border-radius: 6px; padding: 0.8rem 0.9rem; margin-bottom: 0.9rem;
}
.imp-net__t { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.7rem; font-size: 0.92rem; }
.imp-net__t i { color: var(--gold, #cda24e); }
.imp-net__relire {
  margin-left: auto; border: none; cursor: pointer; font-family: inherit;
  background: var(--p-primary-color, #0e6f5c); color: #fff;
  border-radius: 4px; padding: 0.3rem 0.6rem; font-size: 0.78rem;
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.imp-net__onglet h4 { margin: 0.6rem 0 0.3rem; font-size: 0.82rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
.imp-net__scroll { overflow-x: auto; }
.imp-net table { border-collapse: collapse; width: 100%; min-width: 30rem; }
.imp-net th, .imp-net td { text-align: left; padding: 0.3rem 0.5rem; font-size: 0.82rem; border-bottom: 1px solid var(--p-content-border-color, #eceeea); vertical-align: middle; }
.imp-net th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
.imp-net tr.is-vide td { opacity: 0.55; }
.imp-net select { font-family: inherit; font-size: 0.8rem; max-width: 13rem; padding: 0.15rem; }
.imp-net__ex { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.75; }
.imp-net__src { font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 3px; white-space: nowrap; }
.src--titre, .src--alias { background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 14%, transparent); }
.src--partiel, .src--ia { background: color-mix(in srgb, var(--gold, #cda24e) 22%, transparent); }
.src--manuel { background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 28%, transparent); font-weight: 600; }
.src--vide { opacity: 0.5; }
.imp-net__tr { margin-top: 0.7rem; font-size: 0.84rem; }
.imp-net__tr ul { margin: 0.3rem 0 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.15rem; }
.imp-net__tr .de { opacity: 0.7; }
.imp-net__tr i { font-size: 0.7rem; opacity: 0.6; margin: 0 0.2rem; }

.imp-dbl {
  border-left: 2px solid var(--gold, #cda24e);
  background: color-mix(in srgb, var(--gold, #cda24e) 9%, transparent);
  border-radius: 4px; padding: 0.8rem 1rem; margin-bottom: 0.9rem;
}
.imp-dbl strong { display: block; font-size: 0.9rem; }
.imp-dbl__note { margin: 0.25rem 0 0.6rem; font-size: 0.82rem; opacity: 0.75; line-height: 1.5; }
.imp-dbl ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
.imp-dbl li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; font-size: 0.85rem; }
.imp-dbl__c { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.1rem 0.4rem; border-radius: 3px; white-space: nowrap; }
.est--doublon .imp-dbl__c { background: color-mix(in srgb, var(--p-red-500, #c0392b) 18%, transparent); }
.est--a_revoir .imp-dbl__c { background: color-mix(in srgb, var(--gold, #cda24e) 30%, transparent); }
.imp-dbl__p { flex: 1; min-width: 12rem; }
.imp-dbl__s { font-size: 0.76rem; opacity: 0.6; font-variant-numeric: tabular-nums; }
.imp-dbl small { display: block; margin-top: 0.5rem; font-size: 0.78rem; opacity: 0.7; }

.imp-abs {
  background: color-mix(in srgb, var(--gold, #cda24e) 12%, transparent);
  border-left: 2px solid var(--gold, #cda24e);
  border-radius: 4px; padding: 0.8rem 1rem; margin-bottom: 0.9rem;
}
.imp-abs strong { display: block; font-size: 0.9rem; margin-bottom: 0.4rem; }
.imp-abs p { margin: 0.15rem 0; font-size: 0.86rem; line-height: 1.5; }
.imp-abs small { display: block; margin-top: 0.5rem; font-size: 0.8rem; opacity: 0.85; }

.imp-pb {
  background: color-mix(in srgb, var(--p-red-500, #c0392b) 8%, transparent);
  border-left: 2px solid var(--p-red-500, #c0392b);
  border-radius: 4px; padding: 0.8rem 1rem;
}
.imp-pb strong { display: block; font-size: 0.9rem; margin-bottom: 0.5rem; }
.imp-pb ul { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.imp-pb li { font-size: 0.86rem; line-height: 1.5; }
.imp-pb em { opacity: 0.75; font-style: normal; }
.imp-pb small { display: block; margin-top: 0.5rem; font-size: 0.8rem; opacity: 0.8; }
</style>
