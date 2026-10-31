import type { Msg } from "../board";
import type { Actor } from "../socket";
import { USER } from "../socket";
import { actionSet, def, ActionRefused } from "../surface/actions";
import { modeHint, type ModeKey } from "../surface/modes";
import { effective, keyTable } from "../surface/keymap";
import { keyName } from "../surface/actions";
import type { Key } from "../term";
import { C, fg } from "../style";
import { rowLines } from "../text";
import { ReaderPane, runOwn, type DeskApi } from "./panes";
import type { KindHost } from "./tile-kinds";

export const POST_IT_KEYS = keyTable("post-it", "flip a post-it's hover history", [
  { key: "left", action: "postit.flip", args: { by: -1 }, label: "back" },
  { key: "p", action: "postit.stick", label: "sticky" },
  { key: "right", action: "postit.flip", args: { by: 1 }, label: "forward" },
] satisfies ModeKey[]);

/** A post-it reads and remembers with the same NoteSurface as every reader. */
export class PostIt extends ReaderPane {
  override readonly kind = "post-it";
  sticky = false;
  hover = false;
  by: string | null = null;
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
  override show(m: Msg | null, desk: DeskApi, by: Actor = USER): boolean {
    if (!m) return super.show(m, desk, by);
    const host = this.host(desk);
    return this.surface.remember(m, { ...host, ctx: host.contextFor!(m) }, desk.ctx.glass?.settings.stack ?? 30, by);
  }
  override key(k: Key, desk: DeskApi): boolean {
    if (!this.holdsKeys) {
      const bound = effective(POST_IT_KEYS).find(b => b.key === keyName(k));
      if (bound) { runOwn(POST_IT_ACTIONS, bound.action, bound.args ?? {}, { pane: this, desk }); return true; }
    }
    return super.key(k, desk);
  }
  headControls(_room: number, desk: DeskApi) {
    return [
      { text: "◂", chip: true as const, sgr: fg(C.cyan), press: () => void runOwn(POST_IT_ACTIONS, "postit.flip", { by: -1 }, { pane: this, desk }) },
      { text: "▸", chip: true as const, sgr: fg(C.cyan), press: () => void runOwn(POST_IT_ACTIONS, "postit.flip", { by: 1 }, { pane: this, desk }) },
      { text: this.sticky ? "◆" : "◇", chip: true as const, sgr: fg(C.yellow), press: () => void runOwn(POST_IT_ACTIONS, "postit.stick", {}, { pane: this, desk }) },
    ];
  }
  override spec() { return { ...super.spec(), sticky: this.sticky, hover: this.hover, by: this.by }; }
  override dispose() { this.dismissed?.(); super.dispose(); }
}

export const POST_IT_ACTIONS = actionSet<KindHost>()("post-it", {
  "postit.flip": def({
    summary: "flip through this post-it's hover history without moving its rectangle", keys: "left right, wheel over the title, click ◂ ▸",
    touches: "tile", replay: "safe", args: { by: { type: "number", about: "negative goes back, positive goes forward" } },
    async run({ by }, { pane, desk }, actor) {
      const p = pane as PostIt, direction = by < 0 ? -1 : 1;
      if (p.surface.travelsHere(direction)) {
        const why = await p.surface.travel(direction, p.host(desk), actor);
        if (why) throw new ActionRefused(why);
      }
      desk.redraw(); return { title: p.title() };
    },
  }),
  "postit.stick": def({
    summary: "keep this post-it until it is dismissed, or let it close after the pointer leaves", keys: "p, click ◇ ◆",
    touches: "tile", replay: "safe", args: { on: { type: "boolean", optional: true, about: "sticky; left out toggles" } },
    run({ on }, { pane, desk }) { const p = pane as PostIt; p.sticky = on ?? !p.sticky; desk.keepLayout?.(); desk.redraw(); return { sticky: p.sticky }; },
  }),
});
