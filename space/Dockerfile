FROM python:3.12-slim

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "transformers>=4.44,<5" "huggingface_hub>=0.30" fastapi uvicorn soundfile numpy

# Spaces run as user 1000; create the folders as that user so the model can be downloaded
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user HF_HOME=/home/user/.cache/huggingface \
    ACCENT_COACH_MODEL_DIR=/home/user/models/wav2vec2-lv-60-espeak-cv-ft
RUN mkdir -p /home/user/app /home/user/models
WORKDIR /home/user/app
COPY --chown=user space_app.py recognizer.py ./

EXPOSE 7860
CMD ["uvicorn", "space_app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
