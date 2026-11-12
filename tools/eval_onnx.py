"""Compare browser-sized ONNX phoneme models against the full PyTorch model.

    .venv\\Scripts\\python.exe -m tools.eval_onnx <clips folder> <reference heard.json> <out dir>

For each candidate: phoneme error rate vs the full model on every clip, CPU time,
and a fixture file (heard-<name>.json) the web scoring tests can run against.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.recognizer import MODEL_DIR, prepare, read_wav  # noqa: E402

CANDIDATES = {
    "student-q4": "models/onnx-candidates/air-air/onnx/model_q4.onnx",
    "lv60-q4": "models/onnx-candidates/onnx-community/onnx/model_q4.onnx",
    "lv60-int8": "models/onnx-candidates/onnx-community/onnx/model_int8.onnx",
}


def edit_distance(a: list[str], b: list[str]) -> int:
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[len(b)]


def main() -> None:
    clips, ref_path, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    ref: dict[str, list[str]] = json.loads(ref_path.read_text(encoding="utf-8"))
    vocab = json.loads((MODEL_DIR / "vocab.json").read_text(encoding="utf-8"))
    id2tok = {i: t for t, i in vocab.items()}
    skip = {i for t, i in vocab.items() if t in {"<pad>", "<s>", "</s>", "<unk>", "|"}}

    for name, path in CANDIDATES.items():
        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        heard: dict[str, list[str]] = {}
        errs = total = 0
        secs = 0.0
        for f in sorted(clips.glob("*.wav")):
            a = prepare(read_wav(f.read_bytes()))
            a = (a - a.mean()) / np.sqrt(a.var() + 1e-7)  # Wav2Vec2FeatureExtractor normalization
            x = a[None, :].astype(np.float16 if "float16" in inp.type else np.float32)
            t = time.time()
            feed = {inp.name: x}
            if any(i.name == "attention_mask" for i in sess.get_inputs()):
                feed["attention_mask"] = np.ones(x.shape, dtype=np.int64)
            logits = sess.run(None, feed)[0][0]
            secs += time.time() - t
            ids = logits.argmax(-1).tolist()
            toks, prev = [], -1
            for i in ids:
                if i != prev and i not in skip:
                    toks.append(id2tok[i])
                prev = i
            heard[f.stem] = toks
            if f.stem in ref:
                errs += edit_distance(ref[f.stem], toks)
                total += len(ref[f.stem])
        (out / f"heard-{name}.json").write_text(json.dumps(heard, ensure_ascii=False), encoding="utf-8")
        print(f"{name:11s} size {Path(path).stat().st_size / 1e6:6.0f} MB   PER vs full model {100 * errs / max(1, total):5.1f}%   cpu {secs:5.1f}s for {len(heard)} clips")
        for k in ("us_am_michael_01", "habit_think_dental", "habit_bad_bed"):
            print(f"    {k:20s} {' '.join(heard.get(k, []))}")


if __name__ == "__main__":
    main()
