import { componentsReady } from "../component-schemas";
import { USER } from "../socket";
import { openSettings, settingsSubject } from "../surface/settings";
import { ReaderPane, READER_ACTIONS, type DeskApi, type PaneView } from "./panes";
import type { TileKind } from "./tile-kinds";

/** A reader hosting the same card: the subject and its write path stay with NoteSurface. */
class SettingsPane extends ReaderPane {
  override readonly kind = "settings";
  private opened = false;
  constructor(readonly view?: string) { super(true); }
  override spec() { return { ...super.spec(), ...(this.view ? { view: this.view } : {}) }; }
  override render(w: number, h: number, focused: boolean, desk?: DeskApi): PaneView {
    const drawn = super.render(w, h, focused, desk);
    if (!this.opened && this.msg && this.surface.listsDrawn.length) {
      openSettings(this.surface, settingsSubject(this.surface, this.msg, this.view));
      this.opened = true;
      return super.render(w, h, focused, desk);
    }
    return drawn;
  }
}

export const SETTINGS_TILE: TileKind = {
  kind: "settings", about: "the settings card for note=<id>, optionally view=<^name> for an inline collection; the same card as comma over the view",
  openArgs: ["note", "view"], actions: READER_ACTIONS,
  keys: [{ key: ",", label: "settings" }],
  defaults: (spec, at) => at.pane instanceof ReaderPane ? { note: at.pane.msg?.id, view: at.pane.surface.listHost().current() ?? undefined, ...spec } : spec,
  make: spec => { const pane = new SettingsPane(spec.view); pane.want = spec.note ?? null; return pane; },
  accepts: { notes: true }, shows: p => (p as SettingsPane).msg,
  take: (p, m, desk, by) => { (p as SettingsPane).hold(m, desk, by); return null; },
  start: async (p, env) => {
    const pane = p as SettingsPane;
    await componentsReady({ board: env.desk.ctx.board, redraw: () => env.desk.redraw() });
    if (pane.want) { const note = await env.desk.ctx.board.get(pane.want); if (note) pane.hold(note, env.desk, USER); }
    env.desk.redraw();
  },
};
