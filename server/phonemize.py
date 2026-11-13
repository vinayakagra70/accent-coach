"""Text in, expected sounds out: how any word or sentence is pronounced.

Uses the espeak phonemizer that ships with kokoro-onnx. The speech model
(recognizer.py) was trained on espeak's phonemes, so what this writes is in
the same alphabet as what the model hears, stress marks included
("ðə wˈɔːɾɚ ɪz bˈɛɾɚ"). American and British.
"""
from __future__ import annotations

import re
import threading
from difflib import SequenceMatcher

LANGS = {"en-us", "en-gb"}
MAX_CHARS = 160
MAX_WORDS = 24

_WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)*")
_JOINERS = re.compile(r"[-‐-―/]")
_PUNCT = re.compile(r"[^\wɐ-˿̀-ͯᴀ-ᶿ]+")
_STRESS = re.compile(r"[ˈˌ]")


class PhonemizerNotReady(RuntimeError):
    pass


def split_words(text: str) -> list[str]:
    """The words as the learner typed them; a hyphen or slash separates words."""
    return _WORD.findall(_JOINERS.sub(" ", text))


def label_groups(words: list[str], groups: list[str], singles: list[str]) -> list[dict[str, str]]:
    """Says which typed word(s) each spoken group is.

    espeak usually writes one group per word, but runs small words together
    ("of the" -> "ʌvðə") and expands numbers ("33" -> two groups). `singles`
    is each word phonemized alone, used to find where the joins are.
    """
    if len(groups) == len(words):
        return [{"text": w, "ipa": g} for w, g in zip(words, groups)]
    if len(groups) > len(words) or not groups:
        # more spoken groups than typed words (numbers, abbreviations): no per-word labels
        return [{"text": " ".join(words), "ipa": " ".join(groups)}]
    out: list[dict[str, str]] = []
    i = 0
    for gi, g in enumerate(groups):
        left = len(groups) - gi - 1
        most = len(words) - i - left  # words this group may take and still leave one for each later group
        if left == 0:
            k = most
        else:
            bare = _STRESS.sub("", g)
            k = max(range(1, min(most, 4) + 1), key=lambda n: SequenceMatcher(None, bare, "".join(singles[i : i + n])).ratio())
        out.append({"text": " ".join(words[i : i + k]), "ipa": g})
        i += k
    return out


class Phonemizer:
    """espeak through kokoro-onnx's tokenizer, created on first use; thread-safe."""

    def __init__(self) -> None:
        self._tok = None
        self._lock = threading.Lock()
        self.error: str | None = None

    def _raw(self, text: str, lang: str) -> str:
        if self._tok is None:
            try:
                from kokoro_onnx.tokenizer import Tokenizer

                self._tok = Tokenizer()
            except Exception as exc:
                self.error = f"{type(exc).__name__}: {exc}"
                raise PhonemizerNotReady(self.error) from exc
        return self._tok.phonemize(text, lang)

    def words(self, text: str, lang: str = "en-us") -> list[dict[str, str]]:
        """[{"text": typed word(s), "ipa": how they're said}, ...] in speaking order."""
        lang = lang if lang in LANGS else "en-us"
        text = _JOINERS.sub(" ", " ".join(text.split()))[:MAX_CHARS]
        words = split_words(text)[:MAX_WORDS]
        if not words:
            return []
        with self._lock:
            spoken = self._raw(" ".join(words), lang)
            groups = [g for g in (_PUNCT.sub("", x) for x in spoken.split()) if g]
            singles = [] if len(groups) == len(words) else [_STRESS.sub("", _PUNCT.sub("", self._raw(w, lang))) for w in words]
        return label_groups(words, groups, singles)
