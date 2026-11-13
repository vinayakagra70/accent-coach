# Accent Coach

General American or British pronunciation for Indian English speakers, with a 3D cut-away mouth.

Run: double-click `start.bat`. It starts the speech engine (port 5181) and the app (http://127.0.0.1:5180).
Tests: `cd web; npm test` and `.venv\Scripts\python.exe -m pytest server`.

## First-time setup

Needs Python 3.12 and Node.js. Then run once:

```
powershell -ExecutionPolicy Bypass -File setup.ps1
```

It installs the Python and web packages and fetches what can't go in git:

| Part | Licence | Where it comes from |
|---|---|---|
| Kokoro voice (`models/kokoro`) | Apache 2.0 | copied from NOVA if present, else downloaded from kokoro-onnx's releases |
| Live2D Cubism Core (`web/public`) | Live2D Proprietary Software License | copied from JARVIS if present, else downloaded from Live2D |
| Character (`web/public/models`) | Live2D Free Material License | the recoloured Hiyori from JARVIS if present, else Live2D's original Hiyori |
| Speech model (`models/wav2vec2-…`, ~1.2 GB) | Apache 2.0 | downloads itself on the first start |

The speech model goes into `models/` rather than the Hugging Face cache because Windows refuses the cache's symlinks without Developer Mode.

Before publishing the app (a website, a store), read Live2D's terms: the Cubism SDK release licence and the Free Material License decide whether you may ship Cubism Core and Hiyori. Your own character avoids the question.

## On a phone (same Wi-Fi)

Double-click `start-phone.bat` on the laptop and scan the QR code it shows.

- Phones only allow the microphone on HTTPS, so the laptop makes its own certificate (`certs/`). The phone warns once that the connection isn't private: tap Advanced, then Proceed (Chrome), or Show Details, then visit (Safari).
- The link contains an access key (`data/phone_key.txt`). Devices without it get nothing, not even the page. Delete that file to make a new key.
- If Windows asks whether Python may use the network, allow Private networks.
- The laptop does the listening and talking, so it must be on, with the window open.

## The coach

Nova, NOVA's Live2D character, sits at the top of the lesson panel and talks with Kokoro (af_heart). She explains the sound, says every model word with lip-sync, gives short spoken feedback after each scored word, and reads the report score. The speaker button turns her voice off (captions stay, model words still play). The engine is copied from JARVIS's GUI into `web/src/nova/`.

## How a learner uses it

1. Voice test: 13 short phrases, about 3 minutes, or skip it for the standard course.
2. Report: a score out of 100, each flaw with the exact word ("think /t/ for /θ/"), and what's already good.
3. Daily course: one sound a day, worst and most noticeable first. Each day: watch the American way,
   see your habit, train your ear, say 4 words and get them scored, then say the sound in a short
   sentence. Every 5 days a check-up re-test re-plans the rest.
4. Review: a word said with a habit comes back the next day, then 2 and 4 days later, until it has
   been clean on three different days.

JARVIS can read progress from `GET http://127.0.0.1:5181/api/summary` or `data/profile.json`.

## What makes it different

- **Your habit vs the target.** Every sound shows what Indian English speakers usually do (e.g. a curled-back T) next to the American target, with the target drawn as a teal outline over your tongue.
- **Mirror mode (vowels).** Your microphone drives the 3D tongue live. Formants (F1/F2) are read with linear prediction in the browser, so it shows where your tongue *probably* is and how to move it.
- **Ear first.** Minimal-pair listening drills (vine/wine, thin/tin, bad/bed) before speaking.
- **Body cues.** Touch points glow, airflow shows oral / nasal / hiss / burst, and the voice box buzzes when a sound is voiced.

## Three ways it runs

| | Listening (speech model) | Voice | Progress |
|---|---|---|---|
| Laptop (`start.bat`) | Python server on the laptop | Kokoro on the laptop | `data/profile.json` + the browser |
| Phone on the same Wi-Fi (`start-phone.bat`) | the laptop | the laptop | the laptop, shared with the laptop's browser |
| Phone build (`npm run build:phone`, hosted) | in the phone's browser (242 MB download, once), or the online listener in `space/` for phones without the memory | pre-rendered clips | that phone only |

Progress made on one device shows up on the other: the server numbers every save, and a
copy that is out of date (a phone tab left open while you practised on the laptop) is
refused and replaced with the current one instead of overwriting it.

## Layout

```
web/src/main.ts      the app: lesson panel, cards, course flow
web/src/mouth/       3D mouth: anatomy.ts (fixed shapes), pose.ts (articulator parameters),
                     phonemes.ts (pose per sound + Indian-English habits), MouthScene.ts (three.js)
web/src/audio/       formants.ts (LPC F1/F2), mirror.ts (formants -> tongue pose, score, hints),
                     mic.ts, recorder.ts (a phrase, stopped by silence), speak.ts (model words)
web/src/content/     lessons.ts (16 sounds, words, minimal pairs, vowel targets),
                     british.ts + accent.ts (the British version of each), assessment.ts (voice-test phrases),
                     sentences.ts (one practice sentence per lesson)
web/src/review.ts    words to come back to, and when
web/src/scoring/     align.ts (what was heard vs what was expected), checks.ts (the habits looked for
                     per sound), report.ts (voice test -> score and findings)
web/src/course.ts    the profile: voice-test results, the daily course, streak
web/src/progress.ts  listening and vowel-mirror results per lesson (saved inside the profile)
web/src/api.ts       where listening and saving happen in each of the three setups
web/src/listen/      the speech model in the browser (phone build): engine.ts, worker.ts
web/src/coach.ts     Nova: what she says and when; speech/lines.ts has every line
web/src/nova/        her Live2D engine (copied from JARVIS)
web/src/ui/          onboarding.ts (voice test and report), engineGate.ts, vowelChart.ts
server/              app.py (the API), recognizer.py (wav2vec2 phonemes), tts.py (Kokoro),
                     profile_store.py, phone.py (HTTPS + access key for phones on the Wi-Fi)
space/               the online listener, a Hugging Face Space
tools/               render_voice.py (pre-render Nova's lines for the phone build), eval_onnx.py
```

## Roadmap

**Done:** 3D mouth, 16 lessons in General American and British, listening drills, live vowel
mirror, voice test and personal daily course, sound-by-sound scoring with the wav2vec2
recognizer, a scored sentence per lesson, spaced review of missed words, Kokoro voices, Nova, phone use (same Wi-Fi, and a hosted build that runs offline),
progress shared between devices, JARVIS summary.

**Not yet:**

1. Stress and rhythm: everything is scored one word at a time, and word stress
   ("deVElopment") is a large part of an Indian-English accent.
2. Scoring for dark L and aspiration, which are compare-by-ear for now.
3. A chart of voice-test scores over time (the history is already saved).
4. Camera lip tracking.
