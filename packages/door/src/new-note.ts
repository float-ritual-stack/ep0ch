// New notes from anywhere (PIE-544): `note.new`, on every screen (the App's dispatcher, beside the shell's actions).
// The service makes the note where its placement rule puts it (`notes.create`, packages/outliner's
// src/note-placement.ts): under the note in the reader the person is in, else the top of the Inbox. The door only
// says which note that is; it never works out where the Inbox is. The person's new note opens where the screen says
// (PIE-591, its spec's `newNote`): by default a draft floating over the screen, one more each ctrl+n, as many as they
// like; or a tab on the tile they're in, a tab in their drawer, or where the screen's opens land. A screen may run an
// action of its own instead (the board's lanes: a card born in that lane, `card.new`). The person's own choice
// (`note.opens`, saved; EP0CH_NEW_NOTE) is used where the screen doesn't say. Its edit is the one editor and draft session
// (the reader's `edit`); an agent's is made, attributed, and said on the status bar, and never takes the person's focus
// or keys (with opens=, it is shown there for them, unfocused).
import { subject, type Msg } from "./board";
import type { Ctx, Screen } from "./app";
import { ActionRefused, actionSet, def } from "./surface/actions";
import { changedSinceRead, Refused, type NotePlacement } from "./socket";
import { paint, width } from "./style";
import { readState, writeState } from "./state";
import { NEW_NOTE_OPENS, type NewNoteOpens } from "./desk/screen-spec";
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

/** How the person's new note opens (`newNote` on Screen.editNew): where, and the note it was made from (its context). */
export interface NewNoteHow { opens: NewNoteOpens; context: string | null }

/**
 * Where the person's new notes open where a screen doesn't say (PIE-591): EP0CH_NEW_NOTE, else what `note.opens` saved
 * (new-note.json in the door's state), else a float.
 */
export function personOpens(env: Record<string, string | undefined> = process.env): NewNoteOpens {
  const pick = (x: unknown) => (NEW_NOTE_OPENS as readonly unknown[]).includes(x) ? x as NewNoteOpens : null;
  return pick(env.EP0CH_NEW_NOTE) ?? pick(readState<{ opens?: string }>("new-note.json")?.opens) ?? "float";
}
const opensArg = (x: string | undefined): NewNoteOpens | undefined => {
  if (x === undefined) return undefined;
  if (!(NEW_NOTE_OPENS as readonly string[]).includes(x)) throw new ActionRefused(`opens= is ${NEW_NOTE_OPENS.join(", ")}, not ${x}`);
  return x as NewNoteOpens;
};

