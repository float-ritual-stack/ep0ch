// New notes from anywhere (PIE-544): `note.new`, on every screen (the App's dispatcher, beside the shell's actions).
// The service makes the note where its placement rule puts it (`notes.create`, packages/outliner's
// src/note-placement.ts): under the note in the reader the person is in, else the top of the Inbox. The door only
// says which note that is; it never works out where the Inbox is. The person's new note opens where the screen's
// opens land, in edit mode, through the one editor and draft session (the reader's `edit`); an agent's is made,
// attributed, and said on the status bar, and never takes the person's focus or keys.
import { subject, type Msg } from "./board";
import type { Ctx, Screen } from "./app";
import { ActionRefused, actionSet, def } from "./surface/actions";
import type { NotePlacement } from "./socket";
import { paint, width } from "./style";
import type { Key } from "./term";

/** A part of a drawn row that a click presses a key on (PaneView.spots): `from`..`to`, columns of the row. */
export interface KeySpot { row: number; from: number; to: number; key: Key }

/**
 * What a place with nothing in it offers (PIE-544): `+ New note · ctrl+n`, its key named; a click on it is ctrl+n,
 * the App's `note.new`. One line, for an empty outline's welcome, board, brief, list; `row` is where it's drawn.
 */
export function newNoteOffer(row: number): { line: string; spot: KeySpot } {
  const line = paint("|10+ New note|08 · ctrl+n");
  return { line, spot: { row, from: 0, to: width(line), key: { kind: "char", ch: "n", ctrl: true } } };
}

/** What `note.new` runs on: the door, and the screen it's pressed on (the top one). */
export interface NewNoteOn { ctx: Ctx; here?: Screen }

export const NEW_NOTE_ACTIONS = actionSet<NewNoteOn>()("new", {
  "note.new": def({
    summary: "a new note, where the outline's placement rule puts it: under the note in the reader the person is in (as its last child), else at the top of the Inbox (inbox=true always the Inbox; near=<id> under that note). The person's opens where the screen's opens land, in edit mode (esc on it still empty puts it in the trash); an agent's is made with its text= as its own, attributed, and said on the status bar: it opens nothing and never takes the person's focus",
    keys: "ctrl+n on every screen (but while typing: an edit, a filter, a terminal tile), a click on ^N new in the desk's hint row; + on the main menu, or a click on + New note on its key line",
    touches: "nothing", replay: "ask",
    says: out => (out?.id ? `· made a new note “${out.title || "untitled"}” ${out.said}` : null),
    args: {
      text: { type: "string", optional: true, about: "its text: a title line, a body, [key::value] properties (a first line of only [page::x] is titled x). The person's starts empty" },
      near: { type: "string", optional: true, about: "make it under this note (a block id) instead of the one the person is in; refused when that note is gone, in the trash or a system note (never quietly the Inbox)" },
      inbox: { type: "boolean", optional: true, about: "make it at the top of the Inbox, whatever note the person is in" },
    },
    async run({ text, near, inbox }, { ctx, here }, actor) {
      if (here?.noDock) throw new ActionRefused("not here: log on first (the logon and the logoff make no notes)");
      if (ctx.home) throw new ActionRefused("there's no outline open yet: open or make one here first (the home base), then ctrl+n makes a note in it");
      if (near !== undefined && inbox) throw new ActionRefused("near= and inbox=true say two places; give one");
      // The person's context is the reader they're in; an agent's is only what it names (never the person's reader).
      const at = inbox ? undefined : near ?? (actor.kind === "agent" ? undefined : here?.noteContext?.() ?? undefined);
      let made: { note: Msg; placement: NotePlacement };
      // A near= the caller named is that note or nothing; the reader's own note falls back to the Inbox.
      try { made = await ctx.board.newNote(text ?? "", at, actor, near !== undefined); }
      catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
        const fix = near !== undefined && /^No live note /.test(why)
          ? ` · in the Inbox instead: ep0ch act note.new inbox=true${text ? ` text=${quote(text)}` : ""}${actor.kind === "agent" ? ` --as ${actor.id}` : ""}` : "";
        throw new ActionRefused(`no new note: ${why}${fix}`);
      }
      const { note, placement } = made;
      const out = { id: note.id, title: subject(note).slice(0, 40), parentId: placement.parentId, rule: placement.rule, said: placement.said };
      // An agent's opens nothing: the dispatcher says it on the status bar (`says`), named.
      if (actor.kind === "agent") { ctx.redraw(); return out; }
      // Where the screen's opens land, in its edit; a screen with no readers of its own (the menu, a list): the shell's
      // open puts a message reader over it, and that reader opens the edit. Only an edit on this very note counts.
      let reader: string | null = null;
      try {
        if (here?.editNew) reader = await here.editNew(note);
        else if (ctx.press) {
          await ctx.press("open", { id: note.id });
          const top = ctx.screens?.().at(-1);
          if (top && top !== here && top.noteContext?.() === note.id && top.editNew) reader = await top.editNew(note);
        }
      } catch (e) { await putAway(ctx, note); throw new ActionRefused(`the new note couldn't be opened to write (${e instanceof Error ? e.message : String(e)}); it went to the trash`); }
      if (reader === null) { await putAway(ctx, note); throw new ActionRefused("the new note couldn't be opened to write here (cancelled, or no reader took it); it went to the trash"); }
      // Said last, over what the open said: where it went, and how to leave it.
      ctx.flash(`new note ${placement.said} · ctrl+s saves · esc on it still empty puts it in the trash`, 8000);
      ctx.redraw();
      return { ...out, reader };
    },
  }),
});

/** A new note the person's edit never opened on: still empty, it goes to the trash (as the person: they made it). */
async function putAway(ctx: Ctx, note: Msg) {
  if (note.text.trim()) return;
  await ctx.board.trash(note.id).catch(() => {});
}
