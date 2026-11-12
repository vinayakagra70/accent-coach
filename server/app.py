"""Accent Coach local server.

  GET  /api/health      is the speech model loaded?
  POST /api/recognize   WAV body -> {"phonemes": [...]}
  GET  /api/profile     the learner's profile (course, scores, streak)
  PUT  /api/profile     save it
  GET  /api/summary     short plain-language progress summary (for JARVIS)

Binds to 127.0.0.1 only. Audio is processed in memory and never written to disk.
"""
from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .profile_store import ProfileStore, summarize
from .recognizer import PhonemeRecognizer, RecognizerNotReady, read_wav

MAX_UPLOAD = 4 * 1024 * 1024  # ~2 min of 16 kHz PCM; a test phrase is ~100 KB

DATA_DIR = Path(os.environ.get("ACCENT_COACH_DATA", Path(__file__).resolve().parent.parent / "data"))


def create_app(recognizer: PhonemeRecognizer | None = None, store: ProfileStore | None = None, load_model: bool = True) -> FastAPI:
    rec = recognizer or PhonemeRecognizer()
    profiles = store or ProfileStore(DATA_DIR / "profile.json")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if load_model:
            rec.load_in_background()
        yield

    app = FastAPI(title="Accent Coach", lifespan=lifespan)
    # Vite dev server on 5180 calls us through its proxy; allow it directly too.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5180", "http://localhost:5180"],
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {"ok": True, "model": rec.model_id, "ready": rec.ready, "loading": rec.loading, "error": rec.error}

    @app.post("/api/recognize")
    async def recognize(request: Request) -> dict[str, object]:
        body = await request.body()
        if not body:
            raise HTTPException(400, "empty audio")
        if len(body) > MAX_UPLOAD:
            raise HTTPException(413, "audio too long")
        try:
            audio = read_wav(body)
        except Exception:
            raise HTTPException(400, "could not read audio (send 16-bit PCM WAV)")
        try:
            r = rec.recognize(audio)
        except RecognizerNotReady as exc:
            raise HTTPException(503, f"speech model not ready: {exc}")
        return {"phonemes": r.phonemes, "seconds": round(r.seconds, 2)}

    @app.get("/api/profile")
    def get_profile() -> dict[str, object]:
        return {"profile": profiles.load()}

    @app.put("/api/profile")
    async def put_profile(request: Request) -> dict[str, object]:
        raw = await request.body()
        if len(raw) > 512 * 1024:
            raise HTTPException(413, "profile too large")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise HTTPException(400, "invalid JSON")
        if not isinstance(data, dict) or data.get("version") != 1:
            raise HTTPException(400, "not an Accent Coach profile")
        profiles.save(data)
        return {"saved": True}

    @app.get("/api/summary")
    def summary() -> dict[str, object]:
        return summarize(profiles.load())

    return app


app = create_app()
