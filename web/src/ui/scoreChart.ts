/** Voice-test scores over time: a small line with the score written on each point. */

const NS = "http://www.w3.org/2000/svg";
const MAX_POINTS = 10;

function s(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** Where each score sits in a w×h box. Exported for the tests. */
export function layout(scores: number[], w: number, h: number, pad = { x: 16, top: 22, bottom: 20 }): { x: number; y: number }[] {
  const lo = Math.max(0, Math.min(...scores) - 8);
  const hi = Math.min(100, Math.max(...scores) + 8);
  const span = Math.max(1, hi - lo);
  const step = scores.length > 1 ? (w - 2 * pad.x) / (scores.length - 1) : 0;
  return scores.map((v, i) => ({
    x: scores.length > 1 ? pad.x + i * step : w / 2,
    y: pad.top + (1 - (v - lo) / span) * (h - pad.top - pad.bottom),
  }));
}

/** null when there's only one test: one point isn't a trend. */
export function scoreChart(history: { date: string; overall: number }[]): SVGElement | null {
  const tests = history.slice(-MAX_POINTS);
  if (tests.length < 2) return null;
  const W = 320;
  const H = 104;
  const pts = layout(tests.map((t) => t.overall), W, H);
  const first = tests[0];
  const last = tests[tests.length - 1];
  const svg = s("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "score-chart",
    role: "img",
    "aria-label": `Voice-test scores, oldest to newest: ${tests.map((t) => t.overall).join(", ")}.`,
  });
  svg.append(s("polyline", { class: "line", points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") }));
  pts.forEach((p, i) => {
    const isLast = i === pts.length - 1;
    svg.append(s("circle", { class: isLast ? "dot now" : "dot", cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: isLast ? 4 : 3 }));
    svg.append(s("text", { class: isLast ? "val now" : "val", x: p.x.toFixed(1), y: (p.y - 8).toFixed(1), "text-anchor": "middle" }, String(tests[i].overall)));
  });
  svg.append(s("text", { class: "when", x: pts[0].x - 8, y: H - 4, "text-anchor": "start" }, shortDate(first.date)));
  svg.append(s("text", { class: "when", x: pts[pts.length - 1].x + 8, y: H - 4, "text-anchor": "end" }, shortDate(last.date)));
  return svg;
}
