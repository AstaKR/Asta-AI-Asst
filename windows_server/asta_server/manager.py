"""ASTA Server settings window:  pythonw -m asta_server.manager

Shows whether the server is running, the address phones and browsers use (with a QR code), the AI keys,
the administrator account and "start with Windows". Runs as administrator (the settings hold API keys and
only Administrators can read them).
"""

import base64
import ctypes
import io
import json
import os
import subprocess
import sys
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import messagebox, ttk

from . import VERSION, config, paths

CREATE_NO_WINDOW = 0x08000000
DETACHED = 0x00000008 | 0x00000200 | CREATE_NO_WINDOW

KEY_FIELDS = [
    ("SARVAM_API_KEY", "Sarvam AI", "calls, translation, voices"),
    ("GEMINI_API_KEY", "Google Gemini", "meetings: transcripts, notes, recall"),
    ("ANTHROPIC_API_KEY", "Anthropic Claude", "assistant chat, photo translate"),
]


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except OSError:
        return False


def relaunch_as_admin() -> None:
    args = " ".join(f'"{a}"' for a in ["-m", "asta_server.manager", *sys.argv[1:]])
    ctypes.windll.shell32.ShellExecuteW(None, "runas", paths.python_exe(windowless=True), args, str(paths.APP_DIR), 1)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, **kw)


# ---------- server control ----------


def read_status() -> dict:
    try:
        data = json.loads(paths.STATUS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"state": "stopped", "components": {}}
    if data.get("state") in ("running", "starting") and time.time() - data.get("updated", 0) > 15:
        data["state"] = "stopped"  # supervisor gone without saying so (PC crash, killed)
        data["components"] = {}
    return data


def task_state() -> str | None:
    """'Ready', 'Running', 'Disabled' or None when the scheduled task does not exist (not installed)."""
    r = run(["schtasks", "/Query", "/TN", paths.TASK_NAME, "/FO", "CSV", "/NH"])
    if r.returncode != 0:
        return None
    parts = [p.strip('"') for p in r.stdout.strip().split('","')]
    return parts[-1].strip('"') if parts else None


def start_server() -> None:
    paths.STOP_FLAG.unlink(missing_ok=True)
    if task_state() is not None and run(["schtasks", "/Run", "/TN", paths.TASK_NAME]).returncode == 0:
        return
    subprocess.Popen(
        [paths.python_exe(windowless=True), "-m", "asta_server.supervisor"],
        cwd=paths.APP_DIR,
        env=config.child_env(config.read_env()),
        creationflags=DETACHED,
        close_fds=True,
    )


def stop_server(wait: float = 25) -> bool:
    paths.STOP_FLAG.parent.mkdir(parents=True, exist_ok=True)
    paths.STOP_FLAG.touch()
    end = time.time() + wait
    while time.time() < end:
        if read_status().get("state") == "stopped":
            return True
        time.sleep(0.5)
    return False


def network_is_public() -> bool:
    r = run(["powershell", "-NoProfile", "-Command", "(Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory) -join ','"])
    return "Public" in r.stdout


# ---------- window ----------


