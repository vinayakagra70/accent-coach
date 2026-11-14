/** Keeping a copy of progress and restoring it: the file's shape, what is refused, and what gets written. */
import { completeDay, newProfile, type Assessment, type Profile } from "../src/course";
import {
  DAMAGED,
  NEWER_VERSION,
  NOT_A_BACKUP,
  applyBackup,
  backupFilename,
  buildBackup,
  confirmText,
  currentBackup,
  describeProgress,
  parseBackup,
  restoreBackup,
  snapshotStorage,
  type StorageLike,
} from "../src/features/backup";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

/** A localStorage stand-in; `full` makes writes of that key throw, like a full disk. */
function fakeStorage(init: Record<string, string> = {}, full?: string): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (k === full) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
  };
}

const assessment: Assessment = {
  date: "2026-11-01T10:00:00.000Z",
  overall: 62,
  lessons: { "v-w": { score: 40, good: 2, total: 5, findings: [{ word: "vine", heard: "w", habit: "w for v" }] }, z: { score: null, good: 0, total: 0, findings: [] } },
};

function sampleProfile(): Profile {
  let p = newProfile(assessment, false);
  p = completeDay(p, new Date(2026, 10, 2, 9));
  p = completeDay(p, new Date(2026, 10, 3, 9));
  return { ...p, rev: 7, practice: { "v-w": { listenRight: 4, listenTotal: 6, bestVowel: 80, lastPracticed: "2026-11-03T09:00:00.000Z" } } };
}

const local = { "accentCoach.voice": "high", "accentCoach.phrasesClean": '["us|hello"]', "accentCoach.progress.v1": "{}" };
const now = new Date(2026, 10, 14, 8, 5);

// the file
{
  const p = sampleProfile();
  const b = buildBackup(p, local, now);
  check(b.app === "accent-coach" && b.version === 1 && b.savedAt === now.toISOString(), "a backup names the app, its version and when it was saved");
  check(backupFilename(now) === "accent-coach-2026-11-14.json", `the file is named by the learner's own date (${backupFilename(now)})`);

  const back = parseBackup(JSON.stringify(b));
  check(back.ok && JSON.stringify(back.backup) === JSON.stringify(b), "round trip: what is saved is what is read back");
  check(back.ok && back.skippedKeys === 0, "round trip: nothing is dropped");

  const empty = parseBackup(JSON.stringify(buildBackup(null, {}, now)));
  check(empty.ok && empty.backup.profile === null, "a copy made before any course is still a valid backup");
}

// what a copy carries
{
  const s = fakeStorage({ ...local, "accentCoach.profile.v1": "{}", "accentCoach.listenMode": "online", theme: "dark", "otherApp.token": "secret" });
  const snap = snapshotStorage(s);
  check(Object.keys(snap).sort().join() === Object.keys(local).sort().join(), "only the app's own keys are copied; the profile key and the per-device listener choice are left out");
  const b = buildBackup(null, { ...local, "otherApp.token": "secret", "accentCoach.profile.v1": "{}" }, now);
  check(!("otherApp.token" in b.local) && !("accentCoach.profile.v1" in b.local), "buildBackup filters a snapshot that was not filtered");
}

