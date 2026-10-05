// A blank screen (PIE-565): one empty tile to build from, using what the screen offers. The blank tile says what it's
// for and offers the first steps as rows: an outline, a reader, a detail, a terminal or a query lane in its place
// (`blank.fill`, the layout's `replace`), or another screen to open (`blank.screens`). Each row is an action: its key,
// a click on it, the tile's ⋯ menu and `act` run the same one. From there the desk's own keys build the rest (^W o, ^W v,
// alt+l), and ^W w saves it as a screen note (`screen.save`). The screen is a spec like any other: `blankSpec`.
import type { ScreenSpec } from "./screen-spec";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";
import type { KeySpot } from "../new-note";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { paint, width } from "../style";
import { ch, type Key } from "../term";
import { USER } from "../socket";

/** One of the blank tile's rows: its key, the tile kind it opens in the tile's place (none: open a screen), and what it is. */
interface Row { key: string; kind?: string; label: string; about: string }
const ROWS: readonly Row[] = [
  { key: "t", kind: "tree", label: "the outline", about: "every note as a tree; ⏎ opens one where its opens land" },
  { key: "r", kind: "reader", label: "a reader", about: "shows the current note" },
  { key: "d", kind: "detail", label: "a detail", about: "keeps the note opened into it" },
  { key: "s", kind: "pty", label: "a terminal", about: "your shell" },
  // Q, not q: q is back on every screen.
  { key: "Q", kind: "query", label: "a query lane", about: "a saved view's cards (you pick the view)" },
  { key: "o", label: "open a screen…", about: "one you made, or a built-in" },
];
const KINDS = ROWS.flatMap(r => (r.kind ? [r.kind] : []));
/** The tile menu's group for the blank tile's rows. */
const START = "Start";

/** The blank tile: rows to start the screen with, each a click or a key. */
export class BlankTile implements Pane {
  readonly kind = "blank";
  title() { return "blank · start here"; }
  hint() { return `${ROWS.map(r => `${r.key} ${r.label.replace("…", "")}`).join(" · ")} · or click one`; }
  render(w: number, h: number): PaneView {
    const lines: string[] = [], spots: KeySpot[] = [];
    const say = (s: string) => lines.push(paint(s));
    say("|07 A blank screen. Start it with a tile here:");
    say("");
    for (const r of ROWS) {
      const line = paint(` |15${r.key}  |11${r.label}|08 · ${r.about}`);
      spots.push({ row: lines.length, from: 0, to: Math.min(w, width(line)), key: { kind: "char", ch: r.key } });
      lines.push(line);
    }
    say("");
    say("|08 Then |15^W o|08 opens more beside it, |15^W v|08 a preview where its opens land,");
    say("|08 |15alt+l|08 sends one tile's opens to another, and |15^W w|08 saves this screen.");
    return { lines: lines.slice(0, h), spots: spots.filter(s => s.row < h) };
  }
  key(): boolean { return false; }
}

export const BLANK_ACTIONS = actionSet<KindHost>()("blank", {
  "blank.fill": def({
    summary: `put a new tile in the blank tile's place (it goes): kind=${KINDS.join(", ")}; a query lane names its view= (the person's without one picks it), a terminal its cmd= (default your shell). The person's keys go to it`,
    keys: `${ROWS.filter(r => r.kind).map(r => r.key).join(" ")} in the blank tile, or a click on its row; ⏎ or a double click on a view in Q's picker`,
    touches: "shape", replay: "ask", says: r => (r?.picking ? null : `started the screen with ${r.tile}`),
    menu: ROWS.filter(r => r.kind).map(r => ({ label: r.label, group: START, key: r.key, args: { kind: r.kind! } })),
    args: {
      kind: { type: "string", about: KINDS.join(", ") },
      view: { type: "string", optional: true, about: "query: the saved view (virtual branch) whose cards it lists" },
      cmd: { type: "string", optional: true, about: "pty: the command line (default $SHELL)" },
      name: { type: "string", optional: true, about: "its name (default its kind)" },
    },
    async run({ kind, view, cmd, name }, { desk, tile }, actor) {
      if (!KINDS.includes(kind)) throw new ActionRefused(`blank.fill: kind is ${KINDS.join(", ")}, not ${kind}`);
      const d = desk as DeskApi & Required<Pick<DeskApi, "replaceTile" | "askChoices">>;
      // A query lane without its view: the person picks the view first (an agent names it).
      if (kind === "query" && !view && actor.kind !== "agent") {
        await d.askChoices(kind, more => void d.perform?.("blank.fill", { kind, ...more }, USER, tile));
        return { tile, picking: kind };
      }
      return await d.replaceTile(tile, { kind, ...(view ? { view } : {}), ...(cmd ? { cmd } : {}), ...(name ? { name } : {}) }, actor);
    },
  }),
  "blank.screens": def({
    summary: "the screens to open from a blank screen: the ones people made (screen notes), then the built-ins. The person's opens the picker (⏎ opens one with screen.open, x x deletes one they made); an agent's answers them (screen.open opens one)",
    keys: "o in the blank tile, or a click on its row",
    touches: "nothing", replay: "safe",
    menu: { label: "open a screen…", group: START, key: "o" },
    args: {},
    run(_, { desk }, actor) {
      const d = desk as DeskApi & Required<Pick<DeskApi, "screenPicker" | "screensToOpen">>;
      if (actor.kind !== "agent") d.screenPicker();
      return { screens: d.screensToOpen() };
    },
  }),
});

/** The blank tile's kind: made only by a blank screen (no ^W o key), its rows its keys. */
export const BLANK_KIND: TileKind = {
  kind: "blank", about: "an empty place to start a screen from: its rows put an outline, a reader, a detail, a terminal or a query lane in its place, or open another screen",
  noun: "the blank tile", placeholder: true,
  make: () => new BlankTile(), actions: BLANK_ACTIONS,
  // Its rows' keys (a click on a row presses its key here): the row's action, in this tile.
  press: (_p: Pane, k: Key) => {
    const r = k.kind === "char" && !k.ctrl ? ROWS.find(x => x.key === ch(k)) : undefined;
    return r ? (r.kind ? { action: "blank.fill", args: { kind: r.kind } } : { action: "blank.screens" }) : null;
  },
  save: () => ({}),
};

/** The blank screen: one blank tile, laid out and saved as the person builds it (`layouts`: any tile, anywhere). */
export function blankSpec(): ScreenSpec {
  return { name: "blank", title: "blank screen", layouts: true, layout: { focus: "blank", root: { t: "leaf", kind: "blank", name: "blank" } } };
}
