// The scratch helpers themselves: a killed run's temp dirs are cleared by the next one, and nothing else is.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, scratchDir, scratchRoot, testSlack, until } from "./scratch";

// PIE-1504: a wait's deadline scales with EP0CH_TEST_SLACK, read at each call, so a run under load (agent-env --test
// sets 2) waits longer instead of going red. Lower bounds only: an upper bound would be the load-dependent red itself.
test("until waits EP0CH_TEST_SLACK times as long; unset, empty or nonsense means 1", async () => {
  const was = process.env.EP0CH_TEST_SLACK;
  const timing = async (slack: string | undefined, ms: number) => {
    if (slack === undefined) delete process.env.EP0CH_TEST_SLACK; else process.env.EP0CH_TEST_SLACK = slack;
    const t0 = performance.now();
    await expect(until(() => false, "never", ms)).rejects.toThrow("timed out waiting for never");
    return performance.now() - t0;
  };
  try {
    expect([testSlack(), (process.env.EP0CH_TEST_SLACK = "", testSlack()), (process.env.EP0CH_TEST_SLACK = "x", testSlack()), (process.env.EP0CH_TEST_SLACK = "0", testSlack()), (process.env.EP0CH_TEST_SLACK = "2.5", testSlack())])
      .toEqual([Number(was) || 1, 1, 1, 1, 2.5]);
    expect(await timing(undefined, 60)).toBeGreaterThanOrEqual(55);
    expect(await timing("4", 60)).toBeGreaterThanOrEqual(235);
  } finally {
    if (was === undefined) delete process.env.EP0CH_TEST_SLACK; else process.env.EP0CH_TEST_SLACK = was;
  }
});

// PIE-1611: the preload clears the person's EP0CH_* settings, and for a while this one with them: agent-env's and
// box-test's slack never reached a door test, whatever the load.
test("a run's EP0CH_TEST_SLACK reaches its tests, past the preload", async () => {
  const dir = scratchDir("slack-seen-"), file = join(dir, "slack-seen.test.ts");
  writeFileSync(file, `import { test, expect } from "bun:test";\ntest("seen", () => { expect(process.env.EP0CH_TEST_SLACK).toBe("3"); });\n`);
  try {
    const run = Bun.spawn([process.execPath, "test", file], { cwd: join(import.meta.dir, ".."), env: { ...process.env, EP0CH_TEST_SLACK: "3" }, stdout: "ignore", stderr: "pipe" });
    const [code, said] = await Promise.all([run.exited, new Response(run.stderr).text()]);
    expect({ code, said: code ? said : "" }).toEqual({ code: 0, said: "" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);

test("scratchDir removes its prefix's dirs whose test process is gone, and keeps live, unmarked, other-namespace and other dirs", async () => {
  const prefix = `ep0ch-prune-check-${process.pid}-`;
  const gone = Bun.spawn(["true"]);
  await gone.exited;
  const live = Bun.spawn(["sleep", "30"]);
  let space = "";
  try { space = readlinkSync("/proc/self/ns/pid"); } catch { /* no pid namespaces here */ }
  const mk = (pid: number | null, p = prefix, ns = space) => {
    const d = mkdtempSync(join(scratchRoot(), p));
    if (pid !== null) writeFileSync(join(d, "pid"), `${pid}\n${ns}`);
    return d;
  };
  const dead = mk(gone.pid), running = mk(live.pid), mine = mk(process.pid), unmarked = mk(null);
  const other = mk(gone.pid, `ep0ch-prune-other-${process.pid}-`);
  // A run in another pid namespace (a container or sandbox sharing /tmp): its live id may look gone from here.
  const elsewhere = mk(gone.pid, prefix, "pid:[1]");
  try {
    const made = scratchDir(prefix);
    expect(existsSync(dead)).toBe(false);
    for (const d of [running, mine, unmarked, other, elsewhere, made]) expect(existsSync(d)).toBe(true);
    expect(await Bun.file(join(made, "pid")).text()).toBe(`${process.pid}\n${space}`);
    rmSync(made, { recursive: true, force: true });
  } finally {
    live.kill();
    for (const d of [dead, running, mine, unmarked, other, elsewhere]) rmSync(d, { recursive: true, force: true });
  }
});

test("scratchRoot: the temp folder when it is short and names no outline above it; else a short private folder of /tmp", () => {
  const uid = process.getuid?.() ?? 0, fallback = `/tmp/ep0ch-${uid}`;
  const clean = mkdtempSync("/tmp/ep0ch-r-");
  const marked = mkdtempSync("/tmp/ep0ch-m-");
  try {
    expect(scratchRoot(clean)).toBe(clean);
    // Too long for a session's sockets under it.
    expect(scratchRoot(join(clean, "a-folder-name-long-enough"))).toBe(fallback);
    // A .ep0ch above it names an outline (as the person's ~/.ep0ch does).
    writeFileSync(join(marked, ".ep0ch"), 'ws = "garden"\n');
    const below = join(marked, "t");
    Bun.spawnSync(["mkdir", below]);
    expect(scratchRoot(below)).toBe(fallback);
    // A short symlink to it is judged where it really is.
    const link = `/tmp/ep0ch-l-${process.pid}`;
    Bun.spawnSync(["ln", "-s", below, link]);
    try { expect(scratchRoot(link)).toBe(fallback); } finally { rmSync(link, { force: true }); }
  } finally {
    rmSync(clean, { recursive: true, force: true });
    rmSync(marked, { recursive: true, force: true });
  }
});

test.skipIf(!outliner)("a scratch host Bun ended at another test's timeout is started again for the next test, on the same outline (PIE-1303)", async () => {
  const scratch = new Scratch();
  try {
    const board = new SocketBoard(await scratch.start());
    await board.info();
    const made = await board.request("create", { text: "A note that outlives the host" });
    // What Bun does at a timeout: a SIGTERM to the file's processes, which lands while the next test is starting.
    const old = scratch.pid!;
    process.kill(old, "SIGTERM");
    expect(await scratch.revive()).toBe(true);
    expect(scratch.pid).not.toBe(old);
    expect((await board.get(made.id))?.text).toContain("A note that outlives the host");
    // A host that answers is left alone.
    const now = scratch.pid;
    expect(await scratch.revive()).toBe(false);
    expect(scratch.pid).toBe(now);
    board.close();
  } finally { await scratch.dispose(); }
}, 60_000);

test.skipIf(!outliner)("a test that times out takes only itself: Bun ends the file's host, the next test of the file finds one up (PIE-1303)", async () => {
  const dir = scratchDir("ep0ch-revive-"), mark = join(dir, "mark");
  try {
    const run = Bun.spawn(["bun", "test", "./test/fixtures/revive-timeout.fixture.ts"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, REVIVE_MARK: mark } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    // The first test fails by its timeout (so the run exits 1), and Bun did end the host; the second one passed.
    expect(err + out).toContain("killed 1 dangling process");
    expect(existsSync(mark), err + out).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
