/**
 * A copy of the learner's progress as a file: to keep, or to carry to another
 * device. No account and nothing uploaded; the file is made and read in the
 * browser. Restoring checks the whole file first and only then writes, so a
 * wrong or damaged file changes nothing.
 */
import type { Profile } from "../course";
import { h } from "../ui/dom";
import "./backup.css";

export const BACKUP_APP = "accent-coach";
export const BACKUP_VERSION = 1;

/** Every key the app keeps in localStorage starts with this. */
const PREFIX = "accentCoach.";
/** The profile travels in the file's own `profile` field and goes back through the app's save path. */
const PROFILE_KEY = "accentCoach.profile.v1";
/** Not carried over: the profile (above) and where this phone checks recordings, which depends on the device. */
const NOT_CARRIED = new Set([PROFILE_KEY, "accentCoach.listenMode"]);
/** Far more than a real copy needs; anything bigger is not ours. */
const MAX_BYTES = 5 * 1024 * 1024;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  savedAt: string;
  profile: Profile | null;
  local: Record<string, string>;
}

export type ParseResult = { ok: true; backup: Backup; skippedKeys: number } | { ok: false; error: string };

export interface RestoreReport {
  ok: boolean;
  /** One sentence for the status line. */
  message: string;
  profileRestored: boolean;
  /** Keys written to localStorage. */
  settings: number;
}

/** The parts of localStorage this module touches (so tests can pass a plain object). */
export interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Anything with the text of a file: a File from an input, or a stand-in in tests. */
export interface FileLike {
  size?: number;
  text(): Promise<string>;
}

export interface BackupDeps {
  /** The profile the app has in memory right now (null before the first test or course). */
  getProfile: () => Profile | null;
  /** The app's own save: browser copy plus the server when there is one. */
  saveProfile: (p: Profile) => void;
  /** After a restore, so every screen shows the restored state. Default: reload the page. */
  reload?: () => void;
  /** Default: window.localStorage. */
  storage?: StorageLike;
}

export const NOT_A_BACKUP = "This file is not an Accent Coach backup.";
export const NEWER_VERSION = "This copy was made by a newer Accent Coach. Update the app on this device, then try again.";
export const DAMAGED = "This Accent Coach backup is damaged and can't be restored.";

/** True for keys the app owns and a copy carries between devices. */
export function isCarriedKey(key: string): boolean {
  return key.startsWith(PREFIX) && !NOT_CARRIED.has(key);
}

