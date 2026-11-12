---
title: Accent Coach Listener
emoji: 🎙️
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: Phoneme recognition for the Accent Coach web app
---

# Accent Coach listener

Backend for [Accent Coach](https://accent-coach-smoky.vercel.app) on phones that can't run the
speech model in the browser. It turns a short recording into the IPA phonemes heard, using
[facebook/wav2vec2-lv-60-espeak-cv-ft](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft)
(Apache 2.0). Recordings are processed in memory and never stored.

- `GET /health`: is the model loaded?
- `POST /recognize`: 16 kHz 16-bit mono WAV (up to about 30 s), returns `{"phonemes": [...]}`.

Browser calls are only accepted from the Accent Coach site; uploads are size-capped and
rate-limited per visitor.