// files that are refused
{
  const err = (text: string) => {
    const r = parseBackup(text);
    return r.ok ? "accepted" : r.error;
  };
  const good = buildBackup(sampleProfile(), local, now);
  const with_ = (change: Record<string, unknown>) => JSON.stringify({ ...good, ...change });
  const withProfile = (change: Record<string, unknown>) => with_({ profile: { ...good.profile, ...change } });

  check(err("not json at all") === NOT_A_BACKUP, "bad JSON: not an Accent Coach backup");
  check(err("") === NOT_A_BACKUP, "an empty file: not an Accent Coach backup");
  check(err(JSON.stringify(good).slice(0, 200)) === DAMAGED, "a backup cut short is called damaged");
  check(err("[1,2,3]") === NOT_A_BACKUP && err("null") === NOT_A_BACKUP && err('"accent-coach"') === NOT_A_BACKUP, "JSON that is not an object: not a backup");
  check(err(with_({ app: "other-app" })) === NOT_A_BACKUP, "wrong app: not a backup");
  check(err(JSON.stringify({ version: 1, profile: null, local: {} })) === NOT_A_BACKUP, "no app name: not a backup");
  check(err(with_({ version: 2 })) === NEWER_VERSION, "a future version asks for an update");
  check(err(with_({ version: "1" })) === DAMAGED && err(with_({ version: 0 })) === DAMAGED && err(with_({ version: 1.5 })) === DAMAGED, "a version that is not a whole number from 1: damaged");

  const { savedAt: _s, ...noSavedAt } = good;
  const { profile: _p, ...noProfile } = good;
  const { local: _l, ...noLocal } = good;
  check(err(JSON.stringify(noSavedAt)) === DAMAGED, "missing savedAt: damaged");
  check(err(JSON.stringify(noProfile)) === DAMAGED, "missing profile: damaged");
  check(err(JSON.stringify(noLocal)) === DAMAGED, "missing local: damaged");
  check(err(with_({ savedAt: "yesterday" })) === DAMAGED, "a savedAt that is not a date: damaged");
  check(err(with_({ local: [] })) === DAMAGED && err(with_({ local: "x" })) === DAMAGED, "local that is not an object: damaged");
  check(err(with_({ local: { "accentCoach.voice": 5 } })) === DAMAGED, "an app key whose value is not text: damaged");

  check(err(with_({ profile: [] })) === DAMAGED && err(with_({ profile: "x" })) === DAMAGED, "a profile that is not an object: damaged");
  check(err(withProfile({ version: 2 })) === DAMAGED, "a profile of another version: damaged");
  check(err(withProfile({ course: "none" })) === DAMAGED, "a profile whose course is not a list: damaged");
  check(err(withProfile({ course: [{ kind: "party" }] })) === DAMAGED, "an unknown kind of course day: damaged");
  check(err(withProfile({ course: [{ kind: "lesson" }] })) === DAMAGED, "a lesson day with no lesson: damaged");
  check(err(withProfile({ day: -1 })) === DAMAGED && err(withProfile({ day: 9999 })) === DAMAGED, "a day outside the course: damaged");
  check(err(withProfile({ history: [{ date: "x" }] })) === DAMAGED, "a history entry with no score: damaged");
  check(err(withProfile({ assessment: { overall: 50 } })) === DAMAGED, "a voice test with no lessons: damaged");
  check(err(withProfile({ streak: null })) === DAMAGED && err(withProfile({ today: undefined })) === DAMAGED, "missing streak or today: damaged");
  check(err(withProfile({ practice: { "v-w": { listenRight: "4" } } })) === DAMAGED, "practice counts that are not numbers: damaged");
  check(err(withProfile({ accent: "fr" })) === DAMAGED, "an accent the app doesn't teach: damaged");
  check(err(withProfile({ assessment: null, accent: "uk" })) === "accepted", "a profile with no voice test, British: accepted");
}

// foreign keys in a file are never written
{
  const b = buildBackup(sampleProfile(), local, now);
  const tampered = JSON.stringify({ ...b, local: { ...b.local, "otherApp.token": "stolen", theme: 5, "accentCoach.profile.v1": "{\"evil\":1}", "accentCoach.listenMode": "online" } });
  const r = parseBackup(tampered);
  check(r.ok && r.skippedKeys === 4, "foreign keys in the file are dropped and counted, whatever their value");
  check(r.ok && Object.keys(r.backup.local).sort().join() === Object.keys(local).sort().join(), "only the app's own keys survive parsing");

  const storage = fakeStorage({ "otherApp.token": "mine", theme: "dark", "accentCoach.listenMode": "device", "accentCoach.profile.v1": "old", "accentCoach.ownText": "left over" });
  const saved: Profile[] = [];
  const report = r.ok ? applyBackup(r.backup, { getProfile: () => null, saveProfile: (p) => saved.push(p), storage }) : null;
  check(!!report?.ok && report.profileRestored && report.settings === 3, "restore reports the profile and three settings");
  check(storage.map.get("otherApp.token") === "mine" && storage.map.get("theme") === "dark", "another site's keys on this device are untouched");
  check(storage.map.get("accentCoach.listenMode") === "device" && storage.map.get("accentCoach.profile.v1") === "old", "the per-device choice and the raw profile key are not written directly");
  check(storage.map.get("accentCoach.voice") === "high" && storage.map.get("accentCoach.phrasesClean") === '["us|hello"]', "the app's keys are restored");
  check(!storage.map.has("accentCoach.ownText"), "an app key the copy doesn't have is cleared, so the device matches the copy");
  check(saved.length === 1 && saved[0].rev === undefined && saved[0].day === 2, "the profile goes through the app's save once, without the other device's revision number");
  check(saved[0].practice?.["v-w"]?.listenTotal === 6, "practice results travel inside the profile");
}

