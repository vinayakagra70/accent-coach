/**
 * Vercel Web Analytics: counts visits to the hosted site (no cookies, no names).
 * Only the hosted phone build has it; on the laptop the script doesn't exist.
 * Turn it on in Vercel: project -> Analytics -> Enable.
 */
export function startAnalytics(hosted: boolean): void {
  if (!hosted || typeof document === "undefined") return;
  const w = window as unknown as { va?: (...a: unknown[]) => void; vaq?: unknown[] };
  w.va = w.va || ((...a: unknown[]) => void (w.vaq = w.vaq || []).push(a));
  const s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
}
