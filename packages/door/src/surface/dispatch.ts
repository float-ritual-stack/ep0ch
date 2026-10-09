// The dispatcher (PIE-514): one per screen host, the one door every action goes through. A screen registers its
// action sets; its keys and clicks (`press`), the control socket (`act`) and a tile holding a whole screen all call
// the dispatcher, which:
//
// - reads `tile=` with one grammar, over the tiles the screen lists (a name, a stable id `t4`, a number on
//   screen `#3`, `focused`, a block id, and the places a screen names: the board's `detail`), and the arguments that name a tile (`to=`) the same way;
// - finds the set that owns an action name, in the order the screen registered them (its own sets, the desk's
//   tile actions, the tile kinds', a reader's note actions, then the shell's, the host layer's and the extensions');
// - checks `expected=` against the layout's revision;
// - checks what the action declares it touches (ActionDef.touches) against where the person is, once: the actor rule
//   (`actorRule`, below), so no action asks who is acting for this;
// - runs it as the person (a key, a click: a refusal is said, then the screen is redrawn) or as an agent (said on
//   the status bar before it runs, refused with the reason, and what it did said after: ActionDef.says).
import { USER, type Actor } from "../socket";
import { draftRule, type DraftSession } from "../draft-session";
import { NOBODY, SHELL_IDLE_MS, type ScreenKeys, type Whereabouts } from "../whereabouts";
import { agentRefusal, type AgentLevel } from "./agent-level";
import { ActionRefused, agentLabel, asActor, declaredKeys, type ActionDef, type ActionInfo, type ActionSet, type ActRequest, type ArgSpec, type MenuEntry } from "./actions";

/** A tile as `tile=` reads it: the names it answers to, and what it shows (for a block id). */
/** `tile=<mount>/<tile>`: a tile of a screen mounted in a tile (PIE-651); names never hold a `/`. */
export const isTilePath = (sel: string | undefined): sel is string => !!sel && sel.includes("/");

