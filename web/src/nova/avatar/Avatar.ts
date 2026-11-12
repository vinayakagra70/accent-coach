import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';
import type { NovaConfig } from '../config';
import type { MotionPriorityName } from '../core/types';
import { ParamFrame, type CoreModelLike } from './ParamFrame';
import type { AvatarGeometry, Behavior, BehaviorContext, FrameInputs } from './behaviors/Behavior';

Live2DModel.registerTicker(PIXI.Ticker);

export class ModelLoadError extends Error {
  constructor(
    readonly url: string,
    readonly cause: unknown,
  ) {
    super(`Couldn't load the Live2D model at ${url}`);
  }
}

const PRIORITY: Record<MotionPriorityName, MotionPriority> = {
  idle: MotionPriority.IDLE,
  normal: MotionPriority.NORMAL,
  force: MotionPriority.FORCE,
};

interface ExpressionManagerLike {
  definitions: { Name?: string; name?: string }[];
  resetExpression(): void;
}

/**
 * Owns rendering: the Pixi application, the Live2D model, layout, and the
 * behaviour pipeline. Behaviours run inside the Cubism update, after motions,
 * expressions and blinking but before physics, so hair and accessories react
 * to Nova's head movement.
 */
export class Avatar implements AvatarGeometry {
  readonly frame: ParamFrame;
  private behaviors: Behavior[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly failed = new Set<Behavior>();
  private lastTick = performance.now();

  static async load(host: HTMLElement, config: NovaConfig, inputs: FrameInputs): Promise<Avatar> {
    if (!('Live2DCubismCore' in window)) {
      throw new Error('Live2D Cubism Core is missing. Include live2dcubismcore.min.js before the app script (see index.html).');
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'nova-canvas';
    host.appendChild(canvas);

    const app = new PIXI.Application({
      view: canvas,
      width: host.clientWidth || window.innerWidth,
      height: host.clientHeight || window.innerHeight,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });

    try {
      const model = await Live2DModel.from(config.model.url, { autoInteract: false });
      return new Avatar(host, app, model, config, inputs);
    } catch (err) {
      app.destroy(true);
      throw new ModelLoadError(config.model.url, err);
    }
  }

  private constructor(
    private readonly host: HTMLElement,
    readonly app: PIXI.Application,
    readonly model: Live2DModel,
    private readonly config: NovaConfig,
    private readonly inputs: FrameInputs,
  ) {
    this.frame = new ParamFrame(config.params);
    model.anchor.set(0.5, 0.5);
    app.stage.addChild(model);

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(host);
    this.layout();
    this.hookUpdate();
  }

  get canvas(): HTMLCanvasElement {
    return this.app.view;
  }

  get core(): CoreModelLike {
    return (this.model.internalModel as unknown as { coreModel: CoreModelLike }).coreModel;
  }

  // ── Behaviours ──────────────────────────────────────────────

  /** Insert a behaviour. By default it runs last; pass `before` to run ahead of a named one. */
  addBehavior(behavior: Behavior, opts: { before?: string } = {}): () => void {
    const i = opts.before ? this.behaviors.findIndex((b) => b.name === opts.before) : -1;
    if (i >= 0) this.behaviors.splice(i, 0, behavior);
    else this.behaviors.push(behavior);
    return () => this.removeBehavior(behavior.name);
  }

  removeBehavior(name: string): void {
    this.behaviors = this.behaviors.filter((b) => b.name !== name);
  }

  listBehaviors(): string[] {
    return this.behaviors.map((b) => b.name);
  }

  private hookUpdate(): void {
    const im = this.model.internalModel as unknown as {
      updateNaturalMovements?: (dt: number, now: number) => void;
      on(event: string, fn: () => void): void;
    };
    const original = im.updateNaturalMovements?.bind(im);
    if (original) {
      im.updateNaturalMovements = (dt: number, now: number) => {
        original(dt, now);
        this.tick(dt / 1000, now / 1000);
      };
    } else {
      // Fallback for framework versions without the hook: runs after physics.
      im.on('beforeModelUpdate', () => {
        const now = performance.now();
        this.tick((now - this.lastTick) / 1000, now / 1000);
      });
    }
  }

  private tick(dt: number, time: number): void {
    this.lastTick = performance.now();
    const ctx: BehaviorContext = {
      dt: Math.min(Math.max(dt, 0), 0.1),
      time,
      frame: this.frame,
      inputs: this.inputs,
      avatar: this,
    };
    for (const b of this.behaviors) {
      if (this.failed.has(b)) continue;
      try {
        b.update(ctx);
      } catch (err) {
        this.failed.add(b);
        console.error(`[nova] behaviour "${b.name}" threw and was disabled`, err);
      }
    }
    this.frame.flush(this.core);
  }

  // ── Layout & geometry ───────────────────────────────────────

  layout(): void {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.app.renderer.resize(width, height);
    const { width: iw, height: ih } = this.model.internalModel;
    const scale = Math.min(width / iw, height / ih) * this.config.model.zoom;
    this.model.scale.set(scale);
    this.model.position.set(width / 2, height * this.config.model.anchorY);
  }

  head(): { x: number; y: number } {
    return {
      x: this.model.x,
      y: this.model.y + (this.config.model.headY - 0.5) * this.model.height,
    };
  }

  size(): { width: number; height: number } {
    return { width: this.app.renderer.screen.width, height: this.app.renderer.screen.height };
  }

  hitTest(x: number, y: number): string[] {
    return this.model.hitTest(x, y);
  }

  // ── Model capabilities ──────────────────────────────────────

  private get expressionManager(): ExpressionManagerLike | undefined {
    return (this.model.internalModel.motionManager as unknown as { expressionManager?: ExpressionManagerLike })
      .expressionManager;
  }

  modelExpressions(): string[] {
    return (this.expressionManager?.definitions ?? []).map((d) => d.Name ?? d.name ?? '').filter(Boolean);
  }

  hasModelExpression(name: string): boolean {
    return this.modelExpressions().includes(name);
  }

  resetModelExpression(): void {
    this.expressionManager?.resetExpression();
  }

  motionGroups(): string[] {
    return Object.keys(this.model.internalModel.motionManager.definitions ?? {});
  }

  playMotion(group: string, index?: number, priority: MotionPriorityName = 'normal'): Promise<boolean> {
    return this.model.motion(group, index, PRIORITY[priority]);
  }

  /** Parameter ids present in the loaded model (empty if unavailable). */
  parameterIds(): string[] {
    const core = this.core as unknown as { getModel?: () => { parameters?: { ids?: string[] } } };
    try {
      return [...(core.getModel?.().parameters?.ids ?? [])];
    } catch {
      return [];
    }
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.app.destroy(true, { children: true });
  }
}
