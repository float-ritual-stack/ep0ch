// Named actions: everything a person does to a note (edit, save, quote a passage, comment, reply,
// resolve, follow a link) and a host adds (open a note in a reader, move a card), with typed arguments.
// Keys call them, and so does the control socket (`ep0ch-door act`), through the same code. An agent's
// action is never silent: the status bar says "an agent (<id>) …", the reader it touched says what it
// did, and what it writes is recorded as `author: agent` with its actor id.
import type { Actor } from "../socket";
import { visible, width } from "../style";
import type { Key } from "../term";

export type ArgType = "string" | "number" | "boolean";
/**
 * One argument: its type, whether it may be left out, and what it means. `tile`: it names a tile (`to=`), and the
 * dispatcher reads it with `tile=`'s one grammar, so the action is given that tile's name.
 */
export interface ArgSpec { type: ArgType; optional?: boolean; about: string; tile?: true }

/**
 * What an action touches of the person's (PIE-514). The dispatcher (src/surface/dispatch.ts) checks it once, against
 * where the person is (src/whereabouts.ts), before the action runs; the action never asks who acts for this.
 * - `nothing`: a read; a mark; what the service writes and attributes (an extension's action, a refresh). Anyone, any time.
 * - `tile`: the tile it runs in: its view, cursor, selection or input. An agent's is refused in the tile that has the
 *   person's keys (`while: "typing"`: only while they type in it), with the agent's own way said (`way`).
 * - `shape`: the screen's layout. The layout engine decides each operation (src/desk/screen-layout.ts) from the same
 *   answer about where the person is (`ctx.person`).
 * - `draft`: a note the person may have open in a draft. The draft session's rule decides (`draftRule`).
 * - `screen`: what the person looks at, or where their keys go (another screen, their focus, a list's lit row, the
 *   board shown). An agent's waits until they aren't typing anywhere and have been idle `SHELL_IDLE_MS`.
 */
export type Touches = "nothing" | "tile" | "shape" | "draft" | "screen";
/**
 * Whether a door that restarts (PIE-418) may run the action again by itself: `safe` (it changes only the door's own
 * view or layout, or reads), or `ask` (it writes to the outline, types into a program, or reaches outside the door).
 */
export type Replay = "safe" | "ask";
/**
 * What a `draft` action does to a draft (draftRule): types in it (`type`: a reference put in at the cursor too), leaves
 * it (save, close, send), writes the block, changes it in a way the session keeps safe for the person itself (`safe`:
 * an undo takes back only that actor's own patch), replaces the whole text of the tile's comment or reply (`text`), or
 * replaces the tile's whole draft of the block (`replace`). `text` and `replace` are an agent's only in a draft it
 * opened, and never while the person types in that tile; an invitation (the person's `@name` line) is the one way in.
 */
export type DraftUse = "type" | "leave" | "write" | "safe" | "text" | "replace";

export interface ActionDef<A, H> {
  /** What the action does, in the words `actions` and the README use. */
  summary: string;
  /** The key that does the same thing, when there is one. */
  keys?: string;
  /** What it touches of the person's: the one actor rule, checked by the dispatcher (Touches). The most it can touch. */
  touches: Touches;
  /**
   * What it touches with these arguments, when they decide it (board.hub with id= shows a board; without, it answers),
   * and `tile`: the tile the request named (tile=), when it named one (the desk's open: a reader named is moved).
   */
  touchesWith?(args: A, tile?: string): Touches;
  /** `touches: "tile"`: refused in the tile with the person's keys (`focused`, the default), or only while they type in it. */
  while?: "focused" | "typing";
  /** `touches: "draft"`: what it does to a draft (DraftUse); default `write`. */
  draft?: DraftUse;
  /** Whether a restarted door may run it again by itself (Replay). */
  replay: Replay;
  /** The person's own: an agent's is refused with this, which says why and what an agent does instead. */
  person?: string;
  /** `touches: "tile"`: what an agent does instead, said when it's refused in the person's tile. */
  way?: string;
  /**
   * What an agent's run says on the status bar once it's done ("opened a note in column 3"), from its answer; with
   * `ms`, how long it stays (a screen pushed over the person's: "q goes back" stays 6s).
   */
  says?(out: any, args: A): string | { text: string; ms: number } | null | undefined;
  /** `says` is said to the person too: a confirmation the screen doesn't show (a layout saved, where a drag put a tile). */
  confirms?: true;
  /** Words `tile=` may give instead of a tile: where something new goes (the board's open: new-detail, float). */
  places?: readonly string[];
  args: { [K in keyof A]-?: ArgSpec };
  /** Its rows in a tile's menu (`tile.menu`, PIE-492): absent, it isn't in one. */
  menu?: MenuEntry<A, H> | readonly MenuEntry<A, H>[];
  run(args: A, host: H, actor: Actor): Promise<unknown> | unknown;
}

