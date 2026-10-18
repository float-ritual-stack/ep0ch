// PIE-1034: who can reach what. The matrix reads the grants, the named-path caps and the usage records that already
// exist and combines them with `levelFor`; changing a cell writes the grant or the cap. Scratch hosts and a scratch
// config only; made-up callers (garden-bot, kitty-batch) and outlines.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mcpCommand } from "../src/mcp";
import { applyPlan, buildMatrix, matrixLines, planChange, setPathCap, withCap, type Grant, type GrantSource } from "../src/mcp-access-matrix";
import { recordUsage } from "../src/mcp-usage";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const HOUR = 3_600_000;
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();
const use = (actor: string, outline: string | null, hoursAgo: number) =>
  ({ time: at(hoursAgo), actor, tool: "outline_read", outline, shape: {}, requestBytes: 1, responseBytes: 1, requestTokens: 1, responseTokens: 1, durationMs: 1 });

const grants: Grant[] = [
  { outline: "pie", machine: "box", level: "full" },
  { outline: "gurgle", machine: "box", level: "read" },
  { outline: "rotfield", machine: "box", level: "full" },
  { outline: "vault", machine: "box", level: "none" },
];
const usage = [
  use("mcp:garden-bot/claude.ai", "rotfield", 2), use("mcp:garden-bot/claude.ai", "rotfield", 30), use("mcp:garden-bot/claude.ai", "gurgle", 5),
  use("mcp:claude-code@box", "pie", 1),
  use("mcp:kitty-batch/claude-code@box", "pie", 50),
  use("mcp:old-bot/claude.ai", "pie", 24 * 9),
];
const matrix = (spec: string, rows = usage) => buildMatrix({ grants, capSpec: spec, capFrom: spec ? "file" : "none", capFile: "/cfg/mcp.env", usage: rows, usageDir: "/state/mcp-usage", localMachine: "box", now: NOW });
const cell = (m: ReturnType<typeof matrix>, caller: string, outline: string) =>
  m.cells[m.callers.findIndex(c => c.name === caller)]![m.outlines.findIndex(o => o.outline === outline)]!;

