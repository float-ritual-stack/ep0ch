// The drawer's card when a named agent has no live hc terminal. Pressable rows are the button part
// (HomeSurface), never a script that prints text. The tile is not saved: the next door asks hc again.
import type { Pane, PaneView } from "./panes";
import type { DeskApi } from "./panes";
import type { Key } from "../term";
import { HomeSurface } from "../surface/home";
import type { NamedLook } from "./named-agent";

export class NamedAgentCard implements Pane {
  readonly kind = "exhibit";
  /** Left out of drawer-tiles.json. A restart asks hc again instead of restoring a dead attach. */
  readonly transient = true;
  private home = new HomeSurface();
  constructor(private look: NamedLook) {}
  title() { return this.look.kind === "live" ? "agent" : this.look.title; }
  hint() { return "click a row · alt+s shell"; }
  render(w: number, h: number): PaneView {
    if (this.look.kind === "live") return { lines: [] };
    return { lines: this.home.renderCard({ title: this.look.title, lines: this.look.lines, buttons: this.look.buttons }, w, h) };
  }
  key(k: Key): boolean { return k.kind === "char"; }
  click(x: number, y: number, desk: DeskApi) {
    this.home.press({ kind: "mouse", action: "down", button: 0, x, y }, action => { void desk.ctx.press?.(action); });
  }
}
