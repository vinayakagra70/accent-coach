import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  HEAD_UPPER,
  JAW_MAX_ANGLE,
  JAW_PIVOT,
  LANDMARKS,
  LARYNX_FRONT,
  LOWER_INCISOR,
  MANDIBLE,
  PALATE,
  PHARYNX_WALL,
  TONGUE_FLOOR_FRONT,
  TONGUE_FLOOR_MID,
  TONGUE_ROOT_BOTTOM,
  UPPER_INCISOR,
  palateY,
  rotateAround,
} from "./anatomy";
import { REST, blendPose, clonePose, type Pose, type Vec2 } from "./pose";

// ---------------------------------------------------------------- geometry helpers

function smoothClosed(points: Vec2[], samples = 96): THREE.Vector2[] {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, p.y, 0)),
    true,
    "centripetal",
  );
  return curve.getPoints(samples).map((p) => new THREE.Vector2(p.x, p.y));
}

interface ExtrudeOpts {
  depth: number;
  /** z of the front (cut) face. */
  front?: number;
  bevel?: number;
  smooth?: boolean;
}

function extrude(points: Vec2[], o: ExtrudeOpts): THREE.ExtrudeGeometry {
  const pts = o.smooth === false ? points.map((p) => new THREE.Vector2(p.x, p.y)) : smoothClosed(points);
  const shape = new THREE.Shape(pts);
  const bevel = o.bevel ?? 0.06;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: o.depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.translate(0, 0, (o.front ?? 0) - o.depth - bevel);
  return geo;
}

function mats(cap: number, side: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return [
    new THREE.MeshStandardMaterial({ color: cap, roughness: 0.65, metalness: 0, ...opts }),
    new THREE.MeshStandardMaterial({ color: side, roughness: 0.8, metalness: 0, ...opts }),
  ];
}

const COLORS = {
  skin: [0xc99a86, 0x8a5f52],
  bone: [0xd9c6b0, 0x9c8a77],
  jaw: [0xb98d7c, 0x6e4c43],
  tongue: [0xef4f63, 0xa82a3e],
  lip: [0xc7505d, 0x8e2f3b],
  tooth: [0xf4efe2, 0xc9c1ad],
  velum: [0xd8707b, 0x9a4450],
  throat: [0xb9786f, 0x7a4a44],
};

// ---------------------------------------------------------------- dynamic outlines

