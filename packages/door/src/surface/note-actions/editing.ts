// The edit's actions: the rich editor (rich.*), snippets, the draft's own keys forwarded (draft.*), the completion list
// (complete.*), opening and arming the edit (edit, edit.arm, edit.external, edit.follow), and saving, running and
// closing it (edit.save, edit.run, edit.close, …).
import { ATTACHED_KEYS } from "../attached-keys";
import { completerOf, COMPLETION_ACCEPT, COMPLETION_ACTIONS, COMPLETION_ASK, COMPLETION_COPY, COMPLETION_DEFINITION, COMPLETION_DISMISS, COMPLETION_DOCS, COMPLETION_MOVE, COMPLETION_PREVIEW, COMPLETION_STEP, type CompletionBoard, completionOf, insertCompletion, lookupCompletion, nearOf, recordCompletionPick, reopenReference, actionHereAt } from "../completer";
import { elementEdit, type ElementOperation } from "../element-editor";
import { handToEditor, noteRow, type On, openCompleter, writingIn, type SessionKind, saveDraft, REFUSED } from "./shared";
import { modeActionKeys } from "../modes";
import { openInEditor } from "../editor";
import { type ActionDef, ActionRefused, def } from "../actions";
import { type CompletionTarget, completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
import { DRAFT_ACTIONS, type DraftActionArgs } from "../../edit";
// The whole set, read only when an action runs: complete.accept hands an agent's pick to `complete` and its checks.
import { NOTE_ACTIONS } from "../note";
import type { Key } from "../../term";
import { CONFIRM_HINT, hintStatus } from "../hint-card";
import { clipboardImage, droppedImage, imageLine, imagePathAt, keepImage, noClipboardImage } from "../../paste-image";
import { editArmMs } from "../../arm";
import { errorDetails } from "../../status-log";
import { hintSetting } from "../hints";
import { hostname } from "node:os";
import { linkOf, linkOfRef } from "../link-model";
import { readerKeys } from "../reader-keys";
import { subject } from "../../board";
import { RECORDED_AS, recordedAnswer } from "../../socket";
import { actionLine, actRequestOf, lineWords } from "@ep0ch/outline-core/action-line";
import { callSplice, COMPONENTS_PAGE, makeComponent } from "../component-new";
import { insertButton, insertNoteLine } from "../note-insert";
import { keepUnsent, takeStrays, unsent } from "../../draft-session";
import { ASKED_IN_PLACE } from "../../extensions";

export const EDIT_DEFS = {
  "rich.toggle": def({
    summary: "switch rich/raw edit; both views use the same draft",
    keys: "ctrl+o while editing, esc in rich edit", touches: "draft", draft: "type", replay: "safe",
    menu: noteRow("rich edit", "", {}),
    args: { on: { type: "boolean", optional: true, about: "rich view on or off" } },
    examples: [
      { act: "rich.toggle on=true", does: "turns rich edit on, opening the note's draft with its tables drawn as cells" },
      { act: "rich.toggle on=false", does: "turns rich edit off, back to the draft's raw text" },
    ],
    async run({ on }, { surface, host }, actor) {
      const { draft: d } = await surface.ensureDraft(host);
      const v = elementEdit(d);
      if (on ?? !v.on) v.open(actor); else v.on = false;
      d.follow = false;
      host.redraw(); return { rich: v.on };
    },
  }),
  "rich.move": def({
    summary: "move between cells; up/down leave a table at its edges",
    keys: "tab, shift+tab, up, down, enter in rich edit", touches: "draft", draft: "type", replay: "ask",
    args: { direction: { type: "string", about: "next, previous, up, down, left or right" } },
    examples: [
      { act: "rich.move direction=next", does: "moves the cursor to the next cell of the table" },
      { act: "rich.move direction=down", does: "moves the cursor one row down, leaving the table below its last row" },
    ],
    run({ direction }, { surface, host }) {
      if (!surface.draft) throw new ActionRefused(REFUSED.noRich);
      if (!["next", "previous", "up", "down", "left", "right"].includes(direction)) throw new ActionRefused("direction must be next, previous, up, down, left or right");
      elementEdit(surface.draft).move(direction); host.redraw();
    },
  }),
  "rich.erase": def({
    summary: "erase a cell character; keep its delimiters",
    keys: "backspace, delete in rich edit", touches: "draft", draft: "type", replay: "ask",
    args: { backward: { type: "boolean", about: "delete before the cursor" } },
    examples: [
      { act: "rich.erase backward=true", does: "erases the character before the cursor in the cell, keeping the table's bars" },
      { act: "rich.erase backward=false", does: "erases the character after the cursor in the cell" },
    ],
    run({ backward }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused(REFUSED.noRich);
      elementEdit(surface.draft).erase(backward, actor); host.redraw();
    },
  }),
  "rich.scroll": def({
    summary: "scroll the rendered draft without moving its cell cursor",
    keys: "wheel, pgup, pgdn in rich edit", touches: "draft", draft: "type", replay: "safe",
    args: { by: { type: "number", about: "rows to scroll" } },
    examples: [
      { act: "rich.scroll by=5", does: "scrolls the rendered draft down five rows, the cell cursor staying put" },
      { act: "rich.scroll by=-5", does: "scrolls the rendered draft up five rows" },
    ],
    run({ by }, { surface, host }) {
      if (!surface.draft) throw new ActionRefused(REFUSED.noRich);
      elementEdit(surface.draft).scroll(by); host.redraw();
    },
  }),
  "rich.input": def({
    summary: "type or paste into a component field without changing its delimiters",
    keys: [{ via: "typing in rich edit" }, { keys: "paste", does: "in rich edit" }, { keys: "ctrl+k", does: "in rich edit" }], touches: "draft", draft: "type", replay: "ask",
    args: { text: { type: "string", about: "text to insert" }, cut: { type: "boolean", optional: true, about: "cut to the field's end" } },
    examples: [
      { act: 'rich.input text="3 trays"', does: "types 3 trays into the current table cell at the cursor" },
    ],
    run({ text, cut }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused(REFUSED.noRich);
      elementEdit(surface.draft).input(text, actor, cut); host.redraw();
    },
  }),
  "rich.set": def({
    summary: "replace the current component field, in the draft's undo history; ctrl+s saves",
    touches: "draft", draft: "type", replay: "ask",
    args: { value: { type: "string", about: "the cell's value" } },
    examples: [
      { act: 'rich.set value="12 packets"', does: "replaces the current cell's text with 12 packets, as one undo step" },
    ],
    run({ value }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused(REFUSED.noRich);
      elementEdit(surface.draft).set(value, actor); surface.noteAgent(actor, "edited a cell", surface.draft); host.redraw();
    },
  }),
  "rich.change": def({
    summary: "add, remove or move a row or column in the current table, as one draft undo step",
    keys: [{ keys: "alt+r", does: "add a row under this one, in rich edit" }, { keys: "alt+d", does: "remove this row, in rich edit" }, { keys: "alt+v", does: "add a column, in rich edit" }, { keys: "alt+x", does: "remove this column, in rich edit" }], touches: "draft", draft: "type", replay: "ask",
    args: { op: { type: "string", about: "row.add, row.remove, column.add, column.remove, row.move, column.move" }, to: { type: "number", optional: true, about: "destination row or column, from zero" } },
    examples: [
      { act: "rich.change op=row.add", does: "adds an empty row under the current row of the table" },
      { act: "rich.change op=column.move to=0", does: "moves the current column to the first place in the table" },
    ],
    run({ op, to }, { surface, host }, actor) {
      if (!surface.draft) throw new ActionRefused(REFUSED.noRich);
      if (!["row.add", "row.remove", "column.add", "column.remove", "row.move", "column.move"].includes(op)) throw new ActionRefused("unknown table operation");
      elementEdit(surface.draft).change(op as ElementOperation, actor, to); surface.noteAgent(actor, op, surface.draft); host.redraw();
    },
  }),
  "snippet.next": forwardDraft("snippet.next"),
  "snippet.previous": forwardDraft("snippet.previous"),
  "snippet.end": forwardDraft("snippet.end"),
  "draft.newline": forwardDraft("draft.newline"),
  "draft.indent": forwardDraft("draft.indent"),
  "draft.outdent": forwardDraft("draft.outdent"),
  "draft.place": forwardDraft("draft.place"), "draft.go": forwardDraft("draft.go"), "draft.select": forwardDraft("draft.select"), "draft.line": forwardDraft("draft.line"), "draft.erase": forwardDraft("draft.erase"), "draft.cut": forwardDraft("draft.cut"), "draft.wrap": forwardDraft("draft.wrap"),
  "draft.scroll": { ...forwardDraft("draft.scroll"), keys: modeActionKeys(ATTACHED_KEYS, "draft.scroll") },
  "draft.preview": { ...forwardDraft("draft.preview"), keys: modeActionKeys(ATTACHED_KEYS, "draft.preview"), confirms: true, says: out => out.preview ? "opened the edit preview" : "closed the edit preview" },
  "draft.paste": forwardDraft("draft.paste"),
  "draft.undo": forwardDraft("draft.undo"),
  "draft.redo": forwardDraft("draft.redo"),
  "draft.copy": forwardDraft("draft.copy"),
  "complete.copy": def({
    ...COMPLETION_COPY,
    run(args, { surface }, actor) {
      const c = surface.writingDraft && completerOf(surface.writingDraft);
      if (!c?.shown) throw new ActionRefused("type :: in an edit first");
      return COMPLETION_ACTIONS.run("complete.copy", args, c, actor);
    },
  }),
  "complete.definition": def({
    ...COMPLETION_DEFINITION,
    run(args, { surface }, actor) {
      const c = surface.writingDraft && completerOf(surface.writingDraft);
      if (!c?.shown) throw new ActionRefused("type @ in an edit first");
      return COMPLETION_ACTIONS.run("complete.definition", args, c, actor);
    },
  }),
  "complete.docs": def({ ...COMPLETION_DOCS,
    run(args, { surface }, actor) { return COMPLETION_ACTIONS.run("complete.docs", args, openCompleter(surface), actor); },
  }),
  "complete.preview": def({ ...COMPLETION_PREVIEW,
    run(args, { surface }, actor) { return COMPLETION_ACTIONS.run("complete.preview", args, openCompleter(surface), actor); },
  }),
  // The open list's own keys (PIE-1339), on this reader's edit or the comment being written: the code the popup's keys,
  // wheel and clicks run. An agent's are its own draft's, or one it was invited into (draftRule's `type`).
  "complete.move": def({
    ...COMPLETION_MOVE,
    run(args, { surface }, actor) { return COMPLETION_ACTIONS.run("complete.move", args, openCompleter(surface), actor); },
  }),
  "complete.accept": def({
    ...COMPLETION_ACCEPT,
    args: { ...COMPLETION_ACCEPT.args, invitation: { type: "string", optional: true, about: "in the person's draft: the invitation their @name line gave this agent (used up only when it lands)" } },
    async run({ n, invitation }, on, actor): Promise<unknown> {
      const c = openCompleter(on.surface), s = c.shown!;
      // An agent's insert is `complete insert=`'s: the same checks, the same invitation spent, said on screen.
      if (actor.kind === "agent") return NOTE_ACTIONS.run("complete", { insert: n ?? s.index + 1, expect: s.items[(n ?? s.index + 1) - 1]?.insertion, invitation }, on, actor);
      return COMPLETION_ACTIONS.run("complete.accept", { n }, c, actor);
    },
  }),
  "complete.ask": def({
    ...COMPLETION_ASK,
    run(args, { surface, host }, actor) {
      const d = surface.writingDraft;
      // Made on first use, as a key typed there would (the edit's own completer, with its note as the search's context).
      const c = d && (completerOf(d) ?? surface.completer(d, host));
      if (!c) throw new ActionRefused("nothing is being written here; open an edit or a comment first");
      return COMPLETION_ACTIONS.run("complete.ask", args, c, actor);
    },
  }),
  "complete.dismiss": def({
    ...COMPLETION_DISMISS,
    run(args, { surface }, actor) { return COMPLETION_ACTIONS.run("complete.dismiss", args, openCompleter(surface), actor); },
  }),
  "complete.step": def({
    ...COMPLETION_STEP,
    run(args, { surface }, actor) {
      const d = surface.writingDraft;
      const c = d && completerOf(d);
      if (!c?.shown) throw new ActionRefused("type :: in an edit first");
      return COMPLETION_ACTIONS.run("complete.step", args, c, actor);
    },
  }),
  "complete": def({
    words: "complete what you're typing: a page, a reference, a file, a callout or a property",
    summary: "completion, as typing [[, ((, [file::, > [!, ::component, a property's [key:: or a figure's YAML offers it: the candidates for text (such as [[PIE-4, ((beds, ((garden#, [file::src/, [heading-pattern::, or a ::graph-meter block's lines ending in ti), or at the open draft's cursor; insert=n puts the nth into the draft (expect=<its insertion> refuses it if the list changed meanwhile); refine=^ or refine=# opens the finished ((reference)) at the draft's cursor again to search inside its note, as typing ^ or # in it does (PIE-762): a passage with no anchor gets one when inserted. Property keys and values come from the component schemas (PIE-618)",
    keys: [{ via: "typing [[ (( [file:: > [! ::component or [key:: while writing" }, { keys: "tab ctrl+space", does: "open the completion" }, { keys: "↑ ↓", does: "move in it" }, { keys: "enter tab", does: "choose", says: "insert the lit completion" }, { keys: "esc", does: "close it", says: "close the completion list" }, { keys: "^ #", does: "in a ((reference))" }],
    // Looking candidates up reads; putting one in types in the draft at its cursor: an agent's only in a draft it
    // opened and alone typed in, or one the person invited it into (an @name line; the insert uses the invitation up).
    touches: "draft", draft: "type", replay: "ask",
    touchesWith: ({ insert, refine }) => (insert === undefined && refine === undefined ? "nothing" : "draft"),
    args: {
      text: { type: "string", optional: true, about: "text ending in the token to complete; leave out to complete at the draft's cursor" },
      key: { type: "string", optional: true, about: "with text=: complete text as the value of this property (the property panel's field: the outline's values for it, then the schemas'); a [[ or (( in it still offers pages and blocks" },
      insert: { type: "number", optional: true, about: "put the nth candidate (from 1) into the draft at its cursor, as enter does" },
      step: { type: "number", optional: true, about: "list variations and arguments of this component row (from 1)" },
      refine: { type: "string", optional: true, about: "^ or #: open the finished ((reference)) at the draft's cursor again, to search inside its note (^ every passage, its anchors first; # its headings); then insert=n" },
      expect: { type: "string", optional: true, about: "with insert=: the nth candidate's insertion as listed; refused when the list has changed since (a pause can have Jev re-order it)" },
      invitation: { type: "string", optional: true, about: "insert= in the person's draft: the invitation their @name line gave this agent (one step, used up only when it lands); not for a draft of the agent's own" },
    },
    examples: [
      { act: 'complete text="[[seed-sw"', does: "lists the pages whose names match seed-sw, as typing [[seed-sw would" },
      { act: "complete insert=2", does: "puts the second candidate into the draft at the cursor" },
    ],
    async run({ text, key, insert, invitation, expect, refine, step }, { surface, host }, actor) {
      const board = host.ctx.board as unknown as CompletionBoard;
      if (typeof board?.completePages !== "function") throw new ActionRefused("this connection can't look references up");
      const d = surface.writingDraft;
      if ((insert !== undefined || refine !== undefined) && text !== undefined) throw new ActionRefused(`${insert !== undefined ? "insert" : "refine"} completes at the draft's cursor; leave text out`);
      if (refine !== undefined) {
        if (refine !== "^" && refine !== "#") throw new ActionRefused(`refine is ^ (every passage) or # (headings), not ${JSON.stringify(refine)}`);
        if (!d) throw new ActionRefused("nothing is being written here; open an edit or a comment first");
        if (d.busy) throw new ActionRefused(REFUSED.saving);
        if (!reopenReference(d, refine, actor)) throw new ActionRefused(`the draft's cursor (line ${d.row + 1}, column ${d.col + 1}) isn't in a finished ((reference)) without a label; put it inside one, or just after its ))`);
        surface.noteAgent(actor, `opened a ((reference)) to refine it with ${refine}`, d);
      }
      let target: CompletionTarget | null;
      if (text !== undefined) {
        const lines = text.split("\n"), line = lines.at(-1)!;
        target = completionTargetAtCursor(line, line.length, lines, lines.length - 1);
        if (!target && key) target = { kind: "filter-value", start: 0, end: line.length, query: line, key };
        if (!target) throw new ActionRefused(`nothing to complete: text should end inside [[, ((, [file::, > [!, ::component, a [key:: property or a figure's YAML (it ends ${JSON.stringify(line.slice(-20))})`);
      } else {
        if (!d) throw new ActionRefused("nothing is being written here; pass text=\"[[...\" or open an edit first");
        target = completionTargetAtCursor(d.lines[d.row] ?? "", d.col, d.lines, d.row);
        if (!target) throw new ActionRefused(`the draft's cursor (line ${d.row + 1}, column ${d.col + 1}) isn't inside [[, ((, [file::, > [!, ::component, a [key:: property or a figure's YAML`);
      }
      // The draft as the target was read from it: typing during the lookups below moves the token, and a
      // splice at the old span would land in the wrong place, so any change refuses the insert.
      const at = d && { text: d.text, row: d.row, col: d.col };
      const still = () => !!d && !!at && d.text === at.text && d.row === at.row && d.col === at.col;
      const own = surface.draft ? { blockId: surface.draft.blockId, text: surface.draft.text } : undefined;
      // What the person's popup shows, when it is open on this token (Jev's order included), so insert=n is
      // the nth they see; else the same lookup it makes, from the same note (with no draft, the note read here).
      const shown = d ? completionOf(d) : null;
      const r = text === undefined && shown && !shown.loading && shown.target.kind === target.kind && shown.target.start === target.start && shown.target.query === target.query
        ? shown : await lookupCompletion(board, target, own, { near: nearOf(d, own) ?? surface.msg?.id });
      if (step !== undefined) {
        const item = r.items[step - 1];
        if (!item?.children) throw new ActionRefused("step names a component row; complete text=:: lists them");
        // Its variations, then its arguments (each a `property` row), as the service answered them (PIE-1344).
        const variations = item.children.filter(it => it.kind !== "property"), args = item.children.filter(it => it.kind === "property");
        return { variations: variations.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion })), props: args.map(it => ({ key: it.label, type: it.detail, meaning: it.docs })) };
      }
      const out = {
        kind: target.kind, query: target.query, message: r.message || undefined, truncated: r.truncated ?? undefined,
        items: r.items.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion, kind: it.kind, blockId: it.blockId, address: it.address, fragmentId: it.fragmentId, detail: it.detail, docs: it.docs || undefined })),
      };
      if (insert === undefined) return out;
      const item = r.items[insert - 1];
      if (!item) throw new ActionRefused(`there is no candidate ${insert}; there are ${r.items.length}`);
      if (expect !== undefined && item.insertion !== expect) throw new ActionRefused(`candidate ${insert} is now ${item.insertion}, not ${expect}: the list changed (Jev may have re-ordered it); list it again`);
      if (!d || d.busy) throw new ActionRefused(d ? REFUSED.saving : "nothing is being written here");
      try {
        if (!still()) throw new Error("the draft changed while the references were looked up; ask again");
        const ds = surface.draftSession();
        if (invitation !== undefined && (!ds || ds.draft !== d)) throw new Error("the invitation is for another draft");
        const spend = invitation !== undefined ? () => ds!.spend(invitation, actor) : undefined;
        if (!await insertCompletion(board, d, target, item, own, still, actor, spend)) throw new Error("the draft changed while the reference was checked; ask again");
      } catch (e) { throw new ActionRefused(`not inserted: ${e instanceof Error ? e.message : String(e)}`); }
      if (r.pickKey) await recordCompletionPick(board, r.pickKey, item, target.query);
      surface.noteAgent(actor, `inserted ${item.insertion}`);
      host.redraw();
      return { ...out, inserted: item.insertion, dirty: d.dirty };
    },
  }),
  "edit": def({
    summary: "open the note for editing (its whole text, at the revision the service has now); external=true opens it in $EDITOR (a reader's ctrl+e; in an open edit, or a comment or reply being written, edit.external, ctrl+x ctrl+e, hands that over). The person's e arms it first (edit.arm) and ⏎ or e again opens it; a click on an edit control opens it at once", keys: "e then ⏎/e, ctrl+e then ⏎/ctrl+e (e or ctrl+e alone when arming is off)",
    touches: "draft", draft: "write", replay: "ask",
    menu: noteRow("edit", "e", { now: ({ surface }) => (surface.draft ? { hide: true } : null) }),
    personWith: a => (a.external ? "the $EDITOR handoff takes over the person's terminal; send the text with edit.text" : null),
    args: { external: { type: "boolean", optional: true, about: "hand the draft to $EDITOR (the person's keys only)" } },
    examples: [
      { act: "edit", does: "opens the note's whole text for editing, at the revision the service has now" },
      { act: "edit external=true", does: "opens the note in $EDITOR in a terminal tile beside the reader" },
    ],
    async run({ external }, { surface, host }, actor) {
      // Already writing here: that draft, or the comment or reply, goes to $EDITOR (edit.external's).
      if (external && (surface.draft || writingIn(surface))) return handToEditor(surface, host);
      if (surface.draft) return { already: true, id: surface.draft.blockId, baseRevision: surface.draft.base };
      const { draft: d } = await surface.ensureDraft(host);
      if (external) void openInEditor(host.ctx, d, () => surface.draft === d).then(() => host.redraw());
      surface.noteAgent(actor, "opened this note for editing");
      return { id: d.blockId, baseRevision: d.base };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

/** A draft action (src/edit.ts, DRAFT_ACTIONS) run on the reader's edit or comment being written. */
function forwardDraft<K extends keyof DraftActionArgs>(name: K): ActionDef<DraftActionArgs[K], On> {
  const info = DRAFT_ACTIONS.list().find(a => a.name === name)!, def = DRAFT_ACTIONS.def(name)!;
  return {
    summary: `${info.summary} (in this reader's edit or comment)`, keys: info.keys,
    touches: def.touches, ...(def.draft ? { draft: def.draft } : {}), replay: def.replay,
    args: info.args as ActionDef<DraftActionArgs[K], On>["args"],
    ...(def.examples ? { examples: def.examples } : {}),
    // Who an argument makes it the person's own for, as the draft's own action says (draft.undo past=true).
    ...(def.personWith ? { personWith: def.personWith as ActionDef<DraftActionArgs[K], On>["personWith"] } : {}),
    async run(args, { surface, host }, actor) {
      const w = surface.drafting ?? (surface.session?.mode === "compose" ? surface.session.writing : null);
      if (!w) throw new ActionRefused("nothing is being written in this reader; edit, or comment.write, opens a draft");
      const d = w.draft;
      if (d.busy) throw new ActionRefused(d.status.phase === "reloading" ? "the draft is reloading and its text is about to change · try again in a moment" : REFUSED.saving);
      // The person's draft is theirs: its cursor, view and preview move only by their keys and mouse (the session's rule).
      const r = await w.act(name, args, actor);
      // The person's copy reaches their clipboard, as the reader's select.copy does; an agent's is only returned.
      if (name === "draft.copy" && actor.kind === "user") {
        const c = r as { text: string; chars: number };
        if (host.ctx.copy?.(c.text) !== false) host.ctx.flash(`copied ${c.chars} chars`);
      }
      surface.noteAgent(actor, `used ${name} in the draft`);
      host.redraw();
      return r;
    },
  };
}

export const EDIT_OPEN_DEFS = {
  "edit.arm": def({
    hintId: "confirm",
    hint: (_, { surface, host }) => host.ctx.armed?.()?.of === surface ? CONFIRM_HINT : null,
    summary: "the person's e (ctrl+e: for $EDITOR) in a reader: arm the edit instead of opening it. The status bar asks `edit <title>? ⏎ · any other key cancels` and the reader's frame turns the edit's colour; ⏎ or the same key again within the window (edit.arm.set, or EP0CH_EDIT_ARM over it; default 2000 ms) opens it (edit), any other key lets it go and does what it does, and the window running out lets it go. edit.arm.set on=false (or EP0CH_EDIT_ARM=off) opens it at once. A click on an edit control, and an agent's edit, open at once",
    keys: readerKeys("edit.arm"), touches: "nothing", replay: "ask",
    person: "arming is the person's e key, so a stray key never opens an edit; an agent opens one with edit (edit.text puts text in it)",
    args: { external: { type: "boolean", optional: true, about: "arm ctrl+e's $EDITOR handoff instead" } },
    examples: [
      { act: "edit.arm", does: "asks in the status bar whether to edit the note; enter or e again opens it" },
      { act: "edit.arm external=true", does: "asks whether to edit the note in $EDITOR; ctrl+e again opens it" },
    ],
    run({ external }, { surface, host }) {
      const m = surface.requireNote();
      const kind: SessionKind = external ? "external" : "edit";
      // Opened as the key did before arming: through the host where it keeps track of the person's session.
      const open = (opener?: Key) => {
        // The reader moved on while it was armed (a lane's preview followed another card, the note was opened over):
        // the question named this note, so nothing opens on another.
        if (surface.msg?.id !== m.id) { host.ctx.flash("not opened: the reader shows another note now · e edits it"); host.redraw(); return; }
        if (host.startSession) return void host.startSession(kind, opener);
        void surface.startAsPerson(kind, host).catch(e => { host.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); host.redraw(); });
      };
      const ms = editArmMs();
      // Already editing here (ctrl+e hands that draft over), arming off, or a door that can't hold an arm: at once.
      if (surface.draft || surface.session || !ms || !host.ctx.arm) { open(); return { opened: m.id }; }
      const title = subject(m);
      const say = hintSetting("confirm", host.look?.values.hints ?? surface.lastLook?.values.hints ?? "full") === "status" ? hintStatus(CONFIRM_HINT) : "confirm";
      host.ctx.arm({ of: surface, what: title, say, key: external ? { kind: "char", ch: "e", ctrl: true } : { kind: "char", ch: "e" }, ms, run: open });
      host.redraw();
      return { armed: m.id, ms };
    },
  }),
  "edit.external": def({
    summary: "hand this reader's open edit, or the comment or reply being written, to $EDITOR (VISUAL, else EDITOR): it runs in a terminal tile beside the reader (the person's whole terminal on a screen without tiles), and its text comes back into the draft when it exits. In a draft ctrl+e alone is the line's end, as ctrl+a is its start. The person's only: it takes their terminal",
    keys: "ctrl+x then ctrl+e",
    touches: "draft", draft: "type", replay: "ask",
    person: "the $EDITOR handoff takes over the person's terminal; send the text with edit.text, or draft.patch into theirs",
    menu: noteRow("edit in $EDITOR", "ctrl+x ctrl+e", { now: ({ surface }) => (surface.draft || writingIn(surface) ? null : { hide: true }) }),
    args: {},
    run(_, { surface, host }) {
      if (!surface.draft && !writingIn(surface)) throw new ActionRefused("nothing is being written in this reader; ctrl+e (edit external=true) opens the note in $EDITOR");
      return handToEditor(surface, host);
    },
  }),
  "draft.pick": def({
    summary: "insert from a picker in this reader's edit or comment: the picker (EP0CH_PICKER, default tv) opens in a terminal tile beside the reader with the person's keys (their whole terminal on a screen without tiles or a locked one) on a channel (default EP0CH_PICK_CHANNEL, else ep0ch), and what they choose goes in at the cursor, space-separated. The person's only: it takes their keys",
    keys: [{ keys: "ctrl+t", does: "pick" }, { keys: "click", does: "[insert] in the edit's, comment's or reply's title row" }],
    touches: "draft", draft: "type", replay: "ask",
    person: "an agent doesn't hand the person's terminal to a picker; put text in their draft with draft.patch, or in an edit it opened with edit.text",
    args: { channel: { type: "string", optional: true, about: "the picker's argument (a television channel: ep0ch, ep0ch-files …); empty for none" } },
    examples: [
      { act: "draft.pick", does: "opens the picker on the default channel; its choice goes in at the cursor" },
      { act: "draft.pick channel=ep0ch-files", does: "opens the picker on the ep0ch-files channel; its choice goes in at the cursor" },
    ],
    async run({ channel }, { surface, host }) {
      return await surface.pick(host, channel);
    },
  }),
  "draft.image": def({
    summary: "put a picture in this reader's edit or comment at the cursor (PIE-592): the image file whose path the cursor is on (a file dropped on the terminal pastes its path, as text), else the one on the clipboard, or path=; it's copied into the outline's folder (media/, named by its day and contents) and a media line [img::<path>] goes in on its own line, one undo step. The clipboard is read on the door's machine",
    keys: "ctrl+v in an edit or a comment (on a dropped file's path: that file), a paste of nothing but a picture",
    touches: "draft", draft: "type", replay: "ask",
    args: { path: { type: "string", optional: true, about: "an image file on the door's machine to put in, instead of the clipboard's" } },
    examples: [
      { act: "draft.image", does: "puts the clipboard's picture in at the cursor as an [img::] line" },
      { act: "draft.image path=/tmp/shed-roof.png", does: "copies that picture into the outline and adds its [img::] line at the cursor" },
    ],
    async run({ path }, { surface, host }, actor) {
      const d = surface.writingDraft;
      if (!d) throw new ActionRefused("nothing is being written here; open an edit (e) or a comment first");
      if (d.busy) throw new ActionRefused(REFUSED.saving);
      // Pictures live in the outline's folder: on this machine only (a remote outline's is on its host).
      const info = await host.ctx.board.info().catch(() => null);
      if (!info || info.host !== hostname()) throw new ActionRefused(`the outline is on ${info?.host ?? "another machine"}: a picture goes into an outline on this machine, or put [img::<path>] in by hand`);
      const dropped = path === undefined ? imagePathAt(d.lines[d.row] ?? "", d.col) : null;
      let from: Buffer | string | null = path !== undefined ? droppedImage(path) : dropped?.path ?? null;
      if (path !== undefined && !from) throw new ActionRefused(`${path} isn't an image file on this machine (png, jpg, gif, webp…)`);
      if (!from) from = await clipboardImage();
      // The draft may have been saved, closed or replaced while the clipboard was read.
      if (surface.writingDraft !== d || d.busy) throw new ActionRefused("the draft changed while the clipboard was read; nothing was put in");
      if (!from) { d.status.say(noClipboardImage()); host.redraw(); throw new ActionRefused(d.note); }
      let kept: string;
      try { kept = keepImage(info.workspace, from); }
      catch (e) { d.status.say((e as Error).message); host.redraw(); throw new ActionRefused(d.note); }
      d.putLine(imageLine(kept), actor, dropped ?? undefined);
      d.status.say(`put in ${kept.split("/").slice(-2).join("/")} · ctrl+z takes it out (the file stays)`);
      host.redraw();
      return { path: kept, line: d.row + 1 };
    },
  }),
  "edit.follow": def({
    summary: "open the link the cursor is on in this reader's edit or comment (or ref=: a link its preview draws, ((id)), [[page]], a URL or #tag) beside it, as a reader's link opens: the edit stays open as it is and the keys stay in it (PIE-592). Opened again from the same edit, it reuses that detail",
    keys: [{ keys: "ctrl+l", does: "in an edit or a comment" }, { keys: "alt-click ctrl-click", does: "on a link in its text" }, { keys: "click", does: "on a link in its preview (ctrl+p)" }],
    touches: "tile", replay: "ask", way: "an agent opens a note beside the person's edit with open id= naming no tile",
    args: { ref: { type: "string", optional: true, about: "the link to open: ((id)) or ((id^fragment)), [[page]], a URL or #tag; default the one at the cursor" } },
    examples: [
      { act: "edit.follow", does: "opens the link under the cursor beside the edit, which stays open" },
      { act: 'edit.follow ref="[[garden]]"', does: "opens the garden page beside the edit, which stays open" },
    ],
    async run({ ref }, { surface, host }) {
      const d = surface.writingDraft;
      if (!d) throw new ActionRefused("nothing is being written here; link.follow opens a link in what a reader shows");
      const at = ref === undefined ? d.linkAtCursor() : null;
      const l = ref !== undefined ? linkOfRef(ref) : at && linkOf(at);
      if (!l) throw new ActionRefused(ref !== undefined ? `${ref} isn't a link: give ((id)), [[page]], a URL or #tag` : "no link at the cursor: put it on a [[page]], ((reference)) or [text](url)");
      const m = await surface.followFromDraft(l, host);
      return m && "id" in m ? { opened: m.id, title: subject(m) } : m && "outside" in m ? { opened: null, ...m } : { opened: null };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const EDIT_SAVE_DEFS = {
  "edit.button": def({
    summary: "insert an act line as a note button at the person's cursor, in one unsaved draft step",
    touches: "draft", draft: "type", replay: "ask", person: "inserting at the person's cursor belongs to them",
    args: { line: { type: "string", about: "the act line the button runs" } },
    examples: [{ act: 'edit.button line="tile.collapse on=true"', does: "inserts a collapse button at the note cursor, leaving the draft unsaved" }],
    run: ({ line }, { surface, host }, actor) => insertButton(line, surface, host, actor),
  }),
  "edit.insert": def({
    summary: "insert text on its own line at the note cursor; a reader saves it, an open draft keeps it unsaved; either is one undo step",
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    args: { text: { type: "string", about: "the line to insert" } }, examples: [{ act: 'edit.insert text="Order the seed potatoes"', does: "puts that line into the note at the cursor, saved unless a draft is open" }],
    run: ({ text }, { surface, host }, actor) => insertNoteLine(text, surface, host, actor),
  }),
  "edit.text": def({
    summary: "replace the draft's whole text (opens the edit first if needed); like text coming back from $EDITOR. An agent's replaces only an edit it opened, never while the person types in that reader (draft.patch lands in theirs)",
    touches: "draft", draft: "replace", replay: "ask",
    args: { text: { type: "string", about: "subject line, body and [key::value] properties" } },
    examples: [
      { act: 'edit.text text="Seed swap list, bring envelopes"', does: "replaces the draft's whole text with that line, opening the edit first" },
    ],
    async run({ text }, { surface, host }, actor) {
      const s = await surface.ensureDraft(host);
      if (s.busy) throw new ActionRefused(REFUSED.saving);
      const kept = s.replace(text, actor);
      surface.noteAgent(actor, "is editing this note");
      host.redraw();
      return { dirty: s.dirty, keptYourDraftAt: kept ?? undefined };
    },
  }),
  "edit.save": def({
    summary: "save the draft, checked against the revision it started from; a property change is shown first and needs a second save", keys: "ctrl+s",
    touches: "draft", draft: "leave", replay: "ask", answer: RECORDED_AS,
    args: {},
    run: (_, { surface, host }, actor) => saveDraft(surface, host, actor),
  }),
  "edit.actions": def({
    words: "run an action from where you're typing",
    summary: "list the actions that apply here at the cursor, in the edit's own completion float (PIE-1076): a `/` line under the cursor's (or the cursor's own line, when empty), then the action's arguments in place as you choose it; ⏎ runs it (edit.run). ctrl+k is the power bar's key everywhere else, and its actions here",
    keys: [{ keys: "ctrl+k", does: "in a note's edit" }, { keys: "/", does: "first on a line of a note's edit" }], touches: "draft", draft: "type", replay: "safe",
    args: {},
    examples: [{ act: "edit.actions", does: "puts a / line under the cursor's line and lists the actions that apply here" }],
    async run(_, { surface, host }, actor) {
      const d = surface.draft;
      if (!d) throw new ActionRefused("nothing is being edited here · e edits the note, then ctrl+k or / lists its actions");
      if (d.busy) throw new ActionRefused(REFUSED.saving);
      if (!actionHereAt((d.lines[d.row] ?? ""), d.col, d.lines, d.row)) {
        if ((d.lines[d.row] ?? "").trim()) { d.place(d.row, (d.lines[d.row] ?? "").length); d.pasteText("\n", actor); }
        d.pasteText("/", actor);
      }
      const c = surface.completer(d, host);
      await c?.refresh(true);
      host.redraw();
      return { rows: c?.shown?.items.length ?? 0, line: d.row + 1 };
    },
  }),
  "edit.run": def({
    words: "run the action typed on its / line",
    summary: "run the action on the cursor's `/` line (or line=, an act line without the /) on this note: the line is taken out, the edit saved (it leaves, as ctrl+s does) and the action run here as the power bar would run it; its result is one undo step (ctrl+z in the reader)",
    keys: [{ keys: "enter", does: "on a / line of a note's edit, with no list open" }], touches: "draft", draft: "leave", replay: "ask",
    args: { line: { type: "string", optional: true, about: "the act line to run (ext.structure.sort-list by=title); default the cursor's / line" } },
    examples: [{ act: 'edit.run line="ext.structure.sort-list order=desc"', does: "saves the edit and sorts the note's list, last first" }],
    async run({ line }, { surface, host }, actor) {
      const d = surface.draft;
      if (!d) throw new ActionRefused("nothing is being edited here");
      if (d.busy) throw new ActionRefused(REFUSED.saving);
      const here = line === undefined ? actionHereAt((d.lines[d.row] ?? ""), (d.lines[d.row] ?? "").length, d.lines, d.row) : null;
      const typed = line ?? (here ? (d.lines[d.row] ?? "").slice(here.start + 1) : null);
      if (!typed?.trim()) throw new ActionRefused("the cursor isn't on a / line · ctrl+k or / first on a line lists the actions here");
      const req = actRequestOf(lineWords(typed.trim()));
      const dispatch = host.ctx.dispatch, info = dispatch?.list().actions.find(a => a.name === req.action);
      if (!dispatch || !info) throw new ActionRefused(`no action ${req.action} here · / lists the ones that apply`);
      // What the host binds, from here: this note (an agent's run reaches it as the person's does), and that its
      // arguments were asked in place, so what's left out takes its default instead of a form over the note.
      const blockId = d.blockId;
      req.args = { ...(info.args.block?.context && req.args?.block === undefined && blockId ? { block: blockId } : {}), ...(info.args[ASKED_IN_PLACE]?.context ? { [ASKED_IN_PLACE]: true } : {}), ...req.args };
      // The / line goes before the save: what's saved is the note as written, never the command.
      // Checked before anything moves (a value it doesn't take, a note it can't act on): the line stays to correct.
      const refused = dispatch.refusedNow(req, actor);
      if (refused) throw new ActionRefused(`${refused} · the line stays: correct it and ⏎ again`);
      const row = d.row, before = d.text, command = d.lines[row] ?? "";
      if (here) {
        surface.drafting!.replace(d.lines.filter((_, i) => i !== row).join("\n"), actor);
        d.place(Math.min(row, d.lines.length - 1), 0);
      }
      // Capture first: a save that didn't land keeps the edit as it was typed, its / line too, with why.
      const saved = d.dirty ? await saveDraft(surface, host, actor).catch((e: Error) => e) : (surface.closeDraftAction(false), null);
      if (surface.draft) {
        if (here && surface.draft === d) { surface.drafting!.replace(before, actor); d.place(row, command.length); }
        throw new ActionRefused(saved instanceof Error ? saved.message : d.note || "the edit didn't save, so the action didn't run");
      }
      try {
        const answer = await dispatch.as(actor, req);
        host.redraw();
        return { ran: actionLine(req), answer };
      } catch (e) {
        // Refused as it ran (an agent's act throws; the person's press says it): the edit opens again with the line.
        if (here) {
          const { draft: again } = await surface.ensureDraft(host);
          again.place(Math.min(row, again.lines.length), 0);
          again.pasteText(command + "\n", actor);
          again.place(row, command.length);
          host.redraw();
        }
        throw e;
      }
    },
  }),
  "edit.reload": def({
    summary: "ctrl+r in any draft, after what it's written on moved on: a note's edit or a posted comment's edit starts over from its current text (what was typed is copied to disk first), a comment finds its quote again in the note's current text (nearest where it was), or picks the passage again when its words are gone, its text staying, a comment on the whole note takes the note's current revision, and a property's value in the panel starts over from its current value; what's typed during the read is held and lands after it. A draft with nothing behind it (a new card, a reply) says so", keys: "ctrl+r",
    touches: "draft", draft: "type", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.reload(host, actor),
  }),
  "edit.close": def({
    summary: "close the edit; unsaved changes need discard=true (and are put aside as unsent, with a copy on disk: e brings the person's back)", keys: "esc (twice when unsaved)",
    touches: "draft", draft: "leave", replay: "ask",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsaved changes" } },
    examples: [
      { act: "edit.close", does: "closes the edit when nothing is unsaved" },
      { act: "edit.close discard=true", does: "closes the edit even with unsaved changes, putting them aside as unsent" },
    ],
    run({ discard }, { surface, host }, actor) {
      const r = surface.closeDraftAction(!!discard);
      // Put aside (or dropped, when it was brought back and left unchanged): said where, and how it comes back.
      if (r.said && actor.kind === "user") host.ctx.flash(r.said, 8000);
      host.redraw();
      return r;
    },
  }),
  "session.leave": def({
    summary: "leave the edit or comment: an unchanged edit closes; a changed one is saved against its revision, or kept as unsent (e brings it back) when the save is refused; a comment or reply is kept as unsent, never sent. The person's own edit or comment stays open when they click or move elsewhere (PIE-785, PIE-812); this is what going elsewhere does to an agent's edit they're in. An agent leaves only a session it opened",
    keys: "a click outside an agent's edit you're in, or ^W then a window key (desk)",
    touches: "draft", draft: "leave", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.leave(host, actor),
  }),
  "page.create": def({
    summary: "make the page a [[address]] names when nothing answers it yet (address=, or the selected link's): `X [page::X]` where new notes go (the outline's placement rule: today the top of the Inbox), then open it as the link would; a page there already is opened. Following a missing [[page]] offers this first (⏎ or a click on it again). An agent's makes it, attributed and said, and opens nothing",
    keys: [{ keys: "⏎ click", does: "on a [[missing page]] link, twice (the first offers it)" }],
    touches: "nothing", replay: "ask", answer: RECORDED_AS,
    says: out => (out?.said ? `· ${out.said}` : null),
    args: {
      address: { type: "string", optional: true, about: "the page's address (its name); default: the selected link's" },
      under: { type: "string", optional: true, kind: "page", about: "make a note titled address on this page instead (a project's PR#125, PIE-408), making the page when it's missing" },
    },
    examples: [
      { act: "page.create address=seed-swap", does: "makes the page seed-swap where new notes go, then opens it" },
      { act: "page.create address=PR#125 under=garden-club", does: "makes the note PR#125 on the garden-club page, then opens it" },
      { act: "page.create", does: "makes the page the selected [[link]] names, then opens it" },
    ],
    async run({ address, under }, { surface, host, standing }, actor) {
      const page = address ?? surface.selectedPage();
      if (!page) throw new ActionRefused("name the page: address=<its name>, or select a [[page]] link first");
      return surface.createPage(page, host, actor, standing, under);
    },
  }),
  "component.new": def({
    summary: "make a note component (a render script) named name=: its starter note `Name [script::name] [mode::render]` with a where= prop and a tsx fence that lists the notes its where holds, written under [[components]] (under= another page; made when missing), and ::name{} put at the draft's cursor (on a line of its own); the person's opens the note beside. Completion's `+ new component ::name` row runs the same. Both writes are attributed",
    keys: [{ via: "completion's `+ new component ::name` row, ⏎ or tab on it" }],
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    says: out => (out?.said ? `· ${out.said}` : null),
    args: {
      name: { type: "string", about: "the component's name, what ::name{} calls: lowercase letters, digits and -, starting with a letter" },
      under: { type: "string", optional: true, kind: "page", default: "components", about: "the page its note is written under" },
    },
    examples: [
      { act: "component.new name=stale", does: "writes Stale [script::stale] [mode::render] under [[components]] and puts ::stale{} at the draft's cursor" },
    ],
    async run({ name, under }, { surface, host, standing }, actor) {
      const d = surface.writingDraft;
      if (!d) throw new ActionRefused("open an edit first: component.new puts ::name{} at its cursor");
      if (d.busy) throw new ActionRefused(REFUSED.saving);
      const made = await makeComponent(host.ctx.board, name, actor, under ?? COMPONENTS_PAGE);
      const at = callSplice(d.lines[d.row] ?? "", name);
      d.splice(at.start, at.end, at.text, {}, actor);
      surface.noteAgent(actor, `made component ::${name}`, d);
      if (standing && actor.kind === "user") host.navigate(made.note, { fresh: true });
      host.redraw();
      return { id: made.note.id, page: made.page.id, said: made.said, recordedAs: recordedAnswer(actor, "new") };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const EDIT_STRAYS_DEFS = {
  "edit.strays": def({
    summary: "bring back the stray characters esc just dropped from an edit opened by mistake (src/stray.ts: open under 10s, up to 3 characters typed, nothing taken out): the edit opens again with them, as it was",
    keys: readerKeys("edit.strays", { via: "right after esc dropped them (within a minute)" }),
    touches: "draft", draft: "write", replay: "ask",
    person: "the strays were the person's keys; an agent writes with edit.text or draft.patch",
    args: {},
    async run(_, { surface, host }) {
      const m = surface.requireNote();
      // Never over an edit put aside here since (DraftSession.open forgets superseded strays too); asked before they're taken.
      if (unsent(`edit:${m.id}`)) throw new ActionRefused("an edit was put aside on this note since; it comes back with e");
      const s = takeStrays(`edit:${m.id}`);
      if (!s) throw new ActionRefused("no stray characters were dropped here in the last minute");
      keepUnsent(s.u);                                           // put aside for a moment: the edit brings it back
      const d = (await surface.ensureDraft(host)).draft;
      if (d.text === s.u.text) {
        d.row = Math.min(s.row, d.lines.length - 1); d.col = Math.min(s.col, d.lines[d.row]!.length);
        d.status.say(`brought back ${s.u.text.length - (s.u.from ?? "").length} stray character${s.u.text.length - (s.u.from ?? "").length === 1 ? "" : "s"} · esc twice drops them`);
      }
      host.redraw();
      return { id: m.id, restored: d.text === s.u.text };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
