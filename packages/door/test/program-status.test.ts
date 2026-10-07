// Program status in a terminal tile (OSC 7501, PIE-614): a real program on a real pty reports, and the tile keeps the
// records as the spec says (outline-core's test/program-status.test.ts holds the grammar and the limits): applied
// whole, the feature query answered, working and blocked gone when it exits or a prompt begins, done kept until the
// person comes back to the tile, everything gone on a full reset. Only `sh`, `printf`, `stty`, `dd`, `od` and `sleep` run.
import { afterEach, describe, expect, test } from "bun:test";
import { cttyPrefix, PtyPane } from "../src/desk/pty";
import { doorReport, StatusReporter, TileStatus, waitingCounts, waitingOnYou, type StatusHolder } from "../src/desk/program-status";
import type { StatusInput, StatusReport } from "@ep0ch/outline-core/program-status";
import { Painter } from "../src/display";
import { KeyDecoder, type TermInfo } from "../src/term";
import { waitingText } from "../src/app";
import { until } from "./scratch";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const osc = (body: string) => `\\033]7501;${body}\\033\\\\`;
const draw = (p: PtyPane) => p.render(60, 8, false, { redraw() {} } as any).lines.join("\n").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const tiles: PtyPane[] = [];
function tile(script: string, label = "prog"): PtyPane {
  const p = new PtyPane({ cmd: ["sh", "-c", script], label });
  tiles.push(p);
  draw(p);
  return p;
}
afterEach(() => { for (const p of tiles.splice(0)) p.dispose(); });
const states = (p: PtyPane) => p.status.records.list().map(r => `${r.id || "root"}:${r.state}`).join(" ");

describe.skipIf(!cttyPrefix())("a terminal tile reads its program's status", () => {
  test("a report becomes the tile's record, whole; its header shows the state; the waiting list and the status bar count it", async () => {
    const p = tile(`printf '${osc(`state=working:app=build:progress=40:msg=${b64("compiling")}`)}'; sleep 0.3; printf '${osc(`state=blocked:kind=permission:msg=${b64("Allow deploy?")}`)}'; sleep 30`);
    await until(() => p.status.urgent()?.state === "working", "working", 5000);
    expect(p.headStatus()?.glyph).toMatch(/^[◴◷◶◵] 40%$/);
    await until(() => p.status.urgent()?.state === "blocked", "blocked", 5000);
    // Replaced whole: no app or progress left over from the working report.
    expect(p.status.records.get("")).toEqual({ id: "", state: "blocked", kind: "permission", msg: "Allow deploy?" });
    expect(p.headStatus()?.glyph).toBe("◆");
    const row = waitingOnYou().find(r => r.holder === p);
    expect(row?.name).toBe("prog");
    expect(waitingText(waitingCounts()).plain).toContain("◆1");
    expect(p.describe().status).toEqual([{ id: "", state: "blocked", kind: "permission", msg: "Allow deploy?" }]);
  }, 15_000);

  test("the feature query is answered with the same bytes", async () => {
    const p = tile(`stty -icanon -echo min 0 time 20; printf '\\033]7501;?\\033\\\\'; r=$(dd bs=1 count=10 2>/dev/null | od -An -c | tr -s ' '); echo "got[$r]"; sleep 30`);
    await until(() => draw(p).includes("got["), "the reply", 5000);
    expect(draw(p)).toMatch(/got\[ 033 \] 7 5 0 1 ; \? 033 \\+\]/);
  }, 15_000);

  test("the program exits: working and blocked go, done stays until the person is back in the tile", async () => {
    const p = tile(`printf '${osc("state=done:id=a")}${osc("state=working:id=b")}${osc("state=blocked:id=c")}'; sleep 0.3`);
    await until(() => p.exited !== null, "the exit", 5000);
    await until(() => states(p) === "a:done", "only done left", 5000);
    expect(p.headStatus()?.glyph).toBe("✓");
    p.typed({ kind: "char", ch: "x" });
    expect(p.status.records.size).toBe(0);
    expect(p.headStatus()).toBeNull();
  }, 15_000);

  test("a new prompt (OSC 133 A) drops working and blocked; a full reset drops every record", async () => {
    const p = tile(`printf '${osc("state=working")}${osc("state=error:id=e")}${osc("state=idle:id=i")}'; sleep 0.3; printf '\\033]133;A\\033\\\\'; sleep 0.3; printf 'mark\\n'; sleep 0.5; printf '\\033c'; sleep 30`);
    await until(() => draw(p).includes("mark"), "the prompt", 5000);
    expect(states(p)).toBe("e:error i:idle");
    await until(() => p.status.records.size === 0, "the reset", 5000);
  }, 15_000);

  test("a report breaking the rules changes nothing: a control character in msg, an id outside the grammar, no state", async () => {
    const p = tile(`printf '${osc("state=done")}${osc(`state=error:msg=${b64("bad\x1b[2Jtext")}`)}${osc("state=error:id=a//b")}${osc("app=x")}'; printf 'end\\n'; sleep 30`);
    await until(() => draw(p).includes("end"), "the output", 5000);
    expect(states(p)).toBe("root:done");
  }, 15_000);
});

