"""Make an existing user an administrator (web admin pages: API keys, dashboard, users, plans).

    python backend/manage.py grant_admin --phone +919876543210
    python backend/manage.py grant_admin --username asha --revoke
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from accounts.models import PhoneNumber


class Command(BaseCommand):
    help = "Grant (or revoke) admin access for a user who has already signed in once."

    def add_arguments(self, parser):
        who = parser.add_mutually_exclusive_group(required=True)
        who.add_argument("--phone")
        who.add_argument("--username")
        parser.add_argument("--revoke", action="store_true")

    def handle(self, *args, phone=None, username=None, revoke=False, **opts):
        if phone:
            row = PhoneNumber.objects.select_related("user").filter(number=phone.replace(" ", "")).first()
            if not row:
                raise CommandError("No user with that phone number. Sign in once in the app first.")
            user = row.user
        else:
            user = get_user_model().objects.filter(username=username).first()
            if not user:
                raise CommandError("No user with that username.")
        user.is_staff = not revoke
        user.save(update_fields=["is_staff"])
        self.stdout.write(self.style.SUCCESS(f"{user.username}: admin {'revoked' if revoke else 'granted'}"))
