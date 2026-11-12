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
      // Longer than the edit is wide, at either size: it wraps (PIE-1757).
      const rest = `ds ${"by the east fence ".repeat(Math.ceil(cols / 17))}${cols}`;
      p.type(rest);
      await Bun.sleep(2500);
      expect(asked().length).toBe(before);
      // Off the line by one ↑ up its wrap (PIE-1757: the cursor stays on the line, a row up, and that is leaving it): sent,
      // as finally written.
      p.keys("Up");
      await until(() => asked().length > before, "the ask sent by one ↑", 10_000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(asked().slice(before)).toEqual([`the be${cols}${rest}`]);
      await until(() => !p.flat().includes("asksonceyouleave"), "its line saying how it went", 10_000);
      // Typed on again, it is another ask, waiting for the person again.
      p.keys("End");
      p.type(" too");
      await until(() => p.flat().includes("asksonceyouleave"), "the retyped ask waiting again", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(asked().length).toBe(before + 1);
    } finally { p.close(); }
  }, 45_000);

  // loki on #1445: the answer tile beside the line says what the line says while an answered ask is being retyped, never
  // "its ask is gone" beside a line that says it will ask.
  test("one character typed on an answered ask: the line and the answer tile beside it both say it asks once you leave", async () => {
    const title = "Potting";
    const ask = "@tally the trays";
    const id = await create(`${title}\n${ask}`);
    await untilAsync(async () => (await board.get(id))!.text.includes("@tally answered"), "the first answer", 15_000);
    const p = await pane(id, title, 44, 30);
    /** The answer tile's words: each row's part between the tile's side borders. */
    const tile = () => p.capture().split("\n").map(l => l.split("│")[1] ?? "").join(" ").replace(/\s+/g, " ");
    /** The edit's words, the same way: between its side borders. */
    const edit = () => p.capture().split("\n").map(l => l.split("║")[1] ?? "").join(" ").replace(/\s+/g, " ");
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-Home", "Down", "End");
      await until(() => tile().includes("counted: the trays"), "the answer tile beside the ask", 10_000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      p.type(" n");
      await until(() => edit().includes("asks once you leave the line or save"), "the line saying it waits", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      await until(() => tile().includes("asks once you leave the line or save"), "the answer tile saying the same", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(tile()).not.toContain("gone");
    } finally { p.close(); }
  }, 45_000);

  // Codex on #1445: the edit closed and opened again beside the same answer tile; typed on, the tile still follows.
  test("a reopened edit: words typed on an answered ask, and the tile beside it still says what the line says", async () => {
    const title = "Seed tin";
    const id = await create(`${title}\n@tally the packets`);
    await untilAsync(async () => (await board.get(id))!.text.includes("@tally answered"), "the first answer", 15_000);
    const p = await pane(id, title, 44, 30);
    const tile = () => p.capture().split("\n").map(l => l.split("│")[1] ?? "").join(" ").replace(/\s+/g, " ");
    const edit = () => p.capture().split("\n").map(l => l.split("║")[1] ?? "").join(" ").replace(/\s+/g, " ");
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-Home", "Down", "End");
      await until(() => tile().includes("counted: the packets"), "the answer tile beside the ask", 10_000);
      p.keys("Escape");
      await until(() => !p.capture().includes("» editing"), "the edit closed", 5000);
      p.keys("e");
      await until(() => p.capture().includes("» editing"), "the edit again", 5000);
      // It opens where the edit was left, on the ask: no move onto it selects it.
      p.keys("End");
      p.type(" please");
      await until(() => edit().includes("asks once you leave the line or save"), "the line saying it waits", 8000);
      await until(() => tile().includes("asks once you leave the line or save"), "the answer tile saying the same", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      // PIE-1757: put aside (esc, esc), the saved note still has the ask as it was, answered: the tile says that answer,
      // never "its ask is gone"; opened again, it says what the line says.
      p.keys("Escape"); p.keys("Escape");
      await until(() => !p.capture().includes("» editing"), "the edit put aside", 5000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      await until(() => tile().includes("counted: the packets"), "the tile saying the saved ask's answer", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(tile()).not.toContain("gone");
      // e opens it, or arms first and a second e opens it.
      p.keys("e");
      await until(() => p.capture().includes("» editing") || p.capture().includes("opens it"), "the edit back, or armed", 8000);
      if (!p.capture().includes("» editing")) p.keys("e");
      await until(() => edit().includes("@tally the packets please"), "the edit back with its words", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      await until(() => !tile().includes("gone") && tile().includes("counted: the packets"), "the tile saying what the line says (answered)", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
    } finally { p.close(); }
  }, 45_000);

  // In a 44×16 pane, below would leave the edit two rows of text: the answer opens as a tab behind it (PIE-1757), the edit
  // whole, its row saying so, and the person types on; ^W ] shows the answer, ^W [ the edit again, the cursor where it was.
  // The tests that read the answer tile's words run at 44×30, where it opens below (the sketch on PIE-1757).
  test("a click on another line leaves the ask's line: it is sent; in a 44×16 pane its answer is a tab behind the edit", async () => {
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
      const words = () => p.capture().split("\n").map(l => l.split("║")[1] ?? "").join(" ").replace(/\s+/g, " ");
      await until(() => /editing · 1 Cold frame 2 @t/.test(p.capture()) && words().includes("· in a tab"), "the answer a tab behind the edit, its row saying so", 15_000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      expect(p.capture()).not.toContain("┌");
      expect(words()).not.toContain("beside ▸");
      // Typed after it opened: the words land in the edit.
      p.keys("End");
      p.type(" and vent it");
      await until(() => words().includes("prop the lid open and vent it"), "typing on in the edit", 5000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      p.keys("C-w"); p.keys("]");
      await until(() => p.capture().includes("counted: the seed trays"), "the answer, its tab shown", 5000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      p.keys("C-w"); p.keys("[");
      await until(() => p.capture().includes("» editing"), "the edit shown again", 5000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      p.type("!");
      await until(() => words().includes("prop the lid open and vent it!"), "the cursor where it was", 5000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
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
