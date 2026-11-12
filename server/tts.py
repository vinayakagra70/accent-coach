"""Kokoro text-to-speech (kokoro-onnx, CPU): the coach's voice and the American model words.

The model files live in models/kokoro/ (copied or downloaded by setup.ps1, not in git).
"""
from __future__ import annotations

import io
import threading
from collections import OrderedDict
from pathlib import Path

KOKORO_DIR = Path(__file__).resolve().parent.parent / "models" / "kokoro"
MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"
# American English voices only: the app teaches General American.
VOICES = {"af_heart", "af_bella", "am_michael", "am_adam"}
DEFAULT_VOICE = "af_heart"
MAX_CHARS = 400


class TtsNotReady(RuntimeError):
    pass


class KokoroTTS:
    def __init__(self, model_dir: Path = KOKORO_DIR, cache_size: int = 96) -> None:
        self.model_dir = model_dir
        self._kokoro = None
        self._lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, str, float], bytes] = OrderedDict()
        self._cache_size = cache_size
        self.loading = False
        self.error: str | None = None

    @property
    def ready(self) -> bool:
        return self._kokoro is not None

    @property
    def available(self) -> bool:
        return (self.model_dir / MODEL_FILE).exists() and (self.model_dir / VOICES_FILE).exists()

    def load_in_background(self) -> None:
        if self.ready or self.loading:
            return
        if not self.available:
            self.error = f"Kokoro files not found in {self.model_dir} (run setup.ps1)"
            return
        self.loading = True
        threading.Thread(target=self._load, name="kokoro-load", daemon=True).start()

    def _load(self) -> None:
        try:
            import onnxruntime as ort
            from kokoro_onnx import Kokoro

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 4
            session = ort.InferenceSession(str(self.model_dir / MODEL_FILE), opts, providers=["CPUExecutionProvider"])
            k = Kokoro.from_session(session, str(self.model_dir / VOICES_FILE))
            k.create("Ready.", voice=DEFAULT_VOICE, speed=1.0, lang="en-us")  # warm-up
            self._kokoro = k
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"
        finally:
            self.loading = False

    def speak(self, text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0) -> bytes:
        """Returns 16-bit WAV bytes."""
        if not self.ready:
            raise TtsNotReady(self.error or "voice is still loading")
        text = " ".join(text.split())[:MAX_CHARS]
        voice = voice if voice in VOICES else DEFAULT_VOICE
        speed = min(1.4, max(0.6, speed))
        key = (text, voice, round(speed, 2))
        with self._lock:
            hit = self._cache.get(key)
            if hit:
                self._cache.move_to_end(key)
                return hit
            audio, rate = self._kokoro.create(text, voice=voice, speed=speed, lang="en-us")
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, audio, rate, format="WAV", subtype="PCM_16")
        data = buf.getvalue()
        with self._lock:
            self._cache[key] = data
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return data
