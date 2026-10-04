// Figures of days: `::graph-uptime` (a glyph a day), `::graph-activity` (a contribution grid, weeks as columns) and
// `::graph-calendar` (one month). Dates are written `YYYY-MM-DD` and counted as whole days, in no time zone.
//
//   ::graph-uptime                       ::graph-activity                      ::graph-calendar
//   ---                                  ---                                   ---
//   title: backups                       title: notes written                  title: March
//   from: 2026-09-01                     ---                                   year: 2026
//   ---                                  - 2026-03-02: 0 1 4 2 0*3             month: 3
//   - ok*20 degraded ok*9 down ok*3      - 2026-03-09: 5 3 0 0 1 2 8           weekStartsOn: mon
//   ::                                   ::                                    ---
//                                                                              - 12: **launch**
//   live: query: "type=backup-run"       live: query: "type=chore"             - 20: the plot committee
//   (date: date, state: status,          count: created|updated                ::
//   last: 30), or source: backups                                              live: query + date: <property>
import { BOLD, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { wrap } from "../text";
import { expandRuns } from "@ep0ch/outline-core/figure-markdown";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, rowLink, type Props, type RowLink } from "./palette";

const DAY = 86_400_000;
/** `YYYY-MM-DD` (or a longer ISO time, or a Date) as a day number, or null. */
export function dayOf(v: unknown): number | null {
  if (v instanceof Date) return Math.floor(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) / DAY);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "").trim());
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY) : null;
}
export const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
/** The day a moment (epoch ms) falls on, as the person's clock says. */
export const localDay = (ms: number) => { const d = new Date(ms); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
/** Today, as the person's clock says, as a day number. */
export const today = () => localDay(Date.now());
/** A day's weekday, 0 Sunday to 6 Saturday. */
const weekday = (day: number) => (day + 4) % 7;
/** `weekStartsOn:` as 0 (Sunday) to 6: a number, or a day's name (`mon`, `Monday`). */
export function weekStart(v: unknown, fallback = 1): number {
  if (typeof v === "number" && v >= 0 && v <= 6) return Math.floor(v);
  const i = ["su", "mo", "tu", "we", "th", "fr", "sa"].indexOf(String(v ?? "").trim().toLowerCase().slice(0, 2));
  return i >= 0 ? i : fallback;
}
const NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── uptime ────────────────────────────────────────────────────────────────────

export type DayState = "ok" | "degraded" | "down" | "empty";
/** A status as written (ok, up, success; degraded, warn, partial; down, fail, error) as one of the four. */
export function dayState(v: unknown): DayState {
  const s = String(v ?? "").trim().toLowerCase();
  if (["ok", "up", "success", "succeeded", "pass", "passed", "done", "green"].includes(s)) return "ok";
  if (["degraded", "warn", "warning", "partial", "slow", "amber", "yellow"].includes(s)) return "degraded";
  if (["down", "fail", "failed", "failure", "error", "missed", "red"].includes(s)) return "down";
  return "empty";
}
const WORSE: Record<DayState, number> = { empty: 0, ok: 1, degraded: 2, down: 3 };
/** The worse of two days' states (a day with a failed run and a good one was degraded at best). */
export const worse = (a: DayState, b: DayState): DayState => (WORSE[a] >= WORSE[b] ? a : b);
const UPTIME_GLYPH: Record<DayState, [string, number]> = { ok: ["█", ACCENT], degraded: ["▒", INK], down: ["·", HI], empty: ["-", DIM] };

export function drawUptime(p: Props, w: number, link?: RowLink): string[] {
  if (p.days !== undefined && !Array.isArray(p.days)) return [fg(DIM) + "days: is a list of each day's status (ok, degraded, down); a live figure's window is last: 30" + RESET];
  const days: DayState[] = (p.days ?? []).map(dayState);
  const blocks: (string | undefined)[] = p.blocks ?? [];
  if (!days.length) return [fg(DIM) + "no days" + RESET];
  const per = Math.max(5, Math.min(Number(p.wrap) || 30, w));
  const out: string[] = [];
  for (let at = 0; at < days.length; at += per) {
    out.push(days.slice(at, at + per).map((d, i) => {
      const [g, c] = UPTIME_GLYPH[d];
      // A day that wasn't ok and has its note is a link: [ ] steps through the bad days, a click opens one.
      return fg(c) + (d !== "ok" ? rowLink(link, blocks[at + i], g) : g);
    }).join("") + RESET);
  }
  // `from:` alone: the days run on from it.
  const start = dayOf(p.from);
  const from = p.from ? String(p.from) : "", to = p.to ? String(p.to) : start !== null ? isoOf(start + days.length - 1) : "";
  const span = Math.min(per, days.length);
  if (from || to) out.push(fg(DIM) + (from + " ".repeat(Math.max(1, span - vwidth(from) - vwidth(to))) + to) + RESET);
  const seen = days.filter(d => d !== "empty"), ok = seen.filter(d => d === "ok").length;
  const pct = seen.length ? (Math.round((ok / seen.length) * 1000) / 10).toString() : "–";
  const count = (s: DayState) => days.filter(d => d === s).length;
  out.push("", fg(ACCENT) + BOLD + `${pct}% ok` + UNBOLD + fg(DIM) + ` · ${seen.length} of ${days.length} days · ${count("degraded")} degraded · ${count("down")} down` + RESET);
  return out;
}

/** Every value of the rows and paragraphs (`ok*20 degraded down`), in order; `- 2026-09-01: …` dates the first. */
export function uptimeMarkdown(md: Markdown): Props {
  // Each dated row starts at its date (a gap between rows is days with no run); an undated one follows on.
  const results: { day: number; state: DayState }[] = [], undated: string[] = [];
  let at: number | null = null;
  const put = (v: string) => { if (at === null) undated.push(v); else results.push({ day: at++, state: dayState(v) }); };
  for (const r of md.rows) { const d = dayOf(r.label); if (d !== null) at = d; r.values.forEach(put); }
  md.paragraphs.flatMap(p => expandRuns(p)).forEach(put);
  // Values before the first date are the days just before it.
  if (results.length) return uptimeDays([...undated.map((v, i) => ({ day: results[0]!.day - undated.length + i, state: dayState(v) })), ...results]);
  return undated.length ? { days: undated } : {};
}

/** A day per date from `from` to `to` (the results' own first and last when not given), each the worst state that day. */
export function uptimeDays(results: { day: number; state: DayState; block?: string }[], from?: number | null, to?: number | null): Props {
  if (!results.length && (from == null || to == null)) return { days: [] };
  const lo = from ?? Math.min(...results.map(r => r.day)), hi = to ?? Math.max(...results.map(r => r.day));
  const n = Math.max(0, Math.min(3660, hi - lo + 1));
  const days: DayState[] = Array(n).fill("empty"), blocks: (string | undefined)[] = Array(n).fill(undefined);
  for (const r of results) {
    const i = r.day - lo;
    if (i < 0 || i >= n) continue;
    const was = days[i]!;
    days[i] = worse(was, r.state);
    if (days[i] !== was || !blocks[i]) blocks[i] = r.block;
  }
  return { days, blocks, from: isoOf(lo), to: isoOf(hi) };
}

// ── activity ──────────────────────────────────────────────────────────────────

const SHADES = ["·", "░", "▒", "▓", "█"];
/** A count as one of five shades, by its share of the most in a day. */
const shade = (n: number, max: number) => (n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / Math.max(1, max)) * 4))));

