// Named actions: everything a person does to a note (edit, save, quote a passage, comment, reply,
// resolve, follow a link) and a host adds (open a note in a reader, move a card), with typed arguments.
// Keys call them, and so does the control socket (`ep0ch-door act`), through the same code. An agent's
// action is never silent: the status bar says "an agent (<id>) …", the reader it touched says what it
// did, and what it writes is recorded as `author: agent` with its actor id.
import type { Actor } from "../socket";
import type { Key } from "../term";

export type ArgType = "string" | "number" | "boolean";
/** One argument: its type, whether it may be left out, and what it means. */
export interface ArgSpec { type: ArgType; optional?: boolean; about: string }

export interface ActionDef<A, H> {
  /** What the action does, in the words `actions` and the README use. */
  summary: string;
  /** The key that does the same thing, when there is one. */
  keys?: string;
  args: { [K in keyof A]-?: ArgSpec };
  /**
   * Other names for this same action (an older name agents' scripts use, a view's own word for it). Each runs
   * this def, is listed with it (not as an action of its own) and is one action to the keys and the parity test.
   */
  aliases?: (string | ActionAlias)[];
  run(args: A, host: H, actor: Actor): Promise<unknown> | unknown;
}

/**
 * An alias with its own arguments: `args` (when they differ) are what it takes, and `map` turns them into the
 * action's. `keys`: the keys a view binds to it (the board's `c` on a reader).
 */
export interface ActionAlias {
  name: string;
  keys?: string;
  args?: Record<string, ArgSpec>;
  map?(args: Record<string, unknown>): Record<string, unknown>;
  /** The answer as the older name gave it (a field it named differently, `pane` or `focus`), from the action's. */
  answer?(result: any): unknown;
}

/** An action as `ep0ch-door actions` lists it: `aliases` are its other names, each the same action. */
export interface ActionInfo { name: string; summary: string; keys?: string; args: Record<string, ArgSpec>; scope: string; aliases?: string[] }

/**
 * What the control socket sends: an action on the current screen, in one of its tiles, as someone. `reader` is
 * the tile it names: `tile=` on the wire and the command line, `reader=` its older name (parseActArgs, control).
 */
export interface ActRequest { action: string; reader?: string; args?: Record<string, unknown>; as?: string }

/** An action refused before anything happened, with the reason in plain words. */
export class ActionRefused extends Error {
  constructor(message: string) { super(message); this.name = "ActionRefused"; }
}

/**
 * A set of actions over one kind of host. `M` maps each action name to its argument object, so a
 * caller in code gets its arguments checked by the compiler, and one from the socket gets them
 * checked (and coerced from strings) here.
 */
export class ActionSet<M extends { [K in keyof M]: object }, H> {
  /** Each alias's name, to its action's and how it maps its arguments. */
  private readonly aliasOf = new Map<string, { of: string; alias: ActionAlias }>();
  constructor(readonly scope: string, private readonly defs: { [K in keyof M]: ActionDef<M[K], H> }) {
    for (const name of Object.keys(defs) as (keyof M & string)[]) this.addAliases(name, defs[name]);
  }
  private addAliases(name: string, def: ActionDef<any, H>) {
    for (const a of def.aliases ?? []) {
      const alias = typeof a === "string" ? { name: a } : a;
      if (Object.hasOwn(this.defs, alias.name) || this.aliasOf.has(alias.name)) throw new Error(`${this.scope}: ${alias.name} is already an action`);
      this.aliasOf.set(alias.name, { of: name, alias });
    }
  }

  has(name: string): name is Extract<keyof M, string> { return Object.hasOwn(this.defs, name) || this.aliasOf.has(name); }
  /** The action a name runs: itself, or the one it's an alias of. */
  canonical(name: string): string { return this.aliasOf.get(name)?.of ?? name; }

  /**
   * Add an action while the door runs: an extension's (PIE-512), bound from what the service lists. One
   * already there under that name is replaced (the extension was reloaded).
   */
  define(name: string, def: ActionDef<any, H>): void {
    this.forget(name);
    (this.defs as Record<string, ActionDef<any, H>>)[name] = def;
    this.addAliases(name, def);
  }
  /** Take an action out (its extension went away), with its aliases. */
  forget(name: string): boolean {
    if (!Object.hasOwn(this.defs, name)) return false;
    delete (this.defs as Record<string, unknown>)[name];
    for (const [a, x] of this.aliasOf) if (x.of === name) this.aliasOf.delete(a);
    return true;
  }

  /** Each action once, its aliases named with it and their keys among its own. */
  list(): ActionInfo[] {
    return (Object.keys(this.defs) as (keyof M & string)[]).map(name => {
      const d = this.defs[name];
      const aliases = [...this.aliasOf].filter(([, x]) => x.of === name).map(([a]) => a);
      return { name, summary: d.summary, keys: this.keysOf(name), args: d.args as Record<string, ArgSpec>, scope: this.scope, ...(aliases.length ? { aliases } : {}) };
    });
  }
  /** An action's keys and the keys its aliases are bound to: one action, every key that runs it. */
  private keysOf(name: keyof M & string): string | undefined {
    const more = [...this.aliasOf.values()].filter(x => x.of === name && x.alias.keys).map(x => x.alias.keys!);
    return [this.defs[name].keys, ...more].filter(Boolean).join("; ") || undefined;
  }

