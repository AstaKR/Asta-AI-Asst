# Deploying to a cloud server

Status: these files are written and the Django production settings pass `manage.py check --deploy`, but the Docker
build itself has **not been run yet** (Docker isn't installed on the development PC). The first deployment is the test.

## What you need (your accounts)

1. **A Linux server** (Ubuntu 24.04, 2 vCPU / 4 GB RAM is plenty to start), with a public IP.
2. **A domain name**, with an `A` record such as `call.yourdomain.com → <server IP>`.
3. **LiveKit Cloud** project (<https://cloud.livekit.io>): copy the project URL (`wss://…livekit.cloud`), API key and secret.
4. Your **Sarvam** API key.

## Steps (on the server)

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Get the code onto the server (git clone from your repository, or copy the folder)
cd ai-call-translator

# 3. Create the production .env
cp .env.example .env
nano .env
```

Production values to set in `.env`:

```ini
APP_DOMAIN=call.yourdomain.com
POSTGRES_PASSWORD=<long random string>
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<long random string>
DJANGO_ALLOWED_HOSTS=call.yourdomain.com,backend
CORS_ALLOWED_ORIGINS=https://call.yourdomain.com
CSRF_TRUSTED_ORIGINS=https://call.yourdomain.com
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<from LiveKit Cloud>
LIVEKIT_API_SECRET=<from LiveKit Cloud>
WORKER_SHARED_SECRET=<long random string>
SARVAM_API_KEY=<your key>
SMS_BACKEND=disabled            # until an SMS provider is integrated (phone login needs it)
```

Generate random strings with `openssl rand -base64 48`.

```bash
# 4. Start everything (Postgres, Django, translation worker, web app + HTTPS)
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

# 5. Check
curl https://call.yourdomain.com/api/health/
docker compose -f deploy/docker-compose.yml logs -f worker    # should show "registered worker"
```

Open `https://call.yourdomain.com` — the web app works from any phone or PC browser. For the Android app, set
`EXPO_PUBLIC_API_URL=https://call.yourdomain.com` in `mobile/eas.json` and build (see `mobile/README.md`).

## Updating

```bash
git pull
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

## Notes

- Only ports 80/443 need to be open; LiveKit media goes through LiveKit Cloud.
- Back up the `pgdata` volume (accounts, call metadata, usage). No audio or transcripts are stored.
- To stop all AI spending immediately: set `TRANSLATION_ENABLED=false` and `docker compose … up -d worker backend`.
