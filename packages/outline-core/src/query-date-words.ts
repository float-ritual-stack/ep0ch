import { DAY_MS, fromWallClock, readDateBound, wallClock, type When } from "./dates";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DATE_WORDS = /\b(?:updated\s+)?(?:last week|this week|tonight|since (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|today|yesterday|tomorrow|\d{4}-\d{2}-\d{2})\b|[+-]\d+[dmhw]\b/gi;

/** Dates use the reader's zone, and a week starts Monday. Bounds carry their zone back to any host. */
export function queryDateWords(text: string, zone: string, now = Date.now()): { words: string; clause: string }[] {
  const wall = wallClock(now, zone), today = readDateBound("today", wall)!;
  const weekday = new Date(today.from).getUTCDay();
  return [...text.matchAll(DATE_WORDS)].flatMap(m => {
    const word = m[0].toLowerCase().replace(/^updated\s+/, "");
    let when: When | null;
    if (word.endsWith(" week")) {
      const monday = today.from - ((weekday + 6) % 7) * DAY_MS;
      const start = monday - (word === "last week" ? 7 * DAY_MS : 0);
      when = { from: start, to: start + 7 * DAY_MS - 1 };
    } else if (word.startsWith("since ")) {
      when = { from: today.from - ((weekday - DAYS.indexOf(word.slice(6)) + 7) % 7) * DAY_MS, to: wall };
    } else if (word === "tonight") when = { from: today.from + 18 * 3_600_000, to: today.to };
    else when = readDateBound(word, wall);
    if (!when) return [];
    const bound = (at: number) => JSON.stringify(new Date(fromWallClock(at, zone)).toISOString());
    return [{ words: m[0], clause: `updated >= ${bound(when.from)} AND updated <= ${bound(when.to)}` }];
  });
}
