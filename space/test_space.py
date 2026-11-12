"""Tests for the online listener. Run from the repo root:
    .venv\\Scripts\\python.exe -m pytest space -q
"""
import io
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "space"), str(ROOT / "server")]  # space_app imports `recognizer`

import space_app  # noqa: E402
from recognizer import Recognition  # noqa: E402


class Ready:
    model_id = "fake"
    ready = True
    loading = False
    error = None

    def load_in_background(self):
        pass

    def recognize(self, audio):
        return Recognition(phonemes=["θ", "ɪ", "ŋ", "k"], seconds=len(audio) / 16000)


def wav(seconds=1.0):
    buf = io.BytesIO()
    sf.write(buf, np.zeros(int(16000 * seconds), dtype=np.float32), 16000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def client(monkeypatch):
    monkeypatch.setattr(space_app, "rec", Ready())
    space_app._hits.clear()
    return TestClient(space_app.app)


def test_recognize(monkeypatch):
    r = client(monkeypatch).post("/recognize", content=wav())
    assert r.status_code == 200 and r.json()["phonemes"] == ["θ", "ɪ", "ŋ", "k"]


def test_size_cap_and_bad_audio(monkeypatch):
    c = client(monkeypatch)
    assert c.post("/recognize", content=b"x" * (space_app.MAX_UPLOAD + 1)).status_code == 413
    assert c.post("/recognize", content=b"not audio").status_code == 400
    assert c.post("/recognize", content=b"").status_code == 400


def test_rate_limit_per_visitor(monkeypatch):
    c = client(monkeypatch)
    monkeypatch.setattr(space_app, "RATE_MAX", 3)
    h1 = {"x-forwarded-for": "1.1.1.1"}
    assert [c.post("/recognize", content=wav(0.1), headers=h1).status_code for _ in range(4)] == [200, 200, 200, 429]
    # someone else is unaffected
    assert c.post("/recognize", content=wav(0.1), headers={"x-forwarded-for": "2.2.2.2"}).status_code == 200


def test_only_accent_coach_site_gets_cors(monkeypatch):
    c = client(monkeypatch)
    ok = c.get("/health", headers={"Origin": "https://accent-coach-smoky.vercel.app"})
    bad = c.get("/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "https://accent-coach-smoky.vercel.app"
    assert "access-control-allow-origin" not in bad.headers
