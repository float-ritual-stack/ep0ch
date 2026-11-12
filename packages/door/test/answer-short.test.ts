// PIE-1757 (the walk on main 83245f03): Evan's desk tiles are 9 to 13 rows tall. In a 44-column door that short, the
// answer tile beside an edit used to split it (right at 24 columns, the ask wrapping); it opens as a tab behind the edit,
// which stays whole. Door sizes, not layout areas: the door's own hint and status rows take their share. A scratch
// service and a private tmux socket, never a real outline or door; made-up notes and a made-up agent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner || !Bun.which("tmux"))("an answer beside a short 44-column edit is a tab behind it (PIE-1757)", () => {
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

  /** The door in a tmux pane of `cols`×`rows` on the note's detail screen. */
  async function pane(id: string, title: string, cols: number, rows: number) {
    const n = `pane${++panes}`, socket = join(scratch.root, `${n}.sock`);
    const env = { ...process.env, ...scratch.env, EP0CH_STATE: join(scratch.root, `${n}-state`), EP0CH_CONTROL: join(scratch.root, `${n}.ctl`), EP0CH_DAEMON: "0", EP0CH_DAILY_AGENT: "sh" };
    mkdirSync(env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    const tmux = (...args: string[]) => {
      const r = Bun.spawnSync(["tmux", "-S", socket, ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString();
    };
    tmux("new-session", "-d", "-s", "door", "-x", String(cols), "-y", String(rows), "bun", join(import.meta.dir, "../src/main.ts"), "--ws", "scratch", "--screen", "detail", id);
    const capture = () => tmux("capture-pane", "-p", "-t", "door");
    await until(() => capture().includes(title), "the pane's reader", 15_000);
    return {
      capture,
      keys: (...keys: string[]) => { tmux("send-keys", "-t", "door", ...keys); },
      type: (text: string) => { tmux("send-keys", "-t", "door", "-l", text); },
      close: () => { tmux("kill-session", "-t", "door"); },
    };
  }

  // 44×7 through 44×10 split the edit before (the walk's seam); 44×12, the walk's own door, too.
  for (const rows of [7, 8, 9, 10, 12]) test(`a 44×${rows} door: the answer opens as a tab behind the edit, never beside or under it`, async () => {
    const title = `Shed${rows}`;
    const id = (await board.request("create", { parentId: null, text: `${title}\noil the shears`, author: "user" })).id as string;
    const p = await pane(id, title, 44, rows);
    const before = asked().length;
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-End", "Enter");
      p.type("@tally the shears");
      p.keys("Enter");
      await until(() => asked().length > before, "the ask sent", 10_000);
      // The answer's tab in the edit's frame, and no answer tile drawn beside or under it: the edit keeps 44 columns.
      await until(() => /editing · 1 Shed\d+ 2 @t/.test(p.capture()), "the answer, a tab behind the edit", 15_000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      const frame = p.capture();
      expect([rows, frame.includes("┌"), frame.split("\n").filter(l => l.includes("╗")).length]).toEqual([rows, false, 1]);
      expect([rows, frame.split("\n")[0]!.indexOf("╗")]).toEqual([rows, 43]);
    } finally { p.close(); }
  }, 30_000);
});
