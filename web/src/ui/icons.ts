import { ArrowRight, Bell, Check, CircleQuestionMark, createElement, Mic, Settings, Play, RotateCcw, Square, Volume2, VolumeX, type IconNode } from "lucide";

/** One icon set, one size, one stroke; icons take the color of their text. */
function icon(node: IconNode, size = 16): SVGElement {
  const el = createElement(node, { width: size, height: size, "stroke-width": 1.5, "aria-hidden": "true" });
  el.classList.add("icon");
  return el;
}

export const icons = {
  mic: () => icon(Mic),
  play: () => icon(Play),
  stop: () => icon(Square),
  check: (size = 16) => icon(Check, size),
  listen: () => icon(Volume2),
  muted: () => icon(VolumeX),
  again: () => icon(RotateCcw),
  next: () => icon(ArrowRight),
  bell: () => icon(Bell),
  help: () => icon(CircleQuestionMark),
  settings: () => icon(Settings),
};

/** The product's signature: a sound written as an IPA tag, like /θ/. */
export function ipa(sym: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ipa-tag";
  el.textContent = `/${sym}/`;
  return el;
}
