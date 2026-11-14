"""Accent Coach local server.

  GET  /api/health      are the speech model and the voice loaded?
  POST /api/recognize   WAV body -> {"phonemes": [...]}
  POST /api/speak       {"text", "voice"?, "speed"?} -> WAV (Kokoro)
  POST /api/phonemize   {"text", "lang"?} -> {"words": [{"text", "ipa"}]}: how any text is pronounced
  GET  /api/profile     the learner's profile (course, scores, streak)
  PUT  /api/profile     save it -> {"rev"}; 409 + the current profile if "rev" in the body is out of date
  GET  /api/summary     short plain-language progress summary (for JARVIS)

Laptop mode binds 127.0.0.1 and the Vite dev server serves the page.
Phone mode (server/phone.py) binds the Wi-Fi address over HTTPS, serves the
built app itself, and requires an access key from anything that isn't this
laptop. Audio is processed in memory and never written to disk.
"""
from __future__ import annotations

import hmac
import json
import math
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .phonemize import Phonemizer, PhonemizerNotReady, split_words
from .profile_store import ProfileStore, StaleProfile, summarize
from .recognizer import PhonemeRecognizer, RecognizerNotReady, read_wav
from .tts import KokoroTTS, TtsNotReady

MAX_UPLOAD = 4 * 1024 * 1024  # ~2 min of 16 kHz PCM; a test phrase is ~100 KB
MAX_SPEAK_BODY = 16 * 1024  # tts.py keeps only the first 400 characters anyway
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ACCENT_COACH_DATA", ROOT / "data"))
DIST_DIR = ROOT / "web" / "dist"
KEY_COOKIE = "ac_key"
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}
MIN_SAMPLES = 400  # 25 ms at 16 kHz: the speech model cannot take less


async def read_body(request: Request, limit: int, too_big: str) -> bytes:
    """The request body, or 413 as soon as it is known to be over `limit`
    (request.body() would first hold all of it in memory, however large)."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, too_big)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, too_big)
        chunks.append(chunk)
    return b"".join(chunks)


def parse_json(raw: bytes, hint: str) -> object:
    try:
        return json.loads(raw)
    except (ValueError, RecursionError):  # bad JSON, bytes that aren't UTF-8, nesting too deep
        raise HTTPException(400, hint)


def same_key(given: str, key: str) -> bool:
    # as bytes: compare_digest raises TypeError on a str with non-ASCII characters
    return hmac.compare_digest(given.encode("utf-8", "surrogatepass"), key.encode("utf-8"))


def create_app(
    recognizer: PhonemeRecognizer | None = None,
    store: ProfileStore | None = None,
    tts: KokoroTTS | None = None,
    load_model: bool = True,
    access_key: str | None = None,
    serve_app: bool = False,
    phonemizer: Phonemizer | None = None,
) -> FastAPI:
    sounds = phonemizer or Phonemizer()
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
            if given is not None and same_key(given, access_key):
                resp = RedirectResponse(request.url.remove_query_params("key"), status_code=303)
                resp.set_cookie(KEY_COOKIE, access_key, httponly=True, secure=True, samesite="strict", max_age=60 * 60 * 24 * 365)
                return resp
            cookie = request.cookies.get(KEY_COOKIE, "")
            if not same_key(cookie, access_key):
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

    # The model calls below take seconds of CPU, so they run in a worker thread;
    # called directly they would block the event loop and stall every other request.

    @app.post("/api/recognize")
    async def recognize(request: Request) -> dict[str, object]:
        body = await read_body(request, MAX_UPLOAD, "audio too long")
        if not body:
            raise HTTPException(400, "empty audio")
        try:
            audio = read_wav(body)
        except Exception:
            raise HTTPException(400, "could not read audio (send 16-bit PCM WAV)")
        if len(audio) < MIN_SAMPLES:
            raise HTTPException(400, "empty audio")
        try:
            r = await run_in_threadpool(rec.recognize, audio)
        except RecognizerNotReady as exc:
            raise HTTPException(503, f"speech model not ready: {exc}")
        return {"phonemes": r.phonemes, "seconds": round(r.seconds, 2)}

    @app.post("/api/speak")
    async def speak(request: Request) -> Response:
        hint = "send JSON like {\"text\": \"hello\", \"speed\": 1.0}"
        body = parse_json(await read_body(request, MAX_SPEAK_BODY, "request too large"), hint)
        try:
            text = str(body.get("text", "")).strip()
            speed = float(body.get("speed", 1.0))
        except (AttributeError, TypeError, ValueError):
            raise HTTPException(400, hint)
        if not text:
            raise HTTPException(400, "nothing to say")
        if not math.isfinite(speed):
            raise HTTPException(400, "speed must be a number")
        try:
            lang = body.get("lang")
            wav = await run_in_threadpool(voice.speak, text, str(body.get("voice", "af_heart")), speed, str(lang) if lang else None)
        except TtsNotReady as exc:
            raise HTTPException(503, f"voice not ready: {exc}")
        return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})

    @app.post("/api/phonemize")
    async def phonemize(request: Request) -> dict[str, object]:
        hint = "send JSON like {\"text\": \"hello there\"}"
        body = parse_json(await read_body(request, MAX_SPEAK_BODY, "request too large"), hint)
        try:
            text = str(body.get("text", "")).strip()
            lang = str(body.get("lang", "en-us"))
        except AttributeError:
            raise HTTPException(400, hint)
        if not split_words(text):
            raise HTTPException(400, "nothing to pronounce")
        try:
            words = await run_in_threadpool(sounds.words, text, lang)
        except PhonemizerNotReady as exc:
            raise HTTPException(503, f"pronunciations aren't available: {exc}")
        return {"words": words}

    @app.get("/api/profile")
    def get_profile() -> dict[str, object]:
        return {"profile": profiles.load()}

    @app.put("/api/profile")
    async def put_profile(request: Request):
        data = parse_json(await read_body(request, 512 * 1024, "profile too large"), "invalid JSON")
        if not isinstance(data, dict) or data.get("version") != 1:
            raise HTTPException(400, "not an Accent Coach profile")
        try:
            # NaN / Infinity (1e999) parse, but once stored GET /api/profile could never send them back
            json.dumps(data, allow_nan=False)
        except (ValueError, RecursionError):
            raise HTTPException(400, "invalid JSON")
        base = data.get("rev")
        try:
            rev = profiles.save(data, base if isinstance(base, int) and not isinstance(base, bool) else None)
        except StaleProfile as stale:
            return JSONResponse({"detail": "Saved on another device since this copy was loaded.", "profile": stale.current}, status_code=409)
        return {"saved": True, "rev": rev}

    @app.get("/api/summary")
    def summary() -> dict[str, object]:
        return summarize(profiles.load())

    if serve_app:
        if not (DIST_DIR / "index.html").exists():
            raise RuntimeError("web/dist is missing: run `npm run build` in web/ first")
        app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="app")

    return app


app = create_app()
