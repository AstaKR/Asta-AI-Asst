"""Background job runner for meetings (transcription, translation, summaries).

    .venv\\Scripts\\python backend\\manage.py process_meetings          # run continuously
    .venv\\Scripts\\python backend\\manage.py process_meetings --once   # process the queue and exit
"""

import time

from django.core.management.base import BaseCommand

from meetings import services


class Command(BaseCommand):
    help = "Process queued meeting jobs."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process all queued jobs, then exit.")
        parser.add_argument("--interval", type=float, default=2.0, help="Seconds between queue checks.")

    def handle(self, *args, once=False, interval=2.0, **options):
        recovered = services.recover_stale()
        if recovered:
            self.stdout.write(f"Recovered {recovered} stale job(s).")
        self.stdout.write("Meeting job runner started." + (" (single pass)" if once else ""))
        while True:
            job = services.claim_next()
            if job is None:
                if once:
                    return
                time.sleep(interval)
                continue
            self.stdout.write(f"Running {job.kind} job {job.pk} for meeting {job.meeting_id}")
            services.run_job(job)
            job.refresh_from_db()
            self.stdout.write(f"  -> {job.status}{': ' + job.error if job.error else ''}")
