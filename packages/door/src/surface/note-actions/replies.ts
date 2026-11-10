// note.thread.*, note.quote and note.reply: the notes that answer this one (its replies list), and
// writing a reply or a quote of it as a note of its own.
import { ATTACHED_KEYS } from "../attached-keys";
import { DraftSession, noteReplyTarget } from "../../draft-session";
import { RECORDED_AS, recordedAnswer } from "../../socket";
import { linkTargetOf, readReplies, SEP, threadRows } from "../../links";
import { modeActionKeys } from "../modes";
import { movedOn, type On } from "./shared";
import { readerKeys } from "../reader-keys";
import { subject } from "../../board";
import { type ActionDef, ActionRefused, def } from "../actions";

export const REPLY_DEFS = {
  "note.thread": def({
    summary: "open the message's replies in place, including moved replyTo notes; conference children count as replies",
    keys: "t", touches: "nothing", replay: "safe", menu: { label: "read this thread", group: "note", key: "t" }, args: {},
    run: (_, { surface, host }, actor) => surface.openReplyLinks(host, actor),
  }),
  "note.thread.close": def({
    summary: "close the replies drawer", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.close"), confirms: true, says: () => "closed the replies", touches: "tile", replay: "safe", person: "the person's drawer", args: {},
    run(_, { surface, host }) { surface.closeReplyLinks(); host.redraw(); return { closed: true }; },
  }),
  "note.thread.pick": def({
    summary: "move through the thread, or select one row (n)", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.pick"), touches: "tile", replay: "safe", person: "the person's selection", args: { by: { type: "number", optional: true, about: "rows to move" }, n: { type: "number", optional: true, about: "row number to select (starts at one): a click" } },
    examples: [
      { act: "note.thread.pick by=1", does: "moves the thread's selection down one row" },
      { act: "note.thread.pick n=3", does: "selects the third row of the thread" },
    ],
    async run({ by, n }, { surface, host }, actor) {
      const m = surface.replyLinks;
      // The panel keeps the person's selected row while its note is read for a preview.
      if (m) { m.selected = Math.max(0, Math.min(m.rowsAt.length - 1, n !== undefined ? n - 1 : m.selected + (by ?? 0))); m.picked = actor.kind === "user"; }
      const row = m?.rowsAt[m.selected], target = row && linkTargetOf(row);
      if (target?.block && host.preview) {
        const note = await host.ctx.board.get(target.block);
        if (note && surface.replyLinks === m && m?.rowsAt[m.selected]?.key === row?.key) host.preview(note);
      }
      host.redraw(); return { selected: m?.selected };
    },
  }),
  "note.thread.groups": def({
    summary: "cycle the thread, the replies, outlinks and backlinks", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.groups"), touches: "tile", replay: "safe", person: "the person's drawer", args: {},
    run(_, { surface, host }) { const m = surface.replyLinks; if (m) { m.top = 0; m.group = m.group === "thread" ? "children" : m.group === "children" ? "outlinks" : m.group === "outlinks" ? "backlinks" : "thread"; m.selected = m.group === "thread" ? Math.max(0, threadRows(m.thread, m.unfolded).findIndex(r => r.kind === "child" && r.thread?.here)) : 1; m.picked = false; } host.redraw(); return { group: m?.group }; },
  }),
  "note.thread.open": def({
    summary: "read the selected post through the tile's open wire, or its alt wire with fresh=true (a fold row opens its posts)", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.open"), touches: "tile", replay: "safe", person: "the person's drawer", args: { n: { type: "number", optional: true, about: "row number (starts at one)" }, fresh: { type: "boolean", optional: true, about: "use the alt wire, as alt+Enter does" } },
    examples: [
      { act: "note.thread.open", does: "opens the selected post of the thread in the reader" },
      { act: "note.thread.open n=2", does: "opens the second row's post of the thread in the reader" },
    ],
    async run({ n, fresh }, { surface, host }) { const m = surface.replyLinks, row = m?.rowsAt[n === undefined ? m.selected : n - 1];
      if (row?.kind === "fold") throw new ActionRefused("that row is a fold, not a post: note.thread.unfold shows what it hides");
      const target = row && linkTargetOf(row); if (!target) return { opened: null }; surface.closeReplyLinks(); const note = await surface.followLink(target, host, !!fresh); return { opened: note && "id" in note ? note.id : null }; },
  }),
  "note.thread.unfold": def({
    summary: "show the posts a fold row of the thread hides", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.unfold"), touches: "tile", replay: "safe", person: "the person's drawer", args: { n: { type: "number", optional: true, about: "row number (starts at one)" } },
    examples: [
      { act: "note.thread.unfold n=4", does: "shows the posts the fourth row of the thread, a fold, hides" },
    ],
    run({ n }, { surface, host }) {
      const m = surface.replyLinks, row = m?.rowsAt[n === undefined ? m.selected : n - 1];
      if (!m || row?.kind !== "fold") throw new ActionRefused("that row isn't a fold");
      m.unfolded.add(row.key.slice(`fold${SEP}`.length)); m.selected = m.rowsAt.indexOf(row); m.picked = false; m.presses.forget(); host.redraw();
      return { unfolded: row.count };
    },
  }),
  "note.thread.full": def({
    summary: "open the full THREAD message list", keys: modeActionKeys(ATTACHED_KEYS, "note.thread.full"), touches: "screen", replay: "safe", person: "the person's screen", args: {},
    async run(_, { surface, host }) {
      const m = surface.requireNote(), { MessageList } = await import("../../screens");
      surface.closeReplyLinks();
      host.ctx.push(new MessageList(`thread: ${subject(m)}`, async () => (await readReplies(host.ctx.board, m.id, host.conference)).children.map(c => c.block), "", false));
      return { opened: "thread" };
    },
  }),
  "note.quote": def({
    summary: "insert a frozen selection with its source block (and existing anchor) into the reply, opening one if needed",
    keys: readerKeys("note.quote"), touches: "draft", draft: "type", replay: "ask",
    menu: { label: "quote into a reply", group: "note", key: '\"' },
    args: { quote: { type: "string", optional: true, about: "exact source words; otherwise your selection" } },
    examples: [
      { act: "note.quote", does: "puts the selected words into a reply to this note as a quote" },
      { act: 'note.quote quote="mulch the beds in March"', does: "puts those exact words into a reply to this note as a quote" },
    ],
    async run({ quote }, { surface, host }, actor): Promise<unknown> {
      const parent = surface.requireNote();
      const text = await surface.quoteSelection(host, actor, quote);
      if (movedOn(host, surface, parent.id)) throw new ActionRefused("the reader moved while the quote was read");
      if (actor.kind === "agent") return surface.act("note.reply", { text }, host, actor);
      const s = surface.replyParent ? surface.drafting! : surface.startReply(host);
      s.draft.pasteText(text, actor);
      surface.clearSelections();
      host.redraw();
      return { quoted: surface.requireNote().id };
    },
  }),
  "note.reply": def({
    summary: "write a reply beside this message; Save creates a child with replyTo and the message's thread, Esc closes without posting (twice after typing, and the reply is put aside: r brings it back)",
    keys: readerKeys("note.reply", { keys: "click", does: "on the note menu's reply" }), touches: "nothing", replay: "ask", answer: RECORDED_AS,
    menu: { label: "reply to this note", group: "note", key: "r" },
    args: { text: { type: "string", optional: true, about: "reply text; an agent supplies this and creates the note without opening an editor" } },
    examples: [
      { act: "note.reply", does: "opens a reply beside this note for the person to write" },
      { act: 'note.reply text="Peas went in on Saturday"', does: "posts that as a reply to this note (the person's opens the reply with it)" },
    ],
    async run({ text }, { surface, host }, actor) {
      const parent = surface.requireNote();
      if (actor.kind === "agent") {
        if (text === undefined) throw new ActionRefused("supply text= for an agent's reply");
        const s = DraftSession.open(noteReplyTarget(parent, host.ctx.board), { text, by: actor });
        const result = await s.submit(actor);
        s.dispose();
        if (!result.ok) throw new ActionRefused(result.why);
        surface.noteAgent(actor, "replied to this note");
        return { ...(result.result as Record<string, unknown> | undefined), recordedAs: recordedAnswer(actor, "new") };
      }
      const quote = surface.selection ? await surface.quoteSelection(host, actor) : undefined;
      if (movedOn(host, surface, parent.id)) return { replying: null };
      const s = surface.startReply(host, quote);
      if (text !== undefined) s.replace(text, actor);
      return { replying: parent.id };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
