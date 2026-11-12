import * as PIXI from 'pixi.js';
import { resolveConfig, type NovaConfig, type NovaConfigInput } from '../config';
import { Avatar } from '../avatar/Avatar';
import type { FrameInputs } from '../avatar/behaviors/Behavior';
import { ExpressionLayerBehavior } from '../avatar/behaviors/ExpressionLayerBehavior';
import { GazeBehavior } from '../avatar/behaviors/GazeBehavior';
import { IdleLifeBehavior } from '../avatar/behaviors/IdleLifeBehavior';
import { OverrideBehavior } from '../avatar/behaviors/OverrideBehavior';
import { SpeechBehavior } from '../avatar/behaviors/SpeechBehavior';
import { StatePoseBehavior } from '../avatar/behaviors/StatePoseBehavior';
import { AudioEngine } from '../audio/AudioEngine';
import type { PcmChunk, PcmStream, SpeechHandle } from '../audio/PcmStream';
import { parseDirectives, type Cue } from '../bridge/directives';
import { base64ToArrayBuffer } from '../util/math';
import { EventBus } from './EventBus';
import { StateMachine } from './StateMachine';
import type {
  MotionPriorityName,
  NovaCommand,
  NovaEvents,
  NovaPlugin,
  SpeakOptions,
  SpeechSource,
  StateDefinition,
  StreamOptions,
} from './types';

export interface NovaOptions {
  /** Element the canvas is mounted into. It should fill the area Nova lives in. */
  host: HTMLElement;
  config?: NovaConfigInput;
}

/** Push-based handle for streaming TTS. */
export interface SpeechStream {
  push(chunk: PcmChunk): void;
  end(): Promise<{ interrupted: boolean }>;
  stop(): void;
}

interface ActiveSpeech {
  handle: SpeechHandle;
  cues: Cue[];
  fired: number;
  after: string | null | undefined;
  /** Expression set by an inline cue; it eases back out after the utterance. */
  cueExpression: string | null;
}

/**
 * The one object your AI talks to.
 *
 *   nova.setState('thinking')
 *   await nova.speak(ttsAudioBlob, { text: 'Hello! [expression:happy]' })
 *   nova.expression('surprised', { duration: 2000 })
 *   nova.command({ type: 'motion', group: 'TapBody' })
 */
export class Nova {
  readonly events = new EventBus<NovaEvents>();
  readonly audio: AudioEngine;
  readonly states: StateMachine;

  private readonly expressionLayer = new ExpressionLayerBehavior();
  private readonly overrides = new OverrideBehavior();
  private speech: ActiveSpeech | null = null;
  private pendingStream: PcmStream | null = null;
  private commandStream: SpeechStream | null = null;
  private speechSeq = 0;
  private currentExpression: string | null = null;
  private expressionTimer = 0;
  private lookTimer = 0;
  private mouthOverride: number | null = null;
  private readonly plugins = new Map<string, (() => void) | void>();
  private readonly disposers: (() => void)[] = [];

  static async create(options: NovaOptions): Promise<Nova> {
    const config = resolveConfig(options.config);
    const inputs: FrameInputs = {
      state: 'idle',
      stateDef: config.states.idle,
      speech: { active: false, level: 0, shape: 0 },
      mic: { level: 0 },
      pointer: null,
      lookAt: null,
    };
    const avatar = await Avatar.load(options.host, config, inputs);
    return new Nova(options.host, config, avatar, inputs);
  }

  private constructor(
    private readonly host: HTMLElement,
    readonly config: NovaConfig,
    readonly avatar: Avatar,
    private readonly inputs: FrameInputs,
  ) {
    this.audio = new AudioEngine(config.lipSync);
    this.states = new StateMachine(config.states, this.events);

    // Order matters: later layers add on top of earlier ones.
    avatar.addBehavior(new IdleLifeBehavior());
    avatar.addBehavior(new StatePoseBehavior());
    avatar.addBehavior(new GazeBehavior(config.gaze));
    avatar.addBehavior(this.expressionLayer);
    avatar.addBehavior(new SpeechBehavior(config.lipSync));
    avatar.addBehavior(this.overrides);

    this.events.on('state', (e) => this.onStateChange(e.from, e.to));
    this.bindPointer();

    PIXI.Ticker.shared.add(this.onFrame, this, PIXI.UPDATE_PRIORITY.HIGH);
    this.disposers.push(() => PIXI.Ticker.shared.remove(this.onFrame, this));
  }