export function drawActivity(p: Props, w: number): string[] {
  const counts = new Map<number, number>();
  for (const [k, v] of Object.entries(p.counts ?? {})) { const d = dayOf(k); if (d !== null) counts.set(d, (counts.get(d) ?? 0) + (Number(v) || 0)); }
  const start = weekStart(p.weekStartsOn, 0);
  const last = dayOf(p.to) ?? (counts.size ? Math.max(...counts.keys()) : today());
  const room = Math.max(4, Math.floor((w - 4) / 2));
  // The grid ends with the week holding `last`; each column is a week, each row a weekday from `start`.
  const end = last + ((start + 6 - weekday(last) + 7) % 7);
  const firstData = counts.size ? Math.min(...counts.keys()) : last;
  const wanted = Number(p.weeks) || Math.ceil((end - (firstData - ((weekday(firstData) - start + 7) % 7)) + 1) / 7);
  const weeks = Math.max(1, Math.min(53, room, wanted));
  const first = end - weeks * 7 + 1;
  const max = Math.max(1, ...[...counts].filter(([d]) => d >= first && d <= last).map(([, n]) => n));
  const out: string[] = [];
  // Month names over the week each month starts in.
  let months = "    ", at = 4;
  for (let c = 0; c < weeks; c++) {
    const col = first + c * 7;
    const m = new Date(col * DAY).getUTCMonth(), prev = new Date((col - 7) * DAY).getUTCMonth();
    if ((c === 0 || m !== prev) && 4 + c * 2 >= at) { const name = MONTHS[m]!; months += " ".repeat(4 + c * 2 - at) + name; at = 4 + c * 2 + name.length; }
  }
  out.push(fg(DIM) + months + RESET);
  for (let r = 0; r < 7; r++) {
    const wd = (start + r) % 7;
    // Monday, Wednesday and Friday are named, as GitHub's grid names them.
    const label = wd === 1 || wd === 3 || wd === 5 ? NAMES[wd]!.padEnd(4) : "    ";
    let line = fg(DIM) + label;
    for (let c = 0; c < weeks; c++) {
      const day = first + c * 7 + r;
      if (day > last) { line += "  "; continue; }
      const s = shade(counts.get(day) ?? 0, max);
      line += (s ? fg(s >= 3 ? ACCENT : INK) : fg(DIM)) + SHADES[s] + " ";
    }
    out.push(line + RESET);
  }
  const total = [...counts].filter(([d]) => d >= first && d <= last).reduce((a, [, n]) => a + n, 0);
  out.push("", fg(ACCENT) + BOLD + String(total) + UNBOLD + fg(DIM) + ` in ${weeks} week${weeks === 1 ? "" : "s"} · less ` + SHADES.map((g, i) => (i >= 3 ? fg(ACCENT) : i ? fg(INK) : fg(DIM)) + g).join("") + fg(DIM) + " more" + RESET);
  return out;
}

