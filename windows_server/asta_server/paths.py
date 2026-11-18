"""Where things live.

Installed layout (C:\\Program Files\\ASTA Server):
    runtime\\python.exe        bundled Python with all packages
    app\\asta_server\\          this package
    app\\backend\\              Django project (staticfiles\\ collected at build time)
    app\\translation_worker\\   LiveKit call translator
    web\\                      built React web app
    livekit\\livekit-server.exe

Data (C:\\ProgramData\\ASTAServer, Administrators and SYSTEM only):
    server.env, livekit.yaml, db.sqlite3, media\\, logs\\, status.json
"""

import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent  # ...\app
INSTALL_DIR = APP_DIR.parent
BACKEND_DIR = APP_DIR / "backend"
WEB_DIR = INSTALL_DIR / "web"
LIVEKIT_EXE = INSTALL_DIR / "livekit" / "livekit-server.exe"
RUNTIME_DIR = INSTALL_DIR / "runtime"

# Development checkout: windows_server\asta_server → use the repo's folders.
if not BACKEND_DIR.exists() and (APP_DIR.parent / "backend").exists():
    REPO = APP_DIR.parent
    BACKEND_DIR = REPO / "backend"
    WEB_DIR = REPO / "frontend" / "dist"
    LIVEKIT_EXE = REPO / "tools" / "livekit" / "livekit-server.exe"

DATA_DIR = Path(os.environ.get("ASTA_DATA_DIR") or Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "ASTAServer")
ENV_FILE = DATA_DIR / "server.env"
LIVEKIT_CONFIG = DATA_DIR / "livekit.yaml"
LOG_DIR = DATA_DIR / "logs"
MEDIA_DIR = DATA_DIR / "media"
DB_FILE = DATA_DIR / "db.sqlite3"
STATUS_FILE = DATA_DIR / "status.json"
STOP_FLAG = DATA_DIR / "stop.flag"
LOCK_FILE = DATA_DIR / "supervisor.lock"

TASK_NAME = "ASTA Server"


def python_exe(windowless: bool = False) -> str:
    """The bundled python(w).exe, or the one running now in a development checkout."""
    name = "pythonw.exe" if windowless else "python.exe"
    bundled = RUNTIME_DIR / name
    if bundled.exists():
        return str(bundled)
    return str(Path(sys.executable).with_name(name))
