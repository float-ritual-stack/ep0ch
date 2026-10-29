// Copying a note's address from wherever it is seen (PIE-1297): `note.copy-ref`, one action in one set, registered where
// notes are seen: the desk (a reader's note, a list's, the tree's or a lane's selected row: `Pane.noteAt`, else
// `Pane.subject`), a reader outside a desk (the BBS screens), and the door itself for a note named by ref= (the power
// bar's row menu, any screen). Each host only says how it finds the note; the forms are outline-core's link grammar
// (`blockRefText`) and the web client's address (`notePageUrl`), and the person's copy goes to their clipboard while an
// agent's comes back to it.
import { blockRefText, withoutFragmentAnchor } from "@ep0ch/outline-core/link-syntax";
import { subject, type Msg } from "./board";
import { notePageUrl } from "./open";
import { prop } from "./props";
import type { Actor } from "./socket";
import { ActionRefused, actionSet, def } from "./surface/actions";
import type { Ctx } from "./app";
import { readNote, type NoteAddress } from "./desk/outline-boards";

/** What `note.copy-ref` copies: the full id, a reference, the web link, or a reference to one line (its ^anchor). */
export const NOTE_REF_KINDS = ["id", "ref", "link", "line"] as const;
export type NoteRefKind = (typeof NOTE_REF_KINDS)[number];

