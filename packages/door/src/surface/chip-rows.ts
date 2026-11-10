import { actionLine } from "@ep0ch/outline-core/action-line";
import type { LinkTarget as Link } from "../refs";
import { OSC8_CLOSE } from "../hyperlink";
import { fullText, selectFullText } from "../overflow";
import { C, chip, ellipsize, fg, RESET, width } from "../style";
import type { ModeKey } from "./modes";
import { recordStrip } from "./strip-state";

export interface StripHit { action: string; args?: Record<string, unknown>; tile?: string }
interface Hit extends StripHit { from: number; to: number; index: number; label: string; alt?: StripHit }
/** A row of a strip: its text, where each tab is for a click, the underline under the lit one (a style's `under`). */
export interface TabRow { text: string; hits: Hit[]; under?: string }
/**
 * A tab: its label (and hot key), lit when `on`, the cursor's marked, a click running `hit`; `hint` is the label's whole text.
 * In a `drop` strip (phrases, not names: the hint row, the status bar) a tab keeps its words: `short` and `tiny` are the
 * forms it takes before it goes whole into +N, `keep` holds it on the row while others go, and the `yield` tab (a message)
 * is whole if the others making room gets it there; if nothing would, it costs no tab and takes what is left.
 */
export interface Tab { label: string; on?: boolean; cursor?: boolean; key?: string; hint?: string; hit?: StripHit; alt?: StripHit; end?: boolean; short?: string; tiny?: string; keep?: boolean; yield?: boolean }
/** How a strip looks: the lit, unlit and cursor tab, an unlit tab's hot key, "… N more", the space inside and after a tab, between two, and the underline. */
export interface TabStyle { on: string; off: string; cursor?: string; key?: string; more?: string; pad?: string; gap?: string; sep?: string; under?: string }
/** The default look, built when drawn: an `fg` is the theme's colour at the time it's called, so a style kept in a constant would keep the theme it was imported under. */
export const chips = (): TabStyle => ({ on: chip(C.blue), off: fg(C.grey), cursor: fg(C.white), pad: " ", gap: " " });

export interface StripOptions {
  /** `share`: the current name owns half the row, neighbours give up letters, then cells (tile tabs). `middle`: a breadcrumb, cut between.
   * `wrap`: more rows. `drop`: whole words or none (the hint row, the status bar): `short`, `tiny`, then +N; a `yield` tab that can't fit whole even so takes what's left. */
  width: number; style?: TabStyle; lead?: string; at?: number; overflow?: "wrap" | "share" | "middle" | "drop";
  tag?: (drawn: string, i: number) => string;
  id?: string; cursor?: number; scroll?: number; direct?: boolean; about?: string;
}

