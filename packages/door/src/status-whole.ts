// A message the status bar cuts short, said whole (PIE-1428, PIE-1453): where it reads and how it ends. The one owner of
// where it goes (PIE-1732): never over the rows of what holds the person's keys (the power bar), never over a screen that
// lists the messages itself (the message log); and the log's own row for what came since its rows were read.
import { STATUS_INK } from "./status-bar";
import { referenceWords, type LinkTarget } from "./refs";
import type { StatusMessage } from "./status-log";
import { C, drawEllipsized, fg, pad, RESET, splitVisible, width } from "./style";
import { keySymbols } from "./surface/actions";
import { keyNow, layerEntry } from "./surface/keymap";
import { printable, wrap } from "./text";
import type { Rect } from "./canvas";

/** At most this many rows say a message whole; a longer one ends its last with wholeMore and the message log has it all. */
export const WHOLE_ROWS = 4;

/** The key `action` has now as the status line says it, from the keymap's own table (keyNow): `key` (⇧⌥Q) unless rebound; null when unbound. */
export function keyShown(action: string, key: string): string | null {
  const k = keyNow(action, {}, key);
  return k ? keySymbols(k) : null;
}
/** The key that opens the message log (status.log): ⇧⌥M unless rebound. */
export const logKey = () => keyShown("status.log", "alt+M");

/** What a message cut to its rows ends with: the key that reads it whole (or the click, when the keymap leaves the log no key). */
export const wholeMore = (): string => `… more ${logKey() ?? "(click)"}`;

/** Where the whole message goes: the `rows` (at most) ending just above row `end`; or `inside` the overlay, in its own message row. */
export type WholePlace = { end: number; rows: number } | "inside";

/**
 * Where a message said whole reads, `lines` the screen's rows (the status bar not among them):
 * - over a screen, just above its own bottom chrome (`at`, a desk's hint row: the ▣ a refusal says to click stays, PIE-1456);
 * - with an overlay holding the keys (`held`, the power bar's rows), in the rows it leaves free: below it, or above it when
 *   more are free there (a question's compact bar sits on the status bar); with none free, `inside` it, its message row;
 * - `null` over a screen that `reads` the messages itself (the message log): it says a new one on its own row.
 */
export function wholePlace(o: { lines: number; at: number; held?: Pick<Rect, "row" | "rows"> | null; reads?: boolean }): WholePlace | null {
  if (o.reads) return null;
  if (!o.held) return { end: o.at, rows: Math.min(WHOLE_ROWS, o.at) };
  const below = Math.max(0, o.lines - (o.held.row + o.held.rows)), above = Math.max(0, o.held.row);
  if (!below && !above) return "inside";
  return below >= above ? { end: o.lines, rows: Math.min(WHOLE_ROWS, below) } : { end: o.held.row, rows: Math.min(WHOLE_ROWS, above) };
}

/** `text` wrapped to `cols` in at most `rows` rows, the last ending wholeMore when it's longer. */
export function wholeLines(text: string, cols: number, rows = WHOLE_ROWS): string[] {
  const all = wrap(printable(text, " "), Math.max(1, cols)), out = all.slice(0, Math.max(1, rows));
  if (all.length > out.length) {
    const more = ` ${wholeMore()}`, last = out.length - 1;
    out[last] = splitVisible(out[last]!, Math.max(0, cols - width(more)))[0].trimEnd() + more;
  }
  return out;
}

/** A row of the whole message, in the status bar's ink. */
export const wholeRow = (text: string, cols: number, warning = false) => STATUS_INK + fg(warning ? C.yellow : C.lcyan) + pad(` ${text}`, cols) + RESET;

/**
 * A message the status bar cut short, wrapped whole over the rows `place` names, in the bar's ink. Its rows as drawn
 * (`top`, `rows`): a click on them opens the message log.
 */
export function withWhole(lines: string[], text: string, cols: number, warning = false, place: { end: number; rows: number } = { end: lines.length, rows: WHOLE_ROWS }): { lines: string[]; top: number; rows: number } {
  if (place.rows <= 0) return { lines, top: place.end, rows: 0 };
  const rows = wholeLines(text, cols - 2, place.rows), out = [...lines], top = place.end - rows.length;
  rows.forEach((r, i) => { if (top + i >= 0) out[top + i] = wholeRow(r, cols, warning); });
  return { lines: out, top: Math.max(0, top), rows: rows.length };
}

/**
 * The message log's own row for what was logged since its rows were read (PIE-1732): the newest's words as written (never
 * paint's |NN codes), cut at its end, then `· r`, the key that lists them; null when nothing is new.
 */
export function logNews(rows: readonly StatusMessage[], listed: readonly StatusMessage[], w: number): string | null {
  const seen = new Set(listed.map(r => r.id)), fresh = rows.filter(r => !seen.has(r.id)), newest = fresh.at(-1);
  if (!newest) return null;
  return `${fg(newest.kind === "status" ? C.lcyan : C.yellow)}${drawEllipsized(`${fresh.length} new · ${referenceWords(newest.message)}`, Math.max(1, w - 5))}${fg(C.dark)} · r${RESET}`;
}

/** Why a lit link in a message in the log leads nowhere: the service found nothing at its address (PIE-1455). */
export function missingWords(to: LinkTarget): string {
  return to.page !== undefined ? `no note is [[${to.page}]] yet` : `nothing answers at ${to.label ?? to.block ?? "that link"}`;
}

/** Key `name` (keyName's) opens the message log: the keymap's key for status.log, or alt+M while the keymap keeps it. */
export function opensLog(name: string | null): boolean {
  if (!name) return false;
  const mine = layerEntry(name);
  return mine ? mine.action === "status.log" : name === "alt+M" && keyNow("status.log", {}, "alt+M") === "alt+M";
}
