// The glass extension (PIE-1505, docs/adr/0008-extension-first.md): hover a link and its note shows in a post-it on the
// glass; ◇ on the status bar says the mode and cycles it (off → on → sticky). It is a door module (src/door-modules.ts)
// that the `glass` extension's manifest names (packages/outliner/extensions/glass), on by default and uninstalled like
// any other from the extensions screen. It stands on the door's primitives only:
//
// - the hover event (src/hover.ts): what is under the pointer, never while a button is down or over chrome;
// - an extension's status chip (registerStatusChip, src/status-bar.ts): ◇, its click and alt-click;
// - the float layer (src/float-layer.ts, `app.glass`): where its post-its and shelves are put, docked and tucked;
// - a Tune section (src/desk/tune.ts): its delays and limits, beside values and Hints;
// - tile kinds (post-it, shelf) and an action set (`glass.*`), which go when it stops.
//
// Turned off, nothing of it runs: hover does nothing, ◇ is gone, and `glass.*` says how to install it again. The float
// layer stays: `tile.float to=glass` still lifts any tile onto it.
import type { App } from "../../src/app";
import type { Msg } from "../../src/board";
import type { Desk } from "../../src/desk/desk";
import { readTarget } from "../../src/desk/outline-boards";
import type { DeskApi } from "../../src/desk/panes";
import type { TileDone } from "../../src/desk/tile-actions";
import { kindsChanged, registerTileKind, tileKind, unregisterTileKind } from "../../src/desk/tile-kinds";
import { registerTuneSection } from "../../src/desk/tune";
import type { ActiveModule, DoorModule } from "../../src/door-modules";
import { inside, type HoverMove, type Point } from "../../src/hover";
import type { Rect } from "../../src/canvas";
import { USER, type Actor } from "../../src/socket";
import { outlineState, readState, writeState } from "../../src/state";
import { registerStatusChip } from "../../src/status-bar";
import { actionSet, def, ActionRefused, keyName } from "../../src/surface/actions";
import { effective, keyTable } from "../../src/surface/keymap";
import type { ModeKey } from "../../src/surface/modes";
import type { Key } from "../../src/term";
import { TONE_INDEX } from "../../src/theme";
import { PostIt, POST_IT_KIND, textNote, readPostIt } from "./post-it";
import { Shelf, SHELF_KIND, type ShelfColour } from "./shelf";

export type GlassMode = "off" | "on" | "sticky";
/** Each mode in a few words: what the status line says when it changes, and what the ◇ chip's title reads. */
export const GLASS_MODES: Record<GlassMode, string> = {
  off: "glass off",
  on: "glass on · hover a link to peek",
  sticky: "glass sticky · each hover stays as a post-it",
};
export const GLASS_SETTINGS = {
  open: { base: 300, step: 50, min: 0, about: "open delay (ms)" },
  close: { base: 600, step: 50, min: 0, about: "close delay (ms)" },
  grace: { base: 400, step: 50, min: 0, about: "grace toward the post-it (ms)" },
  stack: { base: 30, step: 1, min: 1, about: "hover history length" },
  limit: { base: 8, step: 1, min: 1, about: "soft limit for pinned post-its" },
} as const;
export type GlassSetting = keyof typeof GLASS_SETTINGS;
export const GLASS_KEYS = keyTable("glass", "hover above every screen", [
  { key: "alt+u", action: "glass.toggle", label: "hover" },
  { key: "alt+U", action: "glass.clear", label: "clear glass" },
] satisfies ModeKey[]);
type HoverTrail = { msg: Msg; nav: ReturnType<PostIt["surface"]["saveNav"]> };
const distance = (p: Point, r: Rect) => Math.hypot(Math.max(r.col - p.x, 0, p.x - r.col - r.cols), Math.max(r.row - p.y, 0, p.y - r.row - r.rows));

let current: Glass | null = null;
/** The glass while the extension runs (a post-it's peel and shelve, its stack length). */
export const running = (): Glass | null => current;
export function glass(): Glass {
  if (!current) throw new ActionRefused("the glass extension is off here · ep0ch act extensions.install id=glass turns it on");
  return current;
}

