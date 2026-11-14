"""The "Indian habit" clips: one example word per lesson, said the way the habit makes it sound.

    .venv\\Scripts\\python.exe -m tools.habit_voice

Writes web/public/audio/habit/<lesson id>.mp3 from web/src/content/habits.json and
prints what the speech model hears in each, as a check.

Kokoro's English voices can't be made to say a word the Indian way (they drift
back to the normal pronunciation), so the word is written in Devanagari, the
way it's borrowed into Hindi ("time" = टाइम, with the curled-back T), and read
by one of Kokoro's Hindi voices. That gives the real habit: no puff on P, J for
Z, a tapped R, PH for F. The dropped R of "car" is simply a British voice.
The voice for each word is the one the speech model heard most clearly.
"""
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HABITS = ROOT / "web" / "src" / "content" / "habits.json"
OUT = ROOT / "web" / "public" / "audio" / "habit"


def main() -> None:
    import soundfile as sf

    from server.recognizer import PhonemeRecognizer, read_wav
    from server.tts import KokoroTTS

    tts = KokoroTTS()
    tts._load()
    assert tts.ready, tts.error
    rec = PhonemeRecognizer()
    rec._load()
    assert rec.ready, rec.error
    OUT.mkdir(parents=True, exist_ok=True)
    habits = json.loads(HABITS.read_text(encoding="utf-8"))
    for f in OUT.glob("*.mp3"):
        if f.stem not in habits:
            f.unlink()
    for lesson, h in habits.items():
        audio, rate = tts._kokoro.create(h["say"], voice=h["voice"], speed=0.9, lang=h["lang"])
        sf.write(OUT / f"{lesson}.mp3", audio, rate, format="MP3")
        wav = io.BytesIO()
        sf.write(wav, audio, rate, format="WAV", subtype="PCM_16")
        heard = " ".join(rec.recognize(read_wav(wav.getvalue())).phonemes)
        print(f"{lesson:14} {h['word']:6} {h['voice']:9} {len(audio) / rate:.2f}s  heard /{heard}/".encode("ascii", "backslashreplace").decode(), flush=True)


if __name__ == "__main__":
    main()
