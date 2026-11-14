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
            # utf-8-sig: Notepad and PowerShell put a byte-order mark in front
            data = json.loads(self.path.read_text(encoding="utf-8-sig"))
        except (FileNotFoundError, ValueError, RecursionError):  # ValueError: bad JSON or bad UTF-8
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
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump({**data, "rev": rev}, f, ensure_ascii=False, indent=1)
                if current is None:
                    self._keep_aside()
                os.replace(tmp, self.path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            return rev

    def _keep_aside(self) -> None:
        """A file that is there but can't be read is the learner's data, damaged:
        move it next to the new one instead of writing over it."""
        try:
            if self.path.stat().st_size == 0:
                return
        except OSError:
            return
        n = 1
        while (aside := self.path.with_name(f"{self.path.stem}.unreadable-{n}{self.path.suffix}")).exists():
            n += 1
        os.replace(self.path, aside)


def _num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def summarize(p: dict[str, Any] | None) -> dict[str, Any]:
    """Never raises: the file can be hand-edited or saved by an older version."""
    if not p:
        return {"started": False, "text": "You haven't started Accent Coach yet."}
    course = p.get("course")
    course = [d if isinstance(d, dict) else {} for d in course] if isinstance(course, list) else []
    day = p.get("day")
    day = max(0, int(day)) if _num(day) and day == day and abs(day) < 1e9 else 0
    done = sum(1 for d in course if d.get("completedAt"))
    a = p.get("assessment")
    a = a if isinstance(a, dict) else {}
    lessons = a.get("lessons")
    lessons = lessons if isinstance(lessons, dict) else {}
    scored = [(k, v.get("score")) for k, v in lessons.items() if isinstance(v, dict) and _num(v.get("score"))]
    weak = [LESSON_TITLES.get(k, k) for k, s in sorted(scored, key=lambda x: x[1]) if s < 85][:3]
    strong = [LESSON_TITLES.get(k, k) for k, s in sorted(scored, key=lambda x: -x[1]) if s >= 85][:3]
    nxt = course[day] if day < len(course) else None
    next_txt = (
        "a check-up voice test" if nxt and nxt.get("kind") == "checkup"
        else LESSON_TITLES.get(nxt.get("lesson"), nxt.get("lesson")) if nxt else "nothing, the course is finished"
    )
    history = p.get("history")
    history = [h["overall"] for h in history if isinstance(h, dict) and _num(h.get("overall"))] if isinstance(history, list) else []
    parts = [f"Day {min(day + 1, len(course))} of {len(course)}, {done} done."]
    if a.get("overall") is not None:
        parts.append(f"Latest voice score {a['overall']} out of 100.")
    if len(history) >= 2:
        parts.append(f"That's {history[-1] - history[0]:+g} since your first test.")
    if weak:
        parts.append("Weakest sounds: " + ", ".join(weak) + ".")
    parts.append(f"Next up: {next_txt}.")
    streak = p.get("streak")
    streak = streak.get("count", 0) if isinstance(streak, dict) else 0
    streak = streak if _num(streak) else 0
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
