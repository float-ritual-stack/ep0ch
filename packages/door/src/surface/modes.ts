import { executable, keyName, keyCaption } from "./actions";
import { effective, keyNow } from "./keymap";
import type { SurfaceView } from "./note";
import type { Hint } from "./hint-card";
// The reader's modes (PIE-516, part 2): what takes a reader's keys while the person or an agent is doing
// something in it besides reading: a step's status choice, the property panel, an edit, a comment session.
// Each is a mode behind one seam, kept in a small stack whose order is their precedence, stated once
// (PRECEDENCE). The note surface asks the stack, never each field: the key, a click, a press or drag, the
// wheel, what to draw, the hint, leaving, and `peek`. Reading itself (layout, elements, folds, history,
// selection, projections) stays the surface's: a mode only takes what reaches it first. The edit and the comment
// draw in place of the note (`rows`); the panel and the status choice are drawn inside it by the reading render,
// which asks the surface's `panel` and `picker` (views of this stack).
import type { LeaveResult } from "../draft-session";
import type { Actor } from "../socket";
import type { Key } from "../term";
import type { Rect } from "../canvas";
import { tabStrip } from "./chip-rows";
import { stripWidth } from "./strip-state";
import { C, fg } from "../style";

/** A binding and its optional short wording, as in W_KEYS. Text input still belongs to the shared editor. */
export interface ModeKey {
  readonly key: string;
  readonly action: string;
  readonly args?: Record<string, unknown>;
  readonly label?: string;
  /** The whole sentence the keys window lists for this row (TableRow.says). */
  readonly says?: string;
  /** false: its key does what no one action does with fixed arguments (a passage's own walk), so the hint's segment is words, not a click. */
  readonly click?: false;
}

export function modeBinding(keys: readonly ModeKey[], key: Key): ModeKey | undefined {
  if (key.kind === "mouse") return undefined;
  const name = keyName(key);
  return effective(keys).find(row => row.key === name);
}

/**
 * How a hint draws: one row, as wide as where it is drawn, and `direct`, so a click on a segment runs its action
 * wherever the hint sits (a tile's frame foot, the BBS reader's row), through strip.pick (PIE-1293).
 */
const HINT_STRIP = () => ({ width: stripWidth(), direct: true, style: { on: fg(C.white), off: fg(C.grey), key: fg(C.white), sep: " · " } });

export function modeHint(keys: readonly ModeKey[], describe: (action: string) => { summary: string } | undefined): string {
  const groups = new Map<string, string[]>();
  for (const row of effective(keys)) {
    if (row.key === "click" || row.key === "drag" || row.key === "wheel") continue;
    const label = row.label ?? describe(row.action)!.summary;
    const group = groups.get(label) ?? [];
    group.push(keyCaption(row.key)); groups.set(label, group);
  }
  return tabStrip([...groups].map(([label, caps]) => {
    const row = effective(keys).find(r => (r.label ?? describe(r.action)?.summary) === label)!;
    // A click runs the row's binding only when it carries what the action needs; else the segment is words, never a refusal.
    return { label, key: caps.join("/"), ...(row.click !== false && executable(row.action, row.args) ? { hit: { action: row.action, args: row.args } } : {}) };
  }), HINT_STRIP())[0]!.text;
}

/**
 * The keys `action` has built in, for its def to declare: never with the keymap applied, since a def is read as its module
 * loads and `builtInKeys` takes what it declares as what the binding always had, so a rebind would look like no change
 * and its row would drop out of every hint. What the keymap does to them is `keysNow`'s, when they're read.
 */
export function modeActionKeys(tables: readonly (readonly ModeKey[])[], action: string): string | undefined {
  const keys = [...new Set(tables.flatMap(table => table.filter(row => row.action === action).map(row => row.key)))];
  return keys.length ? keys.map(keyCaption).join(", ") : undefined;
}

export type ModeName = "form" | "list-preview" | "placement" | "picker" | "panel" | "draft" | "comment" | "list" | "grip" | "replies" | "sources" | "revision" | "leave-ask" | "passage-menu";

/**
 * A step's status choice takes keys before the property panel, which must keep an inline collection's picked row
 * from opening while its settings card is up. The list resumes when the panel closes. The edit and comment are
 * mutually exclusive; moving a comment's box by keys (ctrl+g, PIE-785) goes above it. A tie breaks by age: among modes of
 * one rank the newest goes first (`Modes.push`). The leave ask is the power bar's to answer, so it takes no key here
 * (rank 0, parked); the passage menu takes the one key after `a`. Not modes, on purpose: zoom and raw are reading state,
 * which take no keys of their own and outlive any mode; replyOn, editOn, writeNext and pendingLink are what the next
 * session or the next follow starts from, each spent by it.
 */
