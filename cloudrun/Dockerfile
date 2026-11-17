# Accent Coach listener on Google Cloud Run. Built by deploy.ps1, which copies
# space_app.py and recognizer.py next to this file first.
FROM python:3.12-slim

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "transformers>=4.44,<5" "huggingface_hub>=0.30" fastapi uvicorn soundfile numpy

# The model goes into the image (1.2 GB) so a cold start doesn't download it again.
ENV ACCENT_COACH_MODEL_DIR=/models/wav2vec2-lv-60-espeak-cv-ft \
    LOAD_BEFORE_SERVE=1 \
    HF_HUB_DISABLE_TELEMETRY=1
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('facebook/wav2vec2-lv-60-espeak-cv-ft', local_dir='/models/wav2vec2-lv-60-espeak-cv-ft', allow_patterns=['*.json', 'pytorch_model.bin'])"

WORKDIR /app
COPY space_app.py recognizer.py ./

# Cloud Run says which port to use in $PORT.
CMD exec uvicorn space_app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1
