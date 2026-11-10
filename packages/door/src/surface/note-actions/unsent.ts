// unsent.*: what's kept unsent on a note (src/unsent.ts, src/unsent-compare.ts): the kept-draft line's controls.
import { USER } from "../../socket";
import { baseTextOf, copyNote, copyOf, diffNote, keptName, type UnsentKind } from "../../unsent";
import { compareDraft, dayOf, hunksOf, linesOf, verdictWords } from "../../unsent-compare";
import { firstUnsent, type On, UNSENT_ARGS, unsentHere, unsentOf, unsentRow } from "./shared";
import { tidy } from "../../edit";
import { type ActionDef, ActionRefused, def } from "../actions";
import { type Msg, subject } from "../../board";
import { unshelveIf } from "../../draft-session";

export const UNSENT_DEFS = {
  // ── what's kept on this note (src/unsent.ts, src/unsent-compare.ts): the kept-draft line's controls ──
  "unsent.diff": def({
    summary: "an edit kept on this note compared with the note as it is now, through the text it started from: only what the edit changed, each change marked already in the note, still new, or changed differently since (a conflict shows both versions). Without the starting text it is the two-way comparison and says so. The person's opens in a reader beside this one (read-only, with the controls); an agent gets the verdict and the diff",
    keys: "⏎ or a click on [show them] / [compare] on the kept-draft line",
    touches: "nothing", replay: "safe",
    menu: unsentRow("kept edit: compare with the note now", "edit"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.diff kind=edit", does: "compares the kept edit with the note now, marking each change" },
    ],
    async run({ kind }, { surface, host, standing }, _actor) {
      const { of, u, now } = await unsentHere(surface, host, kind ?? "edit", true);
      const base = await baseTextOf(u, of, now!, host.ctx.board);
      const view = diffNote(now!, u, base);
      const verdict = compareDraft(base, u.text, now!.text);
      if (!standing) return { of, base: u.base, revision: now!.revision ?? null, at: u.at, basis: verdict.basis, verdict: verdict.kind, said: verdictWords(verdict, dayOf(u.at)), hunks: verdict.hunks.map(h => ({ line: h.start + 1, state: h.state, removed: h.removed, added: h.added, now: h.now })), diff: view.text };
      host.navigate(view, { fresh: true });
      return { of, base: u.base, revision: now!.revision ?? null, verdict: verdict.kind, opened: view.id };
    },
  }),
  "unsent.copy": def({
    summary: "the text kept on this note (kind=edit, comment, child, card or note-reply), as it was written: the person's opens in a reader beside this one (read-only); an agent gets the text and where its copy is on disk",
    keys: "⏎ or a click on [open copy] on the kept-draft line",
    touches: "nothing", replay: "safe",
    menu: unsentRow("kept edit: open its copy"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.copy kind=comment", does: "shows the comment kept unsent on this note, as it was written" },
      { act: "unsent.copy", does: "shows the first text kept on this note (edit, comment, child, card or note-reply)" },
    ],
    async run({ kind }, { surface, host, standing }, _actor) {
      const k = kind ?? firstUnsent(surface) ?? "edit";
      const { of, u, now } = await unsentHere(surface, host, k, false);
      if (!standing) return { of, kind: k, text: u.text, copy: u.copy, at: u.at };
      const base = k === "edit" && now ? await baseTextOf(u, of, now, host.ctx.board) : undefined;
      const view = copyNote(now ?? ({ id: of, text: "", parentId: null, childIds: [], createdAt: u.at, updatedAt: u.at, author: "unsent", properties: [] } as Msg), u, base);
      host.navigate(view, { fresh: true });
      return { of, opened: view.id, copy: u.copy };
    },
  }),
  "unsent.dismiss": def({
    summary: "let go of what's kept on this note (kind=edit, comment, child, card or note-reply): its line goes; a copy of the text stays on disk (drafts/), written first if there isn't one. The person's only",
    keys: "⏎ or a click on [let it go] on the kept-draft line or in its comparison",
    touches: "nothing", replay: "ask",
    person: "the kept text is the person's to keep or let go; an agent reads it with unsent.diff or unsent.copy",
    menu: unsentRow("kept edit: let it go (its copy stays)"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.dismiss kind=edit", does: "lets go of the kept edit; a copy of its text stays on disk" },
    ],
    async run({ kind }, { surface, host }) {
      const k = kind ?? firstUnsent(surface) ?? "edit";
      const { of, u } = await unsentHere(surface, host, k, false);
      const copy = copyOf(u, of.slice(0, 8));
      unshelveIf(u);
      host.ctx.flash(`let go of the ${keptName(k as UnsentKind)} · its copy stays at ${tidy(copy)}`);
      host.redraw();
      return { of, kind: k, dismissed: true, copy };
    },
  }),
  "unsent.add": def({
    summary: "add what a kept edit has that the note doesn't: open this note's edit on the revision it's at now with the edit's still-new lines in it, as one draft.patch (one ctrl+z takes it back); lines already in the note aren't added again, and a line changed differently since is left as it is now and said, never overwritten. An edit written on the revision the note is at comes back whole. Nothing is saved until ctrl+s. The person's only: it opens an edit with their keys",
    keys: "⏎ or a click on [add them] on the kept-draft line or in its comparison",
    touches: "draft", draft: "write", replay: "ask",
    person: "adding a kept edit opens an edit with the person's keys; an agent proposes text with draft.patch",
    menu: unsentRow("kept edit: add its new lines into an edit", "edit"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.add", does: "opens an edit with the kept edit's still-new lines in it; ctrl+s saves" },
    ],
    async run(_, { surface, host }) {
      const { of, u, now } = await unsentHere(surface, host, "edit", true);
      // In the comparison view: this reader shows the note itself again, to edit it.
      if (surface.msg?.id !== of) surface.show(now!, host);
      if (surface.draft) throw new ActionRefused("this reader is already editing the note; save or close that edit first");
      if (u.base === now!.revision) {
        await surface.ensureDraft(host);                       // brought back whole (DraftSession.restore)
        host.redraw();
        return { of, added: "whole", base: u.base };
      }
      const base = await baseTextOf(u, of, now!, host.ctx.board);
      if (base === null) throw new ActionRefused(`this edit's starting text isn't kept (the note's history doesn't reach revision ${u.base}), so its new lines can't be told from what changed since · [compare] shows it against the note now, [open copy] has it whole${u.copy ? ` (${tidy(u.copy)})` : ""}`);
      const verdict = compareDraft(base, u.text, now!.text);
      const fresh = hunksOf(verdict, "new"), clash = hunksOf(verdict, "conflict");
      if (!fresh.length) throw new ActionRefused(clash.length ? "none of its lines can be added: each was changed differently since · [compare] shows both versions" : "the note already has everything in it");
      const s = await surface.ensureDraft(host);
      s.draft.straysClose = false;                               // added on purpose: never "stray" on the next esc
      const a = s.draft.applyPatch({ patchId: `unsent-${u.at}`, patches: fresh.map(h => h.span!), revision: s.draft.base, force: true }, USER);
      if (!a.applied) throw new ActionRefused(`couldn't add them: ${a.reason}`);
      const lines = linesOf(verdict, "new"), left = linesOf(verdict, "conflict");
      if (!left) { copyOf(u, of.slice(0, 8)); unshelveIf(u); }
      s.draft.status.say(`added ${lines} line${lines === 1 ? "" : "s"} from your edit ${dayOf(u.at) === "today" ? "today" : `of ${dayOf(u.at)}`}, lit · ctrl+s saves · ctrl+z takes them back${left ? ` · ${left} line${left === 1 ? " was" : "s were"} changed differently since and stay${left === 1 ? "s" : ""} kept ([compare] shows both)` : ""}`);
      host.redraw();
      return { of, added: left ? "partly" : "all", lines, left, base: u.base, revision: s.draft.base };
    },
  }),
  "unsent.keep": def({
    summary: "keep a kept edit as a note of its own: a new note under this one holding the edit's whole text; the edit's line goes (a copy stays on disk). The person's only",
    keys: "⏎ or a click on [keep as a note] on the kept-draft line or in its comparison",
    touches: "nothing", replay: "ask",
    person: "the kept text is the person's to keep or let go; an agent writes notes with note.create",
    menu: unsentRow("kept edit: keep it as a note under this one", "edit"),
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.keep", does: "keeps the kept edit as a new note under this one; its copy stays on disk" },
    ],
    async run(_, { surface, host }) {
      const { of, u, now } = await unsentHere(surface, host, "edit", true);
      const copy = copyOf(u, of.slice(0, 8));
      const made = await host.ctx.board.createBlock(of, `Edit from ${dayOf(u.at)} on “${subject(now!)}”, kept\n\n${u.text}`, USER);
      unshelveIf(u);
      host.ctx.flash(`kept as a note under this one · its copy stays at ${tidy(copy)}`);
      host.redraw();
      return { of, kept: made.id, copy };
    },
  }),
  "unsent.show": def({
    summary: "unfold the old edits (kept on an older revision more than a few days ago), folded into one dim chip on this note",
    keys: "⏎ or a click on [show] on the \"1 old edit\" chip",
    touches: "nothing", replay: "safe",
    args: UNSENT_ARGS,
    examples: [
      { act: "unsent.show", does: "unfolds the old edits folded into one dim chip on this note" },
    ],
    run(_, { surface, host }) {
      const of = unsentOf(surface);
      surface.showOldUnsent(of);
      host.redraw();
      return { of, shown: true };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
