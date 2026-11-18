# ASTA Server for Windows

One installer that runs the whole translator server on an office PC: website and API, LiveKit call server,
call translator and meeting processing. Phones connect with the APK's **Server settings** screen.

## Build

```
.venv\Scripts\python.exe windows_server\build.py                  # full build (web app, Python, packages)
.venv\Scripts\python.exe windows_server\build.py --package-only   # only redo the zip + Setup.exe
```

Output: `windows_server\dist\ASTA-Server-Setup-<version>.exe` (about 245 MB). Version: `asta_server/__init__.py`.
Needs Node (web app), internet for pip the first time, and `tools\livekit\livekit-server.exe`. Setup.exe is
compiled from `installer\Setup.cs` with the C# compiler that ships with Windows; the files are appended to it.

## What the installer does

| | |
|---|---|
| Program | `C:\Program Files\ASTA Server` — bundled Python (`runtime\`), code (`app\`), web app (`web\`), `livekit\` |
| Data | `C:\ProgramData\ASTAServer` (Administrators + SYSTEM only): `server.env`, `livekit.yaml`, `db.sqlite3`, `media\`, `logs\` |
| Start-up | Scheduled task **ASTA Server** (SYSTEM, at start-up) runs `asta_server.supervisor`, which starts and restarts the four processes |
| Firewall | Inbound rules for the bundled `python.exe` and `livekit-server.exe`, Private and Domain networks only |
| Shortcuts | Start Menu + desktop **ASTA Server** → the settings window (`asta_server.manager`) |
| Uninstall | Settings → Apps → ASTA Server (asks whether to keep the data) |

Upgrading: run the new Setup.exe; the data folder is kept.

## Ports

| Port | Use |
|---|---|
| 8000/TCP (changeable) | website, API, phone app |
| 7880/TCP | LiveKit signalling (calls) |
| 7881/TCP, 50000–50100/UDP | LiveKit media |

## Limits

- Browsers allow the microphone only on `https://` or `localhost`: other PCs' browsers can sign in and use text
  features over `http://192.168.x.x`, but browser calls need the server PC itself or HTTPS. The APK works over http.
- SQLite database: fine for one office.
- AI services (Sarvam, Gemini, Claude) still need internet and API keys (settings window or web Admin → API keys).
