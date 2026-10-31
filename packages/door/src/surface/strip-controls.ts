import { Canvas } from "../canvas";
import type { Actor } from "../socket";
import { visible } from "../style";
import type { Key } from "../term";
import { ActionRefused, actionSet, def, type ActRequest } from "./actions";
import { modeBinding } from "./modes";
import { keyTable } from "./keymap";
import { centred, ListPicker, pickRows } from "./picker";
import { StripState } from "./strip-state";
import type { Overflow } from "../overflow";

export const STRIP_KEYS = keyTable("strip", "a strip's choices", [
  ...["left", "[", "up"].map(key => ({ key, action: "strip.scroll", args: { by: -1 }, label: "move", says: "move to the previous strip segment" })),
  ...["right", "]", "down"].map(key => ({ key, action: "strip.scroll", args: { by: 1 }, label: "move", says: "move to the next strip segment" })),
  { key: "enter", action: "strip.pick", label: "choose" },
  { key: "alt+/", action: "strip.more", label: "all choices" },
  { key: "esc", action: "strip.close", label: "back", says: "return keys to the tile" },
  ...[..."1234567890"].map((key, i) => ({ key, action: "strip.pick", args: { n: i + 1 }, label: "jump", says: `choose strip segment ${i + 1}` })),
]);

interface StripHost {
  press(action: string, args?: Record<string, unknown>, tile?: string): Promise<unknown>;
  act(req: ActRequest, actor: Actor): Promise<unknown>;
  focused(): { tile?: string; strip?: string };
  redraw(): void;
}
export class StripControls {
  readonly state = new StripState();
  private picker?: ListPicker<number, unknown>;
  get engaged() { return !!this.state.active; }
  constructor(private host: StripHost) {}
  private row(id?: string, tile?: string) {
    const focus = this.host.focused(), row = this.state.get(id ?? focus.strip, tile ?? focus.tile);
    if (!row) throw new ActionRefused("no strip here; point at a strip or name strip=tabs, breadcrumb, status or docks-down");
    return row;
  }
  more(id: string | undefined, actor: Actor, tile?: string) {
    const row = this.row(id, tile), rows = row.tabs.map((t, i) => ({ n: i + 1, label: visible(t.label), current: !!t.on, ...t.hit }));
    if (actor.kind === "user") {
      this.state.active = row.id;
      this.picker = new ListPicker({ name: "strip", items: () => row.tabs.map((_, i) => i),
        row: (i, _n, on, w) => pickRows(`${row.tabs[i]!.on ? "●" : " "} ${i + 1} ${visible(row.tabs[i]!.label)}`, on, w),
        choose: i => { void this.host.press("strip.pick", { strip: row.id, n: i + 1 }); },
        bindings: STRIP_KEYS, dispatch: binding => { void this.host.press(binding.action, { ...binding.args, strip: row.id }); },
        frame: (area, n) => ({ rect: centred(area, Math.min(64, area.cols), Math.min(n + 2, area.rows)), title: "all choices" }),
      });
      this.picker.sel = row.cursor;
      this.host.redraw();
    }
    return { strip: row.id, rows };
  }
  scroll(id: string | undefined, by: number, actor: Actor, tile?: string) {
    const row = this.row(id, tile), answer = this.state.move(row, by, actor.kind === "user");
    if (this.picker && actor.kind === "user") this.picker.sel = row.cursor;
    this.host.redraw(); return answer;
  }
  async pick(id: string | undefined, n: number | undefined, actor: Actor, tile?: string, alt = false) {
    const row = this.row(id, tile), i = n === undefined ? row.cursor : n - 1;
    const req = this.state.target({ id: row.id, n: i }, alt);
    if (!row.tabs[i]) throw new ActionRefused(`this strip has no choice ${i + 1}`);
    if (actor.kind === "user") this.close();
    return req ? this.host.act(req, actor) : { label: visible(row.tabs[i]!.label) };
  }
  close() { this.state.active = undefined; this.picker = undefined; this.host.redraw(); return { closed: true }; }
  input(k: Key, overflow: Overflow, typing = false): boolean {
    if (this.picker) {
      if (k.kind === "mouse") {
        if (k.action.startsWith("wheel")) { void this.host.press("strip.scroll", { by: k.action.endsWith("up") || k.action.endsWith("left") ? -1 : 1 }); return true; }
        if (k.action === "down") {
          const box = this.picker.drawn(), n = box && k.x > box.col && k.x < box.col + box.cols - 1 ? this.picker.itemAt(k.y) : null;
          void this.host.press(n === null ? "strip.close" : "strip.pick", n === null ? {} : { n: n + 1 });
        }
        return true;
      }
      const binding = modeBinding(STRIP_KEYS, k);
      if (binding) void this.host.press(binding.action, binding.args);
      return true;
    }
    if (k.kind === "mouse") {
      const hit = overflow.stripAt(k.x, k.y), row = hit && this.state.rows.get(hit.id);
      if (!hit || !row) { if (k.action === "down") this.state.active = undefined; return false; }
      if (k.action.startsWith("wheel")) {
        void this.host.press("strip.scroll", { strip: row.id, by: k.action.endsWith("up") || k.action.endsWith("left") ? -1 : 1 }); return true;
      }
      if (k.action === "down" && (hit.n < 0 || row.direct && row.tabs[hit.n]?.hit)) {
        const req = hit.n < 0 ? this.state.target(hit, false) : { action: "strip.pick", args: { strip: row.id, n: hit.n + 1, alt: !!((k.mods ?? 0) & 8) } };
        if (req) void this.host.press(req.action, req.args, req.tile);
        return !!req;
      }
      return false;
    }
    const binding = modeBinding(STRIP_KEYS, k);
    if (binding && (this.engaged || !typing && binding.action === "strip.more")) { void this.host.press(binding.action, binding.args); return true; }
    if (this.engaged) this.close();
    return false;
  }
  draw(lines: string[], cols: number, rows: number): string[] {
    if (!this.picker) return lines;
    const canvas = new Canvas(cols, rows);
    lines.forEach((l, y) => canvas.text(0, y, l));
    this.picker.draw(canvas, { col: 0, row: 0, cols, rows });
    return canvas.lines();
  }
}

