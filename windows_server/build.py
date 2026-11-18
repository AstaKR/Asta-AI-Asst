"""Builds the Windows server installer:  windows_server\\dist\\ASTA-Server-Setup-<version>.exe

    .venv\\Scripts\\python.exe windows_server\\build.py

Steps: build the web app → copy a clean Python and install only the server's packages → copy backend, worker,
this package and LiveKit → collect Django static files → zip → compile Setup.exe (installer\\Setup.cs, with the
C# compiler built into Windows) and append the zip to it. Needs internet for pip and npm the first time.

    --package-only   reuse build\\stage and only redo the zip and Setup.exe
"""

import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
from asta_server import VERSION  # noqa: E402

BUILD = HERE / "build"
STAGE = BUILD / "stage"
DIST = HERE / "dist"
SKIP_DIRS = {"__pycache__", "tests", "media_private", "staticfiles", ".pytest_cache", "node_modules"}
SKIP_FILES = {"db.sqlite3", ".env"}
EXTRA_PACKAGES = ["waitress>=3", "segno>=1.6"]


def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def sh(cmd: list[str], **kw) -> None:
    print("   ", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def copytree(src: Path, dst: Path) -> None:
    def ignore(d, names):
        return [n for n in names if n in SKIP_DIRS or n in SKIP_FILES or n.endswith((".pyc", ".log", ".sqlite3"))]

    shutil.copytree(src, dst, ignore=ignore, dirs_exist_ok=True)


def base_python() -> Path:
    # The venv's base interpreter: a full CPython install (with Tk for the settings window).
    return Path(sys.base_prefix)


def build_web() -> None:
    step("Building the web app")
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    sh([npm, "run", "build"], cwd=REPO / "frontend", shell=False)
    subprocess.run(["git", "checkout", "frontend/tsconfig.tsbuildinfo"], cwd=REPO, capture_output=True)
    shutil.copytree(REPO / "frontend" / "dist", STAGE / "web")


def build_runtime() -> None:
    step(f"Copying Python {sys.version.split()[0]}")
    src = base_python()
    rt = STAGE / "runtime"
    skip_top = {"Doc", "include", "libs", "Scripts", "__install__.json", "Tools"}
    skip_lib = {"test", "idlelib", "site-packages", "ensurepip", "turtledemo", "__pycache__", "lib2to3", "venv"}
    for item in src.iterdir():
        if item.name in skip_top:
            continue
        if item.name == "Lib":
            (rt / "Lib").mkdir(parents=True, exist_ok=True)
            for sub in item.iterdir():
                if sub.name in skip_lib:
                    continue
                if sub.is_dir():
                    shutil.copytree(sub, rt / "Lib" / sub.name, ignore=shutil.ignore_patterns("__pycache__", "test", "tests"))
                else:
                    shutil.copy2(sub, rt / "Lib" / sub.name)
        elif item.is_dir():
            shutil.copytree(item, rt / item.name, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            rt.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, rt / item.name)

    step("Installing the server's Python packages")
    reqs = []
    for f in (REPO / "backend" / "requirements.txt", REPO / "translation_worker" / "requirements.txt"):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if line and not line.lower().startswith("pytest"):
                reqs.append(line)
    req_file = BUILD / "requirements.txt"
    req_file.write_text("\n".join(sorted(set(reqs)) + EXTRA_PACKAGES) + "\n", encoding="utf-8")
    site = rt / "Lib" / "site-packages"
    sh([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location", "--only-binary=:all:", "--target", str(site), "-r", str(req_file)])
    shutil.rmtree(site / "bin", ignore_errors=True)
    for p in site.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)


def build_app() -> None:
    step("Copying the server code")
    app = STAGE / "app"
    copytree(REPO / "backend", app / "backend")
    copytree(REPO / "translation_worker", app / "translation_worker")
    copytree(HERE / "asta_server", app / "asta_server")
    (STAGE / "livekit").mkdir()
    shutil.copy2(REPO / "tools" / "livekit" / "livekit-server.exe", STAGE / "livekit")
    lic = REPO / "tools" / "livekit" / "LICENSE"
    if lic.exists():
        shutil.copy2(lic, STAGE / "livekit" / "LICENSE.txt")
    for f in ("install.ps1", "uninstall.ps1"):
        shutil.copy2(HERE / "installer" / f, STAGE / f)
    (STAGE / "VERSION.txt").write_text(VERSION + "\n", encoding="ascii")
    make_icon(STAGE / "asta.ico")

    step("Collecting Django static files")
    env = dict(os.environ, DJANGO_DEBUG="true", PYTHONPATH="", DATABASE_URL="sqlite:///:memory:")
    sh([str(STAGE / "runtime" / "python.exe"), "manage.py", "collectstatic", "--noinput", "-v0"], cwd=app / "backend", env=env)

    step("Checking the bundled Python can load everything")
    check = (
        "import django, rest_framework, livekit.api, livekit.agents, av, numpy, httpx, anthropic, cryptography, docx, waitress, segno, tkinter;"
        "print('imports ok')"
    )
    sh([str(STAGE / "runtime" / "python.exe"), "-I", "-c", check])


def make_icon(dest: Path) -> None:
    """256 px PNG wrapped in an .ico (Windows Vista+ reads PNG icons)."""
    import tkinter as tk

    src = REPO / "mobile" / "assets" / "icon.png"
    root = tk.Tk()
    root.withdraw()
    img = tk.PhotoImage(file=str(src))
    factor = max(1, img.width() // 256)
    small = img.subsample(factor, factor) if factor > 1 else img
    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "i.png"
        small.write(str(png), format="png")
        data = png.read_bytes()
    w = small.width() if small.width() < 256 else 0
    h = small.height() if small.height() < 256 else 0
    root.destroy()
    header = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), 22)
    dest.write_bytes(header + data)


def package() -> Path:
    # install.ps1 may have changed since the stage was made (--package-only)
    shutil.copy2(HERE / "installer" / "install.ps1", STAGE / "install.ps1")
    shutil.copy2(HERE / "installer" / "uninstall.ps1", STAGE / "uninstall.ps1")
    step("Compressing")
    payload = BUILD / "payload.zip"
    payload.unlink(missing_ok=True)
    sh(["tar", "-a", "-c", "-f", str(payload), "-C", str(STAGE), "."])
    print(f"    payload {payload.stat().st_size / 1e6:.0f} MB")

    step("Compiling Setup.exe")
    csc = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"
    if not csc.exists():
        raise SystemExit(f"C# compiler not found: {csc}")
    source = (HERE / "installer" / "Setup.cs").read_text(encoding="utf-8").replace('Version = "1.0.0"', f'Version = "{VERSION}"')
    cs = BUILD / "Setup.cs"
    cs.write_text(source, encoding="utf-8")
    stub = BUILD / "SetupStub.exe"
    sh([str(csc), "/nologo", "/target:winexe", "/optimize+", "/platform:anycpu", f"/out:{stub}",
        f"/win32icon:{STAGE / 'asta.ico'}", f"/win32manifest:{HERE / 'installer' / 'setup.manifest'}",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", str(cs)])

    step("Attaching the files to Setup.exe")
    DIST.mkdir(exist_ok=True)
    target = DIST / f"ASTA-Server-Setup-{VERSION}.exe"
    ps1 = (HERE / "installer" / "install.ps1").read_bytes()
    with target.open("wb") as out:
        out.write(stub.read_bytes())
        with payload.open("rb") as z:
            shutil.copyfileobj(z, out, 4 * 1024 * 1024)
        out.write(ps1)
        out.write(struct.pack("<qq", payload.stat().st_size, len(ps1)) + b"ASTASETP")
    print(f"\nDone: {target}  ({target.stat().st_size / 1e6:.0f} MB)")
    return target


def main() -> None:
    if os.name != "nt":
        raise SystemExit("Build on Windows.")
    if "--package-only" in sys.argv and STAGE.exists():
        package()
        return
    shutil.rmtree(BUILD, ignore_errors=True)
    STAGE.mkdir(parents=True)
    build_web()
    build_runtime()
    build_app()
    package()


if __name__ == "__main__":
    main()