/** The app's own keys out of a storage, as plain text values. */
export function snapshotStorage(storage: StorageLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k === null || !isCarriedKey(k)) continue;
    const v = storage.getItem(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function buildBackup(profile: Profile | null, localStorageSnapshot: Record<string, string>, now = new Date()): Backup {
  const local: Record<string, string> = {};
  for (const [k, v] of Object.entries(localStorageSnapshot)) if (isCarriedKey(k) && typeof v === "string") local[k] = v;
  return { app: BACKUP_APP, version: BACKUP_VERSION, savedAt: now.toISOString(), profile, local };
}

export function backupFilename(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `accent-coach-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}

// ------------------------------------------------------------------ checking a file

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;

/** Enough of the profile's shape that the app can open it without falling over. */
function profileOk(p: unknown): p is Profile {
  if (!isObj(p)) return false;
  if (p.version !== 1 || typeof p.updatedAt !== "string" || typeof p.skippedTest !== "boolean") return false;
  if (p.accent !== undefined && p.accent !== "us" && p.accent !== "uk") return false;
  if (!Array.isArray(p.course) || !p.course.every((d) => isObj(d)
    && (d.kind === "checkup" || (d.kind === "lesson" && typeof d.lesson === "string"))
    && (d.completedAt === undefined || typeof d.completedAt === "string"))) return false;
  if (!isCount(p.day) || p.day > p.course.length) return false;
  if (!Array.isArray(p.history) || !p.history.every((x) => isObj(x) && typeof x.date === "string" && isNum(x.overall))) return false;
  const a = p.assessment;
  if (a !== null) {
    if (!isObj(a) || typeof a.date !== "string" || !isNum(a.overall) || !isObj(a.lessons)) return false;
    for (const r of Object.values(a.lessons)) {
      if (!isObj(r) || !(r.score === null || isNum(r.score)) || !isNum(r.good) || !isNum(r.total) || !Array.isArray(r.findings)) return false;
    }
  }
  const t = p.today;
  if (!isObj(t) || typeof t.learnedTarget !== "boolean" || typeof t.learnedHabit !== "boolean"
    || !isCount(t.earAnswered) || !isCount(t.earRight) || !isCount(t.speakTries) || !isCount(t.speakGood)) return false;
  const s = p.streak;
  if (!isObj(s) || !isCount(s.count) || !(s.lastDate === null || typeof s.lastDate === "string")) return false;
  if (p.practice !== undefined) {
    if (!isObj(p.practice)) return false;
    for (const l of Object.values(p.practice)) {
      if (!isObj(l) || !isCount(l.listenRight) || !isCount(l.listenTotal) || !isNum(l.bestVowel)
        || !(l.lastPracticed === null || typeof l.lastPracticed === "string")) return false;
    }
  }
  if (p.review !== undefined && !isObj(p.review)) return false;
  if (p.rev !== undefined && !isCount(p.rev)) return false;
  return true;
}

/**
 * Reads the text of a file. Either the whole thing is a usable backup, or the
 * answer is an error to show; there is no in-between. Keys in `local` that are
 * not the app's own are dropped (and counted), never written.
 */
export function parseBackup(text: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (typeof text !== "string" || text.length > MAX_BYTES) return fail(NOT_A_BACKUP);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A backup cut short in transit still names the app; anything else was never ours.
    return fail(text.includes(`"${BACKUP_APP}"`) ? DAMAGED : NOT_A_BACKUP);
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) return fail(NOT_A_BACKUP);
  if (!isNum(raw.version) || !Number.isInteger(raw.version) || raw.version < 1) return fail(DAMAGED);
  if (raw.version > BACKUP_VERSION) return fail(NEWER_VERSION);
  if (typeof raw.savedAt !== "string" || Number.isNaN(Date.parse(raw.savedAt))) return fail(DAMAGED);
  if (!("profile" in raw) || !(raw.profile === null || profileOk(raw.profile))) return fail(DAMAGED);
  if (!isObj(raw.local)) return fail(DAMAGED);

  const local: Record<string, string> = {};
  let skippedKeys = 0;
  for (const [k, v] of Object.entries(raw.local)) {
    if (!isCarriedKey(k)) {
      skippedKeys++;
      continue;
    }
    if (typeof v !== "string") return fail(DAMAGED);
    local[k] = v;
  }
  return { ok: true, backup: { app: BACKUP_APP, version: raw.version, savedAt: raw.savedAt, profile: raw.profile, local }, skippedKeys };
}

// ------------------------------------------------------------------ words for the screen

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "14 lessons, 3 voice tests", or "no progress yet". */
export function describeProgress(p: Profile | null): string {
  if (!p) return "no progress yet";
  const lessons = p.course.filter((d) => d.kind === "lesson" && d.completedAt).length;
  const tests = p.history.length;
  if (!lessons && !tests) return "no progress yet";
  return `${count(lessons, "lesson", "lessons")}, ${count(tests, "voice test", "voice tests")}`;
}

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown date" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** What the confirm step says before anything is written. */
export function confirmText(current: Profile | null, backup: Backup): string {
  return `This replaces your progress on this device: ${describeProgress(current)}. The copy from ${friendlyDate(backup.savedAt)} has ${describeProgress(backup.profile)}.`;
}

// ------------------------------------------------------------------ saving and restoring

function storageOf(deps: BackupDeps): StorageLike {
  return deps.storage ?? localStorage;
}

/** The copy as it would be saved right now. */
export function currentBackup(deps: BackupDeps, now = new Date()): Backup {
  let snapshot: Record<string, string> = {};
  try {
    snapshot = snapshotStorage(storageOf(deps));
  } catch {
    /* storage blocked: the profile in memory is still worth keeping */
  }
  return buildBackup(deps.getProfile(), snapshot, now);
}

/** Hands the learner the file. Returns its name. */
export function downloadBackup(deps: BackupDeps, now = new Date()): string {
  const name = backupFilename(now);
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentBackup(deps, now), null, 1)], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** Step one of a restore: read and check the file. Writes nothing. */
export async function readBackup(file: FileLike): Promise<ParseResult> {
  if (typeof file.size === "number" && file.size > MAX_BYTES) return { ok: false, error: NOT_A_BACKUP };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "Couldn't read that file. Try choosing it again." };
  }
  return parseBackup(text);
}

/**
 * Step two: write a checked backup. The app's own keys are put back first and
 * undone if the browser refuses one, so the device never ends up half restored;
 * the profile then goes through the app's own save.
 */
export function applyBackup(backup: Backup, deps: BackupDeps): RestoreReport {
  const failed = (message: string): RestoreReport => ({ ok: false, message, profileRestored: false, settings: 0 });
  let storage: StorageLike;
  let before: Record<string, string>;
  try {
    storage = storageOf(deps);
    before = snapshotStorage(storage);
  } catch {
    return failed("This browser is blocking storage, so nothing was restored.");
  }
  const wanted = Object.entries(backup.local).filter(([k]) => isCarriedKey(k));
  try {
    for (const k of Object.keys(before)) if (!(k in backup.local)) storage.removeItem(k);
    for (const [k, v] of wanted) storage.setItem(k, v);
  } catch {
    try {
      for (const [k] of wanted) if (!(k in before)) storage.removeItem(k);
      for (const [k, v] of Object.entries(before)) storage.setItem(k, v);
    } catch {
      /* nothing more can be done; the profile below was not touched */
    }
    return failed("There wasn't room to restore this copy. Nothing was changed.");
  }

  let profileRestored = false;
  if (backup.profile) {
    // `rev` is the other device's server number; this device's own save path supplies the right one.
    const { rev: _rev, ...rest } = backup.profile;
    deps.saveProfile(rest as Profile);
    profileRestored = true;
  }
  const what = profileRestored ? describeProgress(backup.profile) : "your settings (the copy had no course in it)";
  return { ok: true, message: `Restored ${what}.`, profileRestored, settings: wanted.length };
}

/** Both steps in one go, for callers that have already asked. */
export async function restoreBackup(file: FileLike, deps: BackupDeps): Promise<RestoreReport> {
  const parsed = await readBackup(file);
  if (!parsed.ok) return { ok: false, message: parsed.error, profileRestored: false, settings: 0 };
  return applyBackup(parsed.backup, deps);
}

// ------------------------------------------------------------------ the two buttons

export function renderBackup(container: HTMLElement, deps: BackupDeps): void {
  const status = h("p", { class: "note backup-status", role: "status", "aria-live": "polite" });
  const save = h("button", { class: "btn", type: "button" }, "Save a copy");
  const restore = h("button", { class: "btn", type: "button" }, "Restore from a copy");
  const input = h("input", { type: "file", accept: "application/json,.json", class: "backup-file", tabindex: "-1", "aria-hidden": "true" });
  input.hidden = true;
  const confirm = h("div", { class: "backup-confirm" });
  confirm.hidden = true;

  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle("bad", bad);
  };
  const closeConfirm = () => {
    confirm.hidden = true;
    confirm.replaceChildren();
    save.disabled = restore.disabled = false;
  };

  save.onclick = () => {
    try {
      const name = downloadBackup(deps);
      say(`Saved as ${name}. Keep it, or open it in Accent Coach on another device.`);
    } catch (e) {
      say(`Couldn't save a copy: ${(e as Error).message}`, true);
    }
  };

  restore.onclick = () => {
    input.value = ""; // choosing the same file twice still counts
    input.click();
  };

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    say("");
    const parsed = await readBackup(file);
    if (!parsed.ok) {
      say(parsed.error, true);
      return;
    }
    const yes = h("button", { class: "btn primary", type: "button" }, "Replace my progress");
    const no = h("button", { class: "btn", type: "button" }, "Cancel");
    no.onclick = () => {
      closeConfirm();
      say("Nothing was changed.");
      restore.focus();
    };
    yes.onclick = () => {
      yes.disabled = no.disabled = true;
      const report = applyBackup(parsed.backup, deps);
      closeConfirm();
      if (!report.ok) {
        say(report.message, true);
        return;
      }
      say(`${report.message} Reloading...`);
      save.disabled = restore.disabled = true;
      setTimeout(deps.reload ?? (() => location.reload()), 1200);
    };
    confirm.replaceChildren(h("p", {}, confirmText(deps.getProfile(), parsed.backup)), h("div", { class: "row" }, yes, no));
    confirm.hidden = false;
    save.disabled = restore.disabled = true;
    no.focus();
  };

  container.append(
    h("div", { class: "backup" },
      h("h3", {}, "Keep a copy"),
      h("p", { class: "note" }, "Save your progress as a file, or move it to another device. Nothing is uploaded."),
      h("div", { class: "row" }, save, restore, input),
      confirm,
      status),
  );
}
