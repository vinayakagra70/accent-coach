/** The target accent: General American or British English (RP). */
import { US_ASSESSMENT, _setAssessment } from "./assessment";
import { UK_ASSESSMENT, UK_CHECKS, UK_FORMANTS, UK_LESSONS, UK_LEXICON } from "./british";
import { US_FORMANTS, US_LESSONS, US_LEXICON, _setLessonContent } from "./lessons";
import { US_CHECKS, _setChecks } from "../scoring/checks";

export type Accent = "us" | "uk";

export const ACCENTS: Record<Accent, { name: string; long: string; voice: string; lang: string }> = {
  us: { name: "American", long: "General American", voice: "af_heart", lang: "en-us" },
  uk: { name: "British", long: "British English", voice: "bf_emma", lang: "en-gb" },
};

let current: Accent = "us";

export function accent(): Accent {
  return current;
}

export function accentInfo() {
  return ACCENTS[current];
}

export function setAccent(a: Accent) {
  current = a;
  if (a === "uk") {
    _setLessonContent(UK_LESSONS, UK_LEXICON, UK_FORMANTS);
    _setChecks(UK_CHECKS);
    _setAssessment(UK_ASSESSMENT);
  } else {
    _setLessonContent(US_LESSONS, US_LEXICON, US_FORMANTS);
    _setChecks(US_CHECKS);
    _setAssessment(US_ASSESSMENT);
  }
}
