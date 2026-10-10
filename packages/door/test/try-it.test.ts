// `scripts/try-it.sh --showcase`: it seeds on first run, keeps edits, --reset puts the seed back, and its pidfile never
// makes it signal a process that isn't its service (moved out of showcase.test.ts, PIE-760: it tests the script, not a
// section). Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadShowcase } from "../src/showcase/seed";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

/**
 * Processes whose environment serves `base`'s state: a scan of `proc`, and none where the host has no
 * /proc (macOS), where only the pidfile is checked.
 */
function servingState(base: string, proc = "/proc"): string[] {
  if (!existsSync(proc)) return [];
  return readdirSync(proc).filter(p => /^\d+$/.test(p)).filter(p => {
    try { return readFileSync(`${proc}/${p}/environ`, "utf8").split("\0").includes(`EP0CH_OUTLINES=${base}/outlines`); } catch { return false; }
  });
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe.skipIf(!outliner)("scripts/try-it.sh --showcase --reset", () => {
  const home = mkdtempSync(join(tmpdir(), "ep0ch-showcase-home-"));
  const base = join(home, "ep0ch-door", "showcase");
  // Without EP0CH_STATE, which the script would put the showcase under: another test file may have left it
  // set in this process (the order files run in differs between machines; on macOS it broke this one).
  const env = () => { const e: Record<string, string | undefined> = { ...process.env, XDG_STATE_HOME: home }; delete e.EP0CH_STATE; return e; };
  const run = (...args: string[]) => Bun.spawnSync(["sh", "scripts/try-it.sh", "--showcase", "--prepare", "--outliner", outliner!, ...args], {
    cwd: join(import.meta.dir, ".."), env: env(), stdout: "pipe", stderr: "pipe",
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test("seeds on first run, keeps edits across runs, and --reset puts the seed back", async () => {
    const first = run();
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toContain("seeded the showcase");
    // An edit on the showcase outline, through its own service on the same state.
    let svc = new Scratch(base, "showcase");
    let board = new SocketBoard(await svc.start());
    let wb = (await loadShowcase(board))!.notes.whiteboard!;
    const original = wb.text;
    await board.update(wb.id, `${original}\nBuy more lemons.`, wb.revision!);
    board.close(); await svc.stop();
    // Another run keeps it (no reseed)…
    const again = run();
    expect(again.exitCode).toBe(0);
    expect(again.stdout.toString()).not.toContain("seeded");
    svc = new Scratch(base, "showcase"); board = new SocketBoard(await svc.start());
    expect((await loadShowcase(board))!.notes.whiteboard!.text).toContain("Buy more lemons.");
    board.close(); await svc.stop();
    // …and --reset deletes it and reseeds.
    const reset = run("--reset");
    expect(reset.exitCode).toBe(0);
    expect(reset.stdout.toString()).toContain("reset: deleted");
    svc = new Scratch(base, "showcase"); board = new SocketBoard(await svc.start());
    const back = (await loadShowcase(board))!;
    expect(back.notes.whiteboard!.text).toBe(original);
    expect((await board.roots()).filter(r => r.props.type === "showcase").length).toBe(1);
    board.close(); await svc.stop();
    // --prepare leaves no service of its own running: no pidfile, and no process serving that state.
    expect(existsSync(join(base, "service.pid"))).toBe(false);
    expect(servingState(base)).toEqual([]);
  }, 60_000);
});

test("the process scan finds nothing, rather than failing, on a host without /proc", () => {
  expect(servingState("/nowhere/showcase", join(tmpdir(), "ep0ch-no-proc-here"))).toEqual([]);
});

describe.skipIf(!outliner || !existsSync("/proc"))("scripts/try-it.sh --showcase with a stale pidfile", () => {
  const home = mkdtempSync(join(tmpdir(), "ep0ch-showcase-stale-"));
  const base = join(home, "ep0ch-door", "showcase");
  const pidfile = join(base, "service.pid");
  const run = (args: string[], env: Record<string, string> = {}, checkout = outliner!) => Bun.spawnSync(["sh", "scripts/try-it.sh", "--showcase", "--prepare", "--outliner", checkout, ...args], {
    cwd: join(import.meta.dir, ".."), env: { ...process.env, XDG_STATE_HOME: home, ...env }, stdout: "pipe", stderr: "pipe",
  });
  // An unrelated process of our own, which the script must never signal. Only we stop it.
  let bystander: ReturnType<typeof Bun.spawn> | null = null;
  const stale = () => { mkdirSync(base, { recursive: true }); writeFileSync(pidfile, `${bystander!.pid}\n`); };
  beforeAll(() => { bystander = Bun.spawn(["sleep", "300"], { stdout: "ignore", stderr: "ignore" }); });
  afterAll(() => { bystander?.kill(); rmSync(home, { recursive: true, force: true }); });

  test("a pidfile naming another process is stale: the script serves and seeds, and leaves that process alone", () => {
    stale();
    const r = run([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("seeded the showcase");
    expect(r.stderr.toString()).toContain(`named process ${bystander!.pid}, which isn't its service`);
    expect(alive(bystander!.pid)).toBe(true);
    expect(existsSync(pidfile)).toBe(false);                 // its own service stopped on exit, and said so
    expect(servingState(base)).toEqual([]);
  }, 60_000);

  test("--reset doesn't signal the process a stale pidfile names", () => {
    stale();
    const r = run(["--reset"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).not.toContain("stopped the showcase service");
    expect(r.stdout.toString()).toContain("reset: deleted");
    expect(alive(bystander!.pid)).toBe(true);
    expect(servingState(base)).toEqual([]);
  }, 60_000);

  test("a pidfile naming the showcase's own service is used: no second service, and it keeps running", async () => {
    const svc = new Scratch(base, "showcase");
    await svc.start();
    try {
      writeFileSync(pidfile, `${svc.pid}\n`);
      const r = run([]);
      expect(r.exitCode).toBe(0);
      expect(r.stderr.toString()).not.toContain("isn't its service");
      expect(alive(svc.pid!)).toBe(true);
      expect(servingState(base)).toEqual([String(svc.pid)]);
      expect(readFileSync(pidfile, "utf8").trim()).toBe(String(svc.pid));   // not its to remove
    } finally { await svc.stop(); rmSync(pidfile, { force: true }); }
  }, 60_000);

  test("a service that doesn't start in time is stopped before the script exits, before any pidfile exists", async () => {
    // A stand-in checkout whose server never opens its socket, and says which process it is.
    const fake = mkdtempSync(join(tmpdir(), "ep0ch-fake-outliner-"));
    const started = join(fake, "pid");
    mkdirSync(join(fake, "src"));
    writeFileSync(join(fake, "src/host-main.ts"), `require("node:fs").writeFileSync(${JSON.stringify(started)}, String(process.pid)); setInterval(() => {}, 1000);\n`);
    try {
      rmSync(base, { recursive: true, force: true });
      const r = run([], { EP0CH_TRY_START_CHECKS: "10" }, fake);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain("the private host didn't start");
      const pid = Number(readFileSync(started, "utf8"));
      await until(() => !alive(pid), "the stand-in service stopped", 3000).catch(() => {});
      const left = alive(pid);
      if (left) process.kill(pid);                            // ours: the test started it through the script
      expect(left).toBe(false);
      expect(existsSync(pidfile)).toBe(false);
    } finally { rmSync(fake, { recursive: true, force: true }); }
  }, 30_000);
});