export interface TileRef {
  /** Its name: what answers say, and what `tile=` matches first. */
  name: string;
  /** Its stable id (`t4`): the same tile while it lives. */
  id?: string;
  /** Its number on screen, from 1 (`#3`, or `3`): where it is now. */
  n?: number;
  /** Other names it answers to now (the board's `detail`): a place, like a number. */
  aliases?: readonly string[];
  /** Its kind (`reader`, `pty`, a river column). */
  kind: string;
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

/**
 * One row of a tile's menu, as the dispatcher would run it: the action, its arguments and the tile (its stable id), the
 * row's words and group, the key its keycap shows, and why it would be refused now (the row is dimmed with it).
 */
export interface MenuRow { action: string; args: Record<string, unknown>; tile: string; label: string; group: string; key?: string; refused?: string }
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
export interface RunHow<C> { actor: Actor; ctx: C; given?: unknown }

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
export interface DispatchCtx { flash(msg: string, ms?: number): void; redraw(): void; person?(): Whereabouts }

/** The screen host a dispatcher serves. */
export interface DispatchHost {
  /** The screen's title, for refusals. */
  readonly title: string;
  ctx(): DispatchCtx | null | undefined;
  /** Where the person's keys are on this screen (Screen.keys), when its context has no shell to ask (a test's). */
  keys?(): ScreenKeys;
  /** Where the person is, as this host sees it, when it says so itself (a reader on its own); else the shell's, or `keys`. */
  where?(): Whereabouts;
  /** The tiles `tile=` names, in order on screen. */
  tiles?(): TileRef[];
  /** `expected=`: why it's refused (the layout changed since that revision), or null. Absent: the screen has none. */
  revision?(expected: unknown): string | null;
  /** A tile's draft for the draft rule: the note it shows and the session it holds. */
  draftOf?(t: TileRef): DraftAt | null;
}

/** What the draft rule is asked about: the block an action writes, and the draft session where it runs (if any). */
export interface DraftAt { board?: object | null; blockId?: string | null; session?: DraftSession | null }

/** How a tile was named: by what it is (a name, an id, a block it shows) or by where it is (a number, an alias, the focus). */
type NamedBy = "name" | "id" | "place" | "block" | "focused" | "default";

/** The answer to who may run an action, in plain words: null, or why not. Every action's actor rule is this. */
export function actorRule(def: Pick<ActionDef<unknown, unknown>, "touches" | "while" | "draft" | "person" | "way" | "ownGate"> & { replay?: ActionDef<unknown, unknown>["replay"] }, actor: Actor, where: Whereabouts, at: {
  /** The tile it runs in (by name, and how a refusal says it). */
  tile?: { name: string; label?: string } | null;
  /** The action's name and what the tile it acts on lets an agent do (PIE-639): checked before anything else of the tile. */
  gate?: { action: string; agents: { level: AgentLevel; by: string } };
  /** The draft rule's answer for that tile (asked only for `touches: "draft"`). */
  draft?: () => string | null;
  /** The agent says it was invited into the draft (`invitation=`, for an action that takes one): the draft rule checks it. */
  invited?: boolean;
}): string | null {
  if (actor.kind !== "agent") return null;
  if (def.person) return def.person;
  // What the tile lets an agent do (PIE-639): `edit` allows reads and the note's own edits (a `draft` action), `off` only reads.
  const g = at.gate;
  if (g && g.agents.level !== "free" && !def.ownGate) {
    const reads = def.touches === "nothing" && def.replay === "safe", edits = def.touches === "draft" || def.touches === "nothing";
    const no = agentRefusal(g.agents.level, at.tile?.label ?? at.tile?.name ?? "that tile", g.action, { by: g.agents.by, note: g.agents.level === "edit" ? edits : reads });
    if (no) return no;
  }
  switch (def.touches) {
    case "nothing": case "shape": return null;
    case "draft": {
      // Replacing a tile's whole draft: never under the person's keys while they type there (the draft rule says
      // whose the draft is), unless they invited it (their `@name` line: the draft rule checks the invitation).
      const t = at.tile;
      if ((def.draft === "replace" || def.draft === "text") && !at.invited && t && where.typingIn === t.name) {
        return `the person is typing in ${t.label ?? t.name}; an agent doesn't replace their text · ${def.draft === "replace" ? "draft.patch lands in their draft, or comment on the note or block.mark it to get their attention" : "block.mark gets their attention, or wait until it's sent or closed"}`;
      }
      return at.draft?.() ?? null;
    }
    case "tile": {
      const t = at.tile;
      if (!t) return null;
      const label = t.label ?? t.name;
      const typing = where.typingIn === t.name;
      const theirs = def.while === "typing" ? typing : typing || where.focus === t.name;
      if (!theirs) return null;
      return `${typing ? `the person is typing in ${label}` : `${label} has the person's keys`}; ${def.way ?? "an agent doesn't act there (block.mark gets their attention)"}`;
    }
    case "screen": {
      if (where.away) return `${where.away}; not moved`;
      if (where.busy) return `${where.why ?? "the person is typing"}; not moved`;
      if (where.idle < SHELL_IDLE_MS) return `the person is at the keys (last key ${(where.idle / 1000).toFixed(1)}s ago); try again once they've been idle ${SHELL_IDLE_MS / 1000}s`;
      return null;
    }
  }
}

const BLOCK = /^[0-9a-f-]{8,}$/;
/** `#3` or `3`: a tile's number on screen (a name never starts with a digit). */
const NUMBER = /^#?([1-9][0-9]{0,2})$/;

export class Dispatcher {
  private regs: (Registration | Delegation)[] = [];
  constructor(private readonly host: DispatchHost, regs: (Registration | Delegation)[] = []) { this.regs = [...regs]; }

  /** A dispatcher for one set with nothing to resolve (a reader outside any screen, a test's): the same path. */
  static of<On>(set: ActionSet<any, On>, on: On, ctx: () => DispatchCtx | null | undefined, title = set.scope): Dispatcher {
    return new Dispatcher({ title, ctx }, [{ set, takes: "none", on: () => on }]);
  }

