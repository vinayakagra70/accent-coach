import io

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from server.app import create_app
from server.profile_store import ProfileStore, summarize
from server.recognizer import PhonemeRecognizer, Recognition, RecognizerNotReady, prepare, read_wav


class FakeRecognizer(PhonemeRecognizer):
    def __init__(self, ready=True):
        super().__init__("fake")
        self._ready = ready
        self.got_seconds = None

    @property
    def ready(self):
        return self._ready

    def recognize(self, audio):
        if not self._ready:
            raise RecognizerNotReady("loading")
        self.got_seconds = len(audio) / 16000
        return Recognition(phonemes=["ð", "ɪ", "s"], seconds=self.got_seconds)


def wav_bytes(seconds=1.0, rate=48000):
    t = np.linspace(0, seconds, int(rate * seconds), endpoint=False)
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def client(tmp_path, ready=True):
    rec = FakeRecognizer(ready)
    app = create_app(recognizer=rec, store=ProfileStore(tmp_path / "profile.json"), load_model=False)
    return TestClient(app), rec


def test_recognize_resamples_to_16k(tmp_path):
    c, rec = client(tmp_path)
    r = c.post("/api/recognize", content=wav_bytes(1.0, 48000), headers={"Content-Type": "audio/wav"})
    assert r.status_code == 200
    assert r.json()["phonemes"] == ["ð", "ɪ", "s"]
    assert abs(rec.got_seconds - 1.0) < 0.01


def test_recognize_reports_model_not_ready(tmp_path):
    c, _ = client(tmp_path, ready=False)
    r = c.post("/api/recognize", content=wav_bytes(), headers={"Content-Type": "audio/wav"})
    assert r.status_code == 503


def test_recognize_rejects_garbage_and_empty(tmp_path):
    c, _ = client(tmp_path)
    assert c.post("/api/recognize", content=b"not a wav").status_code == 400
    assert c.post("/api/recognize", content=b"").status_code == 400


def test_profile_round_trip(tmp_path):
    c, _ = client(tmp_path)
    assert c.get("/api/profile").json() == {"profile": None}
    p = {"version": 1, "day": 0, "course": [{"kind": "lesson", "lesson": "v-w"}], "streak": {"count": 0}}
    assert c.put("/api/profile", json=p).status_code == 200
    assert c.get("/api/profile").json()["profile"]["course"][0]["lesson"] == "v-w"
    assert (tmp_path / "profile.json").exists()


def test_profile_rejects_non_profiles(tmp_path):
    c, _ = client(tmp_path)
    assert c.put("/api/profile", content=b"{oops").status_code == 400
    assert c.put("/api/profile", json={"hello": 1}).status_code == 400


def test_ctc_decode_collapses_repeats_and_blanks():
    r = PhonemeRecognizer("fake")
    r._id_to_token = {0: "<pad>", 1: "ð", 2: "ɪ", 3: "s"}
    r._blank = 0
    r._skip = {0}
    assert r.decode_ids([0, 1, 1, 0, 2, 2, 2, 0, 0, 3, 3]) == ["ð", "ɪ", "s"]
    # a blank between two identical tokens keeps both
    assert r.decode_ids([3, 0, 3]) == ["s", "s"]


def test_prepare_trims_silence_and_normalizes():
    silence = np.zeros(16000, dtype=np.float32)
    tone = (0.1 * np.sin(np.linspace(0, 400 * np.pi, 16000))).astype(np.float32)
    out = prepare(np.concatenate([silence, tone, silence]))
    assert len(out) < 16000 * 1.5
    assert abs(np.max(np.abs(out)) - 0.9) < 1e-3


def test_read_wav_stereo_to_mono():
    buf = io.BytesIO()
    sf.write(buf, np.zeros((8000, 2), dtype=np.float32), 16000, format="WAV")
    assert read_wav(buf.getvalue()).ndim == 1


def test_summary_text():
    assert summarize(None)["started"] is False
    p = {
        "day": 1,
        "course": [{"kind": "lesson", "lesson": "alveolar-td", "completedAt": "x"}, {"kind": "lesson", "lesson": "v-w"}],
        "assessment": {"overall": 62, "lessons": {"alveolar-td": {"score": 40}, "v-w": {"score": 55}, "f": {"score": 100}}},
        "history": [{"overall": 50}, {"overall": 62}],
        "streak": {"count": 3},
    }
    s = summarize(p)
    assert s["weakest"][0] == "T and D (not curled)"
    assert "F (not Ph)" in s["strongest"]
    assert s["next"] == "V vs W"
    assert "+12" in s["text"] and "3 days" in s["text"]
