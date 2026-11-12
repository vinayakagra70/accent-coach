/**
 * The voice test: short phrases packed with the sounds Indian English speakers
 * most often change. `expected` is General American as the speech model writes
 * it (normalized: no length marks); `checks` point at the sounds to judge.
 */
export interface TestItem {
  text: string;
  /** Word shown in the report next to a finding. */
  expected: string[];
  checks: { i: number; lesson: string; sym: string; word: string }[];
}

const T = (s: string) => s.split(" ");

export const ASSESSMENT: TestItem[] = [
  {
    text: "Very well.",
    expected: T("v ɛ ɹ i w ɛ l"),
    checks: [
      { i: 0, lesson: "v-w", sym: "v", word: "very" },
      { i: 2, lesson: "american-r", sym: "ɹ", word: "very" },
      { i: 4, lesson: "v-w", sym: "w", word: "well" },
    ],
  },
  {
    text: "I think three things.",
    expected: T("aɪ θ ɪ ŋ k θ ɹ i θ ɪ ŋ z"),
    checks: [
      { i: 1, lesson: "th-voiceless", sym: "θ", word: "think" },
      { i: 5, lesson: "th-voiceless", sym: "θ", word: "three" },
      { i: 8, lesson: "th-voiceless", sym: "θ", word: "things" },
    ],
  },
  {
    text: "This and that.",
    expected: T("ð ɪ s æ n d ð æ t"),
    checks: [
      { i: 0, lesson: "th-voiced", sym: "ð", word: "this" },
      { i: 6, lesson: "th-voiced", sym: "ð", word: "that" },
      { i: 7, lesson: "ae", sym: "æ", word: "that" },
    ],
  },
  {
    text: "Time to talk.",
    expected: T("t aɪ m t ə t ɔ k"),
    checks: [
      { i: 0, lesson: "alveolar-td", sym: "t", word: "time" },
      { i: 3, lesson: "alveolar-td", sym: "t", word: "to" },
      { i: 5, lesson: "alveolar-td", sym: "t", word: "talk" },
    ],
  },
  {
    text: "The water is better.",
    expected: T("ð ə w ɔ ɾ ɚ ɪ z b ɛ ɾ ɚ"),
    checks: [
      { i: 0, lesson: "th-voiced", sym: "ð", word: "the" },
      { i: 2, lesson: "v-w", sym: "w", word: "water" },
      { i: 4, lesson: "flap-t", sym: "ɾ", word: "water" },
      { i: 5, lesson: "rhotic", sym: "ɚ", word: "water" },
      { i: 7, lesson: "z", sym: "z", word: "is" },
      { i: 10, lesson: "flap-t", sym: "ɾ", word: "better" },
      { i: 11, lesson: "rhotic", sym: "ɚ", word: "better" },
    ],
  },
  {
    text: "Zero and zoo.",
    expected: T("z ɪ ɹ oʊ æ n d z u"),
    checks: [
      { i: 0, lesson: "z", sym: "z", word: "zero" },
      { i: 2, lesson: "american-r", sym: "ɹ", word: "zero" },
      { i: 3, lesson: "ou", sym: "oʊ", word: "zero" },
      { i: 7, lesson: "z", sym: "z", word: "zoo" },
    ],
  },
  {
    text: "Red car, right now.",
    expected: T("ɹ ɛ d k ɑ ɹ ɹ aɪ t n aʊ"),
    checks: [
      { i: 0, lesson: "american-r", sym: "ɹ", word: "red" },
      { i: 2, lesson: "alveolar-td", sym: "d", word: "red" },
      { i: 5, lesson: "rhotic", sym: "ɹ", word: "car" },
      { i: 6, lesson: "american-r", sym: "ɹ", word: "right" },
      { i: 8, lesson: "alveolar-td", sym: "t", word: "right" },
    ],
  },
  {
    text: "A bad cat.",
    expected: T("ə b æ d k æ t"),
    checks: [
      { i: 2, lesson: "ae", sym: "æ", word: "bad" },
      { i: 3, lesson: "alveolar-td", sym: "d", word: "bad" },
      { i: 5, lesson: "ae", sym: "æ", word: "cat" },
    ],
  },
  {
    text: "Hot job.",
    expected: T("h ɑ t dʒ ɑ b"),
    checks: [
      { i: 1, lesson: "ah", sym: "ɑ", word: "hot" },
      { i: 4, lesson: "ah", sym: "ɑ", word: "job" },
    ],
  },
  {
    text: "A great day.",
    expected: T("ə g ɹ eɪ t d eɪ"),
    checks: [
      { i: 3, lesson: "ei", sym: "eɪ", word: "great" },
      { i: 5, lesson: "alveolar-td", sym: "d", word: "day" },
      { i: 6, lesson: "ei", sym: "eɪ", word: "day" },
    ],
  },
  {
    text: "No, go slow.",
    expected: T("n oʊ g oʊ s l oʊ"),
    checks: [
      { i: 1, lesson: "ou", sym: "oʊ", word: "no" },
      { i: 3, lesson: "ou", sym: "oʊ", word: "go" },
      { i: 6, lesson: "ou", sym: "oʊ", word: "slow" },
    ],
  },
  {
    text: "Sit in the seat.",
    expected: T("s ɪ t ɪ n ð ə s i t"),
    checks: [
      { i: 1, lesson: "i-ih", sym: "ɪ", word: "sit" },
      { i: 5, lesson: "th-voiced", sym: "ð", word: "the" },
      { i: 8, lesson: "i-ih", sym: "i", word: "seat" },
    ],
  },
  {
    text: "Five fine fans.",
    expected: T("f aɪ v f aɪ n f æ n z"),
    checks: [
      { i: 0, lesson: "f", sym: "f", word: "five" },
      { i: 2, lesson: "v-w", sym: "v", word: "five" },
      { i: 3, lesson: "f", sym: "f", word: "fine" },
      { i: 7, lesson: "ae", sym: "æ", word: "fans" },
    ],
  },
];
