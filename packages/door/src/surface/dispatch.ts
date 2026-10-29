import { AsyncLocalStorage } from "node:async_hooks";
import { parseTileAddress, type ResolveOpts } from "../desk/tile-address";
import { fromPress } from "../session/session-term";
import { effective, keyNow, keysNow } from "./keymap";
import { rankTextSearchMatches } from "@ep0ch/outline-core/search-match";
import { actionFailure, messageContext, type MessageDetails } from "../status-log";
import type { Hint } from "./hint-card";
// The dispatcher (PIE-514): one per screen host, the one door every action goes through. A screen registers its
// action sets; its keys and clicks (`press`), the control socket (`act`) and a tile holding a whole screen all call
// the dispatcher, which:
//
// - reads `tile=` with one grammar, over the tiles the screen lists (a name, a stable id, a number on
//   screen `#3`, `focused`, a block id, and the places a screen names: the board's `detail`), and the arguments that name a tile (`to=`) the same way;
// - finds the set that owns an action name, in the order the screen registered them (its own sets, the desk's
//   tile actions, the tile kinds', a reader's note actions, then the shell's, the host layer's and the extensions');
// - checks `expected=` against the layout's revision;
// - checks what the action declares it touches (ActionDef.touches) against where the person is, once: the actor rule
//   (`actorRule`, below), so no action asks who is acting for this;
// - runs it as the person (a key, a click: a refusal is said, then the screen is redrawn) or as an agent (said on
//   the status bar before it runs, refused with the reason, and what it did said after: ActionDef.says).
import { INVITES, type InviteScope } from "./invite";
import { TXN, takeReserved } from "./txn";
import type { KeyBinding } from "../desk/screen-spec";
import { Offline, USER, type Actor } from "../socket";
import { draftRule, type DraftSession } from "../draft-session";
import { heldBack, NOBODY, SHELL_IDLE_MS, typingIn, type ScreenKeys, type Whereabouts, type AgentPointers } from "../whereabouts";
import { agentRefusal, type AgentLevel } from "./agent-level";
import { ActionRefused, actionSet, def, agentLabel, asActor, asBoundKey, chordName, declaredKeys, isKeyName, keyCaption, type ActionDef, type Keys, type KeyRow, type ActionInfo, type Touches, type ActionSet, type ActRequest, type ArgSpec, type MenuEntry } from "./actions";

/** A tile as `tile=` reads it: the names it answers to, and what it shows (for a block id). */
/** `tile=<mount>/<tile>`: a tile of a screen mounted in a tile (PIE-651); names never hold a `/`. */
/** Actions that were renamed: a call to the old name is answered with the call that works (PIE-660: say the right thing). */
export const GONE_ACTIONS: Record<string, string> = {
  "reader.hold": "reader.hold is now reader.mode (PIE-705, any reader or detail): act reader.mode tile=<reader> mode=held | follows | pinned [page=<name>]; with no mode it toggles follows and held, as on= did",
  // The lists' actions are one set (PIE-747): a reader's inline lists and the links tile's rows answer to the same names.
  "links.blocks": "links.blocks is now list.blocks (PIE-747): act list.blocks tile=<reader> reads every list it draws, an inline ::links component or an extension's list view",
  "links.pick": "links.pick is now list.pick (PIE-747): act list.pick tile=<reader> [list=<number|^name|title>] n=<row> | id=<block>; list.step by=1 is the old by=",
  "links.open": "links.open is now list.open (PIE-747): act list.open tile=<reader> [list=<number|^name|title>] n=<row> | id=<block> [where=home|new]",
  "links.enter": "links.enter is now list.enter (PIE-747): act list.enter tile=<reader> [list=<number|^name|title>] [on=false]",
  "backlinks.pick": "backlinks.pick is now list.pick (PIE-747): act list.pick tile=<links tile> n=<row> | id=<block>; list.step by=1 is the old by=, list.open the old open=true / fresh=true",
  "backlinks.open": "backlinks.open is now list.open (PIE-747): act list.open tile=<links tile> n=<row> | id=<block> [where=home|new]",
};

export const isTilePath = (sel: string | undefined): sel is string => !!sel && sel.includes("/");

export interface TileRef {
  outline?: string;
  machine?: string;
  /** Its name: what answers say, and what `tile=` matches after ids. */
  name: string;
  /** A mounted screen: its tiles keep their own dispatcher and rules. */
  mount?: Dispatcher;
  /** Its door-wide stable id: the same tile while it lives. */
  id?: string;
  /** Its number on screen, from 1 (`#3`, or `3`): where it is now. */
  n?: number;
  /** Other names it answers to now (the board's `detail`): a place, like a number. */
  aliases?: readonly string[];
  /** Its kind (`reader`, `pty`, a river column). */
  kind: string;
  /** What it is for (`role:<role>` names it): set on the tile, else its kind's (PIE-1286). */
  role?: string;
  /** How a refusal names it ("column 3"); its name by default. */
  label?: string;
  /** Drawn now (false: in a shut dock, off the strip). */
  shown?: boolean;
  /** The block it shows as its note. */
  shows?: string | null;
  /** The block a list in it has selected (the river's Library): named by a block id after the tiles that show it. */
  lists?: string | null;
  /** It holds an edit or a comment. */
  editing?: boolean;
  /** It holds an edit or a comment of this actor's own (an agent's, or the person's). */
  holds?(actor: Actor): boolean;
  /** What an agent may do to it when the screen limits it (PIE-639), and which layer said so; absent: free. */
  agents?: { level: AgentLevel; by: string };
  /** Why a note action can't run in it now (folded to a spine, a peek, off screen), when one can't. */
  readOnly?: string | null;
}

/** A request as it ran: the action, its arguments and the tile it ran on. */
export interface RunRequest { action: string; args: Record<string, unknown>; tile?: { id: string | undefined; name: string; role?: string }; /** The request named its tile (`tile=`); else the action's default (the focused one) ran. */ named: boolean; /** What the action takes: a tile (its default is the focused one), or the screen. */ takes: Registration["takes"]; /** `safe`: it changes only the door's own view or layout, so running it again is a fair comparison. */ replay: import("./actions").Replay; /** The action set it ran in (`note`: acts at the cursor inside the tile). */ scope: string; actor: Actor; typed: boolean }
const requestTracers = new Set<(r: RunRequest) => void>();
/** Hear every request a dispatcher runs, with the tile it resolved to (the parity walk replays it by id and by role). Returns how to stop. */
export function traceRequests(f: (r: RunRequest) => void): () => void { requestTracers.add(f); return () => { requestTracers.delete(f); }; }
const requestRewriters = new Set<(req: ActRequest, actor: Actor) => ActRequest>();
/**
 * Change a person's request before it is resolved, once where it enters (runPlain, pressIn): the parity walk presses the same
 * key again with only its `tile=` said another way (by id, by role), so the key's own gesture (where the pointer is, the row it
 * lit) is the same both times. A rewriter changes one request and then returns what it is given: a request handed on to another
 * dispatcher enters there again. Returns how to stop.
 */
export function rewriteRequests(f: (req: ActRequest, actor: Actor) => ActRequest): () => void { requestRewriters.add(f); return () => { requestRewriters.delete(f); }; }
const rewritten = (req: ActRequest, actor: Actor) => { for (const f of requestRewriters) req = f(req, actor); return req; };

/**
 * One row of a tile's menu, as the dispatcher would run it: the action, its arguments and the tile (its stable id), the
 * row's words and group, the key its keycap shows, and why it would be refused now (the row is dimmed with it).
 */
export interface MenuRow {
  action: string; args: Record<string, unknown>; tile: string; label: string; group: string; key?: string; refused?: string;
  /** The tile's own row: its set runs in the tile itself (its kind's, a reader's note and list actions), not the screen's every-tile rows. */
  own?: true;
}
/**
 * An action's keys as they are now: its def's, with the person's keymap applied (keysNow), and the screen's own bindings
 * of it (a spec's keys, the ^W table; `bound`, the keymap already applied) as rows of their own, each saying it's the screen's.
 */
function withBound(name: string, keys: Keys | undefined, bound: readonly KeyBinding[]): Keys | undefined {
  const now = keysNow(name, keys);
  const extra = bound.filter(b => b.action === name).map(b => keyCaption(b.key)).filter(k => !declaredKeys(now).has(chordName(k) ?? k));
  if (!extra.length) return now;
  const rows: KeyRow[] = typeof now === "string" ? [{ keys: now, does: "" }] : [...(now ?? [])];
  return [...rows, ...extra.map(k => ({ keys: k, does: "on this screen" }))];
}
/** A menu row's keycap with the keymap applied: the file's first key for that binding when it names one (none when it unbinds it). */
const menuKey = (action: string, args: Record<string, unknown>, key: string | undefined): string | undefined => keyNow(action, args, key) ?? undefined;

