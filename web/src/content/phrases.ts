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

export interface PhrasePack {
  id: string;
  title: string;
  phrases: string[];
}

export const PHRASE_PACKS: PhrasePack[] = packs;

const IPA = ipa as Record<Accent, Record<string, SpokenWord[]>>;

/** How a phrase is pronounced, word by word, or null for text that isn't one of the phrases. */
export function phraseWords(text: string, accent: Accent): SpokenWord[] | null {
  return IPA[accent][text] ?? null;
}