describe("who can reach what", () => {
  test("a named path gets the lower of the outline's grant and its cap, a client gets the grant", () => {
    const m = matrix("garden-bot@gurgle=full,garden-bot=propose");
    // garden-bot came in through the gateway: a named path, capped at propose by default.
    expect(m.callers.find(c => c.name === "garden-bot")?.via).toBe("path");
    expect(cell(m, "garden-bot", "rotfield")).toMatchObject({ level: "propose", grant: "full", limitedBy: "cap", cap: { level: "propose", entry: "garden-bot" } });
    expect(cell(m, "garden-bot", "rotfield").why).toBe("rotfield@box allows full; garden-bot is capped at propose on its named path (EP0CH_MCP_PATH_ACCESS has garden-bot=propose)");
    // The cap for gurgle is full, but gurgle only allows read: the outline limits it.
    expect(cell(m, "garden-bot", "gurgle")).toMatchObject({ level: "read", limitedBy: "grant", cap: { level: "full", entry: "garden-bot@gurgle" } });
    expect(cell(m, "garden-bot", "vault").level).toBe("none");
    // A stdio client has no cap: it gets what the outline allows.
    expect(m.callers.find(c => c.name === "claude-code@box")?.via).toBe("client");
    expect(cell(m, "claude-code@box", "rotfield")).toMatchObject({ level: "full", cap: null, limitedBy: "grant" });
    expect(cell(m, "claude-code@box", "gurgle").level).toBe("read");
    // A persona over stdio is a label, not a path: no cap applies to it.
    expect(cell(m, "kitty-batch", "pie")).toMatchObject({ level: "full", cap: null });
  });

  test("one persona over the gateway (capped) and over stdio (a client) is told apart by its principal", () => {
    const both = buildMatrix({ grants: [{ outline: "pie", machine: "box", level: "full" }], capSpec: "fern=read", capFrom: "file", capFile: "", usageDir: "", localMachine: "box", now: NOW,
      usage: [use("mcp:fern/claude.ai", "pie", 1), use("mcp:fern/claude-code@box", "pie", 2)] });
    // The highest of its principals: the stdio client has no cap, so the cell is the outline's level, and the cap is still reported.
    expect(both.cells[0]![0]).toMatchObject({ level: "full", cap: { level: "read" } });
    const gatewayOnly = buildMatrix({ grants: [{ outline: "pie", machine: "box", level: "full" }], capSpec: "fern=read", capFrom: "file", capFile: "", usageDir: "", localMachine: "box", now: NOW, usage: [use("mcp:fern/claude.ai", "pie", 1)] });
    expect(gatewayOnly.cells[0]![0]).toMatchObject({ level: "read", limitedBy: "cap" });
  });

  test("a path nobody wrote a cap for is capped at propose; a caller only the caps name still has a row", () => {
    const m = matrix("");
    expect(cell(m, "garden-bot", "pie")).toMatchObject({ level: "propose", cap: { level: "propose", entry: null } });
    expect(cell(m, "garden-bot", "pie").why).toContain("no entry names it, so the default cap is propose");
    const named = matrix("night-owl@pie=read");
    expect(named.callers.find(c => c.name === "night-owl")).toMatchObject({ via: "path", calls: 0, lastCall: null });
    expect(cell(named, "night-owl", "pie")).toMatchObject({ level: "read", usage: { calls: 0, lastCall: null } });
  });

  test("recent use sits beside each cell: calls in 7 days and the last call; older calls and other machines' outlines don't count", () => {
    const m = matrix("");
    expect(cell(m, "garden-bot", "rotfield").usage).toEqual({ calls: 2, lastCall: at(2) });
    expect(cell(m, "garden-bot", "pie").usage).toEqual({ calls: 0, lastCall: null });
    // old-bot's only call is nine days old: outside the window, so it has no row.
    expect(m.callers.some(c => c.name === "old-bot")).toBe(false);
    const far = buildMatrix({ grants: [{ outline: "pie", machine: "elsewhere", level: "full" }], capSpec: "", capFrom: "none", capFile: "", usage, usageDir: "", localMachine: "box", now: NOW });
    expect(far.cells[0]![0]!.usage).toBeNull();
  });

  test("the outline's owner keeps full in its own outline, as the gateway decides", () => {
    const owned = buildMatrix({ grants: [{ outline: "scratch-pad", machine: "box", level: "read", owner: "claude.ai" }], capSpec: "", capFrom: "none", capFile: "", usage: [use("mcp:claude.ai", "scratch-pad", 1)], usageDir: "", localMachine: "box", now: NOW });
    expect(owned.cells[0]![0]).toMatchObject({ level: "full", grant: "read" });
  });

  test("the CLI text says each cell as a glyph and a word, marks an unused grant, and says why a caller has less", () => {
    const text = matrixLines(matrix("garden-bot=propose"), NOW).join("\n");
    expect(text).toContain("● full");
    expect(text).toContain("♦ propose");
    expect(text).toContain("✗ none");
    expect(text).toContain("unused");
    expect(text).toContain("2 calls 2h");
    expect(text).toContain("garden-bot in rotfield: rotfield@box allows full; garden-bot is capped at propose");
    expect(text).toContain("No MCP access is set on vault");
  });
});

