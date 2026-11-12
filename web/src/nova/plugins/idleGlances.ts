import type { NovaPlugin } from '../core/types';

/**
 * Example plugin: after a stretch of idling, Nova does a small expressive beat
 * so she doesn't feel like a screensaver.
 */
export function idleGlances(opts: { afterMs?: number; expressions?: string[] } = {}): NovaPlugin {
  const afterMs = opts.afterMs ?? 20000;
  const pool = opts.expressions ?? ['curious', 'smug', 'happy'];
  return {
    name: 'idle-glances',
    install(nova) {
      let timer = 0;
      const arm = () => {
        window.clearTimeout(timer);
        if (nova.state !== 'idle') return;
        timer = window.setTimeout(() => {
          if (nova.state !== 'idle' || nova.expressionName) return arm();
          void nova.expression(pool[Math.floor(Math.random() * pool.length)], { intensity: 0.7, duration: 1800 });
          nova.lookAt({ x: Math.random() < 0.5 ? -0.6 : 0.6, y: 0.1 }, { duration: 900 });
          arm();
        }, afterMs * (0.7 + Math.random() * 0.6));
      };
      const off = nova.events.on('state', arm);
      arm();
      return () => {
        off();
        window.clearTimeout(timer);
      };
    },
  };
}
