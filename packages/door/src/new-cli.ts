// `ep0ch new <text>…` (PIE-544): a new note from outside the door (a shell, a script, an agent with no door open),
// through the service call the door's `note.new` makes (`notes.create`, SocketBoard.newNote): where the outline's
// placement rule puts it, the top of the Inbox, or under --near (refused when that note is gone, never quietly the
// Inbox). Which outline is the one rule every client applies (`--ws`, `--machine`, EP0CH_WS, the folder's `.ep0ch`).
import { savedReferenceWarnings } from "./reference-warnings";
import { describeReferenceWarning } from "@ep0ch/outline-core/reference-warnings";
import { parseArgs } from "node:util";
import { subject } from "./board";
import { boardFor, type Out } from "./notes-cli";
import type { Actor } from "./socket";
import { USER } from "./socket";

export const NEW_USAGE = `  ep0ch new <text>… [--near <id>] [--as <agent id>] [--json] [--ws <name>] [--machine <ssh-name>]
                                   a new note, its text the words given (a first line of only [page::x] is
                                   titled x), where the outline puts new notes: the top of the Inbox, or as the
                                   last child of --near (refused when that note is gone, with the command to
                                   run instead); --as writes it as that agent; prints where it went and its id
                                   (--json: id, title, parentId, rule, said). In the door: ctrl+n, or act note.new`;

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** `ep0ch new …`: its exit code. */
export async function newCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argsIn.slice(1), allowPositionals: true, strict: true,
      options: { near: { type: "string" }, as: { type: "string" }, json: { type: "boolean" }, ws: { type: "string" }, machine: { type: "string" } },
    });
  } catch (e) { io.err(`ep0ch: ${(e as Error).message}\n${NEW_USAGE}`); return 2; }
  const { values, positionals } = parsed;
  const text = positionals.join(" ").trim();
  if (!text) { io.err(`ep0ch: new takes the note's text: ep0ch new "<text>"\n${NEW_USAGE}`); return 2; }
  const actor: Actor = values.as?.trim() ? { kind: "agent", id: values.as.trim() } : USER;
  const board = await boardFor([...(values.ws ? ["--ws", values.ws] : []), ...(values.machine ? ["--machine", values.machine] : [])]);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    const { note, placement } = await board.newNote(text, values.near, actor, values.near !== undefined);
    const title = subject(note);
    if (values.json) io.out(JSON.stringify({ id: note.id, title, parentId: placement.parentId, rule: placement.rule, said: placement.said }));
    else io.out(`made “${title}” ${placement.said}  ${note.id}`);
    // Made as written; a reference that leads nowhere is said after, with what it may have meant (PIE-761).
    for (const w of await savedReferenceWarnings(board, text, note.id)) io.err(`warning: ${describeReferenceWarning(w)}`);
    return 0;
  } catch (e) {
    const why = (e as Error).message;
    const where = [values.ws ? `--ws ${quote(values.ws)}` : "", values.machine ? `--machine ${quote(values.machine)}` : "", values.as ? `--as ${quote(values.as)}` : ""].filter(Boolean).join(" ");
    const fix = /^No live note /.test(why) ? `\n  in the Inbox instead: ep0ch new ${quote(text)}${where ? ` ${where}` : ""}` : "";
    io.err(`ep0ch: ${why}${fix}`);
    return 1;
  } finally { board.close(); }
}
