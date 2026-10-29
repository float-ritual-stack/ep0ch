import { errorDetails, type MessageDetails } from "./status-log";
import type { FormFieldType } from "@ep0ch/outline-core/form-fields";
import type { RunbookPlan } from "@ep0ch/outline-core/runbook";
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
import { TXN } from "./surface/txn";
import { INVITES } from "./surface/invite";
import { useResourceProviders, type ResourceProviderEntry } from "./resource-providers";
import { hostname } from "node:os";
import type { ExtensionBarResult, ExtensionBarRow, ExtensionBarSource, ExtensionSettings } from "@ep0ch/outline-core/protocol";
import { settingsAction } from "./extension-settings";
import { isResourceRef } from "@ep0ch/outline-core/resource-ref";
import type { Actor, SocketBoard } from "./socket";
import { findPassage, isMiss, missMessage, passageAt, type Passage } from "@ep0ch/outline-core/passage";
import { printable } from "./text";
import { partyOf, UndoHistory } from "./steps";
import { ActionRefused, ActionSet, actionSet, asActor, def, shownLine, type ActionDef } from "./surface/actions";
import { kindsChanged, registerTileKind, serviceKind, tileKind, tileKinds, unregisterTileKind, type TileKind } from "./desk/tile-kinds";
import type { Policy } from "./desk/screen-layout";
import type { DeskApi } from "./desk/panes";
import { ProgramTile } from "./desk/tile-kinds";
import { barSources, openNote, registerBarSource, unregisterBarSource, type BarSource } from "./bar/source";
import { askInBar, type BarQuestion } from "./bar/ask";

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
  /** What it asks for (PIE-784): the door asks the person for them, `act` takes them as `name=value`. */
  args?: ExtensionActionArg[];
  /**
   * `block` (PIE-828): it also asks for the fields the block it runs on writes (`[form-field::…]`), which the service
   * answers (`extensions.args` on that block); `act` takes them in `with=` as JSON.
   */
  fieldsFrom?: "block";
}
/** An argument an action declares (PIE-784), as `extensions.list` carries it. */
export interface ExtensionActionArg {
  // The form grammar's types (outline-core form-fields.ts), as the manifest's schema takes them: a `note` names a note.
  name: string; type: FormFieldType; label?: string; description?: string;
  options?: string[]; from?: "block" | "children" | "outline"; required?: boolean; default?: string; defaultProperty?: string;
}
/** An argument with its choices on a block and its value when not given (`extensions.args`). */
export interface ExtensionArgChoice extends ExtensionActionArg {
  choices?: string[]; value?: string;
  /** One of the block's own fields (PIE-828): the door asks for every one the person didn't give. */
  fromBlock?: true;
}
export interface ExtensionHandler { key: string; kind: string; effects: string; description?: string; fields?: string[] }
export interface ExtensionAgent { name: string; description?: string; effects?: string; threads?: boolean }
export interface ExtensionEntry {
  scripts?: { name: string; file: string; about: string }[];
  script?: { keys: readonly string[]; line?: number; blockId?: string; file?: string; code: string };
  /** `name` and `version` are absent for a folder that never loaded (it serves nothing; `error` says why). */
  id: string; name?: string; version?: number; description?: string; origin?: string;
  /** A script's own words (its note's title, its extension's about); its `description` says where it is written. */
  summary?: string;
  /** `active`, `failed` (it may still serve its last good version), `disabled` or `shadowed`. */
  state: string;
  directory?: string;
  error?: string;
  handlers: ExtensionHandler[];
  actions: ExtensionAction[];
  agents?: ExtensionAgent[];
  /** Its schedules (PIE-754): `action:<id>` or `handler:<key>`, every or cron, the next run and what the last did. */
  schedules?: ExtensionScheduleEntry[];
  /** Its settings (PIE-1343): config.json's path on the host, each field its configSchema declares and its state. */
  settings?: ExtensionSettings;
  /** A copy of one of the repo's built-ins (PIE-1283): the built-in's folder and this copy's state; this copy is what runs. */
  builtIn?: { directory: string; state: "current" | "stale" | "forked" };
  /** A script an extension ships: that extension's id (lists fold it under it). */
  partOf?: string;
}
export interface ExtensionScheduleEntry {
  entry: string; every?: string; cron?: string; next: string; running?: boolean;
  /** `"host"` (PIE-767): it runs in one outline of the host; `runsIn` names that outline when it isn't this one. */
  once?: "host"; runsIn?: string;
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
/** One of the repo's extensions that isn't installed here (`extensions.list`'s `available`): what installing would add. */
export interface AvailableExtension { id: string; name: string; version: number; description?: string; scripts?: { name: string; file: string; about: string }[] }
export interface ExtensionList {
  generation: number; extensions: ExtensionEntry[]; tileKinds: ExtensionTileKind[]; barSources?: ExtensionBarSource[]; primitives?: string[]; targets?: string[]; rules?: RuleEntry[]; ruleProblems?: string[];
  /** The outline's Extensions hub, and each extension's page (README, what it adds, demo notes under it), by id. */
  hub?: string; pages?: Record<string, string>;
  /** How many of its demo notes each extension has left in the outline (none listed: none). */
  demos?: Record<string, number>;
  /** The repo's extensions not installed here: `extensions.install` adds one with its page and demo notes. */
  available?: AvailableExtension[];
  /** The service's resource providers (Jira's, and any extension's with a `kind: "resource"` handler). */
  resourceProviders?: ResourceProviderEntry[];
}
/** What `extensions.install` answers: what it did, and the page it wrote (with the demo notes under it). */
export interface ExtensionInstalled { id: string; lines: string[]; page?: string; hub?: string; state?: string; error?: string }
/** What `extensions.uninstall` answers: whether a folder went, and what became of its demo notes. */
export interface ExtensionUninstalled { id: string; lines: string[]; removed: boolean; demo: { trashed: number; kept: string[]; left: number } }
export interface ExtensionActResult {
  runbook?: RunbookPlan;
  /** Scripts write as their author and keep run undo on their source (or their run note for files). */
  writtenAs?: string;
  undoOn?: string;
  extension: string; action: string; message?: string; written: string[]; proposalId?: string;
  /** Text for the clipboard (copy with a citation): the client copies it. */
  copy?: string;
  /** What to open once it answers (PIE-754): a block id, or a Resource ref (file:, web:, resource:). */
  open?: string;
  /** The passage it acted on, as the service checked it (moved when the text moved since it was read). */
  passage?: Passage;
  /** Its writes landed as one step (PIE-784): `extensions.undo` with this takes them back whole. */
  undo?: string;
  /** Why they aren't one undo step here (they went into a live draft, whose ctrl+z undoes them). */
  undoNote?: string;
  /** A script run's state when the service answered (PIE-1264): `running` when it outlasted the wait; `message` is its last word. */
  state?: "running" | "done" | "failed" | "stopped";
  /** What the script returned, whole, when `message` (one line) can't hold it. */
  answer?: string;
}

/** What an extension action needs from where it runs: the outline, and somewhere to say what happened. */
export interface ExtOn { ctx: { board: SocketBoard; flash(msg: string, ms?: number, details?: MessageDetails): void; redraw(): void; dispatch?: { act(req: { action: string; args?: Record<string, unknown> }, actor: Actor): Promise<unknown> }; noteInFront?(): string | null } }
/** `block`, `line`, `with`, and the action's declared arguments by name. */
export interface ExtArgs { block?: string; line?: number; with?: string; [declared: string]: string | number | undefined }

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

/**
 * The extension actions' write groups that landed as one step (PIE-784), newest last: each kept for whoever asked and
 * the note it acted on, so that note's reader undoes it on ctrl+z (`ext.undo`) like its own changes, each party its own.
 */
export const EXT_UNDO = new UndoHistory<{ undo: string; label: string; by: string; context: string }>();

// ── the list, as last read ───────────────────────────────────────────────────

let current: ExtensionList | null = null;
let mentions: RegExp | null = null;
const boundActions = new Set<string>();
/** The tile kinds this module registered, with what they were made from (a changed entry is registered again). */
const boundKinds = new Map<string, string>();
// The test run's leak check (test/preload.ts), when there is one: what a test file left bound is named between files,
// and unbound before the next one runs (PIE-1412). Nothing outside tests sets it.
(globalThis as { [k: symbol]: { set(what: string, left: () => string[], reset: () => void): void } | undefined })[Symbol.for("ep0ch.test.leftovers")]
  ?.set("extensions bound", () => (current ? (current.extensions.length ? current.extensions.map(e => e.id) : ["an empty list"]) : []), () => { asking++; boundFrom = null; bindExtensions(null); });

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
  const arg = (x: ExtensionActionArg): ExtensionActionArg => ({ ...x, name: oneLine(x.name), ...(x.label !== undefined ? { label: oneLine(x.label) } : {}), description: clean(x.description), ...(x.options ? { options: x.options.map(oneLine) } : {}), ...(x.default !== undefined ? { default: oneLine(x.default) } : {}) });
  const action = (a: ExtensionAction): ExtensionAction => ({ ...a, id: oneLine(a.id), name: oneLine(a.name), label: oneLine(a.label) || oneLine(a.id), description: clean(a.description), ...(a.key !== undefined ? { key: oneLine(a.key) } : {}), ...(a.args ? { args: a.args.map(arg) } : {}) });
  return {
    ...l,
    extensions: l.extensions.map(e => ({ ...e, ...(e.name !== undefined ? { name: oneLine(e.name) } : {}), description: clean(e.description), error: clean(e.error), handlers: e.handlers ?? [], actions: (e.actions ?? []).map(action), agents: e.agents ?? [],
      // A run's message and error are the extension's own words: one clean line each.
      schedules: (e.schedules ?? []).map(x => ({ ...x, entry: oneLine(x.entry), ...(x.runsIn ? { runsIn: oneLine(x.runsIn) } : {}), ...(x.last ? { last: { ...x.last, message: clean(x.last.message), error: clean(x.last.error) } } : {}) })),
      ...(e.settings ? { settings: cleanSettings(e.settings) } : {}) })),
    tileKinds: (l.tileKinds ?? []).map(t => ({ ...t, name: oneLine(t.name), description: clean(t.description), actions: (t.actions ?? []).map(action) })),
    rules: (l.rules ?? []).map(r => ({ ...r, name: oneLine(r.name), description: clean(r.description), ...(r.problem !== undefined ? { problem: oneLine(r.problem) } : {}) })),
    ruleProblems: (l.ruleProblems ?? []).map(oneLine),
    available: (l.available ?? []).map(a => ({ ...a, id: oneLine(a.id), name: oneLine(a.name) || oneLine(a.id), description: clean(a.description) })),
    resourceProviders: (l.resourceProviders ?? []).filter(p => /^[a-z0-9][a-z0-9.-]*$/.test(p.key)).map(p => ({ ...p, label: oneLine(p.label) })),
  };
}

