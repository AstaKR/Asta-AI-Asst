"""One web server for everything: Django (/api, /admin), Django static files (/static) and the React app.

Run by the supervisor:  python -m asta_server.webapp
"""

import mimetypes
import os
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("font/woff2", ".woff2")

DJANGO_PREFIXES = ("/api/", "/api", "/admin/", "/admin")


def _file_response(path: Path, start_response, cache: str):
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype == "application/javascript":
        ctype += "; charset=utf-8"
    size = path.stat().st_size
    start_response(
        "200 OK",
        [
            ("Content-Type", ctype),
            ("Content-Length", str(size)),
            ("Cache-Control", cache),
            ("X-Content-Type-Options", "nosniff"),
            ("Referrer-Policy", "same-origin"),
        ],
    )
    return _read_chunks(path)


def _read_chunks(path: Path):
    with path.open("rb") as f:
        while chunk := f.read(256 * 1024):
            yield chunk


def _safe(root: Path, url_path: str) -> Path | None:
    """Maps a URL path to a file under root; refuses anything that escapes root."""
    rel = url_path.lstrip("/")
    if not rel:
        return None
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def make_app():
    from django.conf import settings
    from django.core.wsgi import get_wsgi_application

    django_app = get_wsgi_application()
    static_root = Path(settings.STATIC_ROOT).resolve()
    web_root = Path(os.environ.get("ASTA_WEB_DIR", "web")).resolve()
    index = web_root / "index.html"

    def app(environ, start_response):
        path = environ.get("PATH_INFO", "/")
        if path.startswith(DJANGO_PREFIXES):
            return django_app(environ, start_response)
        if environ.get("REQUEST_METHOD", "GET") not in ("GET", "HEAD"):
            return django_app(environ, start_response)
        if path.startswith("/static/"):
            f = _safe(static_root, path[len("/static/") :])
            if f:
                return _file_response(f, start_response, "public, max-age=86400")
            return django_app(environ, start_response)
        f = _safe(web_root, path)
        if f:
            # Vite puts content hashes in /assets/ file names, so they never change.
            cache = "public, max-age=31536000, immutable" if path.startswith("/assets/") else "no-cache"
            return _file_response(f, start_response, cache)
        if index.exists():
            return _file_response(index, start_response, "no-cache")  # single-page app routes
        return django_app(environ, start_response)

    return app


def main():
    from waitress import serve

    port = int(os.environ.get("ASTA_WEB_PORT", "8000"))
    serve(
        make_app(),
        host="0.0.0.0",
        port=port,
        threads=12,
        channel_timeout=900,  # long uploads and slow AI answers
        max_request_body_size=260 * 1024 * 1024,
        ident="ASTA Server",
    )


if __name__ == "__main__":
    main()
