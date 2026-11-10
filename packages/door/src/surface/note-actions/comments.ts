// Comments: choosing a passage and writing on it (passage.*, comment.*), the margin, the thread list and its threads
// (threads, thread.*, reply, comment.edit, resolve), and quoting a thread (quote, thread.pick).
// The whole set, read only when an action runs (one action runs another by name).
import { NOTE_ACTIONS } from "../note";
import { ATTACHED_KEYS } from "../attached-keys";
import { MARGIN_MODE_WORDS, MARGIN_MODES, type MarginMode, nextMargin } from "../margin";
import { RECORDED_AS, recordedAnswer, mutationFor } from "../../socket";
import { askingFirst, passageActions, runExtensionAction, threadAgents } from "../../extensions";
import { isOutlineNote } from "../../authored";
import { modeActionKeys } from "../modes";
import { movedOn, noteRow, type On, personComments, postComment, sendComment, findThread, attention, threadIn } from "./shared";
import { readerKeys } from "../reader-keys";
import { type ActionDef, ActionRefused, asActor, def } from "../actions";
import { askInBar } from "../../bar/ask";

export const COMMENT_DEFS = {
  "passage.select": def({
    summary: "start a comment: pick a passage of the note's source text by its exact words (default: the first line with text). The person's C writes on the words they selected (as a c does); with nothing selected C writes on the whole note (comment.note, PIE-846)", keys: [{ keys: "C", does: "on selected words" }, { via: "an agent: quote=" }],
    touches: "draft", draft: "type", replay: "ask",
    // The menu's way to it is the person's words selected (PIE-846): with none, the menu offers the whole note instead.
    menu: noteRow("comment on the selected words", "C", { busy: true, now: on => (on.surface.selection ? null : { hide: true }) }),
    args: {
      quote: { type: "string", optional: true, about: "the exact words to quote, as stored" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    examples: [
      { act: 'passage.select quote="mulch the beds"', does: "picks those words of the note to write a comment on" },
      { act: "passage.select quote=beds near=120", does: "picks the occurrence of beds nearest offset 120 to comment on" },
    ],
    async run({ quote, near }, { surface, host }, actor) {
      // The person's C starts from their selected text (the quote) and their put-aside comment; an agent's never.
      const s = actor.kind === "user" && !surface.session && !surface.draft ? await personComments(surface, host, "select") : await surface.ensureSession(host, "select", actor);
      // From the passage toolbar (Comment, Ask): already writing on the selected words.
      if (s.mode === "compose" && s.target?.kind === "quote" && quote === undefined) { host.redraw(); return { revision: s.msg.revision, quote: s.target.passage.quote, start: s.target.passage.start, writing: true }; }
      // Picking reads the note again; when that fails the session stays where it was, with the reason.
      const p = s.mode === "select" ? s.passage : null;
      if (!p) throw new ActionRefused(s.error ?? "the passage couldn't be picked: the note's current text wasn't read");
      if (quote !== undefined) { const why = p.selectText(quote, near); if (why) { p.note = why; host.redraw(); throw new ActionRefused(why); } }
      surface.noteAgent(actor, "is quoting a passage");
      host.redraw();
      return { revision: s.msg.revision, quote: p.quote, start: p.from };
    },
  }),
  "comment.write": def({
    summary: "write the comment (or reply) text: on a picked passage this is Enter, then the text. An agent's replaces only a comment it opened, never one the person is writing; invited (their @name line), it rewrites the text above that line, once", keys: [{ keys: "enter", does: "then typing" }],
    touches: "draft", draft: "text", replay: "ask",
    args: {
      body: { type: "string", about: "the comment's text" },
      invitation: { type: "string", optional: true, about: "the invitation the person's @name line gave this agent: body replaces the text above that line (one reply)" },
      base: { type: "string", optional: true, about: "with invitation=: the hash of the text the reply was written on, as the invitation gave it" },
    },
    examples: [
      { act: 'comment.write body="Which beds get it?"', does: "writes that as the comment on the picked passage, unsent" },
    ],
    async run({ body, invitation, base }, { surface, host }, actor) {
      const s = surface.session;
      if (!s) throw new ActionRefused("no comment is being written here; passage.select or reply first");
      if (s.busy) throw new ActionRefused(`wait: ${s.busy}`);
      // Invited into the person's comment: the reply seam edits use (DraftSession.reply), compared on the invited range.
      if (invitation !== undefined) {
        if (s.mode !== "compose" || !s.writing) throw new ActionRefused("no comment is being written here to be invited into");
        if (base === undefined) throw new ActionRefused("invitation= needs base=, the hash of the text the reply was written on");
        const r = s.writing.reply(invitation, base, body, actor);
        host.redraw();
        return { ...r, dirty: s.writing.dirty };
      }
      // An agent's comment is its own: the person's put-aside text stays put aside.
      if (s.mode === "select") { const why = s.write(actor); if (why) throw new ActionRefused(why); }
      if (s.mode !== "compose" || !s.composer) throw new ActionRefused("pick a passage first (passage.select) or reply to a thread");
      const kept = s.writing!.replace(body, actor);
      host.redraw();
      return { dirty: s.composer.dirty, keptYourDraftAt: kept ?? undefined };
    },
  }),
  "comment.send": def({
    summary: "send the comment or reply; a retry of the same text can't land twice", keys: modeActionKeys(ATTACHED_KEYS, "comment.send"),
    touches: "draft", draft: "leave", replay: "ask", answer: RECORDED_AS,
    args: {},
    run: (_, { surface, host }, actor) => sendComment(surface, host, actor),
  }),
  "comment": def({
    summary: "comment on a passage in one step: passage.select, comment.write, comment.send",
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    args: {
      quote: { type: "string", about: "the exact words to quote, as stored" },
      body: { type: "string", about: "the comment's text" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    examples: [
      { act: 'comment quote="mulch the beds" body="Which beds get it?"', does: "comments on those words of the note and sends the comment" },
      { act: 'comment quote=beds near=120 body="Not the front one"', does: "comments on the occurrence of beds nearest offset 120 and sends it" },
    ],
    async run({ quote, body, near }, on, actor): Promise<unknown> {
      await NOTE_ACTIONS.run("passage.select", { quote, near }, on, actor);
      await NOTE_ACTIONS.run("comment.write", { body }, on, actor);
      return NOTE_ACTIONS.run("comment.send", {}, on, actor);
    },
  }),
  "comment.note": def({
    summary: "comment on the whole note, not a passage (PIE-846): the person's composer opens at the top of the note, where whole-note threads are (a comment put aside on the note comes back in it); body= sends it at once, as an agent's always is. Its thread sits at the top of the note, its card in the margin's first row",
    keys: [{ keys: "C", does: "with nothing selected" }, { keys: "click", does: "the byline's [comment]" }, { via: "the tile menu's \"comment on the whole note\"" }],
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    menu: noteRow("comment on the whole note", "C", { busy: true }),
    args: { body: { type: "string", optional: true, about: "the comment's text, sent at once (left out, the person writes it)" } },
    examples: [
      { act: 'comment.note body="Please add dates to the plan"', does: "comments on the whole note and sends it at once" },
      { act: "comment.note", does: "opens the comment box at the top of the note for the person to write" },
    ],
    async run({ body }, { surface, host }, actor) {
      const m = surface.requireNote();
      if (!isOutlineNote(m) && !m.resource) throw new ActionRefused("this isn't a note or a Resource's text: nothing to comment on");
      if (body !== undefined && body.trim()) {
        if (m.revision === undefined) throw new ActionRefused("the outline didn't say which revision this note is at");
        const r = await postComment(surface, host, m, m.revision, body, null, actor);
        asActor(host.ctx, actor).flash("commented on the whole note");
        surface.noteAgent(actor, "commented on the whole note");
        host.redraw();
        return { thread: r.id, whole: true, recordedAs: recordedAnswer(actor, "new") };
      }
      if (actor.kind !== "user") throw new ActionRefused("say body=: an agent's comment is sent at once");
      const why = await surface.commentOnNote(host, actor, host.still);
      if (!surface.session || surface.session.target?.kind !== "note") throw new ActionRefused(movedOn(host, surface, m.id) ?? (why || "the comment didn't open"));
      host.redraw();
      // restored: what was put aside on this note came back into it (a handover's restore checks it did).
      return { writing: "comment", whole: true, restored: !!surface.session.composer?.restored };
    },
  }),
  "passage.act": def({
    summary: "act on a passage (ADR 0004 contract 5): comment on it, ask the agent that answers in threads about it (its answer lands in the passage's margin thread), have it explained, or run an extension's passage action (marginalia's highlight, define, cite). The passage is exact source text: the words named with quote= (near= among repeats), else the actor's own selection (the person's for the person; an agent's own, never the person's). The service checks it before anything is written",
    keys: [{ keys: "a then c", does: "comment, while text is selected" }, { keys: "a then a", does: "ask", says: "ask the agent about the selected passage" }, { keys: "a then e", does: "explain", says: "have the selected passage explained" }, { keys: "a then h", does: "highlight", says: "highlight the selected passage" }, { keys: "a then d", does: "define", says: "define the selected passage" }, { keys: "a then k", does: "cite with marginalia" }, { keys: "click", does: "its chip on the selection's line" }],
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    args: {
      action: { type: "string", about: "comment, ask, explain, or an extension's passage action by its name (ext.<id>.<action>; passage.choices lists them)" },
      quote: { type: "string", optional: true, about: "the exact words, as stored (default: your selection)" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
      body: { type: "string", optional: true, about: "comment: its text, sent at once (left out, the person writes it)" },
      text: { type: "string", optional: true, about: "comment written by the person: what the composer starts with (a quote-reply's > lines); quote= then names the passage, without a selection" },
      question: { type: "string", optional: true, about: "ask: the question, sent at once (left out, the person writes it after @name)" },
      color: { type: "string", optional: true, about: "a theme tone the extension may use (highlight's colour): default, good, warn, bad, dim, accent" },
    },
    examples: [
      { act: 'passage.act action=comment quote="mulch the beds" body="Which beds get it?"', does: "comments on those words and sends the comment at once" },
      { act: 'passage.act action=ask quote="mulch the beds" question="Why mulch in March?"', does: "asks the thread agent about those words; its answer lands in the margin" },
    ],
    async run({ action, quote, near, body, question, color, text: start }, { surface, host }, actor) {
      const m = surface.requireNote();
      if (!isOutlineNote(m) && !m.resource) throw new ActionRefused("this isn't a note or a Resource's text: nothing to act on a passage of");
      const p = surface.passageFor(actor, quote, near);
      const said = asActor(host.ctx, actor);
      const send = async (text: string, props?: Record<string, string>) => {
        const r = await postComment(surface, host, m, m.revision!, text, p.note, actor, props);
        if (actor.kind === "user") surface.selection = null;
        host.redraw();
        return r.id;
      };
      if (action === "comment" || action === "ask" || action === "explain") {
        const agent = action === "comment" ? null : threadAgents()[0];
        if (action !== "comment" && !agent) throw new ActionRefused("no agent here answers in comment threads: add marginalia (its @margin agent) or another whose agent says threads: true");
        const kind = action === "comment" ? undefined : action === "ask" ? "question" : "explain";
        const props = kind ? { kind } : undefined;
        const text = action === "explain" ? `@${agent!.name} explain this passage` : action === "ask" && question !== undefined ? `@${agent!.name} ${question}` : body;
        if (text !== undefined && text.trim()) {
          const thread = await send(text, props);
          said.flash(action === "comment" ? "commented on the passage" : `asked @${agent!.name} · the answer lands in the margin`);
          surface.noteAgent(actor, `${action === "comment" ? "commented on" : "asked about"} "${p.note.quote}"`);
          return { thread, passage: p.target, recordedAs: recordedAnswer(actor, "new") };
        }
        // Written by hand: the comment composer on the passage, opened for the person (an agent says body= or question=).
        if (actor.kind !== "user") throw new ActionRefused(action === "ask" ? "say question=: an agent's question is sent at once" : "say body=: an agent's comment is sent at once");
        // As the person's C opens it (their session, entered as it opens), straight to writing on the selected words.
        surface.writeNext = { props: props ?? null, text: `${agent ? `@${agent.name} ` : ""}${start ?? ""}`, ...(quote !== undefined ? { at: { from: p.note.start, to: p.note.start + p.note.quote.length } } : {}) };
        if (host.startSession) await host.startSession("select");
        else await personComments(surface, host, "select");
        if (!surface.session) throw new ActionRefused("the comment didn't open: the note couldn't be read for commenting");
        host.redraw();
        // restored: what was put aside on this note came back into it (a handover's restore checks it did).
        return { writing: action, passage: p.target, restored: !!surface.session.composer?.restored };
      }
      const named = /^ext\.([a-z][a-z0-9-]{0,31})\.([a-z][a-z0-9-]{0,31})$/.exec(action);
      const choice = passageActions().find(x => x.action.name === action);
      if (!named || !choice) throw new ActionRefused(`no passage action ${action}: it's comment, ask, explain${passageActions().length ? `, or ${passageActions().map(x => x.action.name).join(", ")}` : " (no extension here acts on a passage)"}`);
      // What it declares and the person didn't say is asked for first, in the power bar (PIE-784); then it runs.
      // Run, then what follows a run here (asked for its arguments first, the run comes when they're answered).
      const run = async (args: Record<string, string>) => {
        const r = await runExtensionAction(host.ctx, choice.action, choice.extension.id, { passage: p.target, ...(m.resource?.from ? { blockId: m.resource.from } : {}), ...(Object.keys(args).length ? { args } : {}) }, actor);
        // Copy with a citation: the person's clipboard; an agent gets the text back, the person's clipboard untouched.
        if (r.copy !== undefined && actor.kind === "user") host.ctx.copy?.(r.copy);
        if (r.written.length) await surface.loadComments(host);
        if (actor.kind === "user") surface.selection = null;
        surface.noteAgent(actor, `${choice.action.label.toLowerCase()} on "${p.note.quote}"`);
        host.redraw();
        return { said: r.said, written: r.written, ...(r.copy !== undefined ? { copy: r.copy, clipboard: actor.kind === "user" } : {}), passage: r.passage ?? p.target, ...(r.undo ? { undo: r.undo } : {}) };
      };
      // What it declares and the person didn't say is asked for first, in the power bar (PIE-784).
      return askingFirst(host.ctx as never, choice.extension, choice.action, p.target.subject.startsWith("resource:") ? m.resource?.from : p.target.subject, color ? { color } : {}, actor, run);
    },
  }),
  "passage.choices": def({
    summary: "list what can be done with a passage here: comment, ask and explain (when an agent answers in threads) and each extension's passage action, with its key after a",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface }) {
      return { choices: surface.passageChoices(), agents: threadAgents().map(a => a.name) };
    },
  }),
  "margin": def({
    summary: `the margin's cards (ADR 0004 contract 6): trim, ${MARGIN_MODE_WORDS.trim.does}; full, ${MARGIN_MODE_WORDS.full.does}; off, ${MARGIN_MODE_WORDS.off.does} (the highlights stay on the words). The byline's count says which: ${MARGIN_MODES.map(x => `"${MARGIN_MODE_WORDS[x].chip}"`).join(", ")}. Reading state agents may change for the person, kept with the tile (PIE-873) and taken by a reader opened from it`,
    keys: readerKeys("margin", { keys: "click", does: "the byline's comment count" }),
    touches: "shape", replay: "safe",
    args: { mode: { type: "string", optional: true, about: "trim, full or off; left out, the next one" } },
    examples: [
      { act: "margin", does: "cycles the margin's cards to the next of trim, full and off" },
      { act: "margin mode=full", does: "shows each margin card whole, with its replies" },
    ],
    run({ mode }, { surface, host }, actor) {
      const next = mode === undefined ? nextMargin(surface.marginMode) : (MARGIN_MODES as readonly string[]).includes(mode) ? mode as MarginMode : null;
      if (!next) throw new ActionRefused("mode is trim, full or off");
      surface.setMargin(next);
      surface.noteAgent(actor, `comments: ${MARGIN_MODE_WORDS[next].chip}`);
      // Kept with the tile (PIE-873): a handover, a restart and the next note read the same way.
      host.keptChanged?.();
      host.ctx.flash(`comments: ${MARGIN_MODE_WORDS[next].does} · M for ${MARGIN_MODE_WORDS[nextMargin(next)].chip}`);
      host.redraw();
      return { margin: next };
    },
  }),
  "comment.escape": def({
    summary: "close the comment, putting unsent text aside on the second press", keys: modeActionKeys(ATTACHED_KEYS, "comment.escape"),
    touches: "draft", draft: "leave", replay: "ask", person: "the person's comment keys", args: {},
    run: (_, { surface, host }) => surface.commentEscape(host),
  }),
  "comment.close": def({
    summary: "close the comment session; unsent text needs discard=true (and is put aside as unsent, with a copy on disk)", keys: modeActionKeys(ATTACHED_KEYS, "comment.escape"),
    touches: "draft", draft: "leave", replay: "ask",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsent text" } },
    examples: [
      { act: "comment.close", does: "closes the comment session when no text is unsent" },
      { act: "comment.close discard=true", does: "closes it even with unsent text, putting that aside as unsent" },
    ],
    run({ discard }, { surface, host }) {
      const s = surface.session;
      if (!s) return { closed: false };
      if (s.dirty && !discard) throw new ActionRefused("the comment isn't sent; comment.send sends it, discard=true closes it anyway (put aside as unsent first, as esc twice does)");
      const r = s.writing?.close(true);
      surface.closeSession(); host.redraw();
      return { closed: true, keptAt: r?.keptAt };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const THREAD_DEFS = {
  "threads": def({
    summary: "show the note's comment threads (the person's opens on the comment mark the [ ] position is on); in the list, j k move and PgUp PgDn and the wheel scroll it", keys: "m; j k PgUp PgDn wheel in the list",
    touches: "tile", replay: "safe", way: "the thread list would cover what they're reading · an agent lists threads in another reader (tile=)",
    menu: noteRow("comments", "m", { busy: true }),
    args: {},
    async run(_, { surface, host, standing }, actor) {
      // The person's opens as it was asked for: on a comment mark's thread, or with a Reply control's reply started.
      const s = standing && !surface.session && !surface.draft ? await personComments(surface, host, "threads") : await surface.ensureSession(host, "threads", actor);
      host.redraw();
      return { threads: s.threads.map(t => ({ id: t.id, open: t.open, author: t.author, quote: t.quote, body: t.body, replies: t.replies.length })) };
    },
  }),
  "thread.toggle": def({
    summary: "open a comment card (its comment, replies and Select, Reply, Resolve controls), or fold it to its gutter mark; expand=true or false sets it. Agents may change this reading state for the person without moving focus or selection", keys: "enter or a click on a comment mark",
    touches: "shape", replay: "safe",
    args: {
      thread: { type: "string", about: "the thread's id (or its first 6+ characters)" },
      expand: { type: "boolean", optional: true, about: "true expands, false collapses; left out, it toggles" },
    },
    examples: [
      { act: "thread.toggle thread=5b2e8d", does: "opens that comment card, or folds it to its gutter mark if open" },
      { act: "thread.toggle thread=5b2e8d expand=false", does: "folds that comment card to its gutter mark" },
    ],
    async run({ thread, expand }, { surface, host }, actor) {
      await surface.whole();
      const id = surface.threadId(thread);
      surface.setExpanded(id, expand ?? !surface.threadShown(id));
      if (actor.kind === "user") { surface.readThread(id, host); surface.revealCard(id); }
      surface.noteAgent(actor, `${surface.threadShown(id) ? "opened" : "folded"} a comment`);
      host.redraw();
      return { thread: id, expanded: surface.threadShown(id) };
    },
  }),
  "reply": def({
    summary: "reply to a comment thread and send it. Left out body=, the person's reply opens on the thread to be written (a reply put aside there comes back); an agent's is sent at once", keys: [{ keys: "m", does: "the thread list" }, { keys: "j k", does: "pick a thread" }, { keys: "r", does: "reply, then typing" }, { keys: "ctrl+s", does: "save the reply" }, { keys: "click", does: "[Reply] on an expanded thread" }],
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, body: { type: "string", optional: true, about: "the reply's text, sent at once; left out, the person writes it" } },
    examples: [
      { act: 'reply thread=5b2e8d body="Yes, the front bed too"', does: "sends that reply on the comment thread at once" },
      { act: "reply thread=5b2e8d", does: "opens the person's reply on that thread, ready to write" },
    ],
    async run({ thread, body }, on, actor) {
      if (body === undefined && actor.kind === "agent") throw new ActionRefused("say body=: an agent's reply is sent at once");
      const { s, i } = await threadIn(on, thread);
      const why = s.replyTo(i, actor);
      if (why) throw new ActionRefused(why);
      // Written by hand: as the Reply control opens it, back to reading once it's sent.
      if (body === undefined) { s.fromReader = true; on.host.redraw(); return { replying: s.target?.kind === "reply" ? s.target.thread.id : thread, restored: !!s.composer?.restored }; }
      s.writing!.replace(body, actor);
      return sendComment(on.surface, on.host, actor);
    },
  }),
  "comment.edit": def({
    summary: "edit a posted comment, or one of its replies (reply=), in the same editor it was written in (PIE-763). Left out body=, the person's editor opens on its words (ctrl+s saves, esc leaves it as it was, a click away saves it as an edit does); body= saves new words at once, as an agent's always does. Checked against the revision it was read at: an edit made meanwhile is refused (ctrl+r loads it), never overwritten. Attributed to whoever edits it; it shows as edited, its earlier words kept in its revisions",
    keys: [{ keys: "e", does: "in the thread list (m)" }, { keys: "click", does: "[Edit] on an expanded thread, or beside one of its replies" }],
    touches: "draft", draft: "type", replay: "ask", answer: RECORDED_AS,
    args: {
      thread: { type: "string", about: "the thread's id (or its first 6+ characters)" },
      reply: { type: "string", optional: true, about: "one of its replies to edit instead (its id, or its first 6+ characters); left out, the thread's own comment" },
      body: { type: "string", optional: true, about: "the new words, saved at once; left out, the person's editor opens on the words as they are" },
      observed: { type: "string", optional: true, about: "with body=: the words as you read them (threads lists them); an agent's edit needs it, so an edit made meanwhile is refused, never overwritten" },
    },
    examples: [
      { act: 'comment.edit thread=5b2e8d body="Which beds get mulch?" observed="Which beds?"', does: "saves new words for the comment, refused if it changed since they were read" },
      { act: "comment.edit thread=5b2e8d", does: "opens the person's editor on that comment's words" },
    ],
    async run({ thread, reply, body, observed }, on, actor) {
      if (body === undefined && actor.kind === "agent") throw new ActionRefused("say body=: an agent's edit is saved at once (the words it read are in threads)");
      if (body !== undefined && observed === undefined && actor.kind === "agent") throw new ActionRefused("say observed=: the comment's words as you read them (threads lists them), so an edit made since isn't overwritten");
      const { s, i } = await threadIn(on, thread);
      // Checked before anything opens: the words read are still its words.
      if (observed !== undefined) {
        const th = s.threads[i]!, now = reply === undefined ? th : th.replies.find(x => x.id === reply || (reply.length >= 6 && x.id.startsWith(reply)));
        if (now && now.body.trim() !== observed.trim()) throw new ActionRefused(`it changed since you read it; its words now: ${JSON.stringify(now.body)} · read them again and edit those`);
      }
      const why = s.editMark(i, reply, actor);
      if (why) throw new ActionRefused(why);
      const t = s.target as Extract<NonNullable<typeof s.target>, { kind: "edit" }>;
      if (body === undefined) { on.host.redraw(); return { editing: t.mark.id, revision: t.mark.revision, words: t.mark.body, restored: !!s.composer?.restored }; }
      s.writing!.replace(body, actor);
      return sendComment(on.surface, on.host, actor);
    },
  }),
  "resolve": def({
    summary: "resolve a comment thread that's a ticket (a request done), or reopen it with open=true. A thread that only needed reading is seen (thread.seen), not resolved. It opens the thread list in the reader: an agent's is refused on the reader the person has", keys: [{ keys: "m then s", does: "marks one seen" }],
    touches: "tile", replay: "ask", answer: RECORDED_AS, way: "the thread list would cover what they're reading · an agent resolves it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, open: { type: "boolean", optional: true, about: "reopen instead of resolving" } },
    examples: [
      { act: "resolve thread=5b2e8d", does: "marks that comment thread resolved, a request done" },
      { act: "resolve thread=5b2e8d open=true", does: "reopens that resolved comment thread" },
    ],
    async run({ thread, open }, on, actor) {
      return attention(on, actor, thread, open ? "open" : "resolved", open ? "reopened a comment" : "resolved a comment");
    },
  }),
  "thread.seen": def({
    summary: "mark a comment thread seen (PIE-791): it leaves the margin for the earlier shelf, and a new reply brings it back; back=true brings it back now. It opens the thread list in the reader",
    keys: [{ keys: "s", does: "in the thread list (m)" }, { keys: "click", does: "[Seen] on an expanded thread" }],
    touches: "tile", replay: "ask", answer: RECORDED_AS, way: "the thread list would cover what they're reading · an agent marks it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, back: { type: "boolean", optional: true, about: "bring an earlier thread back instead" } },
    examples: [
      { act: "thread.seen thread=5b2e8d", does: "marks that thread seen, moving it off the margin to the earlier shelf" },
      { act: "thread.seen thread=5b2e8d back=true", does: "brings that earlier thread back into the margin" },
    ],
    async run({ thread, back }, on, actor) {
      const { t } = await threadIn(on, thread);
      const to = (back ?? !t.open) ? "open" : "seen";
      return attention(on, actor, thread, to, to === "seen" ? "marked a comment seen" : "brought a comment back");
    },
  }),
  "thread.keep": def({
    summary: "keep a comment thread (PIE-791): it stays in the margin whatever else is put away, and is in the outline's kept marks; again (or keep=false) unkeeps it. It opens the thread list in the reader",
    keys: [{ keys: "p", does: "in the thread list (m)" }, { keys: "click", does: "[Keep] on an expanded thread" }],
    touches: "tile", replay: "ask", answer: RECORDED_AS, way: "the thread list would cover what they're reading · an agent keeps it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, keep: { type: "boolean", optional: true, about: "true keeps, false unkeeps; left out, it toggles" } },
    examples: [
      { act: "thread.keep thread=5b2e8d", does: "keeps that thread in the margin, or unkeeps it if kept" },
      { act: "thread.keep thread=5b2e8d keep=false", does: "unkeeps that thread so it can be put away" },
    ],
    async run({ thread, keep }, on, actor) {
      const { t } = await threadIn(on, thread);
      const to = (keep ?? t.lifecycle !== "kept") ? "kept" : "open";
      return attention(on, actor, thread, to, to === "kept" ? "kept a comment" : "unkept a comment");
    },
  }),
  "thread.tldr": def({
    summary: "a comment thread's TL;DR (PIE-791): @margin writes a short summary as a reply with [kind::tldr], which becomes the thread's face, its discussion folded behind it. body= writes it instead (yours, or an edit of @margin's). With no model set up for @margin none is written, and it says how to set one up (PIE-860). remove=true takes it away: the discussion is the face again",
    keys: [{ keys: "t", does: "in the thread list (m)" }, { keys: "T", does: "takes it away" }, { keys: "click", does: "[TL;DR] on an expanded thread, [TL;DR again], [No TL;DR]" }],
    touches: "tile", replay: "ask", answer: RECORDED_AS, way: "the thread list would cover what they're reading · an agent asks in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, body: { type: "string", optional: true, about: "the TL;DR itself; left out, @margin writes it" }, remove: { type: "boolean", optional: true, about: "take its TL;DR away" } },
    examples: [
      { act: "thread.tldr thread=5b2e8d", does: "asks @margin to write a short TL;DR as that thread's face" },
      { act: 'thread.tldr thread=5b2e8d body="Mulch the front bed in March"', does: "sets that thread's TL;DR to those words" },
      { act: "thread.tldr thread=5b2e8d remove=true", does: "takes the TL;DR away so the discussion is the face again" },
    ],
    async run({ thread, body, remove }, { surface, host }, actor) {
      // Taken away from an expanded thread or the list: the thread changes, the person's view doesn't (no list opens).
      if (remove) {
        await surface.whole();
        const id = surface.threadId(thread), c = surface.comments?.find(x => x.id === id);
        if (!c?.tldr) throw new ActionRefused("this thread has no TL;DR to take away");
        await host.ctx.board.request("annotations.tldr", { annotationId: id, remove: true, mutation: mutationFor(actor) });
        await surface.loadComments(host);
        if (surface.session?.mode === "threads") surface.session.threads = surface.comments ?? surface.session.threads;
        asActor(host.ctx, actor).flash("took the TL;DR away");
        surface.noteAgent(actor, "took a comment's TL;DR away");
        host.redraw();
        return { removed: true, recordedAs: recordedAnswer(actor) };
      }
      const { s, i } = await threadIn({ surface, host }, thread);
      s.sel = i;
      const env = surface.env(host, actor);
      if (body) {
        await env.board.request("annotations.tldr", { annotationId: s.threads[i]!.id, ...(body ? { body } : {}), mutation: mutationFor(actor) });
        s.threads = await env.reloadComments();
        surface.noteAgent(actor, "wrote a comment's TL;DR");
        host.redraw();
        return { tldr: body, recordedAs: recordedAnswer(actor) };
      }
      const asked = await s.askTldr(env);
      if (!asked) throw new ActionRefused(s.error ?? "no agent could be asked for a TL;DR");
      surface.noteAgent(actor, "asked for a comment's TL;DR");
      host.redraw();
      return { asked };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const QUOTE_DEFS = {
  "quote": def({
    summary: "quote marks into a new block (the margin's quote-tweet): a highlight, a comment or a reply, or several, each transcluded (!((mark))) under one [from::((mark))] line so it traces back to where it was said; each mark's card then says quoted in. where= inbox (the default), note (under this note) or a block (its id or ((ref))); the person's, left out, is asked in the power bar: under this note (first: a quote-reply sits with what it answers), the Inbox, or any note by its words. The person's quote then opens where their new notes open (note.opens: a float beside the reader, by default), lit as just arrived, in their edit at the end of the quote (PIE-1184); an agent's opens nothing. text= the new block's own words above the quotes (its title). The marks stay where they are. One write: ctrl+z (ext.undo) takes it back. Recorded as whoever asks",
    keys: "q in the thread list (m) on the thread, or on the threads picked with space; a click on an expanded thread's [Quote] or a reply's [Quote]",
    touches: "nothing", replay: "ask", answer: RECORDED_AS,
    args: {
      threads: { type: "string", optional: true, about: "the marks: ids (or their first 6+ characters) of threads (a highlight or comment) or replies on this note, comma-separated; left out, the thread list's picked threads, else its current one" },
      where: { type: "string", optional: true, about: "inbox (the top of the Inbox), note (under this note) or a block id or ((ref)) to put it under; an agent's default is inbox" },
      text: { type: "string", optional: true, about: "the new block's own words, above the quotes (its first line is its title); left out, Quoting “…”" },
    },
    examples: [
      { act: "quote threads=5b2e8d", does: "quotes that mark into a new block at the top of the Inbox" },
      { act: 'quote threads=5b2e8d,9c41af where=note text="Mulch notes"', does: "quotes both marks into a block titled Mulch notes under this note" },
    ],
    async run({ threads, where, text }, { surface, host, standing }, actor) {
      surface.requireNote();
      await surface.loadComments(host);
      // The thread list's picks are the person's: only their own quote takes (and clears) them.
      const s = actor.kind === "user" && surface.session?.mode === "threads" ? surface.session : null;
      const named = threads ?? (s ? (s.picked.size ? [...s.picked].join(",") : s.threads[s.sel]?.id) : undefined);
      if (!named) throw new ActionRefused("say which marks: threads=<id>[,<id>…] (peek lists them under comments.threads); in the thread list, q quotes the current thread or the ones picked with space");
      const ids = surface.markIds(named);
      // The person's quote lands where they are (PIE-1184): opened in their edit where their new notes open.
      const run = (answers: Record<string, string>) => surface.quoteMarks(ids, answers.where ?? "inbox", host, actor, text, standing && actor.kind === "user").then(r => { s?.picked.clear(); return r; });
      if (where !== undefined || actor.kind === "agent") return run({ where: where ?? "inbox" });
      // Under this note first: a quote-reply sits with what it answers.
      return askInBar(host.ctx as never, ids.length === 1 ? "Quote a mark" : `Quote ${ids.length} marks`, [{
        name: "where", type: "note", label: "where it goes", description: "The new block transcludes each mark and links back to it, and opens beside you to write in. Under this note (a child of it), the Inbox, or type to find any note to put it under.",
        choices: ["note", "inbox"], says: { note: "under this note", inbox: "in the Inbox" },
      }], {}, actor, run);
    },
  }),
  "thread.pick": def({
    summary: "pick a thread in the thread list for a quote of several (q then quotes the picked ones); again unpicks it. The person's thread list: an agent names its marks with quote threads=",
    keys: "space in the thread list (m)",
    touches: "tile", replay: "safe", person: "the thread list's picks are the person's; an agent names its marks with quote threads=",
    args: { thread: { type: "string", optional: true, about: "the thread's id (or its first 6+ characters); left out, the current one" } },
    examples: [
      { act: "thread.pick thread=5b2e8d", does: "picks that thread in the list for a quote of several, or unpicks it" },
      { act: "thread.pick", does: "picks the thread the list is on, or unpicks it" },
    ],
    run({ thread }, { surface, host }) {
      const s = surface.session;
      if (!s || s.mode !== "threads") throw new ActionRefused("the thread list isn't open · m opens it");
      const id = thread !== undefined ? s.threads[findThread(s, thread)]!.id : s.threads[s.sel]?.id;
      if (!id) throw new ActionRefused("no thread here to pick");
      if (s.picked.has(id)) s.picked.delete(id); else s.picked.add(id);
      host.redraw();
      return { picked: [...s.picked] };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
