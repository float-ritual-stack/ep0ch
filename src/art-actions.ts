// The art's actions (PIE-506), one set over two hosts: the BBS art viewer (the menu's B, a file area's pack)
// and the desk's art tile. Their keys and clicks run these, as `act` does, with the same arguments and the
// same answers. They change only what the art shows, never the person's focus or keys; an agent's is always
// said on the status bar.
import type { Actor } from "./socket";
import { ActionRefused, ActionSet, agentLabel } from "./surface/actions";

/** Where the art is: the piece, its place in the pack, iCE, the scroll and the piece's height. */
export interface ArtAbout { piece: string; n: number; of: number; ice: boolean; scroll: number; height: number | null }

/** What shows art. A host without iCE or a modem-speed reveal leaves those out, and their actions say so. */
export interface ArtHost {
  step(by: number): ArtAbout;
  scrollBy(by: number): ArtAbout;
  setIce?(on: boolean): ArtAbout;
  readonly iceOn?: boolean;
  revealAll?(): ArtAbout;
}
/** The art and where it's shown: a tile on the desk (the registry's { pane, desk }), or the viewer on its own screen. */
export interface ArtOn { pane: ArtHost; desk: { ctx: { flash(msg: string): void }; redraw(): void } }

type ArtArgs = { "art.step": { by: number }; "art.scroll": { by: number }; "art.ice": { on?: boolean }; "art.reveal": Record<string, never> };

/** An agent's change to the art: said, then the art drawn again. */
const done = (on: ArtOn, actor: Actor, said: string, out: ArtAbout) => {
  if (actor.kind === "agent") on.desk.ctx.flash(`${agentLabel(actor)} · ${said}`);
  on.desk.redraw();
  return out;
};

export const ART_ACTIONS = new ActionSet<ArtArgs, ArtOn>("art", {
  "art.step": {
    summary: "show the next (by=1) or previous (by=-1) piece (the viewer's pack, the art tile's pieces), from its top; an agent's is said on the status bar", keys: ". > →, , < ←, click on , or .",
    args: { by: { type: "number", about: "pieces to step: 1 next, -1 previous" } },
    run({ by }, on, actor) { const out = on.pane.step(Math.trunc(by) || 1); return done(on, actor, `showed ${out.piece}`, out); },
  },
  "art.scroll": {
    summary: "scroll the piece by rows (negative: up); an agent's is said on the status bar", keys: "↑ ↓ j k PgUp PgDn, the wheel, click on ↑ or ↓",
    args: { by: { type: "number", about: "rows; negative scrolls up" } },
    run({ by }, on, actor) { const out = on.pane.scrollBy(Math.trunc(by)); return done(on, actor, `scrolled the art to row ${out.scroll}`, out); },
  },
  "art.ice": {
    summary: "iCE colours (blink as bright backgrounds): on=true or false, else toggled. The art viewer's", keys: "i, click on i iCE",
    args: { on: { type: "boolean", optional: true, about: "true or false; default toggles" } },
    run({ on: want }, on, actor) {
      if (!on.pane.setIce) throw new ActionRefused("this art has no iCE switch; the art viewer (B on the menu) has");
      const out = on.pane.setIce(want ?? !on.pane.iceOn);
      return done(on, actor, `turned iCE ${out.ice ? "on" : "off"}`, out);
    },
  },
  "art.reveal": {
    summary: "draw the rest of the piece at once instead of at modem speed. The art viewer's", keys: "⏎, space",
    args: {},
    run(_, on, actor) {
      if (!on.pane.revealAll) throw new ActionRefused("this art is drawn whole already");
      return done(on, actor, "drew the art whole", on.pane.revealAll());
    },
  },
});
