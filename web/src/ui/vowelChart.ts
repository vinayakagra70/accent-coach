import { VOWEL_FORMANTS } from "../content/lessons";
import { vowelPoint, type ChartPoint, type VoiceType } from "../audio/mirror";

/** The vowel "map": front ↔ back across, close ↔ open down, with the user's live trail. */
export class VowelChart {
  private ctx: CanvasRenderingContext2D;
  private trail: ChartPoint[] = [];
  target: string | null = null;
  habit: string | null = null;
  voice: VoiceType = "low";

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  push(p: ChartPoint | null) {
    if (p) this.trail.push(p);
    if (this.trail.length > 40 || (!p && this.trail.length)) this.trail.shift();
    this.draw();
  }

  clear() {
    this.trail = [];
    this.draw();
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pad = 22;
    // chart x: front on the LEFT (as in the IPA chart), so flip
    const X = (p: ChartPoint) => pad + (1 - p.x) * (w - 2 * pad);
    const Y = (p: ChartPoint) => pad + p.y * (h - 2 * pad);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue("--muted").trim() || "#8b9bb4";
    const line = css.getPropertyValue("--line").trim() || "#253149";

    g.strokeStyle = line;
    g.lineWidth = 1;
    g.strokeRect(pad, pad, w - 2 * pad, h - 2 * pad);
    g.fillStyle = muted;
    g.font = "11px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText("front", pad + 2, pad - 7);
    g.textAlign = "right";
    g.fillText("back", w - pad - 2, pad - 7);
    g.save();
    g.translate(10, h / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = "center";
    g.fillText("tongue high → low", 0, 0);
    g.restore();

    g.font = "15px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const k of Object.keys(VOWEL_FORMANTS)) {
      const p = vowelPoint(k, this.voice)!;
      const isT = k === this.target;
      const isH = k === this.habit && !isT;
      if (isT || isH) {
        g.beginPath();
        g.arc(X(p), Y(p), isT ? 22 : 16, 0, Math.PI * 2);
        g.fillStyle = isT ? "rgba(94, 234, 212, 0.18)" : "rgba(251, 146, 60, 0.16)";
        g.fill();
        g.strokeStyle = isT ? "#5eead4" : "#fb923c";
        g.setLineDash(isT ? [] : [4, 3]);
        g.stroke();
        g.setLineDash([]);
      }
      g.fillStyle = isT ? "#5eead4" : isH ? "#fb923c" : muted;
      g.fillText(k, X(p), Y(p));
    }

    // trail
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const a = (i + 1) / this.trail.length;
      g.beginPath();
      g.arc(X(p), Y(p), i === this.trail.length - 1 ? 7 : 3, 0, Math.PI * 2);
      g.fillStyle = `rgba(125, 211, 252, ${a})`;
      g.fill();
    }
  }
}
