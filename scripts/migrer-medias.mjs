#!/usr/bin/env node
/**
 * Migration des médias : DATA URL base64 → Storage.
 *
 * POURQUOI
 *   Plusieurs colonnes contiennent des DATA URL base64. Elles sont donc relues
 *   à CHAQUE requête sur leur table, y compris par des écrans qui n'affichent
 *   qu'un titre. Une image doit être servie par le CDN du Storage, avec son
 *   cache, pas transportée dans chaque réponse SQL.
 *
 *   Mesures du 2026-08-19/20 :
 *     - un objet portait 2,72 Mo de modèle : sa fiche mettait 12 s à s'afficher ;
 *     - `select *` sur `museums` (4 lignes, 64 Ko) prenait 13,1 s, contre 1,2 s
 *       en ne demandant que `id, nom` — même table, même serveur ;
 *     - `site_settings.logo` (342 Ko) est relu à CHAQUE changement de page.
 *
 *   C'est cette dernière ligne qui explique la lenteur de NAVIGATION : le poids
 *   n'est pas sur une page en particulier, il est sur toutes.
 *
 * CE QUE FAIT LE SCRIPT
 *   Pour chaque média encore en base64 : téléverse le fichier dans son bucket,
 *   puis remplace la colonne par l'URL publique. Rien d'autre n'est touché.
 *
 * SÛRETÉ
 *   - SIMULATION PAR DÉFAUT : sans `--appliquer`, rien n'est écrit. On voit ce
 *     qui serait fait, et combien on gagnerait.
 *   - La colonne n'est mise à jour QUE si le téléversement a réussi. Un échec
 *     laisse la donnée intacte : au pire on réessaie, jamais on ne perd.
 *   - Idempotent : une valeur qui n'est plus une DATA URL est ignorée. Relancer
 *     le script ne fait rien de plus.
 *
 * PRÉREQUIS — la clé de SERVICE (jamais la clé publique) :
 *   Tableau de bord Supabase → Project Settings → API → `service_role`.
 *   Elle contourne toute la RLS : ne la laissez pas traîner dans un fichier
 *   versionné, et ne la collez nulle part ailleurs.
 *
 * USAGE
 *   # Windows PowerShell
 *   $env:SUPABASE_SERVICE_KEY="eyJ..."
 *   node scripts/migrer-medias.mjs            # simulation
 *   node scripts/migrer-medias.mjs --appliquer
 *
 *   # Git Bash / Linux / macOS
 *   SUPABASE_SERVICE_KEY="eyJ..." node scripts/migrer-medias.mjs --appliquer
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'

const APPLIQUER = process.argv.includes('--appliquer')

// ---------------------------------------------------------------- réglages --
// L'URL du projet se lit dans .env : c'est la même que celle du frontend, et
// elle n'a rien de secret. La clé de service, elle, ne vient QUE de
// l'environnement — l'écrire dans un fichier serait la première façon de la
// perdre.
function lireEnv(nom) {
  if (process.env[nom]) return process.env[nom]
  if (!existsSync('.env')) return null
  const ligne = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${nom}=`))
  return ligne ? ligne.slice(ligne.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : null
}

const URL_PROJET = lireEnv('SUPABASE_URL') || lireEnv('VITE_SUPABASE_URL')
const CLE_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_PROJET) {
  console.error('URL du projet introuvable (SUPABASE_URL ou VITE_SUPABASE_URL dans .env).')
  process.exit(2)
}
if (!CLE_SERVICE) {
  console.error(`Clé de service manquante.

  Posez-la dans l'environnement, PAS dans un fichier :
    PowerShell : $env:SUPABASE_SERVICE_KEY="eyJ..."
    Git Bash   : export SUPABASE_SERVICE_KEY="eyJ..."

  Elle se trouve dans Supabase → Project Settings → API → service_role.`)
  process.exit(2)
}

// Un garde-fou simple : la clé publique commence pareil mais porte le rôle
// « anon ». L'utiliser ici échouerait plus loin, avec un message obscur.
try {
  const charge = JSON.parse(Buffer.from(CLE_SERVICE.split('.')[1], 'base64').toString())
  if (charge.role && charge.role !== 'service_role') {
    console.error(`Cette clé porte le rôle « ${charge.role} », pas « service_role ».`)
    process.exit(2)
  }
} catch { /* clé au format récent (sb_secret_…) : pas de charge lisible, on continue */ }

