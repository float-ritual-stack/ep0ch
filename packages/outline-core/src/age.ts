// How old something is (PIE-1292): the one place that decides the unit and its rounding, so the door, Detail and the
// CLIs say the same age for the same moment. Each caller picks how it is written (`style`), never the arithmetic. Pure.

/**
 * `short` for a column or a chip (`29s`, `5m`, `2h`, `3d`); `words` for a sentence that says "ago" or "since" itself
 * (`29 s`, `5 min`, `2 h`, `3 days`); `ago` for a line that doesn't (`just now`, `5 min ago`, `2 h ago`, `3 days ago`).
 */
export type AgeStyle = "short" | "words" | "ago";

/** Seconds below 90, minutes below 90, hours below 36, then days: each rounded to the nearest. */
function unitOf(seconds: number): { n: number; unit: 0 | 1 | 2 | 3 } {
  if (seconds < 90) return { n: Math.round(seconds), unit: 0 };
  if (seconds < 90 * 60) return { n: Math.round(seconds / 60), unit: 1 };
  if (seconds < 36 * 3600) return { n: Math.round(seconds / 3600), unit: 2 };
  return { n: Math.round(seconds / 86400), unit: 3 };
}

const SHORT = ["s", "m", "h", "d"] as const;

/** `ms` of age (a negative one, a clock a little ahead, is none) written in `style`. */
export function age(ms: number, style: AgeStyle = "short"): string {
  const seconds = Math.max(0, ms / 1000);
  if (style === "ago" && seconds < 10) return "just now";
  const { n, unit } = unitOf(seconds);
  if (style === "short") return `${n}${SHORT[unit]}`;
  const word = unit === 0 ? "s" : unit === 1 ? "min" : unit === 2 ? "h" : n === 1 ? "day" : "days";
  return style === "words" ? `${n} ${word}` : `${n} ${word} ago`;
}

/** How long before `now` the moment `iso` was, in `style`; "" when `iso` isn't a time. */
export function ageSince(iso: string | number | undefined, now: number, style: AgeStyle = "short"): string {
  const at = typeof iso === "number" ? iso : iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? age(now - at, style) : "";
}

/**
 * A moment as people read it on a clock, in the machine's own time zone (the byline's local time, not UTC): `11:25 PM`
 * today, `Oct 30, 11:25 PM` before. "" when `iso` isn't a time. The door and the web page both read the words from the
 * one service line that uses it, so they agree.
 */
export function clockWords(iso: string | number, now: number = Date.now(), style: "auto" | "time" | "date" | "date-time" = "auto"): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const today = style === "time" || style === "auto" && at.toDateString() === new Date(now).toDateString();
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return style === "date" ? day : today ? time : `${day}${style === "date-time" ? " " : ", "}${time}`;
}
