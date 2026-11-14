/**
 * A picture of the learner's progress to post or send: drawn on a canvas in the
 * browser, so nothing about them leaves the device unless they share it.
 */

export interface ShareStats {
  accentName: string;
  /** Latest voice-test score, or null when the test was skipped. */
  score: number | null;
  /** Points gained since the first voice test (0 when there's only one). */
  gained: number;
  streak: number;
  daysDone: number;
  soundsClean: number;
  soundsTotal: number;
}

const W = 1080;
const H = 1350;

/** The three small figures under the big one. Exported for the tests. */
export function shareFacts(s: ShareStats): { value: string; label: string }[] {
  return [
    { value: String(s.streak), label: "day streak" },
    { value: String(s.daysDone), label: s.daysDone === 1 ? "day done" : "days done" },
    { value: `${s.soundsClean}/${s.soundsTotal}`, label: "sounds clean" },
  ];
}

/** The line under the big figure. Exported for the tests. */
export function shareHeadline(s: ShareStats): string {
  if (s.score === null) return `Training my ${s.accentName} accent`;
  if (s.gained > 0) return `Up ${s.gained} point${s.gained === 1 ? "" : "s"} since my first voice test`;
  return `My ${s.accentName} accent score`;
}

function draw(s: ShareStats, site: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const sans = '"Instrument Sans", system-ui, sans-serif';

  g.fillStyle = "#141415";
  g.fillRect(0, 0, W, H);
  // a soft green glow behind the figure
  const glow = g.createRadialGradient(W / 2, 520, 40, W / 2, 520, 620);
  glow.addColorStop(0, "rgba(141, 184, 122, 0.22)");
  glow.addColorStop(1, "rgba(141, 184, 122, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  g.textAlign = "center";
  g.fillStyle = "#8db87a";
  g.font = `600 44px ${sans}`;
  g.fillText("Accent Coach", W / 2, 150);

  // the ring: how far the score is toward 100
  const big = s.score === null ? String(s.daysDone) : String(s.score);
  const frac = s.score === null ? 1 : Math.max(0.02, s.score / 100);
  g.lineWidth = 26;
  g.lineCap = "round";
  g.strokeStyle = "rgba(237, 237, 237, 0.08)";
  g.beginPath();
  g.arc(W / 2, 520, 230, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "#8db87a";
  g.beginPath();
  g.arc(W / 2, 520, 230, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  g.stroke();

  g.fillStyle = "#ededed";
  g.font = `600 210px ${sans}`;
  g.fillText(big, W / 2, 575);
  g.fillStyle = "#85858b";
  g.font = `500 40px ${sans}`;
  g.fillText(s.score === null ? (s.daysDone === 1 ? "day done" : "days done") : "out of 100", W / 2, 650);

  g.fillStyle = "#ededed";
  g.font = `500 52px ${sans}`;
  g.fillText(shareHeadline(s), W / 2, 890);

  const facts = shareFacts(s);
  const col = W / facts.length;
  facts.forEach((f, i) => {
    const x = col * i + col / 2;
    g.fillStyle = "#ededed";
    g.font = `600 84px ${sans}`;
    g.fillText(f.value, x, 1070);
    g.fillStyle = "#85858b";
    g.font = `500 34px ${sans}`;
    g.fillText(f.label, x, 1125);
  });

  if (site) {
    g.fillStyle = "#85858b";
    g.font = `500 34px ${sans}`;
    g.fillText(`Try it free: ${site}`, W / 2, 1270);
  }
  return c;
}

/** The address to print on the card: only a real public one, never a laptop's local address. */
function publicSite(): string {
  const host = location.hostname;
  return /^(localhost|127\.|10\.|192\.168\.|172\.)/.test(host) || !host.includes(".") ? "" : location.host;
}

/** Share the card (phones) or save it as a picture (laptops). Resolves to what happened, for the button's label. */
export async function shareProgress(s: ShareStats): Promise<"shared" | "saved" | "cancelled"> {
  const site = publicSite();
  const canvas = draw(s, site);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("this browser couldn't make the picture");
  const file = new File([blob], "accent-coach-progress.png", { type: "image/png" });
  const text = `${shareHeadline(s)}${site ? ` — https://${site}` : ""}`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // sharing refused (some desktop browsers): fall through to saving
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}
