# Deploying on your own server (cloud AI by API key)

Target: **2 × Intel Xeon Silver 4110 (16 cores / 32 threads), 64 GB RAM, 2.1 TB RAID 5, no GPU.**

This machine runs the web app, API, database, meeting jobs and the call worker. Call audio goes through **LiveKit Cloud**
(project "Asta AI", free Build plan), so the server needs no call ports. All AI runs in the cloud by API key:
**Sarvam** (translation, speech recognition, speech output) and **Claude** (meeting notes, assistant, photo translate).
(Running LiveKit on this server instead is described at the end. Local models are no longer part of this project.)

> Status: these files are written and the YAML is validated, but they have **not been run on a Linux server yet**.
> The first deployment is the test — go step by step and check each one.

## 1. What the server needs

| Part | RAM | Note |
|---|---|---|
| Postgres, Django, jobs, worker, Caddy | ~3 GB | |
| OS, file cache, growth | the rest | 8 GB RAM is enough; the Xeon server has far more than needed |

There are no AI models on the server, so no GPU, no model downloads and no Hugging Face account. Speed depends on
Sarvam and Claude (measured with `scripts/sarvam_smoke_test.py`: about 2.5–3 s from end of speech to translated audio).
Cost grows with use: watch the admin dashboard and keep the daily limits in `.env`.

**RAID 5** protects against one failed disk — it is **not a backup**. See step 10.

## 2. Network and accounts

With LiveKit Cloud, phones send call audio to LiveKit, not to this server. The server only needs:

| Port | Use |
|---|---|
| 80, 443 TCP (inbound) | website, API, HTTPS certificates |
| outbound HTTPS/WSS | the worker connects out to LiveKit Cloud and Sarvam; the backend calls Sarvam and Anthropic |

You need:
* **A public IP** on the server (static is best), or your router forwarding ports 80 and 443 to it.
* **One DNS name** pointing to that IP, e.g. `call.levelupsystems.in`.
* **LiveKit Cloud API key:** cloud.livekit.io → project "Asta AI" → Settings → API keys → create a key. Note the
  project URL (`wss://….livekit.cloud`), the API key and the API secret. Never paste the secret anywhere but `.env`.
* **Sarvam API key** (dashboard.sarvam.ai) and **Anthropic API key** (console.anthropic.com).

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
`SARVAM_API_KEY` and `ANTHROPIC_API_KEY`. (Or leave the two AI keys empty and add them later in the app's
Admin → API keys page; they are stored encrypted.) Save with Ctrl+O, exit with Ctrl+X.
The defaults already use cloud AI: `AI_ENGINE=sarvam`, `MEETING_STT_ENGINE=sarvam`, `SUMMARY_PROVIDER=anthropic`,
`ASSISTANT_PROVIDER=anthropic`, `SPEECH_PROVIDER=sarvam`.

The server is the only place this file exists — keep a copy of it in a password manager.

## 7. Start everything

```bash
echo 'alias asta="docker compose -f ~/asta/deploy/docker-compose.yml -f ~/asta/deploy/docker-compose.selfhosted.yml --env-file ~/asta/.env"' >> ~/.bashrc && source ~/.bashrc

# App + database + jobs + worker (first build takes a few minutes)
asta up -d --build
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
```

In the app, the **Translate** page shows which engine is used (it should say Sarvam).

## 9. Check the AI keys

On the Translate page translate a paragraph and press **Listen** in Tamil and Hindi. Upload a short Tamil meeting
and generate notes. Then make one test call. Have native Tamil and Hindi speakers judge the voices. The admin
dashboard shows the estimated cost per day; compare it with the Sarvam and Anthropic invoices and adjust the
`COST_*` values and the daily limits.

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
| Translation or speech fails | `asta logs backend` and `asta logs worker`; `SARVAM_API_KEY` set (or added in Admin → API keys); Sarvam credit left |
| Notes or assistant fail | `ANTHROPIC_API_KEY` set; Anthropic credit left; `asta logs jobs` |
| Bill too high | admin dashboard costs; lower the `DAILY_*` limits, use `claude-haiku-5-5`, or set `TRANSLATION_ENABLED=false` |

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
