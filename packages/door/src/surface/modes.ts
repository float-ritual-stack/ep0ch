import { keyName, keyCaption } from "./actions";
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

/** A binding and its optional short wording, as in W_KEYS. Text input still belongs to the shared editor. */
export interface ModeKey {
  readonly key: string;
  readonly action: string;
  readonly args?: Record<string, unknown>;
  readonly label?: string;
  /** The whole sentence the keys window lists for this row (TableRow.says). */
  readonly says?: string;
}

export function modeBinding(keys: readonly ModeKey[], key: Key): ModeKey | undefined {
  if (key.kind === "mouse") return undefined;
  const name = keyName(key);
  return effective(keys).find(row => row.key === name);
}

export function modeHint(keys: readonly ModeKey[], describe: (action: string) => { summary: string } | undefined): string {
  const groups = new Map<string, string[]>();
  for (const row of effective(keys)) {
    if (row.key === "click" || row.key === "drag" || row.key === "wheel") continue;
    const label = row.label ?? describe(row.action)!.summary;
    const group = groups.get(label) ?? [];
    group.push(keyCaption(row.key)); groups.set(label, group);
  }
  return [...groups].map(([label, keys]) => `${keys.join("/")} ${label}`).join(" · ");
}

export function modeActionKeys(tables: readonly (readonly ModeKey[])[], action: string): string | undefined {
  const keys = [...new Set(tables.flatMap(table => effective(table).filter(row => row.action === action).map(row => row.key)))];
  return keys.length ? keys.map(keyCaption).join(", ") : undefined;
}

export type ModeName = "form" | "list-preview" | "placement" | "picker" | "panel" | "draft" | "comment" | "list" | "grip" | "replies" | "sources" | "revision";

/**
 * Which mode takes a reader's keys first, when more than one is open: a step's status choice or an inline list
 * (a `::links` component, an extension's `list` view) the person went into (each opened on top of whatever was there, and closes at the next key that isn't its
 * own), then the property panel, then
 * the edit or the comment (one at a time: each refuses to open while the other is). Over a comment being written: moving
 * its box by keys (ctrl+g, PIE-785).
 */
export const PRECEDENCE: Record<ModeName, number> = { form: 1, "list-preview": 2, placement: 4, replies: 2, sources: 2, revision: 2, grip: 3, picker: 3, list: 3, panel: 2, draft: 1, comment: 1 };

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
  drop(m: string | M) { this.modes = this.modes.filter(x => (typeof m === "string" ? x.name !== m : x !== m)); }
  get(name: string): M | null { this.prune(); return this.modes.find(x => x.name === name) ?? null; }
  /** The mode the keys go to, or null when none is open. */
  top(): M | null { this.prune(); return this.modes[0] ?? null; }
  /** Every open mode, first the one the keys go to. */
  all(): readonly M[] { this.prune(); return this.modes; }

  /** The key goes to the first mode, or null when there's none. */
  key(k: Key, host: H): boolean | null { const t = this.top(); return t ? t.key(k, host) : null; }

  /** Modes that ended by themselves go. */
  private prune() { if (this.modes.some(m => m.ended?.())) this.modes = this.modes.filter(m => !m.ended?.()); }
}

/** A reader's open modes, in PRECEDENCE order. */
export class ModeStack<H> extends Modes<H, ReaderMode<H>> {
  private parked = new Set<ReaderMode<H>>();
  constructor() { super(PRECEDENCE); }

  override push<N extends ReaderMode<H>>(mode: N): N { this.drop(mode.name); return super.push(mode); }
  focus(mode: ReaderMode<H>, on: boolean) { if (on) this.parked.delete(mode); else this.parked.add(mode); }
  active(mode: ReaderMode<H>) { return !this.parked.has(mode); }
  override top() { return this.all().find(m => this.active(m)) ?? null; }
  override drop(m: string | ReaderMode<H>) { for (const x of this.all()) if (x === m || x.name === m) this.parked.delete(x); super.drop(m); }

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
  return parts.flatMap(p => {
    const k = hintKey(p);
    if (k === null) return [];
    const cap = k === "tab" ? "Tab" : keyCaption(k);
    return [`|15${cap}${k === p.key && p.also ? `/${p.also}` : ""}|08 ${p.label}`];
  }).join(" · ");
}
