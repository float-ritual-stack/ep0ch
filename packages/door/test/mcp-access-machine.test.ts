// PIE-1037: the access view reads the machine that serves the gateway. The MCP gateway, its caps (mcp.env) and its usage
// records live on one machine; a door on another (this machine here) used to show its own empty usage and default caps.
// Now `ep0ch mcp access --matrix --machine <ssh-name>` (and the door's tile, for an outline on that machine) asks that
// machine's outline host for its caps and usage and says so. The other machine is a scratch host behind the fake ssh;
// made-up callers (far-bot, near-bot) and outlines. Also: the CLI's usage line keeps each cell in its column.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildMatrix, matrixLines } from "../src/mcp-access-matrix";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const MAIN = resolve(import.meta.dir, "../src/main.ts");

describe.skipIf(!outliner)("the access view reads the gateway's machine (PIE-1037)", () => {
  const far = new ScratchHost();    // the machine that serves the gateway: its caps and usage
  const near = new ScratchHost();   // this machine: its own caps, no usage
  let dir = "";

  beforeAll(async () => {
    // The far host looks for usage under its own HOME, as a machine's does: not under this test run's state folder.
    const kept = { s: process.env.XDG_STATE_HOME, e: process.env.EP0CH_STATE };
    delete process.env.XDG_STATE_HOME; delete process.env.EP0CH_STATE;
    try { await far.start(); } finally { if (kept.s !== undefined) process.env.XDG_STATE_HOME = kept.s; if (kept.e !== undefined) process.env.EP0CH_STATE = kept.e; }
    await near.start();
    await far.create("garden");
    dir = scratchDir("ep0ch-access-machine-");
    for (const d of ["bin", "far-home", "state"]) mkdirSync(join(dir, d), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "bin/ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`);
    writeFileSync(join(dir, "bin/ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${MAIN} "$@"\n`);
    for (const f of ["ssh", "ep0ch"]) chmodSync(join(dir, "bin", f), 0o755);
    // The far machine: a cap for far-bot and a week of its calls, where its host looks (the host's HOME and config).
    mkdirSync(join(far.config, "ep0ch"), { recursive: true });
    writeFileSync(join(far.config, "ep0ch", "mcp.env"), "EP0CH_MCP_PATH_ACCESS=far-bot=read\n", { mode: 0o600 });
    const day = new Date().toISOString().slice(0, 10);
    const usageDir = join(far.env.HOME!, ".local/state/ep0ch-door/mcp-usage");
    mkdirSync(usageDir, { recursive: true });
    const row = { time: new Date(Date.now() - 3_600_000).toISOString(), actor: "mcp:far-bot/claude.ai", tool: "outline_read", outline: "garden", shape: {}, requestBytes: 1, responseBytes: 1, requestTokens: 1, responseTokens: 1, durationMs: 1 };
    writeFileSync(join(usageDir, `${day}.jsonl`), [row, row].map(r => JSON.stringify(r)).join("\n") + "\n");
    // This machine: a different cap, and no usage.
    mkdirSync(join(near.config, "ep0ch"), { recursive: true });
    writeFileSync(join(near.config, "ep0ch", "mcp.env"), "EP0CH_MCP_PATH_ACCESS=near-bot=full\n", { mode: 0o600 });
  }, 60_000);

  afterAll(async () => {
    await near.dispose();
    await far.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  async function ep0ch(args: string[]) {
    const env = {
      ...near.env, PATH: process.env.PATH!, EP0CH_CONTROL: join(dir, "no-door.sock"), EP0CH_STATE: join(dir, "state"),
      EP0CH_SSH: join(dir, "bin/ssh"), FAKE_SSH_HOME: join(dir, "far-home"), FAKE_SSH_OUTLINES: far.outlines, FAKE_SSH_BIN: join(dir, "bin"),
      // The far machine's `ep0ch mcp access` and host must see the far config: the fake ssh runs them with its own HOME.
    };
    const p = Bun.spawn(["bun", MAIN, ...args], { cwd: near.folder("worktree"), env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  }

  test.each([
    ['EP0CH_MCP_PATH_ACCESS = "gpty=read"', "read"],
    ['EP0CH_MCP_PATH_ACCESS="gpty=read" ', "read"],
    ['EP0CH_MCP_PATH_ACCESS=gpty=typo', "none"],
    ['EP0CH_MCP_PATH_ACCESS=gpty', "none"],
    ['EP0CH_MCP_PATH_ACCESS=', null],
  ] satisfies Array<[string, "read" | "none" | null]>)("the matrix explains the file's cap: %s", async (line, level) => {
    const file = join(far.config, "ep0ch/mcp.env");
    writeFileSync(file, line + "\n");
    try {
      const r = await ep0ch(["mcp", "access", "--matrix", "--json", "--machine", "far-box"]);
      expect(r.code).toBe(0);
      const m = JSON.parse(r.out) as ReturnType<typeof buildMatrix>;
      expect(m.caps.from).toBe("file");
      if (level !== null) {
        const bot = m.callers.findIndex(c => c.name === "gpty");
        expect(bot).toBeGreaterThanOrEqual(0);
        expect(m.cells[bot]![0]!.cap?.level).toBe(level);
        if (level === "none") expect(m.cells[bot]![0]!.why).toContain("invalid");
      }
    } finally { writeFileSync(file, "EP0CH_MCP_PATH_ACCESS=far-bot=read\n"); }
  }, 90_000);

  test("--machine: the caps and the usage are that machine's, and the matrix says which it read", async () => {
    const r = await ep0ch(["mcp", "access", "--matrix", "--json", "--machine", "far-box"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const m = JSON.parse(r.out) as ReturnType<typeof buildMatrix> & { readFrom: string };
    const bot = m.callers.findIndex(c => c.name === "far-bot");
    expect(bot).toBeGreaterThanOrEqual(0);
    expect(m.cells[bot]![0]).toMatchObject({ outline: "garden", usage: { calls: 2 }, cap: { level: "read" } });
    // Not this machine's cap.
    expect(m.callers.some(c => c.name === "near-bot")).toBe(false);
    expect(m.caps.file).toBe(join(far.config, "ep0ch", "mcp.env"));
    expect(m.readFrom).toBe("far-box");
    const words = await ep0ch(["mcp", "access", "--matrix", "--machine", "far-box"]);
    expect(words.out).toContain("Caps and usage are far-box's");
  }, 90_000);
});

describe("the usage line keeps each cell in its column (PIE-1037)", () => {
  test("a cell as wide as its column still has a gap before the next", () => {
    const NOW = Date.parse("2026-10-18T12:00:00Z");
    const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
    const rows = (n: number, outline: string, m: number) => Array.from({ length: n }, () => ({ time: ago(m), actor: "mcp:garden-bot/claude.ai", tool: "outline_read", outline, shape: {}, requestBytes: 1, responseBytes: 1, requestTokens: 1, responseTokens: 1, durationMs: 1 }));
    const m = buildMatrix({
      grants: ["pie", "gurgle", "rotfield"].map(outline => ({ outline, machine: "box", level: "full" as const })),
      capSpec: "garden-bot=full", capFrom: "file", capFile: "", usageDir: "", localMachine: "box", now: NOW,
      usage: [...rows(115, "gurgle", 43), ...rows(58, "pie", 43)],
    });
    const lines = matrixLines(m, NOW);
    const use = lines.find(l => /\d+ calls/.test(l))!;
    // No two cells run together: every cell's text is followed by a space or the line's end.
    expect(use).not.toMatch(/calls \d+m\d/);
    expect(use).not.toMatch(/ago\S/);
    for (const cellText of use.trim().split(/\s{2,}/)) expect(cellText).not.toMatch(/\d+ calls .*\d+ calls/);
  });
});