/** A line's words as a reference's label: no anchor, no heading, quote or list marker, no box; a long one cut at a word, with …. */
export function lineLabel(line: string): string {
  const words = withoutFragmentAnchor(line).replace(/^\s*(?:#{1,6}\s+|>+\s*|[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)/, "").trim();
  if (words.length <= 60) return words;
  const cut = words.slice(0, 60), space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/**
 * The text `kind` copies for note `m`, in outline `at.outline` (the web link names it); `at.foreign`: that outline isn't
 * this door's own, so a reference names it too (`((outline:id|title))`). `line`: the anchor and words of the line a
 * `line` copy names.
 */
export function noteRefText(kind: NoteRefKind, m: Msg, at: { outline?: string; foreign?: boolean } = {}, line?: { anchor: string; text: string }): string {
  const outline = at.foreign ? at.outline : undefined;
  if (kind === "id") return m.id;
  if (kind === "link") return notePageUrl(prop(m, "work-id") ?? m.id, at.outline);
  if (kind === "line" && !line) throw new ActionRefused("a line's reference needs the line: open the note in a reader and put the cursor on it");
  return blockRefText(m.id, kind === "line" ? lineLabel(line!.text) || subject(m) : subject(m), { ...(outline ? { outline } : {}), ...(line ? { fragment: line.anchor } : {}) });
}

/**
 * The tile menu's group for every copy row (PIE-1398): the note's (id, reference, web link, a line's) and the tile's own,
 * first in the menu so they're in reach in a short tile, and found together by typing "copy".
 */
export const COPY_GROUP = "Copy";
/** The tile menu's group about the button under a right-click (pin to status bar): first, in reach in a short tile (PIE-1428). */
export const BUTTON_GROUP = "Button";

/** How the status line names what was copied. */
export const NOTE_REF_WHAT: Record<NoteRefKind, string> = { id: "the note's id", ref: "a reference to the note", link: "the note's web link", line: "a reference to the line" };

/**
 * A copy of an address (a note's, a tile's): `text` to the person's clipboard, the status line saying `what` it was, or
 * back to an agent (said as its own, the clipboard untouched; `said` tells the note it was in). `copy` and `flash` are
 * the door's.
 */
export function deliverCopy(ctx: { copy?(text: string): boolean; flash(msg: string): void }, actor: Actor, text: string, what: string, said?: (msg: string) => void): { text: string; clipboard: boolean } {
  if (actor.kind === "user") {
    if (ctx.copy?.(text) === false) throw new ActionRefused("the clipboard refused it");
    ctx.flash(`copied ${what}: ${text}`);
    return { text, clipboard: true };
  }
  ctx.flash(`@${actor.id ?? "agent"} copied ${what} for itself · your clipboard is untouched`);
  said?.(`copied ${what}`);
  return { text, clipboard: false };
}

/** `note.copy-ref`'s answer: the note, the kind and what `deliverCopy` did. */
export const deliverNoteRef = (ctx: Parameters<typeof deliverCopy>[0], actor: Actor, id: string, kind: NoteRefKind, text: string, said?: (msg: string) => void) =>
  ({ id, kind, ...deliverCopy(ctx, actor, text, NOTE_REF_WHAT[kind], said) });

/** This door's outline by name, as the host answers it (a board opened with no name reads the host's default). */
export async function ownOutline(ctx: Ctx): Promise<string | undefined> {
  return ctx.outline ?? ctx.board.outline ?? (await ctx.board.info()).outline;
}

/**
 * `note.copy-ref` for a note named by id, read where it lives (`address`: another outline's, through its board): any
 * kind but `line`, which is a reader's (it names a line of the note drawn there).
 */
export async function copyNoteById(ctx: Ctx, actor: Actor, kind: NoteRefKind, id: string, address?: NoteAddress) {
  if (kind === "line") throw new ActionRefused("a line's reference is a reader's: open the note in one and put the cursor on the line");
  const own = await ownOutline(ctx), foreign = !!address && address.outline !== own;
  const m = await readNote(ctx, id, foreign ? address : undefined);
  if (!m) throw new ActionRefused(`no note ${id} in ${foreign ? address!.outline : "this outline"}`);
  return deliverNoteRef(ctx, actor, m.id, kind, noteRefText(kind, m, { outline: foreign ? address!.outline : own, foreign }));
}

/** What `note.copy-ref` runs on: how its host copies (the note it points at, or ref=), and whether it has a note (and a line) to offer. */
export interface NoteRefOn {
  copy(a: { kind: NoteRefKind; ref?: string; outline?: string; line?: number }, actor: Actor): Promise<unknown>;
  has(line: boolean): boolean;
}

export const NOTE_REF_ACTIONS = actionSet<NoteRefOn>()("note-ref", {
  "note.copy-ref": def({
    summary: "copy the address of the note the tile points at (PIE-1297: a reader's note, a list's, the tree's or a lane's selected row, a power-bar hit; or ref=<block id>, outline= when it's another outline's): kind=id its full id (a short one doesn't resolve), kind=ref ((id|title)) to paste into another note (((outline:id|title)) for another outline's note), kind=link its web link (https://my.ep0ch.sh/pub/o/<outline>/p/<id>, a roadmap item's by its Work ID: the web client's home outline's redirects to /pub/p/), kind=line in a reader ((id^anchor|words)) for one line (line=, else your selection's first line, the heading the keys selected or the line being read), adding the ^anchor when it has none. An inline list's row in a reader is the reader's note: open the row to copy it. The person's goes to their clipboard and the status line says what; an agent's is returned to it and never touches the clipboard",
    keys: [{ keys: "^W y", does: "a reference" }, { via: "the tile menu's Copy group (\"copy note id\", \"copy note reference\", \"copy note web link\", \"copy line reference\")" }, { keys: "alt+m right-click", does: "a power-bar hit's menu (1 2 3 or a click)" }],
    // A line's copy may write its anchor into the note: the draft rule holds for it as for any write; the rest read.
    touches: "draft", draft: "write", touchesWith: ({ kind }) => (kind === "line" ? "draft" : "nothing"), replay: "ask",
    menu: ([["copy note id", "id", ""], ["copy note reference", "ref", "ctrl+w y"], ["copy note web link", "link", ""], ["copy line reference", "line", ""]] as const).map(([label, kind, key]) => ({
      label, group: COPY_GROUP, key, args: { kind },
      now: (on: NoteRefOn) => (on.has(kind === "line") ? null : { hide: true }),
    })),
    args: {
      kind: { type: "string", optional: true, choices: [...NOTE_REF_KINDS], about: "id (default): the full id; ref: ((id|title)); link: the web link; line: ((id^anchor|words)) for one line of a reader's note" },
      ref: { type: "string", optional: true, about: "the note's block id; default the note the tile points at" },
      outline: { type: "string", optional: true, about: "with ref=: the outline the note is in, when it's another's than this door's" },
      line: { type: "number", optional: true, about: "kind=line: the source line, from 1; default your selection's first line (the person's: the selected heading, else the line being read)" },
    },
    examples: [
      { act: "note.copy-ref kind=ref tile=tree", does: "answers ((<id>|<title>)) for the tree's selected row" },
      { act: "note.copy-ref kind=link", does: "answers the focused tile's note's web link: its Work ID's for a roadmap item" },
      { act: "note.copy-ref kind=line line=4 tile=reader", does: "anchors line 4 of the reader's note if it has no anchor, and answers ((<id>^<anchor>|<its words>))" },
    ],
    run({ kind, ref, outline, line }, on, actor) {
      const k = (kind ?? "id") as NoteRefKind;
      if (!NOTE_REF_KINDS.includes(k)) throw new ActionRefused(`kind is ${NOTE_REF_KINDS.join(", ")}`);
      return on.copy({ kind: k, ...(ref ? { ref } : {}), ...(outline ? { outline } : {}), ...(line !== undefined ? { line } : {}) }, actor);
    },
  }),
});
