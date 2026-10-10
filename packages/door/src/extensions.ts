// Extensions in the door (PIE-512): what the outline service's extension registry offers (`extensions.list`,
// pi-herdr-outliner PIE-507, docs/extensions/README.md) bound into the door's shared parts, never drawn or run
// here by a path of the door's own:
//
// - handler lines (`moon::`, `horoscope::`, `fancy-horror::`) and `@name` agent lines are projections the
//   service reads (`resources.projection.read`); the note surface draws them (src/projection.ts). This module
//   only says which notes may have them (`mentionsExtension`), from the keys and names the service lists;
// - each extension action is an `ActionDef` named as the service names it (`ext.<id>.<action>`): a handler
//   line's or a block's in EXT_ACTIONS (on every screen, as `act` and from a reader's key and click), a tile's
//   (and the block actions a tile lists, for its keys) in its tile kind's own set. Every one runs
//   `extensions.act` with who asks (`mutation`); the service applies what it writes, attributed to the
//   extension (`ext:<id>`), and records who asked beside it (`requestedBy`);
// - each tile kind (`tileKinds`) registers in the tile-kind registry through `serviceKind` (src/desk/tile-kinds.ts),
//   a program in a terminal tile on the service's host.
//
// The service announces a change (an `extensions` event): the list is read again and bound again, so an
// extension added or removed while the door runs shows up or goes away without a restart.
import { hostname } from "node:os";
import type { ExtensionBarResult, ExtensionBarRow, ExtensionBarSource } from "@ep0ch/outline-core/protocol";
import type { Actor, SocketBoard } from "./socket";
import { findPassage, isMiss, missMessage, passageAt, type Passage } from "@ep0ch/outline-core/passage";
import { printable } from "./text";
import { ActionRefused, ActionSet, asActor, type ActionDef } from "./surface/actions";
import { kindsChanged, registerTileKind, serviceKind, tileKind, tileKinds, unregisterTileKind, type TileKind } from "./desk/tile-kinds";
import type { Policy } from "./desk/screen-layout";
import type { DeskApi } from "./desk/panes";
import { ProgramTile } from "./desk/tile-kinds";
import { barSources, openNote, registerBarSource, unregisterBarSource, type BarSource } from "./bar/source";

/** One action an extension declares, as `extensions.list` names it. */
export interface ExtensionAction {
  id: string;
  /** `ext.<extension>.<id>`: the door's action name. */
  name: string;
  label: string;
  description?: string;
  /**
   * `block` (the default), `handler:<key>` (a line of that handler), `tile:<kind>` (a tile of that kind), `bar` (a
   * power bar row's) or `outline` (no block: the outline as a whole; a scheduled action's, PIE-754).
   */
  on?: string;
  key?: string;
  effects?: string;
  /** `keep`, which every output and component handler has. */
  builtIn?: boolean;
}
export interface ExtensionHandler { key: string; kind: string; effects: string; description?: string; fields?: string[] }
export interface ExtensionAgent { name: string; description?: string; effects?: string; threads?: boolean }
export interface ExtensionEntry {
  /** `name` and `version` are absent for a folder that never loaded (it serves nothing; `error` says why). */
  id: string; name?: string; version?: number; description?: string; origin?: string;
  /** `active`, `failed` (it may still serve its last good version), `disabled` or `shadowed`. */
  state: string;
  error?: string;
  handlers: ExtensionHandler[];
  actions: ExtensionAction[];
  agents?: ExtensionAgent[];
  /** Its schedules (PIE-754): `action:<id>` or `handler:<key>`, every or cron, the next run and what the last did. */
  schedules?: ExtensionScheduleEntry[];
}
export interface ExtensionScheduleEntry {
  entry: string; every?: string; cron?: string; next: string; running?: boolean;
  last?: { at: string; ok: boolean; message?: string; error?: string; ms: number };
}
/** A tile kind ready to register (`extensions.list`'s `tileKinds`). */
export interface ExtensionTileKind {
  kind: string; extension: string; name: string; description?: string;
  command: string[]; cwd: string; host?: string; env: Record<string, string>;
  actions: ExtensionAction[];
  policy?: Policy;
  accepts?: string[];
  args?: Record<string, { type: string; description?: string }>;
  save?: string;
}
/**
 * A rule (PIE-600) as `extensions.list` names it: an extension's (`ext:<id>/<rule>`) or a rule note's
 * (`note:<id>`), what it matches, what it draws and what it runs. The service evaluates them; the door draws the
 * decorations a note's read carries (src/projection.ts).
 */
