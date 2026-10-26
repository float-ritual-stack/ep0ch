// Program status in a terminal tile (OSC 7501, PIE-614): a real program on a real pty reports, and the tile keeps the
// records as the spec says (outline-core's test/program-status.test.ts holds the grammar and the limits): applied
// whole, the feature query answered, working and blocked gone when it exits or a prompt begins, done kept until the
// person comes back to the tile, everything gone on a full reset. Only `sh`, `printf`, `stty`, `dd`, `od` and `sleep` run.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cttyPrefix, PtyPane } from "../src/desk/pty";
import { doorReport, DoorReporter, newStatusKey, NUDGE_SETTLE_MS, StatusReporter, TileStatus, waitingCounts, waitingOnYou, type StatusHolder } from "../src/desk/program-status";
import { parseProgramStatus, type StatusInput, type StatusReport } from "@ep0ch/outline-core/program-status";
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

describe("which tile (PIE-1306)", () => {
  test("the tile query is answered with the tile's id; a marker is kept for host.tileOf and answers nothing", () => {
    const s = new TileStatus(), said: string[] = [];
    s.feed("?tile", b => said.push(b), () => "t-0e6c7a52-3f1d-4b8e-9c2a-5d7f1e3b9a40");
    expect(said).toEqual(["\x1b]7501;?tile=t-0e6c7a52-3f1d-4b8e-9c2a-5d7f1e3b9a40\x1b\\"]);
    s.feed("?tile", null, () => "t-0e6c7a52-3f1d-4b8e-9c2a-5d7f1e3b9a40");   // a replay: answered then
    expect(said).toHaveLength(1);
    expect(s.saw("k7f3a1c09e2b44d1")).toBe(false);
    s.feed("?mark=k7f3a1c09e2b44d1", b => said.push(b));
    expect(s.saw("k7f3a1c09e2b44d1")).toBe(true);
    expect(said).toHaveLength(1);
    expect(s.records.size).toBe(0);                           // neither is a record
  });
});

describe("who runs in a tile (TileStatus.app)", () => {
  test("the root report's app: a nested door's child records name its tiles' agents, not this tile's", () => {
    const s = new TileStatus();
    s.feed("state=idle:app=ep0ch", null);
    s.feed("state=working:id=claude.1:app=claude-code", null);
    expect(s.app).toBe("ep0ch");
    s.feed("state=idle:app=claude-code", null);
    expect(s.app).toBe("claude-code");
    s.feed("state=clear:id=other", null);                    // a child going leaves the root
    expect(s.app).toBe("claude-code");
    s.feed("state=idle", null);                              // the root report replaces its record whole: no app now
    expect(s.app).toBeNull();
    s.feed("state=idle:app=claude-code", null);
    s.feed("state=clear", null);
    expect(s.app).toBeNull();
  });
});

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
    expect(waitingText(waitingCounts(waitingOnYou().filter(r => r.holder === p))).plain).toContain("◆1");
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

describe.skipIf(!cttyPrefix() || !Bun.which("bash") || !existsSync("/proc/self/stat"))("a shell without prompt marks", () => {
  test("a job that reported working and then ended: once the shell has the terminal back, its working goes", async () => {
    const p = new PtyPane({ cmd: ["bash", "--norc", "--noprofile", "-i"], label: "shell" });
    tiles.push(p);
    draw(p);
    await Bun.sleep(300);
    p.input(`PS1='$ '; sh -c "printf '${osc("state=working:app=job")}'; sleep 1; echo job-over"\r`);
    await until(() => p.status.urgent()?.state === "working", "the job's report", 5000);
    await until(() => draw(p).includes("job-over"), "the job ends", 5000);
    await until(() => p.status.records.size === 0, "working dropped once the shell is back in the foreground", 6000);
  }, 20_000);

  test("an agent that reported idle and was killed without clearing: once the shell has the terminal back, it is no agent here (its idle record stays)", async () => {
    const p = new PtyPane({ cmd: ["bash", "--norc", "--noprofile", "-i"], label: "shell" });
    tiles.push(p);
    draw(p);
    await Bun.sleep(300);
    p.input(`PS1='$ '; sh -c "printf '${osc("state=idle:app=claude-code")}'; sleep 1; echo agent-over"\r`);
    await until(() => p.status.app === "claude-code", "the agent's report", 5000);
    await until(() => draw(p).includes("agent-over"), "the agent ends", 5000);
    await until(() => p.status.app === null, "no agent once the shell is back in the foreground", 6000);
    expect(states(p)).toBe("root:idle");
  }, 20_000);
});

