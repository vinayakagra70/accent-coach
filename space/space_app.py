"""Accent Coach online listener (a Hugging Face Space).

For phones that can't run the speech model in the browser: they send one short
recording, get back the phonemes the model heard. Nothing is stored.

  GET  /health      is the model loaded?
  POST /recognize   16 kHz WAV body (max ~15 s) -> {"phonemes": [...]}

Only the Accent Coach website may call it from a browser (CORS), uploads are
size-capped, and each visitor is rate-limited.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from recognizer import PhonemeRecognizer, RecognizerNotReady, read_wav

MAX_UPLOAD = 1_000_000  # 16 kHz 16-bit mono: ~30 s; a test phrase is ~100 KB
RATE_WINDOW_S = 600
RATE_MAX = 80  # recordings per visitor per 10 minutes (a voice test is 13)
ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS",
    "https://accent-coach-smoky.vercel.app,http://127.0.0.1:5190,http://localhost:5190,http://127.0.0.1:5180",
).split(",") if o.strip()]

rec = PhonemeRecognizer()
app = FastAPI(title="Accent Coach listener", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"], max_age=3600)

_hits: dict[str, deque[float]] = defaultdict(deque)
_hits_lock = threading.Lock()


def allow(ip: str) -> bool:
    now = time.monotonic()
    with _hits_lock:
        q = _hits[ip]
        while q and now - q[0] > RATE_WINDOW_S:
            q.popleft()
        if len(q) >= RATE_MAX:
            return False
        q.append(now)
        if len(_hits) > 10_000:  # keep memory bounded
            for k in [k for k, v in _hits.items() if not v][:5_000]:
                del _hits[k]
        return True


@app.on_event("startup")
def _load() -> None:
    rec.load_in_background()


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "Accent Coach listener", "see": "/health"}


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "ready": rec.ready, "loading": rec.loading, "error": rec.error}


@app.post("/recognize")
async def recognize(request: Request) -> dict[str, object]:
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?"))
    if not allow(ip):
        raise HTTPException(429, "too many recordings, try again in a few minutes")
    body = await request.body()
    if not body:
        raise HTTPException(400, "empty audio")
    if len(body) > MAX_UPLOAD:
        raise HTTPException(413, "recording too long")
    try:
        audio = read_wav(body)
    except Exception:
        raise HTTPException(400, "could not read audio (send 16-bit PCM WAV)")
    try:
        # off the event loop, so /health and other visitors aren't stalled while the model runs
        r = await run_in_threadpool(rec.recognize, audio)
    except RecognizerNotReady as exc:
        raise HTTPException(503, f"model loading: {exc}")
    return {"phonemes": r.phonemes, "seconds": round(r.seconds, 2)}
