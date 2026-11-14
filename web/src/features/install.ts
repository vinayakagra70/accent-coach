import "./install.css";

/**
 * "Add to home screen" hint.
 * - Chrome, Edge, Samsung Internet: the browser fires `beforeinstallprompt`; we keep
 *   it and show a button that opens the browser's own install dialog.
 * - iOS Safari has no such event: show the one-line instruction instead.
 * - Nothing is shown when the app already runs from the home screen, or after the
 *   person has dismissed the hint once.
 */
const DISMISSED = "ac.installHint.dismissed";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let pending: InstallPromptEvent | null = null;
let onReady: (() => void) | null = null;

// The event can fire before the hint is mounted, so listen from the moment this file loads.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // we show our own button instead of the browser's banner
  pending = e as InstallPromptEvent;
  onReady?.();
});

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function iosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

export function mountInstallHint(container: HTMLElement): void {
  if (standalone() || dismissed()) return;

  const box = document.createElement("div");
  box.className = "install-hint";
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", "Add to home screen");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "linklike install-hint-close";
  close.textContent = "Not now";

  const remove = () => {
    onReady = null;
    box.remove();
  };
  close.addEventListener("click", () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode: it will simply show again next time */
    }
    remove();
  });
  window.addEventListener("appinstalled", remove);

  if (iosSafari()) {
    const line = document.createElement("p");
    line.textContent = "To install: tap Share, then Add to Home Screen";
    box.append(line, close);
    container.append(box);
    return;
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn small";
  add.textContent = "Add to home screen";
  add.addEventListener("click", async () => {
    const ev = pending;
    if (!ev) return;
    pending = null; // a prompt can be used only once
    add.disabled = true;
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch {
      /* the browser refused to show it */
    }
    remove(); // installed or declined: either way, stop asking in this visit
  });
  box.append(add, close);

  const show = () => {
    if (!box.isConnected) container.append(box);
  };
  if (pending) show();
  else onReady = show;
}