/** The current name owns up to half the row. Its neighbours give up letters, then cells; never its share. */
export function tabStrip(tabs: readonly Tab[], o: StripOptions): TabRow[] {
  const record = recordStrip(tabs, o);
  if (record) o = { ...o, id: record.id, scroll: record.scroll, cursor: record.scroll === undefined ? o.cursor : record.cursor };
  const s = o.style ?? chips(), p = s.pad ?? "", lead = o.lead ?? "", current = Math.max(0, tabs.findIndex(t => t.on));
  let gap = s.gap ?? "", sep = s.sep ?? "", join = width(gap) + width(sep);
  const shown = tabs.map((tab, i) => ({ ...tab, cursor: o.cursor === i || tab.cursor, i, text: tab.label, hot: tab.key ?? "" }));
  const room = Math.max(0, o.width - width(lead));
  const cells = (t: typeof shown[number]) => width(t.text) + width(p) * 2 + (t.hot ? width(t.hot) + (t.text ? 1 : 0) : 0);
  const used = () => shown.reduce((n, t) => n + cells(t), 0) + Math.max(0, shown.length - 1) * join + (shown.length ? width(gap) : 0);
  let more = 0;
  const narrow = o.overflow !== "wrap" && used() > room;
  if (narrow && o.overflow === "drop") {
    // Phrases keep their words. The others take their short, then tiny forms, from the end, then go whole into +N, the
    // farthest from the current first, a `keep` tab never. A yielding tab (a message) is said whole when that makes room
    // for it (PIE-1598: chips are back the moment it goes, and +N holds them till then). One that wouldn't fit even so
    // costs no chip: the others take their short forms and it takes what they leave, even nothing (a cut message is said
    // whole above the bar, PIE-1428).
    const controls = () => more ? width(`‹+${more}›`) + join : 0, anchor = o.scroll ?? current;
    const yielding = shown.find(t => t.yield), fits = () => used() + controls() <= room;
    let cutting = false;
    const give = () => { if (yielding && cutting) yielding.text = ellipsize(yielding.label, Math.max(0, room - controls() - (used() - cells(yielding)))); };
    const drop = () => {
      const candidates = shown.filter(t => !t.keep && t !== yielding && t.i !== current).sort((a, b) => Math.abs(b.i - anchor) - Math.abs(a.i - anchor) || b.i - a.i);
      if (!candidates.length) return false;
      shown.splice(shown.indexOf(candidates[0]!), 1); more++; give(); return true;
    };
    const makeRoom = () => {
      give();
      for (const form of ["short", "tiny"] as const) for (const t of [...shown].reverse()) {
        if (fits()) break;
        if (t !== yielding && t[form] !== undefined && width(t[form]) < width(t.text)) { t.text = t[form]; give(); }
      }
      while (!fits() && drop());
      give();
    };
    const all = [...shown];
    makeRoom();
    if (yielding && !fits()) {
      shown.splice(0, shown.length, ...all);
      for (const t of shown) t.text = t.label;
      more = 0; cutting = true;
      // Their short forms cost no chip: a cut message keeps its words as far as they go, not its first letter.
      for (const t of shown) if (t !== yielding && t.short !== undefined && width(t.short) < width(t.text)) t.text = t.short;
      makeRoom();
    }
  } else if (narrow) {
    gap = ""; sep = o.overflow === "middle" ? " › " : " "; join = width(sep);
    for (const t of shown) {
      if (o.overflow !== "middle") t.hot ||= String(t.i + 1);
      if (o.overflow === "middle" && t.i === 0) t.text = ellipsize(t.label, Math.max(1, Math.floor(room / 4)));
      if (t.i === current) t.text = ellipsize(t.label, Math.max(1, Math.floor(room / 2)));
    }
    const controls = () => more ? width(`‹+${more}›`) + join : 0;
    if (o.overflow !== "middle") for (const letters of [3, 0]) {
      if (used() <= room) break;
      for (const t of shown) if (t.i !== current) t.text = letters ? ellipsize(t.label, letters) : "";
    }
    const anchor = o.scroll ?? current;
    while (used() + controls() > room && shown.some(t => t.i !== current)) {
      const candidates = shown.filter(t => t.i !== current).sort((a, b) => o.overflow === "middle"
        ? Number(a.i === 0) - Number(b.i === 0) || (o.scroll === undefined ? 1 : -1) * (Math.abs(a.i - anchor) - Math.abs(b.i - anchor))
        : Math.abs(b.i - anchor) - Math.abs(a.i - anchor));
      shown.splice(shown.indexOf(candidates[0]!), 1); more++;
    }
    if (shown.length === 1 && used() + controls() > room) {
      const t = shown[0]!;
      t.text = ellipsize(t.label, Math.max(0, room - controls() - width(p) * 2 - (t.hot ? width(t.hot) + 1 : 0)));
    }
  }
  const rows: TabRow[] = [];
  let previous = -4;
  let text = lead, under = " ".repeat(width(lead)), hits: Hit[] = [], x = width(lead);
  const put = (t: Tab, i: number, label = t.label, hot = t.key ?? "", tail = false) => {
    const inset = i < 0 ? "" : p, drawn = `${inset}${hot}${hot && label ? " " : ""}${label}${inset}`, n = width(drawn);
    if (o.overflow === "wrap" && x > width(lead) && x + width(sep) + n + width(gap) > o.width) { rows.push({ text, hits, under: s.under && under }); text = " ".repeat(width(lead)); under = text; hits = []; x = width(lead); }
    else if (x > width(lead)) { const between = (i === -3 || previous === -2) ? "" : sep; text += between; under += " ".repeat(width(between)); x += width(between); }
    if (t.end && !narrow) { const space = Math.max(0, room - used()); text += " ".repeat(space); under += " ".repeat(space); x += space; }
    const look = t.on ? s.on : t.cursor ? s.cursor ?? s.off : tail ? s.more ?? s.off : s.off;
    const marked = t.cursor ? `\x1b[4m${drawn}\x1b[24m` : hot && !t.on && s.key ? `${p}${s.key}${hot}${RESET}${look}${label ? " " + label : ""}${p}` : drawn;
    // A segment yielded down to nothing draws nothing: a cut value's marker around no cells would still show a letter.
    // A yielding tab (a message) the strip cut reads from its start, cut at its end (the shared ellipsize, PIE-1707): it is said
    // whole above the bar (PIE-1428), so its cells carry no value for the Overflow pass to scroll from the middle.
    const full = !n && t.label ? "" : t.yield && label !== t.label ? marked : fullText(t.hint ?? `${p}${hot}${hot ? " " : ""}${t.label}${p}`, marked, undefined, record ? { id: record.id, n: i } : undefined, { ...t, hit: t.hit ? { ...t.hit, tile: t.hit.tile ?? record?.tile } : undefined });
    const body = look + (t.on ? selectFullText(full) : full) + RESET;
    text += (o.tag && i >= 0 ? o.tag(body, i) : body) + (t.label.includes("\x1b]8;") ? OSC8_CLOSE : "") + gap;
    under += (t.on && s.under ? s.under + "▀".repeat(n) + RESET : " ".repeat(n)) + " ".repeat(width(gap));
    if (t.hit) hits.push({ from: (o.at ?? 0) + x, to: (o.at ?? 0) + x + n, index: i, label: t.label, alt: t.alt, ...t.hit });
    x += n + width(gap); previous = i;
  };
  const rest = () => put({ label: `+${more}`, hit: { action: "strip.more", args: { strip: o.id } } }, -1, undefined, "", true);
  if (more) put({ label: "‹", hit: { action: "strip.scroll", args: { strip: o.id, by: -1 } } }, -2);
  for (const [i, t] of shown.entries()) {
    if (more && o.overflow === "middle" && i === shown.length - 1) rest();
    put(t, t.i, t.text, t.hot);
  }
  if (more) {
    if (o.overflow !== "middle") rest();
    put({ label: "›", hit: { action: "strip.scroll", args: { strip: o.id, by: 1 } } }, -3);
  }
  rows.push({ text, hits, under: s.under && under });
  return rows;
}

