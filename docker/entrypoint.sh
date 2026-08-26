#!/bin/sh
# ============================================================================
# Point d'entrée du conteneur MUSÉA
# ----------------------------------------------------------------------------
# Une seule responsabilité : traduire les variables d'environnement injectées
# par ECS ou Kubernetes en configuration nginx, puis s'effacer.
#
# RÈGLE DE CONCEPTION : ce script ne doit JAMAIS empêcher nginx de démarrer.
# Sans variable, il ne fait rien et le comportement reste identique à celui
# d'avant son existence — un `docker run -p 8080:8080 musea` se comporte
# exactement comme auparavant.
#
# Il tourne sous l'utilisateur `nginx`, sans privilège, et n'écrit que
# dans /tmp.
# ============================================================================

set -eu

REPERTOIRE_CONF="/tmp/musea"
mkdir -p "$REPERTOIRE_CONF"

# Repartir propre : une configuration héritée d'un redémarrage précédent
# laisserait un portail actif alors que le secret a été vidé.
rm -f "$REPERTOIRE_CONF"/auth.conf "$REPERTOIRE_CONF"/htpasswd

# ----------------------------------------------------------------------------
# Portail d'accès — MUSEA_BASIC_AUTH, au format « utilisateur:motdepasse »
#
# Injecté par ECS depuis AWS Secrets Manager (clé `basic_auth`). Vide ou absent
# en production : le site est public, c'est le but.
#
# À quoi cela sert réellement : empêcher qu'un environnement de recette soit
# indexé par un moteur de recherche ou ouvert par erreur pendant une
# démonstration. Ce n'est PAS une frontière de sécurité — le mot de passe
# transite en variable d'environnement et est stocké en clair dans le fichier
# ci-dessous. Rien de confidentiel ne doit dépendre de lui.
# ----------------------------------------------------------------------------
if [ -n "${MUSEA_BASIC_AUTH:-}" ]; then
  utilisateur="${MUSEA_BASIC_AUTH%%:*}"
  motdepasse="${MUSEA_BASIC_AUTH#*:}"

  if [ -n "$utilisateur" ] && [ -n "$motdepasse" ] && [ "$utilisateur" != "$motdepasse" ]; then
    # « {PLAIN} » est un format que nginx comprend nativement : il évite
    # d'embarquer apache2-utils dans l'image pour un seul appel à htpasswd.
    printf '%s:{PLAIN}%s\n' "$utilisateur" "$motdepasse" > "$REPERTOIRE_CONF/htpasswd"
    chmod 600 "$REPERTOIRE_CONF/htpasswd"

    cat > "$REPERTOIRE_CONF/auth.conf" <<CONF
auth_basic "MUSEA - acces restreint";
auth_basic_user_file $REPERTOIRE_CONF/htpasswd;
CONF
    echo "[musea] portail d'acces actif pour l'utilisateur « $utilisateur »"
  else
    # Une valeur malformée ne doit pas verrouiller le site par accident, ni
    # l'ouvrir en croyant l'avoir fermé : on le dit, fort, et on continue.
    echo "[musea] MUSEA_BASIC_AUTH malformee (attendu « utilisateur:motdepasse ») - portail DESACTIVE" >&2
  fi
fi

echo "[musea] environnement=${MUSEA_ENVIRONNEMENT:-non defini} demarrage de nginx"

# `exec` : nginx devient le processus 1 et reçoit directement les signaux
# d'arrêt. Sans cela, le script resterait au milieu, et l'arrêt d'une tâche
# attendrait le délai de grâce complet à chaque déploiement.
exec "$@"
