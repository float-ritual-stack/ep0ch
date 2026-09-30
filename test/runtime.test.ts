// The door as a process (PIE-488): every way it ends leaves the terminal usable, copies unsaved text and
// removes its own control socket; the socket is private; everything it writes lands under EP0CH_STATE; two
// doors on one state dir don't lose each other's marks; an offline service reads "offline". Each door here
// runs in its own pty against a scratch service, with HOME, XDG_*, TMPDIR, EP0CH_STATE and EP0CH_CONTROL all
// under a temp dir, so nothing reaches a real outline, a real door or the person's state.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const RESTORE = ["\x1b[?1049l", "\x1b[?1002l", "\x1b[?1006l", "\x1b[?2004l", "\x1b[?25h"];
/** The restore sequences `out` lacks (none: the terminal is back to normal). */
const missing = (out: string) => RESTORE.filter(s => !out.includes(s)).map(s => JSON.stringify(s));

let scratch: Scratch;
let board: SocketBoard;
let root: string;
let n = 0;

/** A fresh sandbox for one door: its own home, XDG dirs, temp dir, state and control socket. */
function sandbox(state?: string) {
  const dir = join(root, `door${++n}`);
  for (const d of ["home", "xs", "xc", "tmp"]) mkdirSync(join(dir, d), { recursive: true });
  const env: Record<string, string> = {
    PATH: process.env.PATH!, TERM: "xterm-256color", LANG: "C.UTF-8",
    HOME: join(dir, "home"), XDG_STATE_HOME: join(dir, "xs"), XDG_CACHE_HOME: join(dir, "xc"), TMPDIR: join(dir, "tmp"),
    EP0CH_STATE: state ?? join(dir, "state"), EP0CH_CONTROL: join(dir, "ctl", "door.sock"),
    EP0CH_OBSERVE: "0", EP0CH_KITTY: "0",
  };
  return { dir, env };
}

