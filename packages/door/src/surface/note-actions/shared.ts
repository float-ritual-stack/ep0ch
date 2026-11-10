// What the note actions share (NOTE_ACTIONS in ../note.ts, split by prefix in this folder): the host an action runs on
// (On), the argument schemas several take, the tile-menu rows they're listed by (noteRow, unsentRow), the session keys
// and the actions they run (SESSION_ACTIONS), and the saves, sends and lookups more than one prefix makes.
import type { MarkLifecycle } from "@ep0ch/outline-core/annotation-marks";
import type { Msg } from "../../board";
import type { NoteSurface, SurfaceHost } from "../note";
import { ActionRefused, type ArgsOf, boundNow, type MenuEntry, type MenuNow } from "../actions";
import { CommentSession } from "../../comment";
import { Draft } from "../../edit";
import { UNSENT_KINDS, type UnsentKind, unsentView } from "../../unsent";
import { errorDetails } from "../../status-log";
import { type Actor, type CommentPassage, recordedAnswer } from "../../socket";
import { type Completer, completerOf } from "../completer";
import { unsent, type Unsent } from "../../draft-session";
import type { FoldPoint } from "../../doc";
import { printable } from "../../props";

export interface On { surface: NoteSurface; host: SurfaceHost; standing: boolean }
/** The refusals several note actions give, one wording each: a save in flight, no rich edit, no compare, a reader that's busy. */
export const REFUSED = {
  saving: "the save is still landing",
  noRich: "open rich.toggle first",
  noCompare: "open the revision compare first (revision.compare)",
  busy: "this reader is editing or commenting; close that first",
} as const;
/** back and forward's `steps`: how many stops on the trail at once. */
export const STEPS_ARG = { type: "number" as const, optional: true as const, about: "how many stops at once (default 1): trail lists them" };
/** An unsent action's argument: which put-aside draft on the note. */
export const UNSENT_ARGS = { kind: { type: "string" as const, optional: true, about: "edit (default), comment, child (a note under this one), card or note-reply (a reply to this one): what's put aside on the note" } };
/** The note what's put aside belongs to: the note shown, or the one a diff or copy view is about. */
export const unsentOf = (surface: NoteSurface) => { const m = surface.requireNote(); return unsentView(m.id)?.of ?? m.id; };
/** The first kind put aside on the note shown (what [open copy] and [dismiss] mean without kind=). */
export const firstUnsent = (surface: NoteSurface): UnsentKind | undefined => { const m = surface.msg; if (!m) return undefined; const of = unsentView(m.id)?.of ?? m.id; return UNSENT_KINDS.find(k => unsent(`${k}:${of}`)); };
/** What's put aside on the note shown, as `kind`, refused when there's nothing; `fetch`: the note as it is now too. */
export async function unsentHere(surface: NoteSurface, host: SurfaceHost, kind: string, fetch: boolean): Promise<{ of: string; u: Unsent; now: Msg | null }> {
  if (!(UNSENT_KINDS as readonly string[]).includes(kind)) throw new ActionRefused(`kind is ${UNSENT_KINDS.join(", ")}, not ${kind}`);
  const of = unsentOf(surface), u = unsent(`${kind}:${of}`);
  if (!u) throw new ActionRefused(`nothing is kept here (${kind})`);
  const now = fetch || kind === "edit" ? await host.ctx.board.get(of) : null;
  if (fetch && !now) throw new ActionRefused("the note is gone from the outline; [open copy] still has the unsent text");
  return { of, u, now };
}
/** A tile menu row for an unsent action: shown while something (an edit, with `edit`) is put aside on the note shown. */
export const unsentRow = (label: string, only?: "edit"): MenuEntry<any, On> => ({
  label, group: "Note",
  now: on => { const m = on.surface.msg; if (!m) return { hide: true }; const of = unsentView(m.id)?.of ?? m.id; return (only ? unsent(`edit:${of}`) : firstUnsent(on.surface)) ? null : { hide: true }; },
});

