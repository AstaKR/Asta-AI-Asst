# One-time local setup for Windows PowerShell. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Python 3.11+ is required (https://www.python.org/downloads/)" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required (https://nodejs.org/)" }

if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\pip install -r requirements.txt

npm --prefix frontend install

if (-not (Test-Path .env)) {
    $django = .\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))"
    $worker = .\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(32))"
    (Get-Content .env.example -Encoding utf8) `
        -replace '^DJANGO_SECRET_KEY=.*', "DJANGO_SECRET_KEY=$django" `
        -replace '^WORKER_SHARED_SECRET=.*', "WORKER_SHARED_SECRET=$worker" `
        -replace '^LIVEKIT_API_SECRET=.*', 'LIVEKIT_API_SECRET=secret' |
        Set-Content .env -Encoding utf8
    Write-Host "Created .env (LiveKit dev keys devkey/secret). Add SARVAM_API_KEY to enable translation."
}

.\.venv\Scripts\python backend\manage.py migrate

$lk = "tools\livekit\livekit-server.exe"
if (-not (Test-Path $lk)) {
    Write-Host ""
    Write-Host "LiveKit server not found. Download livekit_<version>_windows_amd64.zip from"
    Write-Host "  https://github.com/livekit/livekit/releases  and extract livekit-server.exe to tools\livekit\"
}
Write-Host "Setup complete. See README.md 'Run' section."
