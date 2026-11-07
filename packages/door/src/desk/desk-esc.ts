// The desk's rung of Esc (esc-rule.ts): what's open on it at each step of DESK_ESC and DESK_HOME_ESC, in the hint's words, and how
// it closes. Part of the Desk, kept apart for its size: `DeskEscHost` lists the desk's own state and steps these read.
import type { Ctx } from "../app";
import { DESK_ESC, DESK_HOME_ESC, ESC_KEY, ESC_TAKEN, escPress, type EscRead, type EscRung, type EscSteps } from "../esc-rule";
import type { Key } from "../term";
import { chainOf, docks, dockOf, leaves, type Dock } from "./layout";
import { peekSource, policyOfNode } from "./screen-layout";
import { kindOf } from "./tile-kinds";
import { sessionName, type Pane, type ReaderPane } from "./panes";

/** The desk as these steps read it. */
export interface DeskEscHost {
  ctx: Ctx; layout: any; root: any; spec: any; focus: number; zoom: number | null; moving: unknown; prefix: string; pending: any; hintCard: unknown; xray: boolean; modeHintKey: string; gesture: unknown; dragging: unknown; floatDrag: unknown; linking: any; entered: { in(r: ReaderPane): boolean }; overlays: any; models: Map<unknown, any>; panes: Map<number, Pane>; liftedRect: unknown;
  run(name: string, args?: Record<string, unknown>, tile?: string): void; nameOf(id: number): string; redraw(): void; rawKeys(): boolean; holdsKeys(): boolean; keysHere(): boolean; focusedReader(): ReaderPane | null; choosingReader(): ReaderPane | undefined; boundKey(k: Key): boolean; keyIn(k: Key, ctx: Ctx): void; command(k: Key): void; endGroupGhost(): void; runningScripts(): unknown[]; contentCover(id: number): { fold?: unknown }; pickedBy(a: unknown): unknown[]; homeTile(): number | undefined; atHome(): boolean; settle(): void; render(ctx: Ctx): unknown; reenter(): void; afterKey(): void; dropLiftElsewhere(): void; key(k: Key, ctx: Ctx): void; escReadFront(): EscRead; screenKeys(): { key: string }[];
}
const USER = { kind: "user" } as const;
export type DeskEscName = (typeof DESK_ESC)[number] | (typeof DESK_HOME_ESC)[number];

