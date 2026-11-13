/*
 * The programs a door runs in its terminal tiles, as a list (packages/native/docs/DESIGN.md W8), read as every list
 * is (`lists.read`, list-producers.ts): a row says what it shows and the act line a pick runs, so a client maps
 * nothing and has no drawer of its own for them.
 *
 * - **The truth is the asker's.** A program runs on the asker's machine, kept by what the asker runs it with (a
 *   pseudo-terminal of its own, a tmux server it started): the service keeps no registry of them, and one door's
 *   are not another's (the door's terminal host has one client, packages/native/docs/PROBES.md §8). So the asker
 *   hands its programs over (`programs`: each as it says of itself), as `from: actions` is handed the asker's own
 *   action rows, and this writes the rows.
 * - **A pick jumps.** `terminal.jump key=<the program>` is the one line: the keys go to the program where it shows,
 *   and one that no tile shows is given a tile first. The door that hands programs over runs it.
 * - **What a row says is the program's own words**: its name, the line that started it, what keeps it running and
 *   whether that outlives the door, how it stands and where it shows. Nothing here names a program.
 */
import { listRowMatches, type ListGroup, type ListRow } from "@ep0ch/outline-core/list-row";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { row, runs, type Answered, type ListsRequest, type Own, type Producer } from "./list-producer";

/** A program a door runs in a terminal tile, as the door says it. */
export interface ProgramSaid {
  /** What the door names it by (`terminal.jump key=`). */
  key: string;
  /** What it is called: its tile's kind in the kind's own word, or its tile's name. */
  name: string;
  /** The line that started it. Left out: the person's own shell. */
  command?: string;
  /** The folder it started in. */
  cwd?: string;
  /** What runs it (`tmux`, `pty`), in that backend's own name. */
  backend?: string;
  /** It outlives the door: the next launch finds it running. */
  keeps?: boolean;
  /** How it stands, in the door's word: `running`, `exited`, `lost`, or why it never started. */
  state: string;
  /** The tile it shows in. Left out: no tile shows it (it was detached, or kept from an earlier launch). */
  tile?: string;
  /** The window that tile is in, when it is not the asker's own. */
  window?: string;
}

const SHOWN = "In a tile", DETACHED = "Running, in no tile";

/**
 * The asker's programs (`programs`), the ones in a tile first, then the ones still running that no tile shows. A row
 * is a program: its name, the line that started it, how it stands; what keeps it and where it is as cells. A pick
 * is the jump.
 */
async function programs(_own: Own, request: ListsRequest): Promise<Answered> {
  if (!Array.isArray(request.programs)) throw new Refusal("invalid", "lists.read from=programs lists the asker's own programs: hand them over as programs=[<each program as it says of itself>]");
  const words = prepareSearchQuery(request.query ?? "");
  const said = request.programs.filter((p): p is ProgramSaid => !!p && typeof p.key === "string" && !!p.key && typeof p.name === "string");
  const rows: ListRow[] = said.flatMap(p => {
    const where = p.tile ? (p.window ? `${p.tile} · window ${p.window}` : p.tile) : "";
    const kept = p.backend ? `${p.backend} · ${p.keeps ? "outlives the window" : "ends with the window"}` : "";
    const detail = [p.command, p.cwd].filter(Boolean).join(" · ");
    if (!listRowMatches({ label: p.name, detail: [detail, kept, where].join(" "), mark: p.state }, words)) return [];
    return [row({ id: p.key, label: p.name, ...(detail ? { detail } : {}), mark: p.state, group: p.tile ? SHOWN : DETACHED, cells: [kept, where].filter(Boolean), do: runs("terminal.jump", { key: p.key }) })];
  });
  const order = [SHOWN, DETACHED].filter(name => rows.some(r => r.group === name));
  const sorted = order.flatMap(name => rows.filter(r => r.group === name));
  const groups: ListGroup[] = order.map(name => ({ name, label: name, count: sorted.filter(r => r.group === name).length }));
  const running = said.filter(p => p.state === "running").length;
  return { list: { type: "list", arrange: "rows", rows: sorted, ...(groups.length > 1 ? { groups } : {}), title: `Programs · ${running} running`, empty: said.length ? "No program matches." : "No program runs in a terminal here. terminal.open starts a shell beside the note." } };
}

/** The source this module adds to `lists.read`, as it says of itself. */
export const PROGRAM_PRODUCERS: readonly Producer[] = [
  { row: { from: "programs", about: "Programs", placeholder: "A program's name, or what it runs", params: [{ name: "programs", about: "the programs the asker runs, each as it says of itself", required: true }, { name: "query", about: "words that narrow the rows" }], bar: {} }, read: programs },
];