// restoring from a file, start to finish
{
  const file = (text: string) => ({ size: text.length, text: async () => text });
  const source = fakeStorage({ ...local, "accentCoach.profile.v1": "{}" });
  const p = sampleProfile();
  const text = JSON.stringify(currentBackup({ getProfile: () => p, saveProfile: () => {}, storage: source }, now));

  const target = fakeStorage({ "accentCoach.voice": "low" });
  const saved: Profile[] = [];
  const deps = { getProfile: () => null, saveProfile: (x: Profile) => void saved.push(x), storage: target };
  const ok = await restoreBackup(file(text), deps);
  check(ok.ok && ok.message === "Restored 2 lessons, 1 voice test.", `a good file is restored and says what came back (${ok.message})`);
  check(target.map.get("accentCoach.voice") === "high" && saved.length === 1, "the other device now has the settings and the profile");

  // a bad file writes nothing at all
  const untouched = fakeStorage({ "accentCoach.voice": "low" });
  const none: Profile[] = [];
  const bad = await restoreBackup(file(text.replace('"version":1,', '"version":3,')), { getProfile: () => null, saveProfile: (x) => void none.push(x), storage: untouched });
  check(!bad.ok && bad.message === NEWER_VERSION && none.length === 0 && untouched.map.get("accentCoach.voice") === "low" && untouched.map.size === 1, "a refused file changes nothing");

  const unreadable = await restoreBackup({ text: async () => { throw new Error("gone"); } }, deps);
  check(!unreadable.ok && saved.length === 1, "a file that can't be read is reported, not thrown");
  const huge = await restoreBackup({ size: 50 * 1024 * 1024, text: async () => text }, deps);
  check(!huge.ok && huge.message === NOT_A_BACKUP, "a file far too big is refused without being read");

  // the browser refuses a write half way: everything is put back, the profile is not saved
  const start = { "accentCoach.voice": "low", "accentCoach.ownText": "mine" };
  const fullDisk = fakeStorage(start, "accentCoach.progress.v1");
  const half: Profile[] = [];
  const r = await restoreBackup(file(text), { getProfile: () => null, saveProfile: (x) => void half.push(x), storage: fullDisk });
  check(!r.ok && half.length === 0, "a write that fails half way is reported and the profile is left alone");
  check(JSON.stringify(Object.fromEntries([...fullDisk.map].sort())) === JSON.stringify(Object.fromEntries(Object.entries(start).sort())), "and the keys already written are put back as they were");

  // a copy with no course restores settings only
  const blank = await restoreBackup(file(JSON.stringify(buildBackup(null, local, now))), { getProfile: () => p, saveProfile: (x) => void none.push(x), storage: fakeStorage() });
  check(blank.ok && !blank.profileRestored && none.length === 0, "a copy with no course in it restores settings and leaves the profile alone");
}

// the words on screen
{
  const p = sampleProfile();
  check(describeProgress(null) === "no progress yet" && describeProgress(newProfile(null, true)) === "no progress yet", "nothing done reads as no progress yet");
  check(describeProgress(p) === "2 lessons, 1 voice test", `counts are in plain words (${describeProgress(p)})`);
  const text = confirmText(p, buildBackup(newProfile(null, true), {}, now));
  check(text.startsWith("This replaces your progress on this device: 2 lessons, 1 voice test.") && text.endsWith("has no progress yet."), `the confirm step says what goes and what comes (${text})`);
  check(!/[—–]/.test(text), "no dashes in the confirm text");
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