  /** Add sets after those already here (a screen built on another adds its own first: `first`). */
  register(regs: (Registration | Delegation)[], first = false) { this.regs = first ? [...regs, ...this.regs] : [...this.regs, ...regs]; }

  /** The person's whereabouts, as the shell answers it (or the screen alone, with no shell to ask). */
  where(): Whereabouts {
    if (this.host.where) return this.host.where();
    const ctx = this.host.ctx();
    if (ctx?.person) return ctx.person();
    const k = this.host.keys?.();
    return k ? { ...NOBODY, ...k, screen: this.host.title } : NOBODY;
  }

  /** Every action here once, in the order a name is looked up; the tiles `tile=` names. */
  list(): { actions: ActionInfo[]; tiles: string[] } {
    const seen = new Set<string>(), out: ActionInfo[] = [];
    for (const r of this.regs) {
      const infos = "set" in r ? r.set.list() : r.listed === false ? [] : r.delegate()?.list().actions ?? [];
      for (const a of infos) {
        if (seen.has(a.name)) continue;
        out.push(a);
        seen.add(a.name);
      }
    }
    return { actions: out, tiles: this.tilesNow().map(t => t.name) };
  }

  /**
   * The actor rule for a step that isn't an action of its own but moves something of the person's on the way (a link
   * an agent followed that steps the brief to another day): what `touches` would say, or null.
   */
  rule(touches: "tile" | "screen", actor: Actor, tile?: string, way?: string): string | null {
    return actorRule({ touches, ...(way ? { way } : {}) }, actor, this.where(), { tile: tile !== undefined ? { name: tile } : null });
  }
  /**
   * The same rule, thrown: for a step inside an action that reaches a tile its declaration doesn't name (the board's
   * dock shut by its own tile, a preview's copy floated), so it says the dispatcher's words, not its own.
   */
  check(touches: "tile" | "screen", actor: Actor, tile?: string, way?: string): void {
    const no = this.rule(touches, actor, tile, way);
    if (no) throw new ActionRefused(no);
  }

  /**
   * A tile's name from anything `tile=` takes (a name, an id, a number, an alias, `focused`, a block id it shows), or
   * null: for an argument that may name something that isn't a tile here (`open from=`, the host layer's agent).
   */
  name(sel: string): string | null { return this.tile(sel)?.name ?? null; }
  /** The tile `sel` names, by the same grammar, as the dispatcher sees it (what it shows, whether it's on screen). */
  tile(sel: string): TileRef | null {
    const tiles = this.tilesNow();
    if (sel === "focused") return this.focusedOf(tiles) ?? null;
    return (this.named(sel, tiles) ?? this.byBlock(sel, tiles, USER))?.t ?? null;
  }

  /** Whether some set here (or a dispatcher it hands to) takes the action. */
  has(name: string): boolean { return !!this.owner({ action: name }); }
  /** Whether some set here takes this request (a set that takes only requests naming a tile, the host layer's tile.herdr). */
  takes(req: ActRequest): boolean { return !!this.owner(req); }

  /** The set that owns a request's action: the first registered that claims it. */
  private owner(req: ActRequest): Registration | Delegation | null {
    for (const r of this.regs) {
      // A delegate is asked about the whole request: a screen in a tile is found by the tile it names.
      if (r.claims ? r.claims(req) : "set" in r ? r.set.has(req.action) : !!r.delegate(req)?.takes(r.request ? r.request(req) : req)) return r;
    }
    return null;
  }

  /**
   * An agent's action (the control socket's `act`, an extension's runner, a test): every rule checked, refused with the
   * reason (thrown, nothing done), and what it did said on the status bar.
   */
  act(req: ActRequest, actor: Actor): Promise<unknown> {
    try { return Promise.resolve(this.run(req, actor)); } catch (e) { return Promise.reject(e); }
  }

