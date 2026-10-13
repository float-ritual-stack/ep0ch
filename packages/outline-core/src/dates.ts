// Dates as people write them, and how a property's value compares (PIE-769): the one reader of a date in a value
// (`2026-10-20`, `Oct 20`, `10/20`, `20 Oct`, `2026-10-20 4:23 PM`, a span `2026-10-20..2026-10-24`) and of a query's
// bound (those, plus `now`, `today`, `tomorrow`, `yesterday` and `-7d`/`+3d`). The service's query evaluator, its
// sorts and groups, and the save warnings all read dates here, so a date means one thing everywhere. Pure: no I/O; the
// caller passes the time.
//
// Dates are on the person's calendar, in no time zone: a written day is that day, and "today" is the day on the
// machine's clock (the outline host's, which is the person's). A time written with a zone (`Z`, `+02:00`) is moved to
// that clock first. Everything compares on one axis, the wall clock as milliseconds on a UTC line (`wallClock`).
//
// A change to what this reads or how it compares bumps PROTOCOL (protocol.ts).

import { splitPropertyValue } from "./property-grammar";

export const DAY_MS = 86_400_000;

/** A stretch of the calendar on the wall-clock axis, both ends included: a day is its whole 24 hours, a moment has `from === to`, a span runs from its first day's start to its last day's end. */
export interface When { from: number; to: number }

/** The comparisons a query writes between a property and a bound; `=` is "the same day", or "inside it" for a span. */
export type DateComparison = "<" | "<=" | ">" | ">=" | "=";

/** The wall clock at `ms` on this machine, as milliseconds on a UTC line: the axis every date is read on. */
export function wallClock(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** The moment (epoch ms) a wall-clock time stands for on this machine: `wallClock`'s inverse. */
export function fromWallClock(wall: number): number {
  const d = new Date(wall);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()).getTime();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_WORD = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAY = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\\.?,?\\s+";
const ORDINAL = "(?:st|nd|rd|th)?";
// A time after a date: `T09:30`, ` 4:23 PM`, `09:30:15Z`, `16:00+02:00`.
const TIME = "(?:[T\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d{1,3})?)?\\s*(am|pm)?\\s*(z|[+-]\\d{2}:?\\d{2})?)?";

const ISO = new RegExp(`^(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})${TIME}$`, "i");
const SLASHED = new RegExp(`^(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?${TIME}$`, "i");
const MONTH_DAY = new RegExp(`^(${MONTH_WORD})\\s+(\\d{1,2})${ORDINAL}(?:,?\\s+(\\d{4}))?${TIME}$`, "i");
const DAY_MONTH = new RegExp(`^(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?(${MONTH_WORD}),?(?:\\s+(\\d{4}))?${TIME}$`, "i");
const LEADING_WEEKDAY = new RegExp(`^${WEEKDAY}`, "i");

function monthOf(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().replace(/\.$/, "").slice(0, 3)) + 1;
}

/** The day's start on the axis, or null when there is no such day (Feb 30, month 13). */
function dayStart(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const start = Date.UTC(year, month - 1, day);
  const d = new Date(start);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? start : null;
}

/** A year-less date's year: the one that puts it nearest `now` (Oct 20 written in late December is next October's only past mid-April). */
function nearestYear(month: number, day: number, now: number): number | null {
  const year = new Date(now).getUTCFullYear();
  let best: { at: number; year: number } | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const at = dayStart(y, month, day);
    if (at !== null && (!best || Math.abs(at - now) < Math.abs(best.at - now))) best = { at, year: y };
  }
  return best?.year ?? null;
}

