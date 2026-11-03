# Deploying on your own server (with free local AI)

Target: **2 × Intel Xeon Silver 4110 (16 cores / 32 threads), 64 GB RAM, 2.1 TB RAID 5, no GPU.**

Everything runs on this one machine: web app, API, database, meeting jobs, call worker, LiveKit (calls), and the
free AI models. Sarvam/Claude stay available as optional cloud engines.

> Status: these files are written and the YAML is validated, but they have **not been run on a Linux server yet**.
> The first deployment is the test — go step by step and check each one.

## 1. What the server can handle

| Part | RAM | Note |
|---|---|---|
| Postgres, Django, worker, Caddy, LiveKit, Redis | ~4 GB | |
| IndicTrans2 (3 models) | ~4 GB | |
| Whisper `large-v3-turbo` (meetings) + `small` (live) | ~4 GB | much better Tamil than the laptop's `small` |
| Indic Parler-TTS | ~4 GB | |
| Qwen3 30B-A3B Instruct summaries + assistant chat (Ollama) | ~20 GB | Apache-2.0; uses ~3B parameters per word, so it is fast on CPU |
| Qwen3-VL 8B Instruct photo translate (Ollama) | ~7 GB | Apache-2.0; loaded only while used |
| **Total** | **~43 GB of 64 GB** | room for the OS, file cache and growth |

**Speed:** this is a CPU-only server, and the Xeon 4110 runs at 2.1 GHz. It has many cores, but each core is slower
than a modern laptop's. Expect meetings and the Translate page to work well (batch work, seconds per request).
**Live translated calls with local models will be turn-by-turn with several seconds of delay** — Parler-TTS is the
slowest part. Measure it after setup (step 9). If it's too slow, either keep `SPEECH_PROVIDER=sarvam` for live calls
(everything else stays free) or add an NVIDIA GPU later (needs code support for `cuda`, not added yet).

**RAID 5** protects against one failed disk — it is **not a backup**. See step 10.

## 2. Network requirements (most important)

Calls use WebRTC, which needs the server reachable from the internet on these ports:

| Port | Use |
|---|---|
| 80, 443 TCP | website, API, HTTPS certificates, LiveKit signalling (wss) |
| 7881 TCP | LiveKit media over TCP (fallback) |
| 50000–60000 UDP | LiveKit media (voice/video) |
| 5060 UDP/TCP, 10000–20000 UDP | only for phone calls (SIP) — restrict to your provider's IPs |

You need:
* **A static public IP** on the server, or your router/firewall forwarding the ports above to it.
  (Cloudflare Tunnel and similar do **not** carry UDP call media.)
* **Two DNS names** pointing to that IP, e.g. `call.levelupsystems.in` (app) and `livekit.levelupsystems.in` (calls).

## 3. Install the operating system

Ubuntu Server **24.04 LTS** (recommended). In the RAID controller (BIOS/iDRAC/iLO), create the RAID 5 virtual disk
first; Ubuntu then sees it as one disk. During install enable **OpenSSH**. Then:

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Kolkata
lsblk            # the RAID volume should show as one ~2.1 TB disk
nproc            # should print 32
free -g          # should show ~62 GB
```

## 4. Install Docker and the firewall

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 50000:60000/udp
sudo ufw enable
```

## 5. Get the code

The GitHub repository is private. On the server create a read-only **deploy key**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/asta_deploy -N ""
cat ~/.ssh/asta_deploy.pub
```

Add the printed key on GitHub → repository → Settings → Deploy keys (read-only). Then:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/asta_deploy" git clone git@github.com:AstaKR/Asta-AI-Asst.git asta
cd asta
git config core.sshCommand "ssh -i ~/.ssh/asta_deploy"
```

## 6. Production `.env`

```bash
cp .env.example .env
nano .env
```

Generate every secret with `openssl rand -base64 48`. Set:

