/**
 * Model pronunciations: Kokoro's American voice from the local server (with the
 * coach's lip-sync), or the browser's own voice when the server isn't running.
 * `rate` keeps the old browser-TTS meaning (0.7 slow … 0.9 natural).
 */
import { sayWord } from "../coach";
import { accentInfo } from "../content/accent";

export function hasVoice(): boolean {
  return true;
}

export function voiceName(): string {
  const a = accentInfo();
  return `Kokoro (${a.name}, ${a.voice}), or the browser voice if the server is off`;
}

export function speak(text: string, rate = 0.9): Promise<void> {
  // Kokoro speaks naturally at 1.0; map the old browser rates onto it.
  return sayWord(text, Math.max(0.7, Math.min(1.1, rate / 0.9)));
}