  /**
   * The person's key or click: the same action an agent's `act` runs, as `you`. A refusal is said on the status bar,
   * never thrown at the key handler; the screen is redrawn either way. Resolves to the answer, or undefined when refused.
   */
  press(name: string, args: Record<string, unknown> = {}, tile?: string): Promise<unknown> {
    return this.asPerson(() => this.run({ action: name, args, ...(tile !== undefined ? { tile } : {}) }, USER, true));
  }

  /**
   * The person's key in a tile whose set is known (a tile kind's own keys, a reader's): `press`, owned by that set.
   * `say`: true says nothing of a refusal (the action said it where it happened), or how to say it (null: nothing).
   */
  pressIn(set: ActionSet<any, any>, name: string, args: Record<string, unknown> = {}, tile?: string, say: boolean | ((why: string) => string | null) = false, given?: unknown): Promise<unknown> {
    const at = this.registered(set);
    if (!at) return this.asPerson(() => { throw new Error(`${set.scope} actions aren't registered on the ${this.host.title}`); });
    return this.asPerson(() => at.d.runIn(at.reg, { action: name, args, ...(tile !== undefined ? { tile } : {}) }, USER, true, given), say);
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
    const tell = (e: unknown) => {
      const why = e instanceof Error ? e.message : String(e), said = say === true ? null : say === false ? why : say(why);
      if (said) ctx?.flash?.(said);
      ctx?.redraw?.();
      return undefined;
    };
    try { return Promise.resolve(f()).then(r => { ctx?.redraw?.(); return r; }, tell); } catch (e) { return Promise.resolve(tell(e)); }
  }

