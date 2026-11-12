import * as api from "../api";
import { engine } from "../listen/engine";
import { h } from "./dom";

const MB = 242;

/**
 * Shows whether the "ears" are ready. On the phone build it asks before the
 * one-time 242 MB download (and shows progress); on the laptop it reports
 * whether the Python speech engine is running. Returns a stop function.
 */
export function mountEngineGate(host: HTMLElement, onReady: (ready: boolean) => void): () => void {
  let stop = false;
  const line = h("p", { class: "engine wait" }, "Checking the speech engine…");
  const btn = h("button", { class: "btn small", hidden: "" }, `Download it (${MB} MB, once)`) as HTMLButtonElement;
  btn.onclick = () => {
    btn.hidden = true;
    engine.load();
  };
  host.replaceChildren(h("div", { class: "engine-gate" }, line, btn));

  const show = (text: string, cls: "ok" | "wait" | "bad") => {
    line.textContent = text;
    line.className = `engine ${cls}`;
  };

  if (api.STATIC) {
    const unsub = engine.subscribe((s) => {
      if (stop) return;
      if (s.ready) {
        show("Speech engine ready (runs on this device)", "ok");
        btn.hidden = true;
        onReady(true);
      } else if (s.error) {
        show(`Couldn't load the speech engine: ${s.error}`, "bad");
        btn.textContent = "Try again";
        btn.hidden = false;
        onReady(false);
      } else if (s.loading) {
        show(s.progress > 0 && s.progress < 1 ? `Downloading the speech engine… ${Math.round(s.progress * 100)}%` : "Starting the speech engine…", "wait");
        onReady(false);
      } else if (s.cached) {
        engine.load(); // already on this device: no download, just start it
      } else {
        show(`To hear you, Accent Coach downloads a ${MB} MB speech model once. After that it works offline. Use Wi-Fi if you can.`, "wait");
        btn.hidden = false;
        onReady(false);
      }
    });
    engine.checkCached();
    return () => {
      stop = true;
      unsub();
    };
  }

  const tick = async () => {
    if (stop) return;
    const s = await api.health();
    if (stop) return;
    if (s.ready) {
      show("Speech engine ready", "ok");
      onReady(true);
      return;
    }
    onReady(false);
    if (!s.reachable) show("Speech engine isn't running. Start the app with start.bat (it starts both parts).", "bad");
    else if (s.error) show(`Speech engine failed to load: ${s.error}`, "bad");
    else show("Speech engine is loading (about 30 seconds the first time)…", "wait");
    setTimeout(tick, 2000);
  };
  void tick();
  return () => {
    stop = true;
  };
}
