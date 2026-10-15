// PIE-850: the tosser's lock waits for another run, and ends with the reason when its folder is gone, never spinning.
// The old loop never yielded once the folder went (a write failing, a stat failing, `continue`), so each case runs in a
// process of its own, killed after a few seconds: a hung or busy one is a failure, not a hung test.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const module = join(import.meta.dir, "../extensions/echonet/lock.ts");

async function probe(setup: (dir: string) => void, then: string, ms = 4000) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "echonet-lock-")));
  try {
    setup(dir);
    const code = `import { lockFile } from ${JSON.stringify(module)};
const file = ${JSON.stringify(join(dir, "box", "toss.lock"))};
${then}`;
    const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), ms);
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    return { out, err, exit, killed: child.signalCode !== null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a free lock is taken and released; a held one is waited for, then taken", async () => {
  const free = await probe(() => {}, `const release = await lockFile(file, true, "t"); console.log(release ? "held" : "no"); release?.(); console.log("released");`);
  expect(free.out).toBe("held\nreleased\n");
  const held = await probe(dir => { mkdirSync(join(dir, "box")); writeFileSync(join(dir, "box", "toss.lock"), "1 other\n"); },
    `setTimeout(() => require("node:fs").rmSync(file, { force: true }), 300); const release = await lockFile(file, true, "t"); console.log(release ? "taken after the other let go" : "no");`);
  expect(held.out).toBe("taken after the other let go\n");
  const nowait = await probe(dir => { mkdirSync(join(dir, "box")); writeFileSync(join(dir, "box", "toss.lock"), "1 other\n"); }, `console.log((await lockFile(file, false, "t")) === undefined ? "gave up" : "held");`);
  expect(nowait.out).toBe("gave up\n");
});

test("the folder going away while it waits ends the wait; it never spins", async () => {
  const gone = await probe(dir => { mkdirSync(join(dir, "box")); writeFileSync(join(dir, "box", "toss.lock"), "1 other\n"); },
    // Held by another run; its folder is deleted a moment later (the outline's folder removed under a running tosser).
    `setTimeout(() => require("node:fs").rmSync(require("node:path").dirname(file), { recursive: true, force: true }), 200);
try { const release = await lockFile(file, true, "t"); console.log(release ? "held" : "gave up"); } catch (error) { console.log("failed: " + error.message); }`);
  expect(gone.killed).toBe(false);
  // It says why: the folder is gone (the write was refused with ENOENT).
  expect(gone.out).toMatch(/^failed: /);
});