const sb = createClient(URL_PROJET, CLE_SERVICE, { auth: { persistSession: false } })

// --------------------------------------------------------------- médias -----
// `champ` → bucket. Les modèles et les images n'ont ni le même cycle de vie ni
// les mêmes types autorisés : les mélanger dans un bucket unique obligerait à
// tout y autoriser.
// Le base64 ne se limite PAS a la table `objects` — c'est ce qu'une premiere
// version de ce script supposait, a tort. Releve du 2026-08-20 :
//   objects.model3d     2 781 Ko   fiche objet
//   events.image        1 096 Ko   accueil
//   objects.photo         354 Ko   fiche objet
//   site_settings.logo    342 Ko   TOUTES les pages
//   museums.photo          62 Ko   liste des musees
// Le logo etant relu a chaque navigation, il pesait sur le moindre changement
// de page. On balaie donc toutes les tables concernees.
const CIBLES = [
  { table: 'objects',       champs: [
      { champ: 'photo',        bucket: 'photos',  defaut: 'jpg' },
      { champ: 'photo_thumb',  bucket: 'photos',  defaut: 'jpg' },
      { champ: 'model3d',      bucket: 'modeles', defaut: 'glb' },
      { champ: 'model3d_ios',  bucket: 'modeles', defaut: 'usdz' } ] },
  { table: 'museums',       champs: [{ champ: 'photo', bucket: 'photos', defaut: 'jpg' }] },
  { table: 'events',        champs: [{ champ: 'image', bucket: 'photos', defaut: 'jpg' }] },
  { table: 'products',      champs: [{ champ: 'image', bucket: 'photos', defaut: 'jpg' }] },
  { table: 'campaigns',     champs: [{ champ: 'image', bucket: 'photos', defaut: 'jpg' }] },
  { table: 'personnages',   champs: [{ champ: 'photo', bucket: 'photos', defaut: 'jpg' }] },
  { table: 'tenants',       champs: [{ champ: 'logo',  bucket: 'photos', defaut: 'png' }] },
  // site_settings est la table la plus coûteuse du projet : elle est relue à
  // CHAQUE affichage de page. Seul `logo` était migré, alors que le poids était
  // ailleurs — image_fond 1,7 Mo et login_image 1,1 Mo. Résultat mesuré le
  // 2026-08-21 : 9,7 s pour cette seule requête sur le site de la Fondation.
  // Les six colonnes d'images y passent donc, sans exception.
  { table: 'site_settings', champs: [
      { champ: 'logo',        bucket: 'photos', defaut: 'png' },
      { champ: 'favicon',     bucket: 'photos', defaut: 'png' },
      { champ: 'image_fond',  bucket: 'photos', defaut: 'jpg' },
      { champ: 'hero_image',  bucket: 'photos', defaut: 'jpg' },
      { champ: 'login_image', bucket: 'photos', defaut: 'jpg' },
      { champ: 'seo_image',   bucket: 'photos', defaut: 'jpg' } ] }
]

const EXT_PAR_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif',
  'model/gltf-binary': 'glb', 'model/vnd.usdz+zip': 'usdz'
}

const MIME_PAR_EXT = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip'
}

/**
 * Type réel du contenu, déterminé par sa SIGNATURE et non par l'étiquette de la
 * DATA URL. Les envois passés portent souvent `application/octet-stream`, qui
 * ne dit rien : un .glb et un .usdz arriveraient au même bucket sous la même
 * extension, et le mauvais fichier serait servi à Quick Look.
 */
function typeReel(octets, mimeAnnonce, defaut) {
  const tete = octets.subarray(0, 4).toString('binary')
  if (tete === 'glTF') return 'glb'
  if (tete.startsWith('PK')) return 'usdz'
  if (octets[0] === 0xff && octets[1] === 0xd8) return 'jpg'
  if (tete.startsWith('\x89PNG')) return 'png'
  if (octets.subarray(8, 12).toString('binary') === 'WEBP') return 'webp'
  if (tete.startsWith('GIF8')) return 'gif'
  return EXT_PAR_MIME[mimeAnnonce] || defaut
}

