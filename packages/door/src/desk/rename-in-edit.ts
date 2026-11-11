// note.rename while the note is open in an edit (PIE-1722): the person's press changes the title in their edit; anyone
// else's would write under their draft, so it is refused with what to do.
import { lineStart } from "@ep0ch/outline-core/code-ranges";
import { retitle } from "@ep0ch/outline-core/header-line";
import type { Draft } from "../edit";
import { ActionRefused } from "../surface/actions";
import { USER, type Actor } from "../socket";

/** The person's press: their keys or click, or a button they pressed (a script run for them, as ask-agent.ts reads it). */
export const pressedByPerson = (actor: Actor) => actor.kind === "user" || (actor.kind === "agent" && actor.for === "you" && actor.id.startsWith("script:"));

/**
 * The person's own press (yo's ▸ rename beside the line, a button they pressed: a script run for them, as ask-agent.ts
 * reads it) retitles the first line of their edit as one undo step, saved with the rest: the new title. Their cursor and
 * selection stay on what they had (the draft's own patch maps them). A press that read the title of another note, or of
 * this one at another revision (`expect`, as note.rename takes them), changes nothing; anyone else's is refused.
 */
export function renameInEdit(draft: Draft, text: string | undefined, actor: Actor, expect: { note?: string; revision?: number } = {}): string {
  const theirs = pressedByPerson(actor);
  const title = text?.trim() ?? "";
  if (!theirs || !title || title.includes("\n")) throw new ActionRefused("this reader is editing the note: change its title in the edit");
  if (expect.note !== undefined && expect.note !== draft.blockId) throw new ActionRefused(`this reader is editing another note now; nothing was renamed · ${title}`);
  if (expect.revision !== undefined && expect.revision !== draft.base) throw new ActionRefused(`the note changed since its title was read (revision ${expect.revision}, the edit is on ${draft.base}); nothing was renamed · ${title}`);
  const before = draft.text, after = retitle(before, title);
  if (after === before) return title;
  // One span: the lines that differ (the title's), so the patch's own mapping moves nothing the person had below it.
  const was = before.split("\n"), next = after.split("\n");
  if (next.length !== was.length) throw new ActionRefused("this reader is editing the note: change its title in the edit");
  const first = was.findIndex((l, i) => l !== next[i]), last = was.length - 1 - [...was].reverse().findIndex((l, i) => l !== next[next.length - 1 - i]);
  const start = lineStart(was, first), observed = was.slice(first, last + 1).join("\n");
  const r = draft.applyPatch({ patchId: crypto.randomUUID(), revision: draft.base, patches: [{ observed, replacement: next.slice(first, last + 1).join("\n"), range: { start, end: start + observed.length } }] }, USER);
  if (!r.applied) throw new ActionRefused(`the title couldn't change in the edit: ${r.reason}`);
  return title;
}