  /** Run an action (or an alias of one) with arguments already typed (keys, code). */
  run<K extends keyof M & string>(name: K, args: M[K], host: H, actor: Actor): Promise<unknown> {
    // An action of its own by that name (an extension's, defined later) is that action, not an alias.
    const a = Object.hasOwn(this.defs, name) ? undefined : this.aliasOf.get(name);
    const of = (a?.of ?? name) as K;
    const mapped = (a?.alias.map ? a.alias.map(args as Record<string, unknown>) : args) as M[K];
    for (const t of tracers) t({ scope: this.scope, name: of, keys: this.keysOf(of), actor });
    const r = Promise.resolve(this.defs[of].run(mapped, host, actor));
    const answer = a?.alias.answer;
    return answer ? r.then(x => answer(x)) : r;
  }

  /** Run an action named on the wire: unknown names and wrong arguments are refused before it starts. */
  runUntyped(name: string, raw: Record<string, unknown>, host: H, actor: Actor): Promise<unknown> {
    if (!this.has(name)) throw new ActionRefused(`no action ${name} here; try: ${Object.keys(this.defs).join(", ")}`);
    const a = Object.hasOwn(this.defs, name) ? undefined : this.aliasOf.get(name);
    const spec = (a?.alias.args ?? this.defs[(a?.of ?? name) as keyof M & string].args) as Record<string, ArgSpec>;
    return this.run(name, coerce(name, spec, raw) as any, host, actor);
  }
}

/**
 * The person's key or click: `name` run as `you`, the same code an agent's `act` runs. A refusal (thrown, or a
 * rejected promise) is said through `say` (the status bar), never thrown at the key handler.
 */
export function runAsPerson<M extends { [K in keyof M]: object }, H, K extends keyof M & string>(set: ActionSet<M, H>, name: K, args: M[K], host: H, say: (msg: string) => void): Promise<unknown> {
  const tell = (e: unknown) => { say(e instanceof Error ? e.message : String(e)); return undefined; };
  try { return set.run(name, args, host, PERSON).catch(tell); } catch (e) { return Promise.resolve(tell(e)); }
}
const PERSON: Actor = { kind: "user" };

/** One action run, as a tracer sees it: which set, which action, the keys it declares, and who ran it. */
export interface ActionRun { scope: string; name: string; keys?: string; actor: Actor }
const tracers = new Set<(r: ActionRun) => void>();
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
  click: "click", "right-click": "click", "ctrl-click": "click", "alt-click": "click", drag: "drag", wheel: "wheel",
};
/** Words that are a mouse gesture: in a hint, what follows them is what's clicked, not more keys. */
const MOUSE = new Set(["click", "drag", "wheel"]);

/** The one name of a key: `q`, `Q`, `space`, `enter`, `ctrl+w`, `alt+l`, `shift+tab`, `click`; null for a paste. */
export function keyName(k: Key): string | null {
  switch (k.kind) {
    case "char": return k.ctrl ? `ctrl+${k.ch.toLowerCase()}` : k.ch === " " ? "space" : k.ch;
    case "alt": return `alt+${k.ch}`;
    case "super": return `super+${k.ch}`;
    case "enter": return "shift" in k && k.shift ? "shift+enter" : "ctrl" in k && k.ctrl ? "ctrl+enter" : "enter";
    case "alt-enter": return "alt+enter";
    case "backtab": return "shift+tab";
    case "alt-left": return "alt+left";
    case "alt-right": return "alt+right";
    case "back": return "alt+left";
    case "forward": return "alt+right";
    case "mouse": return k.action === "wheel-up" || k.action === "wheel-down" ? "wheel" : k.action === "drag" ? "drag" : "click";
    case "paste": return null;
    default: return k.kind;
  }
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
export function hintKeys(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/\s+·\s+|\s{2,}/)) {
    const words = part.trim().split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      const ks = wordKeys(words[i]!.replace(/[,:]$/, ""));
      if (!ks) break;
      out.push(...ks);
      if (ks.some(k => MOUSE.has(k))) break;
    }
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
 * `key=value` words from the command line: `tile=` (or its older name `reader=`) and `as=` go to the request,
 * the rest are the action's arguments. A value `@path` is read from that file and `@-` from stdin, so long text needn't
 * be quoted.
 */
/**
 * The tile a request names, from `tile` and `reader` (its older name): either, or both naming the same tile.
 * Two different tiles are refused, never one picked over the other.
 */
export function oneTile(a: string | undefined, b: string | undefined): string | undefined {
  if (a !== undefined && b !== undefined && a !== b) throw new ActionRefused(`tile= and reader= name two tiles (${a}, ${b}); reader= is tile='s older name, so give one`);
  return a ?? b;
}

export async function parseActArgs(words: string[], stdin: () => Promise<string> = () => Bun.stdin.text()): Promise<ActRequest> {
  const [action, ...rest] = words;
  if (!action) throw new ActionRefused("act needs an action name; `actions` lists them");
  const req: ActRequest = { action, args: {} };
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (w === "--as" || w === "--tile" || w === "--reader") { const v = rest[++i]; if (v === undefined) throw new ActionRefused(`${w} needs a value`); if (w === "--as") req.as = v; else req.reader = oneTile(req.reader, v); continue; }
    const eq = w.indexOf("=");
    if (eq <= 0) throw new ActionRefused(`arguments are key=value, not ${JSON.stringify(w)}`);
    const k = w.slice(0, eq);
    let v = w.slice(eq + 1);
    if (v === "@-") v = (await stdin()).replace(/\n$/, "");
    else if (v.startsWith("@") && v.length > 1) v = (await Bun.file(v.slice(1)).text()).replace(/\n$/, "");
    if (k === "tile" || k === "reader") req.reader = oneTile(req.reader, v);
    else if (k === "as") req.as = v;
    else req.args![k] = v;
  }
  return req;
}
