import type { App, Screen } from "./app";
import type { Msg } from "./board";
import type { Rect } from "./canvas";
import type { AgentDrawer } from "./drawer";
import { Desk } from "./desk/desk";
import { makeTile } from "./desk/tiles";
import { readTarget } from "./desk/outline-boards";
import { PostIt, textNote, readPostIt } from "./desk/post-it";
import { Shelf, type ShelfColour } from "./desk/shelf";
import type { DeskApi } from "./desk/panes";
import { TONE_INDEX } from "./theme";
import type { TileDone } from "./desk/tile-actions";
import { keepOnScreen, type Dir } from "./desk/screen-layout";
import { USER, type Actor } from "./socket";
import { actionSet, def, ActionRefused, keyName } from "./surface/actions";
import { type ModeKey } from "./surface/modes";
import { effective, keyTable } from "./surface/keymap";
import { outlineState, readState, writeState } from "./state";
import type { Key } from "./term";

export type GlassMode = "off" | "on" | "sticky";
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
type Point = { x: number; y: number; alt: boolean };
const inside = (p: Point, r: Rect) => p.x >= r.col && p.x < r.col + r.cols && p.y >= r.row && p.y < r.row + r.rows;
const distance = (p: Point, r: Rect) => Math.hypot(Math.max(r.col - p.x, 0, p.x - r.col - r.cols), Math.max(r.row - p.y, 0, p.y - r.row - r.rows));

/** Timing and gestures only. Tiles, their rectangles and their order belong to the host desk's LayoutState. */
export class Glass {
  mode: GlassMode = "off";
  settings: Record<GlassSetting, number> = Object.fromEntries(Object.entries(GLASS_SETTINGS).map(([k, v]) => [k, v.base])) as Record<GlassSetting, number>;
  private size = { cols: 56, rows: 16 };
  private pointer: Point | null = null;
  private source: Rect | null = null;
  private target = "";
  private opening: ReturnType<typeof setTimeout> | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;
  private closeAt = 0;
  private generation = 0;
  private hover: PostIt | null = null;
  private saved: HoverTrail | null = null;

  constructor(private readonly app: App, private readonly host: AgentDrawer) {
    const saved = readState<{ mode: GlassMode; settings: Record<GlassSetting, number>; size: { cols: number; rows: number }; trail: HoverTrail | null }>("glass.json", outlineState());
    if (saved) { this.mode = saved.mode; this.settings = { ...this.settings, ...saved.settings }; this.size = saved.size; this.saved = saved.trail; }
  }
  private save() { writeState("glass.json", { mode: this.mode, settings: this.settings, size: this.size, trail: this.saved }, outlineState()); }
  floats() { return this.host.made?.floatingTiles() ?? []; }
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
  describe() { return { mode: this.mode, settings: { ...this.settings }, pinned: this.pinnedCount(), tiles: this.floats().map(({ pane: _p, ...f }) => f) }; }
  chip() {
    const count = this.floats().length;
    return `◇ ${this.mode}${count ? ` ${count}${this.pinnedCount() > this.settings.limit ? "!" : ""}` : ""}`;
  }
  set(mode: GlassMode, actor: Actor) {
    this.mode = mode; this.cancelOpen(); this.cancelClose();
    if (mode === "off") this.dismiss(actor);
    this.save(); this.app.redraw(); return this.describe();
  }
  tune(name: GlassSetting, value: number) {
    const setting = GLASS_SETTINGS[name];
    if (!Number.isInteger(value) || value < setting.min) throw new ActionRefused(`${name} is a whole number of at least ${setting.min}`);
    this.settings[name] = value; this.save(); this.app.redraw(); return { name, value };
  }
  private cancelOpen() { if (this.opening) clearTimeout(this.opening); this.opening = null; this.generation++; }
  private cancelClose() { if (this.closing) clearTimeout(this.closing); this.closing = null; this.closeAt = 0; }
  dispose() { this.cancelOpen(); this.cancelClose(); }

