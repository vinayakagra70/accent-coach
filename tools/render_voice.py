"""Pre-render Nova's voice and the model words with Kokoro, as MP3 clips for the phone build.

    .venv\\Scripts\\python.exe -m tools.render_voice <utterances.json>

Writes web/public/audio/<key>.mp3 and web/public/audio/manifest.json. Clips
that already exist are kept, so re-running after a content change only renders
what's new; clips no longer listed are deleted.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "audio"
VOICE = {"us": ("af_heart", "en-us"), "uk": ("bf_emma", "en-gb")}
SPEED = {"normal": 0.95, "slow": 0.75}


def main() -> None:
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro

    entries = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    kd = ROOT / "models" / "kokoro"
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 6
    k = Kokoro.from_session(ort.InferenceSession(str(kd / "kokoro-v1.0.onnx"), opts, providers=["CPUExecutionProvider"]), str(kd / "voices-v1.0.bin"))

    keys = {e["key"] for e in entries}
    for f in OUT.glob("*.mp3"):
        if f.stem not in keys:
            f.unlink()
    todo = [e for e in entries if not (OUT / f"{e['key']}.mp3").exists()]
    print(f"{len(entries)} clips, {len(todo)} to render")
    t0 = time.time()
    for n, e in enumerate(todo, 1):
        voice, lang = VOICE[e["accent"]]
        speed = 1.0 if e["kind"] == "line" else SPEED[e["speed"]]
        audio, rate = k.create(e["text"], voice=voice, speed=speed, lang=lang)
        sf.write(OUT / f"{e['key']}.mp3", audio, rate, format="MP3")
        if n % 100 == 0:
            print(f"  {n}/{len(todo)}  {time.time() - t0:.0f}s")
    (OUT / "manifest.json").write_text(json.dumps({"clips": sorted(keys)}), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.glob("*.mp3")) / 1e6
    print(f"done: {len(keys)} clips, {size:.1f} MB")


if __name__ == "__main__":
    main()
