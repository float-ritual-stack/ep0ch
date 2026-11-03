// PIE-1544: one gate decides what an agent's write becomes. The table is the gate itself (caller, cap and level in,
// outcome and words out); the rest is the Claude mod's path, the CLI's agent operations, against a private scratch
// service as spawned processes: at propose a write becomes a proposal, at read it is refused in the gate's words, and
// on an outline whose owner never set a level a session on this machine writes as before. Fictional notes.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { effectiveLevel, gate, noWritesWords, type Becomes, type GateCaller, type GateStatus } from "../src/write-gate";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";

describe("the gate, as a table", () => {
  const where = { outline: "garden", machine: "shed" };
  // caller, the outline's setting → the level it writes at, and why
  const levels: Array<[string, GateCaller, GateStatus, McpAccessLevel, string]> = [
    ["a client at the grant", { principal: "claude.ai" }, { level: "propose", set: true }, "propose", "grant"],
    ["the outline's maker", { principal: "claude.ai" }, { level: "read", owner: "claude.ai", set: true }, "full", "owner"],
    ["the maker, where the owner said none", { principal: "claude.ai" }, { level: "none", owner: "claude.ai", set: true }, "none", "grant"],
    ["a named path capped at propose", { principal: "chatgpt.com", cap: "propose" }, { level: "full", set: true }, "propose", "cap"],
    ["a cap above the grant", { cap: "full" }, { level: "read", set: true }, "read", "grant"],
    ["a local session, level never set", { local: true }, { level: "none", set: false }, "full", "unset"],
    ["a local session, a host that doesn't say", { local: true }, { level: "none" }, "full", "unset"],
    ["a local session, level set to propose", { local: true }, { level: "propose", set: true }, "propose", "grant"],
    ["a local session, level set to read", { local: true }, { level: "read", set: true }, "read", "grant"],
    ["a client, level never set", {}, { level: "none", set: false }, "none", "grant"],
  ];
  test.each(levels)("%s", (_, caller, status, level, limitedBy) => {
    expect(effectiveLevel(status, caller)).toEqual({ level, limitedBy } as ReturnType<typeof effectiveLevel>);
  });

  // tool, level → what the write becomes
  const outcomes: Array<[string, McpAccessLevel, Becomes]> = [
    ["outline_patch", "full", "applied"], ["outline_patch", "propose", "proposed-patch"], ["outline_patch", "read", "refused"], ["outline_patch", "none", "refused"],
    ["outline_edit", "propose", "proposed-patch"], ["outline_set_property", "propose", "proposed-patch"],
    ["outline_create", "propose", "proposed-comment"], ["outline_move", "propose", "proposed-comment"], ["outline_trash", "propose", "proposed-comment"],
    ["outline_comment", "propose", "applied"], ["outline_reply", "propose", "applied"], ["script_run", "propose", "applied"],
    ["outline_assign_id", "propose", "refused"], ["outline_restore", "propose", "refused"], ["outline_proposal_apply", "propose", "refused"],
    ["view_order", "propose", "refused"], ["sh", "propose", "refused"], ["a_tool_nobody_named", "propose", "refused"],
  ];
  test.each(outcomes)("%s at %s is %s", (tool, level, becomes) => {
    expect(gate({ tool, level, where }).becomes).toBe(becomes);
  });

  test("the words: every refusal names the level, the outline and the command", () => {
    expect(gate({ tool: "outline_patch", level: "read", where }).why).toBe(noWritesWords("read", where));
    expect(noWritesWords("read", where)).toBe("MCP access is read for garden@shed, which takes no writes; its owner runs `ep0ch mcp access propose --ws garden` (proposals) or `… full …` (applied) on shed to allow them.");
    expect(gate({ tool: "outline_assign_id", level: "propose", where }).why).toBe("outline_assign_id stamps the note and can't be proposed: it needs full access (this outline's is propose).");
    expect(gate({ tool: "outline_create", level: "propose", where, top: true }).why).toContain("A new top-level note can't be proposed");
    expect(gate({ tool: "outline_restore", level: "full", proposeOnly: true }).why).toBe("outline_restore brings a note back from Trash and can't be proposed: the note changed since it was read.");
    // A queued settlement at full lands: it is about the proposal, not the note's text.
    expect(gate({ tool: "outline_proposal_apply", level: "full", proposeOnly: true }).becomes).toBe("applied");
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-gate-"));
  const { env, ...paths } = scratchOutline(root, { name: "garden" });
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const cliEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^(HERDR_|OUTLINER_|EP0CH_)/.test(key)) cliEnv[key] = value;
  Object.assign(cliEnv, env, { OUTLINER_FIGURE_FIT: "off", EP0CH_MACHINE_NAME: "shed" });
  /** `outliner agent <op>` as the Claude mod runs it (claude-mod hooks/register.ts). */
  const agent = async (operation: string, input: Record<string, unknown>) => {
    const child = Bun.spawn(["bun", "src/cli.ts", "agent", operation, "--json", JSON.stringify(input), "--actor", "kestrel/claude-code@shed"], { cwd: join(import.meta.dir, ".."), env: cliEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout, stderr, json: exitCode === 0 ? JSON.parse(stdout) as Record<string, unknown> : undefined };
  };
  return { store, agent };
}

describe("the Claude mod's path (outliner agent <op>)", () => {
  test("at propose, a patch, an edit and a new block each become a proposal; the note is unchanged", async () => {
    const { store, agent } = await setup();
    const note = store.create("Seed list\n\nTomatoes, beans.");
    store.configureMcpAccess("propose");
    const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "beans", replacement: "beans, kale" }] });
    expect(patched.exitCode).toBe(0);
    expect(patched.json).toMatchObject({ outcome: "proposed" });
    const edited = await agent("edit", { ref: note.id, expectedRevision: note.revision, append: "Peas in March." });
    expect(edited.exitCode).toBe(0);
    expect(edited.json).toMatchObject({ outcome: "proposed" });
    const made = await agent("create", { parent: note.id, text: "Sow in trays" });
    expect(made.exitCode).toBe(0);
    expect(made.json).toMatchObject({ outcome: "proposed" });
    expect(store.require(note.id).text).toBe("Seed list\n\nTomatoes, beans.");
    expect(store.require(note.id).revision).toBe(note.revision);
  });

  test("at read, each is refused in the gate's words", async () => {
    const { store, agent } = await setup();
    const note = store.create("Seed list\n\nTomatoes, beans.");
    store.configureMcpAccess("read");
    const words = noWritesWords("read", { outline: "garden", machine: "shed" });
    for (const [operation, input] of [
      ["patch", { ref: note.id, revision: note.revision, patches: [{ observed: "beans", replacement: "kale" }] }],
      ["edit", { ref: note.id, expectedRevision: note.revision, text: "Seed list" }],
      ["create", { parent: note.id, text: "Sow in trays" }],
    ] as const) {
      const r = await agent(operation, input);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain(words);
    }
    expect(store.require(note.id).text).toBe("Seed list\n\nTomatoes, beans.");
  });

  test("an outline whose owner never set a level takes a local session's writes as before", async () => {
    const { store, agent } = await setup();
    const note = store.create("Seed list\n\nTomatoes, beans.");
    const r = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "beans", replacement: "beans, kale" }] });
    expect(r.exitCode).toBe(0);
    expect(store.require(note.id).text).toBe("Seed list\n\nTomatoes, beans, kale.");
  });
});
