/*
 * The programs a door runs in its terminal tiles, as a list (packages/native/docs/DESIGN.md W8), read as every list
 * is (`lists.read`, list-producers.ts): a row says what it shows and the act line a pick runs, so a client maps
 * nothing and has no drawer of its own for them.
 *
 * - **The truth is the asker's.** A program runs on the asker's machine, kept by what the asker runs it with
 *   (herdr-core there, a tmux server it started, a pseudo-terminal of its own): this service may be on another
 *   machine and keeps no registry of them, and one door's are not another's. So the asker hands its programs over
 *   (`programs`: each as it says of itself), as `from: actions` is handed the asker's own action rows, and this
 *   writes the rows.
 * - **A pick jumps.** `terminal.jump key=<the program>` is the one line: the keys go to the program where it shows,
 *   and one that no tile shows is given a tile first. The door that hands programs over runs it.
 * - **What a row says is the program's own words**: its name, the line that started it, what keeps it running and
 *   for how long (`kept`, in the asker's words), how it stands (`state`) and what it reports of itself (`status`:
 *   the word the program told what keeps it, never read off its screen), and where it shows. Nothing here names a
 *   program.
 * - **What the asker did not start is listed and has no pick** (`mine: false`): what keeps the asker's programs
 *   may run the person's other work too. A row says it is there, by the name its keeper gives it; nothing here
 *   offers to end it or take it over.
 */
import { listRowMatches, type ListGroup, type ListRow, type ListTone } from "@ep0ch/outline-core/list-row";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { row, runs, type Answered, type ListsRequest, type Own, type Producer } from "./list-producer";

/** A program a door runs in a terminal tile, or one its keeper runs beside them, as the door says it. */
export interface ProgramSaid {
  /** What the door names it by (`terminal.jump key=`). Empty for one that is not the door's own. */
  key: string;
  /** What it is called: its tile's kind in the kind's own word, its tile's name, or its keeper's name for it. */
  name: string;
  /** The line that started it, or what runs in it now. Left out: the person's own shell. */
  command?: string;
  /** The folder it started in. */
  cwd?: string;
  /** What runs it (`herdr-core`, `tmux`, `pty`), in that backend's own name. */
  backend?: string;
  /** It outlives the door: the next launch finds it running. */
  keeps?: boolean;
  /** What keeps it and for how long, in the door's words (what its tile says too). */
  kept?: string;
  /** How it stands, in the door's word: `running`, `exited`, `lost`, or why it never started. */
  state: string;
  /** What it reports of itself to what keeps it (`idle`, `working`, `done`, `blocked`, `error`). Left out: it reports nothing. */
  status?: string;
  /** What it adds to that word. */
  says?: string;
  /** The tile it shows in. Left out: no tile shows it (it was detached, or kept from an earlier launch). */
  tile?: string;
  /** The window that tile is in, when it is not the asker's own. */
  window?: string;
  /** Who started it, when that was an agent (`agent:<id>`, as a step records an actor). */
  by?: string;
  /** False: the door did not start it. It is listed, and no pick is offered. */
  mine?: boolean;
  /** What its keeper calls it, for one that is not the door's own: how the person reaches it with the keeper's tools. */
  address?: string;
}

const SHOWN = "In a tile", DETACHED = "Running, in no tile", THEIRS = "Not this window's";
/** A program that waits on a person, or failed, is said in a tone; the words are the program's own. */
const TONES: Readonly<Record<string, ListTone>> = { blocked: "warn", error: "bad" };

/**
 * The asker's programs (`programs`), the ones in a tile first, then the ones still running that no tile shows, then
 * what else their keeper runs. A row is a program: its name, the line that started it, what it reports of itself
 * (else how it stands); what keeps it and where it is as cells. A pick is the jump, for the asker's own.
 */
async function programs(_own: Own, request: ListsRequest): Promise<Answered> {
  if (!Array.isArray(request.programs)) throw new Refusal("invalid", "lists.read from=programs lists the asker's own programs: hand them over as programs=[<each program as it says of itself>]");
  const words = prepareSearchQuery(request.query ?? "");
  const said = request.programs.filter((p): p is ProgramSaid => !!p && typeof p.key === "string" && typeof p.name === "string" && (!!p.key || (p.mine === false && typeof p.address === "string" && !!p.address)));
  const rows: ListRow[] = said.flatMap(p => {
    const mine = p.mine !== false;
    const where = p.tile ? (p.window ? `${p.tile} · window ${p.window}` : p.tile) : "";
    const kept = p.kept ?? (p.backend ? `${p.backend} · ${p.keeps ? "outlives the window" : "ends with the window"}` : "");
    const detail = [p.command, p.cwd, p.says, p.by ? `started by ${p.by.replace(/^agent:/, "")}` : ""].filter(Boolean).join(" · ");
    const mark = p.state === "running" && p.status ? p.status : p.state;
    const tone = p.status ? TONES[p.status] : undefined;
    const cells = mine ? [kept, where] : [p.backend ?? "", p.address ?? ""];
    if (!listRowMatches({ label: p.name, detail: [detail, ...cells].join(" "), mark }, words)) return [];
    return [row({ id: mine ? p.key : `theirs:${p.address}`, label: p.name, ...(detail ? { detail } : {}), mark, ...(tone ? { tone } : {}), group: !mine ? THEIRS : p.tile ? SHOWN : DETACHED, cells: cells.filter(Boolean), ...(mine ? { do: runs("terminal.jump", { key: p.key }) } : {}) })];
  });
  const order = [SHOWN, DETACHED, THEIRS].filter(name => rows.some(r => r.group === name));
  const sorted = order.flatMap(name => rows.filter(r => r.group === name));
  const groups: ListGroup[] = order.map(name => ({ name, label: name, count: sorted.filter(r => r.group === name).length }));
  const running = said.filter(p => p.mine !== false && p.state === "running").length;
  return { list: { type: "list", arrange: "rows", rows: sorted, ...(groups.length > 1 ? { groups } : {}), title: `Programs · ${running} running`, empty: said.length ? "No program matches." : "No program runs in a terminal here. terminal.open starts a shell beside the note." } };
}

/** The source this module adds to `lists.read`, as it says of itself. */
export const PROGRAM_PRODUCERS: readonly Producer[] = [
  { row: { from: "programs", about: "Programs", placeholder: "A program's name, or what it runs", params: [{ name: "programs", about: "the programs the asker runs, each as it says of itself", required: true }, { name: "query", about: "words that narrow the rows" }], bar: {} }, read: programs },
];
