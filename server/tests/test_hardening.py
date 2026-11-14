"""Bugs found in a review of the server; each test failed before its fix."""
import asyncio
import io
import os

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from server.app import create_app
from server.profile_store import ProfileStore, summarize
from server.recognizer import MAX_SECONDS, SAMPLE_RATE, read_wav
from server.tests.test_phone_and_voice import FakeTTS
from server.tests.test_server import FakeRecognizer

KEY = "k" * 24


def make(tmp_path, key=None, client=("testclient", 5000)):
    rec = FakeRecognizer()
    app = create_app(recognizer=rec, store=ProfileStore(tmp_path / "profile.json"), tts=FakeTTS(), load_model=False, access_key=key)
    return TestClient(app, client=client, raise_server_exceptions=False), rec


# --- phone key -------------------------------------------------------------

def test_non_ascii_key_is_refused_not_a_crash(tmp_path):
    c, _ = make(tmp_path, key=KEY, client=("192.168.1.50", 5000))
    assert c.get("/api/health?key=%C3%A9", follow_redirects=False).status_code == 403
    assert c.get("/api/health", headers={"Cookie": "ac_key=é".encode("latin-1")}).status_code == 403


# --- bad input must be 4xx, not 500 -----------------------------------------

def test_bodies_that_are_not_utf8_are_a_400(tmp_path):
    c, _ = make(tmp_path)
    assert c.put("/api/profile", content=b"\xff\xfe{").status_code == 400
    assert c.post("/api/phonemize", content=b"\xff\xfe{").status_code == 400


def test_deeply_nested_json_is_a_400(tmp_path):
    c, _ = make(tmp_path)
    deep = b"[" * 8000 + b"]" * 8000
    assert c.post("/api/speak", content=deep).status_code == 400
    assert c.post("/api/phonemize", content=deep).status_code == 400
    assert c.put("/api/profile", content=b'{"version": 1, "x": ' + b"[" * 100000 + b"]" * 100000 + b"}").status_code == 400


def test_profile_with_nan_is_refused_so_it_can_still_be_read_back(tmp_path):
    c, _ = make(tmp_path)
    assert c.put("/api/profile", content=b'{"version": 1, "day": NaN}').status_code == 400
    assert c.put("/api/profile", content=b'{"version": 1, "day": 1e999}').status_code == 400
    assert c.get("/api/profile").status_code == 200


def test_recognize_refuses_a_wav_with_no_sound_in_it(tmp_path):
    c, rec = make(tmp_path)
    buf = io.BytesIO()
    sf.write(buf, np.zeros(0, dtype=np.float32), 16000, format="WAV", subtype="PCM_16")
    assert c.post("/api/recognize", content=buf.getvalue()).status_code == 400
    assert rec.got_seconds is None  # the model was never handed an empty clip


def test_oversized_upload_is_refused_without_reading_it_all(tmp_path):
    app = create_app(recognizer=FakeRecognizer(), store=ProfileStore(tmp_path / "p.json"), tts=FakeTTS(), load_model=False)
    for path, method in (("/api/recognize", "POST"), ("/api/speak", "POST"), ("/api/phonemize", "POST"), ("/api/profile", "PUT")):
        pulled = 0
        status = []

        async def receive():
            nonlocal pulled
            pulled += 1
            if pulled > 200:
                return {"type": "http.disconnect"}
            return {"type": "http.request", "body": b"\0" * (1024 * 1024), "more_body": True}

        async def send(msg):
            if msg["type"] == "http.response.start":
                status.append(msg["status"])

        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "path": path, "raw_path": path.encode(),
            "query_string": b"", "headers": [(b"host", b"127.0.0.1")], "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80), "scheme": "http", "root_path": "",
        }
        asyncio.run(app(scope, receive, send))
        assert status == [413], path
        assert pulled <= 6, f"{path} buffered {pulled} MB of an endless upload"


def test_read_wav_does_not_decode_more_than_it_will_use():
    buf = io.BytesIO()
    sf.write(buf, np.zeros(48000 * 120, dtype=np.float32), 48000, format="FLAC")  # 2 min, a few KB on the wire
    assert len(read_wav(buf.getvalue())) <= SAMPLE_RATE * MAX_SECONDS


# --- profile on disk --------------------------------------------------------

def test_profile_with_a_byte_order_mark_still_loads(tmp_path):
    p = tmp_path / "profile.json"
    p.write_text('{"version": 1, "day": 2}', encoding="utf-8-sig")  # Notepad / PowerShell save it this way
    assert ProfileStore(p).load() == {"version": 1, "day": 2}


def test_unreadable_profile_does_not_crash_and_is_kept_aside_when_replaced(tmp_path):
    p = tmp_path / "profile.json"
    bad = b'{"version": 1, "day": 7, "course": [\xff'
    p.write_bytes(bad)
    store = ProfileStore(p)
    assert store.load() is None
    assert store.save({"version": 1, "day": 0}) == 1
    assert store.load()["day"] == 0
    kept = [f for f in tmp_path.iterdir() if f.name != "profile.json"]
    assert len(kept) == 1 and kept[0].read_bytes() == bad


def test_failed_save_leaves_no_temp_file_and_the_old_profile(tmp_path, monkeypatch):
    store = ProfileStore(tmp_path / "profile.json")
    store.save({"version": 1, "day": 1})

    def boom(*a, **k):
        raise PermissionError("in use")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(PermissionError):
        store.save({"version": 1, "day": 2})
    monkeypatch.undo()
    assert [f.name for f in tmp_path.iterdir()] == ["profile.json"]
    assert store.load()["day"] == 1


# --- summary ----------------------------------------------------------------

@pytest.mark.parametrize("profile", [
    {"version": 1, "day": "tuesday"},
    {"version": 1, "day": -1, "course": [{"kind": "lesson", "lesson": "v-w"}]},
    {"version": 1, "course": ["v-w", None]},
    {"version": 1, "course": {"a": 1}},
    {"version": 1, "assessment": {"lessons": {"v-w": {"score": "high"}, "f": {"score": 90}}}},
    {"version": 1, "assessment": [1]},
    {"version": 1, "history": [{}, {"overall": None}]},
    {"version": 1, "history": [1, 2]},
    {"version": 1, "streak": 3},
    {"version": 1, "streak": {"count": "many"}},
])
def test_summary_survives_a_malformed_profile(tmp_path, profile):
    assert summarize(profile)["started"] is True
    c, _ = make(tmp_path)
    assert c.put("/api/profile", json=profile).status_code == 200
    assert c.get("/api/summary").status_code == 200
