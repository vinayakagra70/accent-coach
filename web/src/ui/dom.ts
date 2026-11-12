/** Tiny element builder. Text is always inserted as text nodes, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (val === undefined) continue;
    if (k === "class") el.className = val;
    else el.setAttribute(k, val);
  }
  for (const c of children) if (c != null && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
