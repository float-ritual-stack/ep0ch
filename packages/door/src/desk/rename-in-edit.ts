// note.rename while the note is open in an edit (PIE-1722): the person's press changes the title in their edit; anyone
// else's would write under their draft, so it is refused with what to do.
import { retitle } from "@ep0ch/outline-core/header-line";
import type { Draft } from "../edit";
import { ActionRefused } from "../surface/actions";
import { USER, type Actor } from "../socket";

/**
 * The person's own press (yo's ▸ rename beside the line, a button they pressed: a script run for them, as ask-agent.ts
 * reads it) retitles the first line of their edit, one undo step, saved with the rest: the new title. Anyone else's, or one
 * with no title, is refused.
 */
export function renameInEdit(draft: Draft, text: string | undefined, actor: Actor): string {
  const theirs = actor.kind === "user" || (actor.kind === "agent" && actor.for === "you" && actor.id.startsWith("script:"));
  const title = text?.trim() ?? "";
  if (!theirs || !title || title.includes("\n")) throw new ActionRefused("this reader is editing the note: change its title in the edit");
  const was = draft.text.split("\n"), next = retitle(draft.text, title).split("\n");
  if (next.length !== was.length) throw new ActionRefused("this reader is editing the note: change its title in the edit");
  draft.splice(draft.col, draft.col, "", Object.fromEntries(next.flatMap((l, i) => (l === was[i] ? [] : [[i, l]]))), USER);
  return title;
}
