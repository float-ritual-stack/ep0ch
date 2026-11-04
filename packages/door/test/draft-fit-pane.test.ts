// A draft in a real pane by real keys (PIE-1560): a note that fits shows all of it at the sizes Evan's tiles have, rich
// edit says when the note changed elsewhere and that a save was refused, and text with no table left lands on a line of
// its own. A scratch service and a private tmux socket, never a real outline or door; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SocketBoard, USER } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner || !Bun.which("tmux"))("a draft in a real pane", () => {
  const scratch = new Scratch();
  let board: SocketBoard, panes = 0;
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
  });
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
  /** The word on a row of the text, not in the frame's `editing · <title>`. */
  const onARow = (frame: string, word: string) => new RegExp(`(?<!· ?)\\b${word}\\b`).test(frame);

  test("a seven-line note in a 44×16 pane keeps its first line, cursor on the last, typed or not", async () => {
    const id = await create("Tansy\none\ntwo\nthree\nfour\nfive\nsix");
    const p = await pane(id, "Tansy", 44, 16);
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      for (let i = 0; i < 6; i++) p.keys("Down");
      p.keys("End");
      p.type(" more");
      await until(() => p.capture().includes("more"), "the typed words");
      const frame = p.capture();
      expect(frame).toContain("six");
      expect(onARow(frame, "Tansy"), frame).toBe(true);
    } finally { p.close(); }
  }, 30_000);

  test("the answer tile narrows the box in a 44×16 pane: the note that still fits keeps its first line", async () => {
    const dir = join(scratch.workspace, "extensions", "gardener"), gate = join(scratch.root, "answer-finish");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({ contract: 2, id: "gardener", version: 1, name: "Gardener", run: ["bun", "run.ts"], agents: [{ name: "gardener", effects: "write" }] }));
    writeFileSync(join(dir, "run.ts"), `
      import { existsSync } from "node:fs";
      await Bun.stdin.text();
      console.log(JSON.stringify({ reply: "Sow the peas." }));
      while (!existsSync(${JSON.stringify(gate)})) await Bun.sleep(20);
      console.log(JSON.stringify({ ok: true, value: {} }));
    `);
    for (const end = Date.now() + 15_000; !(await board.request("extensions.list", { reload: true }))?.extensions.some(e => e.id === "gardener" && e.state === "active"); await Bun.sleep(100)) if (Date.now() > end) throw new Error("the gardener never loaded");
    const id = await create("Marigold");
    const p = await pane(id, "Marigold", 44, 16);
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("End", "Enter", "Enter");
      p.type("@gardener plan the beds");
      p.keys("Enter");
      p.type("Keep typing here");
      await until(() => p.capture().includes("Keep typing"), "the typed line");
      await until(() => p.flat().includes("Sowthe"), "the answer tile", 15_000);
      await Bun.sleep(300);
      const frame = p.capture();
      expect(onARow(frame, "Marigold"), frame).toBe(true);
    } finally { writeFileSync(gate, "finish"); p.close(); }
  }, 45_000);

  test.each([[80, 24], [44, 16]])("rich edit at %d×%d says the note changed and the save was refused; text with no table left is a line of its own", async (cols, rows) => {
    const title = `Elm${cols}`;
    const id = await create(`${title}\n\n| crop | bed |\n| --- | --- |\n| one | leeks |`);
    const p = await pane(id, title, cols, rows);
    const change = async (text: string) => { await board.update(id, text, (await board.get(id))!.revision!, USER); };
    try {
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit");
      p.keys("C-o");
      await until(() => p.capture().includes("[raw ^O]"), "rich edit");
      p.keys("Tab", "Tab", "Tab");
      p.type("radishes ");
      await until(() => p.capture().includes("radishes"), "the typed cell");
      // Changed elsewhere, and no key: the line says so as raw edit does.
      await change(`${title} today\n\n| crop | bed |\n| --- | --- |\n| one | leeks |`);
      await until(() => p.flat().includes("changedelsewhere"), "rich edit saying it changed", 5000);
      p.keys("C-s");
      await until(() => p.flat().includes("notsaved"), "rich edit saying the save was refused", 5000);
      expect(p.flat()).toContain("changedelsewhere");
      // The table goes, with prose last: a line of its own, and that's what a save writes.
      await change(`${title}\n\nNo table now.`);
      p.keys("C-r");
      await until(() => p.flat().includes("Notablenow."), "the reloaded note", 5000);
      expect(p.flat()).not.toContain("notsaved");
      p.type("ab");
      await until(() => p.capture().split("\n").some(l => /^\W*ab\W*$/.test(l)), "the typed text on a row of its own", 5000);
      expect(p.capture()).not.toContain("now.ab");
      p.keys("C-s");
      const end = Date.now() + 5000;
      while ((await board.get(id))!.text.endsWith("No table now.") && Date.now() < end) await Bun.sleep(50);
      expect((await board.get(id))!.text).toBe(`${title}\n\nNo table now.\nab`);
    } finally { p.close(); }
  }, 45_000);
});
