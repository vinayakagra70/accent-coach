"""The everyday phrases (web/src/content/phrases.json): how each is pronounced, and what the speech model hears.

    .venv\\Scripts\\python.exe -m tools.phrases            write web/src/content/phrases-ipa.json
    .venv\\Scripts\\python.exe -m tools.phrases --heard    also say each phrase with native Kokoro voices,
                                                         and write web/tests/fixtures/phrases-heard.json

The hosted phone build has no server to ask how a sentence is pronounced, so the
pronunciations are worked out here and shipped with the app. Run this after
changing phrases.json (and `npm run voices` in web/ for the clips). The --heard
fixture is what `npm test` uses to make sure a native voice saying a phrase is
never told it has a habit; a phrase that fails there should be reworded.
"""
import json
import sys
from pathlib import Path

from server.phonemize import Phonemizer

ROOT = Path(__file__).resolve().parent.parent
PHRASES = ROOT / "web" / "src" / "content" / "phrases.json"
IPA = ROOT / "web" / "src" / "content" / "phrases-ipa.json"
HEARD = ROOT / "web" / "tests" / "fixtures" / "phrases-heard.json"

LANG = {"us": "en-us", "uk": "en-gb"}
VOICES = {"us": ["af_heart", "am_michael"], "uk": ["bf_emma", "bm_george"]}


def main() -> None:
    texts = [p for pack in json.loads(PHRASES.read_text(encoding="utf-8")) for p in pack["phrases"]]
    ph = Phonemizer()
    ipa = {accent: {t: ph.words(t, lang) for t in texts} for accent, lang in LANG.items()}
    IPA.write_text(json.dumps(ipa, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(texts)} phrases -> {IPA.relative_to(ROOT)}")

    if "--heard" not in sys.argv:
        return
    from server.recognizer import PhonemeRecognizer, read_wav
    from server.tts import KokoroTTS

    tts = KokoroTTS()
    tts._load()
    assert tts.ready, tts.error
    rec = PhonemeRecognizer()
    rec._load()
    assert rec.ready, rec.error
    heard: dict[str, dict[str, list[str]]] = {}
    for accent, voices in VOICES.items():
        for voice in voices:
            heard[f"{accent}_{voice}"] = {t: rec.recognize(read_wav(tts.speak(t, voice, 0.95, LANG[accent]))).phonemes for t in texts}
            print(accent, voice, "done", flush=True)
    HEARD.write_text(json.dumps(heard, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"-> {HEARD.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
