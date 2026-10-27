// A test's scratch folder owns what runs from it (PIE-1360). The install tests start an outline host the way systemd
// would (setsid, an environment written whole) and daemonized sessions, which leave the test's process tree: when the
// run was ended from outside (box-test's reap, a `timeout`), `bun test` ran no afterAll and 46 hosts outlived their
// runs on float-box for days, holding its inotify instances. Here a stand-in test starts a real host from this
// checkout the same way, then hangs, as a timed-out test does, and is ended: by box-test's own guard (its run times
// out), and by a TERM. Either way nothing of its scratch folder is left. Linux only (/proc, setsid).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, hostOutliner, processesUnder, stopUnder, until } from "./scratch";

const linux = process.platform === "linux";
const root = mkdtempSync(join(tmpdir(), "scratch-procs-"));
const guard = join(import.meta.dir, "../../../scripts/box-test-guard");

// The stand-in test: a scratch folder, a host started with setsid from an environment written whole (passed through
// wholeEnv, as install-migrate's is) in the folder it is given, the host's pid written to `out`, then it hangs. `own` makes it ownScratch's.
const child = join(root, "stand-in.ts");
writeFileSync(child, `import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownScratch, wholeEnv } from ${JSON.stringify(join(import.meta.dir, "scratch.ts"))};
const [out, dir, mode] = process.argv.slice(2);
for (const d of ["home", "config", "outlines"]) mkdirSync(join(dir, d));
if (mode === "own") ownScratch(dir);
const env = wholeEnv({ HOME: join(dir, "home"), XDG_CONFIG_HOME: join(dir, "config"), EP0CH_OUTLINES: join(dir, "outlines"), PATH: process.env.PATH });
const r = Bun.spawnSync(["sh", "-c", 'setsid "$0" src/host-main.ts </dev/null >"$1/host.log" 2>&1 & echo $! >"$1/host.pid"', process.execPath, dir],
  { cwd: ${JSON.stringify(hostOutliner)}, env });
if (r.exitCode !== 0) throw new Error("the host didn't start");
const sock = join(dir, "outlines/.host/host.sock");
for (let i = 0; !existsSync(sock); i++) { if (i > 400) throw new Error("no host socket"); await Bun.sleep(50); }
writeFileSync(out, String(Number(readFileSync(join(dir, "host.pid"), "utf8"))));
await new Promise(() => {});
`);

const started = new Set<string>();
/** A stand-in's scratch folder, made here so afterAll stops what runs from it even when its host never came up. */
const scratchFor = () => { const dir = mkdtempSync(join(root, "ep0ch-im-")); started.add(dir); return dir; };
/** The host's pid, once the stand-in has written it. */
async function hostOf(out: string): Promise<number> {
  await until(() => existsSync(out), "the stand-in's host", 30_000);
  const pid = Number(readFileSync(out, "utf8"));
  expect(alive(pid)).toBe(true);
  return pid;
}

afterAll(() => {
  // A red run leaves the host it shows: stopped here, by its scratch folder, never by a pattern.
  for (const dir of started) stopUnder(dir);
});

describe.skipIf(!linux)("a scratch folder owns what runs from it (PIE-1360)", () => {
  test("box-test's guard stops a timed-out run's host, though the test wrote its environment whole", async () => {
    // A private prefix of run dirs (`<prefix>-XXXXXXXX`, as box-test's), so the guard's sweep looks only at these.
    const run = join(root, "run-AAAAAAAA"), locks = join(root, "locks"), out = join(root, "guarded.pid"), dir = scratchFor();
    mkdirSync(run);
    writeFileSync(join(run, "run.sh"), `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(child)} ${JSON.stringify(out)} ${JSON.stringify(dir)} whole\n`);
    const g = Bun.spawn(["bash", guard], {
      env: { ...process.env, BOX_DIR: run, BOX_WT: "scratch-procs", BOX_SLOTS: "1", BOX_LOCKS: locks, BOX_MAX: "40" },
      stdout: "pipe", stderr: "pipe",
    });
    const err = new Response(g.stderr).text();
    const pid = await hostOf(out);
    expect(await g.exited, await err).toBe(124);
    expect(await err).not.toContain("LEAK");
    await until(() => !alive(pid), "the host to stop", 10_000);
    expect(processesUnder(dir)).toEqual([]);
  }, 90_000);

  test("a TERM to the test stops its scratch folder's host before it exits", async () => {
    const out = join(root, "termed.pid"), dir = scratchFor();
    const p = Bun.spawn([process.execPath, child, out, dir, "own"], { stdout: "ignore", stderr: "pipe" });
    try {
      const pid = await hostOf(out);
      p.kill("SIGTERM");
      expect(await p.exited).toBe(143);
      expect(alive(pid)).toBe(false);
      expect(processesUnder(dir)).toEqual([]);
    } finally { p.kill("SIGKILL"); }
  }, 60_000);
});
