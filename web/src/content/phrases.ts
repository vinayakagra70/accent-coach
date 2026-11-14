/**
 * Everyday phrases: ready-made sentences for real situations, checked like
 * "your own words" (scoring/freeText.ts).
 *
 * The phrases live in phrases.json so the Python tool can read them too.
 * phrases-ipa.json (written by `python -m tools.phrases`) says how each one is
 * pronounced in both accents, which is why these work on the hosted phone
 * build, where there's no server to ask. Every phrase has been said by four
 * native voices and heard by the speech model without a false habit
 * (tests/phrases.test.ts); reword one that fails rather than loosening the test.
 */
import type { Accent } from "./accent";
import type { SpokenWord } from "../scoring/freeText";
import packs from "./phrases.json";
import ipa from "./phrases-ipa.json";
import talks from "./conversations.json";

export interface PhrasePack {
  id: string;
  title: string;
  phrases: string[];
  /** A line shown above the phrases (the "For you" pack says what it was picked for). */
  note?: string;
}

export const PHRASE_PACKS: PhrasePack[] = packs;

/** A short exchange: the coach asks, the learner answers with one of the replies. */
export interface Conversation {
  id: string;
  title: string;
  turns: { ask: string; replies: string[] }[];
}

export const CONVERSATIONS: Conversation[] = talks;

/** Everything the learner can be asked to say: the phrases, then the replies that aren't phrases already. */
export const ALL_PHRASES: string[] = [...new Set([...PHRASE_PACKS.flatMap((p) => p.phrases), ...CONVERSATIONS.flatMap((c) => c.turns.flatMap((t) => t.replies))])];

const IPA = ipa as Record<Accent, Record<string, SpokenWord[]>>;

/** How a phrase is pronounced, word by word, or null for text that isn't one of the phrases. */
export function phraseWords(text: string, accent: Accent): SpokenWord[] | null {
  return IPA[accent][text] ?? null;
}
