// `ep0ch mark <note>` and `ep0ch marks` (PIE-1237): a mark from a shell, a script or an agent with no door open, through
// the service's one verb (`marks.add`, `marks.remove`, `marks.list`; outliner src/marks.ts), the same the door's alt+m,
// an agent's outline_mark and the web page call. The person's by default; --as makes it an agent's. Which outline is
// the one rule every client applies (`--ws`, `--machine`, EP0CH_WS, the folder's `.ep0ch`).
import { parseArgs } from "node:util";
import { subject } from "./board";
import { boardFor, resolveNotes, type Out } from "./notes-cli";
import { requesterOf, USER, type Actor } from "./socket";

export const MARK_USAGE = `  ep0ch mark <note> [--reason <words>] [--words <text>] [--remove] [--as <agent id>] [--json] [--ws <name>] [--machine <ssh-name>]
  ep0ch marks [--today] [--json] [--ws <name>] [--machine <ssh-name>]`;

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** `ep0ch mark …` and `ep0ch marks …`: the exit code. */
export async function markCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const listing = argsIn[0] === "marks";
  let parsed;
  try {
    parsed = parseArgs({
      args: argsIn.slice(1), allowPositionals: true, strict: true,
      options: { reason: { type: "string" }, words: { type: "string" }, remove: { type: "boolean" }, today: { type: "boolean" }, as: { type: "string" }, json: { type: "boolean" }, ws: { type: "string" }, machine: { type: "string" } },
    });
  } catch (e) { io.err(`ep0ch: ${(e as Error).message}\n${MARK_USAGE}`); return 2; }
  const { values, positionals } = parsed;
  if (listing ? positionals.length : positionals.length !== 1) { io.err(`ep0ch: ${listing ? "marks takes no note" : "mark takes one note: its id, ((id)), [[page]] or Work ID"}\n${MARK_USAGE}`); return 2; }
  if (values.remove && (values.reason !== undefined || values.words !== undefined)) { io.err(`ep0ch: --remove takes your marks off; give it alone\n${MARK_USAGE}`); return 2; }
  const actor: Actor = values.as?.trim() ? { kind: "agent", id: values.as.trim() } : USER;
  const board = await boardFor([...(values.ws ? ["--ws", values.ws] : []), ...(values.machine ? ["--machine", values.machine] : [])]);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    if (listing) {
      const { marks } = await board.request("marks.list", values.today ? { input: { since: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() } } : {});
      if (values.json) { io.out(JSON.stringify(marks)); return 0; }
      const titles = new Map((await board.records(marks.flatMap(m => (m.block ? [m.block] : []))).catch(() => ({ records: [] }))).records.map(r => [r.id, r.title]));
      for (const m of marks) {
        const what = m.block ? `“${titles.get(m.block) ?? m.block}”` : m.file ? `${m.file}:${m.line}` : `resource ${m.resource}`;
        io.out(`${String(m.n).padStart(4)}  ${m.at.slice(0, 16).replace("T", " ")}  ${m.author === "user" ? "you" : m.by}  ${what}${m.reason ? `  ◆ ${m.reason}` : ""}${m.words ? `  · ${m.words}` : ""}`);
      }
      if (!marks.length) io.out(values.today ? "no marks today" : "no marks");
      return 0;
    }
    const [found] = await resolveNotes(board, positionals);
    if (!found || "error" in found) { io.err(`ep0ch: ${found?.error ?? "no such note"}`); return 1; }
    const note = await board.get(found.id);
    const title = note ? subject(note) : found.id;
    if (values.remove) {
      const me = requesterOf(actor).actorId ?? "user";
      const { marks } = await board.request("marks.list", { input: { blockId: found.id } });
      const removed = [];
      for (const m of marks.filter(m => m.by === me)) removed.push(...(await board.request("marks.remove", { input: { n: m.n }, mutation: requesterOf(actor) })).removed);
      if (values.json) io.out(JSON.stringify({ removed }));
      else io.out(removed.length ? `took ${removed.length === 1 ? "your mark" : `your ${removed.length} marks`} off “${title}”` : `“${title}” has no mark of yours`);
      return 0;
    }
    const { mark, already } = await board.request("marks.add", { input: { blockId: found.id, surface: "cli", ...(values.reason?.trim() ? { reason: values.reason.trim() } : {}), ...(values.words?.trim() ? { words: values.words.trim() } : {}) }, mutation: requesterOf(actor) });
    if (values.json) io.out(JSON.stringify({ mark, already }));
    else io.out(already ? `“${title}” already has that mark (${mark.n})` : `marked “${title}”${mark.reason ? `: ◆ ${mark.reason}, framed in every door showing it` : ": marked:today lists it"} (${mark.n}) · off again: ep0ch mark ${quote(positionals[0]!)} --remove`);
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}