describe.skipIf(!cttyPrefix() || !Bun.which("tic") || !Bun.which("infocmp") || !Bun.which("tput"))("the door's terminfo", () => {
  test("a tile's program finds Pst in its xterm-256color (the door speaks OSC 7501), and the system's other entries as before", async () => {
    const p = tile(`tput Pst >/dev/null && echo "pst=yes" || echo "pst=no"; TERM=vt100 tput cols >/dev/null && echo "vt100=ok"; sleep 30`);
    await until(() => /pst=\w+/.test(draw(p)) && draw(p).includes("vt100=ok"), "tput", 5000);
    expect(draw(p)).toContain("pst=yes");
  }, 15_000);
});

describe("the door as a program: what it reports to the terminal it runs in", () => {
  /** A clock the tiles and the reporter share, so a test lives through minutes in no time. */
  const clock = { t: 1_000_000 };
  const holder = (name: string, ...reports: StatusReport[]): StatusHolder => {
    const status = new TileStatus(() => clock.t);
    for (const r of reports) status.report(r);
    return { status, statusName: () => name, tileId: `t-${name}`, statusKey: newStatusKey(name) };
  };
  const say = (h: StatusHolder, r: StatusReport) => h.status.report(r);
  const termOf = (written: string[], tree: boolean) => ({ info: { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false, pst: true, tree }, write: (s: string) => written.push(s), paint() {}, invalidate() {} });
  /** Every record written, read back the way a terminal reads it. */
  const records = (written: string[]) => written.join("").split("\x1b\\").filter(Boolean).map(seq => {
    const p = parseProgramStatus(seq.slice("\x1b]7501;".length));
    return p.t === "report" ? p.report : (() => { throw new Error(`not a report: ${seq}`); })();
  });

  test("the children are every tile with records, most urgent first, by its own key; the root is quiet while nothing asks", () => {
    const claude = holder("claude", { state: "blocked", id: "", kind: "permission", app: "claude-code", msg: "Allow Bash?" });
    const build = holder("build", { state: "working", id: "", progress: 34 });
    const failed = holder("deploy", { state: "error", id: "" });
    const want = doorReport([build, holder("quiet"), failed, claude], "garden");
    expect([...want.keys()]).toEqual([claude.statusKey, failed.statusKey, build.statusKey, ""]);
    expect(claude.statusKey).toMatch(/^claude\.\d+$/);
    expect(want.get(claude.statusKey)).toEqual({ state: "blocked", id: claude.statusKey, kind: "permission", app: "claude-code", title: "claude", msg: "Allow Bash?" });
    // Progress goes up in tens: a program ticking every percent isn't a report each time.
    expect(want.get(build.statusKey)).toMatchObject({ state: "working", progress: 30, title: "build" });
    build.status.report({ state: "working", id: "", progress: 32 });
    expect(doorReport([build], "garden").get(build.statusKey)).toMatchObject({ progress: 30 });
    // Working asks nothing of a person who is away: the root stays idle, and says nothing.
    expect(doorReport([build], "garden").get("")).toEqual({ state: "idle", app: "ep0ch" });
    expect(doorReport([], "garden")).toEqual(new Map([["", { state: "idle", app: "ep0ch" }]]));
  });

  test("the root says who, where and what: a blocked tile's ask, a failure, a long job's own last words; a short done says nothing", () => {
    const ask = holder("scribe", { state: "blocked", id: "", kind: "permission", msg: "Allow Edit: src/seeds.ts?" });
    expect(doorReport([ask], "garden").get("")).toEqual({ state: "blocked", app: "ep0ch", kind: "permission", msg: "scribe in garden · approve: Allow Edit: src/seeds.ts?" });
    const question = holder("scribe", { state: "blocked", id: "", kind: "question" });
    expect(doorReport([question], "garden").get("")).toMatchObject({ state: "blocked", kind: "question", msg: "scribe in garden asks you a question" });
    const bare = holder("scribe", { state: "blocked", id: "" });
    expect(doorReport([bare], "garden").get("")).toMatchObject({ msg: "scribe in garden needs you" });
    const broke = holder("scribe", { state: "error", id: "", msg: "stopped on an API error" });
    expect(doorReport([broke], "garden").get("")).toEqual({ state: "error", app: "ep0ch", msg: "scribe in garden failed: stopped on an API error" });

    const short = holder("scribe", { state: "working", id: "" });
    clock.t += 20_000;
    say(short, { state: "done", id: "", msg: "watered the beds" });
    expect(doorReport([short], "garden").get("")).toEqual({ state: "idle", app: "ep0ch" });
    const long = holder("scribe");
    say(long, { state: "working", id: "" });
    clock.t += 4 * 60_000;
    say(long, { state: "done", id: "", msg: "planted the early peas\nand staked them" });
    expect(doorReport([short, long], "garden").get("")).toEqual({ state: "done", app: "ep0ch", msg: "scribe in garden · 4 min: planted the early peas" });
    const mute = holder("scribe");
    say(mute, { state: "working", id: "" });
    clock.t += 3 * 60_000;
    say(mute, { state: "done", id: "" });
    expect(doorReport([mute], "garden").get("")).toMatchObject({ state: "done", msg: "scribe in garden finished after 3 min" });
    // A blocked ask outranks a failure outranks a long done, and the newest of equals wins.
    expect(doorReport([long, broke, ask], "garden").get("")).toMatchObject({ state: "blocked" });
    expect(doorReport([long, broke], "garden").get("")).toMatchObject({ state: "error" });
  });

  test("ids are one level, within the grammar however long the name, and stay with the tile; at most 63 children", () => {
    const long = holder("a-very-long-terminal-tile-name-that-goes-on", { state: "working", id: "" });
    const twin = holder("a-very-long-terminal-tile-name-that-goes-on", { state: "done", id: "" });
    const want = doorReport([long, twin], "garden");
    expect(new Set(want.keys()).size).toBe(3);
    for (const id of want.keys()) if (id) expect(id).toMatch(/^[A-Za-z0-9_.+-]{1,32}$/);
    expect(doorReport([twin, long], "garden").has(long.statusKey)).toBe(true);
    const many = Array.from({ length: 80 }, (_, i) => holder(`sh${i}`, { state: i === 79 ? "blocked" : "working", id: "" }));
    const capped = doorReport(many, "garden");
    expect(capped.size).toBe(64);
    expect(capped.has(many[79]!.statusKey)).toBe(true);
    expect(() => new StatusReporter(() => {}).sync(capped)).not.toThrow();
  });

  test("five agent tiles through fifty turns and one ask: a handful of reports, each saying who, where and what (PIE-1310)", () => {
    const now = () => clock.t;
    const reporter = new DoorReporter(() => "garden", now);
    const plain: string[] = [], tree: string[] = [];
    const quiet = new Painter(termOf(plain, false)), sidebar = new Painter(termOf(tree, true));
    const tiles = ["scribe", "weeder", "sower", "waterer", "mulcher"].map(n => holder(n));
    const tick = (ms = 500) => {
      clock.t += ms;
      const want = reporter.report(tiles);
      quiet.programStatus(want); sidebar.programStatus(want);
    };
    tick();
    for (let turn = 0; turn < 50; turn++) {
      for (const h of tiles) say(h, { state: "working", id: "", app: "claude-code" });
      tick(1500);
      for (const h of tiles) say(h, { state: turn % 2 ? "idle" : "done", id: "", app: "claude-code", ...(turn % 2 ? {} : { msg: `turn ${turn}: pruned` }) });
      tick(1500);
      for (const h of tiles) h.status.seen();
      tick();
    }
    // One asks to edit a file, and waits well past the hold.
    say(tiles[2]!, { state: "working", id: "", app: "claude-code" });
    say(tiles[2]!, { state: "blocked", id: "", kind: "permission", app: "claude-code", msg: "Allow Edit: src/seeds.ts?" });
    for (let i = 0; i < 12; i++) tick(500);
    say(tiles[2]!, { state: "working", id: "", app: "claude-code" });
    for (let i = 0; i < 12; i++) tick(500);
    say(tiles[0]!, { state: "idle", id: "" });
    for (const h of tiles) say(h, { state: "idle", id: "" });
    for (let i = 0; i < 12; i++) tick(500);

    const roots = records(plain);
    // Nothing is a child for a terminal that shows no tree, and every record is the root's.
    expect(roots.every(r => r.id === "")).toBe(true);
    // Idle at the start, the ask, nothing asking any more: three.
    expect(roots.map(r => r.state)).toEqual(["idle", "blocked", "idle"]);
    expect(roots[1]).toMatchObject({ kind: "permission", app: "ep0ch", msg: "sower in garden · approve: Allow Edit: src/seeds.ts?" });
    expect(roots[2]!.msg).toBe("nothing waits on you in garden");
    for (const r of roots) expect(r.msg === undefined || /\bgarden\b/.test(r.msg)).toBe(true);
    // A terminal that shows the tree hears the root alone the same, and its children as before.
    expect(records(tree).filter(r => r.id === "").map(r => r.msg)).toEqual(roots.map(r => r.msg));
    expect(records(tree).some(r => r.id !== "")).toBe(true);
  });

  test("a program rewording its ask is one nudge, sent once; a different tile asking is another", () => {
    const reporter = new DoorReporter(() => "garden", () => clock.t);
    const out: string[] = [];
    const painter = new Painter(termOf(out, false));
    const a = holder("scribe"), b = holder("weeder");
    const step = (ms: number) => { clock.t += ms; painter.programStatus(reporter.report([a, b])); };
    step(0);
    say(a, { state: "blocked", id: "", kind: "permission", msg: "Allow Edit: one.ts?" });
    // Reworded every three seconds, longer than the hold: it never lets the hold run out, and never sends twice.
    for (let i = 0; i < 12; i++) { step(3000); say(a, { state: "blocked", id: "", kind: "permission", msg: `Allow Edit: file${i}.ts?` }); }
    for (let i = 0; i < 12; i++) { step(5000); say(a, { state: "blocked", id: "", kind: "permission", msg: `Allow Edit: other${i}.ts?` }); }
    const told = records(out);
    expect(told.map(r => r.state)).toEqual(["idle", "blocked"]);
    expect(told[1]!.msg).toMatch(/^scribe in garden · approve: Allow Edit: file\d+\.ts\?$/);
    // Another tile now asks too: the first still leads, nothing new; when it is answered the second is a new ask.
    say(b, { state: "blocked", id: "", kind: "question", msg: "Which bed?" });
    step(5000); step(5000);
    expect(records(out)).toHaveLength(2);
    say(a, { state: "working", id: "" });
    step(0); step(5000);
    expect(records(out).at(-1)).toMatchObject({ state: "blocked", kind: "question", msg: "weeder in garden · asks: Which bed?" });
  });

  test("a nested record finishing earlier doesn't end the job of the one that reports the whole run", () => {
    const h = holder("scribe");
    say(h, { state: "working", id: "" });
    clock.t += 10_000;
    say(h, { state: "working", id: "helper" });
    clock.t += 5_000;
    say(h, { state: "done", id: "helper", msg: "a small thing" });
    clock.t += 3 * 60_000;
    say(h, { state: "done", id: "", msg: "the whole run" });
    expect(h.status.ranOf("")).toBe(3 * 60_000 + 15_000);
    expect(h.status.ranOf("helper")).toBe(5_000);
    expect(doorReport([h], "garden").get("")).toMatchObject({ state: "done", msg: "scribe in garden · 3 min: the whole run" });
    h.status.seen();
    expect(h.status.ranOf("")).toBeNull();
  });

  test("the time a job waited on the person isn't the job's: a run that sat blocked for ten minutes took what it worked", () => {
    const h = holder("scribe");
    say(h, { state: "working", id: "" });
    clock.t += 30_000;
    say(h, { state: "blocked", id: "", kind: "permission", msg: "Allow Edit: one.ts?" });
    clock.t += 10 * 60_000;
    say(h, { state: "working", id: "" });
    clock.t += 5_000;
    say(h, { state: "done", id: "", msg: "edited" });
    expect(h.status.ranOf("")).toBe(35_000);
    expect(doorReport([h], "garden").get("")).toEqual({ state: "idle", app: "ep0ch" });
  });

  test("a flap within the hold sends nothing; a change that lasts is sent once, a long job's done included", () => {
    const reporter = new DoorReporter(() => "garden", () => clock.t);
    const out: string[] = [];
    const painter = new Painter(termOf(out, false));
    const h = holder("scribe");
    const step = (ms: number) => { clock.t += ms; painter.programStatus(reporter.report([h])); };
    step(0);
    say(h, { state: "blocked", id: "", kind: "auth", msg: "Log in to continue" });
    step(1000);
    say(h, { state: "working", id: "" });
    step(1000);
    step(10_000);
    expect(records(out).map(r => r.state)).toEqual(["idle"]);
    expect(reporter.due()).toBe(false);
    // A long job finishes: the nudge waits out the hold, then goes once, and is cleared when the person comes back.
    clock.t += 5 * 60_000;
    say(h, { state: "done", id: "", msg: "shipped the seed order" });
    step(0);
    expect(reporter.due()).toBe(false);
    step(2000);
    expect(records(out)).toHaveLength(1);
    step(NUDGE_SETTLE_MS);
    expect(reporter.due()).toBe(false);
    expect(records(out).map(r => r.msg).slice(1)).toEqual(["scribe in garden · 5 min: shipped the seed order"]);
    h.status.seen();
    step(0);
    step(NUDGE_SETTLE_MS);
    expect(records(out).at(-1)).toMatchObject({ state: "idle", msg: "nothing waits on you in garden" });
    expect(records(out)).toHaveLength(3);
  });

  test("after a program had the terminal, everything the door says is said again", () => {
    const written: string[] = [];
    const p = new Painter({ info: { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false, pst: true }, write: (s: string) => written.push(s), paint() {}, invalidate() {} });
    p.programStatus(doorReport([], "garden"));
    p.programStatus(doorReport([], "garden"));
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
    new Painter(term(false)).programStatus(doorReport([], "garden"));
    expect(written).toEqual([]);
    new Painter(term(true)).programStatus(doorReport([], "garden"));
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
