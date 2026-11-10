// sources.*: the Sources inspector (PIE-956 S6b), what generates the note's regions and the lines that call it;
// where its float goes is ./placement.ts's (sources.grip, sources.move, sources.place).
import { ATTACHED_KEYS } from "../attached-keys";
import { FOLDS, itemsOf, type SourcesFold } from "../sources";
import { RECORDED_AS } from "../../socket";
import { isOutlineNote } from "../../authored";
import { modeActionKeys } from "../modes";
import { noteRow, type On } from "./shared";
import { readerKeys } from "../reader-keys";
import { type ActionDef, ActionRefused, def } from "../actions";

export const SOURCES_DEFS = {
  "sources.open": def({
    summary: "open the Sources inspector on this note (PIE-956): every generated region (handler lines, ::=, ::use, figures, ::fields, ::if, written output) with when it last read, from the service's one answer (site.sources), beside the note when the reader is wide. A page shows none of its mechanics by default; this is where \"where this comes from\" goes. An agent's call answers the same list and opens nothing in the person's reader",
    keys: readerKeys("sources.open", { keys: "click", does: "the header's [sources]" }),
    touches: "shape", replay: "safe", says: () => "opened the sources", way: "the inspector opens beside their note · an agent reads the list in the answer, or sources.at line=",
    menu: noteRow("where this comes from (sources)", "S", { now: ({ surface }) => (!surface.msg || !isOutlineNote(surface.msg) || surface.msg.partial ? { hide: true } : null) }),
    args: {},
    run: (_, { surface, host, standing }, actor) => surface.openSources(host, actor, standing),
  }),
  "sources.at": def({
    summary: "open the Sources inspector on the generated region that holds a line: line= (from 1), else the person's selection, `[ ]` position or reading line. The passage toolbar's \"Where from\" (a then w) is this. An agent's call answers that source's row and opens nothing in their reader",
    keys: [{ keys: "a then w", does: "with words selected in a generated region" }, { keys: "click", does: "[Where from]" }],
    touches: "shape", replay: "safe", way: "the inspector opens beside their note · an agent reads the source in the answer",
    args: { line: { type: "number", optional: true, about: "the note line, from 1 (default: the selection's, else the [ ] position's, else the reading line)" } },
    examples: [
      { act: "sources.at line=14", does: "opens the Sources inspector on the generated region that holds line 14" },
    ],
    run({ line }, { surface, host, standing }, actor) {
      const at = line !== undefined ? { line: line - 1 } : standing ? surface.regionHere() : null;
      if (!at || ("line" in at && at.line < 0)) throw new ActionRefused("say which line: line=<from 1>, or select words (or put [ ] on a line) in a generated region first");
      return surface.openSources(host, actor, standing, at);
    },
  }),
  "sources.field": def({
    summary: "type in the inspector's property field, select a schema choice, save or cancel it", keys: modeActionKeys(ATTACHED_KEYS, "sources.field"),
    touches: "draft", draft: "write", replay: "ask", person: "the field is the person's; an agent passes value= to sources.set",
    args: { op: { type: "string", about: "text, key, pick, toggle, save or cancel" }, value: { type: "string", optional: true, about: "typed text or key name" }, n: { type: "number", optional: true, about: "choice from zero" } },
    examples: [{ act: "sources.field op=save", does: "writes the field through draft.patch" }],
    run: async ({ op, value, n }, { surface, host }) => { await surface.sourcesMode?.view.input(op, value, n); host.redraw(); return { edited: true }; },
  }),
  "sources.select": def({
    summary: "select text in the inspector without selecting the reader behind it", keys: "a drag in the panel",
    touches: "shape", replay: "safe", person: "the inspector selection belongs to the person",
    args: { phase: { type: "string", about: "start or drag" }, row: { type: "number", about: "content row from zero" }, col: { type: "number", about: "column from zero" } },
    examples: [{ act: "sources.select phase=start row=2 col=0", does: "starts selecting panel text" }],
    run: ({ phase, row, col }, { surface, host }) => {
      const mode = surface.sourcesMode;
      if (!mode) throw new ActionRefused("S opens the Sources inspector");
      surface.focusSources(host, true);
      if (phase === "start") mode.view.begin({ row, col }); else mode.view.extend({ row, col });
      host.redraw();
      return { text: mode.view.text() };
    },
  }),
  "sources.focus": def({
    summary: "give the keys to the Sources inspector or back to the reader, keeping the panel open", keys: "S in the reader, a click in the panel or its footer",
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: { on: { type: "boolean", about: "true gives keys to sources; false returns them to the reader" } },
    examples: [{ act: "sources.focus on=false", does: "returns keys to the reader" }],
    run: ({ on }, { surface, host }) => surface.focusSources(host, on),
  }),
  "sources.close": def({
    summary: "close the Sources inspector", keys: modeActionKeys(ATTACHED_KEYS, "sources.close"), touches: "shape", replay: "safe", says: () => "closed the sources", confirms: true, person: "the inspector is the person's view; an agent reads sources.open",
    args: {}, run: (_, { surface, host }) => surface.closeSources(host),
  }),
  "sources.back": def({
    summary: "from one source back to the list; from the list, close the inspector", keys: modeActionKeys(ATTACHED_KEYS, "sources.back"), touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: {}, run: (_, { surface, host }) => surface.backSource(host),
  }),
  "sources.pick": def({
    summary: "move in the inspector: the next or previous source in the list (by=), or the nth (n=); inside one source, its next row (a fold, a parameter, a copy)", keys: modeActionKeys(ATTACHED_KEYS, "sources.pick"),
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: { by: { type: "number", optional: true, about: "rows to move; negative is up" }, n: { type: "number", optional: true, about: "the row, from 1" } },
    examples: [
      { act: "sources.pick by=1", does: "moves to the next source in the inspector's list" },
      { act: "sources.pick n=3", does: "moves to the third source in the list" },
    ],
    run: ({ by, n }, { surface, host }) => surface.pickSource(host, by, n),
  }),
  "sources.enter": def({
    summary: "⏎ in the inspector: open the selected source; on a row of one, fold or unfold it, edit the parameter (the person is asked), jump to the transform's note, or copy", keys: modeActionKeys(ATTACHED_KEYS, "sources.enter"),
    touches: "draft", replay: "ask", draft: "write", person: "the inspector is the person's view; an agent reads sources.open and writes with sources.set source= param= value=",
    args: { n: { type: "number", optional: true, about: "the row, from 1 (default: the selected one)" }, fresh: { type: "boolean", optional: true, about: "open a result beside the reader" } },
    examples: [
      { act: "sources.enter n=2", does: "does what enter does on row 2 of the inspector, such as opening that source" },
    ],
    run: ({ n, fresh }, { surface, host }, actor) => surface.enterSource(host, actor, n, fresh),
  }),
  "sources.item": def({
    summary: "a click on a row of an open source: it is the focused row, and does what ⏎ does there", keys: "a click on a row", touches: "draft", replay: "ask", draft: "write", person: "the inspector is the person's view; an agent reads sources.open and writes with sources.set source= param= value=",
    args: { n: { type: "number", about: "the row, from 1" } },
    examples: [
      { act: "sources.item n=2", does: "focuses row 2 of the open source and does what enter does there" },
    ],
    run: ({ n }, { surface, host }, actor) => surface.enterSource(host, actor, n),
  }),
  "sources.fold": def({
    summary: "fold or unfold one of the open source's three parts: query (its parameters), transform (the code or template that shaped it) or result (its rows)", keys: modeActionKeys(ATTACHED_KEYS, "sources.fold"),
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads sources.open",
    args: { fold: { type: "string", about: `${FOLDS.join(", ")}` } },
    examples: [
      { act: "sources.fold fold=transform", does: "folds or unfolds the open source's transform part" },
      { act: "sources.fold fold=result", does: "folds or unfolds the open source's result rows" },
    ],
    run: ({ fold }, { surface, host }) => { if (!(FOLDS as readonly string[]).includes(fold)) throw new ActionRefused(`fold is ${FOLDS.join(", ")}, not ${JSON.stringify(fold)}`); return surface.foldSource(fold as SourcesFold, host); },
  }),
  "sources.refresh": def({
    summary: "read the sources again (\"Updated … ⟳\"): in the list with all=true (r), every line that runs on the note is run again first, as the person asks for it; on one source, only that line. Never run by a bare key outside the inspector",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.refresh"), touches: "nothing", replay: "ask", person: "the inspector is the person's view; an agent runs lines again with projection.refresh line=",
    args: { all: { type: "boolean", optional: true, about: "run every line that runs on the note again, then read (default: from the list)" } },
    examples: [
      { act: "sources.refresh all=true", does: "runs every line that runs on the note again, then reads the sources" },
      { act: "sources.refresh", does: "runs the open source's line again and reads its rows" },
    ],
    run: ({ all }, { surface, host }, actor) => surface.refreshSources(host, actor, all === true),
  }),
  "sources.set": def({
    summary: "edit one source parameter: figure properties use the shared inspector field and draft.patch against their YAML; handler slots and ::use props use the existing line save. Schema choices and result property names supply the figure's choices; title and query take text, with query warnings after capture. An agent passes value=. Recorded as whoever asks; ctrl+z (sources.undo) takes it back",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.set"), touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { source: { type: "string", optional: true, about: "which source: its number in sources.open's list, or its key (default: the one open in the inspector)" }, param: { type: "string", optional: true, about: "the parameter (default: the focused row's)" }, value: { type: "string", optional: true, about: "the new value (the person is asked when it is left out)" } },
    examples: [
      { act: "sources.set source=2 param=limit value=20", does: "writes 20 into the limit parameter of source 2's line in the note" },
    ],
    run: ({ source, param, value }, { surface, host }, actor) => surface.setSourceParam(source, param, value, host, actor),
  }),
  "sources.copy": def({
    summary: "copy a part of the open source: query (its line), transform (its code) or result (every row, tab separated); the person's goes to the clipboard, an agent's is returned", keys: modeActionKeys(ATTACHED_KEYS, "sources.copy"),
    touches: "nothing", replay: "safe",
    args: { part: { type: "string", optional: true, about: "query, transform or result (default: the focused copy row's, else result)" }, source: { type: "string", optional: true, about: "which source: its number in sources.open's list, or its key (default: the one open in the inspector)" } },
    examples: [
      { act: "sources.copy part=query", does: "returns the open source's query line" },
      { act: "sources.copy part=result source=2", does: "copies every row of source 2, tab separated" },
    ],
    run({ part, source }, { surface, host }, actor) {
      const P = surface.sourcesMode?.panel, s = P?.answer?.sources[P.open ?? -1];
      const at = P && s ? itemsOf(s, P.folds)[P.item] : undefined;
      const which = part ?? (at?.kind === "copy" ? at.part : "result");
      if (which !== "query" && which !== "transform" && which !== "result") throw new ActionRefused("part is query, transform or result");
      return surface.copySource(which, host, actor, source, !part);
    },
  }),
  "sources.download": def({
    summary: "save the source's raw rows as CSV or JSON; returns the file path", keys: modeActionKeys(ATTACHED_KEYS, "sources.download"),
    touches: "nothing", replay: "ask",
    args: { format: { type: "string", about: "csv or json" }, source: { type: "string", optional: true, about: "source number or key; default the open source" }, path: { type: "string", optional: true, about: "new file path; default the door's downloads folder" } },
    examples: [
      { act: "sources.download format=csv", does: "saves the open source's rows as CSV and returns the file path" },
      { act: "sources.download format=json source=2", does: "saves source 2's rows as JSON and returns the file path" },
    ],
    run({ format, source, path }, { surface, host }) {
      if (format !== "csv" && format !== "json") throw new ActionRefused("format is csv or json");
      return surface.downloadSource(format, host, source, path);
    },
  }),
  "sources.jump": def({
    summary: "jump to the open source's transform note (the script, the template): the person's reader opens it; an agent is told its id and reads it with outline_read", keys: modeActionKeys(ATTACHED_KEYS, "sources.jump"),
    touches: "tile", replay: "ask", way: "the jump leaves the page they are reading · an agent reads the note with outline_read",
    args: {}, run: (_, { surface, host, standing }, actor) => surface.jumpSource(host, actor, standing),
  }),
  "sources.scroll": def({
    summary: "scroll the Sources inspector's rows (a tall result or transform), by rows; moving the focus scrolls it into view too", keys: modeActionKeys(ATTACHED_KEYS, "sources.scroll"),
    touches: "shape", replay: "safe", person: "the inspector is the person's view; an agent reads the rows in sources.open's answer",
    args: { by: { type: "number", about: "rows; negative is up" }, page: { type: "boolean", optional: true, about: "by= counts pages (the rows shown, less one: PgUp PgDn), not rows" } },
    examples: [
      { act: "sources.scroll by=1 page=true", does: "scrolls the inspector's rows down a page" },
      { act: "sources.scroll by=-8", does: "scrolls the inspector's rows up eight rows" },
    ],
    run: ({ by, page }, { surface, host }) => surface.scrollSources(host, by, page),
  }),
  "sources.undo": def({
    summary: "undo the last source edit, line insertion or button slot written on this note, from any reader or press (an agent undoes its own, the person theirs), with what the press that slot finished did (its run, or its layout step while it is still the newest); refused if that text changed again since",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.undo"), touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {}, run: (_, { surface, host }, actor) => surface.undoSource(host, actor),
  }),
} satisfies Record<string, ActionDef<any, On>>;
