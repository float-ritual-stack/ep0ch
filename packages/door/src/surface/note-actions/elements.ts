// The reader's elements and where it goes from them: link.*, elements and element.* (what [ ] walks and ⏎ opens),
// block.tint (a focus mark), projection.refresh, up, links, back, forward and trail, and element.zoom.
import { type On, refreshOf, noteRow, STEPS_ARG, TINT_ARGS } from "./shared";
// The whole set and the reader's element test, read only when an action runs (element.open runs what an element names).
import { NOTE_ACTIONS, opens } from "../note";
import { USER, whoOf, type Actor } from "../../socket";
import { linkOfRef } from "../link-model";
import { readerKeys } from "../reader-keys";
import { subject, type Msg } from "../../board";
import { isOutlineNote } from "../../authored";
import { messageContext } from "../../status-log";
import { type ActionDef, ActionRefused, agentLabel, def } from "../actions";

export const ELEMENT_DEFS = {
  "link.select": def({
    summary: "select the note's nth link (1 is the first); element.select picks any element a reader draws", keys: "[ ] (on a link)",
    touches: "tile", replay: "safe", way: "an agent selects a link in a reader the person isn't in, or follows one by number (link.follow n=)",
    args: { n: { type: "number", about: "which link, from 1" } },
    examples: [
      { act: "link.select n=2", does: "selects the note's second link, as the [ ] keys would" },
    ],
    run({ n }, { surface, host }) { surface.requireNote(); surface.selectLink(n - 1); host.redraw(); return surface.describe().links[n - 1]; },
  }),
  "link.follow": def({
    summary: "follow the selected link (or the nth); where it opens is the view's call; fresh=true opens it in a new reader", keys: readerKeys("link.follow", { keys: "click", does: "on a link" }),
    touches: "tile", replay: "ask", way: "following a link there would move what they're reading · an agent follows one in another reader (tile=), or opens the note with open id= naming no tile (it lands where opens land)",
    args: {
      ref: { type: "string", optional: true, about: "a link drawn in a snippet: ((id)), [[page]], a URL or #tag" },
      n: { type: "number", optional: true, about: "which link, from 1; default the selected one" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    examples: [
      { act: "link.follow n=1", does: "opens the note's first link where the view opens links" },
      { act: "link.follow n=2 fresh=true", does: "opens the note's second link in a new reader" },
    ],
    async run({ n, fresh, ref }, on, actor) {
      const { surface, host } = on;
      surface.requireNote();
      // While the person's comment is unsent here, they're asked first (PIE-785).
      const asked = surface.askLeave("link.follow", { ...(ref !== undefined ? { ref } : {}), ...(n !== undefined ? { n } : {}), ...(fresh ? { fresh } : {}) }, actor, host);
      if (asked) return asked;
      if (ref !== undefined) {
        const link = linkOfRef(ref);
        if (!link) throw new ActionRefused(`${ref} isn't a link`);
        const m = await surface.followFromDraft(link, host);
        return m && "id" in m ? { opened: m.id, title: subject(m) } : { opened: null, ...(m ?? {}) };
      }
      // The nth link, else the one the position is on. Drawn, it is its element's activation (element.open, PIE-1556),
      // which makes the person's their [ ] position and leaves an agent's alone; not drawn, it's followed as ⏎ would.
      const links = surface.noteLinks();
      if (n !== undefined && !links[n - 1]) throw new ActionRefused(`there is no link ${n}; the note has ${links.length}`);
      const link = n !== undefined ? links[n - 1]! : surface.selectedLink();
      if (!link) throw new ActionRefused("no link is selected; pass n");
      const e = surface.elementOfLink(link, true);
      if (e) { const r: unknown = await NOTE_ACTIONS.run("element.open", { n: surface.elems.indexOf(e) + 1, ...(fresh && opens(e) ? { fresh } : {}) }, on, actor); return r as { opened: string | null }; }
      const m = await surface.followLink(link, host, !!fresh);
      // Outside the door (a web page, a file): the person's opened there; an agent's is given the address.
      if (m && "outside" in m) return { opened: null, ...m };
      // A #tag (PIE-800): the list it opened (or, for an agent, the notes carrying it).
      if (m && "query" in m) return { opened: null, ...m };
      // A soft link with several places to land (PIE-408): the agent's told them, and moves nothing.
      if (m && "choices" in m) return { opened: null, ...m };
      if (m) surface.noteAgent(actor, `followed a link to ${subject(m)}`);
      return m ? { opened: m.id, title: subject(m) } : { opened: null };
    },
  }),
  "elements": def({
    summary: "list what [ ] steps through in this reader, in reading order: links, figure rows, embeds, comment marks (the current one marked)",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { elements: surface.describeElements() };
    },
  }),
  "element.scroll": def({
    summary: "scroll the inline list containing element n, passing the wheel to the note at its ends",
    touches: "tile", replay: "safe", person: "the list's scroll belongs to the person", keys: "wheel over an inline list",
    args: { n: { type: "number", about: "an element in the list" }, by: { type: "number", about: "rows to scroll" } },
    examples: [{ act: "element.scroll n=2 by=3", does: "scrolls the inline list containing the second element down three rows" }],
    run({ n, by }, { surface, host }) { surface.scrollInline(n, by); host.redraw(); return {}; },
  }),
  "element.select": def({
    summary: "put the person's [ ] position on the nth element (elements lists them), or by=1 / by=-1 the next or previous one (from the view when none is current); n=0 lets go of it. row= picks a row inside that element's inline list. The reading ruler follows. An agent's is refused: the position is the person's (block.tint marks something for them)", keys: readerKeys("element.select", { keys: "click", does: "an element" }),
    touches: "tile", replay: "safe", person: "the [ ] position is the person's; block.tint marks a block for them without moving it",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1, as elements lists them; 0 lets go" },
      row: { type: "number", optional: true, about: "row within this inline list, from 1" },
      by: { type: "number", optional: true, about: "1 the next element, -1 the previous one" },
    },
    examples: [
      { act: "element.select n=3", does: "puts the [ ] position on the note's third element" },
      { act: "element.select by=1", does: "steps the [ ] position to the next element" },
      { act: "element.select n=2 row=5", does: "selects the fifth row of the note's second element, an inline list, and previews it" },
    ],
    async run({ n, by, row }, { surface, host }, _actor) {
      if ((n === undefined) === (by === undefined)) throw new ActionRefused("say n= (an element, 0 lets go) or by=1 / by=-1");
      // Letting go of a collection's row (esc) ends the peek that followed it, as leaving a list did (PIE-849, PIE-1501).
      if (n === 0) { if (surface.listAtCursor()?.collection) host.retirePeeks?.(USER); surface.letGo(); host.redraw(); return { current: null }; }
      if (by !== undefined) {
        if (!surface.step(by < 0 ? -1 : 1)) throw new ActionRefused("nothing to step to: this note has no links, folds, figure rows, embeds, resource projections or comments");
        surface.previewRow(host);
        host.redraw();
        return surface.describeElements().find(e => e.current) ?? null;
      }
      await surface.whole();
      if (row !== undefined && (!Number.isInteger(row) || row < 1)) throw new ActionRefused("row must be a whole number from 1");
      const selected = row !== undefined ? surface.selectInlineRow(surface.element(n!), row - 1) : null;
      if (!selected) surface.selectElement(surface.element(n!));
      surface.previewRow(host);
      host.redraw();
      return selected ?? surface.describeElements()[n! - 1];
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const ELEMENT_OPEN_DEFS = {
  "element.open": def({
    summary: "do what enter does on an element: a link follows (where is the view's call), a fold toggles, a row or an embed opens its note, a comment mark opens its thread; fresh=true opens a link, row or embed in a new reader. An agent's leaves the person's [ ] position alone, is refused in the reader they have, and never opens the browser (it is given the address)", keys: readerKeys("element.open", { keys: "click", does: "on an element" }),
    touches: "tile", replay: "ask", way: "opening an element there would move what they're reading · an agent opens one in another reader (tile=), opens the note with open id=, or folds a section with fold or unfold",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1 (elements lists them); default the current one (the person's own only)" },
      row: { type: "number", optional: true, about: "row within this element's inline list, from 1" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    examples: [
      { act: "element.open n=2", does: "opens the note's second element, as enter does on it" },
      { act: "element.open n=2 fresh=true", does: "opens the second element, a link, row or embed, in a new reader" },
    ],
    async run({ n, fresh, row }, on, actor) {
      const { surface, host, standing } = on;
      // The person's key or click is on what's drawn now: no wait for the whole note.
      if (!standing) await surface.whole();
      if (n === undefined && !standing) throw new ActionRefused("say which element: n (elements lists them); the current one is the person's");
      const cur = standing ? surface.inView() : null;
      const i = n ?? (cur ? surface.describeElements().findIndex(e => e.current) + 1 : 0);
      if (!i) throw new ActionRefused("no element is current in view; pass n");
      if (row !== undefined && (!Number.isInteger(row) || row < 1)) throw new ActionRefused("row must be a whole number from 1");
      const e = row === undefined ? surface.element(i) : surface.inlineRowElement(surface.element(i), row - 1);
      // A code block or a quote has nothing to open: ⏎ copies it (the person's to their clipboard, an agent's returned).
      if (e.kind === "block") { const r: unknown = await NOTE_ACTIONS.run("block.copy", { n: e.block! + 1 }, on, actor); return r; }
      if (fresh && e.kind !== "link" && e.kind !== "row" && e.kind !== "embed" && !e.link?.press?.alt) throw new ActionRefused(`fresh opens a link, a row or an embed; element ${i} is a ${e.kind}`);
      // Going elsewhere while the person's comment is unsent here asks them first (PIE-785).
      if (e.kind === "link" || e.kind === "row" || e.kind === "embed" || e.kind === "comment") {
        const asked = surface.askLeave("element.open", { n: i, ...(row !== undefined ? { row } : {}), ...(fresh ? { fresh } : {}) }, actor, host, e.key);
        if (asked) return asked;
      }
      // The person's activation is on their [ ] position (a click's element becomes it, as ⏎'s already is); an agent's leaves it.
      if (standing && row === undefined) surface.selectElement(e);
      // A step's box opens the person's status choice; an agent sets the status itself.
      // A live figure's tab or density control: the figure's own action, with its rules and its provenance.
      if (e.kind === "figure" && e.link?.figure) {
        return surface.runFigureControl(e.link.figure, host, actor);
      }
      if (e.kind === "task" && !standing) throw new ActionRefused(`element ${i} is a step's status control; an agent sets it with task.status n=… to=done|todo|waiting|problem|approved|rejected (tasks lists the steps)`);
      // An extension's line (PIE-512): its head runs the line's primary action, a control its own; an agent's
      // run is the agent's (said on the status bar), and what it writes is the extension's (ext:<id>).
      if (e.link?.ext && !e.link.press && (e.kind === "control" || e.kind === "resource")) {
        const r = await surface.runExt(e.link.ext.action, e.link.ext, host, actor);
        surface.noteAgent(actor, `ran ${e.link.ext.action} on ${e.label}`);
        return { element: i, kind: e.kind, action: e.link.ext.action, ...(r && typeof r === "object" ? r : {}) };
      }
      // A press (PIE-957): its action line, through the door's dispatcher, as whoever asks (the person's asks first when it writes).
      if (e.link?.press && e.kind === "control") {
        const act = fresh && e.link.press.alt ? e.link.press.alt : e.link.press.act;
        const r = await host.ctx.dispatch!.act({ action: "button.press", args: { n: i, ...(fresh ? { alt: true } : {}) }, ...(messageContext.getStore()?.tile ? { tile: messageContext.getStore()!.tile } : {}) }, actor);
        surface.noteAgent(actor, `pressed ${e.label} (${act})`);
        return { element: i, kind: e.kind, act, ...(r && typeof r === "object" ? r : {}) };
      }
      // An `■ unsent` line's control runs its action as whoever asks (an agent's is refused: the unsent text is the person's).
      if (e.kind === "control" && e.link?.unsent) {
        const r: unknown = await NOTE_ACTIONS.run(`unsent.${e.link.unsent.op}`, { kind: e.link.unsent.kind }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A proposal's [apply] [dismiss] run its action as whoever asks, attributed to them.
      if (e.kind === "control" && e.link?.proposal?.op) {
        const r: unknown = await NOTE_ACTIONS.run(`proposal.${e.link.proposal.op}`, { id: e.link.proposal.id }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A `::fields` row's ¶ anchors its line, as whoever asks.
      if (e.link?.anchor) {
        const r: unknown = await NOTE_ACTIONS.run("fields.anchor", { key: e.link.anchor.key, n: e.link.anchor.n }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A `::use` that needs a prop: an agent names them (use.fill with=); the person is asked.
      if (e.link?.use && !standing) throw new ActionRefused(`that's a ::use that needs a prop: an agent gives it with use.fill block=${e.link.use.block} line=${e.link.use.line + 1} with='{"name":"value"}'`);
      // An expanded thread's controls are the person's view of it; an agent acts on the thread itself.
      if (e.kind === "control" && !standing) throw new ActionRefused(`that's the person's ${e.control} control on ${e.control === "card" ? "a margin card" : "an expanded thread"}; an agent uses ${e.control === "select" ? "select text=…" : e.control === "reply" ? `reply thread=${e.thread!.slice(0, 8)} body=…` : e.control === "edit" ? `comment.edit thread=${e.thread!.slice(0, 8)}${e.value ? ` reply=${e.value.slice(0, 8)}` : ""} body=…` : e.control === "card" ? "threads, or reply" : e.control === "quote" ? `quote threads=${(e.value ?? e.thread!).slice(0, 8)} where=inbox` : e.control === "quoted" ? `open id=${e.value ?? ""}` : e.control === "untldr" || e.control === "tldr" ? `thread.tldr thread=${e.thread!.slice(0, 8)}${e.control === "untldr" ? " remove=true" : ""}` : `resolve thread=${e.thread!.slice(0, 8)} (open=true reopens)`}`);
      // An agent's comment mark opens the thread list as its own session, on that thread (never under the
      // person's property panel, which would take the keys meant for it).
      if (e.kind === "comment" && !standing) {
        if (surface.panel && !surface.draft && !surface.session) throw new ActionRefused("the person has the property panel open on this note; try again once they close it");
        const r = await NOTE_ACTIONS.run("threads", {}, on, actor) as { threads: { id: string }[] };
        const s = surface.session;
        const t = s ? s.threads.findIndex(x => x.id === e.thread) : -1;
        if (s && t >= 0) s.sel = t;
        host.redraw();
        return { thread: e.thread, ...r };
      }
      const r = await surface.openElement(e, host, !!fresh, standing, actor);
      // Outside the door, an agent's was given the address (openOutside said so); it opened nothing.
      if (!(r && typeof r === "object" && "outside" in r)) surface.noteAgent(actor, `${e.kind === "fold" ? "toggled" : "opened"} ${e.label}`);
      host.redraw();
      return { element: i, kind: e.kind, ...(r && typeof r === "object" && "id" in r ? { opened: (r as Msg).id, title: subject(r as Msg) } : r && typeof r === "object" ? r : {}) };
    },
  }),
  // A tint (PIE-423's focus mark): "focus" is the person's keys only, so the tint is block.tint.
  // A tint in the reading ruler's colour, with who set it.
  "block.tint": def({
    summary: "tint a block in this reader (PIE-423's focus mark): a block (this note, or one it embeds or links), note lines, or an exact passage, tinted like the reading ruler with who set it named, and scrolled into view. The person's [ ] position, selection and keys aren't moved",
    touches: "nothing", replay: "safe",
    args: TINT_ARGS,
    examples: [
      { act: "block.tint line=3 to=5", does: "tints lines 3 to 5 of the note and scrolls them into view" },
      { act: 'block.tint quote="mulch the beds"', does: "tints those exact words, naming who marked them" },
    ],
    async run(spec, { surface, host }, actor) {
      await surface.whole();
      const r = surface.setFocus(spec, actor);
      host.ctx.flash(`${agentLabel(actor)} marked ${r.marked}`);
      host.redraw();
      return { ...r, by: whoOf(actor) };
    },
  }),
  "block.untint": def({
    summary: "take away the tint (block.tint) in this reader (esc does it for the person once nothing else is selected)", keys: readerKeys("block.untint"),
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface, host }, actor) {
      const had = surface.focusMark;
      surface.focusMark = null;
      if (had && actor.kind === "user") host.ctx.flash(`let go of the focus mark ${agentLabel(had.by)} set`);
      host.redraw();
      return { cleared: !!had, ...(had ? { by: whoOf(had.by) } : {}) };
    },
  }),
  "projection.refresh": def({
    summary: "fetch the tickets a note shows now (a page's, or the ticket block's own), and run its extensions' lines again (PIE-507): block=<id> (line=<index> for one line: an output, a component, an @name request is asked again, a record fetched), else the one the [ ] position is on, else the note's (its tickets; its one line that runs, when it has one). A note with several lines that run (handler lines, components, @name requests) and no position is refused naming them: none runs (PIE-956). Who runs it is who asked (an @name line says so). The service runs them and writes as the extension; the region repaints", keys: readerKeys("projection.refresh", { keys: "click", does: "on a ticket's age or on a line's run again control (behind its gutter mark)" }),
    touches: "nothing", replay: "ask",
    args: {
      block: { type: "string", optional: true, about: "the block whose tickets and lines to fetch or run (a page or a ticket block); default: the reader's" },
      line: { type: "number", optional: true, about: "only that line (its index in the note's text, 0 the first), of block= or else the reader's note" },
    },
    examples: [
      { act: "projection.refresh", does: "fetches the tickets the note shows now and repaints them" },
      { act: "projection.refresh block=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 line=4", does: "runs line 4 of that note again, counting from 0" },
    ],
    async run(a, { surface, host }, actor) {
      const m = surface.msg;
      const t = typeof a.block === "string" && a.block ? { block: a.block, ...(a.line !== undefined ? { line: a.line } : {}) }
        : m && isOutlineNote(m) ? (a.line !== undefined ? { block: m.id, line: a.line } : refreshOf(surface, host, actor)) : null;
      if (!t) throw new ActionRefused("no note with tickets here");
      return surface.refreshTickets(host, t.block, actor, t.line);
    },
  }),
  "up": def({
    summary: "go to the note's parent. An agent's is refused on the reader the person has", keys: readerKeys("up", { keys: "U", does: "in the message reader" }),
    touches: "tile", replay: "safe", way: "up would move what they're reading · an agent goes up in another reader (tile=), or opens the parent with open id=",
    menu: noteRow("up to the parent", "u", { busy: true }),
    args: {},
    async run(_, { surface, host, standing }, _actor) {
      if (standing) surface.letGo();
      const m = await surface.goUp(host);
      if (!m) throw new ActionRefused("the note has no parent");
      return { opened: m.id, title: subject(m) };
    },
  }),
  "links": def({
    summary: "show this reader's note's links (its Outlinks, Resources and Backlinks, the links model the outliner's Tree shows) in the screen's links tile: it aims at this note, its dock opens, and the person's keys go to it; on a screen without one a links tile opens below the reader with a preview following its selection. An agent's never aims the person's links tile: where the screen has one, it answers this note's links (the tile keeps its note and selection); where there's none, it opens one of its own below the reader, on this note. Either way the person's keys stay where they are. A note can list them inline too: ::links, ::resources, ::backlinks",
    keys: readerKeys("links"),
    touches: "shape", replay: "safe", says: () => "showed the links",
    menu: noteRow("links", "b", { now: ({ surface, host }) => (!host.links || !surface.msg || !isOutlineNote(surface.msg) ? { hide: true } : null) }),
    args: {},
    async run(_, { surface, host, standing }, actor) {
      const m = surface.msg;
      if (!m) throw new ActionRefused("no note here to show the links of", "not-found");
      if (!isOutlineNote(m)) throw new ActionRefused("a resource or a file isn't a block: it has no links here");
      if (!host.links) throw new ActionRefused("this screen has no room for a links tile · write ::links in a note to list them inline");
      return host.links(actor, standing);
    },
  }),
  "back": def({
    summary: "go back to the note this reader showed before it followed a link, went up, or had a note opened into it (an agent's open too), scrolled and with its [ ] position as it was. An agent's is refused on the reader the person has focused",
    keys: readerKeys("back", { via: "the mouse's back button" }, { keys: "click", does: "on ← back" }),
    touches: "tile", replay: "safe", way: "back would move what they're reading · an agent goes back only in another reader (name it with tile=)",
    menu: noteRow("back", "alt+left", { busy: true, now: ({ surface }) => (surface.describeHistory().back.length ? null : { hide: true }) }),
    args: { steps: STEPS_ARG },
    examples: [{ act: "back steps=2", does: "goes back two stops on the trail at once, as two backs would" }],
    run: ({ steps }, on, actor) => travelAction(-1, on, actor, steps),
  }),
  "forward": def({
    summary: "go forward again to where back came from, scrolled and with its [ ] position as it was. An agent's is refused on the reader the person has focused",
    keys: readerKeys("forward", { via: "the mouse's forward button" }, { keys: "click", does: "on forward →" }),
    touches: "tile", replay: "safe", way: "forward would move what they're reading · an agent goes forward only in another reader (name it with tile=)",
    menu: noteRow("forward", "alt+right", { busy: true, now: ({ surface }) => (surface.describeHistory().forward.length ? null : { hide: true }) }),
    args: { steps: STEPS_ARG },
    examples: [{ act: "forward steps=2", does: "goes forward two stops on the trail at once" }],
    run: ({ steps }, on, actor) => travelAction(1, on, actor, steps),
  }),
  "trail": def({
    summary: "the trail of where this reader has been (PIE-208): every stop back and forward by its title, nearest first, the note shown between them. The person's opens it as a trail tile beside the reader (PIE-1425: docked, resized and closed like any tile; alt+T again goes back to it), or a list over a screen without tiles: ⏎ or a click on a stop goes there (back or forward that many steps, as back steps= does), esc closes it. An agent's answers the stops and opens nothing",
    keys: readerKeys("trail", { keys: "click", does: "on ≡ trail beside ← back" }),
    touches: "nothing", replay: "safe",
    menu: noteRow("trail: where it's been", "alt+T", { busy: true, now: ({ surface }) => { const h = surface.describeHistory(); return h.back.length || h.forward.length ? null : { hide: true }; } }),
    args: {},
    examples: [{ act: "trail", does: "lists the stops back and forward; back steps=2 then goes to the second one back" }],
    run: (_, { surface, host, standing }) => surface.trail(host, standing),
  }),
  "element.zoom": def({
    summary: "zoom this reader into a part of its note (PIE-780): the figure, table, heading's section, callout, list item or paragraph at line= (from 1; default the [ ] position's, else the reading line's), or anchor=, fills the tile, interactive at full size, the part element.detach would take there (the service says which lines). Where it was goes on its back trail: on=false, esc, back or a click on ← back returns to the whole note as it was; forward zooms in again. An agent's is refused on the reader the person has focused",
    keys: readerKeys("element.zoom", { keys: "click", does: "on a part's ⤢" }),
    touches: "tile", replay: "safe", way: "zooming would change what they're reading · an agent zooms only in another reader (name it with tile=)",
    says: r => (r as { zoomed?: { label: string } }).zoomed ? `zoomed into ${(r as { zoomed: { label: string } }).zoomed.label}` : "back to the whole note",
    menu: noteRow("zoom into this part", "W", { busy: true, now: ({ surface }) => (!surface.msg || !isOutlineNote(surface.msg) ? { hide: true } : null) }),
    args: {
      line: { type: "number", optional: true, about: "a line of the part, in the note from 1 (default: the [ ] position's, else the reading line's)" },
      anchor: { type: "string", optional: true, conflicts: ["line"], about: "the part's ^anchor, when it has one" },
      on: { type: "boolean", optional: true, about: "false steps back out of the zoom (to the part it was zoomed from, else the whole note); left out, zooms in, inside a zoomed part too" },
    },
    examples: [
      { act: "element.zoom line=4", does: "fills the reader with the figure (or table, or section) on line 4 of its note" },
      { act: "element.zoom anchor=bed-jobs", does: "zooms into the part anchored ^bed-jobs" },
      { act: "element.zoom on=false", does: "returns the reader to the whole note, scrolled as it was" },
    ],
    async run({ line, anchor, on }, { surface, host }, actor) {
      if (on === false) {
        const why = await surface.unzoom(host, actor);
        if (why) throw new ActionRefused(why);
        surface.noteAgent(actor, "went back to the whole note");
        return { zoomed: null, history: surface.describeHistory() };
      }
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new ActionRefused("line= is a line of the note, from 1");
      const z = await surface.zoomInto({ ...(line !== undefined ? { line: line - 1 } : {}), ...(anchor !== undefined ? { anchor: String(anchor) } : {}) }, host);
      surface.noteAgent(actor, `zoomed into ${z.label}`);
      return { zoomed: { kind: z.kind, label: z.label, lines: [z.start + 1, z.end + 1], ...(z.anchor ? { anchor: z.anchor } : {}) }, history: surface.describeHistory() };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

/**
 * back, forward (PIE-453). An agent's never moves what the person is reading: refused on the reader they have
 * focused, and where the view keeps the history (it would move their screen or focus).
 */
async function travelAction(dir: -1 | 1, { surface, host, standing }: On, actor: Actor, steps = 1) {
  const word = dir < 0 ? "back" : "forward";
  // Where the view keeps the history itself (the river's columns), it moves the person's keys: theirs alone. This reader's own stops (n and p in the message reader) move only it, an agent's too.
  if (!standing && host.history && !host.history.beneath && !surface.travelsHere(dir)) throw new ActionRefused(host.history.agentRefusal);
  // The person's comment unsent here: asked first (PIE-785).
  // (Synchronous when nothing is asked: the follow goes on in the same tick, as it always did.)
  const asked = surface.askLeave(word, {}, actor, host);
  if (asked) return asked;
  if (!Number.isInteger(steps) || steps < 1) throw new ActionRefused("steps is a whole number from 1 (trail lists the stops)");
  const why = await surface.travel(dir, host, actor, steps);
  if (why) throw new ActionRefused(why);
  surface.noteAgent(actor, `went ${word} here`);
  host.redraw();
  const m = surface.msg;
  return { went: word, showing: m ? { id: m.id, title: subject(m) } : null, history: surface.describeHistory() };
}
