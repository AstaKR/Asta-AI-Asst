from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("meetings", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="meeting",
            name="summary_input_tokens",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="meeting",
            name="summary_output_tokens",
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
