# Starts the local development servers in their own windows so they keep running:
#   backend  http://127.0.0.1:8010   (the website's proxy points here: BACKEND_INTERNAL_URL in .env)
#   website  http://localhost:5173
# Run from the repo root:  .\scripts\dev.ps1      Stop them by closing their windows.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$py = Join-Path $repo ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "Missing .venv. Create it first (see README)." }

function Up($port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }

Write-Host "Updating the local database (migrate)..."
& $py (Join-Path $repo "backend\manage.py") migrate --noinput | Out-Null

if (Up 8010) { Write-Host "Backend already running on 8010." }
else {
    Start-Process powershell -WorkingDirectory $repo -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='Asta backend :8010'; & '$py' backend\manage.py runserver 0.0.0.0:8010"
    Write-Host "Started the backend on 8010."
}
if (Up 5173) { Write-Host "Website already running on 5173." }
else {
    Start-Process powershell -WorkingDirectory (Join-Path $repo "frontend") -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='Asta website :5173'; npm run dev"
    Write-Host "Started the website on 5173."
}
Write-Host "Open http://localhost:5173"