  // ── State ───────────────────────────────────────────────────

  get state(): string {
    return this.states.current;
  }

  setState(name: string): void {
    this.states.set(name);
  }

  /** Add a custom state, e.g. nova.registerState('sleepy', { pose: { eyeOpen: -0.5 }, sway: 0.3 }). */
  registerState(name: string, def: Partial<StateDefinition>): void {
    this.states.register(name, def);
  }

  private onStateChange(from: string, to: string): void {
    const prev = this.states.get(from);
    const next = this.states.get(to)!;
    this.inputs.state = to;
    this.inputs.stateDef = next;
    if (prev?.expression && this.currentExpression === prev.expression) this.clearExpression();
    if (next.expression) void this.expression(next.expression);
    if (next.motion) void this.motion(next.motion.group, next.motion.index);
  }

  // ── Expressions & motions ───────────────────────────────────

  /**
   * Show an expression by alias (config.expressions) or by the model's own expression name.
   * `duration` (ms) clears it automatically.
   */
  async expression(name: string, opts: { intensity?: number; duration?: number } = {}): Promise<void> {
    const def = this.config.expressions[name];
    const modelName = def?.model ?? name;
    window.clearTimeout(this.expressionTimer);

    let usedModel = false;
    if (this.avatar.hasModelExpression(modelName)) usedModel = await this.avatar.model.expression(modelName);
    else this.avatar.resetModelExpression();

    if (def?.pose && (!usedModel || def.layer)) this.expressionLayer.show(name, def.pose, opts.intensity ?? 1);
    else this.expressionLayer.clear();

    if (!usedModel && !def?.pose) {
      console.warn(`[nova] unknown expression "${name}". Add it to config.expressions or the model.`);
      return;
    }
    this.currentExpression = name;
    this.events.emit('expression', { name });
    if (opts.duration) this.expressionTimer = window.setTimeout(() => this.clearExpression(), opts.duration);
  }

  clearExpression(): void {
    window.clearTimeout(this.expressionTimer);
    this.avatar.resetModelExpression();
    this.expressionLayer.clear();
    if (this.currentExpression !== null) {
      this.currentExpression = null;
      this.events.emit('expression', { name: null });
    }
  }

  get expressionName(): string | null {
    return this.currentExpression;
  }

  /** Play a motion group from model3.json. Omit index for a random one. */
  async motion(group: string, index?: number, priority: MotionPriorityName = 'normal'): Promise<boolean> {
    const ok = await this.avatar.playMotion(group, index, priority);
    if (ok) this.events.emit('motion', { group, index });
    return ok;
  }

  // ── Speech ──────────────────────────────────────────────────

  /**
   * Play TTS audio with lip-sync. Resolves when playback ends or is interrupted.
   * Accepts a URL, Blob, ArrayBuffer, AudioBuffer, <audio> element or MediaStream.
   */
  async speak(source: SpeechSource, opts: SpeakOptions = {}): Promise<void> {
    this.stopSpeaking();
    const seq = ++this.speechSeq;
    let handle: SpeechHandle;
    try {
      handle = await this.audio.play(source);
    } catch (error) {
      this.events.emit('error', { error, context: 'speak' });
      if (seq === this.speechSeq && this.state === 'speaking') this.setState('idle');
      throw error;
    }
    if (seq !== this.speechSeq) {
      handle.stop(); // superseded while loading
      return;
    }
    this.beginSpeech(handle, opts);
    const { interrupted } = await handle.done;
    if (this.speech?.handle === handle) this.endSpeech(interrupted);
  }

  /**
   * Stream PCM from a streaming TTS. Speaking starts with the first chunk.
   *
   *   const s = nova.stream({ sampleRate: 24000, text });
   *   for await (const chunk of tts) s.push(chunk);   // Int16 / Float32 / ArrayBuffer(pcm16)
   *   await s.end();
   */
  stream(opts: StreamOptions = {}): SpeechStream {
    this.stopSpeaking();
    this.speechSeq++;
    const handle: PcmStream = this.audio.createPcmStream(opts.sampleRate ?? 24000, () => {
      if (this.pendingStream !== handle) return;
      this.pendingStream = null;
      this.beginSpeech(handle, opts);
    });
    this.pendingStream = handle;
    void handle.done.then(({ interrupted }) => {
      if (this.pendingStream === handle) this.pendingStream = null;
      if (this.speech?.handle === handle) this.endSpeech(interrupted);
    });
    return handle;
  }

