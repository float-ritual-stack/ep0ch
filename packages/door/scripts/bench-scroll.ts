// PIE-1094: the real outline tile over a generated import, painted by Rows with no terminal.
// Input and its synchronous frame are timed together; opening includes the scratch service's read.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Scratch, until } from "../test/scratch";
import { SocketBoard } from "../src/socket";
import { App } from "../src/app";
import { MainMenu } from "../src/screens";
import { Desk } from "../src/desk/desk";
import { register } from "../src/desk/screen-notes";
import { Rows, type Key } from "../src/term";
import type { TreePane } from "../src/desk/tree";

export async function seedScroll(board: SocketBoard) {
  const parent = await board.createBlock(null, "Imported highlights");
  for (let i = 1; i <= 2600; i++) {
    const note = await board.createBlock(parent.id, `Highlight ${i}: A made-up passage about keeping a garden journal and observing how the seasons change [type::highlight] [source::Garden book ${i % 17}] [rating::${i % 5}]`);
    for (let j = 1; j <= 2 + i % 4; j++) await board.createBlock(note.id, `Detail ${j} for highlight ${i} [type::detail] [topic::garden]`);
  }
  return parent;
}

export interface Summary { action: string; frames: number; median: number; p95: number; worst: number; bytes: number }
export const BUDGET = { frameMs: 16, openMs: 250 };
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const round = (n: number) => Math.round(n * 100) / 100;
export function broken(results: Summary[]) {
  return results.filter(r => r.p95 > (r.action === "open" ? BUDGET.openMs : BUDGET.frameMs)).map(r => `${r.action}: p95 ${r.p95}ms exceeds ${r.action === "open" ? BUDGET.openMs : BUDGET.frameMs}ms`);
}

async function run(frames: number): Promise<Summary[]> {
  const scratch = new Scratch();
  let board: SocketBoard | undefined, app: App | undefined, desk: Desk | undefined;
  try {
    await scratch.start();
    process.env.EP0CH_STATE = join(scratch.root, "door");
    mkdirSync(process.env.EP0CH_STATE, { recursive: true });
    board = new SocketBoard(scratch.sock);
    await board.info();
    const parent = await seedScroll(board);
    let bytes = 0, key: (k: Key) => void = () => {}, batch: (f: () => void) => void = f => f();
    const rows = new Rows(s => { bytes += s.length; }, { cols: 120, rows: 40, cellW: 9, cellH: 18, kitty: false });
    const term = Object.assign(rows, { onKey(f: typeof key) { key = f; }, onBatch(f: typeof batch) { batch = f; }, onResize() {}, stop() {}, resume() {} });
    app = new App(term as never, board, Date.now(), () => {});
    app.push(new MainMenu());
    register({ name: "bench-scroll", id: "00000000-0000-4000-8000-000000001094", revision: 1, spec: { name: "bench-scroll", title: "bench-scroll", layouts: true, layout: { name: "bench-scroll", rule: "current", focus: "outline", root: { t: "leaf", kind: "tree", name: "outline" } } } } as never);
    desk = new Desk(undefined, { layout: "bench-scroll" });
    app.push(desk);
    const D = desk as any;
    await until(() => [...D.panes.values()].some((p: any) => p.kind === "tree" && p.list().length), "the outline tile");
    const tree = [...D.panes.values()].find((p: any) => p.kind === "tree") as TreePane;
    tree.selectRow(tree.list().findIndex(r => r.kind === "block" && r.m.id === parent.id), desk, false);
    let paints = 0, openedAt = 0, openingRows: number | null = null;
    const A = app as any, draw = A.drawFrame.bind(app);
    A.drawFrame = () => {
      paints++;
      const result = draw();
      if (openingRows !== null && tree.list().length === openingRows && !openedAt) openedAt = performance.now();
      return result;
    };
    const send = (k: Key) => batch(() => key(k));
    const results: Summary[] = [];
    const summarize = (action: string, ms: number[], wrote: number) => results.push({ action, frames: ms.length, median: round(pct(ms, .5)), p95: round(pct(ms, .95)), worst: round(Math.max(...ms)), bytes: wrote });
    const opening: number[] = [], foldedCount = tree.list().length;
    for (let i = 0; i < 5; i++) {
      openingRows = foldedCount + 2600; openedAt = 0;
      const start = performance.now();
      send({ kind: "right" });
      await until(() => openedAt > 0, "the imported children painted");
      openingRows = null;
      opening.push(openedAt - start);
      if (i < 4) { send({ kind: "left" }); await Bun.sleep(25); }
    }
    summarize("open", opening, bytes);
    const cases: [string, Key][] = [["j", { kind: "char", ch: "j" }], ["k", { kind: "char", ch: "k" }], ["PgDn", { kind: "pgdn" }], ["wheel", { kind: "mouse", action: "wheel-down", button: 0, x: 10, y: 10 }]];
    for (const [action, input] of cases) {
      send({ kind: action === "k" ? "end" : "home" });
      const ms: number[] = []; bytes = 0;
      for (let i = 0; i < frames; i++) {
        const before = tree.selectedRow, painted = paints, start = performance.now();
        send(input);
        ms.push(performance.now() - start);
        if (paints === painted) throw new Error(`${action} did not paint a frame`);
        if (tree.selectedRow === before) throw new Error(`${action} did not move the outline selection`);
        await Bun.sleep(0);
      }
      summarize(action, ms, bytes);
    }
    return results;
  } finally {
    app?.retire();
    (desk as any)?.dispose?.();
    board?.close();
    await scratch.dispose();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2), at = args.indexOf("--frames");
  const results = await run(at < 0 ? 120 : Number(args[at + 1]));
  console.log(args.includes("--json") ? JSON.stringify(results, null, 2) : results.map(r => `${r.action}: median ${r.median}ms, p95 ${r.p95}ms, worst ${r.worst}ms (${r.frames} frames)`).join("\n"));
  const bad = broken(results);
  if (args.includes("--check") && bad.length) { console.error(bad.join("\n")); process.exit(1); }
  process.exit(0);
}
