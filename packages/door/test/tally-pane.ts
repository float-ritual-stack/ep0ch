// A door in a real tmux pane over a scratch service with a made-up agent, `tally`, that answers every ask with
// "counted: <the ask>": what the answer-tile walks drive (PIE-1769, PIE-1771). Motion is on, as Evan's door has it (the
// test run turns it off). A private tmux socket, never a real outline or door; made-up notes only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask } from "../src/jsonl";
import { SocketBoard } from "../src/socket";
import { parseActArgs } from "../src/surface/actions";
import { expect } from "bun:test";
import { Scratch, until, untilAsync } from "./scratch";

export type Pane = Awaited<ReturnType<TallyDoors["pane"]>>;

/** How long a tally pane's person must be away before an agent's act may move what they see (EP0CH_SHELL_IDLE_MS; a person's is 2 s). */
export const IDLE_MS = 300;
/** Wait until the person's keys count as idle, so an agent's act may lay the desk out. */
export const idle = () => Bun.sleep(IDLE_MS + 200);

export class TallyDoors {
  readonly scratch = new Scratch();
  board!: SocketBoard;
  private panes = 0;
  private log = () => join(this.scratch.root, "tally.log");
  /** The asks tally has been sent, oldest first. */
  asked = () => (existsSync(this.log()) ? readFileSync(this.log(), "utf8").split("\n").filter(Boolean) : []);

