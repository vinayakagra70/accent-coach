import * as api from "../api";
import { engine } from "../listen/engine";
import { h } from "./dom";

const MB = 242;
const PRIVACY = "Your recordings are sent to Accent Coach's checker, used once, and not stored.";

/**
 * Shows whether the "ears" are ready.
 *  - Laptop: whether the Python speech engine is running.
 *  - Phone, on-device: asks before the one-time 242 MB download, shows progress.
 *  - Phone, online: checks recordings on the online listener (for phones without
 *    the memory to run the model); it may need a minute to wake up.
 * Phones can switch between the two. Returns a stop function.
 */
export function mountEngineGate(host: HTMLElement, onReady: (ready: boolean) => void): () => void {
  let stopCurrent: () => void = () => undefined;
  const render = () => {
    stopCurrent();
    stopCurrent = !api.STATIC ? laptop(host, onReady) : api.listenMode() === "online" ? online(host, onReady) : device(host, onReady);
  };
  render();
  const unsub = api.onListenModeChange(render);
  return () => {
    unsub();
    stopCurrent();
  };
}

function line(host: HTMLElement) {
  const p = h("p", { class: "engine wait" }, "Checking the speech engine…");
  const actions = h("div", { class: "row" });
  const note = h("p", { class: "note", hidden: "" });
  host.replaceChildren(h("div", { class: "engine-gate" }, p, note, actions));
  return {
    show(text: string, cls: "ok" | "wait" | "bad") {
      p.textContent = text;
      p.className = `engine ${cls}`;
    },
    note(text: string | null) {
      note.hidden = !text;
      note.textContent = text ?? "";
    },
    actions(...btns: (HTMLElement | null)[]) {
      actions.replaceChildren(...btns.filter((b): b is HTMLElement => !!b));
    },
  };
}

function switchButton(to: api.ListenMode, label: string, primary = false) {
  const b = h("button", { class: primary ? "btn small" : "linklike" }, label);
  b.onclick = () => api.setListenMode(to);
  return b;
}

function device(host: HTMLElement, onReady: (ready: boolean) => void): () => void {
  const ui = line(host);
  const goOnline = api.ONLINE_URL ? switchButton("online", "Phone low on memory? Check recordings online instead") : null;
  const download = h("button", { class: "btn small" }, `Download it (${MB} MB, once)`);
  download.onclick = () => engine.load();
  let stopped = false;
  const unsub = engine.subscribe((s) => {
    if (stopped) return;
    if (s.ready) {
      ui.show("Speech engine ready (runs on this device)", "ok");
      ui.note(null);
      ui.actions();
      onReady(true);
    } else if (s.error) {
      ui.show(s.error, "bad");
      ui.note(api.ONLINE_URL ? PRIVACY : null);
      const retry = h("button", { class: "linklike" }, "Try on this device again");
      retry.onclick = () => engine.load();
      ui.actions(api.ONLINE_URL ? switchButton("online", "Check recordings online instead", true) : null, retry);
      onReady(false);
    } else if (s.loading) {
      ui.show(s.progress > 0 && s.progress < 1 ? `Downloading the speech engine… ${Math.round(s.progress * 100)}%` : "Starting the speech engine…", "wait");
      ui.actions();
      onReady(false);
    } else if (s.cached) {
      engine.load(); // already on this device: no download, just start it
    } else {
      ui.show(`To hear you, Accent Coach downloads a ${MB} MB speech model once. After that it works offline. Use Wi-Fi if you can.`, "wait");
      ui.actions(download, goOnline);
      onReady(false);
    }
  });
  engine.checkCached();
  return () => {
    stopped = true;
    unsub();
  };
}

function online(host: HTMLElement, onReady: (ready: boolean) => void): () => void {
  const ui = line(host);
  ui.note(PRIVACY);
  let stopped = false;
  let tries = 0;
  const tick = async () => {
    if (stopped) return;
    const s = await api.health();
    if (stopped) return;
    tries++;
    if (s.ready) {
      ui.show("Checking recordings online", "ok");
      ui.actions(switchButton("device", "Use this device instead"));
      onReady(true);
      return;
    }
    onReady(false);
    if (s.error) ui.show(`The online checker has a problem: ${s.error}`, "bad");
    else if (!s.reachable && tries > 40) ui.show("Can't reach the online checker. Check your internet connection.", "bad");
    else ui.show("Waking up the online checker… the first time can take up to 2 minutes.", "wait");
    ui.actions(switchButton("device", "Use this device instead"));
    setTimeout(tick, 3000);
  };
  void tick();
  return () => {
    stopped = true;
  };
}

function laptop(host: HTMLElement, onReady: (ready: boolean) => void): () => void {
  const ui = line(host);
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const s = await api.health();
    if (stopped) return;
    if (s.ready) {
      ui.show("Speech engine ready", "ok");
      onReady(true);
      return;
    }
    onReady(false);
    if (!s.reachable) ui.show("Speech engine isn't running. Start the app with start.bat (it starts both parts).", "bad");
    else if (s.error) ui.show(`Speech engine failed to load: ${s.error}`, "bad");
    else ui.show("Speech engine is loading (about 30 seconds the first time)…", "wait");
    setTimeout(tick, 2000);
  };
  void tick();
  return () => {
    stopped = true;
  };
}
