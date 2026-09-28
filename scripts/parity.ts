// Read-only parity check: every saved view in the outline, as the service evaluates it (views.read)
// and as the door's own port does (src/views.ts). Prints counts and view ids only, never note text, so
// it can run against a copy of a real outline and its output can be shared.
//   EP0CH_SOCKET=<sock> bun scripts/parity.ts
import { SocketBoard } from "../src/socket";
import { queryShape, readView, readViewHere } from "../src/views";

const board = new SocketBoard(process.env.EP0CH_SOCKET, 60_000);
const info = await board.info();
if (board.supports("views.read") === false) { console.error("this service has no views.read (no capability); nothing to compare"); process.exit(2); }
const defs = await board.query("type=virtual-branch", 1000);
let same = 0, serviceOnly = 0, differ = 0, unpatchable = 0;
const tally = new Map<string, number>();
for (const def of defs) {
  const theirs = await readView(board, def), mine = await readViewHere(board, def);
  if (theirs.by !== "service") { console.error("views.read isn't answering; stopping"); process.exit(2); }
  const shape = queryShape(def.props.query ?? "");
  if ("unpatchable" in shape) unpatchable++;
  tally.set(theirs.status, (tally.get(theirs.status) ?? 0) + 1);
  // Queries only the newer grammar can express: the door's port calls them invalid, by design.
  if (mine.status === "invalid" && theirs.status === "ready" && "unpatchable" in shape) { serviceOnly++; continue; }
  const a = JSON.stringify([theirs.status, theirs.items.map(m => m.id), theirs.truncated, theirs.limit]);
  const b = JSON.stringify([mine.status, mine.items.map(m => m.id), mine.truncated, mine.limit]);
  if (a === b) { same++; continue; }
  differ++;
  console.log(`DIFFERS ${def.id}: service ${theirs.status} ${theirs.items.length}${theirs.truncated ? "+" : ""} (limit ${theirs.limit}) · door ${mine.status} ${mine.items.length}${mine.truncated ? "+" : ""} (limit ${mine.limit})`);
}
console.log(`protocol ${info.protocol} · capabilities ${info.capabilities?.join(",") ?? "(none advertised)"}`);
console.log(`${defs.length} saved views · statuses ${[...tally].map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`identical ${same}/${defs.length - serviceOnly} · newer-grammar only ${serviceOnly} · differ ${differ} · refused as move targets ${unpatchable}`);
board.close();
process.exit(differ ? 1 : 0);
