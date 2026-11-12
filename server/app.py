"""Accent Coach local server.

  GET  /api/health      are the speech model and the voice loaded?
  POST /api/recognize   WAV body -> {"phonemes": [...]}
  POST /api/speak       {"text", "voice"?, "speed"?} -> WAV (Kokoro)
  GET  /api/profile     the learner's profile (course, scores, streak)
  PUT  /api/profile     save it
  GET  /api/summary     short plain-language progress summary (for JARVIS)

Laptop mode binds 127.0.0.1 and the Vite dev server serves the page.
Phone mode (server/phone.py) binds the Wi-Fi address over HTTPS, serves the
built app itself, and requires an access key from anything that isn't this
laptop. Audio is processed in memory and never written to disk.
"""
from __future__ import annotations

import hmac
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .profile_store import ProfileStore, summarize
from .recognizer import PhonemeRecognizer, RecognizerNotReady, read_wav
from .tts import KokoroTTS, TtsNotReady

MAX_UPLOAD = 4 * 1024 * 1024  # ~2 min of 16 kHz PCM; a test phrase is ~100 KB
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ACCENT_COACH_DATA", ROOT / "data"))
DIST_DIR = ROOT / "web" / "dist"
KEY_COOKIE = "ac_key"
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def create_app(
    recognizer: PhonemeRecognizer | None = None,
    store: ProfileStore | None = None,
    tts: KokoroTTS | None = None,
    load_model: bool = True,
    access_key: str | None = None,
    serve_app: bool = False,
) -> FastAPI:
    rec = recognizer or PhonemeRecognizer()
    profiles = store or ProfileStore(DATA_DIR / "profile.json")
    voice = tts or KokoroTTS()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if load_model:
            rec.load_in_background()
            voice.load_in_background()
        yield

    app = FastAPI(title="Accent Coach", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5180", "http://localhost:5180"],
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )

    if access_key:

        @app.middleware("http")
        async def require_key(request: Request, call_next):
            """Phones on the Wi-Fi must open the link with ?key=… once; it's kept in a cookie.
            Anyone else on the network gets nothing, not even the page."""
            host = request.client.host if request.client else ""
            if host in LOOPBACK:
                return await call_next(request)
            given = request.query_params.get("key")
            if given is not None and hmac.compare_digest(given, access_key):
                resp = RedirectResponse(request.url.remove_query_params("key"), status_code=303)
                resp.set_cookie(KEY_COOKIE, access_key, httponly=True, secure=True, samesite="strict", max_age=60 * 60 * 24 * 365)
                return resp
            cookie = request.cookies.get(KEY_COOKIE, "")
            if not hmac.compare_digest(cookie, access_key):
                return JSONResponse({"detail": "Open the link shown on the laptop (it includes the access key)."}, status_code=403)
            return await call_next(request)

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "ok": True,
            "model": rec.model_id,
            "ready": rec.ready,
            "loading": rec.loading,
            "error": rec.error,
            "voice": {"ready": voice.ready, "loading": voice.loading, "error": voice.error},
        }

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

    @app.post("/api/speak")
    async def speak(request: Request) -> Response:
        try:
            body = json.loads(await request.body())
            text = str(body.get("text", "")).strip()
        except (json.JSONDecodeError, AttributeError):
            raise HTTPException(400, "send JSON like {\"text\": \"hello\"}")
        if not text:
            raise HTTPException(400, "nothing to say")
        try:
            lang = body.get("lang")
            wav = voice.speak(text, str(body.get("voice", "af_heart")), float(body.get("speed", 1.0)), str(lang) if lang else None)
        except TtsNotReady as exc:
            raise HTTPException(503, f"voice not ready: {exc}")
        return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})

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

    if serve_app:
        if not (DIST_DIR / "index.html").exists():
            raise RuntimeError("web/dist is missing: run `npm run build` in web/ first")
        app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="app")

    return app


app = create_app()
