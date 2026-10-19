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
//   live: query: "type=backup-run", machinery: show     live: query: "type=chore"             - 20: the plot committee
//   (date: date, state: status,          count: created|updated                ::
//   last: 30), or source: backups                                              live: query + date: <property>
import { BOLD, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { rowLines, wrap } from "../text";
import { DAY, dayOf, dayState, isoOf, localDay, MONTH_ABBREVIATIONS, MONTH_NAMES, monthOf, today, uptimeDays, WEEKDAY_NAMES, weekday, weekStart, worse, type DayState } from "@ep0ch/outline-core/figure-props";
export { dayOf, dayState, isoOf, localDay, monthOf, today, uptimeDays, weekStart, worse, type DayState };
import { ACCENT, DIM, HI, INK, rowLink, type Props, type RowLink, SHADES } from "./palette";

const WEEKDAYS = WEEKDAY_NAMES, MONTHS = MONTH_ABBREVIATIONS;

// ── uptime ────────────────────────────────────────────────────────────────────

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



// ── activity ──────────────────────────────────────────────────────────────────

/** A count as one of five shades, by its share of the most in a day. */
const shade = (n: number, max: number) => (n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / Math.max(1, max)) * 4))));

export function drawActivity(p: Props, w: number, link?: RowLink): string[] {
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
    const label = wd === 1 || wd === 3 || wd === 5 ? WEEKDAYS[wd]!.padEnd(4) : "    ";
    let line = fg(DIM) + label;
    for (let c = 0; c < weeks; c++) {
      const day = first + c * 7 + r;
      if (day > last) { line += "  "; continue; }
      const s = shade(counts.get(day) ?? 0, max);
      const field = String(p.date ?? p.count ?? "created");
      const query = !p.date && (field === "created" || field === "updated")
        ? `${field} >= ${isoOf(day)} ${field} < ${isoOf(day + 1)}`
        : `${field} = ${isoOf(day)}`;
      const cell = (s ? fg(s >= 3 ? ACCENT : INK) : fg(DIM)) + SHADES[s];
      line += (link ? link(query, cell, undefined, query) : cell) + " ";
    }
    out.push(line + RESET);
  }
  const total = [...counts].filter(([d]) => d >= first && d <= last).reduce((a, [, n]) => a + n, 0);
  out.push("", fg(ACCENT) + BOLD + String(total) + UNBOLD + fg(DIM) + ` in ${weeks} week${weeks === 1 ? "" : "s"} · less ` + SHADES.map((g, i) => (i >= 3 ? fg(ACCENT) : i ? fg(INK) : fg(DIM)) + g).join("") + fg(DIM) + " more" + RESET);
  return out;
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
  out.push(Array.from({ length: 7 }, (_, i) => fg(DIM) + WEEKDAYS[(start + i) % 7]!.padStart(cw - 1) + " ").join("") + RESET);
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
      const label = rowLines(m.label, Math.max(6, w - 5));
      label.forEach((l, i) => out.push((i ? "     " : (m.muted ? fg(DIM) : fg(ACCENT)) + String(m.day).padStart(2) + RESET + "   ") + (m.strong ? fg(HI) + BOLD : m.muted ? fg(DIM) : fg(INK)) + (i ? l : rowLink(link, m.block, l)) + UNBOLD + RESET));
    }
  }
  return out.map(l => (vwidth(l) > w ? pad(l, w) : l));
}


