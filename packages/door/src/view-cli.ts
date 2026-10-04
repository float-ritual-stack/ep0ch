// `ep0ch view order`: a view's hand-set order, read or set from a shell. The same service call the board's
// card.reorder makes (`virtual.occurrences.move`: read, planned and written in one step, recorded as who ran it).
import { boardFor, type Out } from "./notes-cli";
import { subject } from "./board";
import { USER, type Actor } from "./socket";

export const VIEW_USAGE = `  ep0ch view order <view> [<id>…] [--json] [--as <agent id>] [--ws <name>] [--machine <ssh-name>]
                                   a view's hand-set order (a view with no [sort::]: what its lanes, figures and
                                   Tree show), one member a line: position, ((id)), work id, title. With ids
                                   (ids, ((id)), an id's first 8+ characters, Work IDs such as PIE-552, [[page]]s;
                                   the view is named the same ways), those members first, in the
                                   order given, the rest after them as they were; then the order as it is now.
                                   --json prints {view, order: [{id, title, workId?}]}; --as records the change as
                                   that agent's (else EP0CH_AGENT's, else yours)`;

export async function viewCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = argsIn.slice(1);
  if (args[0] !== "order") { io.err(`ep0ch: view takes order\n${VIEW_USAGE}`); return 2; }
  const valued = ["--ws", "--machine", "--as"];
  for (const f of valued) {
    const at = args.indexOf(f);
    if (at >= 0 && (args[at + 1] === undefined || args[at + 1]!.startsWith("--"))) { io.err(`ep0ch: ${f} needs a value`); return 2; }
    if (args.filter(a => a === f).length > 1) { io.err(`ep0ch: ${f} is given once`); return 2; }
  }
  const words = args.slice(1).filter((a, i, all) => !valued.includes(a) && !valued.includes(all[i - 1] ?? "") && a !== "--json");
  const unknown = words.find(w => w.startsWith("--"));
  if (unknown) { io.err(`ep0ch: view order doesn't take ${unknown}\n${VIEW_USAGE}`); return 2; }
  const [view, ...refs] = words;
  if (!view) { io.err(`ep0ch: view order needs the view\n${VIEW_USAGE}`); return 2; }
  const as = args.includes("--as") ? args[args.indexOf("--as") + 1] : process.env.EP0CH_AGENT || undefined;
  const actor: Actor = as ? { kind: "agent", id: as } : USER;
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    // The service resolves the view and the members (ids, ((id)), prefixes, Work IDs, [[page]]s) and moves them.
    const order = refs.length ? await board.moveInView({ view, blocks: refs }, actor) : await board.viewOrder(view);
    const viewId = order.viewId;
    const byId = new Map((await board.readMany(order.blockIds, ["title", "properties"])).map(b => [b.id, b]));
    const rows = order.blockIds.map(id => {
      const m = byId.get(id), workId = m?.props["work-id"];
      return { id, title: m ? subject(m) : "", ...(workId ? { workId } : {}) };
    });
    if (args.includes("--json")) io.out(JSON.stringify({ view: viewId, order: rows, ...(order.completeness.kind !== "complete" ? { truncated: true } : {}) }));
    else rows.forEach((r, i) => io.out(`${String(i + 1).padStart(3)}  ((${r.id}))  ${(r.workId ?? "").padEnd(9)} ${r.title}`));
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}
