// PIE-1743, as Evan works, in a real pane by real keys: an ask being typed waits for him (a pause mid-word sends
// nothing; leaving the line sends it, as finally written), and an ask he backspaces away, saves and types back is
// answered again, its line never saying the old answer. A scratch service and a private tmux socket, never a real
// outline or door; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until, untilAsync } from "./scratch";

describe.skipIf(!outliner || !Bun.which("tmux"))("an ask waits for the person, and a retyped ask is asked again (PIE-1743)", () => {
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
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "user" })).id as string;

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
      flat: () => capture().replace(/\s+/g, ""),
      close: () => { tmux("kill-session", "-t", "door"); },
    };
  }

  for (const [cols, rows] of [[44, 16], [177, 30]] as const) test(`at ${cols}×${rows}: a pause mid-ask sends nothing; leaving the line sends the words as written`, async () => {
    const title = `Beds${cols}`;
    const id = await create(`${title}\nturn the soil`);
    const p = await pane(id, title, cols, rows);
    const before = asked().length;
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-End", "Enter");
      p.type(`@tally the be${cols}`);
      // Well past the door's touch (1 s) and the service's quiet (1.5 s): nothing sent, and the line says when it will be.
      await Bun.sleep(4000);
      expect(asked().length).toBe(before);
      expect(p.flat()).toContain("asksonceyouleave");
      p.type("ds");
      await Bun.sleep(2500);
      expect(asked().length).toBe(before);
      // Off the line: sent, as finally written.
      p.keys("Enter");
      p.type("and the peas");
      await until(() => asked().length > before, "the ask sent once the line was left", 10_000);
      expect(asked().slice(before)).toEqual([`the be${cols}ds`]);
      await until(() => p.flat().includes(`@tallythebe${cols}ds·`) && !p.flat().includes("asksonceyouleave"), "its line saying how it went", 10_000);
    } finally { p.close(); }
  }, 45_000);

  test("a click on another line leaves the ask's line: it is sent", async () => {
    const title = "Cold frame";
    const id = await create(`${title}\nprop the lid open`);
    const p = await pane(id, title, 44, 16);
    const before = asked().length;
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-End", "Enter");
      p.type("@tally the seed trays");
      await until(() => p.flat().includes("asksonceyouleave"), "the ask waiting for the person", 8000);
      expect(asked().length).toBe(before);
      // A click on the line above (SGR, 1-based column and row).
      const rows = p.capture().split("\n"), row = rows.findIndex(l => l.includes("prop the lid open")), col = rows[row]!.indexOf("prop") + 2;
      p.type(`\x1b[<0;${col};${row + 1}M`); p.type(`\x1b[<0;${col};${row + 1}m`);
      await until(() => asked().length > before, "the ask sent once the click left its line", 10_000);
      expect(asked().slice(before)).toEqual(["the seed trays"]);
    } finally { p.close(); }
  }, 45_000);

  test("an ask backspaced away and saved, then typed back, is answered again; its line never says the old answer", async () => {
    const title = "Shed";
    const ask = "@tally the pots";
    const id = await create(`${title}\nclear the bench\n${ask}`);
    await untilAsync(async () => (await board.get(id))!.text.includes("@tally answered"), "the first answer", 15_000);
    const first = asked().filter(a => a === "the pots").length;
    expect(first).toBe(1);
    const p = await pane(id, title, 44, 16);
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      // Onto the ask's end, backspace it whole, save: the answer goes with it.
      p.keys("C-Home", "Down", "Down", "End");
      for (let i = 0; i < ask.length; i++) p.keys("BSpace");
      p.keys("C-s");
      await untilAsync(async () => !(await board.get(id))!.text.includes("@tally answered"), "the answer taken out with its ask", 10_000);
      // The save closed the edit. Opened again, typed back where it was, then off the line.
      await until(() => !p.capture().includes("editing"), "the edit closed by the save", 5000);
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit again");
      p.keys("C-End");
      p.type(ask);
      p.keys("Enter");
      await until(() => asked().filter(a => a === "the pots").length === 2, "asked again", 10_000);
      await until(() => p.capture().includes("· answer in the"), "its line's new status", 10_000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(p.flat()).not.toContain("minago");
    } finally { p.close(); }
  }, 45_000);
});