export interface RuleEntry {
  key: string; name: string; description?: string;
  source: { kind: "extension"; extension: string; rule: string } | { kind: "note"; blockId: string };
  match: { query?: string; view?: string; under?: string; text?: string; kind?: string };
  decorate?: { place?: string; use?: string; code: boolean };
  on?: { start?: string; stop?: string; change?: string; quiet: string };
  matching?: number;
  problem?: string;
}
export type { ExtensionBarResult, ExtensionBarRow, ExtensionBarSource };
export interface ExtensionList { generation: number; extensions: ExtensionEntry[]; tileKinds: ExtensionTileKind[]; barSources?: ExtensionBarSource[]; primitives?: string[]; targets?: string[]; rules?: RuleEntry[]; ruleProblems?: string[] }
export interface ExtensionActResult {
  extension: string; action: string; message?: string; written: string[];
  /** Text for the clipboard (copy with a citation): the client copies it. */
  copy?: string;
  /** The passage it acted on, as the service checked it (moved when the text moved since it was read). */
  passage?: Passage;
}

/** What an extension action needs from where it runs: the outline, and somewhere to say what happened. */
export interface ExtOn { ctx: { board: SocketBoard; flash(msg: string, ms?: number): void; redraw(): void } }
export interface ExtArgs { block?: string; line?: number; with?: string }

/** A bar row's `args` as `with=` carries them (JSON text of names to text), checked; refused with why. */
function withArgs(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new ActionRefused("with= is JSON: names to text, as a bar row's args"); }
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.values(v).some(x => typeof x !== "string")) throw new ActionRefused("with= maps names to text");
  return v as Record<string, string>;
}

/**
 * The actions of handler lines and blocks (`ext.<id>.<action>`), on every screen: `act ext.fancy-horror.ward
 * block=<id>`, a reader's key on that line (`w`), a click on its `[w ward]`. Bound and unbound as the
 * service's list changes.
 */
export const EXT_ACTIONS = new ActionSet<Record<string, ExtArgs>, ExtOn>("extensions", {});

// ── the list, as last read ───────────────────────────────────────────────────

let current: ExtensionList | null = null;
let mentions: RegExp | null = null;
const boundActions = new Set<string>();
/** The tile kinds this module registered, with what they were made from (a changed entry is registered again). */
const boundKinds = new Map<string, string>();

/**
 * An extension the service serves from: active, or failed but still on its last good version (it has a name).
 * What it serves is the service's call: a folder it doesn't serve lists no handlers, actions or tiles.
 */
const serving = (e: ExtensionEntry) => e.state === "active" || (e.state === "failed" && !!e.name);

/** One line of extension text (a name, a label, a message): no control characters reach the terminal. */
export const oneLine = (v: unknown) => printable(v, " ").trim();
const clean = (v: string | undefined) => (v === undefined ? undefined : oneLine(v));
/** A key an extension binds in the door: one printable character, else none (it's still a click and `act`). */
const keyOf = (k: string | undefined) => (k && [...k].length === 1 && /^[\x21-\x7e]$/.test(k) ? k : undefined);