/** Timing and gestures only. Tiles, their rectangles and their order belong to the host desk's LayoutState (the float layer). */
export class Glass {
  mode: GlassMode = "off";
  settings: Record<GlassSetting, number> = Object.fromEntries(Object.entries(GLASS_SETTINGS).map(([k, v]) => [k, v.base])) as Record<GlassSetting, number>;
  private size = { cols: 56, rows: 16 };
  private source: Rect | null = null;
  private target = "";
  private opening: ReturnType<typeof setTimeout> | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;
  private closeAt = 0;
  private generation = 0;
  private hover: PostIt | null = null;
  private saved: HoverTrail | null = null;

  constructor(private readonly app: App) {
    const saved = readState<{ mode: GlassMode; settings: Record<GlassSetting, number>; size: { cols: number; rows: number }; trail: HoverTrail | null }>("glass.json", outlineState());
    if (saved) { this.mode = saved.mode; this.settings = { ...this.settings, ...saved.settings }; this.size = saved.size; this.saved = saved.trail; }
  }
  private get layer() { return this.app.glass; }
  private get host() { return this.app.drawer; }
  private save() { writeState("glass.json", { mode: this.mode, settings: this.settings, size: this.size, trail: this.saved }, outlineState()); }
  floats() { return this.layer.floats(); }
  private current() {
    const f = this.floats().find(f => f.pane instanceof PostIt && f.pane.hover);
    if (f && f.pane instanceof PostIt && this.hover !== f.pane) this.watch(f.pane);
    return f;
  }
  private watch(p: PostIt) {
    this.hover = p;
    p.dismissed = () => { this.saved = p.msg ? { msg: p.msg, nav: p.surface.saveNav() } : null; this.target = ""; this.source = null; this.save(); };
  }
  painted() {
    const f = this.current();
    if (f && (this.size.cols !== f.rect.cols || this.size.rows !== f.rect.rows)) { this.size = { cols: f.rect.cols, rows: f.rect.rows }; this.save(); }
  }
  private pinnedCount() { return this.floats().filter(f => !(f.pane instanceof PostIt) || !f.pane.hover || f.pane.sticky).length; }
  describe() { return { mode: this.mode, settings: { ...this.settings }, pinned: this.pinnedCount() }; }
  chip() {
    const count = this.floats().length;
    return `◇ ${this.mode}${count ? ` ${count}${this.pinnedCount() > this.settings.limit ? "!" : ""}` : ""}`;
  }
  tiny() { return `◇${this.mode === "off" ? "×" : this.mode === "sticky" ? "◆" : ""}${this.floats().length || ""}`; }
  set(mode: GlassMode, actor: Actor) {
    this.mode = mode; this.cancelOpen(); this.cancelClose();
    if (mode === "off") this.dismiss(actor);
    this.save(); this.app.redraw(); return { ...this.describe(), tiles: this.layer.describe().tiles };
  }
  tune(name: GlassSetting, value: number) {
    const setting = GLASS_SETTINGS[name];
    if (!Number.isInteger(value) || value < setting.min) throw new ActionRefused(`${name} is a whole number of at least ${setting.min}`);
    this.settings[name] = value; this.save(); this.app.redraw(); return { name, value };
  }
  private cancelOpen() { if (this.opening) clearTimeout(this.opening); this.opening = null; this.generation++; }
  private cancelClose() { if (this.closing) clearTimeout(this.closing); this.closing = null; this.closeAt = 0; }
  dispose() { this.cancelOpen(); this.cancelClose(); }

