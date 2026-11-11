import { v, type Vec2 } from "./pose";

/**
 * Fixed anatomy in the mid-sagittal plane (cm). The face looks toward +x.
 * Shapes are closed outlines; MouthScene smooths and extrudes them.
 */

/** Underside of the hard palate, front to back. Tongue contact points are placed on this. */
export const PALATE_UNDERSIDE: Vec2[] = [
  v(-0.3, 0.7),
  v(-0.55, 0.92),
  v(-0.9, 1.05),
  v(-1.4, 1.3),
  v(-2.2, 1.6),
  v(-3.2, 1.68),
  v(-4.4, 1.45),
];

export function palateY(x: number): number {
  const p = PALATE_UNDERSIDE;
  if (x >= p[0].x) return p[0].y;
  for (let i = 1; i < p.length; i++) {
    if (x >= p[i].x) {
      const a = p[i - 1];
      const b = p[i];
      const t = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return p[p.length - 1].y;
}

/** Hard palate + upper gum (maxilla), between the nasal floor and the mouth roof. */
export const PALATE: Vec2[] = [
  v(0.42, 0.8),
  v(0.52, 1.55),
  v(0.3, 1.95),
  v(-2.0, 1.98),
  v(-4.3, 1.95),
  ...PALATE_UNDERSIDE.slice().reverse(),
];

/** Skull, nose and forehead above the nasal cavity. */
export const HEAD_UPPER: Vec2[] = [
  v(-7.4, 5.6),
  v(0.9, 5.6),
  v(1.15, 4.1),
  v(2.05, 2.35),
  v(1.85, 2.05),
  v(1.42, 2.1),
  v(0.7, 2.8),
  v(-1.0, 3.3),
  v(-5.4, 3.3),
  v(-6.3, 2.7),
  v(-7.4, 2.7),
];

/** Back wall of the throat. */
export const PHARYNX_WALL: Vec2[] = [v(-7.4, 2.7), v(-6.3, 2.7), v(-6.35, -1.0), v(-6.3, -6.2), v(-7.4, -6.2)];

/** Front of the voice box, below the tongue root. */
export const LARYNX_FRONT: Vec2[] = [v(-4.95, -3.95), v(-4.35, -4.05), v(-4.25, -6.2), v(-4.95, -6.2)];

/** Upper front tooth (central incisor). */
export const UPPER_INCISOR: Vec2[] = [v(0.15, -0.02), v(0.45, 0.85), v(0.3, 1.2), v(-0.25, 0.95), v(-0.3, 0.7), v(-0.12, 0.08)];

// ---- lower jaw (drawn at jaw = 0; rotated about JAW_PIVOT)

export const JAW_PIVOT = v(-6.8, 1.4);
export const JAW_MAX_ANGLE = 0.24; // radians at jaw = 1

export const LOWER_INCISOR: Vec2[] = [v(-0.3, 0.12), v(-0.2, 0.08), v(-0.05, -0.9), v(-0.12, -1.25), v(-0.45, -0.9), v(-0.5, 0.0)];

export const MANDIBLE: Vec2[] = [
  v(-0.08, -0.55),
  v(0.2, -0.85),
  v(0.5, -1.6),
  v(0.45, -2.6),
  v(0.0, -3.3),
  v(-1.0, -3.6),
  v(-3.5, -3.75),
  v(-5.0, -3.9),
  v(-5.0, -3.05),
  v(-3.2, -2.05),
  v(-1.6, -1.5),
  v(-0.75, -1.2),
  v(-0.48, -0.6),
];

/** Tongue attachment points that ride on the jaw. */
export const TONGUE_FLOOR_FRONT = v(-0.7, -1.12);
export const TONGUE_FLOOR_MID = v(-3.0, -1.95);
export const TONGUE_ROOT_BOTTOM = v(-4.9, -3.0);

/** Named spots the lessons can point at. */
export const LANDMARKS: Record<string, { at: Vec2; text: string; below?: boolean }> = {
  ridge: { at: v(-0.62, 1.0), text: "Alveolar ridge: the bump just behind your top teeth" },
  upperTeeth: { at: v(0.35, 0.6), text: "Upper front teeth" },
  hardPalate: { at: v(-2.9, 1.72), text: "Hard roof of the mouth" },
  softPalate: { at: v(-5.0, 1.1), text: "Soft palate (opens the nose path)", below: true },
  nose: { at: v(-1.5, 2.6), text: "Nasal cavity" },
  voiceBox: { at: v(-5.6, -4.55), text: "Voice box: buzzing = voiced" },
  backOfRoof: { at: v(-3.9, 1.6), text: "Back of the roof" },
};

export function rotateAround(p: Vec2, pivot: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
}
