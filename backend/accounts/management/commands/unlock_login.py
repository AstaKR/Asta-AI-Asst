"""Clear sign-in lockouts.

    python manage.py unlock_login --username asha
    python manage.py unlock_login --all
"""

from django.core.management.base import BaseCommand, CommandError

from accounts.models import LoginAttempt


class Command(BaseCommand):
    help = "Remove the failed-sign-in counters for one account, or for everyone."

    def add_arguments(self, parser):
        parser.add_argument("--username")
        parser.add_argument("--all", action="store_true")

    def handle(self, *args, username=None, all=False, **opts):
        if not username and not all:
            raise CommandError("Give --username NAME or --all.")
        rows = LoginAttempt.objects.all() if all else LoginAttempt.objects.filter(key=f"user:{username.strip().lower()}")
        n, _ = rows.delete()
        self.stdout.write(self.style.SUCCESS(f"Cleared {n} counter(s)."))