class Door {
  out = "";
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly pty: InstanceType<typeof Bun.Terminal>;
  code: number | null = null;
  constructor(readonly env: Record<string, string>, args: string[] = ["--desk"], preload?: string) {
    this.pty = new Bun.Terminal({ cols: 140, rows: 40, data: (_t, d) => { this.out += Buffer.from(d).toString("latin1"); } });
    this.proc = Bun.spawn(["bun", ...(preload ? ["--preload", preload] : []), MAIN, ...args, scratch.sock], { terminal: this.pty, env });
    void this.proc.exited.then(c => { this.code = c; });
  }
  get control() { return this.env.EP0CH_CONTROL!; }
  async up() { await until(() => existsSync(this.control) || this.code !== null, "the door's control socket", 20_000); expect(this.code).toBeNull(); }
  async cli(...args: string[]) {
    const p = Bun.spawn(["bun", MAIN, ...args], { env: this.env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  }
  async ended(ms = 15_000) { await until(() => this.code !== null, "the door to exit", ms); await Bun.sleep(300); return this.code!; }
  /** What was written after the door last entered the alternate screen. */
  get tail() { return this.out.slice(this.out.lastIndexOf("\x1b[?1049h")); }
  kill(sig: NodeJS.Signals | number) { process.kill(this.proc.pid, sig); }
}

const files = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir, { recursive: true }).map(String).sort();

beforeAll(async () => {
  if (!outliner) throw new Error("set EP0CH_OUTLINER to a pi-herdr-outliner checkout");
  scratch = new Scratch();
  await scratch.start();
  board = new SocketBoard(scratch.sock);
  await board.info();
  root = mkdtempSync(join(tmpdir(), "ep0ch-runtime-"));
});
afterAll(async () => { board?.close(); await scratch?.dispose(); rmSync(root, { recursive: true, force: true }); });

const note = async (text: string) => (await board.request<{ id: string }>("create", { parentId: null, text, author: "agent" })).id;

describe("every exit restores the terminal, copies drafts and removes the socket (F1)", () => {
  for (const sig of ["SIGINT", "SIGQUIT", "SIGTERM", "SIGHUP"] as const) {
    test(`${sig}`, async () => {
      const { env } = sandbox();
      const id = await note(`Lantern inventory ${sig}\nthree brass, one tin`);
      const door = new Door(env);
      await door.up();
      expect((await door.cli("open", id)).code).toBe(0);
      expect((await door.cli("act", "edit", "--as", "cartographer-1")).code).toBe(0);
      expect((await door.cli("act", "edit.text", "text=Lantern inventory\nfour brass, one tin", "--as", "cartographer-1")).code).toBe(0);
      door.kill(sig);
      await door.ended();
      expect(missing(door.tail)).toEqual([]);
      const drafts = files(join(env.EP0CH_STATE!, "drafts"));
      expect(drafts.length).toBe(1);
      expect(readFileSync(join(env.EP0CH_STATE!, "drafts", drafts[0]!), "utf8")).toContain("four brass, one tin");
      expect(door.tail.includes("unsaved text was copied to")).toBe(true);
      expect(existsSync(door.control)).toBe(false);
    }, 40_000);
  }

  test("an uncaught exception: the terminal comes back, the error is printed on the normal screen, exit 1", async () => {
    const { dir, env } = sandbox();
    const boom = join(dir, "boom.ts");
    writeFileSync(boom, `setTimeout(() => { throw new Error("a fictional fault in a timer"); }, 2500);\n`);
    const door = new Door(env, ["--desk"], boom);
    await door.up();
    const code = await door.ended();
    expect(code).toBe(1);
    const after = door.tail.slice(door.tail.indexOf("\x1b[?1049l"));
    expect(missing(door.tail)).toEqual([]);
    expect(after.includes("a fictional fault in a timer")).toBe(true);
    expect(existsSync(door.control)).toBe(false);
  }, 40_000);

  test("kill -9: the guard puts the terminal back", async () => {
    const { env } = sandbox();
    const door = new Door(env);
    await door.up();
    await Bun.sleep(300);
    const before = door.out.length;
    door.kill("SIGKILL");
    await door.ended();
    await until(() => door.out.slice(before).includes("\x1b[?1049l"), "the guard's restore", 5000);
    expect(missing(door.out.slice(before))).toEqual([]);
  }, 40_000);
});

describe("the control socket (F2, F3)", () => {
  test("stale door-<pid>.sock files from dead doors are swept; a live one is kept", async () => {
    const { dir, env } = sandbox();
    const ctl = join(dir, "ctl");
    mkdirSync(ctl, { recursive: true, mode: 0o700 });
    // A socket whose process died without removing it, as kill -9 leaves one.
    const dead = Bun.spawn(["bun", "-e", `require("node:net").createServer().listen(process.argv[1]); setInterval(() => {}, 1000)`, join(ctl, "door-0.sock")]);
    await until(() => existsSync(join(ctl, "door-0.sock")), "the fake socket");
    dead.kill("SIGKILL"); await dead.exited;
    const stale = join(ctl, `door-${dead.pid}.sock`);
    renameSync(join(ctl, "door-0.sock"), stale);
    const door = new Door(env);
    await door.up();
    expect(existsSync(stale)).toBe(false);
    const second = new Door({ ...env });
    await until(() => files(ctl).some(f => f === `door-${second.proc.pid}.sock`) || second.code !== null, "the second door's socket", 20_000);
    const third = new Door({ ...env });
    await until(() => files(ctl).some(f => f === `door-${third.proc.pid}.sock`) || third.code !== null, "the third door's socket", 20_000);
    expect(existsSync(join(ctl, `door-${second.proc.pid}.sock`))).toBe(true);
    for (const d of [door, second, third]) d.kill("SIGTERM");
    for (const d of [door, second, third]) await d.ended();
    expect(files(ctl)).toEqual([]);
  }, 60_000);

  test("the socket is 0600 in a 0700 dir; a dir anyone else can reach is refused", async () => {
    const { dir, env } = sandbox();
    const door = new Door(env);
    await door.up();
    expect(statSync(door.control).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "ctl")).mode & 0o777).toBe(0o700);
    door.kill("SIGTERM"); await door.ended();

    const open = join(dir, "open");
    mkdirSync(open); chmodSync(open, 0o775);
    const loose = new Door({ ...env, EP0CH_CONTROL: join(open, "door.sock") });
    await until(() => loose.out.includes("control socket") || loose.code !== null, "the refusal", 20_000);
    await Bun.sleep(1500);
    expect(existsSync(join(open, "door.sock"))).toBe(false);
    loose.kill("SIGTERM"); await loose.ended();
    expect(loose.out.includes(open)).toBe(true);
  }, 40_000);