/**
 * One row of a tile's menu (PIE-492): a few words under a group, the key its keycap shows (a name `declaredKeys` finds in
 * the def's `keys`: the menu's accelerator too), and the arguments the row runs it with. The menu is generated from these:
 * the dispatcher lists each one the tile's sets have, as it would run it there.
 */
export interface MenuEntry<A, H> {
  label: string;
  /** "Tile", "Note", "Terminal", "Board": rows are grouped by it, in the order the dispatcher finds their sets. */
  group: string;
  key?: string;
  args?: Partial<A>;
  /**
   * The row as the tile is now: `hide` (it isn't this tile's now: back with nothing to go back to), `refused` (dimmed,
   * with why), another `label` (unzoom), or `args` for this tile (its lane's name). Asked without running anything.
   */
  now?(host: H, tile: { name: string; kind: string }, actor: Actor): MenuNow<A> | null | undefined;
}
export interface MenuNow<A> { hide?: boolean; refused?: string | null; label?: string; args?: Partial<A> }

/** The type an argument's schema says it is. */
type ArgOf<S> = S extends { type: "number" } ? number : S extends { type: "boolean" } ? boolean : string;
/**
 * The arguments an action's `args` schema says it takes (an `optional` one may be left out): the schema is the one
 * source. A schema kept apart is `as const`, or its types widen to a required string. None: no arguments at all.
 */
export type ArgsOf<S> = [keyof S] extends [never] ? Record<string, never>
  : { -readonly [K in keyof S as S[K] extends { optional: true } ? never : K]: ArgOf<S[K]> }
  & { -readonly [K in keyof S as S[K] extends { optional: true } ? K : never]?: ArgOf<S[K]> };
/** An action whose arguments are typed from its `args` schema (ArgsOf), its host from the set it's in (actionSet). */
// The cast only says what TS can't prove generically: ArgsOf<S>'s keys are S's.
export const def = <const S extends Record<string, ArgSpec>, H>(d: { args: S } & Omit<ActionDef<ArgsOf<S>, H>, "args">) => d as unknown as ActionDef<ArgsOf<S>, H>;
/** Each action's arguments in a set, by name. */
export type ArgsOfSet<S> = S extends ActionSet<infer M, any> ? M : never;
/** A set of `def` actions over host `H`, in scope `scope`: `actionSet<On>()("tile", { … })`. */
export const actionSet = <H>() => <M extends { [K in keyof M]: object }>(scope: string, defs: { [K in keyof M]: ActionDef<M[K], H> }) => new ActionSet<M, H>(scope, defs);

/**
 * An action as `ep0ch-door actions` lists it: `touches`, `replay` and `person` are its declarations (what it touches
 * of the person's, whether a restarted door may run it again, the person's only).
 */
export interface ActionInfo { name: string; summary: string; keys?: string; args: Record<string, ArgSpec>; scope: string; touches: Touches; replay: Replay; person?: true; /** Its touches depend on its arguments (`touchesWith`): `touches` is the most it reaches. */ varies?: true }

