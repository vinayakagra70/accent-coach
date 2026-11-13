/**
 * A daily reminder to practise, as a repeating calendar event with an alert.
 *
 * Why the calendar and not a notification from the app: a web page can only
 * notify while it's open, and waking a closed app needs a push server, which
 * the phone build doesn't have (it's a static site). The phone's own calendar
 * rings on time whether or not the app is open, online or installed.
 */

export interface Reminder {
  /** 24-hour local time, "HH:MM". */
  time: string;
  /** Where the event's link opens: the app. */
  url: string;
  /** The first day it rings (defaults to today). */
  start?: Date;
}

export const REMINDER_TITLE = "Accent Coach: today's sound";
const DETAILS = "Ten minutes: one sound, four words and a sentence. Keep the streak going.";
const MINUTES = 10;

const two = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" → hours and minutes, or null when it isn't a time. */
export function parseTime(time: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/** Local date and time with no time zone ("floating"): 8 pm stays 8 pm wherever the phone is. */
function stamp(d: Date, h: number, m: number): string {
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}T${two(h)}${two(m)}00`;
}

function endStamp(d: Date, h: number, m: number): string {
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m + MINUTES);
  return stamp(end, end.getHours(), end.getMinutes());
}

/** Text values: backslash, semicolon, comma and newline are escaped (RFC 5545 §3.3.11). */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes continue on the next line after a space (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = bytes.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The .ics file: one event repeating every day, with an alert at its start. */
export function buildIcs(r: Reminder, now = new Date()): string {
  const t = parseTime(r.time);
  if (!t) throw new Error(`not a time: ${r.time}`);
  const day = r.start ?? now;
  const utc = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}T${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}Z`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Accent Coach//Daily reminder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // the same UID every time, so adding it again with a new time replaces the old one
    "UID:daily-reminder@accent-coach",
    `DTSTAMP:${utc}`,
    `DTSTART:${stamp(day, t.h, t.m)}`,
    `DTEND:${endStamp(day, t.h, t.m)}`,
    "RRULE:FREQ=DAILY",
    `SUMMARY:${esc(REMINDER_TITLE)}`,
    `DESCRIPTION:${esc(`${DETAILS}\n${r.url}`)}`,
    `URL:${r.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(REMINDER_TITLE)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

/** The same event as a link that opens Google Calendar's "new event" page, filled in. */
export function googleCalendarUrl(r: Reminder, now = new Date()): string {
  const t = parseTime(r.time);
  if (!t) throw new Error(`not a time: ${r.time}`);
  const day = r.start ?? now;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: REMINDER_TITLE,
    dates: `${stamp(day, t.h, t.m)}/${endStamp(day, t.h, t.m)}`,
    recur: "RRULE:FREQ=DAILY",
    details: `${DETAILS}\n${r.url}`,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** "20:00" → "8:00 pm", for showing the chosen time back. */
export function friendlyTime(time: string): string {
  const t = parseTime(time);
  if (!t) return time;
  return `${t.h % 12 || 12}:${two(t.m)} ${t.h < 12 ? "am" : "pm"}`;
}