/** `- 2026-03-02: 0 1 4 2 0*3`: counts for that day and the days after it. */
export function activityMarkdown(md: Markdown): Props {
  const counts: Record<string, number> = {};
  for (const r of md.rows) {
    const d = dayOf(r.label);
    if (d === null) continue;
    r.values.forEach((v, i) => { const n = Number(v); if (Number.isFinite(n)) counts[isoOf(d + i)] = (counts[isoOf(d + i)] ?? 0) + n; });
  }
  return Object.keys(counts).length ? { counts } : {};
}

// ── calendar ──────────────────────────────────────────────────────────────────

/** A month's marks: each day's label and emphasis (the first mark of a day leads); `date` pins it to its month. */
interface Mark { day: number; date?: string; label: string; strong?: boolean; muted?: boolean; block?: string }

export function drawCalendar(p: Props, w: number, link?: RowLink): string[] {
  const now = dayOf(p.today) ?? today();
  const nowDate = new Date(now * DAY);
  const year = Number(p.year) || nowDate.getUTCFullYear(), month = Math.min(12, Math.max(1, Number(p.month) || nowDate.getUTCMonth() + 1));
  const start = weekStart(p.weekStartsOn, 1);
  const first = Math.floor(Date.UTC(year, month - 1, 1) / DAY), days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // A mark with a date shows only in its own month; one with a day number alone, in whichever month is shown.
  const marks: Mark[] = (p.marks ?? []).flatMap((m: Props) => {
    const on = dayOf(m.date);
    const day = on !== null ? on - first + 1 : Number(m.day);
    return day >= 1 && day <= days ? [{ ...m, day }] : [];
  });
  const marked = new Map<number, Mark>();
  for (const m of marks) if (!marked.has(m.day)) marked.set(m.day, m);
  const cw = 4;
  const out: string[] = [];
  const head = `${MONTH_NAMES[month - 1]} ${year}`;
  out.push(" ".repeat(Math.max(0, Math.floor((cw * 7 - head.length) / 2))) + fg(HI) + BOLD + head + UNBOLD + RESET);
  out.push(Array.from({ length: 7 }, (_, i) => fg(DIM) + NAMES[(start + i) % 7]!.padStart(cw - 1) + " ").join("") + RESET);
  const lead = (weekday(first) - start + 7) % 7;
  let line = "    ".repeat(lead);
  for (let d = 1; d <= days; d++) {
    const isToday = first + d - 1 === now, m = marked.get(d);
    const num = String(d).padStart(2);
    const ink = m ? (m.muted ? fg(INK) : fg(ACCENT) + BOLD) : fg(INK);
    line += isToday ? fg(HI) + "[" + ink + num + UNBOLD + fg(HI) + "]" : " " + ink + num + UNBOLD + " ";
    if ((lead + d) % 7 === 0 || d === days) { out.push(line + RESET); line = ""; }
  }
  if (marks.length) {
    out.push("");
    for (const m of [...marks].sort((a, b) => a.day - b.day)) {
      const label = wrap(m.label, Math.max(6, w - 5));
      label.forEach((l, i) => out.push((i ? "     " : (m.muted ? fg(DIM) : fg(ACCENT)) + String(m.day).padStart(2) + RESET + "   ") + (m.strong ? fg(HI) + BOLD : m.muted ? fg(DIM) : fg(INK)) + (i ? l : rowLink(link, m.block, l)) + UNBOLD + RESET));
    }
  }
  return out.map(l => (vwidth(l) > w ? pad(l, w) : l));
}

