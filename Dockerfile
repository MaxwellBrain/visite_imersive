# ============================================================================
# Image de production MUSÉA
# ----------------------------------------------------------------------------
# Cette image sert trois usages, du plus quotidien au plus engageant :
#
#   · vérifier EN LOCAL le comportement de production — repli SPA, types MIME,
#     en-têtes — avant de payer un déploiement pour le découvrir ;
#   · alimenter la pile conteneurs (infra-conteneurs/) : ECR, ECS Fargate,
#     Kubernetes, et Docker Hub pour la rendre vérifiable par un tiers ;
#   · garantir une porte de sortie — la même image tourne sur App Runner,
#     Scaleway ou un simple VPS.
#
# Le chemin par défaut du site public reste S3 + CloudFront (infra/) : pour du
# statique pur, c'est vingt fois moins cher. Les deux voies coexistent et
# servent le MÊME artefact.
#
#   docker build -t musea \
#     --build-arg VITE_SUPABASE_URL=... \
#     --build-arg VITE_SUPABASE_ANON_KEY=... .
#   docker run --rm -p 8080:8080 musea
#
# Construction multi-architecture (amd64 + arm64, ~20 % moins cher sur
# Graviton) — voir .github/workflows/conteneur.yml :
#   docker buildx build --platform linux/amd64,linux/arm64 -t musea .
# ============================================================================

# ---------------------------------------------------------------- compilation
# --platform=$BUILDPLATFORM : la compilation se fait TOUJOURS sur
# l'architecture de la machine qui construit, jamais sous émulation. C'est ce
# qui rend l'image multi-architecture réalisable en pratique : sans cette
# ligne, `npm ci` tournerait sous QEMU pour la cible arm64 et la construction
# passerait de deux minutes à un quart d'heure. Seul l'étage de diffusion, qui
# ne fait que recopier des fichiers statiques, est réellement dupliqué par
# architecture.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /app

# Les dépendances d'abord : cette couche est réutilisée tant que les
# verrouillages ne bougent pas, ce qui évite de tout réinstaller à chaque build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inscrit ces valeurs DANS le bundle : elles doivent exister à la
# compilation. Les fournir au `docker run` n'aurait aucun effet.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PLATFORM_DOMAIN
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_PLATFORM_DOMAIN=$VITE_PLATFORM_DOMAIN

RUN npm run build \
    && test -f dist/index.html \
    && test -f dist/modeles/tabouret.glb

# ------------------------------------------------------------------ diffusion
FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Hors de conf.d/ : nginx inclut tout conf.d/*.conf au niveau http, ou des
# add_header isoles seraient refuses. Ce fichier n'a de sens qu'inclus
# depuis un bloc server ou location.
COPY docker/securite.conf /etc/nginx/securite.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=build /app/dist /usr/share/nginx/html

# Port non privilégié : le conteneur tourne sans root.
EXPOSE 8080

# nginx a besoin d'écrire ses fichiers temporaires ; on lui en donne le droit
# sans lui rendre le reste du système accessible. /tmp/musea reçoit la
# configuration produite au démarrage à partir des variables d'environnement.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid \
    && mkdir -p /tmp/musea \
    && chown nginx:nginx /tmp/musea \
    && chmod +x /usr/local/bin/entrypoint.sh
USER nginx

# La sonde vise /sante, pas « / » : la page d'accueil peut être protégée par le
# portail du staging, et répondrait alors 401 à un conteneur pourtant sain.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/sante >/dev/null || exit 1

# Le point d'entrée traduit les variables d'environnement en configuration,
# puis passe la main à nginx par `exec`. Sans variable, il ne fait rien : le
# comportement d'un `docker run` nu est inchangé.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
