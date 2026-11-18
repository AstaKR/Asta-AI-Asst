"""Runs and watches the server processes. Started at Windows start-up by the "ASTA Server" scheduled task:

    pythonw -m asta_server.supervisor

Stops cleanly when stop.flag appears in the data folder (the settings window's Stop button).
"""

import json
import msvcrt
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from . import VERSION, config, paths

CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
MAX_LOG_BYTES = 10 * 1024 * 1024


def components() -> dict[str, dict]:
    py = paths.python_exe()
    return {
        "web": {"cmd": [py, "-m", "asta_server.webapp"], "cwd": paths.APP_DIR, "label": "Website and API"},
        "livekit": {
            "cmd": [str(paths.LIVEKIT_EXE), "--config", str(paths.LIVEKIT_CONFIG)],
            "cwd": paths.DATA_DIR,
            "label": "Call server (LiveKit)",
        },
        "worker": {
            "cmd": [py, "-m", "translation_worker.main", "start"],
            "cwd": paths.APP_DIR if (paths.APP_DIR / "translation_worker").exists() else paths.APP_DIR.parent,
            "label": "Call translator",
        },
        "jobs": {"cmd": [py, "manage.py", "process_meetings"], "cwd": paths.BACKEND_DIR, "label": "Meeting processing"},
    }


def _log(name: str):
    path = paths.LOG_DIR / f"{name}.log"
    if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
        old = path.with_suffix(".log.1")
        old.unlink(missing_ok=True)
        path.rename(old)
    return path.open("ab", buffering=0)


def say(msg: str) -> None:
    with (paths.LOG_DIR / "supervisor.log").open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, creationflags=CREATE_NO_WINDOW)


class Child:
    def __init__(self, name: str, spec: dict, env: dict):
        self.name, self.spec, self.env = name, spec, env
        self.proc: subprocess.Popen | None = None
        self.restarts = 0
        self.started = 0.0
        self.next_start = 0.0
        self.last_exit: int | None = None

    def start(self) -> None:
        log = _log(self.name)
        log.write(f"\n===== {datetime.now():%Y-%m-%d %H:%M:%S} starting {self.name} =====\n".encode())
        try:
            self.proc = subprocess.Popen(
                self.spec["cmd"],
                cwd=self.spec["cwd"],
                env=self.env,
                stdout=log,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP,
            )
        except OSError as e:
            log.write(f"could not start: {e}\n".encode())
            self.proc = None
            self.next_start = time.time() + 30
        finally:
            log.close()
        self.started = time.time()

    def check(self) -> None:
        if self.proc is None:
            if time.time() >= self.next_start:
                self.start()
            return
        code = self.proc.poll()
        if code is None:
            return
        self.last_exit = code
        self.proc = None
        # Quick crash → wait longer before the next try (5 s, 10 s ... up to 5 min).
        ran = time.time() - self.started
        self.restarts = 0 if ran > 300 else self.restarts + 1
        delay = min(300, 5 * 2 ** min(self.restarts, 6))
        self.next_start = time.time() + delay
        say(f"{self.name} exited with code {code} after {ran:.0f}s; restarting in {delay}s")

    def state(self) -> dict:
        running = self.proc is not None and self.proc.poll() is None
        return {
            "label": self.spec["label"],
            "running": running,
            "pid": self.proc.pid if running else None,
            "restarts": self.restarts,
            "last_exit": self.last_exit,
            "up_seconds": int(time.time() - self.started) if running else 0,
        }


def write_status(state: str, children: list[Child], note: str = "") -> None:
    data = {
        "state": state,
        "note": note,
        "version": VERSION,
        "pid": os.getpid(),
        "updated": time.time(),
        "components": {c.name: c.state() for c in children},
    }
    tmp = paths.STATUS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, paths.STATUS_FILE)


def migrate(env: dict) -> tuple[bool, str]:
    r = subprocess.run(
        [paths.python_exe(), "manage.py", "migrate", "--noinput"],
        cwd=paths.BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW,
    )
    with (paths.LOG_DIR / "migrate.log").open("w", encoding="utf-8") as f:
        f.write(r.stdout + r.stderr)
    return r.returncode == 0, (r.stderr or r.stdout)[-400:]


def run() -> int:
    values = config.ensure()
    lock = open(paths.LOCK_FILE, "a+")
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return 0  # already running
    paths.STOP_FLAG.unlink(missing_ok=True)
    env = config.child_env(values)
    say(f"ASTA Server {VERSION} starting (data: {paths.DATA_DIR})")
    children: list[Child] = []
    write_status("starting", children, "Updating the database")
    ok, err = migrate(env)
    if not ok:
        say(f"database update failed: {err}")
        write_status("error", children, "Database update failed. See logs\\migrate.log.")
        return 1
    children = [Child(n, spec, env) for n, spec in components().items()]
    for c in children:
        c.start()
        time.sleep(0.5)
    try:
        while not paths.STOP_FLAG.exists():
            for c in children:
                c.check()
            write_status("running", children)
            time.sleep(2)
    finally:
        say("stopping")
        for c in children:
            if c.proc:
                kill_tree(c.proc)
        write_status("stopped", [])
        paths.STOP_FLAG.unlink(missing_ok=True)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        lock.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as e:  # noqa: BLE001 - last resort: leave a trace for the settings window
        paths.LOG_DIR.mkdir(parents=True, exist_ok=True)
        say(f"supervisor crashed: {e!r}")
        raise