export const PRECEDENCE: Record<ModeName, number> = { form: 1, "list-preview": 2, placement: 4, replies: 2, sources: 2, revision: 2, grip: 3, picker: 3, list: 1, panel: 2, draft: 1, comment: 1, "leave-ask": 0, "passage-menu": 3 };

/** One mode, as the reader asks it. `H` is the reader's host. */
export interface ReaderMode<H> extends Mode<H> {
  readonly name: ModeName;
  readonly keys?: readonly ModeKey[];
  /** What the mode is about (the edit's draft, the comment session, the panel, the choice): hosts compare it by identity. */
  readonly of: object;
  /** Takes every key, the host's shortcuts too, while it's open. */
  readonly holdsKeys: boolean;
  /** Holds the reader on its note and keeps its clicks (an edit, a comment, a property value being typed). */
  editing(): boolean;
  /** Its rows in place of the note (an edit, a comment, the full panel); null when it's drawn inside the note. */
  covers(): boolean;
  key(k: Key, host: H): boolean;
  /** A click at the surface's cell `x`, `y`: true or false when it was the mode's, undefined when reading has it. */
  click(x: number, y: number, host: H): boolean | undefined;
  /** The wheel, with where the pointer is in the surface's cells when the host knows: true when the mode took it. */
  wheel?(dir: 1 | -1, host: H, at?: { x: number; y: number }): boolean;
  /** The button went down (`drag`: moved with it down) at `x`, `y`: true when the mode took it. */
  press?(x: number, y: number, host: H, drag: boolean): boolean;
  /** The rows it draws in place of the note (`covers`), or null. */
  rows(w: number, h: number, host: H | undefined): SurfaceView | null;
  /** Leave it as a click elsewhere does (an edit saved or kept, a comment kept); a refusal throws with why. */
  leave(host: H, actor: Actor): Promise<LeaveResult>;
  /** Why a click can't leave it now, or null. */
  leaveRefusal?(): string | null;
  /** Typed text not yet written; copied to disk (and put aside) by `keep`. */
  unsaved?(): boolean;
  keep?(): string[];
  /** The keys that work now, and the host title's word for it. */
  hint(): string;
  state(): string | null;
  /** For `peek`, under the mode's own key. */
  describe(): unknown;
  /** The note it's on changed elsewhere (`revision`; `partial`: only its list row was read): what it holds is marked, never replaced. */
  changed?(revision: number, partial: boolean): void;
  /** Its name for hints and refusals: "edit", "comment", "property panel", "status choice". */
  readonly word: string;
  /** What it is open over (another mode's `of`): it goes when that one goes, so nothing of it lingers (PIE-1617). */
  readonly over?: object;
  /** Its way out as it goes from the stack: what it kept drawn or being dragged. */
  dropped?(): void;
  /** How a refusal names it while it holds the note: "the edit", "the comment", "the property value". */
  readonly noun?: string;
}

/**
 * Anything that takes a host's keys first while it's open: a reader's mode, or a screen's overlay (a picker, the
 * policy panel). A stack of them (`Modes`) gives the key (the mouse's too) to the first.
 */
export interface Mode<H> {
  readonly hintCard?: Hint;
  readonly name: string;
  key(k: Key, host: H): boolean;
  /** What the next Esc closes in it, in the hint's words, when `the <word>` doesn't say it (esc-rule.ts). */
  escCloses?(): string | null;
  /** It ended by itself: the stack lets it go. */
  ended?(): boolean;
  /** The box it was last drawn in, for the screen's hit map (PIE-1407); one that keeps none answers no clicks there. */
  drawn?(): Rect | null;
}

/** The open modes, in precedence order (`order`, by name; the newest first among equals): the first takes the keys. */
export class Modes<H, M extends Mode<H>> {
  protected modes: M[] = [];
  constructor(private readonly order: Readonly<Record<string, number>> = {}) {}

  /** Open `m` (one of a name at a time: an earlier one of the same name goes). */
  push<N extends M>(m: N): N {
    const rank = (x: M) => this.order[x.name] ?? 0;
    this.modes = this.modes.filter(x => x.name !== m.name);
    const at = this.modes.findIndex(x => rank(x) <= rank(m));
    this.modes.splice(at < 0 ? this.modes.length : at, 0, m);
    return m;
  }
  /** Let go of a mode, by name, or only if it's that very one. */
  drop(m: string | M) { const going = this.modes.filter(x => (typeof m === "string" ? x.name === m : x === m)); this.leave(going); }
  get(name: string): M | null { this.prune(); return this.modes.find(x => x.name === name) ?? null; }
  /** The mode the keys go to, or null when none is open. */
  top(): M | null { this.prune(); return this.modes[0] ?? null; }
  /** Every open mode, first the one the keys go to. */
  all(): readonly M[] { this.prune(); return this.modes; }

  /** The key goes to the first mode, or null when there's none. */
  key(k: Key, host: H): boolean | null { const t = this.top(); return t ? t.key(k, host) : null; }

