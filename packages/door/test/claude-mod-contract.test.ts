// The Claude mod (packages/claude-mod) runs `ep0ch` and reads what it prints. Its own tests fake every answer, so a
// change to this CLI could break the mod and pass both suites (#174 did). Here the mod's own readers read the real
// CLI, on a scratch host, the way the mod runs it: one argv per command it runs, with Claude Code's FORCE_COLOR.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { startControl } from "../src/control";
import { Mirror } from "../src/mirror";
import { Desk } from "../src/desk/desk";
import { useShowcaseScreen } from "./showcase/harness";
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

  test("the session guide points agents to making the outline do new things", async () => {
    const { GUIDE_ARGV, guideText } = await mod("outline-guide.ts");
    const guide = await run(GUIDE_ARGV, { env });
    expect(guide.exitCode).toBe(0);
    expect(guideText(guide.stdout)).toContain("ep0ch-extend");
    expect(guideText(guide.stdout)).toContain("ep0ch docs extensions");
  });

  test("peer messages written by the mod can be excluded by plain property keys", async () => {
    const { entryOf, entryArgv } = await mod("peer-log.ts");
    const made = await run(entryArgv(note, entryOf("from", "gardener", Date.now(), "Bring seeds."), "test-agent"), { env });
    expect(made.exitCode).toBe(0);
    const found = await run(["ep0ch", "find", "--query", "type=peer-message peer=gardener", "--ids"], { env });
    expect(found.exitCode).toBe(0);
    expect(found.stdout).toMatch(/\(\([0-9a-f-]+\)\)/);
    const excluded = await run(["ep0ch", "find", "--query", "peer=gardener NOT type=peer-message", "--ids"], { env });
    expect(excluded.exitCode).toBe(0);
    expect(excluded.stdout).not.toMatch(/\(\([0-9a-f-]+\)\)/);
  });

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
        // No test asks the real Jev: a write's review answers from code alone.
        env: { ...clean, OUTLINER_FIGURE_FIT: "off", ...env, FORCE_COLOR: "3", OUTLINER_WORKSPACE_ROOT: scratch.workspace },
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

  test("workboard now: the mod's queries run on the real CLI and its readers take what list prints (PIE-843)", async () => {
    const { ANY_ITEM_QUERY, BOARD_QUERY, BUILD_LOG_QUERY, LIST_LIMIT, listArgs, listedOf, workboardText } = await mod("workboard-now.ts");
    const sock = env.EP0CH_SOCKET!;
    const board = new SocketBoard(sock, undefined, scratch.name);
    try {
      for (const text of [
        "GAR-1 — Water the tomatoes on a timer [type::roadmap-item] [work-stage::doing] [work-id::GAR-1]",
        "GAR-2 — Compost bin sensor [type::roadmap-item] [work-stage::done] [work-id::GAR-2] [needs::sysop: lid alarm volume]",
        "GAR-3 — Seed swap shelf [type::roadmap-item] [work-stage::queued] [work-id::GAR-3] [needs::sysop: which shelf]",
        "Build log, Mar 3 [type::build-log]",
      ]) await board.request("create", { parentId: null, text, author: "agent" });
    } finally { board.close(); }
    const outliner = async (args: string[]) => {
      const p = Bun.spawn(["bun", OUTLINER_CLI, ...args], { cwd: scratch.workspace, stdout: "pipe", stderr: "pipe", env: { ...clean, ...env, FORCE_COLOR: "3" } });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return stdout;
    };
    const items = listedOf(await outliner(listArgs(BOARD_QUERY, LIST_LIMIT)));
    const logs = listedOf(await outliner(listArgs(BUILD_LOG_QUERY, LIST_LIMIT, "id,title,timestamps")));
    const any = listedOf(await outliner(listArgs(ANY_ITEM_QUERY, 1, "id")));
    // The done item's needs::sysop is history, not a wait; the queued one waits.
    expect(items.blocks.map((b: { properties: { key: string; value: string }[] }) => b.properties.find((p: { key: string; value: string }) => p.key === "work-id")?.value).sort()).toEqual(["GAR-1", "GAR-3"]);
    expect(items.complete).toBe(true);
    expect(logs.blocks[0].createdAt).toEqual(expect.any(String));
    expect(any.blocks).toHaveLength(1);
    const text = workboardText({ outline: scratch.name, items: items.blocks, itemsComplete: items.complete, logs: logs.blocks, prs: null }, true);
    expect(text).toContain("- doing (1):\n  - GAR-1 — Water the tomatoes on a timer");
    expect(text).toContain("- waiting on the person (needs::sysop) (1):\n  - GAR-3: which shelf");
    expect(text).toContain("- latest build log: Build log, Mar 3");
  });

  test("orientation notes: the mod's query runs on the real CLI and its reader takes each note's text (PIE-1353)", async () => {
    const { listArgs, listedOf } = await mod("workboard-now.ts");
    const { ORIENT_FIELDS, ORIENT_LIMIT, orientQuery, orientText } = await mod("orient-notes.ts");
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    try {
      for (const text of [
        "How sam works here [orient::sam]\n\n- **Water first:** the beds by the shed.",
        "Rules for everyone [orient::all]\n\n- Close the gate.",
        "How alex works here [orient::alex]\n\n- Prune the pear.",
      ]) await board.request("create", { parentId: null, text, author: "agent" });
    } finally { board.close(); }
    const p = Bun.spawn(["bun", OUTLINER_CLI, ...listArgs(orientQuery("sam"), ORIENT_LIMIT, ORIENT_FIELDS)], { cwd: scratch.workspace, stdout: "pipe", stderr: "pipe", env: { ...clean, ...env, FORCE_COLOR: "3" } });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const notes = listedOf(stdout).blocks;
    expect(notes.map((b: { title: string }) => b.title).sort()).toEqual(["How sam works here", "Rules for everyone"]);
    expect(notes.every((b: { updatedAt?: string }) => typeof b.updatedAt === "string")).toBe(true);
    const text = orientText({ outline: scratch.name, agent: "sam", notes });
    expect(text).toContain("- **Water first:** the beds by the shed.");
    expect(text).toContain("- Close the gate.");
    expect(text).not.toContain("Prune the pear");
  });

  test("the settle check: the mod's three questions run on the real CLI, and its readers join what list --facets thread prints (PIE-1268)", async () => {
    const { settleAsks, SETTLE_DEFAULTS, facetCountsOf, threadsOf } = await mod("settle.ts");
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    try {
      for (const text of [
        "Which bed for the squash? [thread::squash]", "Squash wants the sunny corner [thread::squash] [actor::sam]", "Trellis or ground? [thread::squash]", "Sam, Mar 3: \"trellis, then\" [thread::squash]",
        "Netting for the peas [thread::netting]",
        "GAR-9 — Trellis the squash [type::roadmap-item] [work-id::GAR-9] [work-stage::queued] [thread::netting]",
      ]) await board.request("create", { parentId: null, text, author: "agent" });
    } finally { board.close(); }
    const outliner = async (args: string[]) => {
      const p = Bun.spawn(["bun", OUTLINER_CLI, ...args], { cwd: scratch.workspace, stdout: "pipe", stderr: "pipe", env: { ...clean, ...env, FORCE_COLOR: "3" } });
      const [stdout, exitCode] = await Promise.all([new Response(p.stdout).text(), p.exited]);
      expect(exitCode).toBe(0);
      return stdout;
    };
    const config = { ...SETTLE_DEFAULTS, evanQuery: "actor=sam OR text~\"Sam, \"" };
    const asks = settleAsks(config);
    const [all, evan, shaped] = await Promise.all([asks.all, asks.evan, asks.shaped].map(async a => facetCountsOf(await outliner(a))));
    expect(all.get("squash").count).toBe(4);
    expect(evan.get("squash").count).toBe(2);
    // The ticket is not a note of the conversation; it is what shapes the other thread.
    expect(all.get("netting").count).toBe(1);
    expect(shaped.get("netting").count).toBe(1);
    const far = Date.now() + 2 * 60 * 60_000;
    const threads = threadsOf(all, evan, shaped, far, config);
    expect(Object.fromEntries(threads.map((t: { thread: string; state: string }) => [t.thread, t.state]))).toEqual({ squash: "settled", netting: "shaped" });
  });

  test("the settle settings: the capability note's settle-tuning and settle-outlines properties read back through the real CLI, the newest edit winning (PIE-1299)", async () => {
    const { settleNoteArgs, settleNotesOf, newestWith, tuningOf, outlinesOf } = await mod("settle.ts");
    const listed = async () => {
      const p = Bun.spawn(["bun", OUTLINER_CLI, ...settleNoteArgs()], { cwd: scratch.workspace, stdout: "pipe", stderr: "pipe", env: { ...clean, ...env, FORCE_COLOR: "3" } });
      const [stdout, exitCode] = await Promise.all([new Response(p.stdout).text(), p.exited]);
      expect(exitCode).toBe(0);
      return settleNotesOf(stdout);
    };
    // An outline no note of which carries the property answers an empty list, not an error: the check must not read that as a failed read.
    expect(await listed()).toEqual([]);
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    try {
      for (const text of [
        "Settle, then shape [type::capability] [settle-tuning::chirps=9]",
        "Another capability [type::capability] [settle-tuning::chirps=2; base=thread AND NOT thread=lounge]",
        "A capability with no tuning [type::capability]",
        "Outlines only [type::capability] [settle-outlines::gurgle@far-box, pie]",
        "A plain note [settle-tuning::chirps=7]",
      ]) await board.request("create", { parentId: null, text, author: "agent" });
    } finally { board.close(); }
    const notes = await listed();
    expect(notes.map((n: { tuning?: string }) => n.tuning ?? "").sort()).toEqual(["", "chirps=2; base=thread AND NOT thread=lounge", "chirps=9"]);
    const newest = newestWith(notes, "tuning");
    // The service stamps the update time; the reader must have taken it (a note edited last wins, whichever it is).
    expect(newest.updatedAt).toBe(Math.max(...notes.filter((n: { tuning?: string }) => n.tuning).map((n: { updatedAt: number }) => n.updatedAt)));
    expect(tuningOf("chirps=2; base=thread AND NOT thread=lounge").problems).toEqual([]);
    expect(outlinesOf(newestWith(notes, "outlines").outlines, null)).toEqual({ outlines: [{ outline: "gurgle", machine: "far-box" }, { outline: "pie" }], problems: [] });
  });

  test("addressed mail: the mod's three reads run on the real CLI, and asksOf joins what they print into the open asks to a persona (PIE-1404)", async () => {
    const { mentionArgs, readArgs, repliesArgs, threadsToRead, asksOf } = await mod("addressed.ts");
    const { listedOf } = await mod("workboard-now.ts");
    const outliner = async (args: string[], stdin?: string) => {
      const p = Bun.spawn(["bun", OUTLINER_CLI, ...args], { cwd: scratch.workspace, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe", env: { ...clean, ...env, FORCE_COLOR: "3" } });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(exitCode, stderr).toBe(0);
      return stdout;
    };
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    let beds = "", peas = "";
    try {
      beds = (await board.request<{ id: string }>("create", { parentId: null, text: "Bed rotation\nSquash moves to the north bed.", author: "user" })).id;
      peas = (await board.request<{ id: string }>("create", { parentId: null, text: "Pea trellis\nTwine or mesh?", author: "user" })).id;
    } finally { board.close(); }
    const revision = async (id: string) => JSON.parse(await outliner(["read", id, "--fields", "id,revision"])).blocks[0].revision as number;
    const comment = async (id: string, text: string, key: string, actor?: string) =>
      JSON.parse(await outliner(["comment", "--id", id, "--expected", String(await revision(id)), "--whole", "--text", text, "--request-id", key, ...(actor ? ["--author", "agent", "--actor", actor] : [])])).annotations[0].block.id as string;
    // The person asks loki on one note; daddy asks nobody on the other, and kitty names loki in a reply there.
    const asked = await comment(beds, "@loki move the squash this week?", "ask-1");
    const other = await comment(peas, "Mesh, I think.", "ask-2", "mcp:daddy/claude.ai");
    const reply = (thread: string, body: string, actor: string) => outliner(["agent", "reply", "--stdin", "--actor", actor], JSON.stringify({ thread, body }));
    await reply(other, "@loki the trellis note needs your call", "kitty/claude-code@test");
    const read = async () => {
      const mentioning = listedOf(await outliner(mentionArgs("loki")));
      expect(mentioning.complete).toBe(true);
      const { threads, roots } = threadsToRead(mentioning.blocks);
      const first = roots.length ? listedOf(await outliner(readArgs(roots))).blocks : [];
      const notes = [...new Set([...mentioning.blocks, ...first].filter((b: { properties: { key: string; value: string }[] }) => b.properties.some(p => p.value === "annotation")).map((b: { parentId: string }) => b.parentId))];
      const named = listedOf(await outliner(readArgs(notes as string[]))).blocks;
      const replies = (await Promise.all(repliesArgs(threads).map(async (a: string[]) => listedOf(await outliner(a)).blocks))).flat();
      return asksOf("loki", "scratch", mentioning.blocks, [...first, ...named], replies);
    };
    const before = await read();
    expect(before.map((a: { thread: string; from: string; title: string; person: boolean }) => [a.thread, a.from, a.title, a.person])).toEqual([[asked, "Evan", "Bed rotation", true], [other, "kitty", "Pea trellis", false]]);
    // loki answers the person in the thread, from any client: that ask leaves the list; kitty's stays.
    await reply(asked, "Moving it Thursday.", "mcp:loki/claude.ai");
    expect((await read()).map((a: { thread: string }) => a.thread)).toEqual([other]);
  });

  test("outline_comment's kind lands on the thread through the real CLI, as kind and as properties.kind (PIE-871)", async () => {
    const { checkedInput, OUTLINE_TOOLS } = await mod("outline-tools.ts");
    const tool = OUTLINE_TOOLS.find((t: { name: string }) => t.name === "outline_comment");
    const comment = async (args: Record<string, unknown>) => {
      const { input } = checkedInput(tool, { tool: "mcp__ep0ch__outline_comment", agentId: "a1", ...args });
      const command = tool.command(input);
      // As the mod runs it: `agent <operation> --stdin --actor <actor>`, the input as JSON on stdin.
      const p = Bun.spawn(["bun", OUTLINER_CLI, "agent", command.operation, "--stdin", "--actor", "claude-code@test"], { stdin: new Blob([JSON.stringify(command.input)]), stdout: "pipe", stderr: "pipe", env: { ...clean, ...env } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(code, err).toBe(0);
      return JSON.parse(out) as { thread: string; warnings?: string[] };
    };
    const a = (await comment({ ref: note, whole: true, body: "Shipped: the netting goes up in May.", kind: "patch-note" })).thread;
    const b = (await comment({ ref: note, whole: true, body: "Shipped: peas staked.", properties: { kind: "patch-note", tags: ["peas"] } })).thread;
    // A kind no other thread has is kept and said, with the kinds in use and the nearest one.
    const typo = await comment({ ref: note, whole: true, body: "Shipped: beans in.", kind: "patch-notes" });
    expect(typo.warnings?.join("\n")).toContain('kind "patch-notes" is new in this outline (kinds in use: patch-note); did you mean "patch-note"?');
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    try {
      const threads = await board.comments(note);
      expect(threads.find(t => t.id === a)?.props).toMatchObject({ kind: ["patch-note"] });
      expect(threads.find(t => t.id === b)?.props).toMatchObject({ kind: ["patch-note"], tags: ["peas"] });
    } finally { board.close(); }
  });

  test("outline_site reads a note's values through the real CLI, and a typo comes back with its did-you-mean (PIE-533)", async () => {
    const { checkedInput, OUTLINE_TOOLS } = await mod("outline-tools.ts");
    const tool = OUTLINE_TOOLS.find((t: { name: string }) => t.name === "outline_site");
    expect(tool).toBeDefined();
    const { input } = checkedInput(tool, { tool: "mcp__pi-outliner__outline_site", agentId: "a1", ref: note, paths: ["this.type", "this.tpye"] });
    const command = tool.command(input);
    expect(command.operation).toBe("site");
    const p = Bun.spawn(["bun", OUTLINER_CLI, "agent", command.operation, "--stdin", "--actor", "claude-code@test"], { stdin: new Blob([JSON.stringify(command.input)]), stdout: "pipe", stderr: "pipe", env: { ...clean, ...env } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(code, err).toBe(0);
    const answer = JSON.parse(out) as { paths: { values?: string[]; problem?: { didYouMean: string[]; example?: string }; route: string[] }[]; problems: number; deps: string[] };
    expect(answer.paths[0]).toMatchObject({ values: ["errand"] });
    expect(answer.paths[0]!.route.length).toBeGreaterThan(0);
    expect(answer.paths[1]!.problem).toMatchObject({ didYouMean: ["type"], example: "{{this.type}}" });
    expect(answer.problems).toBe(1);
    expect(answer.deps).toContain(note);
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

describe("the mod reads a real door's tile answers", () => {
  const h = useShowcaseScreen();
  test("open returns an address that tile.info accepts, plus the name the mod displays", async () => {
    const { openedTileOf } = await mod("mention-message.ts");
    const desk = new Desk({ name: "garden", title: "Garden", layout: { root: { t: "leaf", kind: "reader", name: "letters" } } });
    h.app.push(desk);
    const ctl = await startControl({ app: h.app, mirror: new Mirror(200, 60), info: () => ({ cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }) }, join(h.scratch.root, "contract.sock"));
    try {
      const env = { ...h.scratch.env, EP0CH_CONTROL: ctl.path };
      const note = await h.board.createBlock(null, "Letters from the allotment\nBring broad beans.");
      const opened = await run(["ep0ch", "open", note.id, "--as", "garden-helper"], { env });
      expect(opened.exitCode).toBe(0);
      const destination = openedTileOf(opened.stdout)!;
      expect(destination.tile).toMatch(/^t-/);
      expect(destination.name).toBe("letters");
      expect(JSON.parse(opened.stdout).reader).toBeUndefined();
      const inspected = await run(["ep0ch", "act", "tile.info", `tile=${destination.tile}`, "--as", "garden-helper"], { env });
      expect({ code: inspected.exitCode, error: inspected.stderr }).toEqual({ code: 0, error: "" });
      expect(JSON.parse(inspected.stdout)).toMatchObject({ tile: destination.tile, name: "letters", showing: { id: note.id } });
      const layout = await run(["ep0ch", "act", "layout.get", "--as", "garden-helper"], { env });
      expect(layout.exitCode).toBe(0);
      const row = JSON.parse(layout.stdout).tiles.find((t: { name: string }) => t.name === "letters");
      expect(row.tile).toBe(destination.tile);
      expect(row.id).toBeUndefined();
      expect(row.address).toBeUndefined();
      expect(JSON.parse(layout.stdout).tree).toMatchObject({ tile: destination.tile, name: destination.name });
      const view = await run(["ep0ch", "act", "view.get", "--as", "garden-helper"], { env });
      expect(view.exitCode).toBe(0);
      expect(JSON.parse(view.stdout).focus).toMatchObject({ tile: destination.tile, name: destination.name });
      const actions = await run(["ep0ch", "actions"], { env });
      expect(actions.exitCode).toBe(0);
      expect(actions.stdout).toContain("answer: tile: string|null (the destination tile's stable id");
    } finally { ctl.close(); h.app.pop(); desk.dispose(); }
  });
});

describe("peek, read by the mod's own reader and by a script (PIE-1308, PIE-1302)", () => {
  const h = useShowcaseScreen();
  test("--json is one JSON object and nothing else; the default is the compact text; a section is its part alone", async () => {
    const { peekArgv, peekOf } = await mod("outline-tools.ts");
    const ctl = await startControl({ app: h.app, mirror: new Mirror(100, 30), info: () => ({ cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false }) }, join(h.scratch.root, "peek.sock"));
    try {
      const env = { ...h.scratch.env, EP0CH_CONTROL: ctl.path };
      // A script: `ep0ch peek --json | jq .speed` needs stdout to parse whole, with the screen's text in the object.
      const json = await run(["ep0ch", "peek", "--json"], { env });
      expect({ code: json.exitCode, error: json.stderr }).toEqual({ code: 0, error: "" });
      const whole = JSON.parse(json.stdout);
      expect(whole.speed).toMatchObject({ frames: expect.any(Number), reports: expect.any(Number), settle: { n: expect.any(Number) } });
      expect(typeof whole.speed.since).toBe("string");
      expect(Array.isArray(whole.text)).toBe(true);
      // `peek speed` is just that object.
      const speed = await run(["ep0ch", "peek", "speed"], { env });
      expect(JSON.parse(speed.stdout)).toEqual({ ...whole.speed, ...JSON.parse(speed.stdout) });
      expect(Object.keys(JSON.parse(speed.stdout))).toEqual(["since", "frames", "reports", "motionCoalesced", "settle"]);
      // `text` is the screen's lines, plain by default and an array with --json; --json with a section is still JSON.
      const lines = await run(["ep0ch", "peek", "text"], { env });
      expect(lines.stdout).toBe(whole.text.join("\n") + "\n");
      expect(JSON.parse((await run(["ep0ch", "peek", "text", "--json"], { env })).stdout)).toEqual(whole.text);
      expect(JSON.parse((await run(["ep0ch", "peek", "--json", "speed"], { env })).stdout)).toEqual(JSON.parse(speed.stdout));
      // The layout is in brief, as layout.get gives it; --full (or full=true) has each tile whole (PIE-1447).
      expect(whole.layout.brief).toContain("full=true");
      const fullLayout = JSON.parse((await run(["ep0ch", "peek", "layout", "--full"], { env })).stdout);
      expect(fullLayout.brief).toBeUndefined();
      expect(fullLayout.tiles.map((t: any) => t.tile)).toEqual(whole.layout.tiles.map((t: any) => t.tile));
      expect(JSON.parse((await run(["ep0ch", "peek", "layout", "full=true"], { env })).stdout).brief).toBeUndefined();
      // The default is text a few KB long, not the state.
      const compact = await run(["ep0ch", "peek"], { env });
      expect(compact.exitCode).toBe(0);
      expect(compact.stdout).toContain("person {");
      expect(compact.stdout.length).toBeLessThan(json.stdout.length / 4);
      expect(compact.stdout.trimStart().startsWith("{")).toBe(false);
      // A section that isn't one says which there are.
      const nope = await run(["ep0ch", "peek", "nope"], { env });
      expect(nope.exitCode).toBe(1);
      expect(nope.stderr).toContain("its sections: screen, stack");
      // The mod: the compact text by default, the whole state when it asks for it, one part by its name.
      expect(peekOf(compact.stdout)).toEqual({ text: compact.stdout.trimEnd() });
      const asked = peekArgv({ full: true });
      expect(asked).toEqual({ argv: ["ep0ch", "peek", "--json"], reads: "full" });
      const full = peekOf(json.stdout, "full");
      expect(full.screen).toMatchObject({ stack: whole.stack, speed: whole.speed });
      expect(typeof full.text).toBe("string");
      expect(peekOf(speed.stdout, "section")).toEqual({ section: JSON.parse(speed.stdout) });
      expect(peekArgv({ section: "speed", full: true })).toContain("one part of the state");
      // Each tile whole is its own ask (PIE-1447): `full` stays the whole state, each tile still in brief.
      expect(peekArgv({ section: "layout", tiles: "full" })).toEqual({ argv: ["ep0ch", "peek", "layout", "--full"], reads: "section" });
      expect(peekArgv({ tiles: "full" })).toEqual({ argv: ["ep0ch", "peek", "--json", "--full"], reads: "full" });
      // A name every object has is no section.
      const proto = await run(["ep0ch", "peek", "constructor"], { env });
      expect(proto.exitCode).toBe(1);
      expect(proto.stderr).toContain("peek has no section constructor");
    } finally { ctl.close(); }
  });
});