/** A date's day plus its time, if one was written. Null for an impossible clock or zone. */
function withTime(start: number, m: readonly (string | undefined)[], at: number): When | null {
  const [hour, minute, second, meridiem, zone] = m.slice(at, at + 5);
  if (hour === undefined) return { from: start, to: start + DAY_MS - 1 };
  let h = Number(hour);
  const min = Number(minute), sec = Number(second ?? 0);
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  let moment = start + ((h * 60 + min) * 60 + sec) * 1000;
  if (zone) {
    const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
    if (z && (Number(z[2]) > 23 || Number(z[3]) > 59)) return null;
    const offset = z ? (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60_000 : 0;
    moment = wallClock(moment - offset);
  }
  return { from: moment, to: moment };
}

/** One date (a day, or a moment when a time is written) as people write it, or null. `now` is on the wall-clock axis. */
function readOne(text: string, now: number): When | null {
  const t = text.trim().replace(LEADING_WEEKDAY, "");
  let m = ISO.exec(t);
  if (m) {
    const start = dayStart(Number(m[1]), Number(m[2]), Number(m[3]));
    return start === null ? null : withTime(start, m, 4);
  }
  m = SLASHED.exec(t);
  if (m) {
    // Month first (10/20), unless the first can't be a month and the second can (20/10).
    let month = Number(m[1]), day = Number(m[2]);
    if (month > 12 && day <= 12) [month, day] = [day, month];
    const year = m[3] === undefined ? nearestYear(month, day, now) : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const start = year === null ? null : dayStart(year, month, day);
    return start === null ? null : withTime(start, m, 4);
  }
  m = MONTH_DAY.exec(t);
  const n = m ? null : DAY_MONTH.exec(t);
  if (m || n) {
    const month = monthOf(m ? m[1]! : n![2]!), day = Number(m ? m[2] : n![1]), written = m ? m[3] : n![3];
    const year = written === undefined ? nearestYear(month, day, now) : Number(written);
    const start = year === null ? null : dayStart(year, month, day);
    return start === null ? null : withTime(start, (m ?? n)!, 4);
  }
  return null;
}

/**
 * A date in a property's value, as people write it: `2026-10-20`, `2026/10/20`, `Oct 20`, `October 20, 2026`, `20 Oct`,
 * `10/20` (month first unless that can't be: `20/10`), `10/20/26`, with a time after it (`2026-10-20 4:23 PM`,
 * `2026-10-20T09:30Z`) or a weekday before it (`Tue Oct 20`); or a span `<date>..<date>` (`2026-10-20..2026-10-24`,
 * `Oct 20..24`). A date without a year is in the year that puts it nearest `now`. Null when it reads as no date.
 */
export function readDate(text: string, now = wallClock(Date.now())): When | null {
  const span = text.indexOf("..");
  if (span < 0) return readOne(text, now);
  const first = readOne(text.slice(0, span), now);
  const rest = text.slice(span + 2).trim();
  if (!first) return null;
  // `Oct 20..24`: a bare day ends the span in the first date's month.
  const last = /^\d{1,2}$/.test(rest)
    ? (() => { const d = new Date(first.from); const s = dayStart(d.getUTCFullYear(), d.getUTCMonth() + 1, Number(rest)); return s === null ? null : { from: s, to: s + DAY_MS - 1 }; })()
    : readOne(rest, now);
  return last && last.to >= first.from ? { from: first.from, to: last.to } : null;
}

const RELATIVE = /^([+-])(\d{1,6})([hdw])$/;

/**
 * A query's date bound: `now`, `today`, `tomorrow`, `yesterday`, `-7d`/`+3d` (`h`, `d` or `w`, from now), or any date
 * `readDate` reads. Null when it is none of them.
 */
export function readDateBound(text: string, now = wallClock(Date.now())): When | null {
  const word = text.trim().toLowerCase();
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const day = (offset: number) => ({ from: today + offset * DAY_MS, to: today + (offset + 1) * DAY_MS - 1 });
  if (word === "now") return { from: now, to: now };
  if (word === "today") return day(0);
  if (word === "tomorrow") return day(1);
  if (word === "yesterday") return day(-1);
  const relative = RELATIVE.exec(word);
  if (relative) {
    const unit = relative[3] === "h" ? 3_600_000 : relative[3] === "d" ? DAY_MS : 7 * DAY_MS;
    const at = now + (relative[1] === "-" ? -1 : 1) * Number(relative[2]) * unit;
    return { from: at, to: at };
  }
  return readDate(text, now);
}

/**
 * Whether `subject` (a value's date) stands `op` to `bound`, any day of a span counting: `<` starts before the bound
 * does, `<=` starts by its end, `>` ends after its end, `>=` ends at or after its start, `=` shares a moment with it.
 * So day against day is the calendar's order, and a release window `2026-10-20..2026-10-24` holds `<= today` once it
 * has begun, `>= today` until it is over, and `= today` while today is inside it.
 */
export function whenHolds(subject: When, op: DateComparison, bound: When): boolean {
  switch (op) {
    case "<": return subject.from < bound.from;
    case "<=": return subject.from <= bound.to;
    case ">": return subject.to > bound.to;
    case ">=": return subject.to >= bound.from;
    case "=": return subject.from <= bound.to && subject.to >= bound.from;
  }
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** A decimal number written whole (`3`, `-2.5`), else null: `0x10`, `1e3` and `3 stars` are text. */
export function readNumber(text: string): number | null {
  const t = text.trim();
  return DECIMAL.test(t) ? Number(t) : null;
}

/** What a query compares a property with: a date (relative ones resolved at `now`), else a number, else text. */
export type Bound = { kind: "date"; when: When } | { kind: "number"; value: number } | { kind: "text"; value: string };

export function readBound(text: string, now = wallClock(Date.now())): Bound {
  const n = readNumber(text);
  if (n !== null) return { kind: "number", value: n };
  const when = readDateBound(text, now);
  if (when) return { kind: "date", when };
  return { kind: "text", value: text.trim() };
}

/**
 * Whether one property value stands `op` to `bound`: as dates when the bound is one, as numbers when it is a number,
 * as text (ignoring case, in the locale's order) otherwise. A value holding a list (`Oct 20, Oct 27`) holds when any
 * item does. Null when the value can't be read as the bound's kind: no match, and a query says so.
 */
export function valueHolds(value: string, op: DateComparison, bound: Bound, now = wallClock(Date.now())): boolean | null {
  const read = (item: string): boolean | null => {
    if (bound.kind === "date") {
      const when = readDate(item, now);
      return when ? whenHolds(when, op, bound.when) : null;
    }
    if (bound.kind === "number") {
      const n = readNumber(item);
      if (n === null) return null;
      return op === "<" ? n < bound.value : op === "<=" ? n <= bound.value : op === ">" ? n > bound.value : op === ">=" ? n >= bound.value : n === bound.value;
    }
    const c = item.trim().toLowerCase().localeCompare(bound.value.toLowerCase());
    return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === ">=" ? c >= 0 : c === 0;
  };
  const whole = read(value);
  if (whole !== null) return whole;
  const items = splitPropertyValue(value);
  if (items.length < 2) return null;
  let readable = false;
  for (const item of items) {
    const holds = read(item);
    if (holds) return true;
    if (holds === false) readable = true;
  }
  return readable ? false : null;
}

const DATE_SHAPE = new RegExp(
  `^(?:${WEEKDAY})?(?:${MONTH_WORD}\\s+\\d{1,2}${ORDINAL}(?:,?\\s+\\d{2,4})?|\\d{1,2}${ORDINAL}\\s+(?:of\\s+)?${MONTH_WORD},?(?:\\s+\\d{2,4})?`
  + `|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}/\\d{1,2}/\\d{2,4})(?:[T\\s,]+[\\d:.apmz+\\s-]*)?$`, "i");

/**
 * Whether `text` is shaped like a date, whole: a month's name and a day (`Oct 32`), or a full date in digits
 * (`2026-13-01`, `10/45/2026`). With `readDate` null it is a date the outline can't read, which a save warns about. A
 * score (`3/5`), a range of numbers (`1-2`) or a sentence starting with "May 5" is not.
 */
export function looksLikeDate(text: string): boolean {
  const t = text.trim();
  if (t.length > 40) return false;
  return t.split("..").every(side => DATE_SHAPE.test(side.trim()));
}

/** A date's day as `YYYY-MM-DD` on the wall-clock axis (a span's first day). */
export function isoDay(when: When): string {
  return new Date(when.from).toISOString().slice(0, 10);
}
