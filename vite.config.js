import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// HTTPS de développement — SUR DEMANDE UNIQUEMENT, jamais par défaut.
//
//   npm run dev         → http://localhost:5173, comme toujours
//   npm run dev:phone   → https://<ip-du-poste>:5173, pour tester la RA
//
// Pourquoi ce second mode existe : WebXR n'est disponible que dans un contexte
// sécurisé. Sur http://192.168.x.x, `navigator.xr` n'existe pas et le bouton de
// réalité augmentée ne peut pas s'afficher.
//
// Pourquoi il n'est PAS automatique : un certificat auto-signé fait échouer tout
// ce qui parle au serveur sans exception de sécurité — navigateur intégré,
// outils, extensions. Le mode normal doit rester le mode normal.
//
// Le certificat se génère avec `bash scripts/dev-cert.sh`, à relancer à chaque
// changement de réseau (l'adresse IP du poste doit y figurer).
function certificatDev() {
  const key = fileURLToPath(new URL('./certs/dev-key.pem', import.meta.url))
  const cert = fileURLToPath(new URL('./certs/dev-cert.pem', import.meta.url))
  if (!existsSync(key) || !existsSync(cert)) {
    console.warn(
      '\n[dev:phone] Aucun certificat dans certs/. Lancez d\'abord :\n' +
      '   bash scripts/dev-cert.sh\n' +
      'Démarrage en HTTP simple — la réalité augmentée ne pourra pas se lancer.\n'
    )
    return undefined
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const pourTelephone = mode === 'phone'
  const https = pourTelephone ? certificatDev() : undefined

  return {
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // <model-viewer> est un web component (Google) : on dit au compilateur
            // Vue de ne pas le traiter comme un composant Vue.
            isCustomElement: (tag) => tag === 'model-viewer'
          }
        }
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      // ── DÉCOUPAGE DU SOCLE ─────────────────────────────────────────────────
      //
      // MESURÉ le 2026-08-29 : le fragment d'entrée pesait 724 ko à lui seul, et
      // le tiers venait du client Supabase (auth 400 ko de source, storage 106,
      // postgrest 104, temps réel 95). Tout cela partait dans UN SEUL fichier,
      // avec notre code.
      //
      // LE VRAI COÛT N'ÉTAIT PAS LA TAILLE, MAIS L'INVALIDATION. Le nom du
      // fragment contient une empreinte du contenu : corriger une virgule dans
      // une vue changeait l'empreinte du fichier ENTIER, et chaque visiteur
      // retéléchargeait 724 ko — socle compris — à chaque déploiement. Sur les
      // réseaux qui nous intéressent, c'est ce qui fait « le site est redevenu
      // lent » alors que rien n'a grossi.
      //
      // Séparés, ces morceaux ne bougent qu'aux montées de version. Un
      // déploiement ne renouvelle plus que le fragment applicatif, et le
      // navigateur télécharge le reste en parallèle plutôt qu'en un seul bloc.
      //
      // ON NE DÉCOUPE PAS PLUS FIN. Multiplier les fragments multiplie les
      // requêtes, et sur une connexion à forte latence chaque requête coûte
      // plus cher que les octets qu'elle transporte.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('@supabase')) return 'socle-supabase'
            // PAS DE RÈGLE POUR PRIMEVUE, ET C'EST UNE LEÇON MESURÉE.
            // Regrouper primevue/* fait passer le premier écran de 724 ko à
            // 1 372 ko : ses composants n'étaient chargés que par les écrans qui
            // les utilisent — donc l'administration — et les réunir dans un
            // fragment que l'entrée importe les rend TOUS obligatoires. Rollup
            // les répartit mieux tout seul, route par route. Ne pas rétablir.
            if (id.includes('vue-i18n') || id.includes('@intlify')) return 'socle-i18n'
            if (id.includes('/vue/') || id.includes('@vue/') || id.includes('vue-router') || id.includes('/pinia/')) return 'socle-vue'
          }
        }
      }
    },
    server: {
      // Honore le port assigné par l'outil de preview (variable PORT), sinon 5173.
      port: Number(process.env.PORT) || 5173,
      https,
      // En mode téléphone on écoute aussi sur le réseau local : c'est tout
      // l'intérêt, l'appareil doit pouvoir joindre le poste.
      host: pourTelephone ? true : undefined
    }
  }
})
