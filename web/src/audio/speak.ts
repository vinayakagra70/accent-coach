/**
 * Model pronunciations. Step 1 uses the browser's built-in American voice.
 * Later this can switch to JARVIS's local Kokoro voices (American "af_"/"am_" voices).
 */
let chosen: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang === "en-US" || v.lang === "en_US");
  const prefer = ["Aria", "Jenny", "Guy", "Google US English", "Samantha", "Zira", "David"];
  for (const name of prefer) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return (chosen = v);
  }
  return (chosen = voices[0] ?? null);
}

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => {
    chosen = null;
    pickVoice();
  };
}

export function hasVoice(): boolean {
  return "speechSynthesis" in window;
}

export function voiceName(): string {
  return pickVoice()?.name ?? "no American voice found";
}

export function speak(text: string, rate = 0.9): Promise<void> {
  return new Promise((resolve) => {
    if (!hasVoice()) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = "en-US";
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