/** Keys a menu row's keycap doesn't take from a def's `keys` (mouse gestures, the ^W prefix alone). */
const MENU_NOT_KEYS = new Set(["click", "drag", "wheel", "ctrl+w"]);

/** How a dispatcher's actions reach where they run: what `tile=` resolved to. */
export interface Target {
  /** The tile the action runs in (or, for a screen's own action given none, the person's: what the actor rule checks). */
  tile?: TileRef;
  /** The tile's name as the action is given it (undefined when the request named none: the action's own default). */
  name?: string;
  /** A place word the action takes instead of a tile (ActionDef.places). */
  place?: string;
}

/**
 * What a set's `on` is built with: who acts, a context whose messages say so, and what the caller already has for
 * it (`given`: a reader's own host for this key or click, its navigate a click's own), when it has it.
 */
export interface RunHow<C> { actor: Actor; ctx: C; standing: boolean; given?: unknown }

/** One action set on a dispatcher, and how its actions reach what they run on. */
export interface Registration<On = any> {
  set: ActionSet<any, On>;
  /**
   * How `tile=` reaches its actions. `screen`: the screen's own actions; a tile named is read by the grammar and its
   * name given (`Target.name`), none named leaves it to the action. `tile`: each runs in one tile (`in` says which can):
   * the one named, else the focused one when it can, else (`pick`) the first, or the only one. `none`: no tile.
   */
  takes: "screen" | "tile" | "none";
  /** `takes: "tile"`: the tiles its actions run in. */
  in?(t: TileRef): boolean;
  /** `takes: "none"`: the one tile all its actions run in, when they have one (the host layer's agent). */
  fixed?(): TileRef;
  /** `takes: "tile"`: what those tiles are called, for a refusal ("a terminal tile"). */
  noun?: string | ((name: string) => string);
  /** `takes: "tile"`, none named and the focused tile can't: `first`, or `only` (several: an agent names one). */
  pick?: "first" | "only";
  /** `takes: "tile"`: a note action is refused in a tile that can't be read now (TileRef.readOnly), unless it holds a draft. */
  seen?: boolean;
  /** The tiles its actions' menu rows belong in (a columns source's: its lanes), when `takes` alone doesn't say. */
  menuIn?(t: TileRef): boolean;
  /** Whether it takes this request; default: its set has the action. */
  claims?(req: ActRequest): boolean;
  /** What the set's actions run on, for a request. */
  on(at: Target, how: RunHow<any>): On;
  /**
   * The draft a `draft` action of this set writes, for the draft rule: a screen's own action names its block in its
   * arguments (the board's card=); without this, an action in a tile writes the tile's note (`DispatchHost.draftOf`).
   */
  draftOf?(at: Target, args: Record<string, unknown>, actor: Actor): DraftAt | null;
  /**
   * Run it through the host's own entry for the set (a reader's surface, which keeps its own modes' rules), instead
   * of the set's. `typed`: the arguments came from code (a key), not the wire.
   */
  run?(name: string, args: Record<string, unknown>, on: On, actor: Actor, typed: boolean): Promise<unknown>;
  /** The answer as the socket gives it (the tile it ran in added). */
  answer?(out: unknown, at: Target): unknown;
  /**
   * What an action touches in this tile, when the tile's kind decides it rather than the arguments (the lists' open: a
   * reader's moves what the person reads, a links tile's lands in its home reader). Absent: the def's own.
   */
  touchesAt?(action: string, at: Target): Touches | undefined;
}

/**
 * A dispatcher this one hands requests to: the App's, the screen shown; a desk's, a tile holding a whole screen (the
 * board in a tile), which takes the request as its own (`request`: tile= dropped) and answers with the tile named.
 */
export interface Delegation {
  delegate(req?: ActRequest): Dispatcher | null | undefined;
  claims?(req: ActRequest): boolean;
  request?(req: ActRequest): ActRequest;
  answer?(out: unknown, req: ActRequest): unknown;
  /** Its actions are listed with this dispatcher's (`actions`); default true. */
  listed?: boolean;
}

/** What a dispatcher's messages and repaints go through, and where it asks where the person is. */
export interface DispatchCtx { agentPointers?: AgentPointers; recordAction?(req: ActRequest, replay: import("./actions").Replay, run: () => unknown): unknown; flash(msg: string, ms?: number, details?: MessageDetails): void; redraw(): void; person?(): Whereabouts; /** The person's key refused (Ctx.refuse): said on the focused tile too, when it still answers press `at`. */ refuse?(msg: string, at?: number): void; pressNow?(): number;
  /**
   * The host layer (the drawer, above every screen): the one place that resolves what `tile=` names across layers (a tile's
   * id, `drawer.agent`, an `@screen/tile` path), for every screen host, a desk or not. A screen's own names are its own.
   */
  hostLayer?: { resolveTile?(sel: string, o?: ResolveOpts): { tile: TileRef; dispatch: Dispatcher } | null; /** Why `sel` names no tile in the host layer (the drawer's program closed, say), with what to run: a refusal says it. */ unnamed?(sel: string): string | null } }

/** The screen host a dispatcher serves. */
export interface DispatchHost {
  /** Runs before each action; true when it changed what's shown (the desk dropping a hint card), which the press then repaints for (PIE-1301). */
  beforeAction?(name: string): boolean | void;
  hint?(hint: Hint, tile: string | undefined, actor: Actor): void;
  /** Dispatchers for a screen's kinds share that screen's pointer identity. */
  pointerScope?: object;
  bindings?(): readonly KeyBinding[];
  /** The screen's title, for refusals. */
  readonly title: string;
  ctx(): DispatchCtx | null | undefined;
  /** Where the person's keys are on this screen (Screen.keys), when its context has no shell to ask (a test's). */
  keys?(): ScreenKeys;
  /** Where the person is, as this host sees it, when it says so itself (a reader on its own); else the shell's, or `keys`. */
  where?(): Whereabouts;
  /** The tiles `tile=` names, in order on screen. */
  tiles?(): TileRef[];
  resolveTile?(sel: string, o?: ResolveOpts): { tile: TileRef; dispatch: Dispatcher } | null;
  /** `expected=`: why it's refused (the layout changed since that revision), or null. Absent: the screen has none. */
  revision?(expected: unknown): string | null;
  /** A tile's draft for the draft rule: the note it shows and the session it holds. */
  draftOf?(t: TileRef): DraftAt | null;
}

/** What the draft rule is asked about: the block an action writes, and the draft session where it runs (if any). */
export interface DraftAt { board?: object | null; blockId?: string | null; session?: DraftSession | null }

/** How a tile was named: by what it is (a name, an id, a block it shows) or by where it is (a number, an alias, the focus). */
type NamedBy = "name" | "id" | "place" | "block" | "focused" | "default";

/** Standing comes from a press, never from a script's attribution or requestedBy. */
export function standsAsPerson(actor: Actor, where: Whereabouts, touch: InviteScope): boolean {
  return actor.kind === "user" || !!where.yolo || INVITES.covers(actor.invitation, touch, actor.run);
}

/** Where a step reaches (Dispatcher.rule): the tile, how a refusal names it, what an agent does instead, and `host`. */
export interface StepAt { tile?: string; label?: string; way?: string; host?: true; action?: string }
/** The actor rule for a step, against whereabouts `where`: Dispatcher.rule's, for a host with no dispatcher in reach (the drawer's raise). */
export function stepRule(touches: "tile" | "screen", actor: Actor, where: Whereabouts, at: StepAt = {}): string | null {
  return actorRule({ touches, ...(at.way ? { way: at.way } : {}), ...(at.host ? { host: true as const } : {}) }, actor, where, { tile: at.tile !== undefined ? { name: at.tile, ...(at.label ? { label: at.label } : {}) } : null, ...(at.action ? { action: at.action } : {}) });
}

/**
 * What a layout context reads of who acts (the desk's and the host layer's each build one): whether `actor` stands as the
 * person for the layout's shape, whether the person's typing is protected from it, and why a screen move is held now
 * (`held`, given what the step would do: "shut the dock they have"). The one answer (PIE-1294), so the two contexts
 * can't drift apart.
 */