/** What the control socket sends: an action on the current screen, in one of its tiles (`tile=`), as someone. */
export interface ActRequest { action: string; tile?: string; args?: Record<string, unknown>; as?: string }

/** An action refused before anything happened, with the reason in plain words. */
export class ActionRefused extends Error {
  constructor(message: string) { super(message); this.name = "ActionRefused"; }
}

/**
 * A set of actions over one kind of host. `M` maps each action name to its argument object (derived from each
 * `def`'s schema by `actionSet`), so a caller in code gets its arguments checked by the compiler, and one from the
 * socket gets them checked (and coerced from strings) here.
 */
export class ActionSet<M extends { [K in keyof M]: object }, H> {
  constructor(readonly scope: string, private readonly defs: { [K in keyof M]: ActionDef<M[K], H> }) {
    everySet.add(new WeakRef(this as ActionSet<any, any>));
  }

  has(name: string): name is Extract<keyof M, string> { return Object.hasOwn(this.defs, name); }
  /** The def a name runs, with its declarations; undefined when the set has no such action. */
  def(name: string): ActionDef<any, H> | undefined { return this.has(name) ? (this.defs as Record<string, ActionDef<any, H>>)[name] : undefined; }
  /** The arguments a name takes. */
  argsOf(name: string): Record<string, ArgSpec> | undefined { return this.def(name)?.args as Record<string, ArgSpec> | undefined; }
  /** Every action's name, in order. */
  names(): string[] { return Object.keys(this.defs); }

  /**
   * Add an action while the door runs: an extension's (PIE-512), bound from what the service lists. One
   * already there under that name is replaced (the extension was reloaded).
   */
  define(name: string, def: ActionDef<any, H>): void {
    this.forget(name);
    (this.defs as Record<string, ActionDef<any, H>>)[name] = def;
  }
  /** Take an action out (its extension went away). */
  forget(name: string): boolean {
    if (!Object.hasOwn(this.defs, name)) return false;
    delete (this.defs as Record<string, unknown>)[name];
    return true;
  }

  /** Each action once. */
  list(): ActionInfo[] {
    return (Object.keys(this.defs) as (keyof M & string)[]).map(name => {
      const d = this.defs[name];
      return { name, summary: d.summary, keys: d.keys, args: d.args as Record<string, ArgSpec>, scope: this.scope, touches: d.touches, replay: d.replay, ...(d.person ? { person: true as const } : {}), ...(d.touchesWith ? { varies: true as const } : {}) };
    });
  }

  /** Run an action with arguments already typed (keys, code). */
  run<K extends keyof M & string>(name: K, args: M[K], host: H, actor: Actor): Promise<unknown> {
    return Promise.resolve(this.call(name, args, host, actor));
  }

  /**
   * Run an action, answering as it does: at once when it does, a promise when it waits (the dispatcher says what an
   * action did as soon as it's done; `run` is this, always a promise).
   */
  call<K extends keyof M & string>(name: K, args: M[K], host: H, actor: Actor): unknown {
    // The screen key that ran it names only the action it ran, not one that action runs in turn.
    const bound = boundKey;
    boundKey = null;
    for (const t of tracers) t({ scope: this.scope, name, keys: [this.defs[name].keys, bound].filter(Boolean).join("; ") || undefined, actor });
    return this.defs[name].run(args, host, actor);
  }

  /**
   * The arguments an action's own def sees (its `touchesWith`, its `says`): the wire's checked and coerced (`typed`
   * false). Running still goes through `call`/`callUntyped`.
   */
  defArgs(name: string, raw: Record<string, unknown>, typed: boolean): Record<string, unknown> {
    const spec = this.argsOf(name);
    return typed || !spec ? raw : coerce(name, spec, raw);
  }