/** Settings as an extension's words: its descriptions, names and error drawn as one clean line each. */
function cleanSettings(x: ExtensionSettings): ExtensionSettings {
  return {
    ...x, file: oneLine(x.file), ...(x.error !== undefined ? { error: oneLine(x.error) } : {}),
    fields: x.fields.map(f => ({ ...f, name: oneLine(f.name), ...(f.description !== undefined ? { description: oneLine(f.description) } : {}), ...(f.choices ? { choices: f.choices.map(c => typeof c === "string" ? oneLine(c) : c) } : {}) })),
    secrets: x.secrets.map(k => ({ ...k, name: oneLine(k.name), ...(k.description !== undefined ? { description: oneLine(k.description) } : {}), ...(k.reference !== undefined ? { reference: oneLine(k.reference) } : {}) })),
  };
}

/** The last list read (null before it's read, or from a service without extensions). */
export const extensionList = (): ExtensionList | null => current;

/** What an extension adds, by kind, in the order its group is chosen by (the first it has): a list a row, a preview, a hub read. */
export const PART_KINDS = ["rules", "components", "scripts", "programs", "sources", "agents", "tiles", "records", "actions"] as const;
export type PartKind = typeof PART_KINDS[number];
/** One part as a row or a preview names it: its kind, one of them (`rule`, `agent`), and its name. */
export const partKind = (kind: PartKind) => kind.replace(/s$/, "");