  /** Interrupt speech (barge-in). Optionally move to another state, e.g. 'listening'. */
  stopSpeaking(then?: string): void {
    this.pendingStream?.stop();
    this.pendingStream = null;
    const active = this.speech;
    if (active) {
      this.speech = null;
      active.handle.stop();
      this.events.emit('speech:end', { interrupted: true });
    }
    if (then) this.setState(then);
  }

  get isSpeaking(): boolean {
    return this.speech !== null;
  }

  /** Drive the mouth directly (0..1), e.g. from server-side visemes. Pass null to return to audio analysis. */
  setMouth(level: number | null): void {
    this.mouthOverride = level;
  }

  private beginSpeech(handle: SpeechHandle, opts: SpeakOptions): void {
    const { text, cues } = parseDirectives(opts.text ?? '');
    this.speech = { handle, cues, fired: 0, after: opts.after, cueExpression: null };
    if (this.state !== 'speaking') this.setState('speaking');
    this.events.emit('speech:start', { text: text || null, timed: handle.timed });
  }

  private endSpeech(interrupted: boolean): void {
    const s = this.speech;
    if (!s) return;
    if (!interrupted) while (s.fired < s.cues.length) this.fireCue(s.cues[s.fired++]);
    this.speech = null;
    this.events.emit('speech:end', { interrupted });
    if (!interrupted && s.after !== null && this.state === 'speaking') this.setState(s.after ?? 'idle');
    // Inline [expression:x] tags without a duration last for the utterance plus a beat.
    if (s.cueExpression && this.currentExpression === s.cueExpression) {
      window.clearTimeout(this.expressionTimer);
      this.expressionTimer = window.setTimeout(() => this.clearExpression(), 1500);
    }
  }

  private fireCue(cue: Cue): void {
    const cmd = cue.command;
    if (this.speech && cmd.type === 'expression' && !cmd.duration) this.speech.cueExpression = cmd.name;
    this.command(cmd).catch((error) => this.events.emit('error', { error, context: 'cue' }));
  }

  // ── Gaze, parameters, captions ──────────────────────────────

  /** Look at a point (-1..1, +y up) for `duration` ms, or until lookAt(null). */
  lookAt(target: { x: number; y: number } | null, opts: { duration?: number } = {}): void {
    window.clearTimeout(this.lookTimer);
    this.inputs.lookAt = target;
    if (target && opts.duration) this.lookTimer = window.setTimeout(() => (this.inputs.lookAt = null), opts.duration);
  }

  /** Hold a parameter at a value. Key may be semantic ('cheek'), a pair ('eyeOpen') or a raw id. */
  setParam(key: string, value: number, opts: { weight?: number; duration?: number } = {}): void {
    this.overrides.set(key, value, opts);
  }

  releaseParam(key?: string): void {
    this.overrides.release(key);
  }

  /** Show a caption without audio (e.g. while streaming text). null hides it. */
  caption(text: string | null, opts: { duration?: number } = {}): void {
    this.events.emit('caption', { text, duration: opts.duration });
  }

  /** Current analysed levels, 0..1. */
  get levels(): { speech: number; mic: number } {
    return { speech: this.inputs.speech.level, mic: this.inputs.mic.level };
  }

  /** What this avatar can do. Send it to your LLM so it knows which expressions and motions exist. */
  describe(): { states: string[]; expressions: string[]; motions: string[] } {
    const expressions = new Set([...Object.keys(this.config.expressions), ...this.avatar.modelExpressions()]);
    return { states: this.states.list(), expressions: [...expressions], motions: this.avatar.motionGroups() };
  }

  // ── Command protocol ────────────────────────────────────────

