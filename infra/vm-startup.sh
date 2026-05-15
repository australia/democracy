#!/usr/bin/env bash
# Runs on first boot of the GCE VM. Installs docker, clones the repo, brings
# up the stack via docker compose. Re-runs on every boot are safe because the
# compose `init` service is idempotent.
set -euxo pipefail

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

cd /opt
if [ ! -d democracy ]; then
  git clone https://github.com/australia/democracy.git
fi
cd democracy
git pull --ff-only origin main || true

PUBLIC_URL="http://$(curl -sf -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || echo localhost)"
export PUBLIC_URL

docker compose -f docker-compose.prod.yml up -d --build