/**
 * What extension `e` adds, read from its own declarations (`extensions.list`): its rules, its component and output lines,
 * its scripts, its schedules (programs), its bar sources, agents, tile kinds, record lines and actions, each by name.
 */
export function extensionParts(e: ExtensionEntry, l: ExtensionList | null = current): { kind: PartKind; name: string; about?: string }[] {
  const of = (kind: PartKind, items: readonly { name: string; about?: string | undefined }[]) => items.map(i => ({ kind, name: i.name, ...(i.about ? { about: i.about } : {}) }));
  return [
    ...of("rules", (l?.rules ?? []).filter(r => r.source.kind === "extension" && r.source.extension === e.id).map(r => ({ name: r.name, about: r.description }))),
    ...of("components", e.handlers.filter(h => h.kind === "component" || h.kind === "output").map(h => ({ name: `${h.key}::`, about: h.description }))),
    ...of("scripts", [...(e.scripts ?? []).map(s => ({ name: s.name, about: s.about })), ...(e.script ? [{ name: e.name ?? e.id, about: e.summary }] : [])]),
    ...of("programs", (e.schedules ?? []).map(s => ({ name: s.entry, about: s.every ? `every ${s.every}` : s.cron }))),
    ...of("sources", (l?.barSources ?? []).filter(b => b.extension === e.id).map(b => ({ name: b.title }))),
    ...of("agents", (e.agents ?? []).map(a => ({ name: `@${a.name}`, about: a.description }))),
    ...of("tiles", (l?.tileKinds ?? []).filter(t => t.extension === e.id).map(t => ({ name: t.name, about: t.description }))),
    ...of("records", e.handlers.filter(h => h.kind === "resource" || h.kind === "data").map(h => ({ name: `${h.key}::`, about: h.description }))),
    ...of("actions", e.actions.filter(a => !e.script || a.id !== "run").map(a => ({ name: a.label, about: a.description }))),
  ];
}

/**
 * What to run when a script isn't installed here but an extension the repo offers adds it (`extensions.list`'s `available`):
 * its install, as the refusal says it, or null when no extension adds a script of that name.
 */
export function scriptInstallWords(name: string, available: readonly AvailableExtension[] | undefined = current?.available): string | null {
  const provider = available?.find(e => e.scripts?.some(s => s.name === name));
  return provider ? `Script ${name} is not installed; install with ep0ch act extensions.install id=${provider.id}` : null;
}

export function scriptBindings() {
  return scriptActions().flatMap(s => s.extension.script!.keys.map(key => ({ key, action: s.action.name })));
}

export function scriptActions() {
  return (current?.extensions ?? []).filter(e => serving(e) && e.script).flatMap(e => e.actions.filter(a => a.id === "run").map(a => ({ extension: e, action: a })));
}


/** The extension `id` as listed, while it serves. */
export const extensionNamed = (id: string): ExtensionEntry | undefined => current?.extensions.find(e => e.id === id && serving(e));

/** The rules the service lists (PIE-600): while there are any that decorate, every note's read may carry decorations. */
export const extensionRules = (): RuleEntry[] => current?.rules ?? [];
export const decoratingRules = (): boolean => extensionRules().some(r => !!r.decorate);