/** The comment or reply being written in this reader, if one is. */
export const writingIn = (surface: NoteSurface): Draft | null => (surface.session?.mode === "compose" ? surface.session.composer : null);
/** The reader's open edit, or else the comment or reply being written, handed to $EDITOR (it comes back when the editor exits). */
export function handToEditor(surface: NoteSurface, host: SurfaceHost) {
  if (surface.draft) { surface.external(host); return { id: surface.draft.blockId, baseRevision: surface.draft.base, external: true }; }
  surface.external(host, writingIn(surface));
  return { comment: surface.session!.blockId, external: true };
}

/** What each tile= a draft's buttons name answered (`tile.info`'s refusal, or null), per edit (PIE-1312). */
export const BUTTON_TILES = new WeakMap<Draft, Map<string, string | null | undefined>>();

/**
 * The tile `sel` names, as `tile=` reads it wherever the door runs a tile action (the screen shown, its mounts, the drawer):
 * its id, or the refusal's words (the resolver's reason and what to type). Asked through `tile.info`, the one owner.
 */
export async function tileNamed(host: SurfaceHost, sel: string, actor: Actor): Promise<{ id: string } | { why: string }> {
  const d = host.ctx.dispatch;
  if (!d) return { why: "this screen has no tiles" };
  try {
    const r = await d.act({ action: "tile.info", tile: sel }, actor) as { tile?: string };
    return r?.tile ? { id: r.tile } : { why: `${sel} names no tile` };
  } catch (e) { if (e instanceof ActionRefused) return { why: e.message }; throw e; }
}

/**
 * A note action's row in its reader's menu (tile.menu, PIE-492): under "Note", hidden while the reader shows no note,
 * and dimmed (`busy`) while an edit or a comment holds it.
 */
export const noteRow = (label: string, key: string, o: { busy?: true; now?: (on: On) => MenuNow<any> | null } = {}): MenuEntry<any, On> => ({
  label, group: "Note", key,
  now: on => (!on.surface.msg ? { hide: true } : o.busy && (on.surface.draft || on.surface.session) ? { refused: REFUSED.busy } : o.now?.(on) ?? null),
});

/**
 * The person moved on (esc, another tile) while the note was read for their edit or comment, or the reader went
 * to another note meanwhile: nothing opened, and that's the reason (not an unknown revision).
 */
export const movedOn = (host: SurfaceHost, surface: NoteSurface, was: string) =>
  host.still && !host.still() ? "not opened: you moved on while the note was read"
  : surface.msg?.id !== was ? "not opened: this reader went to another note while it was read"
  : null;

/**
 * The person's C or m: the comment session opens from their selection (and their put-aside comment), once the
 * note is read; refused, with the reason already said, when it didn't open.
 */
export async function personComments(surface: NoteSurface, host: SurfaceHost, mode: "select" | "threads"): Promise<CommentSession> {
  const was = surface.requireNote().id;
  const why = await surface.comment(host, mode, host.still);
  if (!surface.session) throw new ActionRefused(movedOn(host, surface, was) ?? (why || "the note couldn't be opened for commenting"));
  return surface.session;
}

/**
 * A key that starts a session in a reader: e edit, ctrl+e $EDITOR, C comment (on the words selected, else the whole
 * note: PIE-846), m threads, i / I properties; `select` is the passage picker (`passage.select`, an agent's or `act`'s)
 * and `note` a comment on the whole note (`comment.note`), as C resolves them.
 */
export type SessionKind = "note-thread" | "note-reply" | "edit" | "external" | "comment" | "select" | "note" | "threads" | "props" | "props-full";
/** The person's e and ctrl+e arm the edit (edit.arm, src/arm.ts) where the others start at once; a click on a hint's e opens it. */
export const armsEdit = (kind: SessionKind): boolean => (kind === "edit" || kind === "external") && !clickedKey();
/** The key running now came from a click (a hint's key: asBoundKey "click"): the mouse's, so an edit opens at once. */
const clickedKey = () => !!boundNow()?.split("; ").includes("click");
/** The note action each of those keys runs (PIE-510): the key, a click and `act` all start it the same way. */
export const SESSION_ACTIONS: Record<SessionKind, { name: "note.thread" | "note.reply" | "edit" | "passage.select" | "comment.note" | "threads" | "props"; args: Record<string, unknown> }> = {
  "note-thread": { name: "note.thread", args: {} },
  "note-reply": { name: "note.reply", args: {} },
  edit: { name: "edit", args: {} },
  external: { name: "edit", args: { external: true } },
  comment: { name: "passage.select", args: {} },
  select: { name: "passage.select", args: {} },
  note: { name: "comment.note", args: {} },
  threads: { name: "threads", args: {} },
  props: { name: "props", args: {} },
  "props-full": { name: "props", args: { full: true } },
};
export const STEP_ARGS = {
  n: { type: "number", optional: true, about: "which step, from 1, as tasks lists them (in the note and inside its embeds)" },
  id: { type: "string", optional: true, about: "the step's id: t-8a6d7f, ^t-8a6d7f, or <block>^t-8a6d7f" },
  block: { type: "string", optional: true, about: "with id: the note the step is in (its id or first 8+ characters), when the id is in more than one" },
} as const;

