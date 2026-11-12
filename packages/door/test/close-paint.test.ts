// PIE-1769 (seen on main 1d1fb984): a click on an answer tile's × closed it, and the edit beside it stayed its old size
// over blank rows until the next key (7 s at 44×30, 2 s at 177). The frame after the release draws the new layout, every
// time: a real pane, SGR press and release on the ×, ten closes at each size. A scratch service and a private tmux
// socket, never a real outline or door; made-up notes and a made-up agent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOUBLE_MS } from "../src/scroll";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

/** How long after the release the new layout must be on screen: a frame, plus tmux's own round trip. */
const PAINTED_MS = 400;

describe.skipIf(!outliner || !Bun.which("tmux"))("a × click repaints the room at once (PIE-1769)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, panes = 0;
  const log = () => join(scratch.root, "tally.log");
  const asked = () => (existsSync(log()) ? readFileSync(log(), "utf8").split("\n").filter(Boolean) : []);
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    const dir = join(scratch.workspace, "extensions", "tally");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({ contract: 2, id: "tally", version: 1, name: "Tally", run: ["bun", "run.ts"], agents: [{ name: "tally" }] }));
    writeFileSync(join(dir, "run.ts"), `
      import { appendFileSync } from "node:fs";
      const request = await Bun.stdin.json();
      appendFileSync(${JSON.stringify(log())}, request.input.request + "\\n");
      process.stdout.write(JSON.stringify({ ok: true, value: { reply: "counted: " + request.input.request } }));
    `);
    for (const end = Date.now() + 15_000; !(await board.request("extensions.list", { reload: true }))?.extensions.some(e => e.id === "tally" && e.state === "active"); await Bun.sleep(100)) if (Date.now() > end) throw new Error("tally never loaded");
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  // Motion on, as Evan's door has it (the test run turns it off): the lost frame was a close's motion settled by its release.
  async function pane(id: string, title: string, cols: number, rows: number) {
    const n = `pane${++panes}`, socket = join(scratch.root, `${n}.sock`);
    const env = { ...process.env, ...scratch.env, EP0CH_STATE: join(scratch.root, `${n}-state`), EP0CH_CONTROL: join(scratch.root, `${n}.ctl`), EP0CH_DAEMON: "0", EP0CH_DAILY_AGENT: "sh", EP0CH_MOTION: "full" };
    mkdirSync(env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    const tmux = (...args: string[]) => {
      const r = Bun.spawnSync(["tmux", "-S", socket, ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString();
    };
    tmux("new-session", "-d", "-s", "door", "-x", String(cols), "-y", String(rows), "bun", join(import.meta.dir, "../src/main.ts"), "--ws", "scratch", "--screen", "detail", id);
    const capture = () => tmux("capture-pane", "-p", "-t", "door");
    await until(() => capture().includes(title), "the pane's reader", 15_000).catch(e => { tmux("kill-session", "-t", "door"); throw e; });
    return {
      capture,
      keys: (...keys: string[]) => { tmux("send-keys", "-t", "door", ...keys); },
      type: (text: string) => { tmux("send-keys", "-t", "door", "-l", text); },
      close: () => { tmux("kill-session", "-t", "door"); },
    };
  }

  /** The answer tile's × (its single-line frame's `x┐`), 1-based for SGR; null when no such tile is drawn. */
  const closeAt = (frame: string): { col: number; row: number } | null => {
    const lines = frame.split("\n");
    for (let row = 0; row < lines.length; row++) {
      const cells = [...lines[row]!];
      for (let col = 1; col < cells.length; col++) if (cells[col] === "┐" && cells[col - 1] === "x" && cells.slice(0, col).includes("┌")) return { col, row: row + 1 };
    }
    return null;
  };

  // The edit fills the room: no single-line frame is left, and its own frame reaches the room's far edge.
  const fills = (frame: string, cols: number, rows: number) => {
    const lines = frame.split("\n");
    if (frame.includes("┌") || frame.includes("└")) return false;
    const top = lines.findIndex(l => l.includes("╔")), bottom = lines.findIndex(l => l.includes("╚"));
    return top >= 0 && bottom >= rows - 4 && [...lines[top]!].lastIndexOf("╗") >= cols - 2;
  };

  /** The ask row's `show ▸` in the edit, 1-based for SGR. */
  const showAt = (frame: string): { col: number; row: number } | null => {
    const lines = frame.split("\n");
    for (let row = 0; row < lines.length; row++) {
      const col = [...lines[row]!].join("").indexOf("show ▸");
      if (col >= 0) return { col: [...lines[row]!.slice(0, col)].length + 1, row: row + 1 };
    }
    return null;
  };

  for (const [cols, rows] of [[44, 30], [177, 40]] as const) test(`${cols}×${rows}: ten × clicks on the answer tile, each painted at once`, async () => {
    const title = `Bean rows ${cols}`;
    const id = (await board.request("create", { parentId: null, text: `${title}\nstake the runners`, author: "user" })).id as string;
    const p = await pane(id, title, cols, rows);
    const click = (at: { col: number; row: number }) => { p.type(`\x1b[<0;${at.col};${at.row}M`); p.type(`\x1b[<0;${at.col};${at.row}m`); };
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-End", "Enter");
      const before = asked().length;
      p.type(`@tally the stakes ${cols}`);
      p.keys("Enter");
      await until(() => asked().length > before, "the ask sent", 10_000);
      const late: string[] = [];
      let shown = 0;
      for (let i = 0; i < 10; i++) {
        let x: { col: number; row: number } | null = null;
        await until(() => !!(x = closeAt(p.capture())) && p.capture().includes(`counted: the stakes ${cols}`), "the answer tile and its ×", 15_000).catch(e => { throw new Error(`close ${i + 1}: ${e.message}\n${p.capture()}`); });
        const at = x!;
        // The pointer comes to the × as a real terminal reports it (hover: the door asks for any-event tracking), then
        // presses and lets go. The release lands while the close is still drawing its way (the motion, as Evan has it).
        for (const d of [3, 2, 1]) p.type(`\x1b[<35;${at.col - d};${at.row + 1}M`);
        p.type(`\x1b[<35;${at.col};${at.row}M`);
        click(at);
        let frame = "";
        await until(() => fills(frame = p.capture(), cols, rows), "the room filled", PAINTED_MS).catch(() => { late.push(`close ${i + 1}: not painted within ${PAINTED_MS} ms\n${frame}`); });
        // Late, the room waits for the next input to be drawn (as it did for Evan): a wheel at the edit's top brings it.
        if (!fills(frame, cols, rows)) { p.type(`\x1b[<64;4;6M`); await until(() => fills(p.capture(), cols, rows), "the room filled at last", 5000); }
        // The answer back beside or below, by its row's `show ▸`: a click of its own, not the second of a double click
        // on that row (the last was moments ago).
        let s: { col: number; row: number } | null = null;
        await until(() => !!(s = showAt(p.capture())), "the row's show ▸");
        await Bun.sleep(Math.max(0, shown + DOUBLE_MS + 50 - Date.now()));
        click(s!); shown = Date.now();
      }
      expect(late).toEqual([]);
    } finally { p.close(); }
  }, 60_000);
});
