import { VOWEL_FORMANTS } from "../content/lessons";
import { PHONEME_POSES } from "../mouth/phonemes";
import { makePose, type Pose } from "../mouth/pose";

export type VoiceType = "low" | "high";

const F1_RANGE = { low: [250, 850], high: [290, 1000] } as const;
const F2_RANGE = { low: [800, 2400], high: [880, 2900] } as const;

/** Position on the vowel chart, 0..1. x: 0 = back, 1 = front. y: 0 = close, 1 = open. */
export interface ChartPoint {
  x: number;
  y: number;
}

export function toChart(f1: number, f2: number, voice: VoiceType): ChartPoint {
  const [a1, b1] = F1_RANGE[voice];
  const [a2, b2] = F2_RANGE[voice];
  const y = (Math.log(f1) - Math.log(a1)) / (Math.log(b1) - Math.log(a1));
  const x = (Math.log(f2) - Math.log(a2)) / (Math.log(b2) - Math.log(a2));
  return { x: Math.min(1.05, Math.max(-0.05, x)), y: Math.min(1.05, Math.max(-0.05, y)) };
}

export function vowelPoint(vowel: string, voice: VoiceType): ChartPoint | null {
  const f = VOWEL_FORMANTS[vowel];
  if (!f) return null;
  const [f1, f2] = f[voice];
  return toChart(f1, f2, voice);
}

const ANCHORS = Object.keys(VOWEL_FORMANTS).filter((k) => PHONEME_POSES[k] && k !== "ɝ");

/** Guess the mouth pose that produced this vowel, by blending the nearest known vowels. */
export function poseFromFormants(f1: number, f2: number, voice: VoiceType): Pose {
  const p = toChart(f1, f2, voice);
  const near = ANCHORS.map((k) => {
    const q = vowelPoint(k, voice)!;
    return { k, d: Math.hypot(p.x - q.x, p.y - q.y) };
  })
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  let wsum = 0;
  const acc = { jaw: 0, lipRound: 0, tx: 0, ty: 0, bx: 0, by: 0 };
  for (const n of near) {
    const w = 1 / Math.max(0.0004, n.d * n.d);
    const q = PHONEME_POSES[n.k];
    wsum += w;
    acc.jaw += q.jaw * w;
    acc.lipRound += q.lipRound * w;
    acc.tx += q.tip.x * w;
    acc.ty += q.tip.y * w;
    acc.bx += q.body.x * w;
    acc.by += q.body.y * w;
  }
  return makePose({
    jaw: acc.jaw / wsum,
    lipRound: acc.lipRound / wsum,
    tip: { x: acc.tx / wsum, y: acc.ty / wsum },
    body: { x: acc.bx / wsum, y: acc.by / wsum },
    airflow: "vowel",
    voiced: true,
  });
}

/** 0..100: how close the user's vowel is to the target. */
export function vowelScore(f1: number, f2: number, target: string, voice: VoiceType): number {
  const t = vowelPoint(target, voice);
  if (!t) return 0;
  const p = toChart(f1, f2, voice);
  const d = Math.hypot(p.x - t.x, p.y - t.y);
  return Math.round(100 * Math.max(0, 1 - d / 0.35));
}

/** Tips in plain words from where the user landed relative to the target. */
export function vowelHint(f1: number, f2: number, target: string, voice: VoiceType): string {
  const t = vowelPoint(target, voice);
  if (!t) return "";
  const p = toChart(f1, f2, voice);
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  if (Math.hypot(dx, dy) < 0.08) return "That's it. Hold that shape.";
  const parts: string[] = [];
  if (dy > 0.06) parts.push("open your jaw more");
  if (dy < -0.06) parts.push("close your jaw a little / raise your tongue");
  if (dx > 0.06) parts.push("push your tongue forward (smile a little)");
  if (dx < -0.06) parts.push("pull your tongue back (round your lips a little)");
  const s = parts.join(" and ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
