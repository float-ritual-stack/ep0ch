// A mounted screen (PIE-651, first PIE-413's screen in a tile): a screen spec on the one screen host, the desk, drawn in a
// tile of another screen. It is the same spec on the same tiles (the board's lanes are its query tiles, its preview its
// preview), never a copy: a desk of its own inside the tile, through the showcase's FramedScreen (src/showcase/frame.ts),
// whose terminal is the tile's rectangle. Three things mount this way:
//
// - a whole screen (`tile.open kind=screen screen=board target=<hub>`, or the older `board` and `river` kinds);
// - a part of one (`part=lanes`: the container of that key alone, `partSpec`), whose opens land where the mount's do;
// - a group: tiles gathered from this screen into one tile (`tile.group`), laid out as a screen of their own, so a tab
//   set's tab can hold a split ("splits in my tabs").
//
// What is per mount and what is shared: each mount is its own instance (its layout, focus, spines, selection, scroll,
// a lane's cursor), saved in its tile spec (`inner`) with the layout of the screen holding it, never in the full screen's
// file; the outline is shared (the hub, its views, the cards, drafts held on the service). A whole screen's first mount
// starts as its full screen was last left (read, never written). One action pops a mount out to its full screen (the
// screen switch, `mount.out`), and `q` comes back; `screen.mount` on a full screen puts it (or a part) on the desk.
//
// Keys: the mounted screen's own keys work in it (the board's h l j k); 1-9, Tab, alt and ^W stay the screen holding it.
// `^W e` (`mount.enter`) goes in: every key is the mounted screen's, its ^W and Tab too, until ctrl+] or an Esc with
// nothing left to close in it. A q with nothing left to leave in it is the holding screen's q: it leaves that screen, as on
// any desk (PIE-727), or, from inside, comes out. What the mounted screen selects (the board's card) is the tile's selection: a preview
// tile can follow it. A screen made for the current note each time it moves (`Follows`: the showcase's BBS message
// reader beside a reader) is drawn the same way.
import { nothingToClose, refused } from "../shell-keys";
import type { Screen } from "../app";
import type { Msg } from "../board";
import type { Placement } from "../kitty";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { FramedScreen } from "../showcase/frame";
import { C, fg, paint } from "../style";
import { ch, type Key } from "../term";
import type { Desk } from "./desk";
import type { DeskApi, Pane, PaneView } from "./panes";
import { isEscapeChord } from "./pty";
import { screenNames } from "./screen-spec";
import type { KindHost, TileKind } from "./tile-kinds";
import type { TileSpec } from "./tiles";

/** A screen made for the desk's current note, again each time it moves, and the tile's title. */
export interface Follows { label: string; make(m: Msg | null): Screen | null }

/** The screen-specs module, loaded when a mount is first shown (it builds desks, which build these tiles). */
const specs = (): typeof import("./screen-specs") => require("./screen-specs");

/** What a mount holds: a registered screen (with its args and part), or a group's own tree (`screen` null). */
export interface MountOf { screen: string | null; args: Record<string, unknown>; part: string | null }

export class ScreenTile implements Pane {
  readonly screen: string | null;
  readonly args: Record<string, unknown>;
  readonly part: string | null;
  /** What its title calls it, when the person named it (a group's "notes + terminal"). */
  label: string | null;
  private framed: FramedScreen | null = null;
  private desk: DeskApi | null = null;
  private selected: string | null = null;
  /** The board's own preview strip: false when a preview tile follows the board instead (it's collapsed). */
  private preview = true;
  /** The state it comes back as (its tile spec's `inner`), until its desk is made. */
  private saved: unknown;
  /** A group's tiles, given whole as it's made (from the screen it was gathered on), by name. */
  private given: ReadonlyMap<string, Pane> | null;
  /** Why it couldn't mount (no such screen or part): said in its place, its spec kept. */
  private problem: string | null = null;
  /** The person is in it (`mount.enter`): every key is the mounted screen's until ctrl+] or an Esc with nothing to close. */
  inside = false;
  /** Where its tiles are known across session daemons (`desk.json:t5`), set as it joins its screen. */
  private home: string | null = null;

