/**
 * An articulatory pose: everything the 3D mouth needs to show one sound.
 *
 * Coordinates are a mid-sagittal (side cut-away) plane in centimetres:
 * +x points out of the face, +y points up, the tip of the upper front teeth
 * is (0, 0). Tongue points are given in this fixed head frame, so a pose
 * says *where the tongue must be*, independent of how far the jaw opened.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export type Airflow =
  | "none"
  | "vowel" // smooth, unobstructed
  | "fricative" // continuous hiss through a narrow gap
  | "stop" // build up, then burst
  | "nasal" // out through the nose
  | "approximant"; // smooth but shaped

export interface Pose {
  /** 0 = teeth together, 1 = wide open. */
  jaw: number;
  /** 0 = spread/neutral lips, 1 = fully rounded and pushed forward. */
  lipRound: number;
  /** 0 = lips apart, 1 = lips pressed together (p, b, m). */
  lipClose: number;
  /** 0 = normal, 1 = lower lip lifted to the upper teeth (f, v). */
  labiodental: number;
  /** Tongue tip. */
  tip: Vec2;
  /** Highest point of the tongue body (dorsum). */
  body: Vec2;
  /** 0 = flat tip, 1 = tip curled back (retroflex). */
  curl: number;
  /** 0 = soft palate raised (air through mouth), 1 = lowered (air through nose). */
  velum: number;
  /** Voice box buzzing. */
  voiced: boolean;
  airflow: Airflow;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const REST: Pose = {
  jaw: 0.08,
  lipRound: 0,
  lipClose: 0.2,
  labiodental: 0,
  tip: v(-0.45, -0.55),
  body: v(-2.9, 0.55),
  curl: 0,
  velum: 0.6,
  voiced: false,
  airflow: "none",
};

export function makePose(p: Partial<Pose>): Pose {
  return {
    ...REST,
    velum: 0,
    ...p,
    tip: p.tip ?? REST.tip,
    body: p.body ?? REST.body,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Moves `cur` toward `target` by fraction t (continuous parts only). */
export function blendPose(cur: Pose, target: Pose, t: number): Pose {
  return {
    jaw: lerp(cur.jaw, target.jaw, t),
    lipRound: lerp(cur.lipRound, target.lipRound, t),
    lipClose: lerp(cur.lipClose, target.lipClose, t),
    labiodental: lerp(cur.labiodental, target.labiodental, t),
    tip: lerpV(cur.tip, target.tip, t),
    body: lerpV(cur.body, target.body, t),
    curl: lerp(cur.curl, target.curl, t),
    velum: lerp(cur.velum, target.velum, t),
    voiced: target.voiced,
    airflow: target.airflow,
  };
}

export function clonePose(p: Pose): Pose {
  return { ...p, tip: { ...p.tip }, body: { ...p.body } };
}
