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
import { LINE_LIMIT } from "../src/control";
import { cttyPrefix } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
/** The launcher that makes the pty a process's controlling terminal: `setsid -c` on Linux, perl's on macOS (src/desk/pty.ts). */
const CTTY = cttyPrefix() ?? [];
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
    // The door runs in its pty, as these tests drive it, not as a session that would outlive them.
    EP0CH_DAEMON: "0",
  };
  return { dir, env };
}

class Door {
  out = "";
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly pty: InstanceType<typeof Bun.Terminal>;
  code: number | null = null;
  /** `ctty`: the pty is the door's controlling terminal (as under sshd), so closing it sends the door SIGHUP. */
  constructor(readonly env: Record<string, string>, args: string[] = ["--desk"], preload?: string, ctty = false) {
    this.pty = new Bun.Terminal({ cols: 140, rows: 40, data: (_t, d) => { this.out += Buffer.from(d).toString("latin1"); } });
    this.proc = Bun.spawn([...(ctty ? CTTY : []), "bun", ...(preload ? ["--preload", preload] : []), MAIN, ...args, scratch.sock], { terminal: this.pty, env });
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

  // Needs a launcher that gives the door the pty as its controlling terminal (setsid -c, or perl on macOS).
  test.skipIf(!CTTY.length)("the terminal hangs up (an ssh connection drops): drafts copied, socket removed, last call written", async () => {
    const { env } = sandbox();
    const id = await note("Tide table hangup\nlow water at six");
    const door = new Door(env, ["--desk"], undefined, true);
    await door.up();
    expect((await door.cli("open", id)).code).toBe(0);
    expect((await door.cli("act", "edit", "--as", "cartographer-4")).code).toBe(0);
    expect((await door.cli("act", "edit.text", "text=Tide table hangup\nlow water at seven", "--as", "cartographer-4")).code).toBe(0);
    door.pty.close();
    // A hangup isn't a crash: exit 0, as on SIGHUP.
    expect(await door.ended()).toBe(0);
    const drafts = files(join(env.EP0CH_STATE!, "drafts"));
    expect(drafts.some(f => readFileSync(join(env.EP0CH_STATE!, "drafts", f), "utf8").includes("low water at seven"))).toBe(true);
    expect(existsSync(door.control)).toBe(false);
    expect(existsSync(join(env.EP0CH_STATE!, "lastcall.json"))).toBe(true);
  }, 40_000);

  test("the terminal goes without a SIGHUP: the failed write ends the door as a hangup, not a crash", async () => {
    const { env } = sandbox();
    const door = new Door(env, []);            // the logon screen repaints on its own
    await door.up();
    door.pty.close();
    expect(await door.ended()).toBe(0);
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
    // A request line bigger than 1 MiB (a long note's text for edit.text) is still answered, and a character
    // split across two writes arrives whole.
    const reply = (parts: (string | Uint8Array)[]) => new Promise<any>(res => {
      const c = connect(door.control, async () => { for (const p of parts) { c.write(p); await Bun.sleep(50); } });
      let buf = ""; c.setEncoding("utf8"); c.on("data", d => { buf += d; if (buf.includes("\n")) { c.end(); res(JSON.parse(buf)); } });
      c.on("error", () => res(null)); c.on("close", () => res(buf ? JSON.parse(buf) : null));
    });
    const big = await reply([JSON.stringify({ cmd: "act", action: "no.such.action", args: { text: "tide ".repeat(300_000) } }) + "\n"]);
    expect(big?.ok).toBe(false);
    expect(String(big?.error)).not.toContain("too long");
    const bytes = Buffer.from(JSON.stringify({ cmd: "lantern\u00e9" }) + "\n");
    const at = bytes.indexOf(0xc3) + 1;
    const split = await reply([bytes.subarray(0, at), bytes.subarray(at)]);
    expect(String(split?.error)).toContain("lantern\u00e9");
    const cut = await new Promise<boolean>(res => {
      const c = connect(door.control, () => { c.write("x".repeat(LINE_LIMIT + (1 << 20))); });
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
  test("marks from both doors are kept and numbered apart, and the door that started second is warned", async () => {
    const shared = join(root, "shared-state");
    const a = new Door(sandbox(shared).env), b = new Door(sandbox(shared).env);
    await a.up(); await b.up();
    // Whichever door started second is warned (both, when they start at the same moment); read before the
    // marks' own flashes replace it.
    await Bun.sleep(500);
    const warned = (await a.cli("peek")).out + (await b.cli("peek")).out;
    expect(warned.includes("another door")).toBe(true);
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
    for (const d of [a, b]) d.kill("SIGTERM");
    for (const d of [a, b]) await d.ended();
  }, 60_000);
});

describe("offline says offline (F24, C F17)", () => {
  test("open and edit while the service is down say offline, not 'no block' or a revision", async () => {
    const own = new Scratch();
    await own.start();
    const b2 = new SocketBoard(own.sock); await b2.info();
    const pier = (await b2.request<{ id: string }>("create", { parentId: null, text: "North pier\nberth two", author: "agent" })).id;
    const id = (await b2.request<{ id: string }>("create", { parentId: null, text: `Ferry timetable\nsummer, from ((${pier}))`, author: "agent" })).id;
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
      // The person's own keys while it's down: ⏎ on a block link reads the target first. It says offline;
      // the door keeps running (an Offline nobody caught used to end it, as an unhandled rejection).
      pty.write("2"); await Bun.sleep(300);
      pty.write("]"); await Bun.sleep(300);
      pty.write("\r"); await Bun.sleep(2000);
      expect(proc.exitCode).toBeNull();
      const peek = await cli("peek");
      expect(peek).toContain('"screen": "desk"');
      expect(peek).toContain("offline · the outline isn't answering");
    } finally {
      proc.kill("SIGTERM"); await proc.exited;
      await own.dispose();
    }
  }, 60_000);
});

describe("where am I, from a tile (ep0ch where)", () => {
  test("a program in a tile reads its stack, each layer checked, and whether the person's keys are in its tile", async () => {
    const { dir, env } = sandbox();
    // A door reached over ssh, inside a Herdr pane (a fake herdr that only lists panes): what it inherited
    // is recorded before the pane's variables are dropped.
    const fake = join(dir, "herdr");
    writeFileSync(fake, `#!/bin/sh\n[ "$1 $2" = "pane list" ] && echo '{"result":{"panes":[{"pane_id":"w9:p9","focused":true}]}}' && exit 0\nexit 1\n`);
    chmodSync(fake, 0o755);
    const door = new Door({ ...env, SSH_TTY: "/dev/pts/nonexistent-77", HERDR_PANE_ID: "w9:p9", HERDR_WORKSPACE_ID: "w9", EP0CH_HERDR_BIN: fake });
    try {
      await door.up();
      const probe = join(dir, "probe.sh");
      writeFileSync(probe, `bun ${MAIN} where --json > ${dir}/a.json\nwhile [ ! -e ${dir}/go ]; do sleep 0.1; done\nbun ${MAIN} where --json > ${dir}/b.json\nbun ${MAIN} where > ${dir}/b.txt\nsleep 30\n`);
      const opened = await door.cli("act", "tile.open", "kind=pty", "name=probe", `cmd=sh ${probe}`);
      expect(opened.code).toBe(0);
      await until(() => existsSync(join(dir, "a.json")) && readFileSync(join(dir, "a.json"), "utf8").trim().endsWith("}"), "the first where", 20_000);
      const a = JSON.parse(readFileSync(join(dir, "a.json"), "utf8"));
      expect(a.nest).toMatch(new RegExp(`^ssh:pts/nonexistent-77 › herdr:w9:p9 › door:${door.proc.pid}/desk/t\\d+:probe$`));
      expect(a.layers.map((l: any) => [l.kind, l.live])).toEqual([["ssh", false], ["herdr", true], ["door", true], ["tile", true]]);
      expect(a.door).toMatchObject({ pid: door.proc.pid, answers: true, moved: false, tile: { name: "probe", found: true, descends: true } });
      // An agent's tile.open never took the keys.
      expect(a.keys.mine).toBe(false);

      // The person clicks into the tile... here: gives it the keys and enters it (⏎).
      expect((await door.cli("act", "tile.focus", "tile=probe")).code).toBe(0);
      door.pty.write("\r");
      await Bun.sleep(500);
      writeFileSync(join(dir, "go"), "");
      await until(() => existsSync(join(dir, "b.txt")) && readFileSync(join(dir, "b.txt"), "utf8").includes("keys:"), "the second where", 20_000);
      const b = JSON.parse(readFileSync(join(dir, "b.json"), "utf8"));
      expect(b.keys).toMatchObject({ mine: true, typing: true });
      expect(readFileSync(join(dir, "b.txt"), "utf8")).toContain("keys: the person is typing in this tile");
    } finally {
      door.kill("SIGTERM");
      await door.ended();
    }
  }, 60_000);

  test("outside a door: not in a door, and nothing is asked of a door", async () => {
    const { env } = sandbox();
    const p = Bun.spawn(["bun", MAIN, "where"], { env: { PATH: env.PATH!, HOME: env.HOME! }, stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    expect(code).toBe(0);
    expect(out).toContain("not in a door");
  });
});