  constructor(readonly kind: string, spec: Partial<TileSpec> = {}, private readonly follows?: Follows, given?: ReadonlyMap<string, Pane>) {
    // The older kinds name their screen by their kind (a saved `board` tile is the board, mounted).
    this.screen = typeof spec.screen === "string" && spec.screen ? spec.screen : kind === "board" || kind === "river" ? kind : null;
    this.args = spec.args && typeof spec.args === "object" ? { ...spec.args } : {};
    this.part = typeof spec.part === "string" && spec.part ? spec.part : null;
    this.label = typeof spec.label === "string" && spec.label ? spec.label : null;
    this.saved = spec.inner;
    this.given = given ?? null;
    if (spec.preview === false) this.preview = false;
  }

  /** What it mounts, as `layout.get` and its spec say it. */
  get mount(): MountOf { return { screen: this.screen, args: this.args, part: this.part }; }
  /** A group: tiles gathered from its screen, with no screen of their own elsewhere. */
  get group(): boolean { return !this.screen && !this.follows; }
  /** The desk inside it (a mounted screen's, a group's), once it's shown. */
  get inner(): Desk | null { const s = this.framed?.first as Desk | undefined; return s && "savedState" in s ? s : null; }

  /** Collapse (false) or open the board's own preview strip; a preview tile then follows the board instead. */
  async ownPreview(on: boolean, actor: Actor = USER) {
    this.preview = on;
    const s = this.framed?.first;
    if (this.screen === "board" && !this.part && s?.dispatch) await s.dispatch.act({ action: "tile.collapse", tile: "preview", args: { on: !on } }, actor).catch(() => {});
  }
  spec(): Record<string, unknown> {
    const inner = this.inner?.savedState() ?? this.saved;
    return {
      ...(this.kind === "screen" && this.screen ? { screen: this.screen } : {}),
      ...(Object.keys(this.args).length ? { args: { ...this.args } } : {}),
      ...(this.part ? { part: this.part } : {}),
      ...(this.label ? { label: this.label } : {}),
      ...(inner !== undefined ? { inner } : {}),
      ...(this.preview ? {} : { preview: false }),
    };
  }

  get screenShown(): Screen | null { return this.framed?.top ?? null; }
  /** Its screen's dispatcher (the board's card.*), for `act tile=<this>` and `tile=<this>/<a tile in it>`. */
  get dispatch() { return this.framed?.top.dispatch ?? null; }
  title() {
    if (this.follows) return this.follows.label;
    if (this.problem) return `${this.screen ?? "group"} · ${this.problem}`;
    const t = this.inner?.title ?? this.framed?.top.title ?? this.screen ?? "group";
    const said = this.label ?? (this.part && !t.includes(this.part) ? `${t} · ${this.part}` : t);
    return this.inside ? `${said} · in` : said;
  }
  /** Its spine says what it mounts (`board · House board`), not the tile's name. */
  spine() { return { title: this.title().replace(/ · in$/, "") }; }
  hint() {
    if (this.inside) return "every key is the mounted screen's · ctrl+] or esc (nothing left to close in it) comes out";
    return `its own keys · 1-9 tab alt and ^W stay this screen's · ^W e goes in${this.screen ? " · ^W u full screen" : " · ^W G spills it"}`;
  }

  init(desk: DeskApi) {
    // Moved to another screen (a group, your drawer): that one is its desk now, its screen inside as it was.
    if (this.framed) { this.desk = desk; return; }
    if (this.follows) return;
    let s: Screen;
    try {
      s = specs().mountDesk({ ...this.mount, chain: desk.mountChain?.() ?? [], saved: this.saved, ...(this.label ? { label: this.label } : {}), ...(this.given ? { given: this.given } : {}) }, {
        onSave: () => this.desk?.keepLayout?.(),
        outward: (m, by, fresh) => this.openOut(m, by, fresh),
      });
    } catch (e) { this.problem = e instanceof Error ? e.message : String(e); this.desk = desk; return; }
    this.given = null;
    if (this.home) (s as Desk).home = this.home;
    // Its tiles' links across this tile's edge (a group's tile and one outside it) are by path through the desk holding it.
    (s as Desk).holder = { tile: this, desk: () => (this.desk as unknown as Desk | null) };
    this.frame(s, desk);
    if (!this.preview) { this.framed!.open(); void this.ownPreview(false); }
  }
  /** Its place across session daemons (`<home>:<its id>`): the mounted screen's terminals are kept under it. */
  setHome(home: string | null) { this.home = home; const d = this.inner; if (d) d.home = home; }
  select(m: Msg | null, desk: DeskApi) { if (this.follows) { this.framed?.dispose(); this.frame(this.follows.make(m), desk); } }
  private frame(s: Screen | null, desk: DeskApi) {
    this.desk = desk;
    // The desk it's on is read each time, never kept from the first: a mount moved (into a group, your drawer, back) answers to its new one.
    const on = () => this.desk ?? desk;
    // q with nothing left in the screen: out of it when the person is in it, else the screen holding it goes back, as q
    // does on any desk (PIE-727: it was refused here, so a desk holding only a group couldn't be left by q).
    this.framed = s && new FramedScreen(s, () => on().ctx, () => this.left(on()), undefined, () => !!on().hasFocus?.(this),
      // Esc with nothing left in the screen: out of it when the person is in it, else the desk's own steps (a zoom, a dock, a float's keys).
      () => (this.inside ? this.goIn(false) : on().escaped ? on().escaped!() : nothingToClose(on().ctx)));
  }