/** A strip participates in the reader's element traversal through the same action ranges as its pointer hits. */
export function stripControls(row: TabRow, block: string, col = 0): { row: number; from: number; to: number; link: Link }[] {
  return row.hits.map(hit => ({ row: 0, from: col + hit.from, to: col + hit.to, link: { role: "control", label: hit.label,
    press: { act: actionLine(hit), ...(hit.alt ? { alt: actionLine(hit.alt) } : {}), block, line: 0 } } }));
}

/** A tab set's keys, as ModeKey rows (`modeBinding`, `modeHint` read them): `prev`/`next` press `action by=∓1`, the digits `argKey=n`. */
export function tabKeys(action: string, o: { prev?: string[]; next?: string[]; digits?: string; args?: Record<string, unknown>; label?: string }): ModeKey[] {
  const row = (key: string, args: Record<string, unknown>): ModeKey => ({ key, action, args: { ...args, ...o.args }, ...(o.label ? { label: o.label } : {}) });
  return [...(o.prev ?? []).map(k => row(k, { by: -1 })), ...(o.next ?? []).map(k => row(k, { by: 1 })), ...(o.digits ? [...TAB_DIGITS].map((d, i) => row(d, { [o.digits!]: i + 1 })) : [])];
}
/** The hot keys of a strip's first ten tabs. */
export const TAB_DIGITS = "1234567890";
