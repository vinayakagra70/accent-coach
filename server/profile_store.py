"""The learner profile on disk (data/profile.json), plus a plain summary JARVIS can speak."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

LESSON_TITLES = {
    "v-w": "V vs W", "th-voiceless": "TH as in think", "th-voiced": "TH as in this",
    "alveolar-td": "T and D (not curled)", "aspiration": "the puff on P, T, K", "z": "Z (not J)",
    "american-r": "the American R", "rhotic": "keeping the R (car, bird)", "flap-t": "the flap T (water)",
    "dark-l": "dark L", "ae": "the æ in cat", "ah": "the open AH in hot", "ei": "the AY glide (day)",
    "ou": "the OH glide (go)", "i-ih": "ship vs sheep", "f": "F (not Ph)",
}


class StaleProfile(Exception):
    """A save was based on an older copy than the one on disk (another device saved in between)."""

    def __init__(self, current: dict[str, Any]) -> None:
        super().__init__("profile changed on another device")
        self.current = current


def _rev(p: dict[str, Any] | None) -> int:
    r = (p or {}).get("rev")
    return r if isinstance(r, int) and not isinstance(r, bool) and r >= 0 else 0


class ProfileStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def save(self, data: dict[str, Any], base_rev: int | None = None) -> int:
        """Stores the profile under the next revision number and returns it.

        `base_rev` is the revision the caller's copy came from. If the copy on
        disk has moved on since, nothing is written and StaleProfile carries
        the current one, so a phone left open can't undo the laptop's progress.
        None skips the check.
        """
        with self._lock:
            current = self.load()
            if current is not None and base_rev is not None and base_rev != _rev(current):
                raise StaleProfile(current)
            rev = _rev(current) + 1
            self.path.parent.mkdir(parents=True, exist_ok=True)
            # write-then-rename so a crash never leaves half a file
            fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({**data, "rev": rev}, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
            return rev


def summarize(p: dict[str, Any] | None) -> dict[str, Any]:
    if not p:
        return {"started": False, "text": "You haven't started Accent Coach yet."}
    course = p.get("course") or []
    day = int(p.get("day") or 0)
    done = sum(1 for d in course if d.get("completedAt"))
    a = p.get("assessment") or {}
    lessons = a.get("lessons") or {}
    scored = [(k, v.get("score")) for k, v in lessons.items() if isinstance(v, dict) and v.get("score") is not None]
    weak = [LESSON_TITLES.get(k, k) for k, s in sorted(scored, key=lambda x: x[1]) if s < 85][:3]
    strong = [LESSON_TITLES.get(k, k) for k, s in sorted(scored, key=lambda x: -x[1]) if s >= 85][:3]
    nxt = course[day] if day < len(course) else None
    next_txt = (
        "a check-up voice test" if nxt and nxt.get("kind") == "checkup"
        else LESSON_TITLES.get(nxt.get("lesson"), nxt.get("lesson")) if nxt else "nothing, the course is finished"
    )
    history = p.get("history") or []
    parts = [f"Day {min(day + 1, len(course))} of {len(course)}, {done} done."]
    if a.get("overall") is not None:
        parts.append(f"Latest voice score {a['overall']} out of 100.")
    if len(history) >= 2:
        parts.append(f"That's {history[-1]['overall'] - history[0]['overall']:+d} since your first test.")
    if weak:
        parts.append("Weakest sounds: " + ", ".join(weak) + ".")
    parts.append(f"Next up: {next_txt}.")
    streak = (p.get("streak") or {}).get("count", 0)
    if streak:
        parts.append(f"Streak: {streak} day{'s' if streak != 1 else ''}.")
    return {
        "started": True,
        "day": day + 1,
        "days": len(course),
        "completed": done,
        "overall": a.get("overall"),
        "weakest": weak,
        "strongest": strong,
        "next": next_txt,
        "streak": streak,
        "text": " ".join(parts),
    }
