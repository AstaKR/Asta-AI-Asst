FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt "gunicorn>=23" "psycopg[binary]>=3.2"

COPY backend /app/backend
WORKDIR /app/backend

RUN useradd --create-home appuser && mkdir -p /app/media && chown appuser /app/media
USER appuser

EXPOSE 8000
# Migrations + static files on start, then gunicorn.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --access-logfile -"]
