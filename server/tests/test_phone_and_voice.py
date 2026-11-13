import ipaddress

from cryptography import x509
from fastapi.testclient import TestClient

from server import phone
from server.app import create_app
from server.profile_store import ProfileStore
from server.tests.test_server import FakeRecognizer
from server.tts import KokoroTTS, TtsNotReady


class FakeTTS(KokoroTTS):
    def __init__(self, ready=True):
        super().__init__()
        self._ok = ready
        self.calls = []

    @property
    def ready(self):
        return self._ok

    def speak(self, text, voice="af_heart", speed=1.0, lang=None):
        if not self._ok:
            raise TtsNotReady("loading")
        self.calls.append((text, voice, speed) if lang is None else (text, voice, speed, lang))
        return b"RIFF....WAVE"


def make(tmp_path, key=None, client=("testclient", 5000), tts=None):
    app = create_app(recognizer=FakeRecognizer(), store=ProfileStore(tmp_path / "p.json"), tts=tts or FakeTTS(), load_model=False, access_key=key)
    return TestClient(app, client=client)


def test_speak_returns_wav(tmp_path):
    tts = FakeTTS()
    c = make(tmp_path, tts=tts)
    r = c.post("/api/speak", json={"text": "think", "voice": "am_michael", "speed": 0.9})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert tts.calls == [("think", "am_michael", 0.9)]


def test_speak_passes_british_language(tmp_path):
    tts = FakeTTS()
    make(tmp_path, tts=tts).post("/api/speak", json={"text": "water", "voice": "bf_emma", "lang": "en-gb"})
    assert tts.calls == [("water", "bf_emma", 1.0, "en-gb")]


def test_speak_errors(tmp_path):
    c = make(tmp_path, tts=FakeTTS(ready=False))
    assert c.post("/api/speak", json={"text": "hi"}).status_code == 503
    c = make(tmp_path)
    assert c.post("/api/speak", json={"text": "  "}).status_code == 400
    assert c.post("/api/speak", content=b"nope").status_code == 400
    assert c.post("/api/speak", json={"text": "hi", "speed": "fast"}).status_code == 400
    assert c.post("/api/speak", json={"text": "hi", "speed": None}).status_code == 400
    assert c.post("/api/speak", content=b'{"text": "hi", "speed": NaN}').status_code == 400
    assert c.post("/api/speak", json={"text": "a" * 20000}).status_code == 413


def test_health_reports_voice(tmp_path):
    assert make(tmp_path).get("/api/health").json()["voice"]["ready"] is True


def test_wifi_device_without_key_is_refused(tmp_path):
    c = make(tmp_path, key="k" * 24, client=("192.168.1.50", 5000))
    assert c.get("/api/health").status_code == 403
    assert c.get("/api/profile").status_code == 403
    assert c.post("/api/speak", json={"text": "hi"}).status_code == 403


def test_wifi_device_with_key_gets_cookie_then_access(tmp_path):
    key = "k" * 24
    c = make(tmp_path, key=key, client=("192.168.1.50", 5000))
    r = c.get(f"/api/health?key={key}", follow_redirects=False)
    assert r.status_code == 303 and "key=" not in r.headers["location"]
    assert "ac_key" in r.headers.get("set-cookie", "")
    c.cookies.set("ac_key", key)
    assert c.get("/api/health").status_code == 200


def test_wrong_key_refused(tmp_path):
    c = make(tmp_path, key="k" * 24, client=("192.168.1.50", 5000))
    assert c.get("/api/health?key=wrong", follow_redirects=False).status_code == 403
    c.cookies.set("ac_key", "wrong")
    assert c.get("/api/health").status_code == 403


def test_laptop_itself_needs_no_key(tmp_path):
    assert make(tmp_path, key="k" * 24, client=("127.0.0.1", 5000)).get("/api/health").status_code == 200


def test_cert_covers_wifi_ip_and_is_reused(tmp_path, monkeypatch):
    monkeypatch.setattr(phone, "CERT_DIR", tmp_path / "certs")
    cert, _ = phone.ensure_cert("192.168.1.23")
    c = x509.load_pem_x509_certificate(cert.read_bytes())
    ips = c.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress)
    assert ipaddress.ip_address("192.168.1.23") in ips
    first = cert.read_bytes()
    phone.ensure_cert("192.168.1.23")
    assert cert.read_bytes() == first  # same IP: reused
    phone.ensure_cert("10.0.0.7")
    assert cert.read_bytes() != first  # new IP: remade


def test_access_key_is_stable(tmp_path, monkeypatch):
    monkeypatch.setattr(phone, "KEY_FILE", tmp_path / "k.txt")
    a = phone.access_key()
    assert len(a) >= 16 and phone.access_key() == a