  test("snap writes under the state dir; a path elsewhere is written by the command, never by the door", async () => {
    const { dir, env } = sandbox();
    const door = new Door(env);
    await door.up();
    const raw = (req: object) => new Promise<any>(res => {
      const c = connect(door.control, () => c.write(JSON.stringify(req) + "\n"));
      let buf = ""; c.on("data", d => { buf += d; if (buf.includes("\n")) { c.end(); res(JSON.parse(buf)); } });
    });
    const elsewhere = join(dir, "elsewhere", "a", "b.png");
    const r = await raw({ cmd: "snap", path: elsewhere });
    expect(r.ok).toBe(false);
    expect(existsSync(join(dir, "elsewhere"))).toBe(false);
    const inside = await raw({ cmd: "snap", path: "shots/one.png" });
    expect(inside.ok).toBe(true);
    expect(inside.result.path).toBe(join(env.EP0CH_STATE!, "shots", "one.png"));
    expect(existsSync(inside.result.path)).toBe(true);
    // The command line's own path: the command writes it, into a folder that must already exist.
    mkdirSync(join(dir, "mine"));
    const cli = await door.cli("snap", join(dir, "mine", "screen.png"));
    expect(cli.code).toBe(0);
    expect(existsSync(join(dir, "mine", "screen.png"))).toBe(true);
    const bad = await door.cli("snap", join(dir, "nowhere", "screen.png"));
    expect(bad.code).toBe(1);
    // A line that never ends is cut off, not buffered forever.
    const cut = await new Promise<boolean>(res => {
      const c = connect(door.control, () => { c.write("x".repeat(2 << 20)); });
      c.on("close", () => res(true)); c.on("error", () => res(true));
      setTimeout(() => { c.destroy(); res(false); }, 5000);
    });
    expect(cut).toBe(true);
    door.kill("SIGTERM"); await door.ended();
  }, 40_000);
});

describe("EP0CH_STATE moves everything the door writes (F4)", () => {
  test("lastcall.json, the socket and snaps land under EP0CH_STATE; nothing under HOME or XDG_*", async () => {
    const { dir, env } = sandbox();
    delete env.EP0CH_CONTROL;
    const door = new Door(env);
    await until(() => existsSync(join(env.EP0CH_STATE!, "door.sock")) || door.code !== null, "the default socket in the state dir", 20_000);
    expect((await door.cli("snap")).code).toBe(0);
    door.kill("SIGTERM"); await door.ended();
    expect(existsSync(join(env.EP0CH_STATE!, "lastcall.json"))).toBe(true);
    expect(existsSync(join(env.EP0CH_STATE!, "screen.png"))).toBe(true);
    // (bun keeps its own transpiler cache under XDG_CACHE_HOME/bun: that one is bun's, not the door's.)
    const door_ = (d: string) => files(join(dir, d)).filter(f => f.includes("ep0ch"));
    expect([...door_("xs"), ...door_("xc"), ...door_("home")]).toEqual([]);
  }, 40_000);
});

