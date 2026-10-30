// Date buckets (PIE-1443, PIE-1448): which bucket a time falls in for a `group=` of the views' grammar, and the other way
// round, the `where` clause that holds exactly one bucket's notes, so a list can ask for a group it hasn't read yet
// ("September 2026", 120 notes past the first page). Both read the wall clock of the machine they run on, as `today`
// in a query does; the service groups with `recentBucket`, a client asks for a group with `bucketWhere`. Pure: no I/O.

/** The relative buckets, in the order a list shows them (newest first); a month after them is `YYYY-MM`. */
export const RECENT_BUCKETS = ["Later", "Today", "Yesterday", "Previous 7 days", "Previous 30 days"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The relative bucket an ISO time falls in, by this machine's wall clock: Today, Yesterday, Previous 7 days, Previous
 * 30 days, then its month (`2026-09`); a time after today is Later.
 */
export function recentBucket(iso: string, now = Date.now()): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const ago = Math.round((day(new Date(now)) - day(at)) / 86_400_000);
  if (ago < 0) return "Later";
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago <= 7) return "Previous 7 days";
  if (ago <= 30) return "Previous 30 days";
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}`;
}

/** A calendar day as the grammar reads it on the wall clock (`"29 Oct 2026"`: a bare YYYY-MM-DD is a UTC day). */
export const dayBound = (y: number, m: number, d: number) => `"${d} ${MONTHS[m - 1]} ${y}"`;

const DATE_GROUP = /^([A-Za-z][A-Za-z0-9_.-]*):(day|week|month|year|recent)$/;

/**
 * The clause that holds exactly the notes of group `value` of `group` (a property, or a date bucket), in the views'
 * grammar: `plot=beds`, `NOT plot` for the notes without it, `updated >= yesterday updated <= yesterday`. Null when
 * the value isn't one this group makes.
 */
export function bucketWhere(group: string, value: string | null): string | null {
  const date = DATE_GROUP.exec(group.trim().toLowerCase());
  if (!date) {
    const key = group.trim();
    if (value === null) return `NOT ${key}`;
    return `${key}=${/^[\w./@*-]+$/u.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`}`;
  }
  const [, field, unit] = date as unknown as [string, string, string];
  if (value === null) return `NOT ${field}`;
  const range = (from: string, to: string) => `${field} >= ${from} ${field} <= ${to}`;
  if (unit === "recent") {
    if (value === "Later") return `${field} > today`;
    if (value === "Today") return range("today", "today");
    if (value === "Yesterday") return range("yesterday", "yesterday");
    if (value === "Previous 7 days") return range("-7d", "-2d");
    if (value === "Previous 30 days") return range("-30d", "-8d");
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]);
    // A month holds only what is older than the relative buckets: the rest of it is under them.
    return `${range(dayBound(y, mo, 1), dayBound(y, mo, new Date(y, mo, 0).getDate()))} ${field} < -30d`;
  }
  if (unit === "day") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? range(dayBound(Number(m[1]), Number(m[2]), Number(m[3])), dayBound(Number(m[1]), Number(m[2]), Number(m[3]))) : null;
  }
  if (unit === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]);
    return range(dayBound(y, mo, 1), dayBound(y, mo, new Date(y, mo, 0).getDate()));
  }
  if (unit === "year") return /^\d{4}$/.test(value) ? range(dayBound(Number(value), 1, 1), dayBound(Number(value), 12, 31)) : null;
  // ISO week: the week holding the year's first Thursday is week 1, Monday to Sunday.
  const w = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!w) return null;
  const jan4 = new Date(Number(w[1]), 0, 4), monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (Number(w[2]) - 1) * 7);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return range(dayBound(monday.getFullYear(), monday.getMonth() + 1, monday.getDate()), dayBound(sunday.getFullYear(), sunday.getMonth() + 1, sunday.getDate()));
}
