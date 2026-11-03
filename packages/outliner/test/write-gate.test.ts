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
  /** The plain CLI (`outliner update|create|comment|move|delete …`), as an agent or the person runs it. */
  const cli = async (args: string[]) => {
    const child = Bun.spawn(["bun", "src/cli.ts", ...args], { cwd: join(import.meta.dir, ".."), env: cliEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout, stderr, json: exitCode === 0 ? JSON.parse(stdout) as Record<string, unknown> : undefined };
  };
  return { store, agent, cli };
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

  test("every writing operation asks the gate: a file touch and figure-fit's comments too; a read of a view's order doesn't", async () => {
    const { store, agent } = await setup();
    const note = store.create("Seed list\n\nTomatoes, beans.");
    const touch = { path: "/garden/plan.md", project: "garden", session: "s-1", added: 2, removed: 0 };
    const notesBefore = store.require(note.id).revision;
    store.configureMcpAccess("propose");
    const proposing = await agent("touch-file", touch);
    expect(proposing.exitCode).toBe(1);
    expect(proposing.stderr).toContain("touch_file writes a file-touch note and can't be proposed: it needs full access (this outline's is propose).");
    store.configureMcpAccess("read");
    const words = noWritesWords("read", { outline: "garden", machine: "shed" });
    const reading = await agent("touch-file", touch);
    expect(reading.exitCode).toBe(1);
    expect(reading.stderr).toContain(words);
    const swept = await agent("figure-fit", { under: note.id, comment: true });
    expect(swept.exitCode).toBe(1);
    expect(swept.stderr).toContain(words);
    // Without comment figure-fit only reads, and a view's order without ids is a read: both answer at read.
    expect((await agent("figure-fit", { under: note.id })).exitCode).toBe(0);
    expect(store.require(note.id).revision).toBe(notesBefore);
    expect((await agent("find", { query: "type=file-touch" })).json).toMatchObject({ blocks: [] });
  });

  test("an outline whose owner never set a level takes a local session's writes as before", async () => {
    const { store, agent } = await setup();
    const note = store.create("Seed list\n\nTomatoes, beans.");
    const r = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "beans", replacement: "beans, kale" }] });
    expect(r.exitCode).toBe(0);
    expect(store.require(note.id).text).toBe("Seed list\n\nTomatoes, beans, kale.");
  });
});

describe("the plain CLI's writes, attributed to an agent (outliner update|create|comment|move|delete --author agent)", () => {
  const as = ["--author", "agent", "--actor", "verifier/claude-code@shed"];
  const seed = (store: OutlinerStore) => {
    const note = store.create("Seed list\n\nTomatoes, beans.");
    const shed = store.create("Shed");
    const child = store.create("Sow in trays", note.id);
    return { note, shed, child };
  };
  const writes = (n: ReturnType<typeof seed>): Array<[string, string[]]> => [
    ["update", ["update", "--id", n.note.id, "--text", "Seed list\n\nKale.", "--expected", String(n.note.revision)]],
    ["create", ["create", "--parent", n.note.id, "--text", "Water at dusk"]],
    ["move", ["move", "--id", n.child.id, "--parent", n.shed.id, "--expected", String(n.child.revision)]],
    ["delete", ["delete", "--id", n.child.id, "--expected", String(n.child.revision)]],
  ];
  const unchanged = (store: OutlinerStore, n: ReturnType<typeof seed>) => {
    expect(store.require(n.note.id).text).toBe("Seed list\n\nTomatoes, beans.");
    expect(store.require(n.note.id).revision).toBe(n.note.revision);
    expect(store.require(n.child.id).parentId).toBe(n.note.id);
    expect(store.require(n.child.id).deletedAt).toBeFalsy();
    // The proposals are comments on the notes; no block was made, moved or trashed.
    expect(store.children(n.note.id).map(b => b.text)).toContain("Sow in trays");
    expect(store.children(n.note.id).map(b => b.text)).not.toContain("Water at dusk");
  };

  test("at propose, update, create, move and delete each become a proposal; a comment lands, as it does over MCP", async () => {
    const { store, cli } = await setup();
    const n = seed(store);
    store.configureMcpAccess("propose");
    for (const [name, args] of writes(n)) {
      const r = await cli([...args, ...as]);
      expect({ name, exitCode: r.exitCode, stderr: r.stderr }).toMatchObject({ name, exitCode: 0 });
      expect({ name, ...r.json }).toMatchObject({ name, outcome: "proposed" });
    }
    unchanged(store, n);
    const c = await cli(["comment", "--id", n.note.id, "--whole", "--text", "Peas too?", "--request-id", "c-1", "--expected", String(n.note.revision), ...as]);
    expect(c.exitCode).toBe(0);
  });

  test("at read, each is refused in the gate's words, a comment too", async () => {
    const { store, cli } = await setup();
    const n = seed(store);
    store.configureMcpAccess("read");
    const words = noWritesWords("read", { outline: "garden", machine: "shed" });
    const all = [...writes(n), ["comment", ["comment", "--id", n.note.id, "--whole", "--text", "Peas too?", "--request-id", "c-1", "--expected", String(n.note.revision)]] as [string, string[]]];
    for (const [name, args] of all) {
      const r = await cli([...args, ...as]);
      expect({ name, exitCode: r.exitCode }).toEqual({ name, exitCode: 1 });
      expect(r.stderr).toContain(words);
    }
    unchanged(store, n);
  });

  test("a new top-level note can't be proposed, in the gate's words", async () => {
    const { store, cli } = await setup();
    store.configureMcpAccess("propose");
    const r = await cli(["create", "--text", "Loose seeds", ...as]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("A new top-level note can't be proposed");
  });

  test("the person's own console (--author user) stays ungated, as nvim would", async () => {
    const { store, cli } = await setup();
    const n = seed(store);
    store.configureMcpAccess("read");
    const r = await cli(["update", "--id", n.note.id, "--text", "Seed list\n\nKale.", "--expected", String(n.note.revision), "--author", "user"]);
    expect(r.exitCode).toBe(0);
    expect(store.require(n.note.id).text).toBe("Seed list\n\nKale.");
  });

  test("at full an agent's CLI writes apply, loki's work stage and work set too", async () => {
    const { store, cli } = await setup();
    const n = seed(store);
    store.configureMcpAccess("full");
    const r = await cli([...writes(n)[0]![1], ...as]);
    expect(r.exitCode).toBe(0);
    expect(store.require(n.note.id).text).toBe("Seed list\n\nKale.");
    store.configureWorkIdPrefix("PIE");
    store.create("Work [type::work-queue] [project::garden]");
    const loki = ["--author", "agent", "--actor", "loki"];
    const made = await cli(["work", "create", "--title", "Turn the heap", "--project", "garden", "--arc", "beds", "--track", "beds", "--priority", "low", ...loki]);
    expect(made.exitCode).toBe(0);
    const { workId, blockId } = made.json as { workId: string; blockId: string };
    expect((await cli(["work", "stage", workId, "doing", ...loki])).exitCode).toBe(0);
    expect((await cli(["work", "set", workId, "arc", "paths", ...loki])).exitCode).toBe(0);
    const props = store.require(blockId).properties;
    expect(props).toEqual(expect.arrayContaining([expect.objectContaining({ key: "work-stage", value: "doing" }), expect.objectContaining({ key: "arc", value: "paths" })]));
  });
});
