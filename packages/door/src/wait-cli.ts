import { boardFor, foundLine, type Out } from "./notes-cli";
import { recordJson } from "@ep0ch/outline-core/block-record";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { previewTitle } from "./socket";
import { sh } from "./setup/links";

export const WAIT_USAGE = `  ep0ch wait <query> [--timeout <seconds>] [--ids | --lines | --json] [--ws <name>] [--machine <ssh-name>]
                                   wait on the outline's watched query; print newly matching rows and exit 0.
                                   Existing rows are the starting point. --timeout exits 2 with "nothing new".
                                   A lost connection exits 1 and prints the command to start again.
                                   Example: ep0ch wait 'parent:((<process-note-id>))' --timeout 60 --json`;

export async function waitCommand(args: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const words: string[] = [];
  let timeout: number | undefined;
  for (let i = 1; i < args.length; i++) {
    const word = args[i]!;
    if (word === "--ws" || word === "--machine") { i++; continue; }
    if (word === "--timeout") {
      timeout = Number(args[++i]);
      if (!Number.isFinite(timeout) || timeout < 0) { io.err("ep0ch wait: --timeout needs seconds, zero or more"); return 2; }
    } else if (["--ids", "--lines", "--json"].includes(word)) continue;
    else if (word.startsWith("--")) { io.err(`ep0ch wait: unknown flag ${word}\n${WAIT_USAGE}`); return 2; }
    else words.push(word);
  }
  const where = words.join(" ");
  if (!where) { io.err(WAIT_USAGE); return 2; }
  const board = await boardFor(args, args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten = () => {};
  try {
    const ids = await new Promise<string[] | null>((resolve, reject) => {
      board.onConnection = (state, detail) => {
        if (state === "lost") reject(new Error(`outline connection lost (${detail})\nrun: ep0ch ${args.map(sh).join(" ")}`));
      };
      let baseline: Set<string> | undefined;
      const params = { query: { where, sort: "created desc", limit: 1000 } };
      const changed = () => {
        const answer = board.watched.read<{ blocks: { id: string }[]; hint?: string }>("blocks.query", params, raw => raw);
        if (answer.state === "error") { reject(new Error(answer.error)); return; }
        if (answer.state !== "ready") return;
        if (!baseline) {
          baseline = new Set(answer.value.blocks.map(b => b.id));
          if (answer.value.hint) io.err(`ep0ch: ${answer.value.hint}`);
          io.err(`ep0ch: waiting for ${where}`);
          if (timeout !== undefined) timer = setTimeout(() => resolve(null), timeout * 1000);
          return;
        }
        const added = answer.value.blocks.filter(b => !baseline!.has(b.id)).map(b => b.id);
        if (added.length) resolve(added.reverse());
      };
      unlisten = board.watched.listen(changed);
      changed();
    });
    if (ids === null) { io.err("ep0ch: nothing new"); return 2; }
    if (args.includes("--ids")) { for (const id of ids) io.out(`((${id}))`); return 0; }
    const { records } = await board.records(ids);
    const rows = records.map(record => ({ ...record, uri: formatEp0chBlockUri({ ...board.address, blockId: record.id }) }));
    if (args.includes("--json")) io.out(recordJson(rows).trimEnd());
    else for (const row of rows) {
      const found = { id: row.id, title: previewTitle(row.title), path: row.path ?? "", uri: row.uri };
      io.out(args.includes("--lines") ? foundLine(found) : `${row.id.slice(0, 8)}  ${found.title}${row.path ? `  · ${row.path}` : ""}`);
    }
    return 0;
  } catch (e) { io.err(`ep0ch: ${(e as Error).message}`); return 1; }
  finally { clearTimeout(timer); unlisten(); board.close(); }
}
