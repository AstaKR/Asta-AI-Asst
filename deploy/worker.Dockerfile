FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY translation_worker/requirements.txt /app/translation_worker/requirements.txt
RUN pip install --no-cache-dir -r translation_worker/requirements.txt

COPY translation_worker /app/translation_worker

RUN useradd --create-home appuser
USER appuser

# Production mode: registers with LiveKit and accepts dispatched calls.
CMD ["python", "-m", "translation_worker.main", "start"]
