import { componentsReady } from "../component-schemas";
import { USER } from "../socket";
import { openSettings, settingsSubject } from "../surface/settings";
import { ReaderPane, READER_ACTIONS, type DeskApi, type PaneView } from "./panes";
import type { TileKind } from "./tile-kinds";
import { readerFacts } from "./reader-facts";
import { AttachedTilePane } from "./attached-tile";
import { cardField } from "./settings-index";

/**
 * A reader hosting the same card: the subject and its write path stay with NoteSurface. `fills` (the settings screen's
 * card tile, PIE-1709): the card is the whole tile under the page's title, and a new page held opens its card again.
 */
class SettingsPane extends ReaderPane {
  override readonly kind = "settings";
  private opened: string | null = null;
  private entered: string | null = null;
  constructor(readonly view?: string, readonly fills = false) { super(true); }
  override spec() { return { ...super.spec(), ...(this.view ? { view: this.view } : {}), ...(this.fills ? { args: { fills: true } } : {}) }; }
  override render(w: number, h: number, focused: boolean, desk?: DeskApi): PaneView {
    const drawn = super.render(w, h, focused, desk);
    const m = this.msg;
    // Given the keys with a card in it (the settings screen at an extension): in it at once, once per note shown.
    if (this.fills && focused && m && this.opened === m.id && this.entered !== m.id && this.surface.panel?.card) { this.entered = m.id; desk?.enterSession?.(this); }
    // The screen's card stays open whatever reloads the page under it (a save rewrites the extension's page) or closes it.
    const gone = this.fills && !this.surface.panel?.card;
    if (m && (this.opened !== m.id || gone) && (this.surface.listsDrawn.length || this.fills)) {
      const again = this.opened === m.id;
      const subject = settingsSubject(this.surface, m, this.view);
      if (!subject.schemas.length) return drawn;
      const card = openSettings(this.surface, subject, desk?.ctx);
      card.fills = this.fills;
      // The screen's card is what the tile is for: its keys are the card's (⏎ edits, t tries), as `,` gives them.
      if (this.fills) {
        const mode = this.surface.modes.get("panel");
        if (mode) this.surface.modes.focus(mode, true);
        // Opened with the keys here (the settings screen at an extension, ⏎ in its list): in it at once, no ⏎ to enter.
        if (focused && !again) { this.entered = m.id; desk?.enterSession?.(this); }
      }
      // A setting the settings list picked (its search found it by name or words): selected as the card opens.
      const want = cardField.get(m.id);
      if (want) { const n = subject.fields.findIndex(f => f.prop.key === want); if (n >= 0) card.sel = n; cardField.delete(m.id); }
      this.opened = m.id;
      return super.render(w, h, focused, desk);
    }
    return drawn;
  }
}

export const SETTINGS_TILE: TileKind = {
  kind: "settings", about: "the settings card for note=<id>, optionally view=<^name> for an inline collection; the same card as comma over the view. On the settings screen, an extension's settings filling the tile",
  openArgs: ["note", "view", "source"], actions: READER_ACTIONS,
  takesKeys: p => p instanceof AttachedTilePane, windowKeys: true,
  keys: [{ key: ",", label: "settings" }],
  defaults: (spec, at) => at.pane instanceof ReaderPane ? { note: at.pane.msg?.id, view: at.pane.surface.listHost().current() ?? undefined, ...spec } : spec,
  make: spec => { if (spec.source?.startsWith("tile:")) return new AttachedTilePane(spec.source.slice(5), "settings"); const pane = new SettingsPane(spec.view, spec.args?.fills === true); pane.want = spec.note ?? null; return pane; },
  accepts: { notes: true }, shows: p => (p as SettingsPane).msg, facts: readerFacts,
  take: (p, m, desk, by) => { if (!(p instanceof SettingsPane)) return "this settings tile follows its reader; open the note in a reader"; p.hold(m, desk, by); return null; },
  start: async (p, env) => {
    const pane = p as SettingsPane;
    await componentsReady({ board: env.desk.ctx.board, redraw: () => env.desk.redraw() });
    if (pane.want) { const note = await env.desk.ctx.board.get(pane.want); if (note) pane.hold(note, env.desk, USER); }
    env.desk.redraw();
  },
};
