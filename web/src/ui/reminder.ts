import { buildIcs, friendlyTime, googleCalendarUrl, parseTime } from "../reminder";
import { $, h } from "./dom";
import { icons } from "./icons";

const TIME_KEY = "accentCoach.reminderTime";
const SET_KEY = "accentCoach.reminderSet";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the reminder still gets added, it just isn't remembered here */
  }
}

/** The time a reminder was last added from this device ("20:00"), or null. */
export function reminderTime(): string | null {
  const t = stored(SET_KEY);
  return t && parseTime(t) ? t : null;
}

/** Sheet for adding a daily practice reminder to the phone's or laptop's calendar. */
export function showReminder(onClose: () => void) {
  const o = $("overlay");
  o.hidden = false;
  o.replaceChildren();
  const close = () => {
    o.hidden = true;
    o.replaceChildren();
    onClose();
  };

  const saved = stored(TIME_KEY);
  const time = h("input", { type: "time", id: "reminderTime", value: saved && parseTime(saved) ? saved : "20:00", required: "" }) as HTMLInputElement;
  const status = h("p", { class: "note", role: "status" });
  const reminder = () => {
    const t = parseTime(time.value);
    if (!t) {
      status.textContent = "Pick a time first.";
      return null;
    }
    store(TIME_KEY, time.value);
    // the app's own address, without ?lesson=… or anything else that was in the link
    return { time: time.value, url: location.origin + location.pathname };
  };
  const added = (how: string) => {
    store(SET_KEY, time.value);
    status.textContent = `${how} It will ring every day at ${friendlyTime(time.value)}. To change the time, add it again; to stop it, delete the event in your calendar.`;
  };

  const file = h("button", { class: "btn primary" }, icons.bell(), "Add to my calendar");
  file.onclick = () => {
    const r = reminder();
    if (!r) return;
    const url = URL.createObjectURL(new Blob([buildIcs(r)], { type: "text/calendar;charset=utf-8" }));
    const a = h("a", { href: url, download: "accent-coach-reminder.ics" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    added("Open the downloaded file and confirm in your calendar.");
  };
  const google = h("button", { class: "btn" }, "Use Google Calendar");
  google.onclick = () => {
    const r = reminder();
    if (!r) return;
    window.open(googleCalendarUrl(r), "_blank", "noopener");
    added("Press Save on the Google Calendar page that opened.");
  };
  const done = h("button", { class: "linklike" }, "Close");
  done.onclick = close;

  o.append(
    h("div", { class: "sheet" },
      h("h2", {}, "Pick a time to practise"),
      h("p", { class: "lead" }, "Accent Coach adds a repeating event with an alert to your calendar, so your phone reminds you even when the app is closed."),
      h("div", { class: "row reminder-time" }, h("label", { for: "reminderTime" }, "Remind me at"), time),
      h("div", { class: "row" }, file, google),
      status,
      h("div", { class: "row" }, done)),
  );
  time.focus();
}
