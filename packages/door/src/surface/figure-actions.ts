import { ActionRefused, def } from "./actions";
import type { On } from "./note";
import { keyTable } from "./keymap";
import { modeActionKeys, type ModeKey } from "./modes";
import { resizeHeld } from "../resize";
import { readContentSize } from "@ep0ch/outline-core/media-line";
import { DENSITIES, isDensity, type Density } from "../graphs";

export const FIGURE_SIZE_KEYS: readonly ModeKey[] = keyTable("figure size", "a selected figure in a note", [
  { key: "=", action: "figure.size", label: "fit/full" }, { key: "click", action: "figure.size" },
  { key: "shift+up", action: "figure.scroll", label: "scroll inside", args: { by: -1 } }, { key: "shift+down", action: "figure.scroll", label: "scroll inside", args: { by: 1 } },
  { key: "drag", action: "figure.resize" },
]);

const nextDensity = (d: Density): Density => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]!;

export const figureActions = {
  "figures": def({
    summary: "list the live figures the reader draws in its note: each one's number, kind, title and density, and a tabs figure's tabs with their counts and which is shown (this reader's choice; the note never changes)",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface }: On) {
      surface.requireDrawn();
      return { figures: surface.describeFigures() };
    },
  }),
  "figure.tab": def({
    summary: "show another tab of a live tabs figure (::graph-tabs): n= a tab's number (from 1) or its value, or by=1 (next) / by=-1 (previous), round again; figure= which (its number among the note's figures, or its title; left out, the one the [ ] position is in, else the note's only one). Reading state, kept across repaints and live answers; the note's text never changes",
    keys: "tab shift+tab or ← → while a figure's tab or row is the [ ] position, ⏎ on a tab, click a tab",
    touches: "tile", while: "typing", replay: "safe", way: "an agent switches tabs in a reader the person isn't typing in",
    args: {
      n: { type: "string", optional: true, about: "the tab: its number from 1, or its value (doing, review…) when that isn't a number" },
      tab: { type: "string", optional: true, about: "the tab by its value exactly, a number too (a click and enter on a tab pass this)" },
      by: { type: "number", optional: true, about: "1 the next tab, -1 the previous one" },
      figure: { type: "string", optional: true, about: "which tabs figure: its number among the note's figures (figures lists them), or its title" },
    },
    examples: [
      { act: "figure.tab n=2", does: "shows the second tab of the note's tabs figure" },
      { act: "figure.tab by=1 figure=\"Beds by stage\"", does: "shows the next tab of the figure titled Beds by stage" },
    ],
    run({ n, by, tab, figure }, { surface, host, standing }: On, actor) {
      surface.requireNote();
      if ([n, by, tab].filter(x => x !== undefined).length !== 1) throw new ActionRefused("say one of n= (a tab's number or value), tab= (its value) or by=1|-1");
      const f = surface.figureNamed(figure, "tabs"), tabs = f.tabs ?? [];
      if (!tabs.length) throw new ActionRefused(`${f.title} has no tabs: its question has no results yet`);
      let i: number;
      if (by !== undefined) { const at = Math.max(0, tabs.findIndex(t => t.value === f.tab)); i = (at + (by < 0 ? -1 : 1) + tabs.length) % tabs.length; }
      else if (tab !== undefined) i = tabs.findIndex(t => t.value === tab);
      else { const v = String(n).trim(); i = /^\d+$/.test(v) ? Number(v) - 1 : tabs.findIndex(t => t.value.toLowerCase() === v.toLowerCase()); }
      const t = tabs[i];
      if (!t) throw new ActionRefused(`${f.title} has no tab ${n ?? tab}; its tabs: ${tabs.map((x, j) => `${j + 1} ${x.value}`).join(", ")}`);
      surface.setFigureTab(f, t.value, standing, host);
      surface.noteAgent(actor, `showed the ${t.value} tab of ${f.title}`);
      host.redraw();
      return { figure: f.n, title: f.title, tab: t.value, count: t.count, tabs: tabs.map((x, j) => ({ n: j + 1, ...x, shown: x === t })) };
    },
  }),
  "figure.density": def({
    summary: "draw a live table or tabs figure's rows compact (one line a title, cut with …), cozy (titles up to two lines, cut with …) or comfortable (up to three lines, a blank line between rows): to= sets it, else the next one round; a wrapped title hangs under its text, past a work id. figure= as figure.tab. Reading state: the figure's density: line is only where it starts, and the note never changes",
    keys: "⏎ on its ≡ control, click it",
    touches: "tile", while: "typing", replay: "safe", way: "an agent changes the density in a reader the person isn't typing in",
    args: {
      to: { type: "string", optional: true, about: "compact, cozy or comfortable; left out, the next one round" },
      figure: { type: "string", optional: true, about: "which table or tabs figure: its number among the note's figures (figures lists them), or its title" },
    },
    examples: [
      { act: "figure.density to=compact", does: "draws the figure's rows one line a title, cut with …" },
      { act: "figure.density figure=2", does: "moves the second figure to the next density round" },
    ],
    run({ to, figure }, { surface, host }: On, actor) {
      surface.requireNote();
      if (to !== undefined && !isDensity(to)) throw new ActionRefused(`to is ${DENSITIES.join(", ")}, not ${to}`);
      const f = surface.figureNamed(figure, "rows");
      const d: Density = (to as Density | undefined) ?? nextDensity(f.density);
      surface.setFigureDensity(f, d);
      surface.noteAgent(actor, `drew ${f.title} ${d}`);
      host.redraw();
      return { figure: f.n, title: f.title, density: d };
    },
  }),
  "figure.size": def({
    summary: "set a figure's height in rows or width fit/full in its YAML; with neither, toggle fit/full. One normal edit, ctrl+z undoes",
    keys: `${modeActionKeys([FIGURE_SIZE_KEYS], "figure.size")}, ⏎ on its ↔ control`,
    touches: "draft", draft: "write", replay: "ask",
    args: {
      figure: { type: "string", optional: true, about: "the figure's number or title (figures lists them)" },
      height: { type: "number", optional: true, about: "the rows inside the frame; shift+up/down scrolls them" },
      width: { type: "string", optional: true, about: "fit keeps the reading measure; full fills the tile" },
    },
    examples: [{ act: "figure.size figure=1 height=8 width=full", does: "shows eight rows inside a figure spanning the tile, saving both in its YAML" }],
    async run({ figure, height, width }, { surface, host }: On, actor) {
      const f = surface.figureNamed(figure, "any");
      return surface.inTurn(async () => {
        const m = await host.ctx.board.get(f.note ?? surface.requireNote().id);
        if (!m || f.line === undefined) throw new ActionRefused("open the figure's note to resize it");
        if (m.revision !== f.revision) {
          surface.refresh(m); host.redraw();
          throw new ActionRefused("the figure's note changed; resize again after it redraws");
        }
        const size = { height, width: width ?? (height === undefined ? f.size.width === "full" ? "fit" : "full" : undefined) };
        const checked = readContentSize(size);
        if (checked.problems.length) throw new ActionRefused(checked.problems.join(" · "));
        const values = Object.fromEntries(Object.entries(size).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
        const result = await surface.writeFigureProperties(m, f.line, values, host, actor);
        surface.noteAgent(actor, `resized ${f.title}`);
        host.ctx.flash("saved figure · ctrl+z undoes"); host.redraw();
        return result;
      });
    },
  }),
  "figure.scroll": def({
    summary: "scroll inside a figure's height by rows, keeping the page still",
    keys: modeActionKeys([FIGURE_SIZE_KEYS], "figure.scroll"),
    touches: "tile", while: "typing", replay: "safe", way: "an agent scrolls a figure in a reader the person isn't typing in",
    args: { figure: { type: "string", optional: true, about: "the figure's number or title" }, by: { type: "number", about: "rows to scroll: positive down, negative up" } },
    examples: [{ act: "figure.scroll figure=1 by=3", does: "scrolls three rows down inside the first figure" }],
    run({ figure, by }, { surface, host }: On) {
      const f = surface.figureNamed(figure, "any"), list = surface.figureSizing.lists.get(f.key);
      list?.view.scroll(by); host.redraw();
      return { figure: f.n, top: list?.view.top ?? 0 };
    },
  }),
  "figure.resize": def({
    summary: "hold a figure's bottom or right edge, move it, then release to save height or width in its YAML",
    keys: modeActionKeys([FIGURE_SIZE_KEYS], "figure.resize"),
    touches: "tile", person: "a held edge follows the person's pointer", replay: "ask",
    args: { phase: { type: "string", about: "start, move or end" }, x: { type: "number", about: "column in the reader, from 0" }, y: { type: "number", about: "row in the reader, from 0" } },
    examples: [{ act: "figure.resize phase=start x=20 y=18", does: "holds the figure edge at that reader cell; move and end finish the drag" }],
    async run({ phase, x, y }, { surface, host }: On, actor) {
      const sizing = surface.figureSizing;
      if (phase === "start") {
        const edge = sizing.edge(x, y);
        if (!edge) throw new ActionRefused("that cell isn't a figure's bottom or right edge");
        sizing.drag = { ...edge, x, y }; resizeHeld();
      } else if (phase === "move" || phase === "end") {
        sizing.move(x, y);
        const d = sizing.drag;
        if (phase === "end" && d && !d.saving) {
          d.saving = true;
          try { if (d.now) await surface.act("figure.size", { figure: String(d.frame.figure.n), ...d.now }, host, actor); }
          finally { sizing.cancel(); host.redraw(); }
        }
      } else throw new ActionRefused("phase is start, move or end");
      host.redraw();
      return { held: !!sizing.drag, size: sizing.drag?.now };
    },
  }),
};
