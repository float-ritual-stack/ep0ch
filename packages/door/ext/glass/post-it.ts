import type { Msg } from "../../src/board";
import type { Ctx } from "../../src/app";
import type { Actor } from "../../src/socket";
import type { SurfaceHost } from "../../src/surface/note";
import { actionSet, def } from "../../src/surface/actions";
import { modeHint, type ModeKey } from "../../src/surface/modes";
import { effective, keyTable } from "../../src/surface/keymap";
import { keyName } from "../../src/surface/actions";
import type { Key } from "../../src/term";
import { C, fg } from "../../src/style";
import { rowLines } from "../../src/text";
import { ownPress, READER_ACTIONS, ReaderPane, runOwn, type DeskApi } from "../../src/desk/panes";
import { reading, readerFromSpec, startReader } from "../../src/desk/builtin-tiles";
import type { KindHost, TileKind } from "../../src/desk/tile-kinds";
import { readNote } from "../../src/desk/outline-boards";
import type { TileDone } from "../../src/desk/tile-actions";
import { glass, running } from "./glass";

export const textNote = (text: string): Msg => ({ id: `glass:${text}`, text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, properties: [] });
export const readPostIt = async (ctx: Ctx, ref: string): Promise<Msg> => ref.startsWith("glass:") ? textNote(ref.slice(6)) : await readNote(ctx, ref) ?? textNote(ref);

export const POST_IT_KEYS = keyTable("post-it", "flip a post-it's hover history", [
  { key: "left", action: "postit.flip", args: { by: -1 }, label: "back", says: "flip back to the hover before this one" },
  { key: "p", action: "postit.stick", label: "sticky", says: "keep this post-it until it is dismissed, or let it close again" },
  { key: "right", action: "postit.flip", args: { by: 1 }, label: "forward", says: "flip forward to the hover after this one" },
  { key: "alt+E", action: "postit.peel", label: "peel" },
  { key: "alt+X", action: "postit.drop", label: "drop" },
] satisfies ModeKey[]);

/** A post-it reads and remembers with the same NoteSurface as every reader. */
export class PostIt extends ReaderPane {
  override readonly kind = "post-it";
  sticky = false;
  hover = false;
  by: string | null = null;
  deliberate = true;
  dismissed?: () => void;

  constructor() { super(true); }
  override title() {
    const trail = this.surface.trailOf();
    return `post-it ${trail.back.length + (this.msg ? 1 : 0)}/${trail.back.length + trail.forward.length + (this.msg ? 1 : 0)}`;
  }
  headName() { return `${this.title()}${this.by ? ` · ${this.by}` : ""}`; }
  override host(desk: DeskApi) {
    const host = super.host(desk);
    return this.msg?.id.startsWith("glass:") ? { ...host, header: (m: Msg, w: number) => rowLines(m.text.split("\n")[0]!, w) } : host;
  }
  override hint() { return modeHint(POST_IT_KEYS, action => POST_IT_ACTIONS.def(action)); }
  protected override showSurface(m: Msg | null, host: SurfaceHost, by: Actor): boolean {
    return m ? this.surface.remember(m, host, running()?.settings.stack ?? 30, by) : super.showSurface(m, host, by);
  }
  override key(k: Key, desk: DeskApi): boolean {
    if (!this.holdsKeys) {
      const bound = effective(POST_IT_KEYS).find(b => b.key === keyName(k));
      if (bound) { runOwn(POST_IT_ACTIONS, bound.action, bound.args ?? {}, { pane: this, desk }); return true; }
    }
    return super.key(k, desk);
  }
  headControls(room: number, desk: DeskApi) {
    return [
      { text: "◂", chip: true as const, sgr: fg(C.cyan), act: ownPress(POST_IT_ACTIONS, "postit.flip", { by: -1 }, { pane: this, desk }) },
      { text: "▸", chip: true as const, sgr: fg(C.cyan), act: ownPress(POST_IT_ACTIONS, "postit.flip", { by: 1 }, { pane: this, desk }) },
      { text: this.sticky ? "◆" : "◇", chip: true as const, sgr: fg(C.yellow), act: ownPress(POST_IT_ACTIONS, "postit.stick", {}, { pane: this, desk }) },
      { text: "peel", chip: true as const, sgr: fg(C.yellow), act: ownPress(POST_IT_ACTIONS, "postit.peel", {}, { pane: this, desk }) },
      ...(room >= 14 ? [{ text: "drop", chip: true as const, sgr: fg(C.grey), act: ownPress(POST_IT_ACTIONS, "postit.drop", {}, { pane: this, desk }) }] : []),
    ];
  }
  override spec() { return { ...super.spec(), sticky: this.sticky, hover: this.hover, by: this.by }; }
  override dispose() { this.dismissed?.(); super.dispose(); }
}