  /** Single entry point for JSON commands from your AI or the WebSocket bridge. */
  async command(cmd: NovaCommand): Promise<void> {
    switch (cmd.type) {
      case 'state':
        this.setState(cmd.state);
        return;
      case 'expression':
        return this.expression(cmd.name, { intensity: cmd.intensity, duration: cmd.duration });
      case 'clear_expression':
        this.clearExpression();
        return;
      case 'motion':
        await this.motion(cmd.group, cmd.index, cmd.priority);
        return;
      case 'speak': {
        const source = cmd.url ?? (cmd.base64 ? base64ToArrayBuffer(cmd.base64) : null);
        if (!source) throw new Error('speak needs `url` or `base64`');
        return this.speak(source, { text: cmd.text, after: cmd.after });
      }
      case 'stream_start':
        this.commandStream = this.stream({ sampleRate: cmd.sampleRate, text: cmd.text, after: cmd.after });
        return;
      case 'stream_chunk': {
        const chunk = typeof cmd.data === 'string' ? base64ToArrayBuffer(cmd.data) : cmd.data;
        (this.commandStream ??= this.stream()).push(chunk);
        return;
      }
      case 'stream_end': {
        const s = this.commandStream;
        this.commandStream = null;
        await s?.end();
        return;
      }
      case 'stop':
        this.commandStream = null;
        this.stopSpeaking(cmd.then);
        return;
      case 'caption':
        this.caption(cmd.text, { duration: cmd.duration });
        return;
      case 'look':
        if (cmd.clear || cmd.x === undefined) this.lookAt(null);
        else this.lookAt({ x: cmd.x, y: cmd.y ?? 0 }, { duration: cmd.duration });
        return;
      case 'param':
        if (cmd.release || cmd.value === undefined) this.releaseParam(cmd.id);
        else this.setParam(cmd.id, cmd.value, { weight: cmd.weight, duration: cmd.duration });
        return;
      default: {
        const unknown: never = cmd;
        console.warn('[nova] unknown command', unknown);
      }
    }
  }

  // ── Plugins ─────────────────────────────────────────────────

  use(plugin: NovaPlugin): this {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[nova] plugin "${plugin.name}" is already installed`);
      return this;
    }
    this.plugins.set(plugin.name, plugin.install(this));
    return this;
  }

  unuse(name: string): void {
    const teardown = this.plugins.get(name);
    if (typeof teardown === 'function') teardown();
    this.plugins.delete(name);
  }

  // ── Frame loop & input ──────────────────────────────────────

  private onFrame(): void {
    const dt = Math.min(PIXI.Ticker.shared.deltaMS / 1000, 0.1);
    this.audio.sample(dt);

    const sp = this.inputs.speech;
    if (this.mouthOverride !== null) {
      sp.active = true;
      sp.level = this.mouthOverride;
      sp.shape = 0;
    } else {
      sp.active = this.speech !== null || this.audio.externalActive;
      sp.level = this.audio.speech.level;
      sp.shape = this.audio.speech.shape;
    }
    this.inputs.mic.level = this.audio.mic.level;

    const s = this.speech;
    if (!s) return;
    const progress = s.handle.progress();
    if (!s.handle.timed) {
      while (s.fired < s.cues.length) this.fireCue(s.cues[s.fired++]);
    } else if (Number.isFinite(progress)) {
      while (s.fired < s.cues.length && s.cues[s.fired].at <= progress) this.fireCue(s.cues[s.fired++]);
    }
    this.events.emit('speech:progress', { progress, level: sp.level });
  }

  private bindPointer(): void {
    const track = (e: PointerEvent) => {
      const r = this.host.getBoundingClientRect();
      this.inputs.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, lastMove: performance.now() };
    };
    const down = (e: PointerEvent) => {
      if (e.target !== this.avatar.canvas) return;
      track(e);
      void this.audio.resume().catch(() => undefined);
      const { x, y } = this.inputs.pointer!;
      this.events.emit('tap', { areas: this.avatar.hitTest(x, y), x, y });
    };
    window.addEventListener('pointermove', track, { passive: true });
    this.host.addEventListener('pointerdown', down);
    this.disposers.push(() => {
      window.removeEventListener('pointermove', track);
      this.host.removeEventListener('pointerdown', down);
    });
  }

  destroy(): void {
    this.stopSpeaking();
    for (const name of [...this.plugins.keys()]) this.unuse(name);
    this.disposers.forEach((d) => d());
    this.events.clear();
    this.avatar.destroy();
    void this.audio.ctx.close();
  }
}
