// A real door on the Desk, for the host's load harness (PIE-1413, outliner scripts/bench-host-fairness.ts): the door's
// own App over one SocketBoard, as a person's door is, with a board tile and a live query tile open, and the person's
// reads and saves made through the same connection. Every request the door makes is timed, so what's measured is what
// the person waits for in the door, not a probe on a connection of its own.
//
//   bun scripts/bench-door-desk.ts --socket <host.sock> --outline <name> [--hub <id>] [--query "type=review-finding"]
//                                  [--note <id>]
//
// Reads lines on stdin: `phase <name>` labels what follows; `report` prints the timings as one JSON line and exits.
// Run it under a scratch EP0CH_STATE (the harness gives it a temp dir): it writes the door's state there.
import { parseArgs } from "node:util";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { QueryPane } from "../src/desk/query";
import { MainMenu } from "../src/screens";
import { readView } from "../src/views";
import { SocketBoard } from "../src/socket";

const { values } = parseArgs({ options: { socket: { type: "string" }, outline: { type: "string" }, hub: { type: "string" }, query: { type: "string" }, note: { type: "string" } } });
if (!values.socket || !values.outline) throw new Error("bench-door-desk needs --socket and --outline");
process.env.EP0CH_DAILY_AGENT = "sh";

let phase = "start-up";
/** Every request the door made: its action, the phase it was asked in, how long its answer took (or that it failed). */
const timed: Array<{ phase: string; action: string; ms: number; failed?: true; view?: string }> = [];
const board = new SocketBoard(values.socket, 15_000, values.outline);
const request = board.request.bind(board);
const view = (params?: Record<string, unknown>) => (typeof params?.viewId === "string" ? { view: params.viewId } : {});
board.request = ((action: string, params?: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal) => {
  const at = phase, started = performance.now();
  return request(action, params, timeoutMs, signal).then(
    r => { timed.push({ phase: at, action, ms: performance.now() - started, ...view(params) }); return r; },
    e => { if (!signal?.aborted) timed.push({ phase: at, action, ms: performance.now() - started, failed: true, ...view(params) }); throw e; },
  );
}) as typeof board.request;
await board.info();
// Every query tile the door makes (the board's lanes, the query tile), to check what they show at the end.
const tiles: QueryPane[] = [];
const init = QueryPane.prototype.init;
QueryPane.prototype.init = function (this: QueryPane, ...args: Parameters<typeof init>) { tiles.push(this); return init.apply(this, args); };

const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
const app = new App(term as never, board, Date.now(), () => {});
board.subscribe(e => app.event(e));
app.push(new MainMenu());
const desk = new Desk();
app.push(desk);
const D = desk as unknown as { ctx: unknown; panes: Map<string, unknown>; dispose(): void };
desk.render(D.ctx as never);
for (const end = Date.now() + 20_000; D.panes.size === 0 && Date.now() < end;) await Bun.sleep(50);
const act = (action: string, args: Record<string, unknown>) => app.act({ action, args, as: "bench" }).catch((e: Error) => console.error(`bench-door-desk: ${action}: ${e.message}`));
await act("tile.open", { kind: "board", ...(values.hub ? { target: values.hub } : {}) });
await act("tile.open", { kind: "query", query: values.query ?? "type=review-finding" });
// The door draws as a person's does: a frame whenever something changed, at most every 50 ms.
const drawing = setInterval(() => { try { (app as unknown as { paint(): void }).paint(); } catch { /* a frame that throws is the door's to report */ } }, 50);

// The person: opens a note's children every second and saves a note of their own every five, through the door's board.
const mine = await board.request<{ id: string; revision: number }>("create", { text: "Bench person's note", author: "user" });
let revision = mine.revision, n = 0;
const person = setInterval(() => {
  n += 1;
  if (values.note) void board.children(values.note).catch(() => {});
  if (n % 5 === 0) void board.request<{ revision: number }>("update", { blockId: mine.id, text: `Bench person's note ${n}`, expectedRevision: revision, mutation: { author: "user" } })
    .then(r => { revision = r.revision; }, () => {});
}, 1_000);

let buffer = "";
for await (const chunk of Bun.stdin.stream().pipeThrough(new TextDecoderStream())) {
  buffer += chunk;
  for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line.startsWith("phase ")) phase = line.slice(6);
    if (line === "report") {
      clearInterval(person); clearInterval(drawing);
      // Converged: each tile's cards against the same read asked now (a lane off the board may be one change behind
      // for up to its hidden refresh, so it is given that long first).
      await Bun.sleep(11_000);
      const shown = (p: QueryPane) => (p.items ?? []).map(m => m.id).join(",");
      let stale = 0;
      for (const p of tiles) {
        if (p.disposed || p.items === null) continue;
        // A read that fails (the host too busy to answer in 15 s) can't say it matches: counted stale.
        const fresh = await (p.query !== null ? board.queryNotes(p.query, 200).then(r => r.notes) : p.titleNote ? readView(board, p.titleNote).then(r => r.items) : Promise.resolve(null)).catch(() => undefined);
        if (fresh === undefined || (fresh && fresh.map(m => m.id).join(",") !== shown(p))) stale += 1;
      }
      process.stdout.write(`${JSON.stringify({ timed, tiles: tiles.filter(p => !p.disposed).length, stale })}\n`);
      try { D.dispose(); } catch { /* going anyway */ }
      board.close();
      process.exit(0);
    }
  }
}