  /** A button went down: what was about to open waits for the next move (the hover primitive's press). */
  pressed() { this.cancelOpen(); }
  /** A distinct move with no button down (the hover primitive's): close what the pointer left, open what it rests on. */
  moved({ point, before }: HoverMove) {
    this.cancelOpen();
    const current = this.current(), over = current && inside(point, current.rect);
    if (current && current.pane instanceof PostIt && !current.pane.sticky) {
      if (over || this.source && inside(point, this.source) || this.host.glassHasKeys(current.tile)) this.cancelClose();
      else {
        const now = Date.now();
        this.closeAt ||= now + this.settings.close;
        if (before && distance(point, current.rect) < distance(before, current.rect)) this.closeAt = Math.max(this.closeAt, now + this.settings.grace);
        if (this.closing) clearTimeout(this.closing);
        this.closing = setTimeout(() => { this.closing = null; this.closeAt = 0; if (!this.host.glassHasKeys(current.tile) && !(current.pane instanceof PostIt && current.pane.editing)) this.dismiss(USER); }, Math.max(0, this.closeAt - now));
      }
    }
    if (this.mode === "off" && !point.alt || this.source && inside(point, this.source)) return;
    const generation = this.generation;
    this.opening = setTimeout(() => {
      this.opening = null;
      void this.resolve(point, generation).catch(e => this.app.flash((e as Error).message));
    }, this.settings.open);
  }
  private async resolve(point: Point, generation: number) {
    const over = this.floats().findLast(f => inside(point, f.rect)), hit = this.app.hover.hitAt(point);
    const text = hit?.text, key = hit?.target ? JSON.stringify(hit.target) : text;
    if (!hit || !key) return;
    this.cancelClose();
    if (key === this.target) { this.source = hit.rect; return; }
    const m = hit.target ? await readTarget(this.app, hit.target) : text ? textNote(text) : null;
    if (!m || generation !== this.generation) return;
    this.target = key; this.source = hit.rect;
    if (await hit.desk.hoverInto(hit.tile, m)) return;
    this.show(m, USER, true, point.alt || this.mode === "sticky", over?.pane instanceof PostIt ? over.pane : undefined);
  }
  private show(m: Msg, actor: Actor, hover: boolean, sticky: boolean, into?: PostIt): TileDone {
    const d = this.host.desk!;
    const current = into ? this.floats().find(f => f.pane === into) : hover ? this.current() : undefined;
    if (current && current.pane instanceof PostIt) {
      const p = current.pane;
      if (p.editing || p.holdsKeys) return { tile: current.tile, kept: true };
      p.sticky ||= sticky; p.show(m, d, actor); d.save(); this.app.redraw();
      return { tile: current.tile, name: current.name };
    }
    const p = new PostIt();
    p.hover = hover; p.sticky = sticky; p.by = actor.kind === "agent" ? actor.id : null;
    if (hover && this.saved) {
      p.show(this.saved.msg, d, actor);
      if (this.saved.nav) p.surface.restoreNav(this.saved.nav);
    }
    p.show(m, d, actor);
    if (hover) this.watch(p);
    return this.layer.put(p, hover ? "hover" : "post-it", { t: "leaf", kind: "post-it" }, actor, this.layer.rectangle(this.size, !hover));
  }
  async pin(ref: string, actor: Actor, shelf?: string) {
    const m = await readPostIt(this.app, ref);
    if (shelf) return this.shelve(m, shelf, actor);
    return this.show(m, actor, false, true);
  }
  peel(p: PostIt, desk: DeskApi, actor: Actor): TileDone {
    if (!this.floats().some(f => f.pane === p)) {
      const done = this.layer.float(desk as Desk, desk.nameOfPane!(p), actor);
      p.hover = false; p.sticky = true; desk.keepLayout?.();
      return done;
    }
    if (!p.msg) throw new ActionRefused("this post-it is empty · hover a note first");
    return this.show(p.msg, actor, false, true);
  }
  shelf(name: string, colour: ShelfColour, actor: Actor) {
    const d = this.host.desk!;
    const done = this.layer.put(new Shelf([], "list", colour), "shelf", { t: "leaf", kind: "shelf" }, actor, this.layer.rectangle(this.size, true));
    const named = d.titleTile(done.tile, name, false, actor);
    d.save(); this.app.redraw(); return named;
  }
  private shelfAt(name: string) {
    const found = this.host.desk!.resolveTile(name);
    const pane = found && found.desk.pane(found.tile.id!);
    if (!(pane instanceof Shelf)) throw new ActionRefused(`${name} isn't a shelf · glass.shelf name=seeds colour=amber makes one`);
    return { pane, desk: found!.desk };
  }
  async shelve(m: Msg, name: string, actor: Actor) {
    const { pane, desk } = this.shelfAt(name);
    return pane.add(m, desk, actor);
  }
  async shelvePostIt(p: PostIt, desk: DeskApi, shelf: string, actor: Actor) {
    const d = desk as Desk, name = d.nameOfPane(p);
    const why = d.tileNow(name, actor).refused("close");
    if (why) throw new ActionRefused(why);
    if (!p.msg) throw new ActionRefused("this post-it is empty · hover a note first");
    const done = await this.shelve(p.msg, shelf, actor);
    const entered = this.host.glassHasKeys(d.tileInfo(name).tile);
    d.closeTile(name, actor);
    if (entered) this.host.restoreGlassKeys();
    return done;
  }
  dismiss(actor: Actor) {
    this.cancelOpen(); this.cancelClose();
    const current = this.current() ?? this.floats().find(f => this.host.glassHasKeys(f.tile) && f.pane instanceof PostIt) ?? this.floats().findLast(f => f.pane instanceof PostIt);
    if (current) {
      const why = this.host.made!.tileNow(current.tile, actor).refused("close");
      if (why) return { closed: false, kept: why };
      this.size = { cols: current.rect.cols, rows: current.rect.rows }; this.save();
      this.host.made!.closeTile(current.tile, actor);
      if (this.host.glassHasKeys(current.tile)) this.host.restoreGlassKeys();
    }
    this.target = ""; this.source = null; this.app.redraw(); return { closed: !!current };
  }
  clear(actor: Actor) {
    this.cancelOpen(); this.cancelClose();
    const { kept } = this.layer.clear(actor);
    this.target = ""; this.source = null; return { ...this.describe(), tiles: this.layer.describe().tiles, kept };
  }
  key(k: Key): boolean {
    const bound = effective(GLASS_KEYS).find(b => b.key === keyName(k));
    if (bound && !this.app.person().program) { void this.app.dispatch.press(bound.action); return true; }
    const current = this.current() ?? this.floats().findLast(f => f.pane instanceof PostIt);
    if (k.kind === "esc" && current && !this.host.made?.holdsKeys() && (this.host.glassHasKeys() || !this.app.person().typingIn)) { void this.app.dispatch.press("glass.dismiss"); return true; }
    if (k.kind === "mouse" && (k.action === "wheel-up" || k.action === "wheel-down")) {
      const f = this.floats().findLast(f => f.pane instanceof PostIt && k.y === f.rect.row && k.x >= f.rect.col && k.x < f.rect.col + f.rect.cols);
      if (f) { void this.host.made!.dispatch.press("postit.flip", { by: k.action === "wheel-up" ? -1 : 1 }, f.tile); return true; }
    }
    return false;
  }
}