  /** Run an action named on the wire: unknown names and wrong arguments are refused before it starts. */
  runUntyped(name: string, raw: Record<string, unknown>, host: H, actor: Actor): Promise<unknown> {
    return Promise.resolve(this.callUntyped(name, raw, host, actor));
  }
  /** `runUntyped`, answering as the action does (see `call`). */
  callUntyped(name: string, raw: Record<string, unknown>, host: H, actor: Actor): unknown {
    if (!this.has(name)) throw new ActionRefused(`no action ${name} here; try: ${Object.keys(this.defs).join(", ")}`);
    return this.call(name, coerce(name, this.argsOf(name)!, raw) as any, host, actor);
  }
}

// Every set made in this process (held weakly): the table test checks every action's declarations (PIE-514).
const everySet = new Set<WeakRef<ActionSet<any, any>>>();
/** Every action set that exists now: the built-ins, each tile kind's, an extension's while it's bound. */
export function allActionSets(): ActionSet<any, any>[] {
  const out: ActionSet<any, any>[] = [];
  for (const w of everySet) { const s = w.deref(); if (s) out.push(s); else everySet.delete(w); }
  return out;
}

/** One action run, as a tracer sees it: which set, which action, the keys it declares, and who ran it. */
export interface ActionRun { scope: string; name: string; keys?: string; actor: Actor }
const tracers = new Set<(r: ActionRun) => void>();
/** The screen's key map entry running now (a spec's `keys`): the key names the action it runs, as the action's own keys do. */
let boundKey: string | null = null;
/**
 * Run `f` as screen key `key` (a spec's key map: the board's `t` runs tile.drawer): what runs, runs as that key. Inside
 * another (a click on a hint's key), as both.
 */
export function asBoundKey<T>(key: string, f: () => T): T {
  const was = boundKey;
  boundKey = was ? `${was}; ${key}` : key;
  try { return f(); } finally { boundKey = was; }
}
/**
 * Watch every action run, from any set, until the returned function is called. The parity test (PIE-506) uses
 * it to tell a key that ran an action from one that changed the screen by itself.
 */
export function traceActions(f: (r: ActionRun) => void): () => void {
  tracers.add(f);
  return () => { tracers.delete(f); };
}

// ── key names (PIE-506): one spelling for a key, from a Key or from the words that name it ──

/** Named keys as the README, hints and `keys` write them, to the one name `keyName` gives. */
const NAMED: Record<string, string> = {
  "⏎": "enter", enter: "enter", return: "enter", esc: "esc", escape: "esc", tab: "tab", backtab: "shift+tab", "shift+tab": "shift+tab",
  space: "space", backspace: "backspace", "⌫": "backspace", delete: "delete", del: "delete",
  pgup: "pgup", pgdn: "pgdn", pageup: "pgup", pagedown: "pgdn", home: "home", end: "end",
  up: "up", down: "down", left: "left", right: "right", "↑": "up", "↓": "down", "←": "left", "→": "right",
  "alt+⏎": "alt+enter", "alt⏎": "alt+enter", "alt+enter": "alt+enter", "shift+enter": "shift+enter", "shift+⏎": "shift+enter", "ctrl+enter": "ctrl+enter",
  "alt+←": "alt+left", "alt+→": "alt+right", "alt+left": "alt+left", "alt+right": "alt+right",
  "alt+↑": "alt+up", "alt+↓": "alt+down", "alt+up": "alt+up", "alt+down": "alt+down",
  click: "click", "right-click": "click", "ctrl-click": "click", "alt-click": "click", drag: "drag", wheel: "wheel",
};
/** Whether `s` is a key's one name (what `keyName` gives): a screen's key map names its keys so. */
export const isKeyName = (s: unknown): s is string =>
  typeof s === "string" && (/^[^ ]$/u.test(s) || /^(alt|super)\+.$/u.test(s) || /^ctrl\+[^A-Z]$/u.test(s) || (Object.values(NAMED).includes(s) && !MOUSE.has(s)));
