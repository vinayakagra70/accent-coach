/**
 * Shared types for Nova. Everything a host application needs to talk to the
 * avatar is described here: parameter keys, state and expression definitions,
 * the command protocol and the event map.
 */

/** Semantic names for the standard Cubism parameters Nova drives. */
export type ParamKey =
  | 'angleX' | 'angleY' | 'angleZ'
  | 'bodyX' | 'bodyY' | 'bodyZ'
  | 'eyeBallX' | 'eyeBallY'
  | 'eyeLOpen' | 'eyeROpen' | 'eyeLSmile' | 'eyeRSmile'
  | 'browLY' | 'browRY' | 'browLAngle' | 'browRAngle' | 'browLForm' | 'browRForm'
  | 'mouthOpen' | 'mouthForm' | 'cheek';

/** Shorthands that fan out to a left/right pair. */
export type PairedKey = 'eyeOpen' | 'eyeSmile' | 'browY' | 'browAngle' | 'browForm';

export type PoseKey = ParamKey | PairedKey;

/** Additive parameter offsets. Keys are semantic keys, pair shorthands, or raw model parameter ids. */
export type Pose = { [K in PoseKey]?: number } & { [rawId: string]: number | undefined };

/** Maps each semantic key to the parameter id used by your model. */
export type ParamMap = Record<ParamKey, string>;

/** Where the eyes rest: wander freely, look at the viewer, or a fixed point (x, y in -1..1, +y is up). */
export type GazeTarget = 'free' | 'viewer' | readonly [number, number];

export interface StateDefinition {
  /** Additive pose held while in this state (blended in and out smoothly). */
  pose: Pose;
  gaze: {
    target: GazeTarget;
    /** 0..1 — how strongly the mouse pulls the gaze in this state. */
    pointer: number;
  };
  /** Multiplier for the ambient head sway. */
  sway: number;
  /** Nod amount driven by microphone level (attach a mic to use). */
  micNod?: number;
  /** Slow contemplative head wobble. */
  ponder?: number;
  /** Expression alias applied on enter and cleared on leave. */
  expression?: string;
  /** Motion played on enter. */
  motion?: { group: string; index?: number };
  /** Aura colour for the UI (any CSS colour). Built-in states are themed in CSS. */
  tone?: string;
}

export interface ExpressionDefinition {
  /** Name of an expression in your model3.json. Used when the model has it. */
  model?: string;
  /** Procedural fallback built from parameters, used when the model lacks `model`. */
  pose?: Pose;
  /** Apply `pose` on top of the model expression as well. */
  layer?: boolean;
}

export type MotionPriorityName = 'idle' | 'normal' | 'force';

/** Anything `nova.speak()` can play. */
export type SpeechSource = string | Blob | ArrayBuffer | AudioBuffer | HTMLAudioElement | MediaStream;

export interface SpeakOptions {
  /** Caption text. May contain inline directives like [expression:happy]. */
  text?: string;
  /** State to enter when playback finishes. Default 'idle'; null keeps the current state. */
  after?: string | null;
}

export interface StreamOptions extends SpeakOptions {
  /** Sample rate of the PCM you'll push. Default 24000. */
  sampleRate?: number;
}

/** The JSON command protocol. Your AI (or the WebSocket bridge) sends these. */
export type NovaCommand =
  | { type: 'state'; state: string }
  | { type: 'expression'; name: string; intensity?: number; duration?: number }
  | { type: 'clear_expression' }
  | { type: 'motion'; group: string; index?: number; priority?: MotionPriorityName }
  | { type: 'speak'; url?: string; base64?: string; text?: string; after?: string | null }
  | { type: 'stream_start'; sampleRate?: number; text?: string; after?: string | null }
  | { type: 'stream_chunk'; data: string | ArrayBuffer }
  | { type: 'stream_end' }
  | { type: 'stop'; then?: string }
  | { type: 'caption'; text: string | null; duration?: number }
  | { type: 'look'; x?: number; y?: number; clear?: boolean; duration?: number }
  | { type: 'param'; id: string; value?: number; weight?: number; duration?: number; release?: boolean };

export type NovaEvents = {
  state: { from: string; to: string };
  expression: { name: string | null };
  motion: { group: string; index?: number };
  'speech:start': { text: string | null; timed: boolean };
  /** Fired every frame while speaking. progress is 0..1, or NaN for live streams. */
  'speech:progress': { progress: number; level: number };
  'speech:end': { interrupted: boolean };
  caption: { text: string | null; duration?: number };
  tap: { areas: string[]; x: number; y: number };
  'input:talkStart': Record<string, never>;
  'input:talkEnd': Record<string, never>;
  'bridge:status': { connected: boolean; url: string };
  error: { error: unknown; context: string };
};

export interface NovaPlugin {
  name: string;
  /** Return a teardown function if the plugin holds resources. */
  install(nova: import('./Nova').Nova): void | (() => void);
}
