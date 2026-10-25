// `ep0ch artifact lease` and `ep0ch device` (PIE-1267) through the real command, against a scratch host with a
// fictional outline: the lease prints a curl line for the outline it was asked of, a device's link is shown once and
// listed without its token, and revoking it is said. What the links then do is the outliner's artifact-handover test.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string>) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

describe.skipIf(!outliner)("ep0ch artifact lease and ep0ch device", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {};
  beforeAll(async () => { env = { ...scratch.env, EP0CH_SOCKET: await scratch.start() }; }, 30_000);
  afterAll(async () => { await scratch.dispose(); });

  test("a lease prints the curl for one upload; a bad name is refused with what a name is", async () => {
    const made = await run(["artifact", "lease", "orrery"], env);
    expect(made.code, made.err).toBe(0);
    expect(made.out.trim()).toMatch(/^curl -sS -T <file> 'https:\/\/my\.ep0ch\.sh\/_upload\/[A-Za-z0-9_-]{40,}\/'$/);
    expect(made.err).toContain("one upload of orrery");
    expect(made.err).toContain(`${scratch.name}'s note for today`);
    const json = JSON.parse((await run(["artifact", "lease", "--json"], env)).out);
    expect(json).toMatchObject({ outline: scratch.name });
    expect(json.name).toBeUndefined();
    const bad = await run(["artifact", "lease", "not a name"], env);
    expect(bad.code).not.toBe(0);
  }, 30_000);

  test("a device's link is shown once, listed without its token, and revoked", async () => {
    const added = await run(["device", "add", "Fictional Phone"], env);
    expect(added.code, added.err).toBe(0);
    const link = added.out.match(/https:\/\/\S+\/_upload\/(\S+)/)!;
    expect(link[1]!.length).toBeGreaterThan(40);
    expect(added.out).toContain("shown once");
    const listed = await run(["device", "ls"], env);
    expect(listed.out).toContain("Fictional Phone");
    expect(listed.out).toContain(`cards go to ${scratch.name}`);
    expect(listed.out).not.toContain(link[1]!);
    const twice = await run(["device", "add", "fictional phone"], env);
    expect(twice.code).not.toBe(0);
    expect(twice.err).toContain("already set up");
    const revoked = await run(["device", "revoke", "Fictional Phone"], env);
    expect(revoked.code, revoked.err).toBe(0);
    expect(revoked.out).toContain("revoked: Fictional Phone");
    expect((await run(["device", "ls"], env)).out).toContain("revoked");
  }, 30_000);
});
