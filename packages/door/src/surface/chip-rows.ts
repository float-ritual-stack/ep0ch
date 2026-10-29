import { fullText } from "../overflow";
import { C, chip, ellipsize, fg, RESET, width } from "../style";
import type { ModeKey } from "./modes";

interface Hit { from: number; to: number; action: string; args?: Record<string, unknown> }
/** A row of a strip: its text, where each tab is for a click, the underline under the lit one (a style's `under`). */
export interface TabRow { text: string; hits: Hit[]; under?: string }
/** A tab: its label (and hot key), lit when `on`, the cursor's marked, a click running `hit`; `hint` is the label's whole text. */
export interface Tab { label: string; on?: boolean; cursor?: boolean; key?: string; hint?: string; hit?: Omit<Hit, "from" | "to"> }
/** How a strip looks: the lit, unlit and cursor tab, an unlit tab's hot key, "… N more", the space inside and after a tab, between two, and the underline. */
export interface TabStyle { on: string; off: string; cursor?: string; key?: string; more?: string; pad?: string; gap?: string; sep?: string; under?: string }
export const CHIPS: TabStyle = { on: chip(C.blue), off: fg(C.grey), cursor: fg(C.white), pad: " ", gap: " " };

/**
 * Every tab set's one strip (PIE-1288): the tabs drawn in `style`, from column `at` after `lead`, within `width`. The one
 * overflow rule: `wrap` breaks rows where the next tab doesn't fit; `share` keeps one row, each label whole when they all
 * fit, else cut to an even share, and when a share would be under 4 cells the tail goes into "… N more" (`more` adds tabs
 * the caller left out; its click is `moreHit`, else the first tab put away). `tag` wraps the `i`th tab as drawn (a figure's inline link).
 */
export function tabStrip(tabs: readonly Tab[], o: { width: number; style?: TabStyle; lead?: string; at?: number; overflow?: "wrap" | "share"; more?: number; moreHit?: Omit<Hit, "from" | "to">; tag?: (drawn: string, i: number) => string }): TabRow[] {
  const s = o.style ?? CHIPS, p = s.pad ?? "", gap = s.gap ?? "", sep = s.sep ?? "", lead = o.lead ?? "", shown = [...tabs], away: Tab[] = [];
  const fixed = (t: Tab) => width(p) * 2 + (t.key ? width(t.key) + 1 : 0);
  let cut = Infinity, more = o.more ?? 0;
  if (o.overflow === "share") {
    const room = (n: number, m: number) => o.width - width(lead) - (m ? width(`… ${m} more`) + 2 * width(p) + width(sep) + width(gap) : 0) - n * width(gap) - Math.max(0, n - 1) * width(sep);
    const whole = shown.reduce((a, t) => a + fixed(t) + width(t.label), 0) <= room(shown.length, more);
    // The lit tab is never the one put away.
    while (!whole && shown.some(t => !t.on) && Math.floor(room(shown.length, more) / shown.length) - fixed(shown[0]!) < 4) { away.unshift(...shown.splice(shown.findLastIndex(t => !t.on), 1)); more++; }
    if (!whole) cut = Math.max(1, Math.floor(room(shown.length, more) / Math.max(1, shown.length)) - fixed(shown[0]!));
  }
  const rows: TabRow[] = [];
  let text = lead, under = " ".repeat(width(lead)), hits: Hit[] = [], x = width(lead);
  const put = (t: Tab, i: number, tail = false) => {
    const label = tail ? t.label : ellipsize(t.label, cut), drawn = `${p}${t.key ? `${t.key} ` : ""}${label}${p}`, n = width(drawn);
    if (o.overflow !== "share" && x > width(lead) && x + width(sep) + n + width(gap) > o.width) { rows.push({ text, hits, under: s.under && under }); text = " ".repeat(width(lead)); under = text; hits = []; x = width(lead); }
    else if (x > width(lead)) { text += sep; under += " ".repeat(width(sep)); x += width(sep); }
    const look = t.on ? s.on : t.cursor ? s.cursor ?? s.off : tail ? s.more ?? s.off : s.off;
    const marked = t.cursor ? `\x1b[4m${drawn}\x1b[24m` : t.key && !t.on && s.key ? `${p}${s.key}${t.key}${RESET}${look} ${label}${p}` : drawn;
    const body = look + (t.hint || label !== t.label ? fullText(t.hint ?? t.label, marked) : marked) + RESET;
    text += (o.tag && !tail ? o.tag(body, i) : body) + gap;
    under += (t.on && s.under ? s.under + "▀".repeat(n) + RESET : " ".repeat(n)) + " ".repeat(width(gap));
    if (t.hit) hits.push({ from: (o.at ?? 0) + x, to: (o.at ?? 0) + x + n, ...t.hit });
    x += n + width(gap);
  };
  for (const t of shown) put(t, tabs.indexOf(t));
  if (more) put({ label: `… ${more} more`, hit: o.moreHit ?? away[0]?.hit }, -1, true);
  rows.push({ text, hits, under: s.under && under });
  return rows;
}

/** A tab set's keys, as ModeKey rows (`modeBinding`, `modeHint` read them): `prev`/`next` press `action by=∓1`, the digits `argKey=n`. */
export function tabKeys(action: string, o: { prev?: string[]; next?: string[]; digits?: string; args?: Record<string, unknown>; label?: string }): ModeKey[] {
  const row = (key: string, args: Record<string, unknown>): ModeKey => ({ key, action, args: { ...args, ...o.args }, ...(o.label ? { label: o.label } : {}) });
  return [...(o.prev ?? []).map(k => row(k, { by: -1 })), ...(o.next ?? []).map(k => row(k, { by: 1 })), ...(o.digits ? [...TAB_DIGITS].map((d, i) => row(d, { [o.digits!]: i + 1 })) : [])];
}
/** The hot keys of a strip's first ten tabs. */
export const TAB_DIGITS = "1234567890";
