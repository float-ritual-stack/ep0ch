// The Claude mod (packages/claude-mod) runs `ep0ch` and reads what it prints. Its own tests fake every answer, so a
// change to this CLI could break the mod and pass both suites (#174 did). Here the mod's own readers read the real
// CLI, on a scratch host, the way the mod runs it: one argv per command it runs, with Claude Code's FORCE_COLOR.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { Scratch, scratchDir } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
/** The outliner's CLI, which the mod runs (as the installed Outliner's `src/cli.ts`) for mentions. */
const OUTLINER_CLI = join(import.meta.dir, "../../outliner/src/cli.ts");
const mod = (file: string) => import(join(import.meta.dir, "../../claude-mod/hooks", file));

/** This shell's environment without the door, Herdr and outline it may run in: the test names its own. */
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(EP0CH_|HERDR_|OUTLINER_|PI_OUTLINER_)/.test(k))) as Record<string, string>;

type Ran = { exitCode: number; stdout: string; stderr: string };
/** What the mod's `$.process.run` gives back, for argv as the mod writes it (`ep0ch …`). */
async function run(argv: readonly string[], init: { cwd?: string; env?: Record<string, string> } = {}): Promise<Ran> {
  expect(argv[0]).toBe("ep0ch");
  const p = Bun.spawn(["bun", MAIN, ...argv.slice(1)], {
    cwd: init.cwd, stdout: "pipe", stderr: "pipe",
    // Claude Code's shells set FORCE_COLOR, and the mod's children inherit it.
    env: { ...clean, FORCE_COLOR: "3", ...init.env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { exitCode, stdout, stderr };
}

describe("the CLI the Claude mod runs, read by the mod's own readers", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {};
  let note = "";

  beforeAll(async () => {
    const sock = await scratch.start();
    // Its own door state: `peek` and `act` must never find the person's door.
    env = { ...scratch.env, EP0CH_SOCKET: sock, EP0CH_STATE: join(scratch.root, "door") };
    const board = new SocketBoard(sock, undefined, scratch.name);
    try {
      const make = async (text: string, parentId: string | null = null) => (await board.request<{ id: string }>("create", { parentId, text, author: "agent" })).id;
      note = await make("Seed order [type::errand]\nBroad beans, then the early peas.");
      await make("Ask about netting", note);
    } finally { board.close(); }
  });
  afterAll(() => scratch.dispose());

  test("help: the probes the mod still makes find show --cells and export", async () => {
    const { knowsCells } = await mod("block-view.ts");
    const { knowsExport } = await mod("detail-view.ts");
    const help = await run(["ep0ch", "help"]);
    expect(help.exitCode).toBe(0);
    expect(knowsCells(help.stdout)).toBe(true);
    expect(knowsExport(help.stdout)).toBe(true);
  });

  test("where --json: the binding card's facts, outside a door", async () => {
    const { whereFactsOf } = await mod("binding.ts");
    const cwd = scratchDir("ep0ch-where-");
    const where = await run(["ep0ch", "where", "--json"], { cwd, env }).finally(() => rmSync(cwd, { recursive: true, force: true }));
    expect(where.exitCode).toBe(0);
    expect(whereFactsOf(where.stdout)).toMatchObject({ inDoor: false, here: { machine: expect.any(String), folder: expect.any(String) }, door: null });
  });

  test("where --json: a stale pane and no EP0CH_CONTROL still reach the folder's door, and the mod's reader says so (PIE-715)", async () => {
    const { whereFactsOf } = await mod("binding.ts");
    const root = scratchDir("ep0ch-reach-");
    const state = join(root, "state"), folder = join(root, "folder");
    const place = join(state, "sessions", "local", "garden");
    mkdirSync(place, { recursive: true, mode: 0o700 });
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".ep0ch"), 'ws = "garden"\n');
    const peek = { ok: true, result: { screen: { screen: "Desk", pid: 77, outline: "garden", state: { kind: "desk", panes: [] } }, text: [] } };
    const door = createServer(c => c.on("data", () => c.end(JSON.stringify(peek) + "\n")));
    await new Promise<void>(r => door.listen(join(place, "door.sock"), r));
    const base = { ...env, EP0CH_WS: "garden", EP0CH_STATE: state, HERDR_PANE_ID: "w1:p2P", HERDR_WORKSPACE_ID: "w1" };
    try {
      const reached = await run(["ep0ch", "where", "--json"], { cwd: folder, env: base });
      expect(reached.exitCode).toBe(0);
      const facts = whereFactsOf(reached.stdout);
      expect(facts).toMatchObject({ inDoor: false, reach: { rule: "folder", control: join(place, "door.sock") }, door: { answers: true, outline: "garden" } });
      expect(facts!.reach!.text).toContain("not in a tile of it");
      // The door goes away: it says so, with the command that starts one.
      await new Promise(r => door.close(r));
      const none = await run(["ep0ch", "where", "--json"], { cwd: folder, env: base });
      expect(whereFactsOf(none.stdout)).toMatchObject({ inDoor: false, reach: { rule: "none", control: null }, door: null });
      expect(JSON.parse(none.stdout).reach.text).toContain("starts one");
    } finally { door.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test("show --cells: whole rows of cells the block view draws", async () => {
    const { blockViewArgv, blockCellsOf, loadBlockView, forgetEp0chHelp } = await mod("block-view.ts");
    const cells = blockCellsOf((await run(blockViewArgv(note, 40, 6), { env })).stdout);
    expect(cells).toMatchObject({ id: note, columns: 40 });
    expect(cells!.rows).toBeGreaterThan(0);
    forgetEp0chHelp();
    expect(await loadBlockView(run, note, 40, { env }, 6)).toMatchObject({ kind: "cells", id: note });
  });

  test("export: the note's Markdown body and its children, without front matter", async () => {
    const { exportArgv, exportBodyOf } = await mod("detail-view.ts");
    const ran = await run(exportArgv(note), { env });
    expect(ran.exitCode).toBe(0);
    const body = exportBodyOf(ran.stdout);
    expect(body).toContain("Broad beans, then the early peas.");
    expect(body).toContain("Ask about netting");
    expect(body).not.toStartWith("---");
  });

  test("mentions: only what resolves in the outline is listed, read by the band's own reader (PIE-603)", async () => {
    const { mentionRowsOf, mentionsListArgs } = await mod("mentions-view.ts");
    const outliner = async (args: string[], stdin?: string) => {
      const p = Bun.spawn(["bun", OUTLINER_CLI, ...args], {
        cwd: scratch.workspace, stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe",
        env: { ...clean, ...env, FORCE_COLOR: "3", OUTLINER_WORKSPACE_ROOT: scratch.workspace },
      });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return { exitCode, stdout, stderr };
    };
    // A reply naming the seeded note, a source number from a document, a Work ID no block here has, a page nobody
    // made and a block id this outline never had.
    const text = `Filed under ((${note})); see S-87, PIE-588, [[no-such-page]] and ((00000000-0000-4000-8000-0000000000aa)).`;
    const message = { workspaceRoot: scratch.workspace, agent: "claude", sessionId: "contract-session", messageId: "turn-1", text };
    const ingested = await outliner(["mentions", "ingest"], JSON.stringify(message));
    expect(ingested.stderr).toBe("");
    expect(ingested.exitCode).toBe(0);
    const listed = await outliner(mentionsListArgs("conversation", "contract-session"));
    expect(listed.exitCode).toBe(0);
    const rows = mentionRowsOf(listed.stdout);
    expect(rows.map((row: { id: string | null }) => row.id)).toEqual([note]);
    expect(rows.some((row: { unavailable?: string }) => row.unavailable)).toBe(false);
  });

  test("a refusal reaches the mod plain, with its reason, even under FORCE_COLOR", async () => {
    const { failureReasonOf } = await mod("mention-message.ts");
    const { loadBlockView, forgetEp0chHelp } = await mod("block-view.ts");
    const typo = await run(["ep0ch", "hlep"]);
    expect(typo.exitCode).not.toBe(0);
    expect(typo.stderr).not.toContain("\x1b[");
    expect(failureReasonOf(typo.stderr)).toStartWith("ep0ch: ");
    const missing = "00000000-0000-4000-8000-000000000000";
    const shown = await run(["ep0ch", "export", missing, "--children", "--format", "md", "--out", "-"], { env });
    expect(shown.exitCode).not.toBe(0);
    expect(shown.stderr).not.toContain("\x1b[");
    forgetEp0chHelp();
    const view = await loadBlockView(run, missing, 40, { env }, 6);
    expect(view.kind).toBe("text");
    expect(view.why).not.toContain("\x1b[");
    expect(view.why).not.toStartWith("ep0ch: ");
  });

  test("act and peek with no door: refused plainly, with the reason the mod's tools pass on", async () => {
    const { failureReasonOf } = await mod("mention-message.ts");
    for (const argv of [["ep0ch", "peek"], ["ep0ch", "act", "layout.get", "--as", "contract-test"]]) {
      const ran = await run(argv, { env });
      expect(ran.exitCode).not.toBe(0);
      expect(ran.stderr).not.toContain("\x1b[");
      expect(failureReasonOf(ran.stderr)).toStartWith(`ep0ch: no door runs on ${scratch.name}`);
    }
  });
});