  /** q with nothing left in its screen: out of it (the person was in it), else the screen holding it goes back. */
  private left(desk: DeskApi) {
    if (this.inside) return this.goIn(false);
    if (desk.leave) return desk.leave();
    refused(desk.ctx, `the ${this.screen ?? "group"} is a tile · ^W x closes it, ^W z zooms it`);
  }

  /** An open its screen has no reader for (a mounted part: the lanes alone): where this tile's opens land, on the screen holding it. */
  private async openOut(m: Msg, by: Actor, fresh: boolean): Promise<{ reader: string | null; id: string }> {
    const d = this.desk, name = d?.nameOfPane?.(this);
    if (!d?.perform || !name) throw new ActionRefused("nowhere to open it: the mount isn't on a screen");
    const r = await d.perform("open", { id: m.id, from: name, ...(fresh ? { fresh: true } : {}) }, by) as { reader?: string | null } | undefined;
    return { reader: r?.reader ?? null, id: m.id };
  }

  /** The person goes in (every key the mounted screen's) or comes out. */
  goIn(on: boolean) {
    if (on && !this.framed) throw new ActionRefused(this.problem ?? "nothing is mounted in it yet");
    this.inside = on;
    this.desk?.ctx.flash(on ? `in the ${this.screen ?? "group"} · its keys, ^W and Tab too · ctrl+] or esc comes out` : `out of the ${this.screen ?? "group"} · 1-9 tab alt and ^W are this screen's again`);
    this.desk?.redraw();
  }

  /** Pop out: the mounted screen as the full screen (the screen switch, over this one); `q` there comes back here. */
  popOut(actor: Actor): { screen: string; args: Record<string, unknown> } {
    if (!this.screen) throw new ActionRefused("a group is no screen of its own: ^W z zooms it, ^W G spills its tiles back");
    const d = this.desk;
    if (!d) throw new ActionRefused("the mount isn't on a screen yet");
    const s = specs().openScreen(this.screen, this.args);
    (s as Desk).poppedFrom = { tile: this, desk: d };
    d.ctx.push(s);
    void actor;
    return { screen: this.screen, args: this.args };
  }

  /** What the screen has selected (the board's card): the tile's selection, for a preview following it. */
  current(): Msg | null { return ((this.framed?.first as { current?: Msg | null } | undefined)?.current) ?? null; }

  render(w: number, h: number): PaneView {
    if (this.problem) return { lines: [paint(`|08 ${this.problem}`), paint("|08 ^W x closes it")].slice(0, h) };
    if (!this.framed) return { lines: [] };
    const f = this.framed.render(w, h, `tile-${this.kind}`);
    this.noticeSelection();
    return { lines: f.lines, placements: f.placements as Placement[] };
  }

  /** Its controls on the header: full screen, in or out, and a group's spill. */
  headControls(_room: number, desk: DeskApi) {
    if (this.follows || this.problem || !this.framed) return null;
    const run = (name: string, args: Record<string, unknown> = {}) => () => void desk.perform?.(name, args, USER, this);
    return [
      ...(this.screen ? [{ text: "▲ full", sgr: fg(C.grey), press: run("mount.out") }] : [{ text: "■ spill", sgr: fg(C.grey), press: run("tile.group", { on: false }) }]),
      { text: this.inside ? "◄ out" : "⏎ in", sgr: fg(this.inside ? C.yellow : C.grey), press: run("mount.enter", { on: !this.inside }) },
    ];
  }