/** What `mentionsExtension` reads, as one value: it changes when the extensions the service lists do (a result kept against it is stale when it moves). */
export const mentionsStamp = (): RegExp | null => mentions;
/**
 * Whether note text may have a handler line or an `@name` request line an extension answers: a cheap filter
 * over the keys and names the service lists, so a note without one is never asked about. The service parses.
 */
export function mentionsExtension(text: string): boolean {
  return (!!mentions && mentions.test(text)) || /^(?:[ \t]*)(?:`{3,}|~{3,})(?:sh|bash|zsh)\s+run\s*$/m.test(text);
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
export const READER_OWN_KEYS = new Set("[]()fFuUrRSt~\"yYvViICcmMAXezjkhlqgGbO/?nN0123456789 ,".split(""));

/**
 * The action a key runs on a handler line: one the line has, bound to a single printable character that
 * neither the reader (READER_OWN_KEYS) nor its host (`hostKeys`: the BBS reader's `n p t`, a following
 * reader's `p`) keeps for itself.
 */
export function handlerKeyAction(extension: string, handler: string, key: string, hostKeys = ""): ExtensionAction | undefined {
  if (READER_OWN_KEYS.has(key) || hostKeys.includes(key)) return undefined;
  return handlerActions(extension, handler).find(a => keyOf(a.key) === key);
}

// ── installing and removing one ──────────────────────────────────────────────

/** An extension's name as listed (installed or available), else its id. */
const nameOf = (id: string) => current?.extensions.find(e => e.id === id)?.name ?? current?.available?.find(a => a.id === id)?.name ?? oneLine(id);

/**
 * Installing and removing extensions, on every screen: the service does it (`extensions.install`, `extensions.uninstall`),
 * as `ep0ch ext add` and `ext remove` do from a shell, and writes the extension's page and demo notes under the outline's
 * Extensions hub. The power bar's extensions scope (`&`, src/bar/sources.ts) is where a person finds them, by keys and
 * mouse; an agent's is `act`. Nothing of the person's moves: the service writes, as itself and the extension.
 */
export const EXTENSION_INSTALL_ACTIONS = actionSet<ExtOn>()("extension-install", {
  "extensions.install": def({
    summary: "install one of the repo's extensions (extensions.list's available, as ep0ch ext add <id>): the service copies it in for every outline its host serves, loads it, and writes its page under the outline's Extensions hub, its README and what it adds, with its demo notes under it (once, as ext:<id>). Answers the page",
    keys: "⏎ or a click on its install row in the power bar's extensions (ctrl+k then &)",
    touches: "nothing", replay: "ask",
    says: (r: ExtensionInstalled) => `installed ${nameOf(r.id)}${r.page ? `: its page is ${r.page}` : ""}`,
    args: { id: { type: "string", about: "the extension's id, such as moon (extensions.list's available)" } },
    examples: [
      { act: "extensions.install id=moon", does: "installs the moon extension and writes its page under the Extensions hub" },
    ],
    async run({ id }, on, actor) {
      const say = asActor(on.ctx, actor);
      say.flash(`installing ${nameOf(id)}…`);
      try {
        const r = await on.ctx.board.installExtension(id, actor);
        say.flash(r.error ? `${nameOf(id)} is installed but ${r.state ?? "failed"}: ${oneLine(r.error)}` : `${nameOf(id)} installed · its page and demo notes are under Extensions`);
        on.ctx.redraw();
        return r;
      } catch (e) {
        throw new ActionRefused(`${nameOf(id)} wasn't installed: ${oneLine(e instanceof Error ? e.message : String(e))}`);
      }
    },
  }),
  "extensions.uninstall": def({
    summary: "remove an installed extension (as ep0ch ext remove <id>): its folder goes, and its handlers, actions and tiles with it; its demo notes stay (demo=keep) or go to Trash (demo=remove: the ones nobody changed, the rest are kept and named). demo= has no default: they never go silently. Its page stays while something is under it",
    keys: "⏎ or a click on one of its remove rows in the power bar's extensions (ctrl+k then &, then its name)",
    touches: "nothing", replay: "ask",
    says: (r: ExtensionUninstalled) => `removed ${nameOf(r.id)}${r.demo.trashed ? `, ${r.demo.trashed} demo notes to Trash` : r.demo.left ? `, its ${r.demo.left} demo notes kept` : ""}`,
    args: {
      id: { type: "string", about: "the installed extension's id" },
      demo: { type: "string", about: "keep (its demo notes stay under its page) or remove (to Trash, except what someone changed)" },
    },
    examples: [
      { act: "extensions.uninstall id=moon demo=keep", does: "removes the moon extension and leaves its demo notes in place" },
      { act: "extensions.uninstall id=moon demo=remove", does: "removes the moon extension and trashes the demo notes nobody changed" },
    ],
    async run({ id, demo }, on, actor) {
      if (demo !== "keep" && demo !== "remove") throw new ActionRefused("say what becomes of its demo notes: demo=keep or demo=remove");
      const say = asActor(on.ctx, actor);
      try {
        const r = await on.ctx.board.uninstallExtension(id, demo, actor);
        say.flash(`${nameOf(id)} removed${r.demo.trashed ? ` · ${r.demo.trashed} demo ${r.demo.trashed === 1 ? "note" : "notes"} to Trash` : r.demo.left ? ` · its ${r.demo.left} demo notes kept` : ""}${r.demo.kept.length ? ` · kept ${r.demo.kept.length} you changed` : ""}`);
        on.ctx.redraw();
        return r;
      } catch (e) {
        throw new ActionRefused(`${nameOf(id)} wasn't removed: ${oneLine(e instanceof Error ? e.message : String(e))}`);
      }
    },
  }),
});