/** Words that are a mouse gesture: in a hint, what follows them is what's clicked, not more keys. */
const MOUSE = new Set(["click", "drag", "wheel"]);

/** The one name of a key: `q`, `Q`, `space`, `enter`, `ctrl+w`, `alt+l`, `shift+tab`, `click`; null for a paste (or a key typed out of one). */
export function keyName(k: Key): string | null {
  if ("pasted" in k && k.pasted) return null;
  switch (k.kind) {
    case "char": return k.ctrl ? `ctrl+${k.ch.toLowerCase()}` : k.ch === " " ? "space" : k.ch;
    case "alt": return `alt+${k.ch}`;
    case "super": return `super+${k.ch}`;
    case "enter": return "shift" in k && k.shift ? "shift+enter" : "ctrl" in k && k.ctrl ? "ctrl+enter" : "enter";
    case "alt-enter": return "alt+enter";
    case "backtab": return "shift+tab";
    case "alt-left": return "alt+left";
    case "alt-right": return "alt+right";
    case "alt-up": return "alt+up";
    case "alt-down": return "alt+down";
    case "back": return "alt+left";
    case "forward": return "alt+right";
    case "mouse": return k.action === "wheel-up" || k.action === "wheel-down" ? "wheel" : k.action === "wheel-left" || k.action === "wheel-right" ? "sideways" : k.action === "drag" ? "drag" : "click";
    case "paste": return null;
    default: return k.kind;
  }
}

const SHOWN: Record<string, string> = { enter: "⏎", backspace: "⌫", left: "←", right: "→", up: "↑", down: "↓", "shift+tab": "shift+tab" };
/**
 * A key's name as a keycap shows it (a tile menu's row): `ctrl+w x` is `^W x`, `enter` is `⏎`, `alt+left` is `alt+←`.
 * `declaredKeys` reads each of these back as the name it came from.
 */
export function keyCaption(name: string): string {
  return name.split(" ").map(k => {
    const ctrl = /^ctrl\+(.)$/u.exec(k);
    if (ctrl) return `^${ctrl[1]!.toUpperCase()}`;
    const mod = /^(alt|shift|ctrl)\+(.+)$/.exec(k);
    return mod && SHOWN[mod[2]!] ? `${mod[1]}+${SHOWN[mod[2]!]}` : SHOWN[k] ?? k;
  }).join(" ");
}

/** One word as key names (`1-9` is nine, `Tab/1-9` ten, `↑↓` two), or null when the word isn't a key. */
function wordKeys(w: string): string[] | null {
  if (!w) return null;
  const lower = w.toLowerCase();
  if (NAMED[lower]) return [NAMED[lower]!];
  if (/^\^[A-Za-z\]\[\\]$/.test(w)) return [`ctrl+${w[1]!.toLowerCase()}`];
  // super+ and cmd+ (the Mac's name for it) are one key: `super+c`.
  const mod = /^(ctrl|alt|shift|super|cmd)\+(.+)$/i.exec(w);
  if (mod) {
    const m = mod[1]!.toLowerCase().replace("cmd", "super"), rest = mod[2]!;
    if ([...rest].length === 1) return [m === "ctrl" ? `ctrl+${rest.toLowerCase()}` : m === "shift" ? rest.toUpperCase() : `${m}+${rest}`];
    const named = NAMED[rest.toLowerCase()];
    return named ? [`${m}+${named}`] : null;
  }
  const range = /^(\d)-(\d)$/.exec(w);
  if (range) { const out: string[] = []; for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(String(i)); return out; }
  if (w.includes("/") && w.length > 1) {
    const parts = w.split("/").map(wordKeys);
    return parts.every(Boolean) ? parts.flat() as string[] : null;
  }
  if ([...w].length === 1) return [w];
  if (w === "↑↓") return ["up", "down"];
  if (w === "←→") return ["left", "right"];
  return null;
}