  /** The screen moved its selection: the desk hears it once, after this frame. */
  private noticeSelection() {
    const m = this.current();
    if (!m || m.id === this.selected) return;
    this.selected = m.id;
    const desk = this.desk;
    queueMicrotask(() => desk?.setCurrent(m, { from: this }));
  }

  key(k: Key): boolean {
    if (!this.framed) return false;
    if (this.inside) {
      if (isEscapeChord(k)) { this.goIn(false); return true; }
      this.framed.key(k);
      this.desk?.redraw();
      return true;
    }
    const c = ch(k);
    // In an edit, a comment or a panel, every key is the screen's; otherwise the desk keeps 1-9 and video.
    if (!this.framed.top.holdsKeys?.() && (/^[1-9]$/.test(c) || c === "V")) return false;
    this.framed.key(k);
    this.desk?.redraw();
    return true;
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number): boolean {
    this.framed?.key({ ...k, x, y });
    this.desk?.redraw();
    return true;
  }
  wheel(dir: 1 | -1) { this.framed?.key({ kind: "mouse", action: dir < 0 ? "wheel-up" : "wheel-down", button: 0, x: 0, y: 0 }); }

  tick() { return this.framed?.tick() ?? false; }
  onEvent(_desk: DeskApi, e?: OutlineEvent) { if (e) this.framed?.onEvent(e); }
  unsaved() { return this.framed?.unsaved() ?? false; }
  keepDrafts() { return this.framed?.keepDrafts() ?? []; }
  /** It goes (closed, or its screen goes): what it held is kept as its spec says it, and nothing draws it again. */
  dispose() {
    const d = this.inner;
    if (d) try { this.saved = d.savedState(); } catch { /* it had nothing left to save */ }
    this.framed?.dispose();
    this.framed = null;
  }
  /** Its desk's focused tile says a refusal of the person's key (Pane.nestsTiles) while that desk is shown; a followed screen or one pushed over it isn't a desk, so this frame does. */
  nestsTiles() { const d = this.inner; return !!d && this.framed?.top === d; }
  /** Every key is its screen's now: it's in an edit, or the person went in. */
  holdsKeys() { return this.inside || !!this.framed?.top.holdsKeys?.(); }
  /** Programs run in it (a group's terminal): it holds work a new layout keeps. */
  holdsWork() { return this.unsaved() || !!this.inner?.holdsPrograms(); }

  describe() { return this.framed?.top.describe?.() ?? null; }
  /** What `layout.get` says of it: what it mounts, and the mounted screen's own layout (its tiles' ids are its own). */
  layoutOf(full: boolean): Record<string, unknown> {
    const d = this.inner;
    const what = { screen: this.screen, ...(Object.keys(this.args).length ? { args: this.args } : {}), ...(this.part ? { part: this.part } : {}), group: this.group, in: this.inside, title: this.title(), ...(this.problem ? { problem: this.problem } : {}) };
    if (!d) return { mount: what };
    const l = d.layoutGet();
    return { mount: { ...what, ...(full ? { layout: l } : { rev: l.rev, focus: l.focus, tree: l.tree }) } };
  }
}

/**
 * A mount's own actions: out to its full screen, and in or out of it. They run in a mount tile (`tile=` names it, or the
 * focused one); the screen holding it registers them through the kind, so keys, the header's controls, the tile menu and
 * `act` are one path.
 */