  async start() {
    // A person's pause before an ask goes (the door's touch, 1 s; the service's quiet, 1.5 s), a fifth as long: the same
    // rules, waited out sooner, so the files on these panes stay inside their budget (PIE-1788). A file's own hostEnv wins.
    this.scratch.hostEnv = { OUTLINER_AGENT_QUIET_MS: "300", ...this.scratch.hostEnv };
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

  /**
   * The door in a tmux pane of `cols`×`rows` on note `id`'s detail screen, once `title` is drawn. `o.state` names a state
   * folder to share with an earlier pane (the same desk.json, as a deploy hands it over); `o.screen` opens another screen.
   */
  async pane(id: string, title: string, cols: number, rows: number, o: { state?: string; screen?: string[] } = {}) {
    const n = `pane${++this.panes}`, socket = join(this.scratch.root, `${n}.sock`);
    const env = { ...process.env, ...this.scratch.env, EP0CH_STATE: join(this.scratch.root, `${o.state ?? n}-state`), EP0CH_CONTROL: join(this.scratch.root, `${n}.ctl`), EP0CH_DAEMON: "0", EP0CH_DRAFT_TOUCH_MS: "200", EP0CH_SHELL_IDLE_MS: String(IDLE_MS), EP0CH_DAILY_AGENT: "sh", EP0CH_MOTION: "full" };
    mkdirSync(env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    const tmux = (...args: string[]) => {
      const r = Bun.spawnSync(["tmux", "-S", socket, ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString();
    };
    tmux("new-session", "-d", "-s", "door", "-x", String(cols), "-y", String(rows), "bun", join(import.meta.dir, "../src/main.ts"), "--ws", "scratch", ...(o.screen ?? ["--screen", "detail", id]));
    tmux("set-option", "-t", "door", "remain-on-exit", "on");
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
      /**
       * An agent's read of this door (`walker`; layout.get, view.get): the request `ep0ch act` sends, asked over the
       * pane's control socket from this process, so a poll costs a round trip and not a `bun` start (PIE-1804: a walk's
       * dozens of layout.get polls were most of its time). What the agent does to the door stays `act`, the CLI.
       */
      read: async (...args: string[]) => {
        const r = await ask(env.EP0CH_CONTROL, { cmd: "act", ...(await parseActArgs(args)), as: "walker" }, 10_000);
        if (!r?.ok) throw new Error(r?.error ?? `no door answered at ${env.EP0CH_CONTROL}`);
        return r.result;
      },
      /** Every byte the door writes from now, appended to `file` (tmux pipe-pane): a frame shorter than a capture's poll shows there. */
      record: (file: string) => { tmux("pipe-pane", "-t", "door", "-o", `cat >> ${JSON.stringify(file)}`); },
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

/** A tile and a layer as layout.get has them. */
export type Tile = { tile: string; name: string; kind: string; focused: boolean; rect?: { cols: number }; showing?: { title: string } };
export type Layer = { drawer: boolean; screen: string; tiles: Tile[] };
/** The door's layers now, read in this process (`Pane.read`): what a walk polls. */
export const layersOf = async (p: Pane) => (await p.read("layout.get")).layers as Layer[];
/** `widths`, read in this process: what a walk polls. */
export const widthsNow = async (p: Pane, drawer = false) => ((await layersOf(p)).find(l => l.drawer === drawer)?.tiles ?? []).map(t => `${t.name} ${t.rect?.cols}`);
/** Each tile on the screen with its width, as layout.get has them (`drawer`: the drawer's layer instead), through the CLI. */
export const widths = (p: Pane, drawer = false) => ((JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: { name: string; rect?: { cols: number } }[] }[]).find(l => l.drawer === drawer)?.tiles ?? []).map(t => `${t.name} ${t.rect?.cols}`);
/** Tile `name`'s width on the screen (0 when it isn't there). */
export const cols = (p: Pane, name: string) => Number(widths(p).find(w => w.startsWith(`${name} `))?.split(" ")[1] ?? 0);

/**
 * Evan's desk, made up (PIE-1771): an edit with its answer beside, two notes, four tiles of 44 columns in 177; the keys
 * in the edit.
 */
export async function beanDesk(doors: TallyDoors) {
  const marrow = await doors.create("Marrow bed\nnet it"), runner = await doors.create("Runner beans\ntie them in");
  const p = await doors.pane(await doors.create("Bean rows\nstake the runners"), "Bean rows", 177, 40);
  p.keys("e");
  await until(() => p.capture().includes("editing"), "the edit");
  await doors.ask(p, "@tally the stakes");
  // Opened while he types, they land beside.
  for (const [n, note] of [[3, marrow], [4, runner]] as const) { expect(p.act("open", `id=${note}`).ok).toBe(true); await untilAsync(async () => (await widthsNow(p)).length === n, `tile ${n} open`, 5000); }
  // Saved, so an agent may lay the desk out (it never resizes the tile the person types in); with no room for four at
  // 177 some folded to spines, opened again here. Then back into the edit.
  p.keys("C-s");
  await until(() => !p.capture().includes("editing"), "saved");
  const quarter = () => { for (const a of [["layout.even"], ["layout.resize", "split=s1", "border=0", "share=0.25"]]) expect([a.join(" "), p.act(...a).ok]).toEqual([a.join(" "), true]); };
  quarter();
  for (const w of await widthsNow(p)) if (Number(w.split(" ")[1]) < 10) expect(p.act("tile.expand", `tile=${w.split(" ")[0]}`).ok).toBe(true);
  quarter();
  await untilAsync(async () => (await widthsNow(p)).join() === "detail 44,answer 44,detail2 44,detail3 45", "the 44/44/44/45 desk", 5000).catch(async e => { throw new Error(`${e.message}: ${(await widthsNow(p)).join()}`); });
  p.keys("e");
  await until(() => p.capture().includes("editing"), "the edit again");
  return p;
}
/** ^W space on the edit, a shift-click on the answer's title, ^W G: the person's gather of the edit and its answer. */
export async function gather(p: Pane) {
  p.keys("C-w", " ");
  await until(() => p.capture().includes("gathering"), "the edit picked");
  p.click({ col: 52, row: 1 }, 4);
  await Bun.sleep(200);
  p.keys("C-w", "G");
  await until(() => widths(p)[0]?.startsWith("group ") ?? false, "the group", 5000);
}