describe("a ctrl+e edit tile's file (F5)", () => {
  test("lives under the state dir, and a signal copies it to drafts/ and removes it", async () => {
    const { dir, env } = sandbox();
    const editor = join(dir, "fake-editor.sh");
    writeFileSync(editor, `#!/bin/sh\nprintf 'Signal lamp log\\nwritten in the tile\\n' > "$1"\nexec sleep 600\n`);
    chmodSync(editor, 0o755);
    const id = await note("Signal lamp log\nnot yet");
    const door = new Door({ ...env, EDITOR: editor, VISUAL: editor });
    await door.up();
    expect((await door.cli("open", id)).code).toBe(0);
    await Bun.sleep(500);
    door.pty.write("2");                                               // the person's keys: the reader,
    await Bun.sleep(300);
    door.pty.write("\x05");                                            // then ctrl+e
    const edits = join(env.EP0CH_STATE!, "edit");
    const written = (dir: string) => files(dir).some(f => f.endsWith(".md") && readFileSync(join(dir, f), "utf8").includes("written in the tile"));
    await until(() => written(edits) || written(join(dir, "tmp")), "the editor's write", 10_000);
    expect(written(edits)).toBe(true);
    door.kill("SIGTERM"); await door.ended();
    expect(files(join(dir, "tmp")).filter(f => f.startsWith("ep0ch-edit"))).toEqual([]);
    expect(files(edits)).toEqual([]);
    const drafts = files(join(env.EP0CH_STATE!, "drafts"));
    expect(drafts.some(f => readFileSync(join(env.EP0CH_STATE!, "drafts", f), "utf8").includes("written in the tile"))).toBe(true);
    expect(door.tail.includes("unsaved text was copied to")).toBe(true);
  }, 40_000);
});

describe("two doors on one state dir (F19)", () => {
  test("marks from both doors are kept, numbered apart, and the second door is warned", async () => {
    const shared = join(root, "shared-state");
    const a = new Door(sandbox(shared).env), b = new Door(sandbox(shared).env);
    await a.up(); await b.up();
    const id = await note("Harbour chart\nthe north pier");
    const mark = (d: Door, reason: string) => d.cli("act", "block.mark", `id=${id}`, `reason=${reason}`, "--as", "cartographer-2");
    expect((await mark(a, "tide-one")).code).toBe(0);
    expect((await mark(b, "tide-two")).code).toBe(0);
    expect((await mark(a, "tide-three")).code).toBe(0);
    const list = async (d: Door) => JSON.parse((await d.cli("act", "marks.list")).out) as { n: number; reason: string }[] | { marks: { n: number; reason: string }[] };
    for (const d of [a, b]) {
      const l = await list(d);
      const marks = Array.isArray(l) ? l : l.marks;
      expect(marks.map(m => m.reason).sort()).toEqual(["tide-one", "tide-three", "tide-two"]);
      expect(new Set(marks.map(m => m.n)).size).toBe(3);
    }
    const saved = JSON.parse(readFileSync(join(shared, "marks.json"), "utf8")) as { reason: string }[];
    expect(saved.map(m => m.reason).sort()).toEqual(["tide-one", "tide-three", "tide-two"]);
    const peek = await b.cli("peek");
    expect((peek.out + b.out).includes("another door")).toBe(true);
    for (const d of [a, b]) d.kill("SIGTERM");
    for (const d of [a, b]) await d.ended();
  }, 60_000);
});

describe("offline says offline (F24, C F17)", () => {
  test("open and edit while the service is down say offline, not 'no block' or a revision", async () => {
    const own = new Scratch();
    await own.start();
    const b2 = new SocketBoard(own.sock); await b2.info();
    const id = (await b2.request<{ id: string }>("create", { parentId: null, text: "Ferry timetable\nsummer", author: "agent" })).id;
    b2.close();
    const { env } = sandbox();
    const pty = new Bun.Terminal({ cols: 140, rows: 40, data: () => {} });
    const proc = Bun.spawn(["bun", MAIN, "--desk", own.sock], { terminal: pty, env });
    try {
      await until(() => existsSync(env.EP0CH_CONTROL!), "the door", 20_000);
      const cli = async (...args: string[]) => {
        const p = Bun.spawn(["bun", MAIN, ...args], { env, stdout: "pipe", stderr: "pipe" });
        const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        return out + err;
      };
      expect(await cli("open", id)).not.toContain("no block");
      await own.stop();
      const opened = await cli("open", id);
      expect(opened).toContain("offline");
      expect(opened).not.toContain("no block");
      const edited = await cli("act", "edit", "--as", "cartographer-3");
      expect(edited).toContain("offline");
      expect(edited).not.toContain("revision");
    } finally {
      proc.kill("SIGTERM"); await proc.exited;
      await own.dispose();
    }
  }, 60_000);
});