export const CALLOUT_ARGS = {
  n: { type: "number", optional: true, about: "which callout, from 1, as callout.list lists them (outermost first, in reading order)" },
  line: { type: "number", optional: true, about: "its header's line in the note (1 is the subject)" },
} as const;

export const IMAGE_ARGS = {
  n: { type: "number", optional: true, about: "which image, from 1, as images lists them (in reading order)" },
  line: { type: "number", optional: true, about: "its line in the note (1 is the subject)" },
  picture: { type: "string", optional: true, about: "who it is, as images lists it: the same picture across a resize and an insert above it, where two can read alike" },
} as const;

export const FOLD_ARGS = {
  text: { type: "string", optional: true, about: "a heading's, list item's or callout's text (## optional; a unique start is enough)" },
  line: { type: "number", optional: true, about: "a source line of the note (1 is the subject): its fold point, or the innermost one around it; several from one template call: use n from folds" },
  n: { type: "number", optional: true, about: "which fold point, from 1, as folds lists them" },
} as const;
export type FoldArgs = ArgsOf<typeof FOLD_ARGS>;
export const ROW_ARGS = {
  n: { type: "number", optional: true, about: "which property, from 1, as props lists them" },
  key: { type: "string", optional: true, about: "the property's key, when it appears once" },
} as const;
/** A thread's lifecycle set from the thread list (PIE-791): already so says so; said on screen when an agent did it. */
export async function attention(on: { surface: NoteSurface; host: SurfaceHost }, actor: Actor, thread: string, to: MarkLifecycle, said: string): Promise<Record<string, unknown>> {
  const { s, i, t } = await threadIn(on, thread);
  s.sel = i;
  if (t.lifecycle === to) { on.host.redraw(); return { already: to }; }
  await s.attend(on.surface.env(on.host, actor), to);
  if (s.error) throw new ActionRefused(s.error);
  on.surface.noteAgent(actor, said);
  return { lifecycle: to, recordedAs: recordedAnswer(actor) };
}

export const findThread = (s: CommentSession, id: string): number => {
  const i = s.threads.findIndex(t => t.id === id || (id.length >= 6 && t.id.startsWith(id)));
  if (i < 0) throw new ActionRefused(`no comment thread ${id} on this note; peek lists them under comments.threads`);
  return i;
};

/** The thread list on the note (opened when it isn't) and thread `id` in it, by its id or its first 6+ characters. */
export async function threadIn(on: { surface: NoteSurface; host: SurfaceHost }, id: string): Promise<{ s: CommentSession; i: number; t: CommentSession["threads"][number] }> {
  const s = await on.surface.ensureSession(on.host, "threads");
  const i = findThread(s, id);
  return { s, i, t: s.threads[i]! };
}

/** A comment sent on note `m` (or its Resource's text) at `revision`, on `passage` or the whole note; then its threads read again. */
export async function postComment(surface: NoteSurface, host: SurfaceHost, m: Msg, revision: number, text: string, passage: CommentPassage | null, actor: Actor, props?: Record<string, string>) {
  const id = crypto.randomUUID();
  const r = m.resource ? await host.ctx.board.commentOnResource(id, m.resource, revision, text, passage, actor, props) : await host.ctx.board.comment(id, m.id, revision, text, passage, actor, props);
  await surface.loadComments(host);
  return r;
}