/** The list with every text it carries made safe to draw: an extension's words are its own, never escapes. */
function cleaned(l: ExtensionList): ExtensionList {
  const action = (a: ExtensionAction): ExtensionAction => ({ ...a, id: oneLine(a.id), name: oneLine(a.name), label: oneLine(a.label) || oneLine(a.id), description: clean(a.description), ...(a.key !== undefined ? { key: oneLine(a.key) } : {}) });
  return {
    ...l,
    extensions: l.extensions.map(e => ({ ...e, ...(e.name !== undefined ? { name: oneLine(e.name) } : {}), description: clean(e.description), error: clean(e.error), handlers: e.handlers ?? [], actions: (e.actions ?? []).map(action), agents: e.agents ?? [],
      // A run's message and error are the extension's own words: one clean line each.
      schedules: (e.schedules ?? []).map(x => ({ ...x, entry: oneLine(x.entry), ...(x.last ? { last: { ...x.last, message: clean(x.last.message), error: clean(x.last.error) } } : {}) })) })),
    tileKinds: (l.tileKinds ?? []).map(t => ({ ...t, name: oneLine(t.name), description: clean(t.description), actions: (t.actions ?? []).map(action) })),
    rules: (l.rules ?? []).map(r => ({ ...r, name: oneLine(r.name), description: clean(r.description), ...(r.problem !== undefined ? { problem: oneLine(r.problem) } : {}) })),
    ruleProblems: (l.ruleProblems ?? []).map(oneLine),
  };
}

/** The last list read (null before it's read, or from a service without extensions). */
export const extensionList = (): ExtensionList | null => current;

/** The extension `id` as listed, while it serves. */
export const extensionNamed = (id: string): ExtensionEntry | undefined => current?.extensions.find(e => e.id === id && serving(e));

/** The rules the service lists (PIE-600): while there are any that decorate, every note's read may carry decorations. */
export const extensionRules = (): RuleEntry[] => current?.rules ?? [];
export const decoratingRules = (): boolean => extensionRules().some(r => !!r.decorate);

/**
 * Whether note text may have a handler line or an `@name` request line an extension answers: a cheap filter
 * over the keys and names the service lists, so a note without one is never asked about. The service parses.
 */
export function mentionsExtension(text: string): boolean {
  return !!mentions && mentions.test(text);
}

/** The actions on a handler's line (`on: handler:<key>`), the extension's own first, then the built-in keep. */
export function handlerActions(extension: string, handler: string): ExtensionAction[] {
  const e = extensionNamed(extension);
  if (!e) return [];
  const on = e.actions.filter(a => a.on === `handler:${handler}`);
  return [...on.filter(a => !a.builtIn), ...on.filter(a => a.builtIn)];
}

/**
 * The keys a reader keeps while one of its elements is current: an extension's key never shadows them (it
 * still runs by a click on its control and by `act`). Navigation, `r` (run again), `y` (copy) and the rest of
 * the reader's own (README "Reading a note").
 */
export const READER_OWN_KEYS = new Set("[]()fFuUryYvViICcmMAXezjkhlqgGbO/?nN0123456789 ".split(""));

/**
 * The action a key runs on a handler line: one the line has, bound to a single printable character that
 * neither the reader (READER_OWN_KEYS) nor its host (`hostKeys`: the BBS reader's `n p t`, a following
 * reader's `p`) keeps for itself.
 */
export function handlerKeyAction(extension: string, handler: string, key: string, hostKeys = ""): ExtensionAction | undefined {
  if (READER_OWN_KEYS.has(key) || hostKeys.includes(key)) return undefined;
  return handlerActions(extension, handler).find(a => keyOf(a.key) === key);
}

// ── running one ──────────────────────────────────────────────────────────────

/**
 * Run an extension's action through the service (`extensions.act`) and say what it did. Its writes are the
 * extension's (`ext:<id>`), whoever asked; an agent's run is said as the agent's on the status bar.
 */