/**
 * Every key an action's `keys` names, anywhere in it ("h l j k, click" → h l j k click). A chord is the
 * prefix and the key after it: `^W x` → `ctrl+w x`; so is `X then Y` (`alt+l then h`).
 */
export function declaredKeys(text: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  // Words are split on spaces only, so `,` `;` `(` `)` can be keys themselves; a word's own trailing comma or
  // semicolon, and parentheses around it, are punctuation.
  const words = text.split(/\s+/).filter(w => w && w !== "·").map(w => ([...w].length === 1 ? w : w.replace(/^\(+/, "").replace(/[,;:)]+$/, "")));
  for (let i = 0; i < words.length; i++) {
    const ks = wordKeys(words[i]!);
    if (!ks) continue;
    for (const k of ks) out.add(k);
    // A chord: ^W and the keys after it, or a key, `then`, and the keys after that.
    const prefix = ks[0] === "ctrl+w" ? "ctrl+w" : words[i + 1] === "then" ? ks[0]! : null;
    if (!prefix) continue;
    for (let j = i + (prefix === "ctrl+w" && words[i + 1] !== "then" ? 1 : 2); j < words.length; j++) {
      const next = wordKeys(words[j]!);
      if (!next || next.includes("ctrl+w")) break;
      for (const n of next) out.add(`${prefix} ${n}`);
    }
  }
  return out;
}

/**
 * The keys a hint row names: each " · " part starts with its keys, then says what they do ("j k scroll",
 * "^W window", "drag a title moves"). A part that starts with a word ("type to filter") names none.
 */
export const hintKeys = (text: string): string[] => text.split(/\s+·\s+|\s{2,}/).flatMap(leadingKeys);
/** The keys one hint part starts with ("j k scroll": j k), up to the words saying what they do. */
function leadingKeys(part: string): string[] {
  const out: string[] = [], words = part.trim().split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const ks = wordKeys(words[i]!.replace(/[,:]$/, ""));
    if (!ks) break;
    out.push(...ks);
    if (ks.some(k => MOUSE.has(k))) break;
  }
  return out;
}

const PLAIN = new Set(["enter", "esc", "tab", "backspace", "delete", "pgup", "pgdn", "home", "end", "up", "down", "left", "right"]);
const NAMED_KEY: Record<string, Key> = {
  space: { kind: "char", ch: " " }, "shift+tab": { kind: "backtab" }, "alt+enter": { kind: "alt-enter" }, "alt+left": { kind: "alt-left" },
  "alt+right": { kind: "alt-right" }, "alt+up": { kind: "alt-up" }, "alt+down": { kind: "alt-down" }, "shift+enter": { kind: "enter", shift: true }, "ctrl+enter": { kind: "enter", ctrl: true },
};
/** The key a key name stands for (`keyName`'s inverse); null for a mouse gesture. */
export function keyOfName(n: string): Key | null {
  if ([...n].length === 1) return { kind: "char", ch: n };
  const m = /^(ctrl|alt|super)\+(.)$/u.exec(n);
  if (m) return m[1] === "ctrl" ? { kind: "char", ch: m[2]!, ctrl: true } : { kind: m[1] as "alt" | "super", ch: m[2]! };
  return NAMED_KEY[n] ?? (PLAIN.has(n) ? { kind: n } as Key : null);
}

/**
 * The parts of a drawn hint row that start with one key drawn as a key (in one of `keyStyles`, its label in another:
 * "q menu", "alt+k lock"), by cell: a click on one presses that key. A part naming several keys ("j k scroll"), none
 * ("drag a title moves"), or text that isn't drawn as a key (a subject, a status, an edit's own grey hint) isn't one.
 */
