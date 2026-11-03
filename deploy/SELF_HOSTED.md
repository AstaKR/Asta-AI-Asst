# Deploying on your own server (with free local AI)

Target: **2 × Intel Xeon Silver 4110 (16 cores / 32 threads), 64 GB RAM, 2.1 TB RAID 5, no GPU.**

This machine runs the web app, API, database, meeting jobs, call worker and the free AI models. Call audio goes
through **LiveKit Cloud** (project "Asta AI", free Build plan), so the server needs no call ports.
Sarvam/Claude stay available as optional cloud engines. (Running LiveKit on this server instead is described at the end.)

> Status: these files are written and the YAML is validated, but they have **not been run on a Linux server yet**.
> The first deployment is the test — go step by step and check each one.

## 1. What the server can handle

| Part | RAM | Note |
|---|---|---|
| Postgres, Django, worker, Caddy | ~3 GB | |
| IndicTrans2 (3 models) | ~4 GB | |
| Whisper `large-v3-turbo` (meetings) + `small` (live) | ~4 GB | much better Tamil than the laptop's `small` |
| Indic Parler-TTS | ~4 GB | |
| Qwen3 30B-A3B Instruct summaries + assistant chat (Ollama) | ~20 GB | Apache-2.0; uses ~3B parameters per word, so it is fast on CPU |
| Qwen3-VL 8B Instruct photo translate (Ollama) | ~7 GB | Apache-2.0; loaded only while used |
| **Total** | **~42 GB of 64 GB** | room for the OS, file cache and growth |

**Speed:** this is a CPU-only server, and the Xeon 4110 runs at 2.1 GHz. It has many cores, but each core is slower
than a modern laptop's. Expect meetings and the Translate page to work well (batch work, seconds per request).
**Live translated calls with local models will be turn-by-turn with several seconds of delay** — Parler-TTS is the
slowest part. Measure it after setup (step 9). If it's too slow, either keep `SPEECH_PROVIDER=sarvam` for live calls
(everything else stays free) or add an NVIDIA GPU later (needs code support for `cuda`, not added yet).

**RAID 5** protects against one failed disk — it is **not a backup**. See step 10.

## 2. Network and accounts

With LiveKit Cloud, phones send call audio to LiveKit, not to this server. The server only needs:

| Port | Use |
|---|---|
| 80, 443 TCP (inbound) | website, API, HTTPS certificates |
| outbound HTTPS/WSS | the worker connects out to LiveKit Cloud; models download from Hugging Face and Ollama |

You need:
* **A public IP** on the server (static is best), or your router forwarding ports 80 and 443 to it.
* **One DNS name** pointing to that IP, e.g. `call.levelupsystems.in`.
* **LiveKit Cloud API key:** cloud.livekit.io → project "Asta AI" → Settings → API keys → create a key. Note the
  project URL (`wss://….livekit.cloud`), the API key and the API secret. Never paste the secret anywhere but `.env`.
* **Hugging Face read token** with the four AI4Bharat model terms accepted (docs/LOCAL_AI.md step 2).

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

A script creates `.env` from `deploy/production.env.example`, fills every secret with a new random value and sets
your domain:

```bash
bash deploy/make-env.sh call.levelupsystems.in
nano .env
```

In `nano`, fill the values it lists: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (from LiveKit Cloud),
`HF_TOKEN`, and `SARVAM_API_KEY` if you use Sarvam for live calls. Save with Ctrl+O, exit with Ctrl+X.
The defaults already use the free local AI (`AI_ENGINE=local`, `SUMMARY_PROVIDER=ollama`, `ASSISTANT_PROVIDER=ollama`)
and Sarvam for live calls (`SPEECH_PROVIDER=sarvam`, switch after step 9).

The server is the only place this file exists — keep a copy of it in a password manager.

## 7. Start everything

```bash
echo 'alias asta="docker compose -f ~/asta/deploy/docker-compose.yml -f ~/asta/deploy/docker-compose.selfhosted.yml --env-file ~/asta/.env"' >> ~/.bashrc && source ~/.bashrc

# App + database + jobs + worker + local AI + Ollama (first build takes 15–30 minutes)
asta up -d --build

# Summary/assistant and photo models (about 25 GB download, once). Use the -instruct tags.
asta exec ollama ollama pull qwen3:30b-instruct
asta exec ollama ollama pull qwen3-vl:8b-instruct
asta ps
```

`asta logs worker` should show that the worker registered with LiveKit Cloud.

## 8. First-time setup

```bash
asta exec backend python manage.py createsuperuser                      # Django admin login (optional)
asta exec backend python manage.py grant_admin --username YOUR_USERNAME   # after registering in the web app
```

Open `https://call.levelupsystems.in`, register an account, run `grant_admin` for it, and refresh. Check:

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
| Calls do not connect | `asta logs worker` shows it registered; `LIVEKIT_URL`/key/secret match LiveKit Cloud → API keys |
| Calls stop working one day | LiveKit Cloud → Usage and limits: the free Build plan's monthly allowance may be used up |
| "Local AI … not available" | `asta logs local-ai`; Hugging Face terms accepted for all four models; `HF_TOKEN` set |
| Summaries fail | `asta exec ollama ollama list` shows `qwen3:30b-instruct` |
| Server slow | `docker stats`; lower `LOCAL_MT_BEAMS` to 1 or use `LOCAL_WHISPER_MODEL=medium` |

## Optional: run LiveKit on this server instead of LiveKit Cloud

Only if you prefer not to use LiveKit Cloud. It needs a static public IP, a second DNS name and more open ports
(7881/tcp, 50000–60000/udp; for phone calls 5060 and 10000–20000/udp, restricted to the provider's IPs).

```bash
bash deploy/make-env.sh call.levelupsystems.in livekit.levelupsystems.in   # sets the self-hosted values
sudo ufw allow 7881/tcp && sudo ufw allow 50000:60000/udp
docker compose -f deploy/docker-compose.livekit.yml --env-file .env up -d
asta up -d --build
```

The script then sets `LIVEKIT_URL=wss://livekit…`, its own key pair, `CADDYFILE=Caddyfile.selfhosted` (HTTPS for
LiveKit) and `LIVEKIT_WORKER_URL=ws://host.docker.internal:7880`.
