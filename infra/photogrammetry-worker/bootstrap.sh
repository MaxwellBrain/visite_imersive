#!/bin/bash
# ============================================================================
# Amorçage de l'instance GPU de reconstruction — MUSÉA
# ----------------------------------------------------------------------------
# ⚠️ CE FICHIER EST UN GABARIT TERRAFORM, pas un script autonome.
# Les accolades précédées d'un dollar sont substituées par `templatefile()` AVANT
# d'atteindre la machine. Une variable shell écrite de cette façon serait donc
# interprétée par Terraform et ferait échouer le plan ; s'il en faut une un jour,
# doubler le dollar : $${FOO}.
# (Ce commentaire lui-même a déclenché l'erreur lors de la première écriture.)
#
# L'AMI attendue est une « Deep Learning Base OSS » Ubuntu : pilotes NVIDIA,
# Docker et nvidia-container-toolkit déjà en place. Les installer sur une Ubuntu
# nue prend vingt minutes et casse à chaque changement de noyau — inacceptable
# sur une instance spot qui peut être reprise à tout moment.
#
# `set -euo pipefail` : une étape ratée doit interrompre l'amorçage plutôt que
# laisser une machine à moitié prête réclamer des campagnes qu'elle échouera.
# ============================================================================
set -euo pipefail

exec > >(tee /var/log/musea-bootstrap.log) 2>&1
echo "=== Amorçage MUSÉA — $(date -Is) ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3-pip nodejs npm

# obj2gltf (CesiumGS) : conversion OBJ texturé → GLB. C'est le convertisseur qui
# respecte le mieux les matériaux produits par Meshroom.
npm install -g obj2gltf
pip3 install --no-cache-dir requests

# Vérification franche du GPU. Sans lui, Meshroom échouerait campagne après
# campagne en laissant croire à un problème de photos.
if ! nvidia-smi > /dev/null 2>&1; then
  echo "ERREUR : aucun GPU NVIDIA visible. Vérifiez le type d'instance et l'AMI." >&2
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

# Image Meshroom (~8 Go) tirée MAINTENANT plutôt qu'au premier travail : sinon
# la première campagne paraîtrait anormalement lente et pourrait expirer.
docker pull "${meshroom_image}"

install -d -m 0755 /opt/musea /var/musea

# Le worker est déposé ici même : cela évite de dépendre d'un dépôt Git ou d'un
# bucket accessibles depuis l'instance au moment de l'amorçage.
cat > /opt/musea/worker.py <<'FIN_DU_WORKER'
${worker_py}
FIN_DU_WORKER
chmod +x /opt/musea/worker.py

# Les secrets passent par un fichier à permissions restreintes, jamais par la
# ligne de commande : `ps` est lisible par tous les utilisateurs de la machine.
cat > /etc/musea-worker.env <<EOF
SUPABASE_URL=${supabase_url}
SUPABASE_SERVICE_KEY=${supabase_service_key}
MUSEA_IDLE_SHUTDOWN=${idle_minutes}
MUSEA_MESHROOM_IMAGE=${meshroom_image}
MUSEA_WORKDIR=/var/musea
EOF
chmod 600 /etc/musea-worker.env

cat > /etc/systemd/system/musea-worker.service <<'EOF'
[Unit]
Description=MUSEA - worker de reconstruction photogrammetrique
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/musea-worker.env
ExecStart=/usr/bin/python3 /opt/musea/worker.py
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now musea-worker.service
echo "=== Worker démarré — journalctl -u musea-worker -f ==="
