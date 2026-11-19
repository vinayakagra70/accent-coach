"""The "Indian habit" clips: one example word per lesson, said the way the habit makes it sound.

    .venv\\Scripts\\python.exe -m tools.habit_voice              (all)
    .venv\\Scripts\\python.exe -m tools.habit_voice weak-words   (just one lesson)

Writes web/public/audio/habit/<lesson id>.mp3 from web/src/content/habits.json and
prints what the speech model hears in each, as a check.

Kokoro's English voices can't be made to say a word the Indian way (they drift
back to the normal pronunciation), so the word is written in Devanagari, the
way it's borrowed into Hindi ("time" = टाइम, with the curled-back T), and read
by one of Kokoro's Hindi voices. That gives the real habit: no puff on P, J for
Z, a tapped R, PH for F. The dropped R of "car" is simply a British voice.
The voice for each word is the one the speech model heard most clearly.

Where the lesson's sound can be said in one short syllable ("ta"), that is a
clip of its own: web/public/audio/sound/<lesson>-<target>.mp3 for the model
voice and habit/<lesson>-sound.mp3 for the habit. The app plays the sound for
the two views of the mouth and keeps the word for the word comparison. Stops need the vowel; the
vowels, R, L and the flap only show in a word, so those lessons have no "sound".
"""
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HABITS = ROOT / "web" / "src" / "content" / "habits.json"
OUT = ROOT / "web" / "public" / "audio" / "habit"
SOUNDS = ROOT / "web" / "public" / "audio" / "sound"
# One model voice for both accents: these consonants are the same in American and British,
# and the British voice garbles a syllable said alone (the speech model hears "fa" as "isad").
MODEL = ("af_heart", "en-us")
SOUND_VOICE = "hf_beta"  # the Hindi voice whose single syllables the speech model hears most cleanly


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
    def alone(text: str, voice: str, lang: str, phonemes: bool, path: Path, label: str) -> None:
        audio, rate = tts._kokoro.create(text, voice=voice, speed=0.85, lang=lang, is_phonemes=phonemes)
        one = io.BytesIO()
        sf.write(one, audio, rate, format="WAV", subtype="PCM_16")
        heard = " ".join(rec.recognize(read_wav(one.getvalue())).phonemes)
        sf.write(path, audio, rate, format="MP3")
        print(f"{label:28} {len(audio) / rate:.2f}s  heard /{heard}/".encode("ascii", "backslashreplace").decode(), flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    SOUNDS.mkdir(parents=True, exist_ok=True)
    habits = json.loads(HABITS.read_text(encoding="utf-8"))
    only = set(sys.argv[1:])  # lesson ids: remake just these clips and keep the rest
    if only:
        habits = {k: v for k, v in habits.items() if k in only}
    else:
        for f in [*OUT.glob("*.mp3"), *SOUNDS.glob("*.mp3")]:
            f.unlink()
    for lesson, h in habits.items():
        if "sound" in h:
            for i, ph in enumerate(h["sound"]["targets"]):
                alone(ph, MODEL[0], MODEL[1], True, SOUNDS / f"{lesson}-{i}.mp3", f"{lesson} target {i}")
            alone(h["sound"]["habit"], SOUND_VOICE, "hi", False, OUT / f"{lesson}-sound.mp3", f"{lesson} habit sound")
        audio, rate = tts._kokoro.create(h["say"], voice=h["voice"], speed=0.9, lang=h["lang"])
        sf.write(OUT / f"{lesson}.mp3", audio, rate, format="MP3")
        wav = io.BytesIO()
        sf.write(wav, audio, rate, format="WAV", subtype="PCM_16")
        heard = " ".join(rec.recognize(read_wav(wav.getvalue())).phonemes)
        print(f"{lesson:14} {h['word']:6} {h['voice']:9} {len(audio) / rate:.2f}s  heard /{heard}/".encode("ascii", "backslashreplace").decode(), flush=True)


if __name__ == "__main__":
    main()