function jawPoint(p: Vec2, angle: number): Vec2 {
  return rotateAround(p, JAW_PIVOT, angle);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const add = (a: Vec2, x: number, y: number): Vec2 => ({ x: a.x + x, y: a.y + y });

function jawAngle(p: Pose) {
  return -p.jaw * JAW_MAX_ANGLE;
}

export function tongueOutline(p: Pose): Vec2[] {
  const a = jawAngle(p);
  const F = jawPoint(TONGUE_FLOOR_FRONT, a);
  const M = jawPoint(TONGUE_FLOOR_MID, a);
  const Rb = jawPoint(TONGUE_ROOT_BOTTOM, a);
  const T = p.tip;
  const D = p.body;
  const retract = Math.min(0, D.x + 3.3) * 0.55;
  const R = jawPoint({ x: -5.05 + retract, y: -1.55 }, a);
  const K: Vec2 = { x: lerp(D.x, R.x, 0.45), y: lerp(D.y, R.y, 0.4) + 0.3 };

  const c = p.curl;
  const underN = add(T, 0.06, -0.3);
  const underC = add(T, 0.4, -0.18);
  const U = lerpV(underN, underC, c);
  const frontN: Vec2 = { x: lerp(F.x, U.x, 0.5) + 0.12, y: lerp(F.y, U.y, 0.5) };
  const frontC: Vec2 = add(T, 0.65, -0.95);
  const P = lerpV(frontN, frontC, c);
  const bladeN: Vec2 = { x: lerp(T.x, D.x, 0.38), y: Math.max(lerp(T.y, D.y, 0.55) + 0.15, Math.min(T.y, D.y)) };
  const bladeC: Vec2 = add(T, 0.12, -0.5);
  const B = lerpV(bladeN, bladeC, c);
  const dip: Vec2 = { x: lerp(B.x, D.x, 0.5), y: lerp(B.y, D.y, 0.5) - 0.25 * c };

  return [F, P, U, T, B, dip, D, K, R, Rb, M];
}

interface LipOutlines {
  upper: Vec2[];
  lower: Vec2[];
  /** Mid point of the lip opening, where oral air leaves. */
  mouthExit: Vec2;
}

export function lipOutlines(p: Pose): LipOutlines {
  const a = jawAngle(p);
  const prot = 0.45 * p.lipRound;

  // Upper lip edges
  let uO: Vec2 = { x: 1.35 + prot, y: 0.08 };
  let uI: Vec2 = { x: 0.72 + prot * 0.6, y: 0.08 };
  // Lower lip edges (ride the jaw)
  let lO = jawPoint({ x: 1.3 + prot, y: -0.14 }, a);
  let lI = jawPoint({ x: 0.62 + prot * 0.6, y: -0.14 }, a);
  let lBulge = jawPoint({ x: 1.45 + prot, y: -0.75 }, a);

  // Rounding narrows the opening toward its middle.
  const mid = (uO.y + lO.y) / 2;
  const narrow = 0.4 * p.lipRound;
  uO = { ...uO, y: lerp(uO.y, mid + 0.06, narrow) };
  uI = { ...uI, y: lerp(uI.y, mid + 0.06, narrow) };
  lO = { ...lO, y: lerp(lO.y, mid - 0.06, narrow) };
  lI = { ...lI, y: lerp(lI.y, mid - 0.06, narrow) };

  // Closing: both edges meet at a seam.
  const seam = lerp(0.02, mid, 0.5);
  const k = p.lipClose;
  uO = lerpV(uO, { x: uO.x, y: seam + 0.02 }, k);
  uI = lerpV(uI, { x: uI.x, y: seam + 0.02 }, k);
  lO = lerpV(lO, { x: lO.x, y: seam - 0.02 }, k);
  lI = lerpV(lI, { x: lI.x, y: seam - 0.02 }, k);

  // Lip-to-teeth (f, v): lower lip tucks up under the upper teeth.
  const ld = p.labiodental;
  lI = lerpV(lI, { x: 0.18, y: -0.02 }, ld);
  lO = lerpV(lO, { x: 0.8, y: -0.06 }, ld);
  lBulge = lerpV(lBulge, { x: 1.15, y: -0.55 }, ld);
  uO = lerpV(uO, add(uO, 0, 0.18), ld);
  uI = lerpV(uI, add(uI, 0, 0.18), ld);

  const upper: Vec2[] = [
    { x: 0.5, y: 1.5 },
    { x: 1.3, y: 1.98 },
    { x: 1.55 + prot, y: 0.95 },
    uO,
    uI,
    { x: 0.48, y: 0.45 },
  ];
  const lower: Vec2[] = [
    jawPoint({ x: 0.18, y: -0.85 }, a),
    lI,
    lO,
    lBulge,
    jawPoint({ x: 0.9, y: -1.45 }, a),
    jawPoint({ x: 0.3, y: -1.2 }, a),
  ];
  const exitX = Math.max(uO.x, lO.x) + 0.1;
  return { upper, lower, mouthExit: { x: exitX, y: (uO.y + lO.y) / 2 } };
}

function velumOutline(p: Pose): Vec2[] {
  const top: Vec2 = { x: -4.3, y: 1.85 };
  const bottom: Vec2 = { x: -4.4, y: 1.45 };
  const tip = lerpV({ x: -6.05, y: 1.9 }, { x: -5.25, y: 0.35 }, p.velum);
  const upMid = add(lerpV(top, tip, 0.5), 0, 0.2 * (1 - p.velum));
  const lowMid = add(lerpV(bottom, tip, 0.5), 0.05, -0.1);
  return [top, upMid, tip, lowMid, bottom];
}

// ---------------------------------------------------------------- airflow path

function airPath(p: Pose, exit: Vec2): { points: Vec2[]; constrictionX: number } {
  const glottis: Vec2 = { x: -5.6, y: -4.3 };
  if (p.airflow === "nasal") {
    return {
      points: [glottis, { x: -5.75, y: -2.0 }, { x: -5.75, y: 0.4 }, { x: -5.85, y: 2.35 }, { x: -4.0, y: 2.6 }, { x: -1.0, y: 2.65 }, { x: 0.7, y: 2.4 }, { x: 1.75, y: 2.0 }, { x: 2.6, y: 1.8 }],
      constrictionX: 99,
    };
  }
  const T = p.tip;
  const D = p.body;
  const overBody: Vec2 = { x: D.x, y: (D.y + palateY(D.x)) / 2 + 0.05 };
  const overTip: Vec2 = T.x > 0
    ? { x: T.x, y: T.y + 0.12 }
    : { x: T.x + 0.1, y: Math.max(T.y + 0.1, (T.y + palateY(T.x)) / 2) };
  const pts: Vec2[] = [glottis, { x: -5.75, y: -2.0 }, { x: -5.4, y: 0.35 }];
  if (overBody.x < overTip.x - 0.4) pts.push(overBody);
  pts.push(overTip, exit, { x: exit.x + 1.3, y: exit.y - 0.1 });

  // Where the air is blocked/squeezed, for stop build-up and fricative hiss.
  let cx: number;
  if (p.lipClose > 0.5) cx = exit.x - 0.4;
  else if (p.labiodental > 0.5) cx = 0.4;
  else if (T.y > palateY(T.x) - 0.45 || T.x > 0) cx = T.x;
  else cx = D.x;
  return { points: pts, constrictionX: cx };
}

// ---------------------------------------------------------------- the scene

export interface LabelSpec {
  key: string;
  at?: Vec2;
  text?: string;
}

const PARTICLES = 140;

export class MouthScene {
  readonly renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();

  private current: Pose = clonePose(REST);
  private target: Pose = clonePose(REST);
  private ghost: Pose | null = null;
  /** Higher = snappier. Slow-motion lowers it. */
  speed = 9;
  private externalDrive = false;

  private jawGroup = new THREE.Group();
  private tongue: THREE.Mesh;
  private ghostTongue: THREE.Mesh;
  private ghostLine: THREE.LineLoop;
  private upperLip: THREE.Mesh;
  private lowerLip: THREE.Mesh;
  private velum: THREE.Mesh;
  private folds: THREE.Mesh;
  private contact: THREE.Mesh;
  private contactAt: Vec2 | null = null;
  private labels: CSS2DObject[] = [];
  private tipLabel: CSS2DObject | null = null;

  private particles: THREE.Points;
  private particleT = new Float32Array(PARTICLES);
  private particleJitter = new Float32Array(PARTICLES * 2);
  private lastKey = "";

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "label-layer";
    host.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
    this.camera.position.set(-1.6, 0.3, 30);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-2.2, -0.4, -1.0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 60;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xfff4ee, 0x1a2338, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(6, 8, 10);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
    rim.position.set(-8, 2, -6);
    this.scene.add(rim);

    // static anatomy
    this.addStatic(HEAD_UPPER, COLORS.skin, 4.2, 0);
    this.addStatic(PALATE, COLORS.bone, 3.6, 0.02);
    this.addStatic(PHARYNX_WALL, COLORS.throat, 4.0, 0, false);
    this.addStatic(LARYNX_FRONT, COLORS.throat, 2.4, 0);
    this.addStatic(UPPER_INCISOR, COLORS.tooth, 0.8, 0.05, true, 0.04);
    // upper molars sit off the midline, so they show "behind" the cut
    for (let i = 0; i < 3; i++) {
      const x0 = -2.7 - i * 0.85;
      this.addStatic(
        [{ x: x0, y: 0.6 }, { x: x0 - 0.75, y: 0.6 }, { x: x0 - 0.75, y: 1.45 }, { x: x0, y: 1.45 }],
        COLORS.tooth, 0.8, -2.2, true, 0.08,
      );
    }

    // lower jaw (rotates as a unit)
    this.jawGroup.position.set(JAW_PIVOT.x, JAW_PIVOT.y, 0);
    const toPivot = (pts: Vec2[]) => pts.map((p) => ({ x: p.x - JAW_PIVOT.x, y: p.y - JAW_PIVOT.y }));
    this.jawGroup.add(new THREE.Mesh(extrude(toPivot(MANDIBLE), { depth: 3.6, front: 0 }), mats(COLORS.jaw[0], COLORS.jaw[1])));
    this.jawGroup.add(new THREE.Mesh(extrude(toPivot(LOWER_INCISOR), { depth: 0.7, front: 0.05, bevel: 0.04 }), mats(COLORS.tooth[0], COLORS.tooth[1])));
    for (let i = 0; i < 3; i++) {
      const x0 = -2.7 - i * 0.85;
      const pts = toPivot([{ x: x0, y: -0.2 }, { x: x0 - 0.75, y: -0.2 }, { x: x0 - 0.75, y: -1.05 }, { x: x0, y: -1.05 }]);
      this.jawGroup.add(new THREE.Mesh(extrude(pts, { depth: 0.8, front: -2.2, bevel: 0.08 }), mats(COLORS.tooth[0], COLORS.tooth[1])));
    }
    this.scene.add(this.jawGroup);

    // dynamic soft parts
    this.tongue = new THREE.Mesh(new THREE.BufferGeometry(), mats(COLORS.tongue[0], COLORS.tongue[1]));
    this.upperLip = new THREE.Mesh(new THREE.BufferGeometry(), mats(COLORS.lip[0], COLORS.lip[1]));
    this.lowerLip = new THREE.Mesh(new THREE.BufferGeometry(), mats(COLORS.lip[0], COLORS.lip[1]));
    this.velum = new THREE.Mesh(new THREE.BufferGeometry(), mats(COLORS.velum[0], COLORS.velum[1]));
    this.ghostTongue = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x8db87a, transparent: true, opacity: 0.1, depthWrite: false, depthTest: false }),
    );
    this.ghostTongue.renderOrder = 5;
    this.ghostLine = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8db87a, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.ghostLine.renderOrder = 6;
    this.scene.add(this.tongue, this.upperLip, this.lowerLip, this.velum, this.ghostTongue, this.ghostLine);

    // vocal folds
    this.folds = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xf2a65a, emissive: 0xf2a65a, emissiveIntensity: 0.1 }),
    );
    this.folds.rotation.z = Math.PI / 2;
    this.folds.position.set(-5.6, -4.45, 0.15);
    this.scene.add(this.folds);

    // contact glow
    this.contact = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.contact.renderOrder = 10;
    this.contact.visible = false;
    this.scene.add(this.contact);

    // airflow
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    this.particles = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.11, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.particles.renderOrder = 8;
    for (let i = 0; i < PARTICLES; i++) {
      this.particleT[i] = Math.random();
      this.particleJitter[i * 2] = Math.random() * 2 - 1;
      this.particleJitter[i * 2 + 1] = Math.random() * 2 - 1;
    }
    this.scene.add(this.particles);

    this.rebuild(true);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ public API

  setTarget(p: Pose) {
    this.target = clonePose(p);
    this.externalDrive = false;
  }

  /** Mirror mode: drive the tongue every frame from outside (e.g. the microphone). */
  drive(p: Pose) {
    this.target = clonePose(p);
    this.externalDrive = true;
  }

  setGhost(p: Pose | null) {
    this.ghost = p ? clonePose(p) : null;
    this.lastKey = "";
  }

  setContact(at: Vec2 | null) {
    this.contactAt = at;
    this.contact.visible = !!at;
  }

  setLabels(specs: LabelSpec[]) {
    for (const l of this.labels) {
      l.removeFromParent();
      l.element.remove();
    }
    this.labels = [];
    this.tipLabel = null;
    for (const s of specs) {
      const lm = LANDMARKS[s.key];
      const at = s.at ?? lm?.at;
      const text = s.text ?? lm?.text;
      if (!text) continue;
      const el = document.createElement("div");
      // Labels sit above or below their point with a leader line, so they don't cover the mouth.
      const dir = s.key === "tip" || s.key === "voiceBox" || lm?.below ? "down" : "up";
      el.className = `label3d ${dir}`;
      el.dataset.key = s.key;
      el.dataset.index = String(this.labels.length);
      const box = document.createElement("span");
      box.textContent = text;
      el.append(box);
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, dir === "up" ? 1 : 0);
      if (s.key === "tip") this.tipLabel = obj;
      else if (at) obj.position.set(at.x, at.y, 0.2);
      this.scene.add(obj);
      this.labels.push(obj);
    }
  }

  /** Plays poses in sequence. Resolves when done. */
  async play(steps: { pose: Pose; dur: number }[], slow = 1, onStep?: (i: number) => void) {
    for (let i = 0; i < steps.length; i++) {
      onStep?.(i);
      this.setTarget(steps[i].pose);
      await new Promise((r) => setTimeout(r, steps[i].dur * 1000 * slow));
    }
  }

  /** A turned view that shows depth (teeth rows, cheek). */
  resetView() {
    this.camera.position.set(6, 3, 30);
    this.controls.target.set(-2.2, -0.4, -1.0);
    this.controls.update();
  }

  sideView() {
    this.camera.position.set(-1.6, 0.3, 30);
    this.controls.target.set(-2.2, -0.4, -1.0);
    this.controls.update();
  }

  // ------------------------------------------------------------ internals

  private addStatic(points: Vec2[], color: number[], depth: number, front: number, smooth = true, bevel = 0.06) {
    const m = new THREE.Mesh(extrude(points, { depth, front, smooth, bevel }), mats(color[0], color[1]));
    this.scene.add(m);
    return m;
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private replace(mesh: THREE.Mesh, geo: THREE.BufferGeometry) {
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  private rebuild(force = false) {
    const p = this.current;
    const key = JSON.stringify([p.jaw, p.lipRound, p.lipClose, p.labiodental, p.tip, p.body, p.curl, p.velum].map((n) =>
      typeof n === "number" ? n.toFixed(3) : `${n.x.toFixed(3)},${n.y.toFixed(3)}`)) + (this.ghost ? "g" : "");
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    this.jawGroup.rotation.z = jawAngle(p);
    this.replace(this.tongue, extrude(tongueOutline(p), { depth: 2.0, front: 0, bevel: 0.12 }));
    const lips = lipOutlines(p);
    this.replace(this.upperLip, extrude(lips.upper, { depth: 2.6, front: 0.02, bevel: 0.1 }));
    this.replace(this.lowerLip, extrude(lips.lower, { depth: 2.6, front: 0.02, bevel: 0.1 }));
    this.replace(this.velum, extrude(velumOutline(p), { depth: 2.4, front: 0.01, bevel: 0.08 }));
    if (this.ghost) {
      const outline = tongueOutline(this.ghost);
      this.replace(this.ghostTongue, extrude(outline, { depth: 0.05, front: 0.35, bevel: 0 }));
      const pts = smoothClosed(outline).map((q) => new THREE.Vector3(q.x, q.y, 0.4));
      this.ghostLine.geometry.dispose();
      this.ghostLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.ghostTongue.visible = true;
      this.ghostLine.visible = true;
    } else {
      this.ghostTongue.visible = false;
      this.ghostLine.visible = false;
    }
    if (this.tipLabel) this.tipLabel.position.set(p.tip.x, p.tip.y - 0.2, 0.3);
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * (this.externalDrive ? 14 : this.speed));
    this.current = blendPose(this.current, this.target, k);
    this.rebuild();

    // voice box buzz
    const fm = this.folds.material as THREE.MeshStandardMaterial;
    if (this.current.voiced && this.current.airflow !== "none") {
      fm.emissiveIntensity = 0.8 + 0.6 * Math.sin(t * 60);
      this.folds.scale.set(1 + 0.15 * Math.sin(t * 80), 1, 1);
    } else {
      fm.emissiveIntensity = 0.08;
      this.folds.scale.set(1, 1, 1);
    }

    // contact glow
    if (this.contactAt) {
      const s = 1 + 0.35 * Math.sin(t * 5);
      this.contact.scale.setScalar(s);
      this.contact.position.set(this.contactAt.x, this.contactAt.y, 0.4);
    }

    this.updateAir(dt, t);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  private updateAir(dt: number, t: number) {
    const p = this.current;
    const pos = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (p.airflow === "none") {
      this.particles.visible = false;
      return;
    }
    this.particles.visible = true;
    const lips = lipOutlines(p);
    const { points, constrictionX } = airPath(p, lips.mouthExit);
    const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q.x, q.y, 0)), false, "centripetal");

    // param along the curve where the constriction sits
    let tc = 1;
    const samples = curve.getSpacedPoints(60);
    for (let i = 20; i < samples.length; i++) {
      if (samples[i].x >= constrictionX) {
        tc = i / 60;
        break;
      }
    }

    const mat = this.particles.material as THREE.PointsMaterial;
    let speed = 0.35;
    let holdUntil = 2;
    let turbulence = 0.03;
    mat.color.set(0x7dd3fc);
    switch (p.airflow) {
      case "vowel":
        speed = 0.32;
        break;
      case "approximant":
        speed = 0.3;
        turbulence = 0.05;
        break;
      case "nasal":
        speed = 0.3;
        mat.color.set(0xc4b5fd);
        break;
      case "fricative":
        speed = 0.55;
        turbulence = 0.18;
        mat.color.set(0xa5f3fc);
        break;
      case "stop": {
        // build up for 0.7 s, then burst for 0.5 s
        const phase = t % 1.2;
        holdUntil = phase < 0.7 ? tc - 0.01 : 2;
        speed = phase < 0.7 ? 0.35 : 1.6;
        break;
      }
    }

    for (let i = 0; i < PARTICLES; i++) {
      const prev = this.particleT[i];
      let u = prev + dt * speed * (0.7 + 0.6 * ((i * 37) % 10) / 10);
      // air piles up behind a closure; air already past it keeps flowing out
      if (prev <= holdUntil && u > holdUntil) u = holdUntil - Math.random() * 0.04;
      if (u > 1) u -= 1;
      this.particleT[i] = u;
      const q = curve.getPointAt(Math.min(u, 1));
      const after = u > tc ? 1 : 0.25;
      const jx = this.particleJitter[i * 2] * turbulence * after;
      const jy = this.particleJitter[i * 2 + 1] * turbulence * after;
      pos.setXYZ(i, q.x + jx * Math.sin(t * 30 + i), q.y + jy * Math.cos(t * 27 + i), 0.45 + 0.1 * this.particleJitter[i * 2]);
    }
    pos.needsUpdate = true;
  }
}