describe("changing a cell", () => {
  test("lowering a named path writes its cap only; raising a client writes the outline's grant and says whom it affects", () => {
    const m = matrix("garden-bot=propose");
    const down = planChange(m, { caller: "garden-bot", outline: "rotfield", level: "read" });
    if ("error" in down) throw new Error(down.error);
    expect(down.steps.map(s => s.command)).toEqual(["ep0ch mcp access --cap garden-bot@rotfield=read"]);
    const up = planChange(m, { caller: "claude-code@box", outline: "gurgle", level: "propose" });
    if ("error" in up) throw new Error(up.error);
    expect(up.steps.map(s => s.command)).toEqual(["ep0ch mcp access propose --ws gurgle"]);
    expect(up.steps[0]!.affects).toContain("every caller's ceiling");
  });

  test("the owner keeps full whatever the grant, so lowering it is refused with what does work; a duplicate cap is replaced where the gateway reads it", () => {
    const owned = buildMatrix({ grants: [{ outline: "scratch-pad", machine: "box", level: "read", owner: "claude.ai" }, { outline: "pie", machine: "box", level: "full", owner: "claude.ai" }], capSpec: "", capFrom: "none", capFile: "", usage: [use("mcp:claude.ai", "scratch-pad", 1)], usageDir: "", localMachine: "box", now: NOW });
    expect(planChange(owned, { caller: "claude.ai", outline: "pie", level: "read" })).toMatchObject({ error: expect.stringContaining("ep0ch mcp access none --ws pie") });
    expect(withCap("bot=read,bot=full", "bot", "none")).toBe("bot=none");
    expect(withCap("bot=read,other=full,bot=full", "bot", "none")).toBe("other=full,bot=none");
  });

  test("raising a named path past both its cap and the outline's grant needs both writes", () => {
    const m = matrix("garden-bot=propose");
    const plan = planChange(m, { caller: "garden-bot", outline: "gurgle", level: "full" });
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.steps.map(s => s.command)).toEqual(["ep0ch mcp access --cap garden-bot@gurgle=full", "ep0ch mcp access full --ws gurgle"]);
    expect(planChange(m, { caller: "garden-bot", outline: "nowhere", level: "full" })).toMatchObject({ error: expect.stringContaining("no outline nowhere") });
    expect(planChange(m, { caller: "garden-bot", outline: "pie", level: "most" })).toMatchObject({ error: expect.stringContaining("level is one of") });
    const same = planChange(m, { caller: "garden-bot", outline: "pie", level: "propose" });
    if ("error" in same) throw new Error(same.error);
    expect(same.steps).toEqual([]);
  });

  test("a cap is written into mcp.env beside the other settings; the environment wins and is refused", () => {
    const home = scratchDir("ep0ch-matrix-");
    const env = { XDG_CONFIG_HOME: home };
    mkdirSync(join(home, "ep0ch"), { recursive: true });
    const file = join(home, "ep0ch", "mcp.env");
    writeFileSync(file, "# keep me\nEP0CH_MCP_PERSONAS=a=b\nEP0CH_MCP_PATH_ACCESS=garden-bot=propose\n", { mode: 0o600 });
    const done = setPathCap("garden-bot@rotfield", "full", env);
    expect(done.spec).toBe("garden-bot=propose,garden-bot@rotfield=full");
    expect(readFileSync(file, "utf8")).toBe("# keep me\nEP0CH_MCP_PERSONAS=a=b\nEP0CH_MCP_PATH_ACCESS=garden-bot=propose,garden-bot@rotfield=full\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(withCap("garden-bot=propose", "Garden-Bot", "none")).toBe("Garden-Bot=none");
    expect(() => setPathCap("garden-bot", "read", { ...env, EP0CH_MCP_PATH_ACCESS: "x=read" })).toThrow("wins over");
    expect(() => setPathCap("bad key", "read", env)).toThrow("a cap is <persona>");
    // No file yet: it is made, private.
    const fresh = scratchDir("ep0ch-matrix-");
    setPathCap("night-owl", "read", { XDG_CONFIG_HOME: fresh });
    expect(readFileSync(join(fresh, "ep0ch", "mcp.env"), "utf8")).toBe("EP0CH_MCP_PATH_ACCESS=night-owl=read\n");
  });

  test("applyPlan runs each step: the grant through the host, the cap into the file", async () => {
    const home = scratchDir("ep0ch-matrix-");
    const configured: string[] = [];
    const source: GrantSource = { machine: "box", grants: async () => grants, configure: async (o, l) => { configured.push(`${o}=${l}`); }, files: async () => { throw new Error("read in place"); } };
    const plan = planChange(matrix("garden-bot=propose"), { caller: "garden-bot", outline: "gurgle", level: "full" });
    if ("error" in plan) throw new Error(plan.error);
    const ran = await applyPlan(plan, [source], { XDG_CONFIG_HOME: home });
    expect(ran).toEqual(plan.steps.map(s => s.command));
    expect(configured).toEqual(["gurgle=full"]);
    expect(readFileSync(join(home, "ep0ch", "mcp.env"), "utf8")).toContain("garden-bot@gurgle=full");
  });
});

