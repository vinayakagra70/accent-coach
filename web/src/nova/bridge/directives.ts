import type { NovaCommand } from '../core/types';

/**
 * Inline directives let your LLM steer Nova from inside its reply text:
 *
 *   "Oh, that's wonderful! [expression:happy] Tell me more. [motion:TapBody]"
 *
 *   [expression:happy]        [expression:happy:0.6]   (intensity)
 *   [motion:TapBody]          [motion:TapBody:2]       (index)
 *   [state:thinking]          [look:-0.4,0.3]          [clear]
 *
 * Strip them before TTS with stripDirectives(); pass the original text to
 * nova.speak() and each cue fires at its position in the audio.
 */
export interface Cue {
  /** 0..1 position in the utterance. */
  at: number;
  command: NovaCommand;
}

const TAG = /\[(expression|expr|motion|state|look|clear)(?::([^\]]*))?\]/gi;

export function parseDirectives(input: string): { text: string; cues: Cue[] } {
  const raw: { pos: number; command: NovaCommand }[] = [];
  let clean = '';
  let last = 0;
  for (const m of input.matchAll(TAG)) {
    clean += input.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    const command = toCommand(m[1].toLowerCase(), (m[2] ?? '').trim());
    if (command) raw.push({ pos: clean.length, command });
  }
  clean += input.slice(last);
  const len = Math.max(1, clean.length);
  return {
    text: clean.replace(/\s{2,}/g, ' ').trim(),
    cues: raw.map((c) => ({ at: c.pos / len, command: c.command })),
  };
}

export function stripDirectives(input: string): string {
  return parseDirectives(input).text;
}

function toCommand(kind: string, arg: string): NovaCommand | null {
  const parts = arg.split(':');
  switch (kind) {
    case 'expression':
    case 'expr': {
      if (!parts[0]) return null;
      const intensity = parts[1] ? Number(parts[1]) : undefined;
      return { type: 'expression', name: parts[0], intensity: Number.isFinite(intensity) ? intensity : undefined };
    }
    case 'motion': {
      if (!parts[0]) return null;
      const index = parts[1] ? Number(parts[1]) : undefined;
      return { type: 'motion', group: parts[0], index: Number.isInteger(index) ? index : undefined };
    }
    case 'state':
      return parts[0] ? { type: 'state', state: parts[0] } : null;
    case 'look': {
      const [x, y] = arg.split(',').map(Number);
      return Number.isFinite(x) ? { type: 'look', x, y: Number.isFinite(y) ? y : 0, duration: 1500 } : null;
    }
    case 'clear':
      return { type: 'clear_expression' };
    default:
      return null;
  }
}
