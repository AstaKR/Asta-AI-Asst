"""Local, open-source AI service: translation (IndicTrans2), speech-to-text (faster-whisper) and
text-to-speech (Indic Parler-TTS). Runs as its own process in its own virtualenv (.venv-localai) so
heavy, version-pinned ML libraries stay out of the backend and worker, and each model is loaded once.

Start:  .venv-localai/Scripts/python -m local_ai.server
"""