  /** One request, for one actor: who owns it, the revision, then that set's run. */
  private run(req: ActRequest, actor: Actor, typed = false): unknown {
    const args = { ...(req.args ?? {}) };
    // A path (`tile=<mount>/<tile>`, PIE-651) names a tile of a screen mounted in a tile: expected= is that screen's revision.
    if (this.host.revision && "expected" in args && !isTilePath(req.tile)) {
      const why = this.host.revision(args.expected);
      if (why) throw new ActionRefused(why);
      delete args.expected;
    }
    const r = this.owner(req);
    if (!r) throw new ActionRefused(`no action ${req.action} on the ${this.host.title}; \`actions\` lists what it takes`);
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

  /** Run a request with the set that owns it: the tile read, the actor rule checked, the action run, its answer said. */
  private runIn(reg: Registration, req: ActRequest, actor: Actor, typed: boolean, given?: unknown): unknown {
    const def = reg.set.def(req.action);
    if (!def) throw new ActionRefused(`no action ${req.action} here; try: ${reg.set.names().join(", ")}`);
    // The person's own: refused to an agent before anything is read.
    if (actor.kind === "agent" && def.person) throw new ActionRefused(def.person);
    const tiles = this.tilesNow();
    const at = this.target(reg, def, req, actor, tiles);
    const args = this.tileArgs(reg.set.argsOf(req.action) ?? {}, req.args ?? {}, tiles);
    // What the def sees: coerced from the wire (`locked=true` is true, not "true").
    const seen = reg.set.defArgs(req.action, args, typed);
    const no = this.refusal(reg, def, req.action, at, args, seen, actor);
    if (no) throw new ActionRefused(no);
    const ctx = this.host.ctx();
    const on = reg.on(at, { actor, ctx: ctx ? asActor(ctx as DispatchCtx & { flash(msg: string): void }, actor) : ctx, ...(given !== undefined ? { given } : {}) });
    // A key's arguments are typed already (the compiler checked them); the wire's are checked and coerced.
    const ran = reg.run ? reg.run(req.action, args, on, actor, typed) : typed ? reg.set.call(req.action as never, args as never, on, actor) : reg.set.callUntyped(req.action, args, on, actor);
    // What it did, said on the status bar: an agent's always, with who it is; the person's when the screen doesn't
    // show it. Said as soon as it's done: at once for an action that answers at once (a key's flash is there to read).
    const done = (out: unknown) => {
      if (def.says && (actor.kind === "agent" || def.confirms)) {
        const s = def.says(out, seen as never), said = typeof s === "string" ? s : s?.text, ms = typeof s === "object" && s ? s.ms : undefined;
        if (said) ctx?.flash?.(actor.kind === "agent" ? `${agentLabel(actor)} ${said}` : said.replace(/^· /, ""), ms);
      }
      return reg.answer ? reg.answer(out, at) : out;
    };
    return ran instanceof Promise ? ran.then(done) : done(ran);
  }

  /** The actor rule for one request, with what its arguments make it touch: null, or why not. */
  private refusal(reg: Registration, def: ActionDef<unknown, unknown>, name: string, at: Target, args: Record<string, unknown>, seen: Record<string, unknown>, actor: Actor, where = this.where()): string | null {
    const touches = def.touchesWith?.(seen as never, at.name) ?? def.touches;
    // An invitation is read only for an action that takes one (and spends it): elsewhere it opens nothing.
    const invitation = reg.set.argsOf(name)?.invitation && typeof args.invitation === "string" ? args.invitation : undefined;
    // A tile the action acts on (its kind's, or one named) limits an agent; the screen's own action, given none, only reads the focus.
    const agents = at.tile?.agents && (reg.takes === "tile" || at.name !== undefined) ? at.tile.agents : undefined;
    return actorRule({ ...def, touches }, actor, where, { tile: at.tile ?? null, ...(agents ? { gate: { action: name, agents } } : {}), invited: invitation !== undefined, draft: () => this.draftAnswer(def, actor, reg.draftOf ? reg.draftOf(at, args, actor) : reg.takes === "tile" && at.tile ? this.host.draftOf?.(at.tile) ?? null : null, invitation) });
  }

  /**
   * Tile `sel`'s menu (PIE-492, `tile.menu`): every row its actions declare (ActionDef.menu) in the sets that would run
   * them there, in the order a name is looked up (the screen's own sets, the tile actions, its kind's, a reader's note
   * actions), each as it would run for `actor` now: hidden where it isn't this tile's now, and with the reason where it
   * would be refused. Nothing runs; nothing is drawn.
   */
  menu(sel: string, actor: Actor): MenuRow[] {
    const tiles = this.tilesNow(), tile = this.tile(sel);
    if (!tile) throw new ActionRefused(`no tile ${sel} on the ${this.host.title}; ${this.which(tiles)}`);
    const out: MenuRow[] = [], where = this.where(), ctx = this.host.ctx();
    // A row is listed by the registration that would run it: the owner a press of it finds (claims included).
    const owns = (r: Registration | Delegation, action: string) => this.owner({ action, tile: tile.name }) === r;
    for (const r of this.regs) {
      if (!("set" in r)) {
        if (r.listed === false) continue;
        try { out.push(...(r.delegate()?.menu(tile.name, actor) ?? []).filter(row => owns(r, row.action))); } catch { /* the tile isn't one it reaches */ }
        continue;
      }
      if (r.takes === "none" || (r.menuIn && !r.menuIn(tile))) continue;
      for (const name of r.set.names()) {
        const def = r.set.def(name)!, entries = def.menu === undefined ? [] : Array.isArray(def.menu) ? def.menu : [def.menu as MenuEntry<unknown, unknown>];
        if (!entries.length || !owns(r, name)) continue;
        let at: Target;
        try { at = this.target(r, def, { action: name, tile: tile.name }, actor, tiles); } catch { continue; }      // not this tile's kind
        if (!at.tile) continue;
        let on: unknown;
        for (const e of entries) {
          const now = e.now ? e.now((on ??= r.on(at, { actor, ctx: ctx ? asActor(ctx as DispatchCtx & { flash(msg: string): void }, actor) : ctx })), { name: at.tile.name, kind: at.tile.kind }, actor) : null;
          if (now?.hide) continue;
          const args = { ...(e.args ?? {}), ...(now?.args ?? {}) } as Record<string, unknown>;
          const why = this.refusal(r, def, name, at, args, args, actor, where) ?? now?.refused ?? null;
          const key = e.key ?? [...declaredKeys(def.keys)].find(k => !MENU_NOT_KEYS.has(k) && !k.includes(" "));
          out.push({ action: name, args, tile: at.tile.id ?? at.tile.name, label: now?.label ?? e.label, group: e.group, ...(key ? { key } : {}), ...(why ? { refused: why } : {}) });
        }
      }
    }
    return out;
  }

  private tilesNow(): TileRef[] { return this.host.tiles?.() ?? []; }

  /** What the draft rule says for a `draft` action, about the draft it would write. */
  private draftAnswer(def: ActionDef<unknown, unknown>, actor: Actor, d: DraftAt | null, invitation?: string): string | null {
    if (!d) return invitation !== undefined ? draftRule(actor, def.draft ?? "write", {}, { invitation }) : null;
    return draftRule(actor, def.draft ?? "write", d, invitation !== undefined ? { invitation } : {});
  }

  /** Arguments that name a tile (`to=`), read with `tile=`'s grammar: the action gets the tile's name. */
  private tileArgs(spec: Record<string, ArgSpec>, raw: Record<string, unknown>, tiles: TileRef[]): Record<string, unknown> {
    const out = { ...raw };
    for (const [k, s] of Object.entries(spec)) {
      if (!s.tile || typeof out[k] !== "string" || !tiles.length) continue;
      // A path (`group/tile`, `../tile`) names a tile of another screen of the family: the action reads it (tile.link to=).
      if (isTilePath(String(out[k]))) continue;
      const hit = this.named(String(out[k]), tiles);
      if (!hit) throw new ActionRefused(`no tile ${out[k]} here; ${this.which(tiles)}`);
      out[k] = hit.t.name;
    }
    return out;
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
      if (!hit) throw new ActionRefused(`no tile ${sel} on the ${this.host.title}; ${this.which(tiles)}`);
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
      else if (reg.pick === "only" && can.length > 1 && actor.kind === "agent") throw new ActionRefused(`${req.action} needs tile=<tile>: the focused tile has no such action and several here do (${can.map(t => t.name).join(", ")})`);
      else hit = { t: can[0]!, by: "default" };
    } else {
      hit = this.named(sel, can) ?? this.byBlock(sel, can, actor);
      if (!hit) {
        const other = this.named(sel, tiles);
        if (other) throw new ActionRefused(`${other.t.name} is ${kindNoun(other.t)}: ${req.action} is for ${noun(req.action)}${can.length ? `; here: ${can.map(t => t.name).join(", ")}` : ""}`);
        if (BLOCK.test(sel)) throw new ActionRefused(`no ${noun(req.action).replace(/^an? /, "")} shows ${sel}; open it first (open id=${sel})`);
        throw new ActionRefused(`no tile ${sel} on the ${this.host.title}; ${this.which(can.length ? can : tiles)}`);
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
    if (reg.seen && actor.kind === "agent" && t.readOnly && !t.editing) throw new ActionRefused(t.readOnly);
    return { tile: t, name: t.name };
  }

  private focusedOf(tiles: TileRef[]): TileRef | undefined {
    const f = this.where().focus;
    return f === null ? undefined : tiles.find(t => t.name === f);
  }

  /** A tile by what names it: its name, its id, its number, one of its aliases (in that order). */
  private named(sel: string, tiles: TileRef[]): { t: TileRef; by: NamedBy } | null {
    const byName = tiles.find(t => t.name === sel);
    if (byName) return { t: byName, by: "name" };
    const byId = tiles.find(t => t.id === sel);
    if (byId) return { t: byId, by: "id" };
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
    const hits = tiles.filter(t => t.shows?.startsWith(sel) || t.lists?.startsWith(sel)).sort((a, b) => rank(a) - rank(b) || Number(b.name === f) - Number(a.name === f));
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