function decouperDataUrl(valeur) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(valeur)
  if (!m) return null
  const [, mime, base64, corps] = m
  return {
    mime: mime || 'application/octet-stream',
    octets: base64 ? Buffer.from(corps, 'base64') : Buffer.from(decodeURIComponent(corps), 'utf8')
  }
}

const mo = (n) => `${(n / 1048576).toFixed(2)} Mo`

// ------------------------------------------------------------------ main ----
console.log(`Projet   : ${URL_PROJET}`)
console.log(`Mode     : ${APPLIQUER ? 'APPLICATION — les données seront modifiées' : 'SIMULATION (ajoutez --appliquer pour écrire)'}
`)

let traites = 0
let octetsLiberes = 0
let echecs = 0

for (const cible of CIBLES) {
  // Toutes les tables n'ont pas les colonnes attendues — `personnages` n'a pas
  // de `photo`, par exemple. On demande, et si la colonne manque on passe au
  // lieu d'interrompre toute la migration.
  const colonnes = ['id', 'tenant_id', ...cible.champs.map((c) => c.champ)].join(', ')
  const { data: lignes, error: eLire } = await sb.from(cible.table).select(colonnes).order('id')

  if (eLire) {
    // 42703 = colonne inexistante ; 42P01 = table inexistante.
    const attendu = /does not exist|42703|42P01/i.test(eLire.message)
    console.log(`${cible.table.padEnd(14)} ${attendu ? 'colonne absente, ignorée' : 'ERREUR : ' + eLire.message}`)
    if (!attendu) echecs++
    continue
  }

  let vusIci = 0

  for (const ligne of lignes || []) {
    const maj = {}

    for (const { champ, bucket, defaut } of cible.champs) {
      const valeur = ligne[champ]
      if (typeof valeur !== 'string' || !valeur.startsWith('data:')) continue

      const morceau = decouperDataUrl(valeur)
      if (!morceau) { console.warn(`  ${cible.table} #${ligne.id} · ${champ} : DATA URL illisible`); continue }

      const ext = typeReel(morceau.octets, morceau.mime, defaut)
      const chemin = `${ligne.tenant_id ?? 0}/${cible.table}-${ligne.id}-${champ}.${ext}`
      console.log(`  ${cible.table.padEnd(14)} #${String(ligne.id).padStart(3)} · ${champ.padEnd(12)} ` +
                  `${mo(valeur.length).padStart(9)} → ${bucket}/${chemin}`)
      vusIci++

      if (!APPLIQUER) { octetsLiberes += valeur.length; continue }

      const { error: eUp } = await sb.storage.from(bucket).upload(chemin, morceau.octets, {
        contentType: MIME_PAR_EXT[ext] || morceau.mime,
        upsert: true
      })
      if (eUp) { console.error(`     téléversement échoué — ${eUp.message}`); echecs++; continue }

      const { data: pub } = sb.storage.from(bucket).getPublicUrl(chemin)
      if (!pub?.publicUrl) { console.error('     URL publique absente'); echecs++; continue }

      // La colonne n'est mise à jour QU'APRÈS un téléversement réussi : un échec
      // laisse la DATA URL en place et une relance reprend le travail.
      maj[champ] = pub.publicUrl
      octetsLiberes += valeur.length
    }

    if (APPLIQUER && Object.keys(maj).length) {
      const { error: eMaj } = await sb.from(cible.table).update(maj).eq('id', ligne.id)
      if (eMaj) { console.error(`  ${cible.table} #${ligne.id} : mise à jour échouée — ${eMaj.message}`); echecs++; continue }
      traites++
    } else if (Object.keys(maj).length || vusIci) {
      traites += 0
    }
  }

  if (!vusIci) console.log(`${cible.table.padEnd(14)} rien à migrer`)
}

console.log('')
console.log(`${mo(octetsLiberes)} de médias sortis de la base` +
            (APPLIQUER ? ` · ${traites} ligne(s) mise(s) à jour` : '') +
            (echecs ? ` · ${echecs} échec(s)` : ''))
if (!APPLIQUER) console.log("\nSimulation : rien n'a été modifié. Relancez avec --appliquer.")
process.exit(echecs ? 1 : 0)
