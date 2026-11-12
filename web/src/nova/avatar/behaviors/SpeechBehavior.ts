import type { NovaConfig } from '../../config';
import { approach } from '../../util/math';
import type { Behavior, BehaviorContext } from './Behavior';

/** Lip-sync from the analysed speech level, plus small head emphasis on loud syllables. */
export class SpeechBehavior implements Behavior {
  readonly name = 'speech';
  private envelope = 0;

  constructor(private readonly cfg: NovaConfig['lipSync']) {}

  update({ dt, frame, inputs }: BehaviorContext): void {
    const s = inputs.speech;
    this.envelope = approach(this.envelope, s.active ? 1 : 0, 12, dt);
    if (this.envelope < 0.001) return;

    frame.set('mouthOpen', s.level * this.cfg.maxOpen, this.envelope);
    if (this.cfg.shape) frame.add('mouthForm', s.shape * 0.45 * this.envelope);
    frame.add('angleY', s.level * 3 * this.envelope);
  }
}