// ── running one ──────────────────────────────────────────────────────────────

/**
 * Run an extension's action through the service (`extensions.act`) and say what it did. Its writes are the
 * extension's (`ext:<id>`), whoever asked; an agent's run is said as the agent's on the status bar.
 */
export function connectScriptActions(ctx: ExtOn["ctx"]): void {
  ctx.board.scriptAction = call => {
    if (!ctx.dispatch) return Promise.reject(new Error("The door dispatcher is unavailable"));
    const { tile, ...args } = call.args;
    // The run is a transaction of its own (src/surface/txn.ts): every layout change it makes is one history entry, closed when
    // `scripts.ended` says the run did, and put back if it ended early. A press's invitation (src/surface/invite.ts) rides on
    // every action the run asks, and is spent with the run.
    const run = call.actor.sessionId;
    INVITES.bind(call.invitation, run);
    const asked = call.requestedBy ? (call.requestedBy.author === "user" ? "you" : `agent:${call.requestedBy.actorId ?? call.requestedBy.author}`) : undefined;
    const actor: Actor = call.actor.author === "user" ? { kind: "user" }
      : { kind: "agent", id: call.actor.actorId ?? call.actor.author, ...(run ? { run } : {}), ...(asked ? { for: asked } : {}), ...(call.invitation && INVITES.covers(call.invitation, "screen", run) ? { invitation: call.invitation } : {}) };
    // Always the run's own transaction: a script can't name another and so escape its end rule.
    return ctx.dispatch.act({ action: call.action, args: { ...args, ...(run ? { txn: run } : {}) }, ...(typeof tile === "string" ? { tile } : {}) }, actor);
  };
}

export function scriptPressMessage(message: string, undo: boolean): string {
  return `${oneLine(message)}${undo ? " · ctrl+z undoes" : ""}`;
}