export async function runExtensionAction(ctx: ExtOn["ctx"], a: ExtensionAction, extension: string, target: { blockId?: string; line?: number; args?: Record<string, string>; passage?: Passage }, actor: Actor): Promise<ExtensionActResult & { said: string }> {
  const say = asActor(ctx, actor);
  const name = extensionNamed(extension)?.name ?? oneLine(extension);
  say.flash(`${name}: ${a.label.toLowerCase()}…`);
  try {
    // Who asked goes with it (`mutation`): the writes stay the extension's, the feed records this as `requestedBy`.
    const r = await ctx.board.actExtension(extension, a.id, target, actor);
    // The extension's own words (its message) are drawn as text, never as escapes.
    const message = r.message !== undefined ? oneLine(r.message) : undefined;
    const said = `${name}: ${message || a.label}${r.written.length ? ` · written as ext:${oneLine(extension)}` : ""}`;
    say.flash(said);
    ctx.redraw();
    return { ...r, ...(message !== undefined ? { message } : {}), said };
  } catch (e) {
    say.flash(`${name}: ${a.label.toLowerCase()} refused: ${oneLine(e instanceof Error ? e.message : String(e))}`);
    ctx.redraw();
    throw e;
  }
}

/**
 * The passage an agent names by its words (ADR 0004 contract 5): `quote` in the block's current text, the occurrence
 * nearest `near` among repeats, as outline-core's one lookup finds it. Refused with why and the nearest match.
 */
export async function passageByQuote(board: Pick<SocketBoard, "get">, block: string, quote: string, near?: number): Promise<Passage> {
  if (block.startsWith("resource:")) throw new ActionRefused("a Resource's passage is picked in a reader that shows it (its selection, or the reader's passage.act quote=): its text isn't a block's");
  const m = await board.get(block);
  if (!m || m.revision === undefined) throw new ActionRefused(`no block ${block} to quote (outline_find finds one)`);
  const at = findPassage(m.text, quote, near === undefined ? {} : { near });
  if (isMiss(at)) throw new ActionRefused(missMessage(at));
  return passageAt(m.text, at.start, at.end, m.id, m.revision);
}

