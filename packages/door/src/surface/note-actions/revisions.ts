// revision.* and revisions: a note's earlier texts (PIE-621) and the compare beside the note now (PIE-1433).
import { ATTACHED_KEYS } from "../attached-keys";
import { type ActionDef, ActionRefused, def } from "../actions";
import { centred, ListPicker, pickRow } from "../picker";
import { modeActionKeys } from "../modes";
import { noteRow, type On, REFUSED } from "./shared";
import { pageRows } from "../../scroll";
import { printable } from "../../props";
import { revisionByline } from "@ep0ch/outline-core/attribution";
import { subject } from "../../board";
import { compareAt, type RevisionAgainst, revisionFacts } from "../revision-compare";
import { whenPut } from "../../edit";

export const REVISION_DEFS = {
  "revision.restore": def({
    summary: "go back to an earlier revision of the note (PIE-621): the edit opens (or the open one is used) and that revision's text goes in as one undo step, said with when it was saved; nothing is written until it's saved (ctrl+s), and ctrl+z takes it back. Without revision=, the one before what the edit holds (run it again to go further back). The service keeps the newest 100 texts a note had (`ep0ch revisions <note>` lists them). An agent's: only in an edit it opened",
    keys: [{ via: "the tile menu's \"an earlier revision\"" }],
    touches: "draft", draft: "replace", replay: "ask",
    menu: noteRow("an earlier revision", "", { now: ({ surface }) => (surface.session ? { hide: true } : null) }),
    args: { revision: { type: "number", optional: true, about: "the revision (`ep0ch revisions <note>` lists them); default the one before what the edit holds" } },
    examples: [
      { act: "revision.restore", does: "puts the revision before the edit's text into the edit, unsaved, as one undo step" },
      { act: "revision.restore revision=3", does: "puts revision 3's text into the edit, unsaved, as one undo step" },
    ],
    async run({ revision }, { surface, host }, actor) {
      surface.requireNote();
      const { draft: d } = await surface.ensureDraft(host);
      const list = await host.ctx.board.revisions(d.blockId);
      const from = d.revisionShown ?? d.base;
      const want = revision ?? list.revisions.find(r => r.revision < from)?.revision;
      if (want === undefined) throw new ActionRefused(`no revision before ${from} is kept for this note (the service keeps them from the first save after PIE-621)`);
      const r = await host.ctx.board.revisionText(d.blockId, want);
      d.replace(r.text, actor, `revision ${want}'s text`, true);
      d.revisionShown = want;
      d.status.say(`revision ${want} of ${list.revision}, saved ${whenPut(Date.parse(r.savedAt))}${revisionByline(r) ? ` ${revisionByline(r)}` : ""} · ctrl+s saves it as the note · ctrl+z takes it back`);
      surface.noteAgent(actor, `put revision ${want}'s text into the edit`);
      host.redraw();
      return { revision: want, current: list.revision, savedAt: r.savedAt, chars: r.chars, earlier: list.revisions.filter(x => x.revision < want).map(x => x.revision) };
    },
  }),
  "revision.compare": def({
    summary: "this note at an earlier revision, beside how it is now (PIE-1433): revision's text marked against the next revision kept (- was there, + came next), or against=now the note as it is now; ← → older and newer, Esc back to the note. Without revision=, the one before the note now. A suggestions page row (a table with at:) and the history list open it",
    keys: [{ via: "a table row with at: (the suggestions page)" }, { via: "the tile menu's \"history\"" }],
    touches: "tile", replay: "safe",
    args: { revision: { type: "number", optional: true, about: "the revision (revisions or `ep0ch revisions <note>` lists them); default the one before the note now" },
      against: { type: "string", optional: true, about: "next (the default: the next revision kept) or now (the note as it is now)" },
      passage: { type: "string", optional: true, about: "text to scroll to (a review's passage); default the first change" } },
    examples: [
      { act: "revision.compare", does: "shows the last change: the revision before the note now, marked against it" },
      { act: "revision.compare revision=3", does: "shows revision 3 beside the note, marked against revision 4" },
      { act: "revision.compare revision=3 against=now", does: "shows revision 3 marked against the note as it is now" },
    ],
    async run({ revision, against, passage }, { surface, host, standing }) {
      if (against !== undefined && against !== "next" && against !== "now") throw new ActionRefused("against is next or now");
      const m = surface.requireNote(), to = (against ?? "next") as RevisionAgainst;
      if (!standing) return { ...revisionFacts({ diff: await compareAt(host.ctx.board, m.id, revision, to), against: to, top: 0 }), shown: false };
      return { ...revisionFacts(await surface.openRevision(host, revision, to, passage)), shown: true };
    },
  }),
  "revision.older": def({
    summary: "in the revision compare, the revision before the one shown (still against the next, or now)", keys: modeActionKeys(ATTACHED_KEYS, "revision.older"),
    touches: "tile", replay: "safe", args: {},
    async run(_, { surface, host }) {
      const mode = surface.revisionMode, v = mode?.view;
      if (!mode || !v) throw new ActionRefused(REFUSED.noCompare);
      // From the revision asked last, not the one drawn: a second ← before the first's answer steps again.
      const from = mode.want ?? v.diff.from.revision;
      const older = v.diff.list.revisions.find(r => r.revision < from);
      if (!older) throw new ActionRefused(`revision ${from} is the oldest kept for this note`);
      mode.want = older.revision;
      return revisionFacts(await surface.openRevision(host, older.revision, v.against));
    },
  }),
  "revision.newer": def({
    summary: "in the revision compare, the revision after the one shown", keys: modeActionKeys(ATTACHED_KEYS, "revision.newer"),
    touches: "tile", replay: "safe", args: {},
    async run(_, { surface, host }) {
      const mode = surface.revisionMode, v = mode?.view;
      if (!mode || !v) throw new ActionRefused(REFUSED.noCompare);
      const from = mode.want ?? v.diff.from.revision;
      const newer = [...v.diff.list.revisions].reverse().find(r => r.revision > from && r.revision < v.diff.current);
      if (!newer) throw new ActionRefused(`revision ${from} is the last before the note now`);
      mode.want = newer.revision;
      return revisionFacts(await surface.openRevision(host, newer.revision, v.against));
    },
  }),
  "revision.against": def({
    summary: "in the revision compare, mark the revision against the note as it is now, or (again) against the next revision", keys: modeActionKeys(ATTACHED_KEYS, "revision.against"),
    touches: "tile", replay: "safe", args: { to: { type: "string", optional: true, about: "now or next; left out, the other one" } },
    examples: [{ act: "revision.against to=now", does: "marks the revision shown against the note as it is now" }, { act: "revision.against to=next", does: "marks it against the revision after it again" }],
    async run({ to }, { surface, host }) {
      const v = surface.revisionMode?.view;
      if (!v) throw new ActionRefused(REFUSED.noCompare);
      if (to !== undefined && to !== "now" && to !== "next") throw new ActionRefused("to is now or next");
      return revisionFacts(await surface.openRevision(host, surface.revisionMode!.want ?? v.diff.from.revision, (to ?? (v.against === "now" ? "next" : "now")) as RevisionAgainst, v.passage));
    },
  }),
  "revision.scroll": def({
    summary: "scroll the revision compare's rows", keys: modeActionKeys(ATTACHED_KEYS, "revision.scroll"),
    touches: "tile", replay: "safe", args: { by: { type: "number", about: "rows, down when positive" }, page: { type: "boolean", optional: true, about: "by= counts pages (the rows shown, less one: PgUp PgDn), not rows" } },
    examples: [{ act: "revision.scroll by=1 page=true", does: "scrolls the compare down a page" }, { act: "revision.scroll by=-1", does: "scrolls it up a row" }],
    run({ by, page }, { surface, host }) {
      const mode = surface.revisionMode;
      if (!mode) throw new ActionRefused(REFUSED.noCompare); if (page) by = Math.sign(by) * pageRows(mode.body || mode.rect.h);
      mode.view.top = Math.max(0, mode.view.top + by);
      host.redraw();
      return { top: mode.view.top };
    },
  }),
  "revision.focus": def({
    summary: "give the keys to the revision compare or back to the comment being written beside it, keeping both open", keys: "a click in the compare, or on the note",
    touches: "shape", replay: "safe", person: "the compare's keys are the person's; an agent reads revision.compare",
    args: { on: { type: "boolean", about: "true gives the keys to the compare; false returns them to the reader and its comment" } },
    examples: [{ act: "revision.focus on=false", does: "returns the keys to the comment being written" }],
    run: ({ on }, { surface, host }) => surface.focusRevision(host, on),
  }),
  "revision.close": def({
    summary: "close the revision compare: back to the note as it is now", keys: modeActionKeys(ATTACHED_KEYS, "revision.close"), confirms: true, says: () => "closed the revision compare",
    touches: "tile", replay: "safe", args: {},
    run(_, { surface, host }) { const open = !!surface.revisionMode; surface.closeRevision(); host.redraw(); return { closed: open }; },
  }),
  "revisions": def({
    summary: "the note's history (PIE-621, PIE-1433): the current revision, then the earlier texts the service keeps, newest first, each with when it was saved, by whom, its size and first line. The person's lists them over the screen (the tile menu's history); choosing one opens it beside how the note is now (revision.compare). An agent gets the list; revision.restore puts one into the edit",
    keys: [{ via: "the tile menu's \"history\"" }],
    reads: true, touches: "nothing", replay: "safe",
    menu: noteRow("history", ""),
    args: {},
    async run(_, { surface, host, standing }) {
      const m = surface.requireNote(), list = await host.ctx.board.revisions(m.id);
      if (!standing) return list;
      const rows = list.revisions.filter(r => r.revision < list.revision);
      if (!rows.length) throw new ActionRefused(`no earlier text is kept for this note (it is at revision ${list.revision})`);
      if (!host.overlay) throw new ActionRefused(`this screen can't list the history over it · revision.compare revision=${rows[0]!.revision} opens the last change`);
      const line = (r: (typeof rows)[number]) => `${String(r.revision).padStart(4)}  ${whenPut(Date.parse(r.savedAt)).padEnd(12)} ${revisionByline(r) || "·"}  ${printable(r.firstLine)}`;
      const picker = new ListPicker<(typeof rows)[number], unknown>({
        name: "history", items: () => rows, clickChooses: true,
        row: (r, _i, on, w) => [pickRow(line(r), on, w)],
        choose: r => { void surface.runKey("revision.compare", { revision: r.revision }, host); },
        frame: (a, n) => ({ rect: centred(a, Math.min(80, a.cols - 2), Math.min(n + 2, a.rows)), title: `history · ${subject(m)} · now revision ${list.revision}` }),
      });
      host.overlay(picker);
      return { ...list, shown: true };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
