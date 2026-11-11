# Accent Coach

General American pronunciation for Indian English speakers, with a 3D cut-away mouth.

Run: double-click `start.bat` (or `cd web; npm install; npm run dev`), then open http://127.0.0.1:5180.
Tests: `cd web; npm test`.

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