export const GLASS_ACTIONS = actionSet<Glass>()("glass", {
  "glass.mode": def({ summary: "set hover off, on or sticky, where on closes after the pointer leaves and sticky keeps each hover as a post-it until dismissed", touches: "nothing", replay: "safe", confirms: true, args: { set: { type: "string", choices: Object.keys(GLASS_MODES), about: "hover mode" } },
    examples: [{ act: "glass.mode set=sticky", does: "keeps every hover as a post-it until dismissed" }, { act: "glass.mode set=off", does: "stops hovers from peeking" }], says: r => GLASS_MODES[r.mode as GlassMode], run: ({ set }, glass, actor) => glass.set(set as GlassMode, actor) }),
  "glass.toggle": def({ summary: "cycle hover off → on → sticky → off, saying the new mode", keys: "alt+u, click the ◇ status glyph", touches: "nothing", replay: "safe", confirms: true, args: {}, says: r => GLASS_MODES[r.mode as GlassMode], run: (_, glass, actor) => glass.set(glass.mode === "off" ? "on" : glass.mode === "on" ? "sticky" : "off", actor) }),
  "glass.pin": def({ summary: "put a note reference or text in a sticky post-it, or on a shelf, without taking focus", touches: "nothing", replay: "safe", args: { ref: { type: "string", about: "a note reference, or text to keep" }, shelf: { type: "string", optional: true, kind: "tile", about: "a shelf's name or id" } },
    examples: [{ act: "glass.pin ref=7d9a1f40", does: "pins that note as a sticky post-it on the glass" }, { act: 'glass.pin ref="water the beans" shelf=chores', does: "keeps those words on the chores shelf" }], says: (r, a) => `pinned ${r.name ?? "a post-it"}${a.shelf ? " on the shelf" : " on the glass"}`, run: ({ ref, shelf }, glass, actor) => glass.pin(ref, actor, shelf) }),
  "glass.shelf": def({ summary: "make a named, coloured shelf on the glass; drag post-its onto it or glass.shelve ref= shelf=", touches: "nothing", replay: "safe", args: { name: { type: "string", about: "the shelf's name" }, colour: { type: "string", optional: true, choices: Object.keys(TONE_INDEX), about: "header colour; amber by default" } },
    examples: [{ act: "glass.shelf name=chores colour=green", does: "makes a green shelf called chores on the glass" }], says: r => `made shelf ${r.name}`, run: ({ name, colour }, glass, actor) => glass.shelf(name, (colour ?? "amber") as ShelfColour, actor) }),
  "glass.shelve": def({ summary: "put a reference on a shelf without taking focus or moving a post-it", touches: "nothing", replay: "safe", args: { ref: { type: "string", about: "a note reference or text" }, shelf: { type: "string", kind: "tile", about: "the shelf's name or id" } },
    examples: [{ act: "glass.shelve ref=7d9a1f40 shelf=chores", does: "puts that note on the chores shelf, the focus where it was" }], says: r => `shelved on ${r.name}`, run: ({ ref, shelf }, glass, actor) => glass.pin(ref, actor, shelf) }),
  "glass.dismiss": def({ summary: "dismiss the hover post-it and return its keys", keys: "esc, click ×", touches: "nothing", replay: "safe", args: {}, run: (_, glass, actor) => glass.dismiss(actor) }),
  "glass.clear": def({ summary: "clear the glass: close its floats, keeping any tile the person is working in when an agent asks", keys: "alt+U, alt-click the ◇ status glyph", touches: "nothing", replay: "safe", args: {}, says: r => `cleared the glass${r.kept.length ? ` · kept ${r.kept.map((k: { why: string }) => k.why).join("; ")}` : ""}`, run: (_, glass, actor) => glass.clear(actor) }),
  "glass.tune": def({ keys: [{ via: "Tune → Glass (G): + − and its [+] [−] buttons" }], summary: "read or change the glass's delays, hover stack length and pinned soft limit; also in Tune's Glass section", touches: "nothing", replay: "safe", args: { name: { type: "string", optional: true, choices: Object.keys(GLASS_SETTINGS), about: "setting" }, value: { type: "number", optional: true, about: "new value" } },
    examples: [{ act: "glass.tune", does: "reads every delay and limit as it is", safe: true }, { act: "glass.tune name=open value=150", does: "opens a hover 150 ms after the pointer rests" }], run: ({ name, value }, glass) => name !== undefined && value !== undefined ? glass.tune(name as GlassSetting, value) : glass.describe() }),
});