describe.skipIf(!outliner)("ep0ch mcp access --matrix, on a scratch host", () => {
  const host = new ScratchHost();
  const saved: Record<string, string | undefined> = {};
  let state = "";
  const run = async (args: string[]) => {
    const lines: string[] = [];
    const code = await mcpCommand(["mcp", "access", ...args], { write: l => lines.push(l), err: l => lines.push(l) });
    return { code, text: lines.join("\n") };
  };

  beforeAll(async () => {
    const sock = await host.start();
    state = scratchDir("ep0ch-matrix-state-");
    for (const name of ["pie", "gurgle", "rotfield"]) await host.create(name);
    const env = { ...host.env, EP0CH_SOCKET: sock, EP0CH_STATE: state, EP0CH_WS: "pie" };
    for (const k of [...Object.keys(env), "EP0CH_MCP_PATH_ACCESS"]) saved[k] = process.env[k];
    delete process.env.EP0CH_MCP_PATH_ACCESS;
    Object.assign(process.env, env);
    for (const [name, level] of [["pie", "full"], ["gurgle", "read"], ["rotfield", "full"]] as const) expect((await run([level, "--ws", name])).code).toBe(0);
    mkdirSync(join(host.config, "ep0ch"), { recursive: true });
    writeFileSync(join(host.config, "ep0ch", "mcp.env"), "EP0CH_MCP_PATH_ACCESS=garden-bot=propose\n", { mode: 0o600 });
    recordUsage(use("mcp:garden-bot/claude.ai", "rotfield", 1) as Parameters<typeof recordUsage>[0]);
    recordUsage({ ...use("mcp:claude-code@box", "pie", 2), time: new Date(Date.now() - 2 * HOUR).toISOString() } as Parameters<typeof recordUsage>[0]);
  }, 40_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await host.dispose();
  }, 20_000);

  test("reads every outline's real grant, the cap file and the usage records; changes a grant and a cap", async () => {
    const shown = await run(["--matrix", "--json"]);
    expect(shown.code).toBe(0);
    const m = JSON.parse(shown.text) as ReturnType<typeof matrix>;
    expect(m.outlines.map(o => `${o.outline}=${o.level}`)).toEqual(["gurgle=read", "pie=full", "rotfield=full"]);
    expect(m.caps.from).toBe("file");
    const garden = m.callers.findIndex(c => c.name === "garden-bot");
    expect(m.cells[garden]!.map(c => `${c.outline}:${c.level}`)).toEqual(["gurgle:read", "pie:propose", "rotfield:propose"]);
    expect(m.cells[garden]![2]!.usage?.calls).toBe(1);

    const plan = planChange(m, { caller: "garden-bot", outline: "gurgle", level: "full" });
    if ("error" in plan) throw new Error(plan.error);
    const { hostSource } = await import("../src/mcp-access-matrix");
    await applyPlan(plan, [hostSource(host.sock, m.localMachine)]);
    const after = JSON.parse((await run(["--matrix", "--json"])).text) as typeof m;
    expect(after.cells[garden]![0]).toMatchObject({ outline: "gurgle", level: "full", grant: "full" });
    expect(readFileSync(join(host.config, "ep0ch", "mcp.env"), "utf8")).toContain("garden-bot@gurgle=full");

    const words = await run(["--matrix"]);
    expect(words.text).toContain("Who can reach what");
    expect(words.text).toContain("garden-bot (path)");
    expect((await run(["--cap", "garden-bot@pie=none"])).text).toContain("garden-bot@pie is capped at none");
    expect((await run(["--matrix", "full"])).code).toBe(2);
    expect(existsSync(join(host.config, "ep0ch", "mcp.env"))).toBe(true);
  }, 40_000);
});