  motion(x: number, y: number, alt = false) {
    const point = { x, y, alt }, before = this.pointer;
    this.pointer = point;
    if (before && before.x === x && before.y === y && before.alt === alt) return;
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
    if (this.mode === "off" && !alt || this.source && inside(point, this.source)) return;
    const generation = this.generation;
    this.opening = setTimeout(() => {
      this.opening = null;
      void this.resolve(point, generation).catch(e => this.app.flash((e as Error).message));
    }, this.settings.open);
  }
  private async resolve(point: Point, generation: number) {
    const over = this.floats().findLast(f => inside(point, f.rect));
    const desks = over ? [this.host.made!] : this.host.desks().filter(d => !this.host.isDrawer(d));
    if (!over && this.host.shown && this.host.rect && inside(point, this.host.rect)) desks.unshift(this.host.made!);
    const hit = desks.map(d => d.hoverAt(point.x - d.screenOrigin.col, point.y - d.screenOrigin.row)).find(Boolean);
    const cut = this.app.overflow.targetAt(point.x, point.y), text = hit?.text ?? cut?.text;
    const key = hit?.target ? JSON.stringify(hit.target) : text;
    if (!key) return;
    this.cancelClose();
    if (key === this.target) { this.source = (hit ?? cut)!.rect; return; }
    const m = hit?.target ? await readTarget(this.app, hit.target) : text ? textNote(text) : null;
    if (!m || generation !== this.generation) return;
    this.target = key; this.source = (hit ?? cut)!.rect;
    if (hit && await hit.desk.hoverInto(hit.tile, m)) return;
    this.show(m, USER, true, point.alt || this.mode === "sticky", over?.pane instanceof PostIt ? over.pane : undefined);
  }
  private rectangle(pin = false) {
    const { cols, rows } = this.app.terminalSize, p = this.pointer ?? { x: 0, y: 0 };
    const size = { cols: Math.min(cols, this.size.cols), rows: Math.min(rows - 2, this.size.rows) };
    const n = pin ? this.floats().length : 0;
    return keepOnScreen({ ...size, col: p.x < cols / 2 ? cols - size.cols - 1 - n * 3 : 1 + n * 3, row: p.y < rows / 2 ? rows - size.rows - 2 - n * 2 : 1 + n * 2 }, { col: 0, row: 0, cols, rows: rows - 1 });
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
    const done = d.bringIn({ pane: p, name: hover ? "hover" : "post-it", spec: { t: "leaf", kind: "post-it" }, from: "glass", typing: false }, undefined, undefined, actor, this.rectangle(!hover));
    if (hover) this.watch(p);
    d.save(); this.app.redraw(); return done;
  }
  async pin(ref: string, actor: Actor, shelf?: string) {
    const m = await readPostIt(this.app, ref);
    if (shelf) return this.shelve(m, shelf, actor);
    return this.show(m, actor, false, true);
  }
  peel(p: PostIt, desk: DeskApi, actor: Actor): TileDone {
    if (!this.floats().some(f => f.pane === p)) {
      const done = this.float(desk as Desk, desk.nameOfPane!(p), actor);
      p.hover = false; p.sticky = true; desk.keepLayout?.();
      return done;
    }
    if (!p.msg) throw new ActionRefused("this post-it is empty · hover a note first");
    return this.show(p.msg, actor, false, true);
  }
  shelf(name: string, colour: ShelfColour, actor: Actor) {
    const d = this.host.desk!, p = new Shelf([], "list", colour);
    const done = d.bringIn({ pane: p, name: "shelf", spec: { t: "leaf", kind: "shelf" }, from: "glass", typing: false }, undefined, undefined, actor, this.rectangle(true));
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
  dock(name: string, pin: boolean | undefined, edge: Dir | "other" | undefined, actor: Actor, container?: string): TileDone {
    const landed = this.host.take(name, undefined, undefined, actor);
    return this.host.resolveTile(landed.tile)!.desk.dockTile(landed.tile, pin, edge, actor, container);
  }
  tuck(name: string, actor: Actor): TileDone {
    const done = this.host.made!.floatTile(name, actor, false);
    if (this.host.glassHasKeys(done.tile)) this.host.restoreGlassKeys();
    this.app.redraw(); return { ...done, inDrawer: true };
  }
  menuInput(k: Extract<Key, { kind: "mouse" }>, own: Rect[], behind: Rect[], screen?: Screen): boolean {
    const point = { x: k.x, y: k.y, alt: false };
    if (!this.host.glassHasKeys() && !this.floats().some(f => inside(point, f.rect))) return false;
    const owner = own.some(r => inside(point, r)) ? this.host.made : behind.some(r => inside(point, r)) ? screen : null;
    owner?.key(k, this.app);
    return !!owner;
  }
  dragFloat(k: Extract<Key, { kind: "mouse" }>, screen: Desk | null): boolean {
    const d = this.host.made, moving = d?.draggedFloat();
    if (!d || !moving || k.action !== "drag" && k.action !== "up") return false;
    if (k.action === "drag") d.key(k, this.app);
    const pane = d.pane(moving)!, chip = this.host.chipAt;
    const tuck = !!chip && k.y === chip.row && k.x >= chip.from && k.x < chip.to;
    const target = !d.floatDrop()?.receive && screen ? screen.foreignAt(k.x - screen.screenOrigin.col, k.y - screen.screenOrigin.row, { name: moving, kind: pane.kind, pane }, true) : null;
    if (!target) screen?.cancelDrag();
    if (k.action === "up") {
      if (tuck || target) {
        d.cancelDrag(); screen?.cancelDrag();
        if (target?.refused) this.app.flash(`not moved: ${target.refused}`);
        else if (target?.receive && !tuck) void d.perform(target.receive.action, target.receive.args ?? {}, USER, moving);
        else void d.perform("tile.drawer", tuck ? { on: true } : { on: false, to: target!.to, where: target!.where }, USER, moving);
      } else d.key(k, this.app);
    }
    return true;
  }
  float(from: Desk, name: string, actor: Actor) {
    const d = this.host.desk!;
    if (from === d) return d.floatTile(name, actor, true);
    const heir = from.tileCount() === 1 ? makeTile({ t: "leaf", kind: "blank" }) : undefined;
    const why = from.takeRefusal(name, actor, !!heir);
    if (why) throw new ActionRefused(why);
    const admission = d.bringRefusal({ name, spec: { t: "leaf", kind: from.pane(name)!.kind } }, undefined, undefined, actor, this.rectangle());
    if (admission) throw new ActionRefused(admission);
    const moved = from.takeOut(name, actor, heir);
    const done = d.bringIn(moved, undefined, undefined, actor, this.rectangle());
    this.app.redraw(); return { ...done, floated: true, to: "glass" };
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
    const kept: { tile: string; why: string }[] = [], d = this.host.made;
    for (const f of this.floats()) {
      // Closing a shelf also closes its unentered preview.
      if (!d!.floatingTiles().some(t => t.tile === f.tile)) continue;
      const why = d!.tileNow(f.tile, actor).refused("close");
      if (why) kept.push({ tile: f.tile, why }); else d!.closeTile(f.tile, actor);
    }
    if (!this.floats().some(f => this.host.glassHasKeys(f.tile))) this.host.restoreGlassKeys();
    this.target = ""; this.source = null; this.app.redraw(); return { ...this.describe(), kept };
  }
  key(k: Key): boolean {
    if (k.kind === "mouse" && k.action === "down") { this.pointer = { x: k.x, y: k.y, alt: !!((k.mods ?? 0) & 8) }; this.cancelOpen(); }
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
  "glass.mode": def({ summary: "set hover off, on (closes after leaving), or sticky (stays until dismissed)", touches: "nothing", replay: "safe", args: { set: { type: "string", choices: ["off", "on", "sticky"], about: "hover mode" } }, says: r => `hover ${r.mode}`, run: ({ set }, glass, actor) => glass.set(set as GlassMode, actor) }),
  "glass.toggle": def({ summary: "cycle hover off → on → sticky → off", keys: "alt+u, click the ◇ status glyph", touches: "nothing", replay: "safe", args: {}, says: r => `hover ${r.mode}`, run: (_, glass, actor) => glass.set(glass.mode === "off" ? "on" : glass.mode === "on" ? "sticky" : "off", actor) }),
  "glass.pin": def({ summary: "put a note reference or text in a sticky post-it, or on shelf=, without taking focus", touches: "nothing", replay: "safe", args: { ref: { type: "string", about: "a note reference, or text to keep" }, shelf: { type: "string", optional: true, kind: "tile", about: "a shelf's name or id" } }, says: (r, a) => `pinned ${r.name ?? "a post-it"}${a.shelf ? " on the shelf" : " on the glass"}`, run: ({ ref, shelf }, glass, actor) => glass.pin(ref, actor, shelf) }),
  "glass.shelf": def({ summary: "make a named, coloured shelf on the glass; drag post-its onto it or glass.shelve ref= shelf=", touches: "nothing", replay: "safe", args: { name: { type: "string", about: "the shelf's name" }, colour: { type: "string", optional: true, choices: Object.keys(TONE_INDEX), about: "header colour; amber by default" } }, says: r => `made shelf ${r.name}`, run: ({ name, colour }, glass, actor) => glass.shelf(name, (colour ?? "amber") as ShelfColour, actor) }),
  "glass.shelve": def({ summary: "put a reference on a shelf without taking focus or moving a post-it", touches: "nothing", replay: "safe", args: { ref: { type: "string", about: "a note reference or text" }, shelf: { type: "string", kind: "tile", about: "the shelf's name or id" } }, says: r => `shelved on ${r.name}`, run: ({ ref, shelf }, glass, actor) => glass.pin(ref, actor, shelf) }),
  "glass.dismiss": def({ summary: "dismiss the hover post-it and return its keys", keys: "esc, click ×", touches: "nothing", replay: "safe", args: {}, run: (_, glass, actor) => glass.dismiss(actor) }),
  "glass.clear": def({ summary: "clear the glass: close its floats, keeping any tile the person is working in when an agent asks", keys: "alt+U, alt-click the ◇ status glyph", touches: "nothing", replay: "safe", args: {}, says: r => `cleared the glass${r.kept.length ? ` · kept ${r.kept.map((k: { why: string }) => k.why).join("; ")}` : ""}`, run: (_, glass, actor) => glass.clear(actor) }),
  "glass.tune": def({ keys: "+ - = h l left right (Tune Glass), click", summary: "read or change the glass's delays, hover stack length and pinned soft limit; also in Tune's Glass section", touches: "nothing", replay: "safe", args: { name: { type: "string", optional: true, choices: Object.keys(GLASS_SETTINGS), about: "setting" }, value: { type: "number", optional: true, about: "new value" } }, run: ({ name, value }, glass) => name !== undefined && value !== undefined ? glass.tune(name as GlassSetting, value) : glass.describe() }),
});
