import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.phonemize import Phonemizer, PhonemizerNotReady, label_groups, split_words
from server.profile_store import ProfileStore
from server.tests.test_server import FakeRecognizer


def test_split_words_keeps_apostrophes_and_splits_hyphens():
    assert split_words("Dr. Smith's car isn't thirty-three!") == ["Dr", "Smith's", "car", "isn't", "thirty", "three"]
    assert split_words("  ...  ") == []


def test_label_groups_one_to_one():
    assert label_groups(["the", "water"], ["ðə", "wˈɔːɾɚ"], []) == [{"text": "the", "ipa": "ðə"}, {"text": "water", "ipa": "wˈɔːɾɚ"}]


def test_label_groups_finds_words_espeak_ran_together():
    words = ["I", "think", "of", "the", "water"]
    groups = ["aɪ", "θˈɪŋk", "ʌvðə", "wˈɔːɾɚ"]
    singles = ["aɪ", "θɪŋk", "ʌv", "ðə", "wɔːɾɚ"]
    assert [w["text"] for w in label_groups(words, groups, singles)] == ["I", "think", "of the", "water"]


def test_label_groups_join_at_the_end_and_the_start():
    assert [w["text"] for w in label_groups(["go", "to", "the"], ["ɡoʊ", "təðə"], ["ɡoʊ", "tuː", "ðə"])] == ["go", "to the"]
    assert [w["text"] for w in label_groups(["of", "the", "car"], ["ʌvðə", "kˈɑːɹ"], ["ʌv", "ðə", "kɑːɹ"])] == ["of the", "car"]


def test_label_groups_more_groups_than_words_gives_one_unlabelled_run():
    assert label_groups(["33"], ["θˈɜːɾi", "θɹˈiː"], ["θɜːɾiθɹiː"]) == [{"text": "33", "ipa": "θˈɜːɾi θɹˈiː"}]


class FakePhonemizer(Phonemizer):
    def __init__(self, ok=True):
        super().__init__()
        self.ok = ok
        self.calls = []

    def _raw(self, text, lang):
        if not self.ok:
            raise PhonemizerNotReady("no espeak")
        self.calls.append((text, lang))
        return {"the water": "ðə wˈɔːɾɚ.", "of the car": "ʌvðə kˈɑːɹ", "of": "ʌv", "the": "ðə", "car": "kˈɑːɹ"}[text.lower()]


def client(tmp_path, ph):
    return TestClient(create_app(recognizer=FakeRecognizer(), store=ProfileStore(tmp_path / "p.json"), load_model=False, phonemizer=ph))


def test_phonemize_endpoint(tmp_path):
    ph = FakePhonemizer()
    c = client(tmp_path, ph)
    r = c.post("/api/phonemize", json={"text": "  The   water. ", "lang": "en-us"})
    assert r.status_code == 200
    assert r.json() == {"words": [{"text": "The", "ipa": "ðə"}, {"text": "water", "ipa": "wˈɔːɾɚ"}]}
    assert ph.calls == [("The water", "en-us")]
    # an unknown language falls back to American
    c.post("/api/phonemize", json={"text": "the water", "lang": "fr"})
    assert ph.calls[-1] == ("the water", "en-us")
    assert [w["text"] for w in c.post("/api/phonemize", json={"text": "of the car"}).json()["words"]] == ["of the", "car"]


def test_phonemize_endpoint_errors(tmp_path):
    c = client(tmp_path, FakePhonemizer())
    assert c.post("/api/phonemize", json={"text": "?!"}).status_code == 400
    assert c.post("/api/phonemize", content=b"nope").status_code == 400
    assert c.post("/api/phonemize", content=b"x" * 20000).status_code == 413
    assert client(tmp_path, FakePhonemizer(ok=False)).post("/api/phonemize", json={"text": "the water"}).status_code == 503


def test_real_espeak_if_installed():
    """The real phonemizer, where kokoro-onnx is installed (it is wherever the voice works)."""
    pytest.importorskip("kokoro_onnx")
    us = Phonemizer().words("I think of the water.", "en-us")
    assert [w["text"] for w in us] == ["I", "think", "of the", "water"]
    assert us[1]["ipa"] == "θˈɪŋk" and "ɾ" in us[3]["ipa"]
    gb = Phonemizer().words("water", "en-gb")
    assert "t" in gb[0]["ipa"] and "ɾ" not in gb[0]["ipa"]