export async function runExtensionAction(ctx: ExtOn["ctx"], a: ExtensionAction, extension: string, target: { blockId?: string; line?: number; args?: Record<string, string>; passage?: Passage; invitation?: string; button?: { block: string; line?: number } }, actor: Actor): Promise<ExtensionActResult & { said: string }> {
  connectScriptActions(ctx);
  const say = asActor(ctx, actor);
  const entry = extensionNamed(extension);
  const name = entry?.name ?? oneLine(extension);
  const script = !!entry?.script && !a.builtIn;
  if (!script) say.flash(`${name}: ${a.label.toLowerCase()}…`);
  try {
    // Who asked goes with it (`mutation`): the writes stay the extension's, the feed records this as `requestedBy`.
    const r = await ctx.board.actExtension(extension, a.id, extension === "runbook" && a.id === "run-step" ? { ...target, args: undefined } : target, actor);
    if (extension === "runbook" && a.id === "run-step" && !r.runbook) throw new ActionRefused(r.message ?? "The runbook step could not be read.");
    if (r.runbook) await (await import("./runbook")).runBook(ctx, r.runbook, actor, target.args);
    // The extension's own words (its message) are drawn as text, never as escapes.
    const message = r.message !== undefined ? oneLine(r.message) : undefined;
    const said = script ? scriptPressMessage(message ?? `${name} done`, false) : `${name}: ${message || a.label}${r.written.length ? ` · written as ${oneLine(r.writtenAs ?? `ext:${extension}`)}` : ""}${r.undo ? " · ctrl+z undoes it" : ""}`;
    if (!script) say.flash(said);
    // One undo step (PIE-784): kept for whoever asked, against the note it acted on, for that reader's ctrl+z (ext.undo).
    const on = r.undoOn ?? target.blockId ?? target.passage?.subject;
    if (r.undo && on) EXT_UNDO.push({ undo: r.undo, label: a.label, by: partyOf(actor), context: on });
    // A script that ended in failure refuses its caller with its own words (PIE-1264): an agent's `act` is refused
    // (the person's press hears it from `scripts.ended`, and keeps the undo above for what it did before it stopped).
    if (script && r.state === "failed" && actor.kind !== "user") throw new ActionRefused(message ?? `${name} failed`);
    // What it asks to have opened (PIE-754): a block or a Resource, where this actor's opens land.
    if (r.open && ctx.dispatch) await ctx.dispatch.act({ action: "open", args: isResourceRef(r.open) ? { resource: r.open } : { id: r.open } }, actor)
      .catch((e: Error) => say.flash(`${name}: couldn't open ${oneLine(r.open)}: ${oneLine(e.message)}`, undefined, errorDetails(e)));
    ctx.redraw();
    return { ...r, ...(message !== undefined ? { message } : {}), said };
  } catch (e) {
    say.flash(`${name}: ${a.label.toLowerCase()} refused: ${oneLine(e instanceof Error ? e.message : String(e))}`, undefined, errorDetails(e));
    ctx.redraw();
    // A field the note's form asks for (PIE-828) isn't one of the action's own arguments: `act` takes it in with=.
    if (a.fieldsFrom === "block" && e instanceof Error && / needs [a-z][a-z0-9_-]*=/.test(e.message)) throw new ActionRefused(`${e.message} · give the note's fields as with='{"<field>":"<value>"}'`);
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
    summary: `${e.name ?? e.id}: ${a.label}${a.description ? `. ${a.description}` : ""}${handler ? ` (on a ${handler}:: line: block=<its note>, line=<the line's index> when the note has several)` : bar ? " (a row of its power bar source runs it: with=<its args as JSON>)" : outline ? " (on the outline: no block)" : " (on block=<id>)"}. The service runs it and attributes its writes${a.effects === "write" ? "" : " (it only answers)"}.${a.fieldsFrom === "block" ? ` It also asks for the fields the note writes as [form-field::<name> <type> …] (read the note for them): give them as with='{"<field>":"<value>"}'.` : ""}${unbound}`,
    ...(e.script?.keys.length ? { keys: `${e.script.keys.join(", ")}, click` } : key ? { keys: `${key}, click` } : { keys: "click" }),
    // The service runs it and writes as the extension: nothing of the person's moves. Replaying it writes again.
    touches: "nothing", replay: a.effects === "write" ? "ask" : "safe",
    args: {
      block: { type: "string", optional: true, about: handler ? `the note with the ${handler}:: line` : e.script ? "the note the script is about, its `this` (the person's: default the note in front of them)" : `the block it acts on${!bar && !outline ? " (the person's: default the note in front of them)" : ""}` },
      line: { type: "number", optional: true, about: "the line's index in the note's text (0 is its first line), when it has more than one" },
      with: { type: "string", optional: true, about: "the arguments a power bar row passes on, as JSON (names to text)" },
      invitation: { type: "string", optional: true, about: "the one-run invitation a person's press minted (src/surface/invite.ts): a script this starts may move their tiles, with it" },
      via: { type: "string", optional: true, about: "the button that pressed it, <note id>:<line>: the run's note records it with the button's author" },
      ...declaredArgs(a),
    } as ActionDef<ExtArgs, ExtOn>["args"],
    run({ block: named, line, with: w, invitation, via, ...rest }, on, actor) {
      // The person's run on a block names none: the note in front of them. An agent always names its block.
      // A script is an action on the outline that is still about a note: the one in front of the person is its `this`.
      const block = named ?? (actor.kind === "user" && !handler && !bar && (!outline || !!e.script) ? on.ctx.noteInFront?.() ?? undefined : undefined);
      if (!block && !bar && !outline) throw new ActionRefused(`${a.name} acts on ${handler ? `a ${handler}:: line: say block=<the note's id>` : "a block: say block=<id>"}`);
      // A `motion=` on a script's press (a button's `motion=fantasia`) is the script's to read: props.motion, and it passes it on to its own acts.
      const hint = TXN.getStore()?.motion;
      const given = { ...withArgs(w), ...givenArgs(a, rest), ...(e.script && hint ? { motion: hint } : {}) };
      // The person's own run of a script (the power bar's row, a key, their act) invites it as their button's press does
      // (src/surface/invite.ts, PIE-1186): it acts as them on their screen. Runs nobody pressed carry none (PIE-1403).
      // Minted when it runs, never for a form left unanswered.
      const invite = () => typeof invitation === "string" && invitation ? invitation : e.script && actor.kind === "user" ? INVITES.mint("you") : undefined;
      return askingFirst(on.ctx, e, a, block, given, actor, args => {
        const invited = invite();
        return runExtensionAction(on.ctx, a, e.id, { ...(block ? { blockId: block } : {}), ...(line !== undefined ? { line } : {}), ...(Object.keys(args).length ? { args } : {}),
          ...(invited ? { invitation: invited } : {}),
          ...(typeof via === "string" && /^[0-9a-f-]{8,}:\d+$/.test(via) ? { button: { block: via.slice(0, via.lastIndexOf(":")), line: Number(via.slice(via.lastIndexOf(":") + 1)) } } : {}) }, actor)
          // The run it started: the invitation belongs to it from here (and is spent when it ends).
          .then(r => { if (invited && r.undo) INVITES.bind(invited, r.undo); return r; });
      });
    },
  };
}

/** An action's declared arguments as its def's (PIE-784): `act ext.<id>.<action> by=price`, listed with their choices. */
function declaredArgs(a: ExtensionAction): Record<string, { type: string; optional: true; about: string; kind?: "note" }> {
  return Object.fromEntries((a.args ?? []).map(x => [x.name, {
    type: x.type === "number" ? "number" : "string", optional: true,
    // What it names, as declared (a script's `[form-field::page note]`): a note is picked from the notes. A choice's options stay
    // in `about` (the service checks and defaults them; as choices here an empty or spaced value would be refused before it).
    ...(x.type === "note" ? { kind: "note" as const } : {}),
    about: `${x.label ?? x.name}${x.description ? `: ${x.description}` : ""}${x.options ? ` (${x.type === "property" ? `${x.options.join(", ")}, or a property${x.from ? ` the ${x.from === "outline" ? "outline has" : x.from === "children" ? "children have" : "block has"}` : ""}` : x.options.join(", ")})` : x.type === "property" ? " (a property's name)" : ""}${x.default !== undefined ? `; default ${x.default}` : ""}${x.defaultProperty ? `, or the block's own [${x.defaultProperty}::]` : ""}${x.required ? "; needed" : ""}`,
  }]));
}

/** The declared arguments given by name (`by=price`), as the text the service takes. */
function givenArgs(a: ExtensionAction, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of a.args ?? []) if (raw[x.name] !== undefined) out[x.name] = String(raw[x.name]);
  return out;
}

/** A field of type `tag` (a template's prop, PIE-533 S4) is asked as text, typed as written (`#garden`). */
const asQuestion = <Q extends { type: string }>(x: Q) => (x.type === "tag" ? { ...x, type: "text", free: true } : x) as Q & { type: BarQuestion["type"] };

/** An argument the door asks the person for when they didn't give it: a choice or a property (from its choices), or a needed one. */
const asks = (x: ExtensionActionArg) => x.type === "choice" || x.type === "property" || (!!x.required && x.default === undefined && !x.defaultProperty);

/**
 * The person's run of an action with arguments they didn't give (PIE-784): the power bar asks for each, one at a time
 * (src/bar/ask.ts), its choices from the service (`extensions.args`: a property's from the rows it would act on) and its
 * value now lit, then the action runs with them. An agent is never asked: what it leaves out takes its default, or is refused.
 */
export async function askingFirst<R>(ctx: ExtOn["ctx"], e: ExtensionEntry, a: ExtensionAction, block: string | undefined, given: Record<string, string>, actor: Actor, run: (args: Record<string, string>) => Promise<R>): Promise<R | { asking: string; action: string }> {
  if (actor.kind !== "user" || !ctx.dispatch) return run(given);
  // A form from the note (PIE-828): what it asks is the note's, so the service says it (a form it can't read is refused there).
  if (a.fieldsFrom === "block") {
    let specs: ExtensionArgChoice[];
    try { specs = (await ctx.board.extensionArgs(e.id, a.id, block)).args; } catch (err) { throw new ActionRefused(err instanceof Error ? err.message : String(err)); }
    const open = specs.filter(x => (x.fromBlock || asks(x)) && !Object.hasOwn(given, x.name));
    if (!open.length) return run(given);
    const r = await askInBar(ctx, a.label, open.map(x => asQuestion(x.fromBlock ? { ...x, required: !!x.required } : x)), given, actor, run);
    return r && typeof r === "object" && "asking" in r ? { asking: (r as { asking: string }).asking, action: a.name } : r;
  }
  const open = (a.args ?? []).filter(x => asks(x) && given[x.name] === undefined);
  if (!open.length) return run(given);
  let specs: ExtensionArgChoice[];
  try { specs = (await ctx.board.extensionArgs(e.id, a.id, block)).args; } catch { specs = open; }
  const r = await askInBar(ctx, a.label, open.map(x => asQuestion({ ...x, ...specs.find(y => y.name === x.name) })), given, actor, run);
  return r && typeof r === "object" && "asking" in r ? { asking: (r as { asking: string }).asking, action: a.name } : r;
}

/**
 * An action on a passage (`on: passage`), on every screen: `act ext.marginalia.define block=<id> quote="soil pH"`
 * (near= among repeats). A reader's selection runs it too, through the reader's `passage.act` (and its toolbar's click
 * and key), which builds the passage from exact source offsets; an agent names its words, never the person's selection.
 */
function passageAction(e: ExtensionEntry, a: ExtensionAction): ActionDef<ExtArgs & { quote?: string; near?: number }, ExtOn> {
  return {
    summary: `${e.name ?? e.id}: ${a.label}${a.description ? `. ${a.description}` : ""} (on a passage: block=<the note's id> quote=<its exact words>, near=<an offset> among repeats; in a reader, its selection through passage.act). The service checks the passage, then runs it; what it writes is attributed ext:${e.id}${a.effects === "write" ? "" : " (it only answers)"}.`,
    keys: "a then its key, or a click on its chip, while text is selected in a reader",
    touches: "nothing", replay: a.effects === "write" ? "ask" : "safe",
    args: {
      block: { type: "string", optional: true, about: "the note the words are in" },
      quote: { type: "string", optional: true, about: "the exact words, as stored" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
      line: { type: "number", optional: true, about: "unused on a passage" },
      with: { type: "string", optional: true, about: "arguments, as JSON (names to text)" },
      ...declaredArgs(a),
    },
    async run({ block, quote, near, with: w, line: _line, ...rest }, on, actor) {
      if (!block || quote === undefined) throw new ActionRefused(`${a.name} acts on a passage: say block=<the note's id> quote=<its exact words> (near= among repeats), or select the words in a reader and use passage.act`);
      const passage = await passageByQuote(on.ctx.board, block, quote as string, near as number | undefined);
      const given = { ...withArgs(w), ...givenArgs(a, rest) };
      return askingFirst(on.ctx, e, a, block, given, actor, args => runExtensionAction(on.ctx, a, e.id, { passage, ...(Object.keys(args).length ? { args } : {}) }, actor));
    },
  } as ActionDef<ExtArgs & { quote?: string; near?: number }, ExtOn>;
}

/** The extensions' actions on a passage, as listed: what a reader's passage toolbar offers. */
export function passageActions(): { extension: ExtensionEntry; action: ExtensionAction }[] {
  return (current?.extensions ?? []).filter(serving).flatMap(e => e.actions.filter(a => a.on === "passage").map(action => ({ extension: e, action })));
}

/**
 * Every agent an extension serves (PIE-592): what `@` at a line's start offers while writing, so `@tidy` is found by
 * typing `@`, with what it does. Null before the list is read.
 */
export function noteAgents(): ExtensionAgent[] | null {
  return current ? current.extensions.filter(serving).flatMap(e => e.agents ?? []) : null;
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
  // A row's action as one request, for its pick and its copied line alike.
  const barRequest = (r: ExtensionBarRow): { action: string; args: Record<string, unknown> } | null => {
    if (!r.action) return null;
    const a = extensionNamed(b.extension)?.actions.find(x => x.id === r.action);
    if (!a) throw new ActionRefused(`${b.extension} no longer has the action ${r.action}`);
    return { action: a.name, args: { ...(r.block ? { block: r.block } : {}), ...(r.args ? { with: JSON.stringify(r.args) } : {}) } };
  };
  return {
    id: b.name, title: b.title, prefix, by: b.extension, asks: true,
    about: `${b.description ?? b.title} (extension ${b.extension})`,
    main: { empty: b.main, typed: b.main, most: 6 },
    async rows(q, host, _scope, signal) {
      const r = await host.ctx.board.barRows(b.extension, b.id, q, { near: host.near() ?? undefined, signal });
      return r.rows.map(row => ({ key: oneLine(row.id), label: oneLine(row.label), ...(row.detail ? { detail: oneLine(row.detail) } : {}), data: row }));
    },
    preview(row) {
      const r = row.data as ExtensionBarRow;
      return r.preview ? { markdown: r.preview } : r.block ? { note: r.block } : { lines: [row.label, ...(r.copy ? ["", `⏎ copies ${oneLine(r.copy)}`] : r.resource ? ["", `⏎ opens ${oneLine(r.resource)}`] : [])] };
    },
    // The line its pick runs (PIE-1405): its action's, or the open of its Resource; a note's row has none.
    command(row) {
      const r = row.data as ExtensionBarRow, req = barRequest(r);
      return req ? shownLine(req.action, req.args) : r.resource && !r.block ? shownLine("open", { resource: r.resource }) : null;
    },
    async pick(row, host, how) {
      const r = row.data as ExtensionBarRow;
      // Its action runs as any of the extension's actions does: through the dispatcher, as who picked it, its rules its own.
      const req = barRequest(r);
      if (req) return host.dispatch.as(how.actor, req);
      if (r.block) return openNote(r.block, host, how);
      // A Resource (PIE-754): opened where opens land, registered first if it must be (the desk's open resource=).
      if (r.resource) return host.dispatch.as(how.actor, { action: "open", args: { resource: r.resource } });
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
  useResourceProviders(next?.resourceProviders ?? []);
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
  // Its settings (PIE-1343), even while it fails (that's when they need fixing): an action of their own, unless it declares one by that name.
  for (const e of next?.extensions ?? []) if (e.settings && e.state !== "shadowed" && !want.has(`ext.${e.id}.settings`)) want.set(`ext.${e.id}.settings`, settingsAction(e, e.settings));
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
  // Said by name (PIE-1399): an extension's own, never a script it ships (`partOf`: its row is the extension's), never an id.
  const after = new Set(served.map(e => e.id));
  const named = (e: ExtensionEntry | undefined) => (e && !e.partOf ? [e.name ?? e.id] : []);
  return { added: [...after].filter(id => !before.has(id)).flatMap(id => named(served.find(e => e.id === id))), removed: [...before].filter(id => !after.has(id)).flatMap(id => named(was.get(id))), problems };
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
  boundFrom = board;
  return bindExtensions(list);
}

/** The board whose list is bound now (loadExtensions): only the door on it unbinds it. */
let boundFrom: SocketBoard | null = null;
/**
 * What's bound now and whose it is, to bind back after a read of another board's list (drawNote's: `ep0ch show`
 * inside a door). Bound back with its board, the door on it still unbinds it when it ends (PIE-1412).
 */
export const extensionBinding = () => ({ list: current, from: boundFrom });
export function restoreExtensionBinding(b: ReturnType<typeof extensionBinding>): void {
  boundFrom = b.from;
  bindExtensions(b.list);
}
/**
 * The door on `board` ended (App.quit): what its list bound goes, and a read of it still on its way binds nothing. A list
 * another board bound since is left alone.
 */
export function unbindExtensions(board: SocketBoard): void {
  if (boundFrom !== board) return;
  asking++;
  boundFrom = null;
  bindExtensions(null);
}