export const NEW_NOTE_ACTIONS = actionSet<NewNoteOn>()("new", {
  "note.new": def({
    summary: "a new note, where the outline's placement rule puts it: under the note in the reader the person is in (as its last child; from a new note, beside it), else at the top of the Inbox (inbox=true always the Inbox; near=<id> under that note). The person's opens in edit mode where the screen says (opens= overrides): a float over the screen by default, one more each time, as many as they like (drag one to move it, or onto a header or an edge to dock it; × or esc on it still empty puts it in the trash), a tab on the focused tile (tab), your drawer (drawer), or where the screen's opens land (lands); the board's lanes make a card in the focused lane instead (card.new). An agent's is made with its text= as its own, attributed, and said on the status bar: it opens nothing (with opens=float or tab, it is shown there, unfocused) and never takes the person's focus",
    keys: "ctrl+n on every screen, in an edit too (not in a filter, a picker or a terminal tile), a click on ^N new in the desk's hint row; + on the main menu, or a click on + New note on its key line",
    touches: "nothing", replay: "ask",
    says: out => (out?.id ? `· made a new note “${out.title || "untitled"}” ${out.said}` : null),
    args: {
      text: { type: "string", optional: true, about: "its text: a title line, a body, [key::value] properties (a first line of only [page::x] is titled x). The person's starts empty" },
      near: { type: "string", optional: true, about: "make it under this note (a block id) instead of the one the person is in; refused when that note is gone, in the trash or a system note (never quietly the Inbox)" },
      inbox: { type: "boolean", optional: true, about: "make it at the top of the Inbox, whatever note the person is in" },
      opens: { type: "string", optional: true, about: "where it opens: float (over the screen), tab (a tab on the focused tile), drawer (your drawer) or lands (where the screen's opens land); left out, what the screen says, else the person's choice (note.opens), else float" },
    },
    async run({ text, near, inbox, opens: asked }, { ctx, here }, actor) {
      if (here?.noDrawer) throw new ActionRefused("not here: log on first (the logon and the logoff make no notes)");
      if (ctx.home) throw new ActionRefused("there's no outline open yet: open or make one here first (the home base), then ctrl+n makes a note in it");
      if (near !== undefined && inbox) throw new ActionRefused("near= and inbox=true say two places; give one");
      let opens = opensArg(asked);
      // Checked before anything is made: an agent never puts a note in the person's drawer.
      if (actor.kind === "agent" && opens === "drawer") throw new ActionRefused("an agent's note doesn't go into the person's drawer: opens=float or tab shows it on the screen");
      // The person's ctrl+n where the screen runs something of its own (the board's lanes: a card in the lane).
      const rule = actor.kind === "agent" || opens || near !== undefined || inbox || text !== undefined ? null : here?.newNoteRule?.() ?? null;
      if (rule?.action) {
        if (!here?.dispatch) throw new ActionRefused(`the ${here?.title ?? "screen"} has no ${rule.action} to run`);
        const out = await here.dispatch.press(rule.action, rule.args ?? {});
        return { via: rule.action, ...(out && typeof out === "object" ? out : {}) };
      }
      if (actor.kind !== "agent") opens ??= rule?.opens ?? personOpens();
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
      // An agent's opens nothing (the dispatcher says it on the status bar, `says`, named), unless it asked where: shown there, unfocused.
      if (actor.kind === "agent") {
        // Made either way: a showing refused (a locked screen) is said with the note's id, never as a failure to retry.
        if (opens && here?.showNew) {
          try { return { ...out, reader: await here.showNew(note, opens, actor) }; }
          catch (e) { return { ...out, reader: null, notShown: e instanceof Error ? e.message : String(e) }; }
        }
        ctx.redraw(); return out;
      }
      // Where the screen's opens land, in its edit; a screen with no readers of its own (the menu, a list): the shell's
      // open puts a message reader over it, and that reader opens the edit. Only an edit on this very note counts.
      let reader: string | null = null;
      try {
        if (here?.editNew) reader = await here.editNew(note, { opens: opens ?? "float", context: at ?? null });
        else if (ctx.press) {
          await ctx.press("open", { id: note.id });
          const top = ctx.screens?.().at(-1);
          if (top && top !== here && top.noteContext?.() === note.id && top.editNew) reader = await top.editNew(note);
        }
      } catch (e) { throw new ActionRefused(`the new note couldn't be opened to write (${e instanceof Error ? e.message : String(e)}); ${await putAway(ctx, note)}`); }
      if (reader === null) throw new ActionRefused(`the new note couldn't be opened to write here (cancelled, or no reader took it); ${await putAway(ctx, note)}`);
      // Said last, over what the open said: where it went, and how to leave it.
      ctx.flash(`new note ${placement.said} · ctrl+s saves · esc on it still empty puts it in the trash${opens === "float" ? " · ctrl+n another" : ""}`, 8000);
      ctx.redraw();
      return { ...out, reader, ...(here?.editNew && opens ? { opens } : {}) };
    },
  }),
  "note.opens": def({
    summary: "where the person's new notes open where the screen doesn't say (PIE-591): float (a draft over the screen, the default), tab (a tab on the tile they're in), drawer (your drawer) or lands (where the screen's opens land); saved for the next door (EP0CH_NEW_NOTE overrides it). With no opens=, says which",
    touches: "nothing", replay: "safe", person: "it's the person's own setting: an agent asks note.new opens= for one note",
    says: out => (out?.changed ? `new notes open: ${out.opens}` : null),
    args: { opens: { type: "string", optional: true, about: "float, tab, drawer or lands" } },
    run({ opens }) {
      const want = opensArg(opens);
      if (!want) return { opens: personOpens(), ...(process.env.EP0CH_NEW_NOTE ? { from: "EP0CH_NEW_NOTE" } : {}) };
      writeState("new-note.json", { opens: want });
      const now = personOpens();
      return { opens: now, changed: true, ...(now !== want ? { overridden: `EP0CH_NEW_NOTE=${process.env.EP0CH_NEW_NOTE} wins in this door` } : {}) };
    },
  }),
});

/**
 * A new note the person's edit never opened on goes to the trash (as the person: they made it), but only read again
 * and still empty (no text, no children) at the revision it was made at, and the trash names that revision and asks
 * for it empty: another client or an agent may write it or add a child meanwhile, even between this read and the trash
 * (a child leaves the revision as it was), and the service then refuses it. What happened, said as it is known; when
 * it isn't, the id and the command to look.
 */
export async function putAway(ctx: Pick<Ctx, "board">, note: Msg): Promise<string> {
  const kept = `it was written meanwhile, so it stays (${note.id})`;
  const check = `check it with ep0ch show ${note.id}`;
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let now: Msg | null;
  try { now = await ctx.board.get(note.id); }
  catch (e) { return `it couldn't be read again (${why(e)}), so it was left as it is: ${check}`; }
  if (!now) return "it's gone already";
  const at = now.revision ?? note.revision;
  // A child someone added leaves the note's revision as it was, and the trash would take it too.
  if (now.text.trim() || now.childIds?.length || (note.revision !== undefined && at !== note.revision)) return kept;
  if (at === undefined) return `its revision wasn't known, so it was left as it is: ${check}`;
  try {
    await ctx.board.trash(note.id, undefined, { revision: at, ifEmpty: true });
    return "it went to the trash";
  } catch (e) {
    if (changedSinceRead(e)) return kept;
    if (e instanceof Refused) return `the trash was refused (${e.message}), so it stays: ${check}`;
    // The answer was lost, not refused: look before saying either.
    const gone = await ctx.board.isTrashed(note.id);
    if (gone) return "it went to the trash";
    if (gone === false) return `it couldn't be put in the trash (${why(e)}), so it stays: ${check}`;
    return `the trash didn't answer (${why(e)}), so it may still be there: ${check}`;
  }
}
