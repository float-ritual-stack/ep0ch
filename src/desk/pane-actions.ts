// Pane operations as actions (PIE-412): split, close, resize, zoom, float and pin, by the same names on
// every view built on the layout tree (src/desk/layout.ts). A view's keys and clicks call the same methods.
// An agent's is said on screen, and it never takes the person's pane: closing, floating or zooming away
// the pane that has their keys is refused.
import type { Actor } from "../socket";
import { ActionRefused, ActionSet, agentLabel } from "../surface/actions";
import type { Axis } from "./layout";
import { kindNoun } from "./tile-kinds";

/** What a pane operation did: the pane's name as `peek` shows it, and anything else worth saying. */
export interface PaneDone { pane: string; [k: string]: unknown }

/** A view on the layout tree. Each refuses, with the reason, what it doesn't have. `sel` names a pane as `peek` does. */
export interface PaneHost {
  ctx: { flash(msg: string): void };
  splitPane(sel: string | undefined, kind: string | undefined, dir: Axis | undefined, actor: Actor): PaneDone | Promise<PaneDone>;
  closePane(sel: string | undefined, actor: Actor): PaneDone;
  resizePane(sel: string | undefined, axis: Axis, by: number, actor: Actor): PaneDone;
  zoomPane(sel: string | undefined, on: boolean | undefined, actor: Actor): PaneDone;
  floatPane(sel: string | undefined, actor: Actor): PaneDone;
  pinPane(sel: string | undefined, on: boolean | undefined, actor: Actor): PaneDone;
}

interface On { h: PaneHost; reader?: string }

const axisOf = (s: string | undefined, action: string): Axis | undefined => {
  if (s === undefined) return undefined;
  if (s === "row" || s === "col") return s;
  throw new ActionRefused(`${action}: axis is row (across) or col (down), not ${s}`);
};
/** An agent's change, said on screen with who made it; the person's own isn't (they see it happen). */
const say = (h: PaneHost, actor: Actor, what: string) => { if (actor.kind === "agent") h.ctx.flash(`${agentLabel(actor)} ${what}`); };
/** Said on screen only when something changed (a pin already in place isn't news). */
const sayIf = (h: PaneHost, actor: Actor, r: PaneDone, what: string) => { if (r.changed !== false) say(h, actor, what); };

export const PANE_ACTIONS = new ActionSet<{
  "pane.split": { kind?: string; dir?: string };
  "pane.close": Record<string, never>;
  "pane.resize": { by: number; axis?: string };
  "pane.zoom": { on?: boolean };
  "pane.float": Record<string, never>;
  "pane.pin": { on?: boolean };
}, On>("pane", {
  "pane.split": {
    summary: "open a pane beside reader=<pane> (default the focused one): kind=reader, tree, thread, activity, who or art, dir=row or col. The person's focus stays where it is. The board's details open with a note: open reader=new-detail",
    keys: "desk ^W o <kind>; board alt+⏎",
    args: { kind: { type: "string", optional: true, about: "what the new pane shows (desk: reader, tree, thread, activity, who, art)" }, dir: { type: "string", optional: true, about: "row (beside) or col (below); default along the longer side" } },
    async run({ kind, dir }, { h, reader }, actor) {
      const r = await h.splitPane(reader, kind, axisOf(dir, "pane.split"), actor);
      say(h, actor, `opened ${kindNoun(kind ?? "reader")}${r.pane.replace(/-\d+$/, "") === (kind ?? "reader") ? "" : ` (${r.pane})`}`);
      return r;
    },
  },
  "pane.close": {
    summary: "close reader=<pane>: a detail or a float on the board, a drawer that slides over, a desk pane. Refused while it holds an edit or a comment, and to an agent for the pane that has the person's keys",
    keys: "board x, esc q on a drawer; desk ^W x",
    args: {},
    run(_, { h, reader }, actor) {
      const r = h.closePane(reader, actor);
      say(h, actor, `closed ${r.pane}`);
      return r;
    },
  },
  "pane.resize": {
    summary: "grow (by>0) or shrink (by<0) reader=<pane> by steps along axis=row (width, default) or col (height), as its keys do; lanes=the board's lanes",
    keys: "board { } < >, drag a border; desk ^W < > + -, drag a border",
    args: { by: { type: "number", about: "steps: +1 grows it by one key press, -2 shrinks it by two" }, axis: { type: "string", optional: true, about: "row (width, default) or col (height)" } },
    run({ by, axis }, { h, reader }, actor) {
      if (!Number.isInteger(by) || by === 0 || Math.abs(by) > 20) throw new ActionRefused("pane.resize: by is a whole number of steps, -20 to 20, not 0");
      const r = h.resizePane(reader, axisOf(axis, "pane.resize") ?? "row", by, actor);
      say(h, actor, `${by > 0 ? "grew" : "shrank"} ${r.pane}`);
      return r;
    },
  },
  "pane.zoom": {
    summary: "zoom reader=<pane> to fill the view (on=false, or again, unzooms). An agent zooms only the pane that has the person's keys, never one that would hide it",
    keys: "desk ^W z",
    args: { on: { type: "boolean", optional: true, about: "true zooms, false unzooms; default toggles" } },
    run({ on }, { h, reader }, actor) {
      const r = h.zoomPane(reader, on, actor);
      say(h, actor, `${r.zoomed ? "zoomed" : "unzoomed"} ${r.pane}`);
      return r;
    },
  },
  "pane.float": {
    summary: "pop tile reader=<pane> out of the layout as a float over everything (its own rectangle; the board floats a copy of its preview), or dock a float back (on the board, as a detail). Refused where policy keeps the tile in place, and to an agent for the tile that has the person's keys",
    keys: "board o; desk ^W f; a click on a float's ⧉ docks it",
    args: {},
    run(_, { h, reader }, actor) {
      const r = h.floatPane(reader, actor);
      say(h, actor, `${r.floated ? "popped out" : "docked"} ${r.pane}`);
      return r;
    },
  },
  "pane.pin": {
    summary: "dock the drawer holding reader=<pane> into the layout (on=true), or put the pane back in a drawer to slide over again (on=false); default toggles. On the board reader=tree and reader=backlinks are its outline and backlinks drawers, each a whole container (the list and its preview)",
    keys: "board T, B; a click on a header's ⇤ drawer docks it",
    args: { on: { type: "boolean", optional: true, about: "true pins, false unpins; default toggles" } },
    run({ on }, { h, reader }, actor) {
      const r = h.pinPane(reader, on, actor);
      sayIf(h, actor, r, `${r.pinned ? "pinned" : "unpinned"} ${r.pane}`);
      return r;
    },
  },
});
