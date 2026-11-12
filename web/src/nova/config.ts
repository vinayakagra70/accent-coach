import type { ExpressionDefinition, ParamMap, StateDefinition } from './core/types';
import { normalizeState } from './core/StateMachine';
import { deepMerge, type DeepPartial } from './util/math';

export interface NovaConfig {
  model: {
    /** Path to your *.model3.json (relative to index.html). Override at runtime with ?model= */
    url: string;
    /** 1 fits the whole model in the viewport; >1 crops in (e.g. 1.8 for a bust shot). */
    zoom: number;
    /** Vertical position of the model's centre, as a fraction of viewport height. */
    anchorY: number;
    /** Where the face sits, as a fraction of model height from the top. Used for gaze and the aura. */
    headY: number;
  };
  /** Parameter ids in your model. Defaults follow the Cubism standard parameter list. */
  params: ParamMap;
  states: Record<string, StateDefinition>;
  expressions: Record<string, ExpressionDefinition>;
  lipSync: {
    /** Multiplies RMS loudness into mouth openness. Raise if the mouth barely moves. */
    gain: number;
    /** RMS below this counts as silence. */
    noiseFloor: number;
    /** How fast the mouth opens / closes (per second). */
    attack: number;
    release: number;
    /** Max value written to the mouth-open parameter. */
    maxOpen: number;
    /** Estimate mouth shape (wide vs round) from the spectrum. */
    shape: boolean;
  };
  gaze: {
    /** Mouse tracking stops this long after the pointer stops moving. */
    pointerTimeoutMs: number;
    eyeRate: number;
    headRate: number;
    /** Head turn in degrees at full deflection. */
    headRange: number;
    bodyRange: number;
  };
  input: {
    /** KeyboardEvent.code for push-to-talk. */
    talkKey: string;
    /** 'hold' to talk while pressed, 'toggle' to start/stop with a press. */
    talkMode: 'hold' | 'toggle';
    /** Move to listening/thinking automatically on talk input. Turn off if your STT drives states. */
    autoStates: boolean;
  };
  bridge: {
    /** WebSocket URL of your AI backend, e.g. ws://localhost:8765. Override with ?ws= */
    url: string | null;
    reconnect: boolean;
  };
}

export const defaultConfig: NovaConfig = {
  model: {
    url: 'models/hiyori/Hiyori.model3.json',   // the sample model setup.ps1 downloads
    zoom: 1,
    anchorY: 0.56,
    headY: 0.22,
  },

  params: {
    angleX: 'ParamAngleX',
    angleY: 'ParamAngleY',
    angleZ: 'ParamAngleZ',
    bodyX: 'ParamBodyAngleX',
    bodyY: 'ParamBodyAngleY',
    bodyZ: 'ParamBodyAngleZ',
    eyeBallX: 'ParamEyeBallX',
    eyeBallY: 'ParamEyeBallY',
    eyeLOpen: 'ParamEyeLOpen',
    eyeROpen: 'ParamEyeROpen',
    eyeLSmile: 'ParamEyeLSmile',
    eyeRSmile: 'ParamEyeRSmile',
    browLY: 'ParamBrowLY',
    browRY: 'ParamBrowRY',
    browLAngle: 'ParamBrowLAngle',
    browRAngle: 'ParamBrowRAngle',
    browLForm: 'ParamBrowLForm',
    browRForm: 'ParamBrowRForm',
    mouthOpen: 'ParamMouthOpenY',
    mouthForm: 'ParamMouthForm',
    cheek: 'ParamCheek',
  },

  /**
   * Pose values are additive offsets in each parameter's own units
   * (angles in degrees, everything else roughly -1..1). Tune per model.
   */
  states: {
    idle: {
      pose: {},
      gaze: { target: 'free', pointer: 1 },
      sway: 1,
    },
    listening: {
      pose: { angleZ: 4, angleY: -2, bodyY: 2, eyeOpen: 0.1, browY: 0.3, mouthForm: 0.2 },
      gaze: { target: 'viewer', pointer: 0.6 },
      sway: 0.5,
      micNod: 5,
    },
    thinking: {
      pose: { angleZ: -5, angleY: 6, browY: -0.15, browForm: -0.5, mouthForm: -0.4, eyeOpen: -0.08 },
      gaze: { target: [-0.55, 0.6], pointer: 0.1 },
      sway: 0.4,
      ponder: 1.5,
    },
    speaking: {
      pose: { browY: 0.1, mouthForm: 0.1 },
      gaze: { target: 'viewer', pointer: 0.35 },
      sway: 0.8,
    },
  },

  /**
   * Set `model` to an expression name from your model3.json to use the artist's version.
   * The `pose` is used when the model has no such expression, so every alias works out of the box.
   */
  expressions: {
    happy: { pose: { eyeSmile: 0.8, mouthForm: 0.8, browY: 0.3, cheek: 0.6 } },
    sad: { pose: { browY: -0.4, browAngle: -0.6, mouthForm: -0.7, eyeOpen: -0.2, angleY: -4 } },
    surprised: { pose: { eyeOpen: 0.3, browY: 0.8, mouthOpen: 0.35 } },
    angry: { pose: { browY: -0.5, browAngle: 0.7, browForm: -0.8, mouthForm: -0.6, eyeOpen: -0.1 } },
    shy: { pose: { cheek: 1, eyeSmile: 0.3, angleY: -6, angleZ: 4 } },
    curious: { pose: { angleZ: 8, browY: 0.4, eyeOpen: 0.12 } },
    smug: { pose: { eyeSmile: 0.4, mouthForm: 0.6, browY: 0.15, angleZ: -3 } },
  },

  lipSync: {
    // Tuned for JARVIS's Kokoro voice (af_heart), measured on a 6.6 s sentence of
    // about 20 words. NOVA's values (gain 5, floor 0.008, attack 28, release 11,
    // maxOpen 1) left the mouth closed 13% of the time with 4 distinct movements:
    // it hung open. These give 37% closed and 11 movements.
    gain: 7,              // raised with the floor, so loud syllables still open the mouth fully
    noiseFloor: 0.04,     // Kokoro never goes silent between words; a higher floor lets the lips close there
    attack: 34,           // opens quickly so syllable starts land on time
    release: 26,          // closes quickly so speech reads as separate beats
    maxOpen: 0.85,        // Hiyori's fully open mouth looks like shouting
    shape: true,
  },

  gaze: {
    pointerTimeoutMs: 3500,
    eyeRate: 16,
    headRate: 4.5,
    headRange: 22,
    bodyRange: 6,
  },

  input: {
    talkKey: 'Space',
    talkMode: 'hold',
    autoStates: false,   // NOVA on the dashboard drives the states; this page does not listen
  },

  bridge: {
    url: null,
    reconnect: true,
  },
};

export type NovaConfigInput = DeepPartial<NovaConfig>;

export function resolveConfig(input: NovaConfigInput = {}): NovaConfig {
  const merged = deepMerge(structuredClone(defaultConfig), input);
  for (const [name, def] of Object.entries(merged.states)) merged.states[name] = normalizeState(def);
  return merged;
}