/** The module the `glass` extension's manifest names (`"door": "glass"`): what starts when it's served, and goes when it isn't. */
export const GLASS_MODULE: DoorModule = {
  id: "glass",
  activate(app: App): ActiveModule {
    const g = new Glass(app);
    current = g;
    const kinds = [POST_IT_KIND, SHELF_KIND].filter(k => !tileKind(k.kind));
    for (const k of kinds) registerTileKind(k);
    // A post-it or shelf a layout saved while the glass was off is made as its kind now (and goes when it stops).
    if (kinds.length) kindsChanged();
    const stops = [
      app.hover.subscribe({ moved: m => g.moved(m), pressed: () => g.pressed() }),
      registerStatusChip({ id: "glass", text: () => g.chip(), tiny: () => g.tiny(), click: "glass.toggle", alt: "glass.clear", keep: true }),
      registerTuneSection({ id: "glass", label: "Glass", key: "G", settings: GLASS_SETTINGS, value: n => g.settings[n as GlassSetting], tune: "glass.tune" }),
      app.dispatch.add({ set: GLASS_ACTIONS, takes: "none", on: () => g }),
    ];
    app.redraw();
    return {
      dispose() {
        for (const stop of stops) stop();
        for (const k of kinds) unregisterTileKind(k.kind, "the glass extension is off here: ep0ch act extensions.install id=glass turns it on");
        if (kinds.length) kindsChanged();
        g.dispose();
        if (current === g) current = null;
        app.redraw();
      },
      key: k => g.key(k),
      painted: () => g.painted(),
      describe: () => g.describe(),
    };
  },
};