export function layoutStanding(actor: Actor, where: Whereabouts, o: { host?: true; action?: string } = {}): { standing: boolean; protectTyping: boolean; held: (what: string) => string | null } {
  const standing = standsAsPerson(actor, where, "shape");
  return { standing, protectTyping: actor.kind === "agent" && !standing, held: what => actorRule({ touches: "screen", ...(o.host ? { host: true as const } : {}) }, actor, where, { what, ...(o.action ? { action: o.action } : {}) }) };
}

/** The answer to who may run an action, in plain words: null, or why not. Every action's actor rule is this. */
export function actorRule(def: Pick<ActionDef<unknown, unknown>, "touches" | "while" | "draft" | "person" | "personAlways" | "way" | "ownGate" | "host"> & { replay?: ActionDef<unknown, unknown>["replay"] }, actor: Actor, where: Whereabouts, at: {
  /** The tile it runs in (by name, and how a refusal says it). */
  tile?: { name: string; label?: string } | null;
  /** The action's name and what the tile it acts on lets an agent do (PIE-639): checked before anything else of the tile. */
  gate?: { action: string; agents: { level: AgentLevel; by: string } };
  /** The draft rule's answer for that tile (asked only for `touches: "draft"`). */
  draft?: () => string | null;
  /** The agent says it was invited into the draft (`invitation=`, for an action that takes one): the draft rule checks it. */
  invited?: boolean;
  /** The action asked for, by name: a press's invitation lifts a hold on navigation for layout and tile actions only, never for leaving the section. */
  action?: string;
  /** What a held screen move would have done, as its refusal says it ("shut the dock they have"). */
  what?: string;
}): string | null {
  if (actor.kind !== "agent") return null;
  // The person's alone: nothing lifts it, an invitation or yolo (ActionDef.personAlways).
  if (def.personAlways) return def.personAlways;
  if (INVITES.covers(actor.invitation, def.touches === "screen" || def.touches === "shape" ? def.touches : "tile", actor.run)) return null;
  if (def.person) return def.person;
  const standing = standsAsPerson(actor, where, def.touches === "screen" || def.touches === "shape" ? def.touches : "tile");
  // What the tile lets an agent do (PIE-639): `edit` allows reads and the note's own edits (a `draft` action), `off` only reads.
  const g = at.gate;
  if (!standing && g && g.agents.level !== "free" && !def.ownGate) {
    const reads = def.touches === "nothing" && def.replay === "safe", edits = def.touches === "draft" || def.touches === "nothing";
    const no = agentRefusal(g.agents.level, at.tile?.label ?? at.tile?.name ?? "that tile", g.action, { by: g.agents.by, note: g.agents.level === "edit" ? edits : reads });
    if (no) return no;
  }
  // Yolo hands the door to agents (Evan, Oct 22: "yolo is 'just fix it and get it done even if some agents need to move
  // things' … and yes, that includes the keys"): focus, typing, idle and away guards all lift. Only the words the person is
  // typing stay theirs (the draft rule below), since that's capture, not keys.
  if (where.yolo && def.touches !== "draft") return null;
  switch (def.touches) {
    case "nothing": case "shape": return null;
    case "draft": {
      // Replacing a tile's whole draft: never under the person's keys while they type there (the draft rule says
      // whose the draft is), unless they invited it (their `@name` line: the draft rule checks the invitation).
      const t = at.tile;
      if ((def.draft === "replace" || def.draft === "text") && !at.invited && t && where.typingIn === t.name) {
        return typingIn(t.label ?? t.name, "replace their text", def.draft === "replace" ? "draft.patch lands in their draft, or comment on the note or block.mark it to get their attention" : "block.mark gets their attention, or wait until it's sent or closed");
      }
      if (standing && t && where.typingIn === t.name) return typingIn(t.label ?? t.name, "change or close their draft");
      return standing ? null : at.draft?.() ?? null;
    }
    case "tile": {
      const t = at.tile;
      if (!t) return null;
      const label = t.label ?? t.name;
      const typing = where.typingIn === t.name;
      const theirs = def.while === "typing" ? typing : typing || (!standing && where.focus === t.name);
      if (!theirs) return null;
      const why = typing ? `the person is typing in ${label}` : `${label} has the person's keys`;
      return def.way ? `${why}; ${def.way}` : heldBack(why, "act there");
    }
    case "screen": {
      const what = at.what ?? "move the screen or their keys now";
      if (where.away) return heldBack(where.away, what, null);
      // Typing in the drawer (the host layer) is never in the way of a screen change: the drawer stays over every
      // screen, so the person's text and keys stay where they are (Evan, Oct 17: "typing in the chat door shouldn't be
      // a hard block on being able to move other parts of the screen"). An action that changes the drawer itself
      // (`host`, putting it away) still waits for them.
      if (where.keys === "host" && !def.host) return null;
      // (A hold on navigation only, as the showcase's sections, is lifted by an invitation too.)
      if (where.busy && !(where.navHold && /^(layout|tile|float)\./.test(at.action ?? "") && standing)) return heldBack(where.why ?? "the person is typing", what);
      if (standing) return null;
      if (where.idle < SHELL_IDLE_MS) return `the person is at the keys (last key ${(where.idle / 1000).toFixed(1)}s ago); try again once they've been idle ${SHELL_IDLE_MS / 1000}s`;
      return null;
    }
  }
}

const BLOCK = /^[0-9a-f-]{8,}$/;
/** What the person's press has done so far, for the repaint after it (asPerson): the actions run, and whether any changed what's shown. */
interface PressShown { ran: number; /** Something changed that no repaint has covered yet. */ changed: boolean; /** Repaints this press's own actions asked for (App.redraw says so through notePressRedraw). */ asked: number }
const pressShown = new AsyncLocalStorage<PressShown>();
/** Where no press is running, so a redraw made there counts for none. */
const NO_PRESS: PressShown = { ran: 0, changed: false, asked: 0 };
/** A repaint was asked for (App.redraw): the press whose action asked, and whatever it awaited, owes no second one for it. */
export function notePressRedraw(): void { const p = pressShown.getStore(); if (p) p.asked++; }
const isThenable = (x: unknown): x is PromiseLike<unknown> => typeof (x as { then?: unknown } | null)?.then === "function";
/** Whether a run changed what's shown (ActionDef.repaints): declared, or by what it touches of the person's (`nothing`: no). */
function changesShown(def: ActionDef<any, any>, touches: Touches, out: unknown, args: Record<string, unknown>): boolean {
  const r = def.repaints;
  return r === undefined ? touches !== "nothing" : typeof r === "function" ? r(out, args) : r;
}

/** `#3` or `3`: a tile's number on screen (a name never starts with a digit). */
const NUMBER = /^#?([1-9][0-9]{0,2})$/;

/**
 * What each dispatcher answered while a listing runs (`Dispatcher.list`): null outside one. A listing asks, for each action it
 * weighs, who claims it, and a claim asks where the person is and which tile an address names: the same answers each time, since
 * nothing moves while it runs. Asked once for each dispatcher.
 */
type Found = { tile: TileRef; dispatch: Dispatcher } | null;
let listing: Map<Dispatcher, { where?: Whereabouts; tiles?: TileRef[]; resolved: Map<string, Found>; hosted: Map<string, Found> }> | null = null;

export class Dispatcher {
  private nextConfirmation = 0;
  private saidConfirmation = 0;
  private regs: (Registration | Delegation)[] = [];
  constructor(private readonly host: DispatchHost, regs: (Registration | Delegation)[] = []) {
    this.regs = [...regs];
    if (host.tiles) this.regs.push({ set: POINTER_ACTIONS, takes: "screen", on: at => ({ dispatcher: this, at }) });
  }

  /** A dispatcher for one set with nothing to resolve (a reader outside any screen, a test's): the same path. */
  static of<On>(set: ActionSet<any, On>, on: On, ctx: () => DispatchCtx | null | undefined, title = set.scope): Dispatcher {
    return new Dispatcher({ title, ctx }, [{ set, takes: "none", on: () => on }]);
  }

  private pointer(actor: Actor) {
    return actor.kind === "agent" ? this.host.ctx()?.agentPointers?.get(actor.id, this.host.pointerScope ?? this) : undefined;
  }

  private pointerTarget(actor: Actor): ReturnType<Dispatcher["pointer"]> {
    const own = this.pointer(actor);
    if (own) return own;
    if (actor.kind !== "agent" || !this.host.ctx()?.agentPointers?.get(actor.id)) return;
    for (const tile of this.tilesNow()) {
      const inner = tile.mount?.pointerTarget(actor);
      if (inner) return { ...inner, tile: `${tile.id ?? tile.name}/${inner.tile}` };
    }
    if (!this.host.tiles) for (const reg of this.regs) {
      if ("set" in reg) continue;
      const inner = reg.delegate()?.pointerTarget(actor);
      if (inner) return inner;
    }
  }