/** The ActionDef for a handler line's or a block's action. */
function lineAction(e: ExtensionEntry, a: ExtensionAction): ActionDef<ExtArgs, ExtOn> {
  if (a.on === "passage") return passageAction(e, a);
  const handler = a.on?.startsWith("handler:") ? a.on.slice(8) : null, bar = a.on === "bar", outline = a.on === "outline";
  const k = keyOf(a.key);
  const key = k && handler && !READER_OWN_KEYS.has(k) ? k : undefined;
  const unbound = a.key && !key ? ` Its key ${a.key} isn't bound here (${!keyOf(a.key) ? "the door binds one printable character" : "the reader keeps it"}): a click on its control, or act.` : "";
  return {
    summary: `${e.name ?? e.id}: ${a.description ?? a.label}${handler ? ` (on a ${handler}:: line: block=<its note>, line=<the line's index> when the note has several)` : bar ? " (a row of its power bar source runs it: with=<its args as JSON>)" : outline ? " (on the outline: no block)" : " (on block=<id>)"}. The service runs it; what it writes is attributed ext:${e.id}${a.effects === "write" ? "" : " (it only answers)"}.${unbound}`,
    ...(key ? { keys: `${key}, click` } : { keys: "click" }),
    // The service runs it and writes as the extension: nothing of the person's moves. Replaying it writes again.
    touches: "nothing", replay: a.effects === "write" ? "ask" : "safe",
    args: {
      block: { type: "string", optional: true, about: handler ? `the note with the ${handler}:: line` : "the block it acts on" },
      line: { type: "number", optional: true, about: "the line's index in the note's text (0 is its first line), when it has more than one" },
      with: { type: "string", optional: true, about: "the arguments a power bar row passes on, as JSON (names to text)" },
    },
    run({ block, line, with: w }, on, actor) {
      const args = withArgs(w);
      if (!block && !bar && !outline) throw new ActionRefused(`${a.name} acts on ${handler ? `a ${handler}:: line: say block=<the note's id>` : "a block: say block=<id>"}`);
      return runExtensionAction(on.ctx, a, e.id, { ...(block ? { blockId: block } : {}), ...(line !== undefined ? { line } : {}), ...(args ? { args } : {}) }, actor);
    },
  };
}

/**
 * An action on a passage (`on: passage`), on every screen: `act ext.marginalia.define block=<id> quote="soil pH"`
 * (near= among repeats). A reader's selection runs it too, through the reader's `passage.act` (and its toolbar's click
 * and key), which builds the passage from exact source offsets; an agent names its words, never the person's selection.
 */
function passageAction(e: ExtensionEntry, a: ExtensionAction): ActionDef<ExtArgs & { quote?: string; near?: number }, ExtOn> {
  return {
    summary: `${e.name ?? e.id}: ${a.description ?? a.label} (on a passage: block=<the note's id> quote=<its exact words>, near=<an offset> among repeats; in a reader, its selection through passage.act). The service checks the passage, then runs it; what it writes is attributed ext:${e.id}${a.effects === "write" ? "" : " (it only answers)"}.`,
    keys: "a then its key, or a click on its chip, while text is selected in a reader",
    touches: "nothing", replay: a.effects === "write" ? "ask" : "safe",
    args: {
      block: { type: "string", optional: true, about: "the note the words are in" },
      quote: { type: "string", optional: true, about: "the exact words, as stored" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
      line: { type: "number", optional: true, about: "unused on a passage" },
      with: { type: "string", optional: true, about: "arguments, as JSON (names to text)" },
    },
    async run({ block, quote, near, with: w }, on, actor) {
      if (!block || quote === undefined) throw new ActionRefused(`${a.name} acts on a passage: say block=<the note's id> quote=<its exact words> (near= among repeats), or select the words in a reader and use passage.act`);
      const passage = await passageByQuote(on.ctx.board, block, quote, near);
      const args = withArgs(w);
      return runExtensionAction(on.ctx, a, e.id, { passage, ...(args ? { args } : {}) }, actor);
    },
  } as ActionDef<ExtArgs & { quote?: string; near?: number }, ExtOn>;
}

/** The extensions' actions on a passage, as listed: what a reader's passage toolbar offers. */
export function passageActions(): { extension: ExtensionEntry; action: ExtensionAction }[] {
  return (current?.extensions ?? []).filter(serving).flatMap(e => e.actions.filter(a => a.on === "passage").map(action => ({ extension: e, action })));
}

/** The agents that answer `@name` in a comment thread (`threads: true`): what a reader's Ask offers, first one first. */
export function threadAgents(): ExtensionAgent[] {
  return (current?.extensions ?? []).filter(serving).flatMap(e => (e.agents ?? []).filter(x => x.threads));
}

// ── a tile kind from the service ─────────────────────────────────────────────

/**
 * The key under ^W o for an extension's kind: the capital of its name's first letter (`T` for Tarot), so it
 * never moves when other extensions come or go. None when another kind holds it (or it would be `O`); the
 * kind still opens through `tile.open`, and the clash is said.
 */
function kindKey(name: string, kind: string): { key?: string; clash?: string } {
  const ch = /[A-Za-z]/.exec(name)?.[0]?.toUpperCase();
  if (!ch || ch === "O") return {};
  const holder = tileKinds().find(k => k.kind !== kind && (k.keys ?? []).some(x => x.key === ch));
  return holder ? { clash: `^W o ${ch} is ${holder.kind}'s` } : { key: ch };
}

interface ExtTileOn { pane: unknown; desk: DeskApi }

/** A tile's action: on the tile (`tile:<kind>`), or on a block (the tile's own `block` arg, or block=). */
function tileAction(t: ExtensionTileKind, a: ExtensionAction): ActionDef<ExtArgs, ExtTileOn> {
  const onBlock = (a.on ?? "block") === "block";
  return {
    summary: `${t.name}: ${a.description ?? a.label}${onBlock ? " (on the tile's block, or block=<id>)" : ""}. The service runs it; what it writes is attributed ext:${t.extension}`,
    // In the tile its program has the keys: the key is the program's own, which runs this same action.
    ...(keyOf(a.key) ? { keys: keyOf(a.key)! } : {}),
    // Its row in the tile's menu (tile.menu), under the kind's name.
    menu: { label: a.label, group: t.name, ...(keyOf(a.key) ? { key: keyOf(a.key)! } : {}) },
    touches: "nothing", replay: a.effects === "write" ? "ask" : "safe",
    // On a block: which one (the tile's own by default). On the tile: nothing to say.
    args: (onBlock ? { block: { type: "string", optional: true, about: "the block it acts on; default the tile's own (where it was opened)" } } : {}) as ActionDef<ExtArgs, ExtTileOn>["args"],
    run({ block }, { pane, desk }, actor) {
      const own = pane instanceof ProgramTile ? pane.state.block : undefined;
      const blockId = onBlock ? block ?? (typeof own === "string" ? own : undefined) : undefined;
      if (onBlock && !blockId) throw new ActionRefused(`${a.name} acts on a block: this ${t.name} tile was opened on none; say block=<id>, or open the tile from a note`);
      return runExtensionAction(desk.ctx, a, t.extension, { ...(blockId ? { blockId } : {}) }, actor);
    },
  };
}

/** Why a kind from the service can't run here, or null when it can. */
function unavailableHere(t: ExtensionTileKind): string | null {
  if (t.host && t.host !== hostname()) return `${t.name} runs on ${t.host}, where the outline service is; this door is on ${hostname()}`;
  return null;
}

/** The registry entry for one of the service's tile kinds: a program in a terminal tile (serviceKind). */
function kindEntry(t: ExtensionTileKind): TileKind {
  const { key } = kindKey(t.name, t.kind);
  const actions = new ActionSet<Record<string, ExtArgs>, ExtTileOn>(t.kind, Object.fromEntries(t.actions.map(a => [a.name, tileAction(t, a)])));
  return serviceKind({
    kind: t.kind,
    noun: t.name,
    about: `${t.description ?? t.name} (extension ${t.extension}; its program runs in a terminal tile${t.args?.block ? "; note=<id> is its block, default the note shown where it's opened" : ""})`,
    program: { command: t.command, cwd: t.cwd, env: t.env, args: t.args ?? {}, unavailable: unavailableHere(t), label: t.name, keys: t.actions.flatMap(a => (keyOf(a.key) ? [`${keyOf(a.key)} ${a.id}`] : [])) },
    ...(key ? { keys: [{ key, label: t.name.toLowerCase() }] } : {}),
    ...(t.policy ? { policy: t.policy } : {}),
    accepts: { notes: false, tiles: t.accepts ?? [] },
    actions,
  });
}

// ── a bar source from the service ────────────────────────────────────────────

/**
 * One of an extension's command-palette sources (PIE-656) as a power bar source: its rows asked of the service
 * (`extensions.bar`, the note in front of the person as its context) once typing pauses; a row's Markdown preview drawn
 * by the readers' renderer; a pick copies, opens the row's block where opens land, or runs the extension's action
 * through `extensions.act` like any of its actions (written as `ext:<id>`, who asked recorded beside it).
 */
function barEntry(b: ExtensionBarSource, prefix: string): BarSource {
  return {
    id: b.name, title: b.title, prefix, by: b.extension, asks: true,
    about: `${b.description ?? b.title} (extension ${b.extension})`,
    main: { empty: b.main, typed: b.main, most: 6 },
    async rows(q, host) {
      const r = await host.ctx.board.barRows(b.extension, b.id, q, { near: host.near() ?? undefined });
      return r.rows.map(row => ({ key: oneLine(row.id), label: oneLine(row.label), ...(row.detail ? { detail: oneLine(row.detail) } : {}), data: row }));
    },
    preview(row) {
      const r = row.data as ExtensionBarRow;
      return r.preview ? { markdown: r.preview } : r.block ? { note: r.block } : { lines: [row.label, ...(r.copy ? ["", `⏎ copies ${oneLine(r.copy).slice(0, 60)}`] : [])] };
    },
    async pick(row, host, how) {
      const r = row.data as ExtensionBarRow;
      // Its action runs as any of the extension's actions does: through the dispatcher, as who picked it, its rules its own.
      if (r.action) {
        const a = extensionNamed(b.extension)?.actions.find(x => x.id === r.action);
        if (!a) throw new ActionRefused(`${b.extension} no longer has the action ${r.action}`);
        const args = { ...(r.block ? { block: r.block } : {}), ...(r.args ? { with: JSON.stringify(r.args) } : {}) };
        return how.actor.kind === "agent" ? host.dispatch.act({ action: a.name, args }, how.actor) : host.dispatch.press(a.name, args);
      }
      if (r.block) return openNote(r.block, host, how);
      // A copy is the person's clipboard; an agent gets the text back.
      if (r.copy !== undefined) { if (how.actor.kind !== "agent") host.ctx.copy?.(r.copy); return { copied: r.copy }; }
      throw new ActionRefused("that row does nothing when picked");
    },
  };
}

/** The bar sources this module registered (by name), with what they were made from. */
const boundBar = new Map<string, string>();

/** Register the service's bar sources, take away those gone; a prefix another source has is left off (tab still reaches it), and said. */
function bindBar(list: readonly ExtensionBarSource[], problems: string[]) {
  const want = new Map(list.map(b => [b.name, b] as const));
  for (const name of boundBar.keys()) if (!want.has(name)) { unregisterBarSource(name); boundBar.delete(name); }
  for (const [name, b] of want) {
    const print = JSON.stringify(b);
    if (boundBar.get(name) === print) continue;
    const holder = b.prefix ? barSources().find(s => s.prefix === b.prefix && s.id !== name) : undefined;
    if (holder) problems.push(`${b.extension}'s bar source ${b.title} has no prefix: ${b.prefix} is ${holder.title}'s (tab reaches it)`);
    registerBarSource(barEntry(b, holder ? "" : b.prefix ?? ""));
    boundBar.set(name, print);
  }
}

// ── binding ──────────────────────────────────────────────────────────────────

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a bind changed, for the status bar: extensions that came or went, and what it couldn't bind (and why). */
export interface Bound { added: string[]; removed: string[]; problems: string[] }

/**
 * Bind what the service lists now: the handler keys and agent names the projection filter asks about, the
 * actions, and the tile kinds (as the service lists them: it lists only what it serves). What a previous list
 * bound and this one doesn't is taken out.
 */
export function bindExtensions(raw: ExtensionList | null): Bound {
  const next = raw ? cleaned(raw) : null;
  const was = new Map((current?.extensions ?? []).map(e => [e.id, e] as const));
  const saidRules = new Set(current?.ruleProblems ?? []);
  const before = new Set((current?.extensions ?? []).filter(serving).map(e => e.id));
  current = next;
  const served = (next?.extensions ?? []).filter(serving);
  const problems: string[] = [];
  // An extension that started failing (it may still serve its last good version): said once, with why.
  for (const e of next?.extensions ?? []) {
    if (e.state === "failed" && was.get(e.id)?.state !== "failed") problems.push(`${e.name ?? e.id} failed${e.error ? `: ${e.error}` : ""}${e.name ? " (still serving its last good version)" : ""}`);
  }
  // A rule note that can't be used (PIE-600): said once, as the service words it.
  for (const p of next?.ruleProblems ?? []) if (!saidRules.has(p)) problems.push(`rule ${p}`);
  // The filter: a handler line (`key::`, a bullet before it is fine) or a request line (`@name`).
  const keys = served.flatMap(e => e.handlers.map(h => escape(h.key)));
  const agents = served.flatMap(e => (e.agents ?? []).map(a => escape(a.name)));
  const alts = [...(keys.length ? [`(?:${keys.join("|")})::`] : []), ...(agents.length ? [`@(?:${agents.join("|")})(?![\\w-])`] : [])];
  mentions = alts.length ? new RegExp(`(?:^|\\n)[ \\t]*(?:[-*+][ \\t]+)?(?:${alts.join("|")})`, "i") : null;
  // Actions: a handler line's and a block's are EXT_ACTIONS, on every screen, even when a tile lists it too
  // (tarot's keep: `k` in its tile, and act on a block=<id> without one). One on a tile (`tile:<kind>`) is
  // that kind's own; a tile's set also holds its block actions, for its in-tile keys.
  const tiles = next?.tileKinds ?? [];
  const want = new Map<string, ActionDef<ExtArgs, ExtOn>>();
  for (const e of served) for (const a of e.actions) if (!(a.on ?? "block").startsWith("tile:")) want.set(a.name, lineAction(e, a));
  for (const name of boundActions) if (!want.has(name)) { EXT_ACTIONS.forget(name); boundActions.delete(name); }
  for (const [name, def] of want) { EXT_ACTIONS.define(name, def); boundActions.add(name); }
  // Tile kinds: registered through serviceKind; one whose entry changed is registered again, one gone is taken out.
  const kinds = new Map(tiles.map(t => [t.kind, t] as const));
  let changed = false;
  for (const [kind] of boundKinds) {
    if (kinds.has(kind)) continue;
    unregisterTileKind(kind, `its extension (${kind.split(".")[0]}) was removed or stopped serving it`);
    boundKinds.delete(kind);
    changed = true;
  }
  for (const [kind, t] of kinds) {
    const print = JSON.stringify(t);
    if (boundKinds.get(kind) === print) continue;
    // A built-in (or another module's kind) of the same name stays: an extension can't take its place.
    if (!boundKinds.has(kind) && tileKind(kind)) { problems.push(`${t.extension}'s tile kind ${kind} isn't registered: the door has a kind by that name`); continue; }
    const again = boundKinds.has(kind);
    if (again) { unregisterTileKind(kind, `${t.name} is being registered again`); boundKinds.delete(kind); changed = true; }
    const { clash } = kindKey(t.name, kind);
    if (clash && !again) problems.push(`${kind} has no key under ^W o (${clash}); act tile.open kind=${kind} opens it`);
    // One kind the registry refuses (a name it can't take) never stops the others.
    try { registerTileKind(kindEntry(t)); } catch (e) { problems.push(`${t.extension}'s tile kind ${oneLine(kind)} isn't registered: ${oneLine(e instanceof Error ? e.message : String(e))}`); continue; }
    boundKinds.set(kind, print);
    changed = true;
  }
  if (changed) kindsChanged();
  bindBar(next?.barSources ?? [], problems);
  const after = new Set(served.map(e => e.id));
  return { added: [...after].filter(id => !before.has(id)), removed: [...before].filter(id => !after.has(id)), problems };
}

let asking = 0;
/**
 * Read the service's list and bind it (`reload`: the service reads its folders now, not waiting for its
 * watcher). Only the newest read binds: one that answers after a later one (an event, then a reconnect) is
 * dropped. A failed read keeps what was bound and says so.
 */
export async function loadExtensions(board: SocketBoard, reload = false): Promise<Bound | { error: string } | null> {
  const mine = ++asking;
  let list: ExtensionList;
  try { list = await board.listExtensions(reload); } catch (e) {
    if (mine !== asking) return null;
    return { error: oneLine(e instanceof Error ? e.message : String(e)) };
  }
  if (mine !== asking) return null;
  return bindExtensions(list);
}
