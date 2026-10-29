// Copying a note's address from wherever it is seen (PIE-1297): `note.copy-ref`, the tile action (src/desk/tile-actions.ts)
// over this one part. A reader's note, a list's or the tree's selected row, a lane's card: the tile's subject
// (`Pane.subject`), as `note.trash` takes it. The forms are outline-core's link grammar (`blockRefText`) and the web
// client's address (`notePageUrl`); what this adds is which one, and that the person's goes to their clipboard while an
// agent's comes back to it.
import { blockRefText, withoutFragmentAnchor } from "@ep0ch/outline-core/link-syntax";
import { subject, type Msg } from "./board";
import { notePageUrl } from "./open";
import { prop } from "./props";
import type { Actor } from "./socket";
import { ActionRefused } from "./surface/actions";

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
 * The text `kind` copies for note `m`. `outline` is the note's when it isn't this door's own: a reference then names it
 * (`((outline:id|title))`) and the web link is that outline's. `line`: the anchor and words of the line a `line` copy names.
 */
export function noteRefText(kind: NoteRefKind, m: Msg, outline?: string, line?: { anchor: string; text: string }): string {
  if (kind === "id") return m.id;
  if (kind === "link") return notePageUrl(prop(m, "work-id") ?? m.id, outline);
  if (kind === "line" && !line) throw new ActionRefused("a line's reference needs the line: open the note in a reader and put the cursor on it");
  return blockRefText(m.id, kind === "line" ? lineLabel(line!.text) || subject(m) : subject(m), { ...(outline ? { outline } : {}), ...(line ? { fragment: line.anchor } : {}) });
}

/** How the status line names what was copied. */
const WHAT: Record<NoteRefKind, string> = { id: "the note's id", ref: "a reference to the note", link: "the note's web link", line: "a reference to the line" };

/**
 * `text` to the person's clipboard (said on the status line), or back to an agent (said as its own, the clipboard
 * untouched). `copy` and `flash` are the door's.
 */
export function deliverNoteRef(ctx: { copy?(text: string): boolean; flash(msg: string): void }, actor: Actor, id: string, kind: NoteRefKind, text: string, said?: (msg: string) => void) {
  if (actor.kind === "user") {
    if (ctx.copy?.(text) === false) throw new ActionRefused("the clipboard refused it");
    ctx.flash(`copied ${WHAT[kind]}: ${text}`);
    return { id, kind, text, clipboard: true };
  }
  ctx.flash(`@${actor.id ?? "agent"} copied ${WHAT[kind]} for itself · your clipboard is untouched`);
  said?.(`copied ${WHAT[kind]}`);
  return { id, kind, text, clipboard: false };
}