  private declared(req: ActRequest): Registration | undefined {
    const owner = this.owner(req);
    return !owner ? undefined : "set" in owner ? owner : owner.delegate(req)?.declared(owner.request ? owner.request(req) : req);
  }

  /** Resolve before ownership: a mounted pointer must reach that screen's action set. */
  private pointed(req: ActRequest, actor?: Actor): ActRequest {
    if (!actor || req.tile !== undefined) return req;
    const pointer = this.pointerTarget(actor);
    if (!pointer) return req;
    const targeted = { ...req, tile: pointer.tile }, reg = this.declared(targeted);
    const def = reg?.set.def(req.action);
    if (!reg || !def || def.landing || !(reg.takes === "tile" || ["tile", "draft", "shape"].includes(def.touches))) return req;
    return { ...targeted, args: { ...req.args,
      ...(reg.takes === "tile" && reg.set.argsOf(req.action)?.note && req.args?.note === undefined && pointer.note ? { note: pointer.note } : {}),
    } };
  }

  focusAgent(at: Target, args: { note?: string; line?: number; clear?: boolean }, actor: Actor) {
    if (actor.kind !== "agent") throw new ActionRefused("agent.focus is for agents; tile.focus moves your keys");
    const pointers = this.host.ctx()!.agentPointers!;
    if (args.clear || (at.name === undefined && args.note === undefined && args.line === undefined)) {
      pointers.clear(actor.id);
      return { pointer: null };
    }
    const tile = at.tile;
    if (!tile) throw new ActionRefused("agent.focus needs a tile; actions lists the tiles here");
    if (args.line !== undefined && (!Number.isInteger(args.line) || args.line < 1)) throw new ActionRefused("line is a source line from 1");
    const id = tile.id ?? tile.name, note = args.note ?? tile.shows ?? undefined;
    pointers.set(actor.id, this.host.pointerScope ?? this, () => {
      const now = this.tilesNow().find(t => (t.id ?? t.name) === id);
      return now ? { agent: actor.id, screen: this.host.title, tile: id, name: now.name, ...(note ? { note } : {}), ...(args.line !== undefined ? { line: args.line } : {}) } : null;
    });
    return { pointer: pointers.get(actor.id) };
  }

  /** Add sets after those already here (a screen built on another adds its own first: `first`). */
  register(regs: (Registration | Delegation)[], first = false) { this.regs = first ? [...regs, ...this.regs] : [...this.regs, ...regs]; }

  /**
   * The person's whereabouts, as the shell answers it (or the screen alone, with no shell to ask). While a listing is being made
   * (`list`) it is asked once for each dispatcher, not once for each action the listing weighs: nothing moves while it runs.
   */
  where(): Whereabouts {
    const asked = this.asked();
    return asked ? (asked.where ??= this.whereNow()) : this.whereNow();
  }
  /** This dispatcher's answers so far, while a listing runs. */
  private asked() {
    if (!listing) return null;
    let a = listing.get(this);
    if (!a) listing.set(this, a = { resolved: new Map(), hosted: new Map() });
    return a;
  }
  private whereNow(): Whereabouts {
    if (this.host.where) return this.host.where();
    const ctx = this.host.ctx();
    if (ctx?.person) return ctx.person();
    const k = this.host.keys?.();
    return k ? { ...NOBODY, ...k, screen: this.host.title } : NOBODY;
  }

  /** The def of action `name`, as the first set here that has it declares it (labels, summaries, menu rows). */
  defOf(name: string): ActionDef<any, any> | undefined {
    const req = { action: name };
    const r = this.owner(req);
    const def = r ? "set" in r ? r.set.def(name) : r.delegate(req)?.defOf(name) : undefined;
    return def ? { ...def, keys: withBound(name, def.keys, effective(this.host.bindings?.() ?? [])) } : def;
  }

  unknownAction(name: string): string {
    const near = rankTextSearchMatches(this.list().actions.map(a => ({ id: a.name, title: a.name, text: "" })), name, 3).map(m => m.document.title);
    return `nothing here answers to ${name}; \`actions\` lists them${near.length ? `; did you mean ${near.join(", ")}?` : ""}`;
  }

  /** Every action here once, in the order a name is looked up; the tiles `tile=` names. */
  list(): { actions: ActionInfo[]; tiles: string[] } {
    // A listing asks each registration whether it claims each action, and a claim asks where the person is (`owner`): once, not for each.
    const outermost = !listing;
    if (outermost) listing = new Map();
    try { return this.listIn(); } finally { if (outermost) listing = null; }
  }
  private listIn(): { actions: ActionInfo[]; tiles: string[] } {
    const seen = new Set<string>(), out: ActionInfo[] = [];
    // The screen's bindings with the keymap applied, once for the whole listing.
    const bindings = effective(this.host.bindings?.() ?? []);
    // The layout host can also be the screen delegate; describe it once per listing.
    const delegated = new Map<Dispatcher, ActionInfo[]>();
    for (const r of this.regs) {
      const target = "set" in r || r.listed === false ? undefined : r.delegate();
      if (target && !delegated.has(target)) delegated.set(target, target.list().actions);
      const infos = "set" in r ? r.set.list() : target ? delegated.get(target)! : [];
      for (const a of infos) {
        if (seen.has(a.name) || (r.claims && !r.claims({ action: a.name }))) continue;
        out.push({ ...a, keys: withBound(a.name, a.keys, bindings) });
        seen.add(a.name);
      }
    }
    return { actions: out, tiles: this.tilesNow().map(t => t.name) };
  }

  /**
   * The actor rule for a step that isn't an action of its own but moves something of the person's on the way (a link
   * an agent followed that steps the brief to another day, a layout change a drawer or a bar makes): what `touches`
   * would say, or null. The one place a step asks it (PIE-1294): `host` is the declaration's (it changes the drawer
   * itself, so typing there is in its way), `tile` the tile it reaches (`label` how a refusal names it), `way` what an
   * agent does instead. The guard test (test/one-owner.test.ts) fails when a caller builds `actorRule` itself.
   */
  rule(touches: "tile" | "screen", actor: Actor, at: StepAt = {}): string | null {
    return stepRule(touches, actor, this.where(), at);
  }
  /**
   * The same rule, thrown: for a step inside an action that reaches a tile its declaration doesn't name (the board's
   * dock shut by its own tile, a preview's copy floated), so it says the dispatcher's words, not its own.
   */
  check(touches: "tile" | "screen", actor: Actor, at: Parameters<Dispatcher["rule"]>[2] = {}): void {
    const no = this.rule(touches, actor, at);
    if (no) throw new ActionRefused(no);
  }

  /**
   * What `tile=` names beyond this screen's own tiles: the screen host's own reading (a desk's: names, numbers, the focus and
   * everything below), else the host layer's (PIE-1285), which every screen host is asked, a desk or not. One place decides
   * `drawer.agent`, a tile's id and a path, so no screen keeps a copy of the rule.
   */
  private resolve(sel: string, o?: ResolveOpts): { tile: TileRef; dispatch: Dispatcher } | null {
    // `^` is relative to the tile the request acts from: the one with the keys, never a guess when nothing has them.
    if (parseTileAddress(sel).kind === "relative" && o?.from === undefined) o = { ...o, from: this.where().address ?? undefined };
    const asked = o ? null : this.asked();
    if (!asked) return this.resolveNow(sel, o);
    if (!asked.resolved.has(sel)) asked.resolved.set(sel, this.resolveNow(sel));
    return asked.resolved.get(sel)!;
  }
  /** The tile the host itself names by `address` (its own layer only). */
  private hostTile(address: string): Found {
    const asked = this.asked();
    if (!asked) return this.host.resolveTile?.(address) ?? null;
    if (!asked.hosted.has(address)) asked.hosted.set(address, this.host.resolveTile?.(address) ?? null);
    return asked.hosted.get(address)!;
  }
  private resolveNow(sel: string, o?: ResolveOpts): { tile: TileRef; dispatch: Dispatcher } | null {
    if (this.host.resolveTile) return this.host.resolveTile(sel, o) ?? this.host.ctx()?.hostLayer?.resolveTile?.(sel, o) ?? null;
    // A host that reads no tiles across layers keeps its own names: the host layer answers only what they don't.
    return this.named(sel, this.tilesNow()) ? null : this.host.ctx()?.hostLayer?.resolveTile?.(sel, o) ?? null;
  }
  /**
   * A tile's name from anything `tile=` takes (a name, an id, a number, an alias, `focused`, a block id it shows), or
   * null: for an argument that may name something that isn't a tile here (`open from=`, the host layer's agent).
   */
  name(sel: string): string | null { return this.tile(sel)?.name ?? null; }
  /** The tile `sel` names, by the same grammar, as the dispatcher sees it (what it shows, whether it's on screen). */
  tile(sel: string): TileRef | null {
    const resolved = this.resolve(sel);
    if (resolved) return resolved.tile;
    const tiles = this.tilesNow();
    if (sel === "focused") return this.focusedOf(tiles) ?? null;
    return (this.named(sel, tiles) ?? this.byBlock(sel, tiles, USER))?.t ?? null;
  }

