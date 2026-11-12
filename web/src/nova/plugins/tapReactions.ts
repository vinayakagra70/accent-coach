import type { NovaPlugin } from '../core/types';

export type TapReaction = { expression?: string; duration?: number; motion?: string };

/**
 * Example plugin: react when a hit area (defined in model3.json, e.g. "Head", "Body") is tapped.
 * Install with nova.use(tapReactions({ Head: { expression: 'shy' } })).
 */
export function tapReactions(
  map: Record<string, TapReaction> = {
    Head: { expression: 'happy', duration: 2200 },
    Body: { motion: 'TapBody' },
  },
): NovaPlugin {
  return {
    name: 'tap-reactions',
    install(nova) {
      return nova.events.on('tap', ({ areas }) => {
        if (nova.isSpeaking) return;
        const reaction = areas.map((a) => map[a]).find(Boolean);
        if (!reaction) return;
        if (reaction.expression) void nova.expression(reaction.expression, { duration: reaction.duration ?? 2000 });
        if (reaction.motion) void nova.motion(reaction.motion);
      });
    },
  };
}
