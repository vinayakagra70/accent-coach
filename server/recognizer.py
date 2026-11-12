"""Phoneme recognition: speech in, IPA phonemes out.

Uses facebook/wav2vec2-lv-60-espeak-cv-ft, a CTC model that writes what it
hears as espeak IPA phonemes. It is multilingual, so it can write the
Indian-English variants we look for (ʈ ɖ ʋ t̪ eː oː) instead of forcing
everything onto American sounds.

CTC decoding is done here from vocab.json rather than with the model's
tokenizer class, which would pull in the phonemizer/espeak dependency for
nothing (we only decode, never phonemize).
"""
from __future__ import annotations

import io
import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
# A plain folder, not the Hugging Face cache: the cache needs symlinks, which
# Windows refuses without Developer Mode (WinError 1314).
MODEL_DIR = Path(os.environ.get("ACCENT_COACH_MODEL_DIR") or Path(__file__).resolve().parent.parent / "models" / "wav2vec2-lv-60-espeak-cv-ft")
SAMPLE_RATE = 16000
MAX_SECONDS = 15


@dataclass
class Recognition:
    phonemes: list[str]
    seconds: float


class RecognizerNotReady(RuntimeError):
    pass


class PhonemeRecognizer:
    """Loads the model once in a background thread; `recognize` is thread-safe."""

    def __init__(self, model_id: str = MODEL_ID) -> None:
        self.model_id = model_id
        self._model = None
        self._extractor = None
        self._id_to_token: dict[int, str] = {}
        self._blank = 0
        self._skip: set[int] = set()
        self._lock = threading.Lock()
        self.error: str | None = None
        self.loading = False

    @property
    def ready(self) -> bool:
        return self._model is not None

    def load_in_background(self) -> None:
        if self.loading or self.ready:
            return
        self.loading = True
        threading.Thread(target=self._load, name="phoneme-model-load", daemon=True).start()

    def _load(self) -> None:
        try:
            import torch  # noqa: F401  (imported here so the server starts fast)
            from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

            if not (MODEL_DIR / "pytorch_model.bin").exists():
                from huggingface_hub import snapshot_download

                snapshot_download(self.model_id, local_dir=str(MODEL_DIR), allow_patterns=["*.json", "pytorch_model.bin"])
            vocab: dict[str, int] = json.loads((MODEL_DIR / "vocab.json").read_text(encoding="utf-8"))
            self._id_to_token = {i: t for t, i in vocab.items()}
            self._blank = vocab.get("<pad>", 0)
            self._skip = {i for t, i in vocab.items() if t in {"<pad>", "<s>", "</s>", "<unk>", "|"}}
            self._extractor = Wav2Vec2FeatureExtractor.from_pretrained(str(MODEL_DIR))
            model = Wav2Vec2ForCTC.from_pretrained(str(MODEL_DIR))
            model.eval()
            self._model = model
        except Exception as exc:  # surfaced through /api/health
            self.error = f"{type(exc).__name__}: {exc}"
        finally:
            self.loading = False

    def decode_ids(self, ids: list[int]) -> list[str]:
        """Standard CTC collapse: merge repeats, then drop blanks."""
        out: list[str] = []
        prev = -1
        for i in ids:
            if i != prev and i not in self._skip and i != self._blank:
                tok = self._id_to_token.get(i)
                if tok:
                    out.append(tok)
            prev = i
        return out

    def recognize(self, audio: np.ndarray) -> Recognition:
        if not self.ready:
            raise RecognizerNotReady(self.error or "model is still loading")
        import torch

        audio = prepare(audio)
        inputs = self._extractor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
        with self._lock, torch.inference_mode():
            logits = self._model(inputs.input_values).logits[0]
        ids = logits.argmax(dim=-1).tolist()
        return Recognition(phonemes=self.decode_ids(ids), seconds=len(audio) / SAMPLE_RATE)


def prepare(audio: np.ndarray) -> np.ndarray:
    """Mono float32, trimmed of silence at the ends, capped in length, peak-normalized."""
    a = np.asarray(audio, dtype=np.float32)
    if a.ndim > 1:
        a = a.mean(axis=1)
    a = a[: SAMPLE_RATE * MAX_SECONDS]
    if a.size == 0:
        return a
    frame = SAMPLE_RATE // 50
    energy = np.array([np.sqrt(np.mean(a[i : i + frame] ** 2)) for i in range(0, max(1, a.size - frame + 1), frame)])
    if energy.size and energy.max() > 0:
        loud = np.nonzero(energy > energy.max() * 0.05)[0]
        if loud.size:
            start = max(0, (loud[0] - 10) * frame)
            end = min(a.size, (loud[-1] + 11) * frame)
            a = a[start:end]
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 0:
        a = a / peak * 0.9
    return a


def read_wav(data: bytes) -> np.ndarray:
    """Decode a WAV upload and resample to 16 kHz if needed."""
    import soundfile as sf

    audio, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != SAMPLE_RATE:
        n = int(round(len(audio) * SAMPLE_RATE / rate))
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio
