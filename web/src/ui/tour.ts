/**
 * A spotlight tour: dims the page, lights up one part at a time, and shows what
 * Nova says about it in a card with Next and Skip. Steps whose part isn't on
 * the screen (a lesson without ear training, say) are left out.
 */
import { h } from "./dom";

export interface TourStep {
  /** The part of the page to light up. */
  target: () => HTMLElement | null;
  /** What Nova says about it (also shown in the card). */
  text: string;
}

const SEEN_KEY = "accentCoach.tourSeen";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private window: the tour may show again, which is harmless */
  }
}

let stopCurrent: (() => void) | null = null;

/** Runs the tour. `say` speaks a line; `quiet` stops speaking. Returns a stop function. */
export function runTour(all: TourStep[], opts: { say: (text: string) => void; quiet: () => void; onEnd?: () => void }): () => void {
  stopCurrent?.();
  const steps = all.filter((s) => s.target());
  if (!steps.length) return () => undefined;
  markSeen();

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spot = h("div", { class: "tour-spot", "aria-hidden": "true" });
  const count = h("p", { class: "tour-count" });
  const text = h("p", { class: "tour-text" });
  const skip = h("button", { class: "linklike" }, "Skip tour");
  const next = h("button", { class: "btn primary small" }, "Next") as HTMLButtonElement;
  const tip = h("div", { class: "tour-tip", role: "dialog", "aria-modal": "false", "aria-label": "How today works" },
    h("p", { class: "tour-who" }, "Nova"), text, h("div", { class: "row spread" }, count, h("div", { class: "row" }, skip, next)));
  document.body.append(spot, tip);
  if (reduce) spot.classList.add("still");

  let i = -1;
  let target: HTMLElement | null = null;

  const place = () => {
    if (!target || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    const pad = 8;
    // keep the frame on the screen even when the part is taller than it
    const top = Math.max(4, r.top - pad);
    const bottom = Math.min(innerHeight - 4, r.bottom + pad);
    spot.style.transform = `translate(${Math.round(r.left - pad)}px, ${Math.round(top)}px)`;
    spot.style.width = `${Math.round(r.width + pad * 2)}px`;
    spot.style.height = `${Math.max(0, Math.round(bottom - top))}px`;
    // the card goes to whichever half of the screen the part isn't in
    tip.classList.toggle("at-top", r.top + r.height / 2 > innerHeight / 2);
  };

  const show = (n: number) => {
    i = n;
    const s = steps[i];
    target = s.target();
    if (!target) return stop();
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    text.textContent = s.text;
    count.textContent = `${i + 1} of ${steps.length}`;
    next.textContent = i === steps.length - 1 ? "Let's start" : "Next";
    place();
    opts.say(s.text);
    next.focus({ preventScroll: true });
  };

  let frame = 0;
  const follow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };

  /** `hush`: stop Nova too (skipping); finishing lets her end her last line. */
  function end(hush = true) {
    removeEventListener("scroll", follow, true);
    removeEventListener("resize", follow);
    removeEventListener("keydown", onKey);
    cancelAnimationFrame(frame);
    spot.remove();
    tip.remove();
    if (stopCurrent === stop) stopCurrent = null;
    if (hush) opts.quiet();
    opts.onEnd?.();
  }
  const stop = () => end();

  next.onclick = () => (i + 1 < steps.length ? show(i + 1) : end(false));
  skip.onclick = stop;
  addEventListener("scroll", follow, true);
  addEventListener("resize", follow);
  addEventListener("keydown", onKey);
  stopCurrent = stop;
  show(0);
  return stop;
}
