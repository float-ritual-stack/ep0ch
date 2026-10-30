// A note component made in one choice (note components, WP4): `component.new name=stale` writes a render script's
// starter note under [[components]] (the page made when it isn't there), attributed, and puts `::stale{}` at the draft's
// cursor. Completion's `+ new component ::stale` row (outliner completion-sources.ts) runs the same code, then opens
// the note beside. The starter draws as soon as it lands: the notes its where= holds, one card each.
import { ActionRefused } from "@ep0ch/outline-core/action-line";
import { subject, type Msg } from "../board";
import type { Actor, SocketBoard } from "../socket";

/** The page new components are written under, unless `under=` names another. */
export const COMPONENTS_PAGE = "components";
/** A component's name: what `::name{}` calls (outline-core COMPONENT_OPEN's rule). */
export const COMPONENT_NAME = /^[a-z][a-z0-9-]*$/;

/** What a new component's note says first: its name as words (`open-count` is "Open count"). */
const titleOf = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

/**
 * A new component's note: the render script `[script::name] [mode::render]` with one `where` prop (a query, by default
 * the tasks), a line saying what it is, its demo line, and a tsx fence that lists the rows its where holds.
 */
export function starterComponent(name: string): string {
  return [
    `${titleOf(name)} [script::${name}] [mode::render] [form-field::where query default=type=task]`,
    "The notes a query holds, one card each: change the fence and every call redraws.",
    "",
    `::${name}{}`,
    "",
    "```tsx",
    "const { rows } = await query({ where: props.where[0], limit: 20 })",
    "return <stack>{rows.map(r => <card title={r.title} link={r.id}/>)}</stack>",
    "```",
  ].join("\n");
}

/** What `component.new` needs of the board: the page it writes under, the note it writes, the names taken. */
export type ComponentBoard = Pick<SocketBoard, "followPage" | "createBlock" | "listExtensions">;

/**
 * Write the starter note for `::name` under the page `under` (made when missing, where new pages go), as `by`. Refused
 * for a name a component can't have, or one a script already answers to (an action script's too: two would answer it).
 */
export async function makeComponent(board: ComponentBoard, name: string, by: Actor, under = COMPONENTS_PAGE): Promise<{ note: Msg; page: Msg; said: string }> {
  if (!COMPONENT_NAME.test(name)) throw new ActionRefused(`${JSON.stringify(name)} isn't a component's name: lowercase letters, digits and -, starting with a letter`);
  const listed = await board.listExtensions().catch(() => null);
  if (listed?.extensions.some(e => e.state !== "disabled" && ((e.script && e.name === name) || e.handlers.some(h => h.key === name))))
    throw new ActionRefused(`${name} is taken: a script answers to it already; call it, or pick another name`);
  const page = await board.followPage(under, by).catch((e: Error) => { throw new ActionRefused(`no page ${under}: ${e.message}`); });
  if (!page.note) throw new ActionRefused(page.status === "deleted" ? `[[${under}]] is a page in the trash: restore it there` : `no page ${under} (${page.status})`);
  const note = await board.createBlock(page.note.id, starterComponent(name), by);
  return { note, page: page.note, said: `made component ::${name} under ${subject(page.note)}${page.created ? " (a new page)" : ""}` };
}

/** Where `::name{}` goes in a draft: on the cursor's line when it's blank, else on a line of its own after it. */
export function callSplice(line: string, name: string): { start: number; end: number; text: string } {
  const call = `::${name}{}`;
  if (!line.trim()) return { start: 0, end: line.length, text: call };
  return { start: line.length, end: line.length, text: `\n${call}` };
}