export function deskEscSteps(d: DeskEscHost): EscSteps<DeskEscName> {
    const ctx = d.ctx, focused = d.focusedReader(), pane = d.panes.get(d.focus);
    const step = (closes: string, name: string, args: Record<string, unknown>, tile: string): EscRung => ({ closes, run: () => { d.run(name, args, tile); return true; } });
    const shuts = (k: Dock<any> | null) => !!k?.open && k.policy?.overlay !== false && policyOfNode(d.layout, k).collapsible;
    const say = (closes: string | typeof ESC_TAKEN | null | undefined, run: () => boolean | void): EscRung | null => (closes === null ? null : closes === ESC_TAKEN ? { closes: null, run } : { closes: closes ?? null, maybe: true, run });
    return {
      // The person's own edit or comment is still opening: it's cancelled, and nothing else is.
      opening: () => (d.pending && d.pending.pane === focused && !d.overlays.top() ? { closes: "the opening", run: () => { d.pending = null; ctx.flash("not opened"); d.redraw(); } } : null),
      // A card a mode raised goes with that mode; only one of its own (`?` on a frame, an agent's) or x-ray is a rung.
      card: () => ((d.hintCard && !d.modeHintKey) || d.xray ? { closes: d.xray ? "x-ray" : "the hint card", run: () => { d.run("hint.dismiss"); return true; } } : null),
      overlay: () => { const o = d.overlays.top(); return o ? { closes: o.escCloses?.() ?? "the picker", run: () => { d.overlays.key(ESC_KEY, d as never); d.redraw(); } } : null; },
      model: () => (d.overlays.top() ? null : { closes: [...d.models.values()].map(m => m.escCloses?.() ?? null).find(Boolean) ?? null, maybe: true, run: () => [...d.models.values()].some(m => m.key?.(ESC_KEY)) }),
      // The screen's key map gave Esc an action: it runs, and closes nothing the hint can name.
      bound: () => (d.spec.keys?.length && !d.holdsKeys() && !d.linking && d.screenKeys().some((b: { key: string }) => b.key === "esc") ? { closes: null, run: () => d.boundKey(ESC_KEY) } : null),
      link: () => {
        const l = d.linking;
        if (!l) return null;
        const tile = l.desk.nameOf(l.from);
        return l.pick ? step("the pick", "tile.pick", { then: l.pick.then, prompt: l.pick.prompt, cancel: true }, tile) : { closes: "link mode", run: () => { l.desk.run("tile.link", { ask: false }, tile); return true; } };
      },
      // Typing in a terminal, Esc is the program's; one that exited waits on its own keys.
      program: () => (d.rawKeys() ? { closes: null, run: () => { d.keyIn(ESC_KEY, ctx); return true; } } : null),
      // A group, a board or a river tile holding the keys in its own edit, comment or panel; a chord for its window goes first.
      "held-tile": () => {
        const kind = pane && kindOf(pane);
        const said = pane?.escCloses?.(d as never);
        return pane && kind?.takesKeys?.(pane) && !(kind.windowKeys && d.prefix) ? { closes: typeof said === "string" ? said : null, run: () => { pane.key(ESC_KEY, d as never); return true; } } : null;
      },
      drag: () => (d.dragging ? { closes: "the move", run: () => { d.gesture = null; d.endGroupGhost(); ctx.flash("not moved"); d.redraw(); } } : null),
      choosing: () => { const c = d.choosingReader(); return c ? { closes: "the status choice", run: () => { c.key(ESC_KEY, d as never); d.redraw(); } } : null; },
      chord: () => {
        if (!d.prefix) return null;
        const held = focused?.holdsKeys && d.entered.in(focused) && d.prefix === "wm";
        return { closes: d.prefix === "resize" ? "resizing" : "the ^W chord", run: () => { if (held) { d.prefix = ""; ctx.flash(`still in ${sessionName(focused!)}`); d.redraw(); } else d.command(ESC_KEY); } };
      },
      "in-reader": () => (focused?.holdsKeys && d.entered.in(focused) ? { closes: focused.escCloses(d as never), run: () => { focused.key(ESC_KEY, d as never); return true; } } : null),
      script: () => (d.runningScripts().length && !d.holdsKeys() && !d.floatDrag ? { closes: "the script", run: () => { d.run("layout.stop"); return true; } } : null),
      // The tile's own: a filter being typed, what's lit in a reader, a keys window; a kind's own key. One that says nothing is still asked.
      tile: () => {
        if (!pane || focused?.holdsKeys || d.contentCover(d.focus).fold) return null;
        return say(pane.escCloses?.(d as never), () => {
          const pressed = !d.holdsKeys() ? kindOf(pane)?.press?.(pane, ESC_KEY) : null;
          if (pressed) { d.run(pressed.action, pressed.args ?? {}, d.nameOf(d.focus)); return true; }
          return pane.key(ESC_KEY, d as never);
        });
      },
      lift: () => (d.layout.lift ? step("the lift", "tile.zoom", { on: false, reach: d.layout.lift.reach }, d.nameOf(d.layout.lift.tile)) : null),
      zoom: () => (d.zoom !== null ? step("the zoom", "tile.zoom", { on: false }, d.nameOf(d.zoom)) : null),
      peek: () => (peekSource(d.layout, d.focus) !== undefined ? step("the peek", "tile.close", {}, d.nameOf(d.focus)) : null),
      picked: () => (d.pickedBy(USER).length ? step("the picked tiles", "tile.select", { clear: true }, d.nameOf(d.focus)) : null),
      dock: () => {
        const k = dockOf<any>(d.root, d.focus);
        return shuts(k) ? (chainOf(d.root, d.focus).some(c => c.policy?.shuts) ? step("the dock", "tile.close", {}, d.nameOf(d.focus)) : step("the dock", "tile.slide", { open: false }, d.nameOf(d.focus))) : null;
      },
      "keys-home": () => { const home = d.homeTile(); return home !== undefined && !d.atHome() ? step("the keys back home", "tile.focus", {}, d.nameOf(home)) : null; },
      "sliding-dock": () => {
        const open = d.spec.home !== undefined ? docks<any>(d.root).find(x => shuts(x) && leaves(x.kid).length) : undefined;
        return open ? step("the dock", "tile.slide", { open: false, container: open.id }, d.nameOf(leaves<any>(open.kid)[0]!)) : null;
      },
    };
}

/** The key on this desk: what any key does first, then the first rung open. */
export function deskEscFront(d: DeskEscHost): boolean {
  // An edit opening anywhere the key isn't going is let go, as any key lets it go; a key first settles a transition in flight (PIE-958).
  const p = d.pending, overlay = !!d.overlays.top();
  if (p && (p.kind === "edit" || p.kind === "external") && (overlay || p.pane !== d.focusedReader())) d.pending = null;
  if (d.moving) { d.settle(); d.render(d.ctx); }
  if (!overlay) d.reenter();
  const took = escPress(DESK_ESC, deskEscSteps(d));
  if (took) d.afterKey();
  return took;
}

/** Esc with a tile lifted over the screen (App's `lift` step): the keys in it, its own ladder; elsewhere the lift drops and the key goes on. */
export function deskLiftEsc(d: DeskEscHost): EscRung | null {
  const lift = d.layout.lift;
  if (!lift || !d.liftedRect) return null;
  if (d.keysHere() && d.focus === lift.tile) { const read = d.escReadFront(); return { closes: typeof read === "string" ? read : null, run: () => { d.key(ESC_KEY, d.ctx); return true; } }; }
  return { closes: null, maybe: true, run: () => { d.dropLiftElsewhere(); return false; } };
}