```ini
APP_DOMAIN=call.levelupsystems.in
LIVEKIT_DOMAIN=livekit.levelupsystems.in

DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<random>
DJANGO_ALLOWED_HOSTS=call.levelupsystems.in,backend
CORS_ALLOWED_ORIGINS=https://call.levelupsystems.in
CSRF_TRUSTED_ORIGINS=https://call.levelupsystems.in
POSTGRES_PASSWORD=<random>
SECRETS_ENCRYPTION_KEY=<python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">
WORKER_SHARED_SECRET=<random>

# Self-hosted LiveKit
LIVEKIT_URL=wss://livekit.levelupsystems.in
LIVEKIT_API_KEY=<random, letters only, e.g. APIabc123>
LIVEKIT_API_SECRET=<random, 32+ chars>

# Free local AI
LOCAL_AI_SECRET=<random>
HF_TOKEN=<Hugging Face read token — see docs/LOCAL_AI.md step 2>
AI_ENGINE=local
MEETING_STT_ENGINE=local
SUMMARY_PROVIDER=ollama
OLLAMA_MODEL=qwen3:30b-instruct
ASSISTANT_PROVIDER=ollama
ASSISTANT_VISION_MODEL=qwen3-vl:8b-instruct
SPEECH_PROVIDER=sarvam        # switch to local after measuring call delay (step 9)
SARVAM_API_KEY=               # optional; or add it later on Admin → API keys
SMS_BACKEND=disabled
```

The server is the only place this file exists — keep a copy of it in a password manager.

## 7. Start everything

```bash
# Calls: LiveKit + Redis (+ SIP) on the host network
docker compose -f deploy/docker-compose.livekit.yml --env-file .env up -d

# App + database + jobs + worker + local AI + Ollama (first build takes 15–30 minutes)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhosted.yml --env-file .env up -d --build

# Summary/assistant and photo models (about 25 GB download, once). Use the -instruct tags.
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhosted.yml exec ollama ollama pull qwen3:30b-instruct
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhosted.yml exec ollama ollama pull qwen3-vl:8b-instruct
```

Tip: save the long command as an alias:

```bash
echo 'alias asta="docker compose -f ~/asta/deploy/docker-compose.yml -f ~/asta/deploy/docker-compose.selfhosted.yml --env-file ~/asta/.env"' >> ~/.bashrc && source ~/.bashrc
asta ps
```

## 8. First-time setup

```bash
asta exec backend python manage.py createsuperuser                 # Django admin login
asta exec backend python manage.py grant_admin --phone +91XXXXXXXXXX  # make your app account an admin
```

Open `https://call.levelupsystems.in` and sign in. Check:

```bash
curl https://call.levelupsystems.in/api/health/
asta logs -f worker          # should show "registered worker"
asta logs -f local-ai        # model downloads appear on first use
```

The first translation, transcription and speech request each download a model (1–4 GB) — the first request of each
kind is slow; after that they stay in memory. In the app, the **Translate** page shows which engine is used.

## 9. Measure before relying on local live calls

On the Translate page: translate a paragraph, press **Listen** in Tamil and Hindi, and note the times. Upload a
5-minute Tamil meeting and note how long transcription takes. Then try one call with `SPEECH_PROVIDER=local`
(`asta up -d worker` after changing `.env`). If the delay between turns is acceptable, keep it; otherwise set it back
to `sarvam`. Have native Tamil and Hindi speakers judge the voices before customers hear them.

## 10. Backups (RAID is not a backup)

Daily database dump, kept 14 days, plus the meeting recordings:

```bash
sudo mkdir -p /backup && sudo chown $USER /backup
crontab -e
```

```cron
30 2 * * * docker compose -f ~/asta/deploy/docker-compose.yml exec -T db pg_dump -U translator translator | gzip > /backup/db-$(date +\%F).sql.gz && find /backup -name 'db-*.sql.gz' -mtime +14 -delete
```

Copy `/backup` and the `media` volume (`docker volume inspect asta_media` shows its path) to **another machine or
cloud storage** regularly. Test a restore once.

## 11. Updating

```bash
cd ~/asta && git pull
asta up -d --build
```

## 12. Mobile app

Set `EXPO_PUBLIC_API_URL=https://call.levelupsystems.in` in `mobile/eas.json` (production profile) and build a new
APK (see `mobile/README.md`).

## Troubleshooting

| Problem | Check |
|---|---|
| Site doesn't open / no HTTPS | DNS points to the server; ports 80/443 reach it; `asta logs web` |
| Calls connect but no audio | UDP 50000–60000 open end-to-end (router too); `use_external_ip` needs the public IP |
| "Local AI … not available" | `asta logs local-ai`; Hugging Face terms accepted for all four models; `HF_TOKEN` set |
| Summaries fail | `asta exec ollama ollama list` shows `qwen3:30b-instruct` |
| Server slow | `docker stats`; lower `LOCAL_MT_BEAMS` to 1 or use `LOCAL_WHISPER_MODEL=medium` |
