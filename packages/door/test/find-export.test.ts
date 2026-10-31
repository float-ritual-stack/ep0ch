// PIE-534: `ep0ch find --query/--view/--under` and `ep0ch export`, on a scratch host. The outline evaluates every
// selection; the door only asks. Exports go to temp dirs. Fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNoteFile } from "@ep0ch/outline-core/header-line";
import { blockRecord, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { exportFiles, fileName, resolveLinks } from "../src/export";
import { selectionOf, selectionQuery, type BoardAddress } from "../src/notes-cli";
import { queryPage } from "../src/mcp-query";
import { SocketBoard } from "../src/socket";
import { JsonLines, jsonLine } from "../src/jsonl";
import { outliner, Scratch, until } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("the selection flags only write what the outline evaluates", () => {
  test("date flags are query clauses; --query is grouped; ids may be ((id))", () => {
    const r = selectionOf(["--query", "type=chore OR due", "--updated-after", "2026-03-01", "--created-before", "-7d", "--under", "((abcdef12-0000))", "oil"]);
    if ("error" in r) throw new Error(r.error);
    expect(selectionQuery(r.selection)).toBe("(type=chore OR due) updated > 2026-03-01 created < -7d");
    expect(r.selection.under).toBe("abcdef12-0000");
    expect(r.rest).toEqual(["oil"]);
    expect(selectionOf(["--updated-after", "last week"])).toEqual({ error: expect.stringContaining("one date or time") });
    expect(selectionOf(["--view"])).toEqual({ error: "--view needs a value" });
  });

  test("a file name is the title's slug and the id's start", () => {
    expect(fileName({ id: "3d428084-8cb3-4954", title: "Seed order: the plot (spring)" }, "md")).toBe("seed-order-the-plot-spring-3d428084.md");
    expect(fileName({ id: "abcdef12-x", title: "" }, "json")).toBe("note-abcdef12.json");
  });
});

describe("exported files, from records", () => {
  const rec = (id: string, over: Partial<BlockRecord>): BlockRecord => ({
    id, parent: null, title: "", header: [], body: "", text: "", properties: [], fields: [], children: [], tasks: [], links: [], backlinks: [],
    resources: [], created: "2026-03-09T09:00:00.000Z", updated: "2026-03-09T09:30:00.000Z", author: "user", actor: null, revision: 1, ...over,
  });
  const plot = rec("aaaaaaaa-1", { title: "Allotment plot", body: "Allotment plot\nBy the railway.", text: "Allotment plot [type::place]\nBy the railway.", header: [{ key: "type", value: "place" }], children: ["bbbbbbbb-2"] });
  // As the service builds it (outline-core's builder): the links' places in the text, mapped into the body.
  const orderText = "Seed order [tag::seeds] [tag::spring]\nFor ((aaaaaaaa-1|the plot)) and [[Seed list]], not ((ffffffff-9)) or !((aaaaaaaa-1)).";
  const span = (s: string, from = 0): [number, number] => { const i = orderText.indexOf(s, from); return [i, i + s.length]; };
  const order = blockRecord({
    block: { id: "bbbbbbbb-2", parentId: "aaaaaaaa-1", text: orderText, revision: 1, author: "user", createdAt: "2026-03-09T09:00:00.000Z", updatedAt: "2026-03-09T09:30:00.000Z" },
    title: "Seed order", literal: [], children: ["dddddddd-4"], tasks: [], backlinks: [], resources: [],
    properties: [{ key: "tag", value: "seeds", scope: "block", line: 0, column: 11, start: 11 }, { key: "tag", value: "spring", scope: "block", line: 0, column: 24, start: 24 }],
    links: [
      { kind: "block", text: "((aaaaaaaa-1|the plot))", label: "the plot", target: "aaaaaaaa-1", status: "ready", spans: [span("((aaaaaaaa-1|the plot))"), span("((aaaaaaaa-1))")] },
      { kind: "page", text: "[[Seed list]]", label: "Seed list", target: "cccccccc-3", status: "ready", spans: [span("[[Seed list]]")] },
      { kind: "block", text: "((ffffffff-9))", label: "ffffffff-9", target: null, status: "missing", spans: [span("((ffffffff-9))")] },
    ],
  });
  const ask = rec("dddddddd-4", { parent: "bbbbbbbb-2", title: "Ask about netting", body: "Ask about netting\nShe has a roll.", text: "Ask about netting\nShe has a roll." });
  const list = rec("cccccccc-3", { title: "Seed list", body: "Seed list", text: "Seed list [page::Seed list]", header: [{ key: "page", value: "Seed list" }] });
  const byId = new Map([plot, order, ask, list].map(r => [r.id, r]));

  test("md: the header in front matter (a repeated key a list), the prose first in the body, children as nested lists", () => {
    const [f] = exportFiles([order], byId, { format: "md", children: true, split: false, resolveLinks: false });
    expect(f!.name).toBe("seed-order-bbbbbbbb.md");
    expect(f!.content).toBe([
      "---", 'id: "bbbbbbbb-2"', 'parent: "aaaaaaaa-1"', 'path: "/"', 'created: "2026-03-09T09:00:00.000Z"', 'updated: "2026-03-09T09:30:00.000Z"', 'author: "user"',
      'tag: ["seeds", "spring"]', "---",
      "Seed order", "For ((aaaaaaaa-1|the plot)) and [[Seed list]], not ((ffffffff-9)) or !((aaaaaaaa-1)).", "", "- Ask about netting", "  She has a roll.", "",
    ].join("\n"));
    // The file reads back to the note's text, its header line rebuilt with ` - `.
    expect(readNoteFile(f!.content)!.text.split("\n")[0]).toBe("Seed order - [tag::seeds] - [tag::spring]");
  });

  test("--split: each child its own file, the parent lists it; --resolve-links links what was exported, and only that", () => {
    const files = exportFiles([plot, list], byId, { format: "md", children: true, split: true, resolveLinks: true });
    expect(files.map(f => f.name)).toEqual(["allotment-plot-aaaaaaaa.md", "allotment-plot-aaaaaaaa/seed-order-bbbbbbbb.md", "allotment-plot-aaaaaaaa/seed-order-bbbbbbbb/ask-about-netting-dddddddd.md", "seed-list-cccccccc.md"]);
    expect(files[0]!.content).toContain("\n- [Seed order](allotment-plot-aaaaaaaa/seed-order-bbbbbbbb.md)\n");
    // An embed stays an embed; a link to a note that wasn't exported stays as written.
    expect(files[1]!.content).toContain("For [the plot](../allotment-plot-aaaaaaaa.md) and [Seed list](../seed-list-cccccccc.md), not ((ffffffff-9)) or !((aaaaaaaa-1)).");
    // The whole text (a child drawn as a list item) keeps its header line; the same links resolve there.
    expect(resolveLinks(order, new Map([["aaaaaaaa-1", { file: "a.md", title: "A" }]]), true)).toBe("Seed order [tag::seeds] [tag::spring]\nFor [the plot](a.md) and [[Seed list]], not ((ffffffff-9)) or !((aaaaaaaa-1)).");
    // A property naming a note's id is a link in the record, and stays a property in the file.
    const chip = "[source-block::aaaaaaaa-1]";
    const sourced = rec("eeeeeeee-5", { title: "Netting receipt", text: `Netting receipt ${chip}\nPaid in cash.`, body: "Netting receipt\nPaid in cash.",
      links: [{ kind: "property", key: "source-block", text: chip, label: "source-block", target: "aaaaaaaa-1", status: "ready", spans: [[16, 16 + chip.length]], bodySpans: [] }] });
    expect(resolveLinks(sourced, new Map([["aaaaaaaa-1", { file: "a.md", title: "A" }]]), true)).toBe(sourced.text);
  });

  test("json: records with sorted keys; the same records, the same bytes", () => {
    const a = exportFiles([order], byId, { format: "json", children: true, split: false, resolveLinks: false });
    const b = exportFiles([order], new Map([...byId].reverse()), { format: "json", children: true, split: false, resolveLinks: false });
    expect(a).toEqual(b);
    const parsed = JSON.parse(a[0]!.content);
    expect(parsed.map((r: BlockRecord) => r.id)).toEqual(["bbbbbbbb-2", "dddddddd-4"]);
    expect(Object.keys(parsed[0])).toEqual(Object.keys(parsed[0]).sort());
  });
});

describe.skipIf(!outliner)("ep0ch find and export against a scratch host", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const dirs: string[] = [];
  const temp = () => { const d = mkdtempSync(join(tmpdir(), "ep0ch-export-")); dirs.push(d); return d; };
  beforeAll(async () => {
    const sock = await scratch.start();
    env = { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name };
    const board = new SocketBoard(sock, undefined, scratch.name);
    const make = async (key: string, text: string, parentId: string | null = null) => { ids[key] = (await board.request<{ id: string }>("create", { parentId, text, author: "agent" })).id; };
    await make("plot", "Allotment plot [type::place]\nThe plot by the railway.");
    await make("order", "Seed order for the plot [type::errand] - [ctx::2026-03-09 @ 09:27:29 AM] [tag::seeds] [tag::spring]\nBroad beans.\nwhen:: before Friday\n- [ ] order the beans", ids.plot);
    await make("ask", "Ask the neighbour about netting\nShe has a spare roll.", ids.order);
    await make("compost", "Compost rota [type::errand] [rank::2]\nTurn it on Sundays.");
    await make("view", "Errands [type::virtual-branch] [query::type=errand]");
    // A figure block (its rows its child bullets) and a live figure, for export's ASCII twin.
    await make("beans", "Bean rows [type::figures]\n::graph-timeline\n---\ntitle: Bean rows\n---\n::\n\n::graph-check\n---\ntitle: errands (live)\nquery: \"type=errand\"\n---\n::");
    await make("sow", "Apr: sow under glass", ids.beans);
    await make("plant", "**May: plant out**", ids.beans);
    board.close();
  });
  afterAll(async () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); await scratch.dispose(); });

  test.each([{ selection: ["--all"] }, { selection: ["--query", "batch=seed-packets"] }])("export writes all 1,200 selected notes with %j", async ({ selection }) => {
    const board = new SocketBoard(scratch.sock, undefined, scratch.name);
    const wanted: string[] = [];
    try {
      for (let i = 0; i < 1200; i++) wanted.push((await board.createBlock(null, `Packet ${i} [batch::seed-packets]\nSeeds for plot ${i}.`)).id);
      {
        const out = temp();
        const result = await run(["export", ...selection, "--format", "json", "--out", out, "--manifest"], env);
        expect(result.code, result.err).toBe(0);
        const records = readdirSync(out).filter(f => f !== "manifest.json").map(f => JSON.parse(readFileSync(join(out, f), "utf8")));
        expect(wanted.every(id => records.some(r => r.id === id))).toBe(true);
        expect(records.find(r => r.id === wanted.at(-1))?.body).toContain("Seeds for plot 1199.");
      }
    } finally { for (const id of wanted) await board.trash(id); board.close(); }
  }, 120_000);

  test("mirror follows edits within a second, moves a subtree, removes trash and resumes after a host restart", async () => {
    const board = new SocketBoard(scratch.sock, undefined, scratch.name);
    const parent = await board.createBlock(null, "Mirror orchard");
    const child = await board.createBlock(parent.id, "Pear ledger\nBefore the rain.");
    const out = temp();
    const process = Bun.spawn(["bun", MAIN, "mirror", out], { env: { ...globalThis.process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    const errors = new Response(process.stderr).text();
    const manifest = () => JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    const file = () => manifest().files.find((f: string) => f.endsWith(`-${child.id.slice(0, 8)}.md`));
    try {
      await until(() => existsSync(join(out, "manifest.json")) || process.exitCode !== null, "first mirror write");
      if (process.exitCode !== null) throw new Error(await errors);
      const before = manifest();
      const oldFile = file();
      expect(oldFile).toContain(`/pear-ledger-${child.id.slice(0, 8)}.md`);
      await board.request("update", { blockId: child.id, text: "Pear ledger\nFresh words after the rain.", expectedRevision: child.revision, mutation: { author: "user" } });
      await until(() => readFileSync(join(out, oldFile), "utf8").includes("Fresh words after the rain."), "mirrored edit", 1000);
      await board.request("update", { blockId: parent.id, text: "Mirror meadow", expectedRevision: parent.revision, mutation: { author: "user" } });
      await until(() => file() !== oldFile, "renamed ancestor");
      expect(existsSync(join(out, oldFile))).toBe(false);
      expect(readFileSync(join(out, file()), "utf8")).toContain('path: "Mirror meadow"');
      await scratch.restart();
      const fresh = await board.get(child.id);
      await board.request("update", { blockId: child.id, text: "Pear ledger\nWords after restarting the host.", expectedRevision: fresh!.revision, mutation: { author: "user" } });
      await until(() => readFileSync(join(out, file()), "utf8").includes("Words after restarting the host."), "restart catch-up");
      expect(manifest().sequence).toBeGreaterThan(before.sequence);
      expect(manifest().asOf > before.asOf).toBe(true);
      const lastFile = file();
      await board.trash(parent.id);
      await until(() => !existsSync(join(out, lastFile)), "trashed subtree removed");
    } finally {
      process.kill(); await process.exited; await errors;
      await board.trash(parent.id).catch(() => {}); board.close();
    }
    expect((await run(["mirror", out, "--once"], env)).code).toBe(0);
  }, 30_000);

  test("find --query, --under, words and --ids, in outline order; show takes what --ids prints", async () => {
    const q = await run(["find", "--query", "type=errand", "--ids"], env);
    expect(q.out.trim().split("\n")).toEqual([`((${ids.order}))`, `((${ids.compost}))`]);
    const under = await run(["find", "--under", `((${ids.plot}))`, "--lines"], env);
    expect(under.out.trim().split("\n").map(l => l.split("\t").slice(0, 2))).toEqual([[ids.plot!, "Allotment plot"], [ids.order!, "Seed order for the plot"], [ids.ask!, "Ask the neighbour about netting"]]);
    expect((await run(["find", "beans", "--query", "tag=seeds", "--ids"], env)).out.trim()).toBe(`((${ids.order}))`);
    expect((await run(["find", "--updated-after", "-1d", "--query", "type=errand", "--updated-before", "2000-01-01", "--ids"], env)).out.trim()).toBe("");
    const shown = await run(["show", "--width", "60", ...q.out.trim().split("\n")], env);
    expect(shown.code).toBe(0);
    expect(shown.out.split("\n")[0]).toBe("Seed order for the plot");
    expect(shown.out).toContain("Compost rota");
  }, 30_000);

  test("find --sort: a property's order, numbers as numbers, notes without it last; a bad sort says so", async () => {
    expect((await run(["find", "--query", "type=errand", "--sort", "rank", "--ids"], env)).out.trim().split("\n")).toEqual([`((${ids.compost}))`, `((${ids.order}))`]);
    expect((await run(["find", "--query", "type=errand", "--sort", "Rank", "--direction", "DESC", "--ids"], env)).out.trim().split("\n")).toEqual([`((${ids.compost}))`, `((${ids.order}))`]);
    expect((await run(["find", "--query", "type=errand", "--sort", "created", "--direction", "desc", "--ids"], env)).out.trim().split("\n")).toEqual([`((${ids.compost}))`, `((${ids.order}))`]);
    const bad = await run(["find", "--query", "type=errand", "--sort", "[rank::]"], env);
    expect([bad.code, plain(bad.err)]).toEqual([1, expect.stringContaining("--sort [rank::]: Sort by rank, not [rank::]")]);
    const sideways = await run(["find", "--query", "type=errand", "--sort", "rank", "--direction", "sideways"], env);
    expect([sideways.code, plain(sideways.err)]).toEqual([1, expect.stringContaining("Sort direction is asc or desc, not sideways")]);
    expect(plain((await run(["find", "--direction", "asc"], env)).err)).toContain("--direction orders a --sort");
    expect(plain((await run(["find", "--view", ids.view!, "--sort", "rank"], env)).err)).toContain(`ep0ch view order ${ids.view}`);
    // --recent and --tree have their own order: the refusal names --sort and gives the command that sorts.
    const recent = await run(["find", "--recent", "--sort", "due"], env);
    expect([recent.code, plain(recent.err)]).toEqual([2, expect.stringContaining("find --recent takes no --sort")]);
    expect(plain(recent.err)).toContain("ep0ch find --sort due");
    const tree = await run(["find", "--tree", ids.plot!, "--sort", "rank", "--direction", "desc"], env);
    expect([tree.code, plain(tree.err)]).toEqual([2, expect.stringContaining("find --tree takes no --sort")]);
    expect(plain(tree.err)).toContain("find --tree takes no --sort, --direction");
    expect(plain(tree.err)).toContain(`ep0ch find --under ${ids.plot} --sort rank --direction desc`);
    // A second --tree root is dropped with its flag, never left as a search word; a ~ is quoted, never expanded.
    const twice = await run(["find", "--tree", ids.plot!, "--tree", ids.order!, "--sort", "~rank"], env);
    expect(plain(twice.err)).toContain(`without it: ep0ch find --under ${ids.plot} --sort '~rank'\n`);
  }, 30_000);

  test("find --view: the view's members, in its order; with --under, only those under it", async () => {
    expect((await run(["find", "--view", ids.view!, "--ids"], env)).out.trim().split("\n")).toEqual([`((${ids.order}))`, `((${ids.compost}))`]);
    expect((await run(["find", "--view", ids.view!, "--under", ids.plot!, "--ids"], env)).out.trim()).toBe(`((${ids.order}))`);
  }, 30_000);

  // PIE-1277: a [key::value] on line 9 of a long note, found by --property-scope all and by a view that says so.
  test("find --property-scope all: a buried ask, its line and its step's state; a ticked step drops out", async () => {
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    const make = (text: string) => board.request<{ id: string; revision: number; text: string }>("create", { parentId: null, text, author: "agent" });
    const shed = await make(["Shed repairs", "", ...Array.from({ length: 6 }, (_, i) => `Board ${i + 1} is soft.`), "- [ ] Which stain? [asks::neighbour: pick the colour]"].join("\n"));
    const view = await make("Open asks [type::virtual-branch] [query::asks] [property-scope::all]");
    try {
      expect((await run(["find", "--query", "asks", "--ids"], env)).out.trim()).toBe("");
      const found = await run(["find", "--query", "asks", "--property-scope", "all"], env);
      expect(plain(found.out)).toContain("line 9 to do asks: neighbour: pick the colour");
      const [record] = JSON.parse((await run(["find", "--query", "asks", "--property-scope", "all", "--json"], env)).out) as (BlockRecord & { matches: unknown })[];
      expect([record!.id, record!.matches]).toEqual([shed.id, [{ key: "asks", value: "neighbour: pick the colour", line: 9, scope: "inline", task: "todo" }]]);
      expect(plain((await run(["find", "--view", view.id], env)).out)).toContain("line 9 to do asks");
      // outline_query's page (the MCP tool's) asks the same selection: each row says where it matched.
      const page = await queryPage(board as SocketBoard & { address: BoardAddress }, { query: "asks", propertyScope: "all", limit: 5, offset: 0 });
      if ("error" in page) throw new Error(page.error);
      expect(page.rows.map(r => [r.record.id, r.matched?.map(m => [m.line, m.task])])).toEqual([[shed.id, [[8, "todo"]]]]);
      expect(plain((await run(["find", "--view", view.id, "--property-scope", "all"], env)).err)).toContain("[property-scope::]");
      expect(plain((await run(["find", "--property-scope", "everywhere", "--query", "asks"], env)).err)).toContain("--property-scope is block, line, inline, all");
      await board.request("update", { blockId: shed.id, expectedRevision: shed.revision, text: shed.text.replace("- [ ] Which", "- [x] Which"), mutation: { author: "user" } });
      expect((await run(["find", "--query", "asks", "--property-scope", "all", "--ids"], env)).out.trim()).toBe("");
    } finally {
      await board.request("delete", { blockId: shed.id }).catch(() => {});
      await board.request("delete", { blockId: view.id }).catch(() => {});
      board.close();
    }
  }, 30_000);

  // PIE-1460: a note a tool stamped [machine::…] is left out of a query, said with this command's flag, which finds it.
  test("find --machinery: hidden by default and said as the flag; show finds it under --query and --under; a view keeps its own", async () => {
    const board = new SocketBoard(env.EP0CH_SOCKET!, undefined, scratch.name);
    const make = (text: string, parentId: string | null = null) => board.request<{ id: string }>("create", { parentId, text, author: "agent" });
    const shelf = await make("Potting shelf");
    const tally = await make("Tray count, written by a tool [type::tally] [machine::tray-counter]", shelf.id);
    try {
      const hidden = await run(["find", "--query", "type=tally", "--ids"], env);
      expect(hidden.out.trim()).toBe("");
      expect(plain(hidden.err)).toContain("--machinery show");
      expect((await run(["find", "--query", "type=tally", "--machinery", "show", "--ids"], env)).out.trim()).toBe(`((${tally.id}))`);
      expect((await run(["find", "--under", shelf.id, "--machinery", "only", "--ids"], env)).out.trim()).toBe(`((${tally.id}))`);
      expect(plain((await run(["find", "--view", ids.view!, "--machinery", "show"], env)).err)).toContain("[machinery::]");
      expect(plain((await run(["find", "--machinery", "show"], env)).err)).toContain("--machinery says what a --query or --under holds");
      expect(plain((await run(["find", "--query", "type=tally", "--machinery", "all"], env)).err)).toContain("--machinery is hide, only, show");
    } finally {
      await board.request("delete", { blockId: tally.id }).catch(() => {});
      await board.request("delete", { blockId: shelf.id }).catch(() => {});
      board.close();
    }
  }, 30_000);

  test("find --json: block records, built by the service", async () => {
    const [r] = JSON.parse((await run(["find", "--query", "tag=spring", "--json"], env)).out) as BlockRecord[];
    expect(r).toMatchObject({ id: ids.order, title: "Seed order for the plot", parent: ids.plot, children: [ids.ask], properties: [{ key: "type", values: ["errand"] }, { key: "ctx", values: ["2026-03-09 @ 09:27:29 AM"] }, { key: "tag", values: ["seeds", "spring"] }, { key: "when", values: ["before Friday"] }], tasks: [{ status: "todo", text: "order the beans" }] });
  }, 30_000);

  test("export md writes each figure as its ASCII twin, answered from the outline; --source keeps the block", async () => {
    const r = await run(["export", ids.beans!], env);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::graph-");
    expect(r.out).toMatch(/\+-+ \[ BEAN ROWS \] -+\+/);
    expect(r.out).toContain("| ●  Apr  sow under glass");
    expect(r.out).toContain("| ●  May  plant out");
    expect(r.out).toMatch(/\[ \]  Seed order for the plot/);
    expect(r.out).toContain("live · 2 results |");
    expect(r.out).not.toMatch(/\x1b/);
    const raw = await run(["export", ids.beans!, "--source"], env);
    expect(raw.out).toContain("::graph-timeline\n---\ntitle: Bean rows");
  }, 30_000);

  test("export md to a folder: front matter verbatim, deterministic, a manifest only when asked", async () => {
    const out = temp();
    const r = await run(["export", "--query", "type=place", "--children", "--split", "--out", out], env);
    expect(r.code).toBe(0);
    const folder = `allotment-plot-${ids.plot!.slice(0, 8)}`;
    const orderFile = `${folder}/seed-order-for-the-plot-${ids.order!.slice(0, 8)}.md`;
    expect(existsSync(join(out, folder, `seed-order-for-the-plot-${ids.order!.slice(0, 8)}`, `ask-the-neighbour-about-netting-${ids.ask!.slice(0, 8)}.md`))).toBe(true);
    const order = readFileSync(join(out, orderFile), "utf8");
    expect(order).toContain('\nctx: "2026-03-09 @ 09:27:29 AM"\ntag: ["seeds", "spring"]\n---\nSeed order for the plot\nBroad beans.\nwhen:: before Friday\n');
    expect(order).toContain(`\nparent: "${ids.plot}"\n`);
    const again = temp();
    await run(["export", "--query", "type=place", "--children", "--split", "--out", again, "--manifest"], env);
    expect(readFileSync(join(again, orderFile), "utf8")).toBe(order);
    expect(order).toContain('path: "Allotment plot"');
    const manifest = JSON.parse(readFileSync(join(again, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ outline: scratch.name, format: "md", selection: { query: "type=place" }, exportedAt: expect.any(String) });
    expect(manifest.leftOut.length).toBeGreaterThan(0);
    expect(manifest.leftOut[0]).toMatchObject({ id: expect.any(String), extension: expect.any(String), reason: "extension page outside selection" });
  }, 30_000);

  test("export json to stdout; refusals say what to run", async () => {
    const json = JSON.parse((await run(["export", `((${ids.order}))`, "--format", "json"], env)).out) as BlockRecord[];
    expect(json.map(r => r.id)).toEqual([ids.order!]);
    const split = await run(["export", ids.order!, "--children", "--split"], env);
    expect([split.code, plain(split.err)]).toEqual([2, expect.stringContaining(`ep0ch export ${ids.order} --children --split --out ./notes`)]);
    const nosplit = await run(["export", ids.order!, "--split", "--out", temp()], env);
    expect([nosplit.code, plain(nosplit.err)]).toEqual([2, expect.stringContaining("--split --out")]);
    expect(plain(nosplit.err)).toContain(" --children");
    const missing = await run(["export", "beans"], env);
    expect([missing.code, plain(missing.err)]).toEqual([1, expect.stringContaining("No note beans")]);
    const under = await run(["find", "--under", "00000000-0000-4000-8000-000000000000", "--ids"], env);
    expect([under.code, plain(under.err)]).toEqual([1, expect.stringContaining("no note 00000000-0000-4000-8000-000000000000 in this outline")]);
    expect((await run(["find", "--ids", "--json", "--query", "type=errand"], env)).code).toBe(2);
    expect((await run(["export", ids.order!, "--bogus"], env)).code).toBe(2);
    expect((await run(["export"], env)).code).toBe(2);
    expect((await run(["export", ids.order!, "--format", "pdf"], env)).code).toBe(2);
    const bad = await run(["find", "--query", "type=(", "--ids"], env);
    expect([bad.code, plain(bad.err)]).toEqual([1, expect.stringContaining('ep0ch find --query "type=chore')]);
    const view = await run(["find", "--view", "00000000-0000-4000-8000-000000000000"], env);
    expect([view.code, plain(view.err)]).toEqual([1, expect.stringContaining("ep0ch find --query type=virtual-branch")]);
    expect((await run(["find", "--tree", "--query", "type=errand"], env)).code).toBe(2);
  }, 30_000);
});

describe.skipIf(!outliner)("mirror interrupted snapshots and forwards", () => {
  const scratch = new Scratch();
  const notes = new Map<string, string>();
  let board: SocketBoard;
  let serial = 0;
  const directory = () => join(scratch.root, `mirror-${++serial}`);
  beforeAll(async () => {
    await scratch.start();
    board = new SocketBoard(scratch.sock, undefined, scratch.name);
    for (const root of await board.roots()) await board.trash(root.id);
    for (let i = 0; i < 1001; i++) {
      const text = `Orchard packet ${i}\nSeeds for row ${i}.`;
      notes.set((await board.createBlock(null, text)).id, text);
    }
  }, 60_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  function mirror(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
    const child = Bun.spawn([process.execPath, MAIN, "mirror", dir, "--ws", scratch.name, ...args], {
      env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock, ...env }, stdout: "ignore", stderr: "pipe",
    });
    let errors = "";
    const drained = (async () => { for await (const chunk of child.stderr) errors += Buffer.from(chunk).toString(); })();
    return {
      child, errors: () => errors,
      manifest: () => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { files: string[]; leftOut: unknown[]; sequence: number },
      async ready() {
        await until(() => existsSync(join(dir, "manifest.json")) || child.exitCode !== null, "mirror snapshot after interruption", 10_000);
        expect(child.exitCode, errors).toBeNull();
      },
      async stop() { if (child.exitCode === null) child.kill(); await child.exited; await drained; },
    };
  }

  // Hold a real host reply so the concurrent change lands at the page/read boundary, without replacing the service.
  async function relay(beforeReply: (action: string, reply: any) => Promise<void>) {
    const path = join(scratch.root, `relay-${++serial}.sock`), sockets = new Set<Socket>();
    let failure: unknown;
    const server = createServer(client => {
      const host = connect(scratch.sock), requests = new Map<string, string>();
      sockets.add(client); sockets.add(host);
      const end = () => { client.destroy(); host.destroy(); sockets.delete(client); sockets.delete(host); };
      for (const socket of [client, host]) { socket.on("error", end); socket.on("close", end); }
      const outgoing = new JsonLines(request => requests.set(request.id, request.action));
      client.on("data", data => outgoing.feed(data));
      client.pipe(host);
      let pending = Promise.resolve();
      const incoming = new JsonLines(reply => {
        const action = requests.get(reply.id) ?? "";
        requests.delete(reply.id);
        pending = pending.then(async () => { await beforeReply(action, reply); client.write(jsonLine(reply)); })
          .catch(error => { failure = error; end(); });
      });
      host.on("data", data => incoming.feed(data));
    });
    await new Promise<void>(resolve => server.listen(path, resolve));
    return { path, async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (failure) throw failure;
    } };
  }

  test("mirror exports every remaining note when a deletion shifts the second page", async () => {
    let deleted = "";
    const proxy = await relay(async (action, reply) => {
      if (!deleted && action === "blocks.query" && reply.result?.nextOffset !== undefined) {
        deleted = reply.result.blocks[0].id;
        await board.trash(deleted);
        notes.delete(deleted);
      }
    });
    const dir = directory(), copy = mirror(dir, ["--once"], { EP0CH_SOCKET: proxy.path });
    try {
      expect(await copy.child.exited, copy.errors()).toBe(0);
      expect(deleted).not.toBe("");
      const manifest = copy.manifest();
      expect(manifest.leftOut).toEqual([]);
      expect(manifest.files).toHaveLength(notes.size);
      const contents = manifest.files.map(file => readFileSync(join(dir, file), "utf8"));
      for (const [id, text] of notes) expect(contents.some(content => content.includes(`id: "${id}"`) && content.includes(text)), id).toBe(true);
    } finally { await copy.stop(); await proxy.close(); }
  }, 30_000);

  test("mirror retries its first snapshot after the host restarts during its first record read", async () => {
    let restarting: Promise<void> | undefined;
    const proxy = await relay(async action => {
      if (action === "blocks.records" && !restarting) {
        restarting = (async () => { board.close(); await scratch.stop(100); await scratch.start(); })();
        await restarting;
      }
    });
    const dir = directory(), copy = mirror(dir, [], { EP0CH_SOCKET: proxy.path });
    try {
      await copy.ready();
      expect(copy.errors()).toContain("connection lost");
      expect(copy.errors()).toContain("caught up");
      const exported = new Map(copy.manifest().files.map(file => {
        const note = readNoteFile(readFileSync(join(dir, file), "utf8"))!;
        return [note.identity.id, note.text.trimEnd()];
      }));
      for (const [id, text] of notes) expect(exported.get(id), id).toBe(text);
    } finally { await copy.stop(); await restarting; await proxy.close(); }
  }, 30_000);

  test("mirror recreates a dead ssh forward and catches up the remote outline", async () => {
    const here = directory(), bin = join(here, "bin"), outlines = join(here, "outlines");
    for (const dir of [bin, outlines, join(here, "far-home")]) mkdirSync(dir, { recursive: true });
    for (const [name, entry] of [["ssh", join(outliner!, "test/fake-ssh.ts")], ["ep0ch", MAIN]]) {
      const path = join(bin, name!);
      writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${entry}" "$@"\n`);
      chmodSync(path, 0o755);
    }
    const env = {
      EP0CH_SOCKET: undefined, EP0CH_OUTLINES: outlines, EP0CH_STATE: join(here, "state"), EP0CH_SSH: join(bin, "ssh"),
      FAKE_SSH_HOME: join(here, "far-home"), FAKE_SSH_OUTLINES: scratch.outlines, FAKE_SSH_BIN: bin,
    };
    const ctl = join(outlines, ".remote/box-a.ctl"), dir = directory(), copy = mirror(dir, ["--machine", "box-a"], env);
    const stopForward = async () => {
      if (!existsSync(ctl)) return;
      const pid = Number(readFileSync(ctl, "utf8"));
      process.kill(pid, "SIGTERM");
      await until(() => !existsSync(ctl), "the test's forward to stop");
    };
    try {
      await copy.ready();
      const previous = Number(readFileSync(ctl, "utf8"));
      await stopForward();
      const id = [...notes.keys()].at(-1)!;
      const note = await board.get(id);
      await board.request("update", { blockId: id, text: "Orchard packet\nFresh words after the forward died.", expectedRevision: note!.revision, mutation: { author: "user" } });
      await until(() => existsSync(ctl), "mirror to recreate its dead ssh forward", 10_000);
      expect(Number(readFileSync(ctl, "utf8"))).not.toBe(previous);
      await until(() => copy.manifest().files.some(file => file.endsWith(`-${id.slice(0, 8)}.md`) && readFileSync(join(dir, file), "utf8").includes("Fresh words after the forward died.")), "remote mirror catch-up");
    } finally { await copy.stop(); await stopForward(); }
  }, 30_000);
});
