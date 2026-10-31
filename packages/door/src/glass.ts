import type { App } from "./app";
import type { Msg } from "./board";
import type { Rect } from "./canvas";
import type { AgentDrawer } from "./drawer";
import { Desk } from "./desk/desk";
import { makeTile } from "./desk/tiles";
import { readNote, readTarget } from "./desk/outline-boards";
import { PostIt } from "./desk/post-it";
import { keepOnScreen } from "./desk/screen-layout";
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
const textNote = (text: string): Msg => ({ id: `glass:${text}`, text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, properties: [] });

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
    const f = this.floats().find(f => f.pane === this.hover || f.pane instanceof PostIt && f.pane.hover);
    if (f && f.pane instanceof PostIt && this.hover !== f.pane) this.watch(f.pane);
    return f;
  }
  private watch(p: PostIt) {
    this.hover = p;
    p.dismissed = () => { if (p.msg) this.saved = { msg: p.msg, nav: p.surface.saveNav() }; this.target = ""; this.source = null; this.save(); };
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
    if (key === this.target) { this.source = (hit ?? cut)!.rect; this.cancelClose(); return; }
    const m = hit?.target ? await readTarget(this.app, hit.target) : text ? textNote(text) : null;
    if (!m || generation !== this.generation) return;
    this.target = key; this.source = (hit ?? cut)!.rect;
    this.cancelClose();
    if (hit && await hit.desk.hoverInto(hit.tile, m)) return;
    this.show(m, USER, true, point.alt || this.mode === "sticky", over?.pane instanceof PostIt ? over.pane : undefined);
  }
  private rectangle() {
    const { cols, rows } = this.app.terminalSize, p = this.pointer ?? { x: 0, y: 0 };
    const size = { cols: Math.min(cols, this.size.cols), rows: Math.min(rows - 2, this.size.rows) };
    return keepOnScreen({ ...size, col: p.x < cols / 2 ? cols - size.cols - 1 : 1, row: p.y < rows / 2 ? rows - size.rows - 2 : 1 }, { col: 0, row: 0, cols, rows: rows - 1 });
  }
  private show(m: Msg, actor: Actor, hover: boolean, sticky: boolean, into?: PostIt) {
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
    const done = d.bringIn({ pane: p, name: hover ? "hover" : "post-it", spec: { t: "leaf", kind: "post-it" }, from: "glass", typing: false }, undefined, undefined, actor, this.rectangle());
    if (hover) this.watch(p);
    d.save(); this.app.redraw(); return done;
  }
  async pin(ref: string, actor: Actor) {
    const m = await readNote(this.app, ref) ?? textNote(ref);
    return this.show(m, actor, false, true);
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
  "glass.pin": def({ summary: "put a note reference or text in a sticky post-it above every screen, without taking focus", touches: "nothing", replay: "safe", args: { ref: { type: "string", about: "a note reference, or text to keep" } }, says: r => `pinned ${r.name ?? "a post-it"} on the glass`, run: ({ ref }, glass, actor) => glass.pin(ref, actor) }),
  "glass.dismiss": def({ summary: "dismiss the hover post-it and return its keys", keys: "esc, click ×", touches: "nothing", replay: "safe", args: {}, run: (_, glass, actor) => glass.dismiss(actor) }),
  "glass.clear": def({ summary: "clear the glass: close its floats, keeping any tile the person is working in when an agent asks", keys: "alt+U, alt-click the ◇ status glyph", touches: "nothing", replay: "safe", args: {}, says: r => `cleared the glass${r.kept.length ? ` · kept ${r.kept.map((k: { why: string }) => k.why).join("; ")}` : ""}`, run: (_, glass, actor) => glass.clear(actor) }),
  "glass.tune": def({ keys: "+ - = h l left right (Tune Glass), click", summary: "read or change the glass's delays, hover stack length and pinned soft limit; also in Tune's Glass section", touches: "nothing", replay: "safe", args: { name: { type: "string", optional: true, choices: Object.keys(GLASS_SETTINGS), about: "setting" }, value: { type: "number", optional: true, about: "new value" } }, run: ({ name, value }, glass) => name !== undefined && value !== undefined ? glass.tune(name as GlassSetting, value) : glass.describe() }),
});
