from django.db import migrations

# Example tiers: prices and limits are editable in Django admin / the web admin page.
PLANS = [
    dict(code="free", name="Free", price_inr_month=0, sort=0, is_default=True, description="Try the translator",
         daily_call_minutes=30, daily_assistant_requests=20, monthly_meeting_minutes=60, video_calls=True, phone_calls=False, daily_phone_calls=0),
    dict(code="pro", name="Pro", price_inr_month=499, sort=1, description="For daily calls and meetings",
         daily_call_minutes=180, daily_assistant_requests=100, monthly_meeting_minutes=600, video_calls=True, phone_calls=True, daily_phone_calls=20),
    dict(code="business", name="Business", price_inr_month=1499, sort=2, description="Teams and heavy use",
         daily_call_minutes=600, daily_assistant_requests=300, monthly_meeting_minutes=3000, video_calls=True, phone_calls=True, daily_phone_calls=60),
]


def seed(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    for p in PLANS:
        Plan.objects.get_or_create(code=p["code"], defaults=p)


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