describe.skipIf(!cttyPrefix() || !Bun.which("tic") || !Bun.which("infocmp") || !Bun.which("tput"))("the door's terminfo", () => {
  test("a tile's program finds Pst in its xterm-256color (the door speaks OSC 7501), and the system's other entries as before", async () => {
    const p = tile(`tput Pst >/dev/null && echo "pst=yes" || echo "pst=no"; TERM=vt100 tput cols >/dev/null && echo "vt100=ok"; sleep 30`);
    await until(() => /pst=\w+/.test(draw(p)) && draw(p).includes("vt100=ok"), "tput", 5000);
    expect(draw(p)).toContain("pst=yes");
  }, 15_000);
});

describe("the door as a program: what it reports to the terminal it runs in", () => {
  const holder = (name: string, place: string, ...reports: StatusReport[]): StatusHolder => {
    const status = new TileStatus();
    for (const r of reports) status.records.apply(r);
    return { status, statusName: () => name, tileId: `t-${name}`, place };
  };

  test("the root holds what asks most across the tiles, each tile with records a child under its layout", () => {
    const want = doorReport([
      holder("claude", "desk", { state: "blocked", id: "", kind: "permission", app: "claude-code", msg: "Allow Bash?" }),
      holder("build", "drawer", { state: "working", id: "", progress: 30 }),
      holder("quiet", "desk"),
    ]);
    expect([...want.keys()]).toEqual(["desk/claude", "drawer/build", ""]);
    expect(want.get("")).toEqual({ state: "blocked", app: "ep0ch", kind: "permission", msg: "claude needs you: Allow Bash?" });
    expect(want.get("desk/claude")).toEqual({ state: "blocked", id: "desk/claude", kind: "permission", app: "claude-code", title: "claude", msg: "Allow Bash?" });
    expect(want.get("drawer/build")).toMatchObject({ state: "working", progress: 30, title: "build" });
    expect(doorReport([])).toEqual(new Map([["", { state: "idle", app: "ep0ch" }]]));
  });

  test("two tiles of one name get ids of their own, within the grammar however long the name", () => {
    const want = doorReport([holder("sh", "desk", { state: "done", id: "" }), holder("sh", "desk", { state: "error", id: "" })]);
    expect(new Set(want.keys()).size).toBe(3);
    const long = "a-very-long-terminal-tile-name-that-goes-on";
    const three = doorReport([0, 1, 2].map(() => holder(long, "desk", { state: "working", id: "" })));
    expect(new Set(three.keys()).size).toBe(4);
    for (const id of three.keys()) if (id) expect(id.split("/").every(s => /^[A-Za-z0-9_.+-]{1,32}$/.test(s))).toBe(true);
    const r = new StatusReporter(() => {});
    expect(() => r.sync(three)).not.toThrow();
  });

  test("after a program had the terminal, everything the door says is said again", () => {
    const written: string[] = [];
    const p = new Painter({ info: { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false, pst: true }, write: (s: string) => written.push(s), paint() {}, invalidate() {} });
    p.programStatus(doorReport([]));
    p.programStatus(doorReport([]));
    expect(written).toHaveLength(1);
    p.retell();
    expect(written).toEqual(["\x1b]7501;state=idle:app=ep0ch\x1b\\", "\x1b]7501;state=idle:app=ep0ch\x1b\\"]);
  });

  test("each terminal is told only what changed, a child that went as its clear, and everything cleared at the end", () => {
    const out: string[] = [];
    const r = new StatusReporter(s => out.push(s));
    const a = { state: "working", id: "desk/a" } as const, root = { state: "working", app: "ep0ch" } as const;
    r.sync(new Map<string, StatusInput>([["desk/a", a], ["", root]]));
    expect(out.pop()).toBe("\x1b]7501;state=working:id=desk/a\x1b\\\x1b]7501;state=working:app=ep0ch\x1b\\");
    r.sync(new Map<string, StatusInput>([["desk/a", a], ["", root]]));
    expect(out).toEqual([]);
    r.sync(new Map<string, StatusInput>([["", { state: "idle", app: "ep0ch" }]]));
    expect(out.pop()).toBe("\x1b]7501;state=clear:id=desk/a\x1b\\\x1b]7501;state=idle:app=ep0ch\x1b\\");
    r.clear();
    expect(out.pop()).toBe("\x1b]7501;state=clear\x1b\\");
  });

  test("a terminal that answered the query is reported to; one that didn't, never", () => {
    const written: string[] = [];
    const term = (pst: boolean) => ({ info: { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false, pst }, write: (s: string) => written.push(s), paint() {}, invalidate() {} });
    new Painter(term(false)).programStatus(doorReport([]));
    expect(written).toEqual([]);
    new Painter(term(true)).programStatus(doorReport([]));
    expect(written).toEqual(["\x1b]7501;state=idle:app=ep0ch\x1b\\"]);
  });

  test("the probe reads the terminal's answer, and an OSC reply is never typed as keys", () => {
    const info = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false } as TermInfo;
    const d = new KeyDecoder(info), keys: unknown[] = [];
    d.keyHandler = k => keys.push(k);
    let done = false;
    d.probing = { kitty: null, done: () => { done = true; } };
    d.feed("\x1b]7501;?\x1b\\\x1b[?62;22c");
    expect(info.pst).toBe(true);
    expect(done).toBe(true);
    d.probing = null;
    d.feed("\x1b]7501;?\x07\x1b]11;rgb:0000/0000/0000\x1b\\x");
    expect(keys).toEqual([{ kind: "char", ch: "x" }]);
    const quiet = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false } as TermInfo, q = new KeyDecoder(quiet);
    q.probing = { kitty: null, done() {} };
    q.feed("\x1b[?62c");
    expect(quiet.pst).toBeUndefined();
  });
});
