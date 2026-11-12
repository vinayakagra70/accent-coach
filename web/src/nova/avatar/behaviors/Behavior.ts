import type { StateDefinition } from '../../core/types';
import type { ParamFrame } from '../ParamFrame';

/** Live inputs the host updates every frame. Behaviours only read these. */
export interface FrameInputs {
  state: string;
  stateDef: StateDefinition;
  speech: { active: boolean; level: number; shape: number };
  mic: { level: number };
  /** Pointer position in stage pixels and when it last moved (performance.now()). */
  pointer: { x: number; y: number; lastMove: number } | null;
  /** Explicit gaze target from nova.lookAt(), -1..1 with +y up. */
  lookAt: { x: number; y: number } | null;
}

export interface AvatarGeometry {
  /** Face position in stage pixels. */
  head(): { x: number; y: number };
  /** Stage size in pixels. */
  size(): { width: number; height: number };
}

export interface BehaviorContext {
  /** Seconds since last frame (clamped). */
  dt: number;
  /** Seconds, monotonic. */
  time: number;
  frame: ParamFrame;
  inputs: FrameInputs;
  avatar: AvatarGeometry;
}

/**
 * A behaviour writes parameter offsets into the frame each tick.
 * Add your own with nova.avatar.addBehavior().
 */
export interface Behavior {
  readonly name: string;
  update(ctx: BehaviorContext): void;
}
