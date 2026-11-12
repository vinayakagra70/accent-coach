# Accent Coach

General American pronunciation for Indian English speakers, with a 3D cut-away mouth.

Run: double-click `start.bat`. It starts the speech engine (port 5181) and the app (http://127.0.0.1:5180).
Tests: `cd web; npm test` and `.venv\Scripts\python.exe -m pytest server`.

## First-time setup

```
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python.exe -m pip install "transformers>=4.44,<5" fastapi uvicorn soundfile numpy pytest httpx
cd web && npm install
```

The speech model (facebook/wav2vec2-lv-60-espeak-cv-ft, ~1.2 GB) downloads into `models/` on the first start.
It goes there rather than the Hugging Face cache because Windows refuses the cache's symlinks without Developer Mode.

## How a learner uses it

1. Voice test: 13 short phrases, about 3 minutes, or skip it for the standard course.
2. Report: a score out of 100, each flaw with the exact word ("think /t/ for /θ/"), and what's already good.
3. Daily course: one sound a day, worst and most noticeable first. Each day: watch the American way,
   see your habit, train your ear, then say 4 words and get them scored. Every 5 days a check-up re-test re-plans the rest.

JARVIS can read progress from `GET http://127.0.0.1:5181/api/summary` or `data/profile.json`.

## What makes it different

- **Your habit vs the target.** Every sound shows what Indian English speakers usually do (e.g. a curled-back T) next to the American target, with the target drawn as a teal outline over your tongue.
- **Mirror mode (vowels).** Your microphone drives the 3D tongue live. Formants (F1/F2) are read with linear prediction in the browser, so it shows where your tongue *probably* is and how to move it.
- **Ear first.** Minimal-pair listening drills (vine/wine, thin/tin, bad/bed) before speaking.
- **Body cues.** Touch points glow, airflow shows oral / nasal / hiss / burst, and the voice box buzzes when a sound is voiced.

## Layout

```
web/src/mouth/     3D mouth: anatomy.ts (fixed shapes), pose.ts (articulator parameters),
                   phonemes.ts (pose per sound + Indian-English habits), MouthScene.ts (three.js)
web/src/audio/     formants.ts (LPC F1/F2), mirror.ts (formants -> tongue pose, score, hints),
                   mic.ts, speak.ts (browser TTS for now)
web/src/content/   lessons.ts (16 sounds, words, minimal pairs, vowel targets)
web/src/progress.ts  practice history (browser storage for now)
```

## Roadmap

1. **Done:** 3D mouth, 16 lessons, listening drills, live vowel mirror, record & compare.
2. **Next:** local Python scoring server (wav2vec2 phoneme recognizer) so consonants get scored and the 3D mouth shows what you actually said.
3. Progress stored by that server, plus a JARVIS tool: "open my accent coach", "which sounds am I weak on?".
4. Later: Kokoro American voices from JARVIS instead of browser TTS, camera lip tracking, stress and intonation.