  /** Whether some set here (or a dispatcher it hands to) takes the action. */
  has(name: string): boolean { return !!this.owner({ action: name }); }
  /** Whether some set here takes this request (a set that takes only requests naming a tile, the host layer's tile.herdr). */
  takes(req: ActRequest, actor?: Actor): boolean { return !!this.owner(this.pointed(req, actor), actor); }

  /** An authored press defaults tile actions to its own reader; screen and host actions keep their scope. */
  requestIn(req: ActRequest, tile: string | undefined): ActRequest {
    if (req.tile !== undefined || tile === undefined) return req;
    const there = { ...req, tile };
    return this.tileAction(there) ? there : req;
  }

  private tileAction(req: ActRequest): boolean {
    const r = this.owner(req);
    return !!r && ("set" in r ? r.takes === "tile" : !!r.delegate(req)?.tileAction(r.request ? r.request(req) : req));
  }

  /** The set that owns a request's action: the first registered that claims it. */
  private owner(req: ActRequest, actor?: Actor): Registration | Delegation | null {
    const own = this.claimedOutright(req);
    if (own) return own;
    req = this.mountedRequest(req);
    const defaultAddress = req.tile === undefined ? this.where().address : null;
    const defaultTarget = defaultAddress ? this.hostTile(defaultAddress) : null;
    if (defaultTarget && defaultTarget.dispatch.host.pointerScope !== this.host.pointerScope) {
      const reg = this.regs.find(r => "set" in r && r.set.has(req.action));
      const def = reg && "set" in reg ? reg.set.def(req.action) : undefined;
      if (reg && "set" in reg && reg.takes !== "none" && def && def.touches !== "screen" && !def.landing) return { delegate: () => defaultTarget.dispatch, listed: false };
    }
    const addressed = this.addressed(req);
    if (addressed) return addressed;
    for (const r of this.regs) {
      // A delegate is asked about the whole request: a screen in a tile is found by the tile it names.
      if (r.claims ? r.claims(req) : "set" in r ? r.set.has(req.action) : !!r.delegate(req)?.takes(r.request ? r.request(req) : req, actor)) return r;
    }
    return null;
  }

  /**
   * An agent's action (the control socket's `act`, an extension's runner, a test): every rule checked, refused with the
   * reason (thrown, nothing done), and what it did said on the status bar.
   */
  act(req: ActRequest, actor: Actor): Promise<unknown> {
    return messageContext.run({ ...messageContext.getStore(), action: req.action, ...(req.tile ? { tile: req.tile } : {}) }, () => { try { return Promise.resolve(this.run(req, actor)); } catch (e) { return Promise.reject(e); } });
  }

  bindings(): readonly KeyBinding[] {
    return [...(this.host.bindings?.() ?? []), ...this.regs.flatMap(r => "set" in r ? [] : r.delegate()?.bindings() ?? [])];
  }

  /** A saved binding must not replace a key the screen or another action already owns. */
  bindingProblem(binding: KeyBinding): string | undefined {
    if (!isKeyName(binding.key)) return `${binding.key} isn't a key name; use a name such as alt+S`;
    const held = this.bindings().find(b => b.key === binding.key && b.action !== binding.action)
      ?? this.list().actions.find(a => a.name !== binding.action && declaredKeys(a.keys).has(binding.key));
    return held ? `${binding.key} is held by ${"action" in held ? held.action : held.name}; choose another [keys::] value` : undefined;
  }

  pressBinding(binding: KeyBinding): Promise<unknown> {
    return asBoundKey(binding.key, () => this.press(binding.action, binding.args ?? {}, binding.tile));
  }

  /**
   * The person's key or click: the same action an agent's `act` runs, as `you`. A refusal is said on the status bar and
   * the focused tile's frame (Ctx.refuse), never thrown at the key handler; the screen is redrawn either way. Resolves to the answer, or undefined when refused.
   */
  press(name: string, args: Record<string, unknown> = {}, tile?: string): Promise<unknown> {
    return messageContext.run({ action: name, ...(tile ? { tile } : {}) }, () => this.asPerson(() => this.run({ action: name, args, ...(tile !== undefined ? { tile } : {}) }, USER, true)));
  }

  /**
   * Run `req` as `actor`, the way that actor's runs go (PIE-1294): the person's is a `press` (a refusal said where they
   * look, never thrown), an agent's an `act` (a refusal thrown to it, its run said on screen). The one place that picks
   * between them for a caller that runs for either (a power-bar row, a form, an extension's row, a desk's perform).
   */
  as(actor: Actor, req: ActRequest): Promise<unknown> {
    return actor.kind === "agent" ? this.act(req, actor) : this.press(req.action, req.args ?? {}, req.tile);
  }

  /** A person's authored press, including parsing it: failures keep the action and its source in the log. */
  pressDoing(action: string, details: MessageDetails, run: () => unknown): Promise<unknown> {
    return messageContext.run({ ...messageContext.getStore(), ...details, action }, () => this.asPerson(run));
  }

  /**
   * The person's key in a tile whose set is known (a tile kind's own keys, a reader's): `press`, owned by that set.
   * `say`: true says nothing of a refusal (the action said it where it happened), or how to say it (null: nothing).
   */
  pressIn(set: ActionSet<any, any>, name: string, args: Record<string, unknown> = {}, tile?: string, say: boolean | ((why: string) => string | null) = false, given?: unknown): Promise<unknown> {
    const at = this.registered(set);
    if (!at) return this.asPerson(() => { throw new Error(`${set.scope} actions aren't registered on the ${this.host.title}`); });
    return messageContext.run({ ...messageContext.getStore(), action: name, ...(tile ? { tile } : {}) }, () => this.asPerson(() => at.d.runIn(at.reg, at.d.rewrittenIn(at.reg, { action: name, args, ...(tile !== undefined ? { tile } : {}) }), USER, true, given), say));
  }

  /** A press addressed another way (rewriteRequests): resolved as an act's is, and refused when an act wouldn't reach this set. */
  private rewrittenIn(reg: Registration, req: ActRequest): ActRequest {
    const asked = rewritten(req, USER);
    if (asked === req) return req;
    const resolved = this.mountedRequest(asked);
    if (this.owner(resolved, USER) !== reg) throw new ActionRefused(`${req.action} tile=${asked.tile} is run by another action set than the key's`);
    return resolved;
  }

  /** Where a set is registered: here, or on a dispatcher this one hands to (a desk's tile kinds). */
  private registered(set: ActionSet<any, any>): { d: Dispatcher; reg: Registration } | null {
    for (const r of this.regs) {
      if ("set" in r) { if (r.set === set) return { d: this, reg: r }; continue; }
      const d = r.delegate();
      const hit = d?.registered(set);
      if (hit) return hit;
    }
    return null;
  }