/** A save, a send: done when the service answered. Throws with the surface's own words when it didn't take. */
export async function saveDraft(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const d = surface.draft;
  if (!d) throw new ActionRefused("nothing is being edited here");
  if (d.busy) throw new ActionRefused(REFUSED.saving);
  const before = surface.msg?.revision;
  const by = await surface.save(host, actor);
  if (surface.draft === d) {
    if (d.note.startsWith("this save changes properties")) return { saved: false, warning: d.note, next: "edit.save again saves it" };
    throw new ActionRefused(d.status.conflict ? `${d.status.conflict} · ${d.note}` : d.note || "not saved");
  }
  surface.noteAgent(actor, "saved this note");
  return { saved: true, revision: surface.msg?.revision, from: before, ...(by ? { recordedAs: recordedAnswer(by) } : {}) };
}

export async function sendComment(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const s = surface.session;
  if (!s || s.mode !== "compose" || !s.composer) throw new ActionRefused("no comment is being written here; comment.write first");
  const kind = s.target?.kind; if (actor.kind !== "agent") surface.revealComposerNext();
  await s.send(surface.env(host, actor));
  if (s.error || s.mode === "compose") throw new ActionRefused(s.error ?? s.composer?.note ?? "not sent");
  surface.noteAgent(actor, kind === "reply" ? "replied to a comment" : kind === "edit" ? "edited a comment" : "commented on this note");
  return { sent: kind === "reply" ? "reply" : kind === "edit" ? "edit" : "comment", threads: s.threads.map(t => ({ id: t.id, open: t.open, quote: t.quote, replies: t.replies.length })), recordedAs: recordedAnswer(actor, kind === "edit" ? "revision" : "new") };
}
/** What `R` with no line runs: `refreshTarget`'s answer, or its refusal said on the person's status bar (the key's own is quiet). */
export function refreshOf(surface: NoteSurface, host: SurfaceHost, actor: Actor): { block: string; line?: number } {
  try { return surface.refreshTarget(); } catch (e) { if (e instanceof ActionRefused && actor.kind === "user") host.ctx.flash(e.message, undefined, errorDetails(e)); throw e; }
}

export const FLOAT_MOVE_ARGS = {
      dx: { type: "number", optional: true, about: "columns to move right (negative: left)" }, dy: { type: "number", optional: true, about: "rows to move down (negative: up)" },
      col: { type: "number", optional: true, about: "its left column" }, row: { type: "number", optional: true, about: "its top row" },
      dcols: { type: "number", optional: true, about: "columns wider (negative: narrower)" }, drows: { type: "number", optional: true, about: "rows taller (negative: shorter)" },
      cols: { type: "number", optional: true, about: "its width" }, rows: { type: "number", optional: true, about: "its height" },
      reset: { type: "boolean", optional: true, about: "back to its usual place and size" },
    } as const;

/** The completion list open in this reader's edit or the comment being written, or why there's none. */
export function openCompleter(surface: NoteSurface): Completer {
  const d = surface.writingDraft;
  const c = d && completerOf(d);
  if (!c?.shown?.items.length) throw new ActionRefused("no completion list is open; type [[, ((, :: or a [key:: in an edit or comment first");
  return c;
}

/** What `block.tint` marks: a block, note lines or a passage (PIE-423's focus mark). */
export const TINT_ARGS = {
  block: { type: "string", optional: true, about: "a block id (or its first 8+ characters): this note, or one it embeds or links" },
  line: { type: "number", optional: true, about: "a note line (1 is the subject)" },
  to: { type: "number", optional: true, about: "with line: the last note line" },
  quote: { type: "string", optional: true, about: "the note's exact words, as stored (the same shape as a comment's quote)" },
  near: { type: "number", optional: true, about: "with quote, when the words occur more than once: the offset to be nearest" },
} as const;

/** `## Beds`, `- dig the bed`: a fold point as the hint, `peek` and the fold actions name it. */
export const foldLabel = (p: FoldPoint) => `${p.kind === "heading" ? "#".repeat(p.level) : p.kind === "callout" ? ">".repeat(p.level) : "-"} ${printable(p.text)}`;
