// PIE-534: `ep0ch find --query/--view/--under` and `ep0ch export`, on a scratch host. The outline evaluates every
// selection; the door only asks. Exports go to temp dirs. Fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNoteFile } from "@ep0ch/outline-core/header-line";
import { blockRecord, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { exportFiles, fileName, resolveLinks } from "../src/export";
import { selectionOf, selectionQuery } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

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
    properties: [{ key: "tag", value: "seeds", scope: "block", line: 0 }, { key: "tag", value: "spring", scope: "block", line: 0 }],
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
      "---", 'id: "bbbbbbbb-2"', 'parent: "aaaaaaaa-1"', 'created: "2026-03-09T09:00:00.000Z"', 'updated: "2026-03-09T09:30:00.000Z"', 'author: "user"',
      "tag:", '  - "seeds"', '  - "spring"', "---",
      "Seed order", "For ((aaaaaaaa-1|the plot)) and [[Seed list]], not ((ffffffff-9)) or !((aaaaaaaa-1)).", "", "- Ask about netting", "  She has a roll.", "",
    ].join("\n"));
    // The file reads back to the note's text, its header line rebuilt with ` - `.
    expect(readNoteFile(f!.content)!.text.split("\n")[0]).toBe("Seed order - [tag::seeds] - [tag::spring]");
  });

  test("--split: each child its own file, the parent lists it; --resolve-links links what was exported, and only that", () => {
    const files = exportFiles([plot, list], byId, { format: "md", children: true, split: true, resolveLinks: true });
    expect(files.map(f => f.name)).toEqual(["allotment-plot-aaaaaaaa.md", "seed-order-bbbbbbbb.md", "ask-about-netting-dddddddd.md", "seed-list-cccccccc.md"]);
    expect(files[0]!.content).toContain("\n- [Seed order](seed-order-bbbbbbbb.md)\n");
    // An embed stays an embed; a link to a note that wasn't exported stays as written.
    expect(files[1]!.content).toContain("For [the plot](allotment-plot-aaaaaaaa.md) and [Seed list](seed-list-cccccccc.md), not ((ffffffff-9)) or !((aaaaaaaa-1)).");
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

  test("find --json: block records, built by the service", async () => {
    const [r] = JSON.parse((await run(["find", "--query", "tag=spring", "--json"], env)).out) as BlockRecord[];
    expect(r).toMatchObject({ id: ids.order, title: "Seed order for the plot", parent: ids.plot, children: [ids.ask], properties: [{ key: "type", values: ["errand"] }, { key: "ctx", values: ["2026-03-09 @ 09:27:29 AM"] }, { key: "tag", values: ["seeds", "spring"] }], tasks: [{ status: "todo", text: "order the beans" }] });
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
    expect(readdirSync(out).sort()).toEqual([`allotment-plot-${ids.plot!.slice(0, 8)}.md`, `ask-the-neighbour-about-netting-${ids.ask!.slice(0, 8)}.md`, `seed-order-for-the-plot-${ids.order!.slice(0, 8)}.md`]);
    const order = readFileSync(join(out, `seed-order-for-the-plot-${ids.order!.slice(0, 8)}.md`), "utf8");
    expect(order).toContain('\nctx: "2026-03-09 @ 09:27:29 AM"\ntag:\n  - "seeds"\n  - "spring"\n---\nSeed order for the plot\nBroad beans.\nwhen:: before Friday\n');
    expect(order).toContain(`\nparent: "${ids.plot}"\n`);
    const again = temp();
    await run(["export", "--query", "type=place", "--children", "--split", "--out", again, "--manifest"], env);
    for (const f of readdirSync(out)) expect(readFileSync(join(again, f), "utf8")).toBe(readFileSync(join(out, f), "utf8"));
    expect(JSON.parse(readFileSync(join(again, "manifest.json"), "utf8"))).toMatchObject({ outline: scratch.name, format: "md", selection: { query: "type=place" }, exportedAt: expect.any(String) });
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
    expect([missing.code, plain(missing.err)]).toEqual([1, expect.stringContaining("no note beans")]);
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
