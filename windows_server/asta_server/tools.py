"""Small commands the installer and the settings window run with the server's settings:

    python -m asta_server.tools init           create the data folder and server.env
    python -m asta_server.tools admin          create or reset an admin (ASTA_ADMIN_USER / ASTA_ADMIN_PASSWORD env vars)
"""

import os
import sys

from . import config, paths


def init() -> int:
    values = config.ensure()
    print(f"Settings: {paths.ENV_FILE}")
    print(f"Address:  {config.server_url(values)}")
    return 0


def admin() -> int:
    # Password comes through the environment, never the command line (visible in Task Manager).
    username = os.environ.get("ASTA_ADMIN_USER", "").strip()
    password = os.environ.get("ASTA_ADMIN_PASSWORD", "")
    if len(username) < 3 or len(password) < 8:
        print("Username needs 3+ characters and password 8+ characters.", file=sys.stderr)
        return 2
    os.environ.update(config.read_env())
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    sys.path[:0] = [str(paths.BACKEND_DIR)]
    import django

    django.setup()
    from django.contrib.auth import get_user_model
    from django.contrib.auth.password_validation import ValidationError, validate_password
    from django.core.management import call_command

    call_command("migrate", "--noinput", verbosity=0)
    User = get_user_model()
    user = User.objects.filter(username__iexact=username).first() or User(username=username)
    try:
        validate_password(password, user)
    except ValidationError as e:
        print(" ".join(e.messages), file=sys.stderr)
        return 2
    created = user.pk is None
    user.set_password(password)
    user.is_staff = True
    user.is_active = True
    user.save()
    print(f"Admin '{user.username}' {'created' if created else 'updated'}.")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"init": init, "admin": admin}.get(cmd, lambda: print(__doc__) or 2)())