export const MOUNT_ACTIONS = actionSet<KindHost>()("mount", {
  "mount.out": def({
    summary: "pop a mounted screen out to the full screen (the screen switch, over this one: q comes back to the mount where it was). The full screen is its own instance (its own layout, selection and scroll; the outline's cards are the same). A group has no screen of its own: refused",
    keys: "^W u on a mount; a click on ▲ full on its header; its tile menu",
    touches: "screen", replay: "ask", says: r => `popped out to the ${r.screen}`,
    menu: { label: "pop out to the full screen", group: "Mount", key: "ctrl+w u", now: ({ pane }) => ((pane as ScreenTile).group ? { hide: true } : null) },
    args: {},
    run(_, { pane }, actor) { return (pane as ScreenTile).popOut(actor); },
  }),
  "mount.enter": def({
    summary: "go into a mounted screen (on=true): every key is its own, its ^W and Tab too, until ctrl+], an Esc with nothing left to close in it, or on=false. The person's only: an agent acts in a mount with tile=<mount>/<its tile>",
    keys: "^W e on a mount; ctrl+] or esc comes out; a click on ⏎ in or ◄ out on its header",
    touches: "screen", replay: "safe", person: "going into a mount moves the person's keys; an agent names a tile in it instead: tile=<mount>/<tile>",
    menu: { label: "go in (its keys)", group: "Mount", key: "ctrl+w e", now: ({ pane }) => ((pane as ScreenTile).inside ? { label: "come out", args: { on: false } } : null) },
    args: { on: { type: "boolean", optional: true, about: "true goes in, false comes out; default toggles" } },
    run({ on }, { pane }) { const t = pane as ScreenTile; t.goIn(on ?? !t.inside); return { tile: undefined, in: t.inside }; },
  }),
});

/** A place holder in a mounted part whose tiles come from data (the board's lanes), until its source answers. */
export class FillingTile implements Pane {
  readonly kind = "filling";
  constructor(private readonly label = "filling from its source…") {}
  title() { return this.label; }
  hint() { return "its tiles take this place as its source answers"; }
  render(_w: number, h: number): PaneView { return { lines: [paint(`|08 ${this.label}`)].slice(0, h) }; }
  key(): boolean { return false; }
}

/** The screens a mount can hold: every registered one but the desk itself (it holds mounts) and the logon's home base. */
const mountable = (): string[] => screenNames().filter(n => n !== "desk" && n !== "home");

/** The mount kinds: `screen` (any screen, a part, a group), and the board and river by their own older kinds. */
export function mountKinds(): TileKind[] {
  const of = (kind: string, key: string | null, about: string): TileKind => ({
    kind, about, ...(key ? { keys: [{ key, label: kind }] } : {}),
    noun: kind === "screen" ? "a mounted screen" : `a ${kind} tile`,
    make: s => new ScreenTile(kind, s),
    actions: MOUNT_ACTIONS,
    check: s => (kind !== "screen" || s.screen || s.inner ? null : `a mount names its screen (screen=${mountable().join(", ")}), and part=<container> for a part of it`),
    // ^W o m with no screen named: the person picks one (a part by part= through act).
    ...(kind === "screen" ? { choices: async () => ({ title: "mount a screen here", items: mountable().map(n => ({ label: n, spec: { screen: n } })) }) } : {}),
    // A whole screen keeps its own keys while it's in an edit (or the person went in), answers its own actions (the board's card.*) and animates.
    takesKeys: p => (p as ScreenTile).holdsKeys(),
    dispatcher: p => (p as ScreenTile).dispatch,
    tick: p => (p as ScreenTile).tick(),
    holdsWork: p => (p as ScreenTile).holdsWork(),
    shows: p => (p as ScreenTile).current(),
    start: (p, env) => { if (env.home) (p as ScreenTile).setHome(`${env.home}:${env.id}`); },
    describe: (p, full) => (p as ScreenTile).layoutOf(full),
    view: p => { const t = p as ScreenTile, m = t.current(); return { viewport: { screen: t.screenShown?.title ?? null, selected: m?.id ?? null, in: t.inside } }; },
  });
  return [
    of("screen", "m", "a screen mounted here (screen=<name> target=<what it opens on>, part=<a container of it>): its own tiles live, folding to a spine; ^W u pops it out to the full screen"),
    {
      ...of("board", "k", "the kanban board as a tile; tile.preview gives its card to a preview tile"),
      // The board's own preview strip gives its place to the preview tile (collapsed to a spine, as its `c` does).
      previewSource: async (p, name, actor) => { await (p as ScreenTile).ownPreview(false, actor); return `tile:${name}`; },
    },
    of("river", "v", "the river (Quay) as a tile, its columns and open rule its own"),
    { kind: "filling", about: "a place holder in a mounted part, until its source fills it", noun: "a place holder", placeholder: true, make: s => new FillingTile(s.label) },
  ];
}
