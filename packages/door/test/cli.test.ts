// The `ep0ch` command: help, the clients list (every role the service reports), and a service that isn't there.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { clientRows, formatClients } from "../src/control";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

describe("ep0ch clients", () => {
  test("lists every role, including observers and roles this door doesn't know yet", () => {
    const text = formatClients(clientRows([
      { role: "tree", clientId: "tree-1", runtime: { paneId: "wX:p1", hostname: "shed" }, currentTarget: { kind: "block", blockId: "11111111-2222-4333-8444-555555555555" } },
      { role: "observer", clientId: "ep0ch-door-7" },
      { role: "a-role-from-the-future", clientId: "x-9", runtime: { paneId: "wX:p2" } },
    ]));
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^role\s+pane\s+host\s+reading\s+clientId$/);
    expect(lines[1]).toMatch(/^tree\s+wX:p1\s+shed\s+block 11111111\s+tree-1$/);
    expect(lines[2]).toMatch(/^observer\s+—\s+—\s+—\s+ep0ch-door-7$/);
    expect(lines[3]).toMatch(/^a-role-from-the-future\s+wX:p2/);
  });

  test("an empty service says so", () => {
    expect(formatClients([])).toBe("no clients connected");
  });
});

describe("ep0ch command", () => {
  test("help prints the usage and exits 0", async () => {
    const r = await run(["help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ep0ch clients");
    expect(r.out).toContain("ep0ch try");
    expect(r.out).toContain("ep0ch outline list [--all] [--archived] [--lines] | attach <name>");
    expect(r.out).toContain("--all lists every machine's");
    expect(r.out).toContain("ep0ch show <id>… [--source");
    expect(r.out).toContain("ep0ch status");
  });

  test("clients against a socket with no service says no carrier and exits 1", async () => {
    const r = await run(["clients"], { EP0CH_SOCKET: "/nonexistent/ep0ch-test/outliner.sock" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no carrier");
  });
});

describe.skipIf(!outliner)("ep0ch clients against a scratch service", () => {
  const scratch = new Scratch();
  let sock = "";
  beforeAll(async () => { sock = await scratch.start(); });
  afterAll(async () => { await scratch.dispose(); });

  test("lists the service's clients and exits 0", async () => {
    const r = await run(["clients"], { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name });
    expect(r.code).toBe(0);
    expect(r.out.trim().length).toBeGreaterThan(0);
    expect(r.out).toMatch(/^(role\s+pane|no clients connected)/);
  });
});
