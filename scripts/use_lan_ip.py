"""Point the local dev setup at this PC's current Wi-Fi/LAN address so a phone on the same network can connect.

Updates LIVEKIT_URL and DJANGO_ALLOWED_HOSTS in .env, EXPO_PUBLIC_API_URL in mobile/.env, and the LiveKit
--node-ip in .claude/launch.json. Restart LiveKit, the backend and the Expo dev server afterwards.

    .venv\\Scripts\\python scripts\\use_lan_ip.py            # auto-detect
    .venv\\Scripts\\python scripts\\use_lan_ip.py 192.168.1.20
"""

from __future__ import annotations

import re
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_PORT = 8010


def detect_ip() -> str:
    # The OS picks the interface it would use to reach the internet; no packet is actually sent.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]


def sub_line(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    return pattern.sub(f"{key}={value}", text) if pattern.search(text) else text.rstrip("\n") + f"\n{key}={value}\n"


def main() -> int:
    ip = sys.argv[1] if len(sys.argv) > 1 else detect_ip()
    if not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", ip):
        print(f"Not an IPv4 address: {ip}")
        return 1

    env = ROOT / ".env"
    text = env.read_text(encoding="utf-8")
    text = sub_line(text, "LIVEKIT_URL", f"ws://{ip}:7880")
    text = sub_line(text, "DJANGO_ALLOWED_HOSTS", f"localhost,127.0.0.1,{ip}")
    env.write_text(text, encoding="utf-8")

    (ROOT / "mobile" / ".env").write_text(f"EXPO_PUBLIC_API_URL=http://{ip}:{BACKEND_PORT}\n", encoding="utf-8")

    launch = ROOT / ".claude" / "launch.json"
    if launch.exists():
        lt = launch.read_text(encoding="utf-8")
        lt = re.sub(r'"--node-ip", "[\d.]+"', f'"--node-ip", "{ip}"', lt)
        launch.write_text(lt, encoding="utf-8")

    print(f"Using {ip}")
    print(f"  Phone app dev server : http://{ip}:8081")
    print(f"  Backend              : http://{ip}:{BACKEND_PORT}")
    print(f"  LiveKit              : ws://{ip}:7880")
    print("Restart LiveKit (with --node-ip), the backend, the worker and the Expo dev server.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
