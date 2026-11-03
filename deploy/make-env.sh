#!/usr/bin/env bash
# Creates the production .env on the server from deploy/production.env.example, with new random secrets.
#   bash deploy/make-env.sh app.yourdomain.in                          # LiveKit Cloud (default)
#   bash deploy/make-env.sh app.yourdomain.in livekit.yourdomain.in    # self-hosted LiveKit on this server
set -euo pipefail
cd "$(dirname "$0")/.."

app="${1:?usage: bash deploy/make-env.sh <app domain> [<livekit domain> for self-hosted LiveKit]}"
livekit="${2:-}"
if [ -e .env ]; then
  echo ".env already exists; not overwriting it (move it away first if you really want a new one)." >&2
  exit 1
fi

umask 077
cp deploy/production.env.example .env
if [ -n "$livekit" ]; then
  # Self-hosted LiveKit: our own key pair, its own domain behind Caddy, the worker reaches it on this host.
  sed -i "s|^LIVEKIT_URL=.*|LIVEKIT_URL=wss://${livekit}|; s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=APIasta01|; s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=__RANDOM__|" .env
  printf '
# ---------- Self-hosted LiveKit (deploy/docker-compose.livekit.yml) ----------
LIVEKIT_DOMAIN=%s
CADDYFILE=Caddyfile.selfhosted
LIVEKIT_WORKER_URL=ws://host.docker.internal:7880
' "$livekit" >> .env
fi
# Each __RANDOM__ gets its own secret; the Fernet key is 32 random bytes in URL-safe base64.
while grep -q "__RANDOM__" .env; do
  sed -i "0,/__RANDOM__/s//$(openssl rand -hex 32)/" .env
done
sed -i "s|__FERNET__|$(openssl rand -base64 32 | tr '+/' '-_')|" .env
sed -i "s|__APP_DOMAIN__|${app}|g" .env

echo "Created .env (readable only by you)."
echo "Still to fill in with: nano .env"
grep -n "__FILL__" .env || true
