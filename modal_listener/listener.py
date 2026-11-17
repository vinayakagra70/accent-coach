"""Accent Coach online listener on Modal (modal.com).

Same code as the Hugging Face Space (space/space_app.py + server/recognizer.py),
packaged for Modal because new Hugging Face accounts get no free CPU.

    pip install modal
    modal setup                                  # once: log in
    modal deploy modal_listener/listener.py      # prints the https://... address

It sleeps when nobody is practising and wakes on the first recording
(roughly 30-60 s, which the app already shows as "Waking up the online checker").
"""
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = "/models/wav2vec2-lv-60-espeak-cv-ft"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("transformers>=4.44,<5", "huggingface_hub>=0.30", "fastapi", "soundfile", "numpy")
    .env({"ACCENT_COACH_MODEL_DIR": MODEL_DIR, "HF_HUB_DISABLE_TELEMETRY": "1"})
    # The 1.2 GB model goes into the image, so waking up doesn't download it again.
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        f"snapshot_download('facebook/wav2vec2-lv-60-espeak-cv-ft', local_dir='{MODEL_DIR}', "
        "allow_patterns=['*.json', 'pytorch_model.bin'])\""
    )
    .add_local_file(ROOT / "space" / "space_app.py", "/root/space_app.py")
    .add_local_file(ROOT / "server" / "recognizer.py", "/root/recognizer.py")
)

app = modal.App("accent-coach-listener", image=image)


@app.function(
    cpu=2,
    memory=4096,
    timeout=120,
    scaledown_window=300,  # stay awake 5 minutes after the last recording, then sleep (and cost nothing)
    max_containers=2,  # a hard cap on spending
)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def web():
    import sys

    sys.path.insert(0, "/root")
    import space_app

    # Load the model before taking requests; the app's startup hook then sees it ready.
    space_app.rec._load()
    return space_app.app
