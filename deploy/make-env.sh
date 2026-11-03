#!/usr/bin/env bash
# Creates the production .env on the server from deploy/production.env.example, with new random secrets.
#   bash deploy/make-env.sh app.yourdomain.in livekit.yourdomain.in
set -euo pipefail
cd "$(dirname "$0")/.."

app="${1:?usage: bash deploy/make-env.sh <app domain> <livekit domain>}"
livekit="${2:?usage: bash deploy/make-env.sh <app domain> <livekit domain>}"
if [ -e .env ]; then
  echo ".env already exists; not overwriting it (move it away first if you really want a new one)." >&2
  exit 1
fi

umask 077
cp deploy/production.env.example .env
# Each __RANDOM__ gets its own secret; the Fernet key is 32 random bytes in URL-safe base64.
while grep -q "__RANDOM__" .env; do
  sed -i "0,/__RANDOM__/s//$(openssl rand -hex 32)/" .env
done
sed -i "s|__FERNET__|$(openssl rand -base64 32 | tr '+/' '-_')|" .env
sed -i "s|__APP_DOMAIN__|${app}|g; s|__LIVEKIT_DOMAIN__|${livekit}|g" .env

echo "Created .env (readable only by you)."
echo "Still to fill in with: nano .env"
grep -n "__FILL__" .env || true
