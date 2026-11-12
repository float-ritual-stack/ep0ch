// A door in a real tmux pane over a scratch service with a made-up agent, `tally`, that answers every ask with
// "counted: <the ask>": what the answer-tile walks drive (PIE-1769, PIE-1771). Motion is on, as Evan's door has it (the
// test run turns it off). A private tmux socket, never a real outline or door; made-up notes only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { Scratch, until } from "./scratch";

export type Pane = Awaited<ReturnType<TallyDoors["pane"]>>;

export class TallyDoors {
  readonly scratch = new Scratch();
  board!: SocketBoard;
  private panes = 0;
  private log = () => join(this.scratch.root, "tally.log");
  /** The asks tally has been sent, oldest first. */
  asked = () => (existsSync(this.log()) ? readFileSync(this.log(), "utf8").split("\n").filter(Boolean) : []);

  async start() {
    this.board = new SocketBoard(await this.scratch.start());
    await this.board.info();
    const dir = join(this.scratch.workspace, "extensions", "tally");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({ contract: 2, id: "tally", version: 1, name: "Tally", run: ["bun", "run.ts"], agents: [{ name: "tally" }] }));
    writeFileSync(join(dir, "run.ts"), `
      import { appendFileSync } from "node:fs";
      const request = await Bun.stdin.json();
      appendFileSync(${JSON.stringify(this.log())}, request.input.request + "\\n");
      process.stdout.write(JSON.stringify({ ok: true, value: { reply: "counted: " + request.input.request } }));
    `);
    for (const end = Date.now() + 15_000; !(await this.board.request("extensions.list", { reload: true }))?.extensions.some(e => e.id === "tally" && e.state === "active"); await Bun.sleep(100)) if (Date.now() > end) throw new Error("tally never loaded");
  }
  async stop() { this.board?.close(); await this.scratch.dispose(); }
  async create(text: string) { return (await this.board.request("create", { parentId: null, text, author: "user" })).id as string; }

  /** The door in a tmux pane of `cols`×`rows` on note `id`'s detail screen, once `title` is drawn. */
  async pane(id: string, title: string, cols: number, rows: number) {
    const n = `pane${++this.panes}`, socket = join(this.scratch.root, `${n}.sock`);
    const env = { ...process.env, ...this.scratch.env, EP0CH_STATE: join(this.scratch.root, `${n}-state`), EP0CH_CONTROL: join(this.scratch.root, `${n}.ctl`), EP0CH_DAEMON: "0", EP0CH_DAILY_AGENT: "sh", EP0CH_MOTION: "full" };
    mkdirSync(env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    const tmux = (...args: string[]) => {
      const r = Bun.spawnSync(["tmux", "-S", socket, ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString();
    };
    tmux("new-session", "-d", "-s", "door", "-x", String(cols), "-y", String(rows), "bun", join(import.meta.dir, "../src/main.ts"), "--ws", "scratch", "--screen", "detail", id);
    const capture = () => tmux("capture-pane", "-p", "-t", "door");
    await until(() => capture().includes(title), "the pane's reader", 15_000).catch(e => { tmux("kill-session", "-t", "door"); throw e; });
    const type = (text: string) => { tmux("send-keys", "-t", "door", "-l", text); };
    return {
      capture,
      keys: (...keys: string[]) => { tmux("send-keys", "-t", "door", ...keys); },
      type,
      /** A press and release at a cell, 1-based, as a terminal reports it (SGR); `mods` 4 is shift. */
      click: (at: { col: number; row: number }, mods = 0) => { type(`\x1b[<${mods};${at.col};${at.row}M`); type(`\x1b[<${mods};${at.col};${at.row}m`); },
      /** An agent's act on this door (`walker`): ok, and what it said. */
      act: (...args: string[]) => {
        const r = Bun.spawnSync(["bun", join(import.meta.dir, "../src/main.ts"), "act", ...args, "--as", "walker"], { env, stdout: "pipe", stderr: "pipe" });
        return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
      },
      close: () => { tmux("kill-session", "-t", "door"); },
    };
  }

  /** Type `ask` on a new line at the end of the edit in `p` and wait until tally has it and its answer is drawn. */
  async ask(p: Pane, ask: string) {
    const before = this.asked().length;
    p.keys("C-End", "Enter");
    p.type(ask);
    p.keys("Enter");
    await until(() => this.asked().length > before, "the ask sent", 10_000);
    await until(() => p.capture().includes(`counted: ${ask.replace(/^@tally /, "")}`), "its answer drawn", 15_000).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
  }
}

/** Where `text` is first drawn in `frame`, 1-based for SGR; null when it isn't. */
export function cellOf(frame: string, text: string): { col: number; row: number } | null {
  const lines = frame.split("\n");
  for (let row = 0; row < lines.length; row++) {
    const at = lines[row]!.indexOf(text);
    if (at >= 0) return { col: [...lines[row]!.slice(0, at)].length + 1, row: row + 1 };
  }
  return null;
}