  /** Modes that ended by themselves go. */
  private prune() { if (this.modes.some(m => m.ended?.())) this.leave(this.modes.filter(m => m.ended?.())); }
  /** The one way out of the stack, let go or ended by itself. */
  private leave(going: M[]) { this.modes = this.modes.filter(x => !going.includes(x)); for (const x of going) this.gone(x); }
  /** A mode has left the stack. */
  protected gone(_m: M) {}
}

/** A reader's open modes, in PRECEDENCE order. */
export class ModeStack<H> extends Modes<H, ReaderMode<H>> {
  private parked = new Set<ReaderMode<H>>();
  constructor() { super(PRECEDENCE); }

  override push<N extends ReaderMode<H>>(mode: N): N {
    if (mode.editing()) this.drop("list");
    this.drop(mode.name);
    return super.push(mode);
  }
  focus(mode: ReaderMode<H>, on: boolean) { if (on) this.parked.delete(mode); else this.parked.add(mode); }
  active(mode: ReaderMode<H>) { return !this.parked.has(mode); }
  override top() { return this.all().find(m => this.active(m)) ?? null; }
  /** A mode has gone, let go or ended by itself: what's open over it goes with it, and it runs its way out. */
  protected override gone(x: ReaderMode<H>) {
    this.parked.delete(x);
    x.dropped?.();
    for (const y of [...this.modes]) if (y.over === x.of) this.drop(y);
  }
  /** Open `mode` taking no key (the leave ask: the power bar has it); `all` still sees it, `top` never. */
  pushParked<N extends ReaderMode<H>>(mode: N): N { this.push(mode); this.parked.add(mode); return mode; }

  get holdsKeys() { return this.all().some(m => this.active(m) && m.holdsKeys); }
  get editing() { return this.all().some(m => m.editing()); }
  /** Something is drawn in place of the note: the note itself doesn't scroll. */
  get covers() { return this.all().some(m => m.covers()); }

  /** Each mode in order may take the click; undefined when none did. */
  click(x: number, y: number, host: H): boolean | undefined {
    for (const m of this.all()) { const r = m.click(x, y, host); if (r !== undefined) return r; }
    return undefined;
  }
  wheel(dir: 1 | -1, host: H, at?: { x: number; y: number }): boolean { return this.all().some(m => !!m.wheel?.(dir, host, at)); }
  press(x: number, y: number, host: H, drag: boolean): boolean { return this.all().some(m => m.editing() && !!m.press?.(x, y, host, drag)); }
  /** What's drawn in place of the note, by the first mode that covers it. */
  rows(w: number, h: number, host: H | undefined): SurfaceView | null {
    for (const m of this.all()) { const r = m.covers() ? m.rows(w, h, host) : null; if (r) return r; }
    return null;
  }
  /** Why a click can't leave what's open, or null. */
  leaveRefusal(): string | null { for (const m of this.all()) { const r = m.leaveRefusal?.(); if (r) return r; } return null; }
  unsaved() { return this.all().some(m => !!m.unsaved?.()); }
  keep(): string[] { return this.all().flatMap(m => m.keep?.() ?? []); }

  /** The note changed elsewhere: each open mode marks what it holds. */
  changed(revision: number, partial: boolean) { for (const m of this.all()) m.changed?.(revision, partial); }
  /** The mode that holds the note, by the noun a refusal names it with ("finish the edit first"). */
  holding(): string | null { return this.all().find(m => m.editing())?.noun ?? null; }
}

/**
 * One part of a hint row that names an action (PIE-492): `key` is its built-in key (a key its def declares, held by
 * test/keys-window.test.ts), `label` what the row calls it. The row draws the key the person's keymap gives it instead,
 * and leaves the part out when the keymap unbinds it, so a rebind shows on every hint row that names the action.
 */
export interface HintPart {
  readonly action: string; readonly key: string; readonly label: string; readonly args?: Record<string, unknown>;
  /** More built-in keys drawn with it (`1-9` after Tab): left out once the keymap moves the key. */
  readonly also?: string;
}
/** The key a hint part shows now: the keymap's first for its binding, else its built-in; null when the keymap unbinds it. */
export const hintKey = (p: HintPart): string | null => keyNow(p.action, p.args ?? {}, p.key) ?? null;
/** Hint parts as a hint row draws them (`|15key|08 label`, the desk's paint codes): each a key the hint row's click presses. */
export function partsHint(parts: readonly HintPart[]): string {
  return tabStrip(parts.flatMap(p => {
    const k = hintKey(p);
    if (k === null) return [];
    const cap = k === "tab" ? "Tab" : keyCaption(k);
    return [{ label: p.label, key: cap + (k === p.key && p.also ? `/${p.also}` : ""), ...(executable(p.action, p.args) ? { hit: { action: p.action, args: p.args } } : {}) }];
  }), HINT_STRIP())[0]!.text;
}
