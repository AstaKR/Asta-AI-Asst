# Free local AI service (IndicTrans2, faster-whisper, Indic Parler-TTS). CPU build.
# Models download into the /models volume on first use (gated ones need HF_TOKEN; see docs/LOCAL_AI.md).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/hf
# build-essential: IndicTransToolkit is compiled (Cython). git: parler-tts installs from GitHub.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY local_ai/requirements.txt /app/local_ai/requirements.txt
# CPU-only PyTorch first (the default wheel bundles CUDA libraries this server does not use).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir -r local_ai/requirements.txt

COPY local_ai /app/local_ai

RUN useradd --create-home appuser && mkdir -p /models && chown appuser /models
USER appuser

EXPOSE 8090
CMD ["python", "-m", "local_ai.server"]
