"""server.env: reading, writing and first-time creation (secrets, LiveKit keys, defaults for an office server)."""

import base64
import os
import secrets
import socket
from pathlib import Path

from . import paths

WEB_PORT_DEFAULT = 8000
LIVEKIT_PORT = 7880
LIVEKIT_TCP_PORT = 7881
LIVEKIT_UDP_RANGE = (50000, 50100)


def read_env(path: Path = paths.ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env(values: dict[str, str], path: Path = paths.ENV_FILE) -> None:
    """Rewrites server.env, keeping comments and order; new keys go at the end."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    seen = set()
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
        if key and key in values:
            out.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in values.items() if k not in seen]
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def lan_addresses() -> list[str]:
    """This PC's IPv4 addresses on the local network, the one with the internet route first."""
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent; picks the outgoing interface
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in found:
                found.append(ip)
    except OSError:
        pass
    return [ip for ip in found if not ip.startswith(("127.", "169.254."))] or ["127.0.0.1"]


def server_url(values: dict[str, str]) -> str:
    host = values.get("ASTA_PUBLIC_HOST") or lan_addresses()[0]
    port = values.get("ASTA_WEB_PORT", str(WEB_PORT_DEFAULT))
    if host.startswith(("http://", "https://")):
        return host.rstrip("/")
    return f"http://{host}" + ("" if port == "80" else f":{port}")


def derived(values: dict[str, str]) -> dict[str, str]:
    """Settings that follow from the address and port chosen in the settings window."""
    port = values.get("ASTA_WEB_PORT", str(WEB_PORT_DEFAULT))
    host = values.get("ASTA_PUBLIC_HOST") or lan_addresses()[0]
    lk_host = host.split("://")[-1].split("/")[0].split(":")[0]
    secure = host.startswith("https://")
    return {
        "BACKEND_INTERNAL_URL": f"http://127.0.0.1:{port}",
        # Phones and browsers get this in their call token; the worker uses localhost.
        "LIVEKIT_URL": f"{'wss' if secure else 'ws'}://{lk_host}:{LIVEKIT_PORT}",
        "LIVEKIT_WORKER_URL": f"ws://127.0.0.1:{LIVEKIT_PORT}",
        "CSRF_TRUSTED_ORIGINS": f"{server_url(values)},http://localhost:{port},http://127.0.0.1:{port}",
        "CORS_ALLOWED_ORIGINS": f"http://localhost:{port}",
        "HTTPS_ONLY": "true" if secure else "false",
    }


def _fernet_key() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


def defaults() -> dict[str, str]:
    data = paths.DATA_DIR.as_posix()
    return {
        "ASTA_WEB_PORT": str(WEB_PORT_DEFAULT),
        "ASTA_PUBLIC_HOST": "",
        "DJANGO_DEBUG": "false",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(50),
        # Any address: the server is reached by IP and the IP can change (DHCP). Same-origin
        # requests still pass Django's CSRF origin check.
        "DJANGO_ALLOWED_HOSTS": "*",
        "SECURE_SSL_REDIRECT": "false",
        "DATABASE_URL": f"sqlite:///{data}/db.sqlite3",
        "MEDIA_ROOT": f"{data}/media",
        "SECRETS_ENCRYPTION_KEY": _fernet_key(),
        "LIVEKIT_API_KEY": "asta" + secrets.token_hex(6),
        "LIVEKIT_API_SECRET": secrets.token_urlsafe(36),
        "LIVEKIT_TOKEN_TTL_SECONDS": "600",
        "AGENT_NAME": "call-translator",
        "WORKER_SHARED_SECRET": secrets.token_urlsafe(36),
        "AI_ENGINE": "sarvam",
        "SPEECH_PROVIDER": "sarvam",
        "TRANSLATION_ENABLED": "true",
        "SARVAM_API_KEY": "",
        "GEMINI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
        "MEETING_STT_ENGINE": "gemini",
        "MEETING_GEMINI_MODEL": "gemini-2.5-flash",
        "SUMMARY_PROVIDER": "gemini",
        "SUMMARY_MODEL": "gemini-2.5-flash",
        "ASSISTANT_PROVIDER": "anthropic",
        "SMS_BACKEND": "disabled",
        "TELEPHONY_ENABLED": "false",
        "VIDEO_CALLS_ENABLED": "true",
        "CALL_RECORDING_ENABLED": "true",
        "PLANS_ENFORCED": "true",
    }


def livekit_yaml(values: dict[str, str]) -> str:
    lo, hi = LIVEKIT_UDP_RANGE
    return (
        "# Written by ASTA Server. Keys come from server.env.\n"
        f"port: {LIVEKIT_PORT}\n"
        "bind_addresses:\n  - 0.0.0.0\n"
        "rtc:\n"
        f"  tcp_port: {LIVEKIT_TCP_PORT}\n"
        f"  port_range_start: {lo}\n"
        f"  port_range_end: {hi}\n"
        "  use_external_ip: false\n"
        "keys:\n"
        f"  {values['LIVEKIT_API_KEY']}: {values['LIVEKIT_API_SECRET']}\n"
        "logging:\n  level: info\n"
    )


def ensure() -> dict[str, str]:
    """Creates the data folder and server.env on first run; fills in any missing settings. Returns the settings."""
    for d in (paths.DATA_DIR, paths.LOG_DIR, paths.MEDIA_DIR):
        d.mkdir(parents=True, exist_ok=True)
    values = read_env()
    first = not values
    missing = {k: v for k, v in defaults().items() if k not in values}
    values.update(missing)
    values.update(derived(values))
    if first:
        header = "# ASTA Server settings. Edit with the ASTA Server window; restart the server after changes.\n"
        paths.ENV_FILE.write_text(header, encoding="utf-8")
    write_env(values)
    paths.LIVEKIT_CONFIG.write_text(livekit_yaml(values), encoding="utf-8")
    return values


def save(changes: dict[str, str]) -> dict[str, str]:
    values = ensure()
    values.update(changes)
    values.update(derived(values))
    write_env(values)
    paths.LIVEKIT_CONFIG.write_text(livekit_yaml(values), encoding="utf-8")
    return values


def child_env(values: dict[str, str] | None = None) -> dict[str, str]:
    """Environment for the server processes: Windows env + server.env + import paths."""
    env = dict(os.environ)
    env.update(values or read_env())
    env["PYTHONPATH"] = os.pathsep.join([str(paths.APP_DIR), str(paths.BACKEND_DIR), str(paths.APP_DIR.parent)])
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["ASTA_WEB_DIR"] = str(paths.WEB_DIR)
    return env