/** `- 12: launch`, `- 2026-03-12: launch` (a date in the month); bold leads, italic recedes. */
export function calendarMarkdown(md: Markdown): Props {
  const marks = md.rows.flatMap(r => {
    if (r.label === null) return [];
    const date = dayOf(r.label);
    const day = date !== null ? new Date(date * DAY).getUTCDate() : /^\d{1,2}$/.test(r.label) ? Number(r.label) : NaN;
    const mark = { day, label: r.value + (r.note ? ` — ${r.note}` : ""), strong: r.emphasis === "strong", muted: r.emphasis === "em", block: r.block };
    return Number.isFinite(day) ? [date !== null ? { ...mark, date: isoOf(date) } : mark] : [];
  });
  const dated = md.rows.map(r => dayOf(r.label)).find(d => d !== null);
  const ym = dated != null ? new Date(dated * DAY) : null;
  return { ...(marks.length ? { marks } : {}), ...(ym ? { year: ym.getUTCFullYear(), month: ym.getUTCMonth() + 1 } : {}) };
}

/** The month a live calendar shows (its `year`/`month`, else today's), as day numbers. */
export function monthOf(p: Props): { first: number; last: number; year: number; month: number } {
  const now = new Date((dayOf(p.today) ?? today()) * DAY);
  const year = Number(p.year) || now.getUTCFullYear(), month = Math.min(12, Math.max(1, Number(p.month) || now.getUTCMonth() + 1));
  return { first: Math.floor(Date.UTC(year, month - 1, 1) / DAY), last: Math.floor(Date.UTC(year, month, 0) / DAY), year, month };
}