class Manager(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"Asta Talk Server {VERSION}")
        self.minsize(720, 640)
        try:
            ttk.Style(self).theme_use("vista")
        except tk.TclError:
            pass
        self.values = config.ensure()
        self.busy = False
        self.qr_image: tk.PhotoImage | None = None
        self._build()
        self._load()
        self.after(200, self._refresh)
        threading.Thread(target=self._check_network, daemon=True).start()

    # layout
    def _build(self):
        root = ttk.Frame(self, padding=14)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.columnconfigure(1, weight=1)

        # status
        st = ttk.LabelFrame(root, text="Server", padding=10)
        st.grid(row=0, column=0, columnspan=2, sticky="ew")
        st.columnconfigure(1, weight=1)
        self.state_lbl = tk.Label(st, text="…", font=("Segoe UI", 14, "bold"))
        self.state_lbl.grid(row=0, column=0, sticky="w")
        self.parts_lbl = ttk.Label(st, text="", justify="left")
        self.parts_lbl.grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, 6))
        btns = ttk.Frame(st)
        btns.grid(row=0, column=1, sticky="e")
        self.start_btn = ttk.Button(btns, text="Start", command=lambda: self._bg(self._start))
        self.stop_btn = ttk.Button(btns, text="Stop", command=lambda: self._bg(self._stop))
        self.restart_btn = ttk.Button(btns, text="Restart", command=lambda: self._bg(self._restart))
        for b in (self.start_btn, self.stop_btn, self.restart_btn):
            b.pack(side="left", padx=3)
        links = ttk.Frame(st)
        links.grid(row=2, column=0, columnspan=2, sticky="w")
        ttk.Button(links, text="Open web app", command=lambda: webbrowser.open(f"http://localhost:{self.port.get()}")).pack(side="left", padx=(0, 6))
        ttk.Button(links, text="Open logs folder", command=lambda: os.startfile(paths.LOG_DIR)).pack(side="left", padx=6)
        self.autostart = tk.BooleanVar()
        self.autostart_chk = ttk.Checkbutton(links, text="Start automatically with Windows", variable=self.autostart, command=self._toggle_autostart)
        self.autostart_chk.pack(side="left", padx=12)

        # address
        ad = ttk.LabelFrame(root, text="Connect phones and computers", padding=10)
        ad.grid(row=1, column=0, sticky="nsew", pady=(10, 0), padx=(0, 6))
        ad.columnconfigure(1, weight=1)
        ttk.Label(ad, text="Address").grid(row=0, column=0, sticky="w")
        self.host = ttk.Combobox(ad, values=["Automatic"] + config.lan_addresses())
        self.host.grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Label(ad, text="Port").grid(row=1, column=0, sticky="w", pady=(6, 0))
        self.port = ttk.Entry(ad, width=8)
        self.port.grid(row=1, column=1, sticky="w", padx=6, pady=(6, 0))
        for w in (self.host, self.port):
            w.bind("<KeyRelease>", lambda e: self._show_url())
        self.host.bind("<<ComboboxSelected>>", lambda e: self._show_url())
        self.url_lbl = tk.Label(ad, text="", font=("Segoe UI", 12, "bold"), fg="#1a56db", cursor="hand2")
        self.url_lbl.grid(row=2, column=0, columnspan=2, sticky="w", pady=(10, 2))
        self.url_lbl.bind("<Button-1>", lambda e: self._copy_url())
        ttk.Label(ad, text="Click the address to copy it. In the phone app: Sign in → Server → Change.", wraplength=330, foreground="#555").grid(
            row=3, column=0, columnspan=2, sticky="w"
        )
        self.qr = ttk.Label(ad)
        self.qr.grid(row=4, column=0, columnspan=2, pady=8)
        self.net_lbl = ttk.Label(ad, text="", foreground="#b42318", wraplength=330)
        self.net_lbl.grid(row=5, column=0, columnspan=2, sticky="w")

        # keys + admin
        right = ttk.Frame(root)
        right.grid(row=1, column=1, sticky="nsew", pady=(10, 0), padx=(6, 0))
        right.columnconfigure(0, weight=1)
        ks = ttk.LabelFrame(right, text="AI service keys", padding=10)
        ks.grid(row=0, column=0, sticky="ew")
        ks.columnconfigure(0, weight=1)
        self.key_entries: dict[str, ttk.Entry] = {}
        for i, (key, name, use) in enumerate(KEY_FIELDS):
            ttk.Label(ks, text=f"{name}  ({use})").grid(row=i * 2, column=0, sticky="w", pady=(6 if i else 0, 0))
            e = ttk.Entry(ks, show="•")
            e.grid(row=i * 2 + 1, column=0, sticky="ew")
            self.key_entries[key] = e
        self.show_keys = tk.BooleanVar()
        ttk.Checkbutton(
            ks, text="Show keys", variable=self.show_keys, command=lambda: [e.configure(show="" if self.show_keys.get() else "•") for e in self.key_entries.values()]
        ).grid(row=9, column=0, sticky="w", pady=(6, 0))
        ttk.Label(ks, text="Keys can also be set on the web app: Admin → API keys.", foreground="#555").grid(row=10, column=0, sticky="w")

        am = ttk.LabelFrame(right, text="Administrator account (web app and phone)", padding=10)
        am.grid(row=1, column=0, sticky="ew", pady=(10, 0))
        am.columnconfigure(1, weight=1)
        ttk.Label(am, text="Username").grid(row=0, column=0, sticky="w")
        self.admin_user = ttk.Entry(am)
        self.admin_user.grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Label(am, text="Password").grid(row=1, column=0, sticky="w", pady=(6, 0))
        self.admin_pw = ttk.Entry(am, show="•")
        self.admin_pw.grid(row=1, column=1, sticky="ew", padx=6, pady=(6, 0))
        ttk.Button(am, text="Create / reset admin", command=lambda: self._bg(self._admin)).grid(row=2, column=1, sticky="e", padx=6, pady=(8, 0))

        # footer
        foot = ttk.Frame(root)
        foot.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        self.msg = ttk.Label(foot, text="")
        self.msg.pack(side="left")
        ttk.Button(foot, text="Save and restart server", command=lambda: self._bg(self._save)).pack(side="right")
        root.rowconfigure(1, weight=1)

    def _load(self):
        v = self.values
        self.host.set(v.get("ASTA_PUBLIC_HOST") or "Automatic")
        self.port.delete(0, "end")
        self.port.insert(0, v.get("ASTA_WEB_PORT", "8000"))
        for key, e in self.key_entries.items():
            e.delete(0, "end")
            e.insert(0, v.get(key, ""))
        self._show_url()
        state = task_state()
        self.autostart.set(state not in (None, "Disabled"))
        if state is None:
            self.autostart_chk.state(["disabled"])

    # helpers
    def _form(self) -> dict[str, str] | None:
        host = self.host.get().strip()
        port = self.port.get().strip()
        if not port.isdigit() or not 1 <= int(port) <= 65535:
            messagebox.showerror("Asta Talk Server", "Port must be a number between 1 and 65535.")
            return None
        changes = {"ASTA_PUBLIC_HOST": "" if host.lower() in ("", "automatic") else host.rstrip("/"), "ASTA_WEB_PORT": port}
        changes.update({k: e.get().strip() for k, e in self.key_entries.items()})
        return changes

    def _show_url(self):
        host = self.host.get().strip()
        port = self.port.get().strip() or "8000"
        url = config.server_url({"ASTA_PUBLIC_HOST": "" if host.lower() in ("", "automatic") else host, "ASTA_WEB_PORT": port})
        self.url_lbl.configure(text=url)
        try:
            import segno

            buf = io.BytesIO()
            segno.make(url, error="m").save(buf, kind="png", scale=5, border=2)
            self.qr_image = tk.PhotoImage(data=base64.b64encode(buf.getvalue()).decode())
            self.qr.configure(image=self.qr_image)
        except Exception:  # noqa: BLE001 - QR is a convenience
            self.qr.configure(image="")

    def _copy_url(self):
        self.clipboard_clear()
        self.clipboard_append(self.url_lbl.cget("text"))
        self._say("Address copied.")

    def _say(self, text: str):
        self.after(0, lambda: self.msg.configure(text=text))

    def _bg(self, fn):
        if self.busy:
            return
        self.busy = True

        def work():
            try:
                fn()
            finally:
                self.busy = False

        threading.Thread(target=work, daemon=True).start()

    def _check_network(self):
        if network_is_public():
            self.after(
                0,
                lambda: self.net_lbl.configure(
                    text="This PC's network is set to Public, so Windows blocks phones from connecting. "
                    "Open Windows Settings → Network & internet → your network and choose Private."
                ),
            )

    # actions
    def _start(self):
        self._say("Starting…")
        start_server()

    def _stop(self):
        self._say("Stopping…")
        self._say("Stopped." if stop_server() else "The server did not stop in time. Try again.")

    def _restart(self):
        self._say("Restarting…")
        stop_server()
        start_server()

    def _save(self):
        changes = self.after_idle_result(self._form)
        if changes is None:
            return
        self.values = config.save(changes)
        self._say("Saved. Restarting the server…")
        if read_status().get("state") != "stopped":
            stop_server()
        start_server()
        self._say("Saved. The server is restarting with the new settings.")

    def _admin(self):
        user, pw = self.admin_user.get().strip(), self.admin_pw.get()
        env = config.child_env(config.read_env())
        env.update({"ASTA_ADMIN_USER": user, "ASTA_ADMIN_PASSWORD": pw})
        self._say("Saving admin account…")
        r = run([paths.python_exe(), "-m", "asta_server.tools", "admin"], cwd=paths.APP_DIR, env=env)
        text = (r.stdout or r.stderr).strip().splitlines()[-1:] or ["Done."]
        if r.returncode == 0:
            self.after(0, lambda: self.admin_pw.delete(0, "end"))
            self._say(text[0])
        else:
            self.after(0, lambda: messagebox.showerror("Administrator account", text[0]))
            self._say("")

    def _toggle_autostart(self):
        flag = "/ENABLE" if self.autostart.get() else "/DISABLE"
        if run(["schtasks", "/Change", "/TN", paths.TASK_NAME, flag]).returncode != 0:
            messagebox.showerror("Asta Talk Server", "Could not change the start-up setting.")

    def after_idle_result(self, fn):
        """Runs fn on the Tk thread (widgets must only be read there) and returns its result."""
        box: dict = {}
        done = threading.Event()

        def call():
            box["r"] = fn()
            done.set()

        self.after(0, call)
        done.wait()
        return box["r"]

    def _refresh(self):
        s = read_status()
        state = s.get("state", "stopped")
        comps = s.get("components", {})
        all_up = comps and all(c.get("running") for c in comps.values())
        if state == "running" and all_up:
            self.state_lbl.configure(text="● Running", fg="#067647")
        elif state in ("running", "starting"):
            self.state_lbl.configure(text="● Starting / partly running", fg="#b54708")
        elif state == "error":
            self.state_lbl.configure(text="● Error", fg="#b42318")
        else:
            self.state_lbl.configure(text="● Stopped", fg="#667085")
        lines = []
        for c in comps.values():
            mark = "✔" if c.get("running") else "✖"
            extra = f"  (restarted {c['restarts']}×, see logs)" if c.get("restarts") else ""
            lines.append(f"{mark} {c.get('label')}{extra}")
        if s.get("note"):
            lines.append(s["note"])
        self.parts_lbl.configure(text="\n".join(lines) or "Not running.")
        running = state in ("running", "starting")
        self.start_btn.state(["disabled"] if running or self.busy else ["!disabled"])
        self.stop_btn.state(["!disabled"] if running and not self.busy else ["disabled"])
        self.restart_btn.state(["!disabled"] if running and not self.busy else ["disabled"])
        self.after(1500, self._refresh)


def main():
    if not is_admin() and "--no-elevate" not in sys.argv:
        relaunch_as_admin()
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (OSError, AttributeError):
        pass
    Manager().mainloop()


if __name__ == "__main__":
    main()
