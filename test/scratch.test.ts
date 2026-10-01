// The scratch helpers themselves: a killed run's temp dirs are cleared by the next one, and nothing else is.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchDir } from "./scratch";

test("scratchDir removes its prefix's dirs whose test process is gone, and keeps live, unmarked, other-namespace and other dirs", async () => {
  const prefix = `ep0ch-prune-check-${process.pid}-`;
  const gone = Bun.spawn(["true"]);
  await gone.exited;
  const live = Bun.spawn(["sleep", "30"]);
  let space = "";
  try { space = readlinkSync("/proc/self/ns/pid"); } catch { /* no pid namespaces here */ }
  const mk = (pid: number | null, p = prefix, ns = space) => {
    const d = mkdtempSync(join(tmpdir(), p));
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