export function hintSpots(drawn: string, keyStyles: readonly string[]): { from: number; to: number; key: Key }[] {
  const out: { from: number; to: number; key: Key }[] = [];
  let col = 0;
  for (const part of drawn.split(" · ")) {
    const text = visible(part), w = width(part), keys = leadingKeys(text);
    // Each word with the colour it's drawn in: the key's, then the label's.
    let sgr = "";
    const styles: string[] = [];
    for (const [t] of part.matchAll(/\x1b\[[\d;]*m|[^\s\x1b]+/g)) if (t.startsWith("\x1b")) sgr = t; else if (styles.push(sgr) === 2) break;
    const key = keys.length === 1 && keyStyles.includes(styles[0]!) && styles[1] !== styles[0] ? keyOfName(keys[0]!) : null;
    if (key) out.push({ from: col + text.length - text.trimStart().length, to: col + w, key });
    col += w + 3;
  }
  return out;
}

function coerce(action: string, spec: Record<string, ArgSpec>, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!(k in spec)) throw new ActionRefused(`${action} takes no ${k}; it takes ${Object.keys(spec).join(", ") || "nothing"}`);
  for (const [k, s] of Object.entries(spec)) {
    const v = raw[k];
    if (v === undefined || v === null) { if (!s.optional) throw new ActionRefused(`${action} needs ${k} (${s.about})`); continue; }
    if (s.type === "string") { if (typeof v !== "string" && typeof v !== "number") throw new ActionRefused(`${action}: ${k} is text`); out[k] = String(v); }
    else if (s.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw new ActionRefused(`${action}: ${k} is a number, not ${JSON.stringify(v)}`);
      out[k] = n;
    } else {
      const b = typeof v === "boolean" ? v : v === "true" || v === "1" || v === "yes" ? true : v === "false" || v === "0" || v === "no" ? false : null;
      if (b === null) throw new ActionRefused(`${action}: ${k} is true or false, not ${JSON.stringify(v)}`);
      out[k] = b;
    }
  }
  return out;
}

/** "an agent (claude-7)": how the door names an agent on screen. */
export const agentLabel = (actor: Actor) => (actor.kind === "agent" ? `an agent (${actor.id})` : "you");

/**
 * A context whose flashes say who did it: while an agent's action runs (and when its save or send lands
 * later), every message it raises starts with "an agent (<id>) · ". Everything else passes through.
 */
export function asActor<T extends { flash(msg: string): void }>(ctx: T, actor: Actor): T {
  if (actor.kind !== "agent") return ctx;
  const prefix = `${agentLabel(actor)} · `;
  return new Proxy(ctx, {
    get(target, p) {
      // How long it stays (Ctx.flash's `ms`) passes through: the shell's "q goes back" is meant to stay 6s.
      if (p === "flash") return (m: string, ...rest: unknown[]) => (target.flash as (m: string, ...r: unknown[]) => void).call(target, m.startsWith(prefix) ? m : prefix + m, ...rest);
      const v = Reflect.get(target, p, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * `key=value` words from the command line: `tile=` and `as=` go to the request, the rest are the action's
 * arguments. A value `@path` is read from that file and `@-` from stdin, so long text needn't be quoted.
 */
export async function parseActArgs(words: string[], stdin: () => Promise<string> = () => Bun.stdin.text()): Promise<ActRequest> {
  const [action, ...rest] = words;
  if (!action) throw new ActionRefused("act needs an action name; `actions` lists them");
  const req: ActRequest = { action, args: {} };
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (w === "--as" || w === "--tile") { const v = rest[++i]; if (v === undefined) throw new ActionRefused(`${w} needs a value`); if (w === "--as") req.as = v; else req.tile = v; continue; }
    const eq = w.indexOf("=");
    if (eq <= 0) throw new ActionRefused(`arguments are key=value, not ${JSON.stringify(w)}`);
    const k = w.slice(0, eq);
    let v = w.slice(eq + 1);
    if (v === "@-") v = (await stdin()).replace(/\n$/, "");
    else if (v.startsWith("@") && v.length > 1) v = (await Bun.file(v.slice(1)).text()).replace(/\n$/, "");
    if (k === "tile") req.tile = v;
    else if (k === "as") req.as = v;
    else req.args![k] = v;
  }
  return req;
}