  private asPerson(f: () => unknown, say: boolean | ((why: string) => string | null) = false): Promise<unknown> {
    const ctx = this.host.ctx();
    // The key or click this answers: a refusal that lands after the person moved on is said on the status bar alone.
    const at = ctx?.pressNow?.();
    // The repaint this press owes (PIE-1301): the actions it ran say whether they changed what's shown (runIn); the tail
    // repaints for those that did, unless an action's own redraw already asked for the paint, and never for a press that
    // ran actions that all changed nothing.
    // A press made from inside another's action keeps its own account: what it painted covers what it changed, and none of what
    // its outer action changes after it.
    const shown: PressShown = { ran: 0, changed: false, asked: 0 };
    // The tail's own repaint: no press's action asked for it, so it covers nothing the outer action does after it.
    const paint = () => pressShown.run(NO_PRESS, () => ctx?.redraw?.());
    let sameTurn = true;
    const tell = (e: unknown) => {
      const failed = !(e instanceof ActionRefused || e instanceof Offline);
      const action = messageContext.getStore()?.action ?? "the action";
      const why = failed ? actionFailure(action, e) : e.message, said = failed ? why : say === true ? null : say === false ? why : say(why);
      const before = shown.asked;
      // Said where the person is looking (the focused tile's frame) as well as on the status bar (Ctx.refuse, PIE-727).
      if (said) pressShown.run(shown, () => messageContext.run({ ...messageContext.getStore(), kind: failed ? "error" : "refusal", ...(failed && e instanceof Error ? { stack: e.stack } : {}) }, () => (ctx?.refuse ? ctx.refuse(said, at) : ctx?.flash?.(said))));
      // Saying it painted; a refusal that said nothing still shows what the action did before it was refused.
      if (shown.asked === before) paint();
      return undefined;
    };
    try {
      const out = pressShown.run(shown, () => fromPress(f));
      // Only an answer that waits needs to know whether it came within this turn.
      if (isThenable(out)) setImmediate(() => { sameTurn = false; });
      // An action that answered within this turn (at once, or through promises that waited on nothing but each other: the
      // reader's actions all answer as promises) and asked for its paint (any `redraw()` it made) needs no second one behind
      // it. One that waited for something may have changed more by then, and is painted for.
      const moved = () => shown.asked > 0;
      const early = !isThenable(out) && moved();
      return Promise.resolve(out).then(r => {
        const own = isThenable(out) ? sameTurn && moved() : early;
        if (!own && (shown.ran === 0 || shown.changed)) paint();
        shown.changed = false;
        return r;
      }, tell);
    } catch (e) { return Promise.resolve(tell(e)); }
  }

  /**
   * One request, for one actor. `txn=` and `motion=` are the dispatcher's own (src/surface/txn.ts): taken out here for
   * every action, and carried to the layout code that records the change.
   */
  private run(req: ActRequest, actor: Actor, typed = false): unknown {
    if (req.args && ("txn" in req.args || "motion" in req.args)) {
      const args = { ...req.args };
      const scope = takeReserved(args);
      const rest = { ...req, args };
      return scope ? TXN.run(scope, () => this.runPlain(rest, actor, typed)) : this.runPlain(rest, actor, typed);
    }
    return this.runPlain(req, actor, typed);
  }

  /** One request, for one actor: who owns it, the revision, then that set's run. */
  private runPlain(req: ActRequest, actor: Actor, typed = false): unknown {
    req = rewritten(req, actor);
    req = this.pointed(req, actor);
    req = this.mountedRequest(req);
    const args = { ...(req.args ?? {}) };
    const r = this.owner(req, actor);
    // The desk that owns the addressed tile owns its layout revision too.
    if (r && "set" in r && this.host.revision && "expected" in args) {
      const why = this.host.revision(args.expected);
      if (why) throw new ActionRefused(why);
      delete args.expected;
    }
    if (!r && GONE_ACTIONS[req.action]) throw new ActionRefused(GONE_ACTIONS[req.action]!);
    if (!r) throw new ActionRefused(this.unknownAction(req.action));
    if (!("set" in r)) {
      const d = r.delegate(req);
      if (!d) throw new ActionRefused(`no action ${req.action} on the ${this.host.title}`);
      // `expected=` is the revision of the layout that read it: this one's when it has one (checked above), else the delegate's.
      const next = { ...(r.request ? r.request(req) : req), args: !this.host.revision && "expected" in (req.args ?? {}) ? { ...args, expected: req.args!.expected } : args };
      const out = d.run(next, actor, typed);
      return r.answer ? Promise.resolve(out).then(o => r.answer!(o, req)) : out;
    }
    return this.runIn(r, { ...req, args }, actor, typed);
  }

  /**
   * Why `req` would be refused for `actor` now, or null: the resolution and rules a run checks (`checked`), with nothing run.
   * A button drawn disabled says it (PIE-1287). An action no set here has (a script's name) is null: the press finds out.
   */
  refusedNow(req: ActRequest, actor: Actor): string | null {
    try {
      req = this.mountedRequest(this.pointed(rewritten(req, actor), actor));
      const r = this.owner(req, actor);
      if (!r) return null;
      if (!("set" in r)) { const d = r.delegate(req); return d ? d.refusedNow(r.request ? r.request(req) : req, actor) : null; }
      this.checked(r, req, actor, false);
      return null;
    } catch (e) { return e instanceof ActionRefused ? e.message : null; }
  }

  /** What a run checks before it runs: the def, the person's-own rule, the tile read, the arguments and the actor rule; refused with why. */
  private checked(reg: Registration, req: ActRequest, actor: Actor, typed: boolean) {
    const def = reg.set.def(req.action);
    if (!def) throw new ActionRefused(`no action ${req.action} here; try: ${reg.set.names().join(", ")}`);
    // The person's own: refused to an agent before anything is read.
    const personOnly = def.person || def.personAlways ? actorRule(def, actor, this.where(), {}) : null;
    if (personOnly) throw new ActionRefused(personOnly);
    const tiles = this.tilesNow();
    const at = this.target(reg, def, req, actor, tiles);
    const args = this.tileArgs(reg.set.argsOf(req.action) ?? {}, req.args ?? {}, tiles);
    // What the def sees: coerced from the wire (`locked=true` is true, not "true").
    const seen = reg.set.defArgs(req.action, args, typed);
    const no = this.refusal(reg, def, req.action, at, args, seen, actor);
    if (no) throw new ActionRefused(no);
    return { def, at, args, seen };
  }

  /** Run a request with the set that owns it: the tile read, the actor rule checked, the action run, its answer said. */
  private runIn(reg: Registration, req: ActRequest, actor: Actor, typed: boolean, given?: unknown): unknown {
    const { def, at, args, seen } = this.checked(reg, req, actor, typed);
    for (const t of requestTracers) t({ action: req.action, args: seen, ...(at.tile ? { tile: { id: at.tile.id, name: at.tile.name, ...(at.tile.role ? { role: at.tile.role } : {}) } } : {}), named: req.tile !== undefined, takes: reg.takes, replay: def.replay, scope: reg.set.scope, actor, typed });
    const hooked = this.host.beforeAction?.(req.action);
    if (hooked) { const shown = pressShown.getStore(); if (shown) shown.changed = true; }
    const confirmation = ++this.nextConfirmation;
    const ctx = this.host.ctx();
    const touches = reg.touchesAt?.(req.action, at) ?? def.touchesWith?.(seen as never, at.name) ?? def.touches;
    const on = reg.on(at, { actor, standing: this.standing(actor, touches), ctx: ctx ? asActor(ctx as DispatchCtx & { flash(msg: string): void }, actor) : ctx, ...(given !== undefined ? { given } : {}) });
    // A key's arguments are typed already (the compiler checked them); the wire's are checked and coerced.
    const run = () => messageContext.run({ ...messageContext.getStore(), action: req.action, ...(at.tile ? { tile: at.tile.id ?? at.tile.name, note: at.tile.shows ?? undefined } : {}) }, () => reg.run ? reg.run(req.action, args, on, actor, typed) : typed ? reg.set.call(req.action as never, args as never, on, actor) : reg.set.callUntyped(req.action, args, on, actor));
    const recordedArgs = { ...seen };
    for (const [key, spec] of Object.entries(reg.set.argsOf(req.action) ?? {})) {
      const value = recordedArgs[key];
      if (spec.kind === "tile" && typeof value === "string" && !isTilePath(value)) recordedArgs[key] = this.tile(value)?.id ?? value;
    }
    const ran = actor.kind === "user" && ctx?.recordAction && def.record !== false
      ? ctx.recordAction({ action: req.action, args: recordedArgs, ...(reg.takes === "tile" || req.tile !== undefined ? { tile: at.tile?.id ?? at.name ?? req.tile } : {}) }, def.replay, run)
      : run();
    // What it did, said on the status bar: an agent's always, with who it is; the person's when the screen doesn't
    // show it. Said as soon as it's done: at once for an action that answers at once (a key's flash is there to read).
    const done = (out: unknown) => {
      const hint = typeof def.hint === "function" ? def.hint(seen, on) : def.hint;
      if (hint) this.host.hint?.({ ...hint, id: def.hintId ?? req.action }, at.name, actor);
      if (def.says && (actor.kind === "agent" || (def.confirms && confirmation >= this.saidConfirmation))) {
        const s = def.says(out, seen as never), said = typeof s === "string" ? s : s?.text, ms = typeof s === "object" && s ? s.ms : undefined;
        if (said) {
          // An earlier async open must not overwrite the status of a later action.
          this.saidConfirmation = Math.max(this.saidConfirmation, confirmation);
          ctx?.flash?.(actor.kind === "agent" ? `${agentLabel(actor)} ${said}` : said.replace(/^· /, ""), ms);
        }
      }
      const shown = pressShown.getStore();
      if (shown) { shown.ran++; shown.changed ||= changesShown(def, touches, out, seen); }
      return reg.answer ? reg.answer(out, at) : out;
    };
    return ran instanceof Promise ? ran.then(done) : done(ran);
  }

