// Reading: folds (fold, unfold, fold.toggle, fold.select, folds), the reading position (reading.*), scroll, the
// callouts list, select.mode, and an inline list's preview (list.preview.*).
import type { Actor } from "../../socket";
import { type FoldArgs, type On, foldLabel, noteRow, FLOAT_MOVE_ARGS, FOLD_ARGS } from "./shared";
import type { FoldPoint } from "../../doc";
import type { Msg } from "../../board";
import type { NoteSurface } from "../note";
import { ActionRefused, def, type ActionDef } from "../actions";
import { readerKeys } from "../reader-keys";

/** The fold point `text`, `line` or `n` names in the note the reader shows (the whole note, waited for). */
export async function foldTarget(surface: NoteSurface, args: FoldArgs): Promise<FoldPoint> {
  return foldPointIn(surface, await surface.whole(), args);
}

/** The same in a note already read whole: a key or click on what's drawn doesn't wait (PIE-506). */
export function foldPointIn(surface: NoteSurface, m: Msg, { text, line, n }: FoldArgs): FoldPoint {
  const { points, lines } = surface.foldsIn(m);
  if ([text, line, n].filter(x => x !== undefined).length !== 1) throw new ActionRefused("say which heading, list item or callout: one of text=, line= or n= (folds lists them)");
  if (!points.length) throw new ActionRefused("this note has no headings, nested lists or callouts to fold");
  const listed = (ps: FoldPoint[]) => ps.slice(0, 8).map(p => `line ${lines[p.line]! + 1} ${foldLabel(p)}`).join("; ");
  if (n !== undefined) {
    const p = points[n - 1];
    if (!p) throw new ActionRefused(`there is no fold point ${n}; the note has ${points.length} (folds lists them)`);
    return p;
  }
  if (line !== undefined) {
    const at = lines.indexOf(line - 1);
    if (at < 0) throw new ActionRefused(line === 1 ? "line 1 is the subject; it doesn't fold" : `line ${line} isn't part of the note's readable body (it's past the end, or holds only properties)`);
    const hits = points.filter(p => p.line === at);
    if (hits.length > 1) throw new ActionRefused(`line ${line} has ${hits.length} fold points (${listed(hits)}); pass n= from folds to select one`);
    const p = hits[0] ?? points.filter(p => p.line < at && at < p.end).at(-1);
    if (!p) throw new ActionRefused(`line ${line} isn't a heading or a list item with nested lines, nor inside one; the note's are: ${listed(points)}`);
    return p;
  }
  const want = text!.trim().replace(/^(#{1,6}|[-*]|\d+[.)])\s+/, "").replace(/\s+/g, " ").toLowerCase();
  const heading = /^#{1,6}\s/.test(text!.trim()) ? text!.trim().match(/^#+/)![0].length : null;
  const pool = points.filter(p => heading === null || (p.kind === "heading" && p.level === heading));
  // A task's box ([ ], [x]) needn't be said.
  const reads = (p: FoldPoint) => [p.text.toLowerCase(), p.text.replace(/^\[.\]\s+/, "").toLowerCase()];
  let hits = pool.filter(p => reads(p).includes(want));
  if (!hits.length) hits = pool.filter(p => reads(p).some(r => r.startsWith(want)));
  if (!hits.length) throw new ActionRefused(`nothing foldable reads ${JSON.stringify(text)}; the note's are: ${listed(points)}`);
  if (hits.length > 1) throw new ActionRefused(`${hits.length} match ${JSON.stringify(text)} (${listed(hits)}); pass line= or n=`);
  return hits[0]!;
}

/** What a fold action reports: the fold point, whether it's folded now, and every fold in the reader. */
export function foldResult(surface: NoteSurface, p: FoldPoint) {
  const { points, lines } = surface.foldsIn(surface.msg!);
  return {
    n: points.indexOf(p) + 1, kind: p.kind, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.effectiveFolded(p),
    foldedNow: points.filter(q => surface.effectiveFolded(q)).map(foldLabel),
  };
}

/** fold, unfold: one fold point, or with all=true every outermost one (fold) or all of them (unfold). */
export async function runFold(on: boolean, { all, ...which }: FoldArgs & { all?: boolean }, { surface, host, standing }: On, actor: Actor) {
  const now = surface.msg && !surface.msg.partial ? surface.msg : null;
  if (all) {
    if (Object.values(which).some(x => x !== undefined)) throw new ActionRefused("all=true folds or unfolds every one; leave out text, line and n");
    const m = now ?? await surface.whole();
    const changed = surface.foldAll(on, standing);
    surface.noteAgent(actor, on ? "folded the note's sections" : "unfolded the whole note");
    if (standing) host.ctx.flash(changed ? `${on ? "folded" : "unfolded"} ${changed}` : "this note has no headings, nested lists or callouts to fold");
    host.redraw();
    return { changed, foldedNow: surface.foldsIn(m).points.filter(q => surface.folded.has(q.key)).map(foldLabel) };
  }
  const p = now ? foldPointIn(surface, now, which) : await foldTarget(surface, which);
  surface.setFold(p, on, standing);
  surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p)}`);
  host.redraw();
  return foldResult(surface, p);
}

export const READING_DEFS = {
  "fold.select": def({
    words: "move the ( ) fold selection to the next or previous heading, list item or callout",
    summary: "put the person's ( ) fold selection on the next (by=1) or previous (by=-1) heading, list item or callout drawn; f or enter then folds it. The person's reading state: an agent's is refused (fold, unfold and fold.toggle name a fold point)", keys: readerKeys("fold.select"),
    touches: "tile", replay: "safe", person: "the ( ) selection is the person's; fold, unfold and fold.toggle name a fold point (folds lists them)",
    args: { by: { type: "number", about: "1 the next fold point, -1 the previous one" } },
    examples: [
      { act: "fold.select by=1", does: "puts the ( ) selection on the next heading, list item or callout" },
      { act: "fold.select by=-1", does: "puts the ( ) selection on the previous one" },
    ],
    run({ by }, { surface, host }, _actor) {
      const m = surface.requireNote();
      if (m.partial || !surface.stepFold(by < 0 ? -1 : 1)) throw new ActionRefused("this note has no headings, nested lists or callouts to fold");
      host.redraw();
      return surface.describe().folds ?? null;
    },
  }),
  "reading.step": def({
    summary: "step the rows of the container the [ ] position is in (a collection, a live figure, a links list), walking on past its edge; elsewhere move the reading line by logical blocks, landing on a container's first or last row, a screen at a time in a tall block",
    touches: "tile", replay: "safe", person: "the reading position belongs to the person", keys: readerKeys("reading.step"),
    args: { by: { type: "number", about: "1 next block, -1 previous block" }, through: { type: "boolean", optional: true, about: "on a collection's block: walk past it instead of into it (j or k at its edge)" } },
    examples: [
      { act: "reading.step by=1", does: "moves the reading line to the next block of the note" },
      { act: "reading.step by=-1", does: "moves the reading line back to the previous block" },
    ],
    run({ by, through }, { surface, host }) {
      surface.requireNote();
      if (by !== 1 && by !== -1) throw new ActionRefused("by is 1 or -1");
      surface.stepReading(by, !!through, host); surface.previewRow(host); host.redraw();
      return { position: surface.position.reading };
    },
  }),
  "reading.place": def({
    summary: "put the reading position on a source line; the next edit starts there without scrolling the page (a line out of view: on the first row in view instead, PIE-1579; draft.place puts an open edit's cursor anywhere)",
    touches: "tile", replay: "safe", person: "the reading position belongs to the person", keys: "click note text",
    args: { line: { type: "number", about: "source line, from 1" } },
    examples: [
      { act: "reading.place line=12", does: "puts the reading position on note line 12, without scrolling the page" },
    ],
    run({ line }, { surface }) {
      const m = surface.requireNote();
      if (!Number.isInteger(line) || line < 1 || line > m.text.split("\n").length) throw new ActionRefused("line must name a source line in this note");
      surface.anchorView();
      surface.letGo();
      surface.readingLine(line - 1);
      return { line };
    },
  }),
  "scroll": def({
    summary: "scroll the reader's note by rows (by=, negative is up) or to=top / to=end (the last line to the bottom edge; again, past the end as reader.overscroll allows, to the middle by default); the person's [ ] position is let go, as their own scrolling does. An agent's is refused on the reader the person has focused (view.scrollTo on the desk scrolls without touching their position)", keys: readerKeys("scroll", { keys: "wheel", does: "scrolls the note" }),
    touches: "tile", replay: "safe", way: "its scroll is theirs; an agent scrolls a reader with view.scrollTo (desk), which leaves their [ ] position alone",
    args: {
      by: { type: "number", optional: true, about: "rows to scroll; negative scrolls up" },
      to: { type: "string", optional: true, about: "top or end" },
    },
    examples: [
      { act: "scroll by=10", does: "scrolls the note down ten rows" },
      { act: "scroll to=end", does: "scrolls until the last line is at the bottom edge" },
    ],
    run({ by, to }, { surface, host, standing }, actor) {
      if (to !== undefined && to !== "top" && to !== "end") throw new ActionRefused(`to is top or end, not ${to}`);
      if ((by === undefined) === (to === undefined)) throw new ActionRefused("say by= (rows) or to=top|end");
      surface.requireNote();
      // The person's own scrolling lets go of their [ ] position; an agent's never touches it.
      if (to === "end") surface.scrollEnd(standing);
      else surface.scrollBy(to === "top" ? -1e9 : by!, standing);
      surface.noteAgent(actor, "scrolled this reader");
      host.redraw();
      return surface.viewport();
    },
  }),
  "callouts": def({
    summary: "open every callout, or put them back as written (those with [!type]- folded); show= sets it, else it toggles. The person's reading state: an agent's is refused (fold and unfold name one callout)", keys: readerKeys("callouts"),
    touches: "tile", replay: "safe", person: "whether callouts are open is the person's reading state; an agent reads the note's text (peek, elements)",
    menu: noteRow("open or fold callouts", "z", { now: ({ surface }) => (surface.msg && surface.calloutsIn(surface.msg).length ? null : { hide: true }) }),
    args: { show: { type: "boolean", optional: true, about: "true shows the bodies, false folds them; left out, it toggles" } },
    examples: [
      { act: "callouts show=true", does: "opens every callout in the note" },
      { act: "callouts show=false", does: "puts the callouts back as written, the [!type]- ones folded" },
    ],
    run({ show }, { surface, host }) {
      surface.unfold = show ?? !surface.unfold;
      surface.showCallouts(surface.unfold);
      host.redraw();
      return { callouts: surface.unfold ? "shown" : "folded" };
    },
  }),
  "select.mode": def({
    summary: "select by keys: v starts where the reading is (h j k l, PgUp PgDn, Home End move the end; y copies, esc or v leaves), or takes over a selection made with the mouse. The person's only: an agent selects with select text= or line=", keys: "v",
    touches: "tile", replay: "safe", person: "the keyboard selection is the person's; an agent selects with select text=… or line=…, drawn as its own",
    menu: noteRow("select text by keys", "v", { busy: true }),
    args: {},
    run(_, { surface, host }, _actor) {
      surface.requireNote();
      if (!surface.selectByKeys()) throw new ActionRefused("nothing is drawn to select yet");
      host.redraw();
      return surface.describeSelection(surface.selection!);
    },
  }),
  "list.preview.scroll": def({
    summary: "scroll the selected item's children inside their fixed preview", keys: readerKeys("list.preview.scroll", { keys: "wheel", does: "over the children" }),
    touches: "tile", person: "the preview scroll belongs to the person", replay: "safe",
    args: { by: { type: "number", about: "rows to scroll" } },
    examples: [{ act: "list.preview.scroll by=3", does: "scrolls three rows inside the children preview" }],
    run: ({ by }, { surface, host }) => { const p = surface.listPreview; p.top = Math.max(0, Math.min(p.max, p.top + by)); host.redraw(); return { top: p.top }; },
  }),
  "list.preview.edit": def({
    summary: "edit the selected item's children in the shared editor; a save patches only their lines",
    touches: "draft", draft: "write", replay: "ask", keys: readerKeys("list.preview.edit", { keys: "click", does: "on the children preview" }),
    args: { text: { type: "string", optional: true, about: "replacement source for the children; left out opens the editor" } },
    examples: [{ act: 'list.preview.edit text="  - New detail"', does: "patches the selected item's children" }],
    run: ({ text }, { surface, host }, actor) => surface.editListPreview(host, actor, text),
  }),
  "list.preview.field": def({
    summary: "type, save or leave the children edit", touches: "draft", person: "the children edit belongs to the person", replay: "ask",
    args: { op: { type: "string", about: "key, text, save or cancel" }, value: { type: "string", optional: true, about: "key name or typed text" } },
    examples: [{ act: "list.preview.field op=save", does: "saves the children edit through its patch" }],
    run: (a, { surface, host }) => surface.listPreviewField(a, host),
  }),
  "list.preview.place": def({
    summary: "place the selected list item's children using the reader's attachment placements",
    touches: "tile", person: "the preview placement belongs to the person", replay: "ask",
    args: { place: { type: "string", optional: true, about: "inline, floating, split, popup or tile" }, side: { type: "string", optional: true, about: "left, right, up or down for its tile" } },
    examples: [{ act: "list.preview.place place=split", does: "shows the children beside or below the list" }],
    run: async ({ place, side }, { surface, host }) => ({ place: await surface.attachments.put("list-preview", place, host, side) }),
  }),
  "list.preview.move": def({
    summary: "move or size the floating list children preview inside its reader", keys: "drag its header or corner",
    touches: "tile", person: "the preview placement belongs to the person", replay: "ask", args: FLOAT_MOVE_ARGS,
    examples: [{ act: "list.preview.move dx=2 dy=-1", does: "moves the floating children preview right and up" }],
    run: (args, { surface, host }) => surface.attachments.move("list-preview", args, host),
  }),
  "list.preview": def({
    summary: "show this list's selected item's children in an attached preview; reading state only",
    keys: [{ keys: "p", does: "fold chip", says: "preview the children of the selected list item" }, { via: "reader menu" }], touches: "tile", while: "typing", replay: "safe",
    menu: noteRow("preview list children", ""),
    args: { ...FOLD_ARGS, on: { type: "boolean", optional: true, about: "preview children instead of unfolding in place" } },
    examples: [{ act: 'list.preview text="Keep the beans" on=true', does: "previews the children of this list" }],
    async run({ on, ...which }, { surface, host }, actor) {
      const p = Object.values(which).some(v => v !== undefined) ? await foldTarget(surface, which) : surface.foldTargetAtKeys();
      if (!p) throw new ActionRefused("select a list item with children first");
      const out = surface.toggleListPreview(p, on); surface.noteAgent(actor, "changed list preview"); host.redraw(); return out;
    },
  }),
  "folds": def({
    summary: "list the note's fold points (headings, and list items with nested lines): which are folded, and the line each is on",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole();
      const { points, lines } = surface.foldsIn(m);
      const shown = new Set(surface.visibleFolds(m).map(p => p.key));
      return { folds: points.map((p, i) => ({ n: i + 1, kind: p.kind, level: p.level, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.effectiveFolded(p), shown: shown.has(p.key) })) };
    },
  }),
  "fold": def({
    summary: "fold a heading (hiding through the next heading of its level or higher) , a list item (hiding its nested items and continuation lines) or a callout (to its title); all=true folds every outermost one (F when nothing is folded). Reading state only: the note's text never changes", keys: readerKeys("fold", { keys: "click", does: "on a fold" }),
    touches: "tile", while: "typing", replay: "safe", way: "an agent folds a reader the person isn't typing in",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "fold every outermost heading and list item" } },
    examples: [
      { act: "fold text=\"Planting dates\"", does: "folds the Planting dates heading, hiding its section" },
      { act: "fold all=true", does: "folds every outermost heading and list item" },
    ],
    run: (args, on, actor) => runFold(true, args, on, actor),
  }),
  "unfold": def({
    summary: "unfold a heading, list item or callout; all=true unfolds everything (F when something is folded)", keys: readerKeys("unfold", { keys: "click", does: "on a fold" }),
    touches: "tile", while: "typing", replay: "safe", way: "an agent unfolds a reader the person isn't typing in",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "unfold everything in this reader" } },
    examples: [
      { act: "unfold line=14", does: "unfolds the heading or list item on note line 14" },
      { act: "unfold all=true", does: "unfolds every heading, list item and callout in this reader" },
    ],
    run: (args, on, actor) => runFold(false, args, on, actor),
  }),
  "fold.toggle": def({
    summary: "fold a heading, list item or callout, or unfold it if it's folded; with none named, the person's: the one ( ) selected, else the section being read", keys: readerKeys("fold.toggle", { keys: "click", does: "on a fold" }),
    touches: "tile", while: "typing", replay: "safe", way: "an agent folds a reader the person isn't typing in",
    args: FOLD_ARGS,
    examples: [
      { act: "fold.toggle text=\"Seed list\"", does: "folds the Seed list heading, or unfolds it if it is folded" },
      { act: "fold.toggle n=2", does: "toggles the second fold point, as folds lists them" },
    ],
    async run(args, { surface, host, standing }, actor) {
      const none = args.text === undefined && args.line === undefined && args.n === undefined;
      const draft = surface.draft;
      if (draft) {
        const points = draft.answerFolds();
        const p = args.n !== undefined ? points[args.n - 1] : points.find(p => args.text !== undefined ? p.text === args.text : p.line === (args.line ?? draft.row + 2) - 1);
        if (!p) throw new ActionRefused("name an answer fold in the draft by its line or number");
        const folded = draft.toggleAnswer(p);
        host.redraw();
        return { line: p.line + 1, folded };
      }
      if (none && !standing) throw new ActionRefused("say which heading, list item or callout: one of text=, line= or n= (folds lists them)");
      const at = none ? surface.foldTargetAtKeys() : null;
      if (none && !at) throw new ActionRefused("nothing to fold here · ( ) pick a heading or a list item");
      const now = surface.msg;
      const p = at ?? (now && !now.partial ? foldPointIn(surface, now, args) : await foldTarget(surface, args));
      const on = !surface.effectiveFolded(p);
      surface.setFold(p, on, standing);
      surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p)}`);
      host.redraw();
      return foldResult(surface, p);
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
