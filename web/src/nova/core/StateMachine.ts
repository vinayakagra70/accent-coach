import type { EventBus } from './EventBus';
import type { NovaEvents, StateDefinition } from './types';

/**
 * Holds the registered behavioural states and the current one.
 * Side effects of entering a state (pose, expression, motion) are applied by
 * listeners of the `state` event, so new states need no code changes here.
 */
export class StateMachine {
  private _current: string;

  constructor(
    private readonly defs: Record<string, StateDefinition>,
    private readonly bus: EventBus<NovaEvents>,
    initial = 'idle',
  ) {
    if (!defs[initial]) throw new Error(`[nova] initial state "${initial}" is not defined`);
    this._current = initial;
  }

  get current(): string {
    return this._current;
  }

  get definition(): StateDefinition {
    return this.defs[this._current];
  }

  get(name: string): StateDefinition | undefined {
    return this.defs[name];
  }

  has(name: string): boolean {
    return name in this.defs;
  }

  list(): string[] {
    return Object.keys(this.defs);
  }

  /** Add or replace a state at runtime. */
  register(name: string, def: Partial<StateDefinition>): void {
    this.defs[name] = normalizeState(def);
  }

  /** Returns false when already in that state. */
  set(name: string): boolean {
    if (!this.defs[name]) {
      throw new Error(`[nova] unknown state "${name}". Registered: ${this.list().join(', ')}`);
    }
    if (name === this._current) return false;
    const from = this._current;
    this._current = name;
    this.bus.emit('state', { from, to: name });
    return true;
  }
}

export function normalizeState(def: Partial<StateDefinition>): StateDefinition {
  return {
    ...def,
    pose: def.pose ?? {},
    gaze: { target: def.gaze?.target ?? 'free', pointer: def.gaze?.pointer ?? 1 },
    sway: def.sway ?? 1,
  };
}