  /** The actor rule for one request, with what its arguments make it touch: null, or why not. */
  private refusal(reg: Registration, def: ActionDef<unknown, unknown>, name: string, at: Target, args: Record<string, unknown>, seen: Record<string, unknown>, actor: Actor, where = this.where()): string | null {
    const touches = reg.touchesAt?.(name, at) ?? def.touchesWith?.(seen as never, at.name) ?? def.touches;
    // An invitation is read only for an action that takes one (and spends it): elsewhere it opens nothing.
    const invitation = reg.set.argsOf(name)?.invitation && typeof args.invitation === "string" ? args.invitation : undefined;
    // A tile the action acts on (its kind's, or one named) limits an agent; the screen's own action, given none, only reads the focus.
    const agents = at.tile?.agents && (reg.takes === "tile" || at.name !== undefined) ? at.tile.agents : undefined;
    // Who it is the person's own for, as these arguments make it (ActionDef.personWith): the declaration's, else the arguments'.
    const said = actor.kind === "agent" ? def.personWith?.(seen as never) ?? null : null;
    const person = def.person ?? (typeof said === "string" ? said : undefined), personAlways = def.personAlways ?? (said && typeof said === "object" ? said.always : undefined);
    return actorRule({ ...def, touches, ...(person ? { person } : {}), ...(personAlways ? { personAlways } : {}) }, actor, where, { tile: at.tile ?? null, action: name, ...(agents ? { gate: { action: name, agents } } : {}), invited: invitation !== undefined, draft: () => this.draftAnswer(def, actor, reg.draftOf ? reg.draftOf(at, args, actor) : reg.takes === "tile" && at.tile ? this.host.draftOf?.(at.tile) ?? null : null, invitation) });
  }

  /**
   * Tile `sel`'s menu (PIE-492, `tile.menu`): every row its actions declare (ActionDef.menu) in the sets that would run
   * them there, in the order a name is looked up (the screen's own sets, the tile actions, its kind's, a reader's note
   * actions), each as it would run for `actor` now: hidden where it isn't this tile's now, and with the reason where it
   * would be refused. Nothing runs; nothing is drawn. `only` names the one action whose rows are wanted (a caller after a single
   * action's entries doesn't weigh every action's claim on the tile).
   */
  menu(sel: string, actor: Actor, only?: string): MenuRow[] {
    const resolved = this.resolve(sel);
    if (resolved && resolved.dispatch.host.pointerScope !== this.host.pointerScope) return resolved.dispatch.menu(resolved.tile.id!, actor, only);
    const tiles = this.tilesNow(), tile = this.tile(sel);
    if (!tile) throw this.noTile(sel, tiles);
    const out: MenuRow[] = [], where = this.where(), ctx = this.host.ctx();
    // A row is listed by the registration that would run it: the owner a press of it finds (claims included).
    const owns = (r: Registration | Delegation, action: string) => this.owner({ action, tile: tile.id ?? tile.name }) === r;
    for (const r of this.regs) {
      if (!("set" in r)) {
        if (r.listed === false) continue;
        try { out.push(...(r.delegate()?.menu(tile.id ?? tile.name, actor, only) ?? []).filter(row => owns(r, row.action))); } catch { /* the tile isn't one it reaches */ }
        continue;
      }
      if (r.takes === "none" || (r.menuIn && !r.menuIn(tile))) continue;
      for (const name of only === undefined ? r.set.names() : r.set.has(only) ? [only] : []) {
        const def = r.set.def(name)!, entries = def.menu === undefined ? [] : Array.isArray(def.menu) ? def.menu : [def.menu as MenuEntry<unknown, unknown>];
        if (!entries.length || !owns(r, name)) continue;
        let at: Target;
        try { at = this.target(r, def, { action: name, tile: tile.id ?? tile.name }, actor, tiles); } catch { continue; }      // not this tile's kind
        if (!at.tile) continue;
        let on: unknown;
        for (const e of entries) {
          const now = e.now ? e.now((on ??= r.on(at, { actor, standing: this.standing(actor, def.touches), ctx: ctx ? asActor(ctx as DispatchCtx & { flash(msg: string): void }, actor) : ctx })), { name: at.tile.name, kind: at.tile.kind }, actor) : null;
          if (now?.hide) continue;
          const args = { ...(e.args ?? {}), ...(now?.args ?? {}) } as Record<string, unknown>;
          const why = this.refusal(r, def, name, at, args, args, actor, where) ?? now?.refused ?? null;
          const key = menuKey(name, args, e.key ?? [...declaredKeys(def.keys)].find(k => !MENU_NOT_KEYS.has(k) && !k.includes(" ")));
          out.push({ action: name, args, tile: at.tile.id ?? at.tile.name, label: now?.label ?? e.label, group: e.group, ...(key ? { key } : {}), ...(why ? { refused: why } : {}), ...(r.takes === "tile" ? { own: true as const } : {}) });
        }
      }
    }
    return out;
  }

  /**
   * A host that reads no tiles itself (the door's shell, a menu) hands a request naming a tile of another layer to that
   * layer's dispatcher, except where one of its sets that takes a tile claims the request outright (the host layer's own `tile.herdr
   * tile=drawer.agent`): that set's.
   */
  private claimedOutright(req: ActRequest): Registration | null {
    if (this.host.resolveTile) return null;
    return (this.regs.find(r => "set" in r && r.takes !== "none" && r.claims?.(req)) as Registration | undefined) ?? null;
  }

  /** Ownership discovery and execution must resolve the same mounted target. Local tiles keep their scope. */
  private mountedRequest(req: ActRequest): ActRequest {
    if (this.claimedOutright(req)) return req;
    if (req.tile) {
      const hit = this.resolve(req.tile);
      if (hit) return { ...req, tile: hit.tile.id ?? hit.tile.name };
      if (this.host.resolveTile) return req;
    }
    const sel = req.tile;
    if (!sel || isTilePath(sel) || sel === "focused" || NUMBER.test(sel)) return req;
    const local = this.named(sel, this.tilesNow());
    if (local) return req;
    const paths = this.mountedPaths(sel);
    if (paths.length > 1) throw new ActionRefused(`several tiles named ${sel}: ${paths.join(", ")}; name tile=<mount>/<tile>`);
    return paths.length === 1 ? { ...req, tile: paths[0] } : req;
  }

  private mountedPaths(sel: string): string[] {
    return this.tilesNow().flatMap(t => !t.mount ? [] : [
      ...t.mount.tilesNow().filter(x => x.id === sel || x.name === sel).map(x => `${t.id ?? t.name}/${x.id ?? x.name}`),
      ...t.mount.mountedPaths(sel).map(path => `${t.id ?? t.name}/${path}`),
    ]);
  }

  private addressed(req: ActRequest): Delegation | null {
    if (!req.tile) return null;
    const hit = this.resolve(req.tile);
    if (!hit || hit.dispatch.host.pointerScope === this.host.pointerScope) return null;
    return { delegate: () => hit.dispatch, request: r => ({ ...r, tile: hit.tile.id ?? hit.tile.name }), listed: false };
  }

  standing(actor: Actor, touch: ActionDef<unknown, unknown>["touches"] = "tile"): boolean {
    return standsAsPerson(actor, this.where(), touch === "shape" || touch === "screen" ? touch : "tile");
  }

  private tilesNow(): TileRef[] {
    const asked = this.asked();
    return asked ? (asked.tiles ??= this.host.tiles?.() ?? []) : this.host.tiles?.() ?? [];
  }

  /** What the draft rule says for a `draft` action, about the draft it would write. */
  private draftAnswer(def: ActionDef<unknown, unknown>, actor: Actor, d: DraftAt | null, invitation?: string): string | null {
    if (!d) return invitation !== undefined ? draftRule(actor, def.draft ?? "write", {}, { invitation }) : null;
    return draftRule(actor, def.draft ?? "write", d, invitation !== undefined ? { invitation } : {});
  }

  /** Arguments that name a tile (`to=`), read with `tile=`'s grammar: the action gets the tile's name. */
  private tileArgs(spec: Record<string, ArgSpec>, raw: Record<string, unknown>, tiles: TileRef[]): Record<string, unknown> {
    const out = { ...raw };
    for (const [k, s] of Object.entries(spec)) {
      if (s.kind !== "tile" || typeof out[k] !== "string" || s.choices?.includes(out[k] as string) || !tiles.length) continue;
      const resolved = this.resolve(String(out[k]), s.program ? { program: true } : undefined);
      if (resolved) { out[k] = resolved.tile.id ?? resolved.tile.name; continue; }
      if (isTilePath(String(out[k]))) continue;
      const hit = this.named(String(out[k]), tiles);
      if (!hit) throw this.noTile(String(out[k]), tiles);
      out[k] = hit.t.name;
    }
    return out;
  }

