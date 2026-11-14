/** The streak card: current and longest streak, and twelve weeks of practised / not. */
import "./streak.css";
import { h } from "../ui/dom";
import { loadPracticeLog, practiceDays, streakStats, streakSummary, weekGrid, type DatedProfile } from "./streak";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-14" as "14 Nov". */
function friendly(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Fill `container` with the streak card. `days` defaults to everything known:
 * the browser's practice log plus the dates in the profile.
 */
export function renderStreak(container: HTMLElement, opts: { profile?: DatedProfile | null; days?: string[]; now?: Date; weeks?: number } = {}): void {
  const now = opts.now ?? new Date();
  const days = opts.days ?? practiceDays(opts.profile, loadPracticeLog());
  const stats = streakStats(days, now);
  const grid = weekGrid(days, now, opts.weeks ?? 12);
  const summary = streakSummary(stats);

  const fig = (value: number, label: string) => h("div", { class: "streak-fig" }, h("b", {}, String(value)), h("span", {}, label));

  // Month names above the first week that starts in each month.
  let lastMonth = -1;
  const months = grid.map((col) => {
    const m = Number(col[0].key.slice(5, 7)) - 1;
    const label = m !== lastMonth ? MONTHS[m] : "";
    lastMonth = m;
    return h("span", {}, label);
  });

  const cells = grid.map((col) =>
    h("div", { class: "streak-week" }, ...col.map((d) =>
      h("i", {
        class: `streak-day${d.practised ? " on" : ""}${d.today ? " today" : ""}${d.future ? " future" : ""}`,
        title: d.future ? undefined : `${friendly(d.key)}: ${d.practised ? "practised" : "no practice"}`,
      }))));

  const hint = !stats.total
    ? "Do any exercise today to start a streak."
    : stats.practisedToday
      ? `${stats.last7} of the last 7 days practised.`
      : stats.current
        ? "Not practised yet today. Any exercise keeps the streak."
        : `${stats.last7} of the last 7 days practised.`;

  container.replaceChildren(
    h("section", { class: "streak-card", "aria-label": "Practice streak" },
      // Screen readers get one sentence; the figures and squares below say the same thing by eye.
      h("p", { class: "streak-sr" }, summary),
      h("div", { class: "streak-figs", "aria-hidden": "true" },
        fig(stats.current, "day streak"),
        fig(stats.longest, "longest"),
        fig(stats.last7, "of last 7 days")),
      h("div", { class: "streak-cal", role: "img", "aria-label": `Last ${grid.length} weeks: practised on ${grid.flat().filter((d) => d.practised).length} days.` },
        h("div", { class: "streak-months", "aria-hidden": "true" }, ...months),
        h("div", { class: "streak-grid", "aria-hidden": "true" }, ...cells)),
      h("p", { class: "streak-hint", "aria-hidden": "true" }, hint)),
  );
}