export const POST_IT_ACTIONS = actionSet<KindHost>()("post-it", {
  "postit.flip": def({
    summary: "flip through this post-it's hover history without moving its rectangle", keys: "left right, wheel over the title, click ◂ ▸",
    touches: "tile", replay: "safe", args: { by: { type: "number", about: "negative goes back, positive goes forward" } },
    examples: [{ act: "postit.flip by=-1", does: "shows the hover before this one" }],
    async run({ by }, { pane, desk }, actor) {
      const p = pane as PostIt, direction = by < 0 ? -1 : 1;
      if (p.surface.travelsHere(direction)) {
        await p.trail.go(direction, 1, desk, actor);
      }
      desk.redraw(); return { title: p.title() };
    },
  }),
  "postit.stick": def({
    summary: "keep this post-it until it is dismissed, or let it close after the pointer leaves", keys: "p, click ◇ ◆",
    touches: "tile", replay: "safe", args: { on: { type: "boolean", optional: true, about: "sticky; left out toggles" } },
    examples: [{ act: "postit.stick on=true", does: "keeps this post-it until it is dismissed" }],
    run({ on }, { pane, desk }) { const p = pane as PostIt; p.sticky = on ?? !p.sticky; desk.keepLayout?.(); desk.redraw(); return { sticky: p.sticky }; },
  }),
  "postit.peel": def({
    summary: "peel the shown entry into its own pinned post-it; the hover keeps its stack. From the drawer, put this tile back on the glass",
    keys: "alt+E, click peel", touches: "nothing", replay: "safe", args: {},
    says: () => "peeled a post-it onto the glass",
    menu: { label: "peel onto the glass", group: "Post-it", key: "alt+E" },
    run(_, { pane, desk }, actor): TileDone { return glass().peel(pane as PostIt, desk, actor); },
  }),
  "postit.drop": def({
    summary: "drop the shown entry from this post-it's stack; the other entries stay",
    keys: "alt+X, click drop or the tile menu's drop row", touches: "tile", replay: "safe", args: {},
    menu: { label: "drop this entry", group: "Post-it", key: "alt+X" },
    async run(_, { pane, desk }, actor) {
      const p = pane as PostIt;
      if (!await p.surface.dropHere(p.host(desk), actor)) await desk.perform?.("tile.close", {}, actor, p);
      desk.keepLayout?.(); desk.redraw();
      return { title: p.title() };
    },
  }),
  "postit.shelve": def({
    summary: "move this post-it's shown reference onto a shelf", keys: "drag onto a shelf", touches: "shape", replay: "safe",
    args: { shelf: { type: "string", kind: "tile", about: "the shelf's name or id" } },
    examples: [{ act: "postit.shelve shelf=chores", does: "moves what this post-it shows onto the chores shelf" }],
    says: r => `shelved on ${r.name}`,
    async run({ shelf }, { pane, desk }, actor) { return glass().shelvePostIt(pane as PostIt, desk, shelf, actor); },
  }),
});

/** The post-it's tile kind: a reader with a hover history, registered while the glass extension runs. */
export const POST_IT_KIND: TileKind = {
  ...reading, kind: "post-it", about: "a note or cut-off value above every screen, with a hover history to flip",
  actions: POST_IT_ACTIONS, inherits: [READER_ACTIONS],
  make: s => { const p = new PostIt(); p.sticky = s.sticky ?? false; p.hover = s.hover ?? false; p.by = s.by ?? null; return readerFromSpec(s, p); },
  describe: p => ({ postit: (p as PostIt).title(), sticky: (p as PostIt).sticky, history: (p as PostIt).surface.trailOf() }),
  start: async (p, env) => { const r = p as PostIt; if (!r.msg && r.want?.startsWith("glass:")) r.show(textNote(r.want.slice(6)), env.desk); await startReader(p, env); },
};
