// Selecting and copying: select, select.copy, select.clear, the blocks a reader can copy (blocks, block.copy) and
// the note itself (note.copy).
import { noteRow, type On } from "./shared";
import { type ActionDef, ActionRefused, def } from "../actions";

export const SELECT_DEFS = {
  "select": def({
    summary: "select text in the note as the reader draws it: text= (links read as their titles) or line= to= (1 is the subject). An agent's selection is its own, drawn in its own tint; the person's is never touched", keys: [{ keys: "drag", does: "select" }, { keys: "double-click", does: "selects a word" }, { via: "a triple click" }, { keys: "v then h j k l", does: "select with the keys" }],
    touches: "nothing", replay: "safe",
    args: {
      text: { type: "string", optional: true, about: "the words as they're drawn (blanks and row breaks match any blank)" },
      line: { type: "number", optional: true, about: "the first note line to select (1 is the subject)" },
      to: { type: "number", optional: true, about: "with line: the last note line" },
      n: { type: "number", optional: true, about: "with text: which time it's drawn, from 1" },
    },
    examples: [
      { act: "select text=\"seed packets\"", does: "selects the words seed packets as the note draws them" },
      { act: "select line=3 to=5", does: "selects note lines 3 to 5" },
    ],
    async run(args, { surface, host }, actor) {
      await surface.whole();
      const s = surface.selectBy(args);
      s.w = surface.renderedWidth(); s.top = surface.renderedTop();
      if (actor.kind === "agent") surface.agentSelection = { id: actor.id, sel: s };
      else surface.selection = s;
      const out = surface.describeSelection(s)!;
      surface.noteAgent(actor, `selected ${out.chars} chars`);
      host.redraw();
      return out;
    },
  }),
  "blocks": def({
    summary: "list the code blocks, quotes and callouts this reader draws, in reading order: number, kind, size, note lines and first words (the current one marked). block.copy n= copies one's content",
    reads: true, touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { blocks: surface.describeBlocks() };
    },
  }),
  "block.copy": def({
    summary: "copy a code block's, quote's or callout's content as written: a fence's lines without the fence, a quote's lines without the > markers, a callout's body without its marker line (inner Markdown kept). The person's goes to their clipboard (OSC 52) and the status line says \"copied N lines\"; an agent's is returned to it and never touches the person's clipboard",
    keys: "y or cmd+c on the current element ([ ] to the block, or anything in it), ⏎ on a block element, a click on its ⧉ control",
    touches: "nothing", replay: "safe",
    args: {
      n: { type: "number", optional: true, about: "which block, from 1, as blocks lists them; default the block the person's current element is in" },
      element: { type: "number", optional: true, about: "or the block the nth element (elements lists them) is, or is in: an inline code span is one" },
    },
    examples: [
      { act: "block.copy n=1", does: "copies the first code block, quote or callout's content, as written" },
      { act: "block.copy element=4", does: "copies the block the fourth element is, or is in" },
    ],
    async run({ n, element }, { surface, host }, actor) {
      if (actor.kind === "agent") await surface.whole();
      if (n !== undefined && element !== undefined) throw new ActionRefused("say n or element, not both");
      const r = surface.copyBlock(n ?? (element !== undefined ? surface.blockNumberOf(element) : undefined), host, actor);
      host.redraw();
      return r;
    },
  }),
  "note.copy": def({
    summary: "copy the whole note as stored (header chips, fences and all) with each live figure's results under it as Markdown (PIE-1355: a checklist as - [ ]/- [x] steps, a table as a table, tabs a list per group, links ((id|title)); at most 50 rows a figure, a cut said with the ep0ch find command that reads the rest); source=true copies the text alone. The person's goes to their clipboard (OSC 52) and the status line says \"copied the page with N figures' results (K cut)\"; an agent's is returned to it and never touches the person's clipboard",
    keys: [{ keys: "Y", does: "with nothing selected" }, { via: "the tile menu's \"copy note\" (and \"copy source only\")" }],
    touches: "nothing", replay: "safe",
    menu: [noteRow("copy note", "Y"), { ...noteRow("copy source only", "", {}), args: { source: true } }],
    args: { source: { type: "boolean", optional: true, about: "the note's text alone, without its figures' results" } },
    examples: [{ act: "note.copy", does: "answers the note's text with its live figures' results" }, { act: "note.copy source=true", does: "answers the note's text as stored" }],
    async run({ source }, { surface, host }, actor) {
      const r = await surface.copyNote(host, actor, source === true);
      host.redraw();
      return r;
    },
  }),
  "select.copy": def({
    summary: "copy the selection: what's drawn, or source=true for its markup. The person's goes to their clipboard (OSC 52), and a selection they make with the mouse is copied when the button comes up (copy on select; EP0CH_COPY_ON_SELECT=0 turns it off); an agent's is returned to it and never touches the person's clipboard", keys: [{ keys: "y Y cmd+c", does: "copy" }, { keys: "click", does: "the [y copy] control" }, { keys: "drag", does: "the release of a drag copies (or a double or triple click)" }],
    // The person's copy is of their mouse selection, which no step records: replayed, it would find nothing selected.
    touches: "nothing", replay: "safe", record: false,
    args: { source: { type: "boolean", optional: true, about: "the note's own text (markup) instead of what's drawn" } },
    examples: [
      { act: "select.copy", does: "copies the selected words as the note draws them" },
      { act: "select.copy source=true", does: "copies the selection's markup instead of what is drawn" },
    ],
    run({ source }, { surface, host }, actor) {
      if (actor.kind === "user") {
        if (!surface.selection) throw new ActionRefused("nothing is selected");
        const r = surface.copySelection(!!source, host);
        if (!r) throw new ActionRefused(source ? "no source to copy: only the header's details are selected" : "only blanks are selected");
        host.redraw();
        return { copied: r.chars, text: r.text, clipboard: true };
      }
      const mine = surface.agentSelection?.id === actor.id ? surface.agentSelection.sel : null;
      if (!mine) throw new ActionRefused("you've selected nothing in this reader; select first (the person's own selection is theirs)");
      const d = surface.describeSelection(mine);
      if (!d) throw new ActionRefused("this reader doesn't show the note's text now");
      if (source && d.source === undefined) throw new ActionRefused("no source to copy: only the header's details are selected");
      const text = source ? d.source! : d.text;
      host.ctx.flash(`copied ${[...text].length} chars${source ? " of source" : ""} for itself · your clipboard is untouched`);
      surface.noteAgent(actor, `copied ${[...text].length} chars`);
      return { copied: [...text].length, text, clipboard: false };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const SELECT_CLEAR_DEFS = {
  "select.clear": def({
    summary: "let go of the selection (an agent's own; the person's is theirs to clear)", keys: "esc, v (leaving the keyboard selection), click",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface, host }, actor) {
      const had = actor.kind === "agent" ? surface.agentSelection?.id === actor.id : !!surface.selection;
      if (actor.kind === "agent") { if (had) surface.agentSelection = null; } else surface.selection = null;
      host.redraw();
      return { cleared: had };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