const strip = { type: "string" as const, optional: true, about: "the strip's id; tabs, breadcrumb or status, or the id returned by strip.more; left out, the strip under the keys" };
export const STRIP_ACTIONS = actionSet<{ strips: StripControls; tile?: string }>()("strip", {
  "strip.more": def({ summary: "list every segment in the strip; the person's +N or alt+/ opens the picker", keys: "alt+/; click +N", touches: "nothing", replay: "safe", args: { strip }, run({ strip }, { strips, tile }, actor) { return strips.more(strip, actor, tile); } }),
  "strip.scroll": def({ summary: "scroll a strip sideways, keeping its current name; arrows and the wheel move its cursor", keys: "left right up down [ ]; wheel; click ‹ ›", touches: "nothing", replay: "safe", args: { strip, by: { type: "number", about: "segments to move, negative for left" } }, run({ strip, by }, { strips, tile }, actor) { return strips.scroll(strip, by, actor, tile); } }),
  "strip.pick": def({ summary: "choose the strip's cursor or numbered segment through its own action", keys: "enter; 1-9 0; click; alt+click", touches: "nothing", replay: "safe", args: { strip, n: { type: "number", optional: true, about: "segment number, from 1" }, alt: { type: "boolean", optional: true, about: "the segment's alternate action, as Alt-click" } }, run({ strip, n, alt }, { strips, tile }, actor) { return strips.pick(strip, n, actor, tile, alt); } }),
  "strip.close": def({ summary: "return keys from the strip to the tile", keys: "esc", touches: "nothing", replay: "safe", args: {}, run(_, { strips }, actor) { return actor.kind === "user" ? strips.close() : { closed: false }; } }),
});