  /**
   * The refusal for a `tile=` that names nothing: the host layer's reason when it has one (`drawer.agent` with its program
   * closed names what to run), else the tiles this screen has.
   */
  private noTile(sel: string, tiles: TileRef[]): ActionRefused {
    const why = this.host.ctx()?.hostLayer?.unnamed?.(sel);
    return new ActionRefused(why ? `no tile ${sel}: ${why}` : `no tile ${sel} on the ${this.host.title}; ${this.which(tiles)}`);
  }

  /** Where a request runs: the tile `tile=` names (one grammar), a place word, or the action's own default. */
  private target(reg: Registration, def: ActionDef<unknown, unknown>, req: ActRequest, actor: Actor, tiles: TileRef[]): Target {
    const sel = req.tile;
    if (reg.takes === "none") {
      if (sel !== undefined && sel !== "focused") throw new ActionRefused(`the ${this.host.title} has no tiles; ${req.action} takes no tile=`);
      return reg.fixed ? { tile: reg.fixed() } : {};
    }
    if (sel !== undefined && def.places?.includes(sel)) return { place: sel };
    const focused = this.focusedOf(tiles);
    if (reg.takes === "screen") {
      if (sel === undefined) return focused ? { tile: focused } : {};
      if (sel === "focused") return focused ? { tile: focused, name: focused.name } : { name: sel };
      if (!tiles.length) return { name: sel };
      const hit = this.named(sel, tiles) ?? this.byBlock(sel, tiles, actor);
      if (!hit) throw this.noTile(sel, tiles);
      return { tile: hit.t, name: hit.t.name };
    }
    // takes: "tile"
    const can = tiles.filter(t => reg.in?.(t) ?? true);
    const noun = (name: string) => (typeof reg.noun === "function" ? reg.noun(name) : reg.noun ?? "a tile");
    let hit: { t: TileRef; by: NamedBy } | null;
    if (sel === undefined || sel === "focused") {
      if (focused && can.includes(focused)) hit = { t: focused, by: "focused" };
      else if (sel === "focused") throw new ActionRefused(`the focused tile${focused ? `, ${focused.name},` : ""} isn't ${noun(req.action)}: ${req.action} is for ${noun(req.action)}${can.length ? `; here: ${can.map(t => t.name).join(", ")}` : ""}`);
      else if (!can.length) throw new ActionRefused(`no ${noun(req.action).replace(/^an? /, "")} on the ${this.host.title}`);
      else if (reg.pick === "only" && can.length > 1 && !this.standing(actor, "tile")) throw new ActionRefused(`${req.action} needs tile=<tile>: the focused tile has no such action and several here do (${can.map(t => t.name).join(", ")})`);
      else hit = { t: can[0]!, by: "default" };
    } else {
      hit = this.named(sel, can) ?? this.byBlock(sel, can, actor);
      if (!hit) {
        const other = this.named(sel, tiles);
        if (other) throw new ActionRefused(`${other.t.name} is ${kindNoun(other.t)}: ${req.action} is for ${noun(req.action)}${can.length ? `; here: ${can.map(t => t.name).join(", ")}` : ""}`);
        if (BLOCK.test(sel)) throw new ActionRefused(`no ${noun(req.action).replace(/^an? /, "")} shows ${sel}; open it first (open id=${sel})`);
        throw this.noTile(sel, can.length ? can : tiles);
      }
    }
    const t = hit.t;
    // A number or the focus names a place; an agent's edit or comment carries on only in the tile that holds it.
    if (actor.kind === "agent" && def.touches === "draft" && hit.by !== "name" && hit.by !== "id" && hit.by !== "block") {
      const mine = can.filter(x => x.holds?.(actor));
      if (mine.length && !mine.includes(t)) {
        const m = mine[0]!;
        throw new ActionRefused(`${hit.by === "focused" || hit.by === "default" ? "the focused tile" : `${sel}`} isn't where your edit or comment is: that's tile ${m.id ?? m.name} (${m.label ?? m.name} now); tiles move as others open and close, so name it tile=${m.id ?? m.name}`);
      }
    }
    // An agent's: the person's own keys and clicks in a peek or a spine are theirs to press (ctrl+z, an element).
    if (reg.seen && !this.standing(actor, "tile") && t.readOnly && !t.editing) throw new ActionRefused(t.readOnly);
    return { tile: t, name: t.name };
  }

  private focusedOf(tiles: TileRef[]): TileRef | undefined {
    const where = this.where();
    const addressed = tiles.find(t => t.id === where.address);
    if (addressed) return addressed;
    const f = where.focus;
    return f === null ? undefined : tiles.find(t => t.name === f);
  }

  /** A tile by what names it: its name, its id, its number, one of its aliases (in that order). */
  private named(sel: string, tiles: TileRef[]): { t: TileRef; by: NamedBy } | null {
    const byId = tiles.find(t => t.id === sel);
    if (byId) return { t: byId, by: "id" };
    const byName = tiles.find(t => t.name === sel);
    if (byName) return { t: byName, by: "name" };
    const num = NUMBER.exec(sel);
    const byN = num ? tiles.find(t => t.n === Number(num[1])) : undefined;
    if (byN) return { t: byN, by: "place" };
    const byAlias = tiles.find(t => t.aliases?.includes(sel));
    return byAlias ? { t: byAlias, by: "place" } : null;
  }

  /**
   * A tile by the block it shows (a block id, or its first 8+ characters). Several: the one holding the actor's own
   * edit or comment on it, then one on screen editing it, one on screen showing it, one off screen editing it, one on
   * screen whose list has it selected, then the rest; the focused one first among equals.
   */
  private byBlock(sel: string, tiles: TileRef[], actor: Actor): { t: TileRef; by: NamedBy } | null {
    if (!BLOCK.test(sel)) return null;
    const pointer = this.pointer(actor);
    const f = this.where().focus;
    const rank = (t: TileRef) => {
      const shows = !!t.shows?.startsWith(sel), shown = t.shown !== false;
      if (shows && t.holds?.(actor)) return 0;
      if (shows && shown && t.editing) return 1;
      if (shows && shown) return 2;
      if (shows && t.editing) return 3;
      if (t.lists?.startsWith(sel) && shown) return 4;
      return 5;
    };
    const hits = tiles.filter(t => t.shows?.startsWith(sel) || t.lists?.startsWith(sel)).sort((a, b) => Number((b.id ?? b.name) === pointer?.tile) - Number((a.id ?? a.name) === pointer?.tile) || rank(a) - rank(b) || Number(b.name === f) - Number(a.name === f));
    return hits[0] ? { t: hits[0], by: "block" } : null;
  }

  /** The tiles a refusal lists: each name, with its number and id when it has them. */
  private which(tiles: TileRef[]): string {
    return `tiles: ${tiles.map(t => [t.n ? `#${t.n} ` : "", t.name, t.id && t.id !== t.name ? ` (${t.id})` : ""].join("")).join(", ")}, focused, or a block id`;
  }
}

/** "a reader", "a terminal tile": how a refusal names a tile's kind. */
let nounOf: (kind: string) => string = k => `a ${k} tile`;
/** The tile-kind registry says how its kinds are named (src/desk/tile-kinds.ts sets it; this module can't import it). */
export function nameKinds(f: (kind: string) => string) { nounOf = f; }
const kindNoun = (t: TileRef) => nounOf(t.kind);

export const POINTER_ACTIONS = actionSet<{ dispatcher: Dispatcher; at: Target }>()("agent focus", {
  "agent.focus": def({
    summary: "set your own pointer with tile=, note= and line=, without moving the person's keys; no arguments or clear=true drops it (agents only)",
    touches: "nothing", replay: "safe",
    args: {
      note: { type: "string", optional: true, about: "the note at your pointer; default the tile's note" },
      line: { type: "number", optional: true, about: "source line, from 1" },
      clear: { type: "boolean", optional: true, about: "drop your explicit pointer" },
    },
    examples: [
      { act: "agent.focus tile=reader note=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 line=12", does: "points your marker at line 12 of that note in the reader" },
      { act: "agent.focus tile=reader clear=true", does: "drops your pointer in the reader" },
    ],
    run(args, { dispatcher, at }, actor) { return dispatcher.focusAgent(at, args, actor); },
  }),
});
