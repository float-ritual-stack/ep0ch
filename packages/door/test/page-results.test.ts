// PIE-1355: a page copied with its live figures' results. `ep0ch show --markdown` (and the reader's Y, note.copy) keep
// the text as written and put each live figure's rows under it as Markdown, read back here through a Markdown parser:
// a checklist keeps its ticks, a table is a table cut at the cap with the command that reads the rest, tabs are a list
// per group, and every row links its note as ((id|title)). Scratch host; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { first, lex, paragraphs, resultsOf, type Tokens } from "./results-markdown";
import { figureResultsMarkdown, RESULTS_CAP } from "@ep0ch/outline-core/figure-results";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string>) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

/** The page the kitchen sink's "copy a page" section also holds: a 3-row check, a 60-row table and tabs. */
const PAGE = [
  "Crate day [type::page]",
  "",
  "::graph-check",
  "---",
  "title: Crates",
  "query: type=crate",
  "done: packed=yes",
  "sort: title",
  "direction: asc",
  "---",
  "::",
  "",
  "::graph-table",
  "---",
  "title: Seedlings",
  "query: type=seedling",
  "columns: [title, bed]",
  "sort: title",
  "direction: asc",
  "---",
  "::",
  "",
  "::graph-tabs",
  "---",
  "title: By bay",
  "query: type=crate",
  "group: bay",
  "columns: [title]",
  "sort: title",
  "direction: asc",
  "---",
  "::",
].join("\n");

const results = (tokens: ReturnType<typeof lex>, title: string) => {
  const r = resultsOf(tokens, title);
  expect(r).not.toBeNull();
  return r!;
};

describe("a figure's results, as Markdown", () => {
  test("a cut says how many of how many and names the command for the rest; links stay ((id|title))", () => {
    const rows = Array.from({ length: 60 }, (_, i) => [`Row (${i})`, "a|b"]);
    const r = figureResultsMarkdown("table", { title: "Rows", query: "type=row", headers: ["Title", "Bed"], rows, blocks: rows.map((_, i) => `id-${i}`), titleColumn: 0 }, { n: 60, truncated: false }, { outline: "plot", at: Date.UTC(2026, 9, 26, 12) });
    expect(r).toMatchObject({ shown: RESULTS_CAP, total: 60, cut: true });
    const md = r!.lines.join("\n");
    const table = first<Tokens.Table>(lex(md), "table");
    expect(table.rows).toHaveLength(RESULTS_CAP);
    expect(table.rows[0]!.map(c => c.text)).toEqual(["((id-0|Row 0))", "a|b"]);
    expect(md).toContain('_showing 50 of 60 · the rest: `ep0ch find --ws plot --query type=row --sort updated --direction desc` · MCP: `outline_query {"outline":"plot","query":"type=row","sort":"updated desc","offset":50}`_');
  });
});

describe("what a figure's results say beyond its rows", () => {
  const at = Date.UTC(2026, 9, 26, 12);
  test("a check's box is Markdown's: [x] done or approved, [ ] else, any other status said after it", () => {
    const items = ["done", "approved", "waiting", "rejected", "todo"].map((status, i) => ({ label: `Step ${i}`, status, block: `id-${i}` }));
    const md = figureResultsMarkdown("check", { title: "Steps", query: "type=step", items }, { n: 5, truncated: false }, { at })!.lines.join("\n");
    const list = first<Tokens.List>(lex(md), "list");
    expect(list.items.map(i => [i.checked, i.text])).toEqual([
      [true, "((id-0|Step 0))"], [true, "((id-1|Step 1)) · approved"], [false, "((id-2|Step 2)) · waiting"], [false, "((id-3|Step 3)) · rejected"], [false, "((id-4|Step 4))"],
    ]);
  });

  test("tabs share the figure's cap in order: a group past it says how many it holds and how to read them", () => {
    const tab = (value: string, n: number) => ({ value, count: n, headers: ["title"], titleColumn: 0, rows: Array.from({ length: n }, (_, i) => [`${value} ${i}`]), blocks: Array.from({ length: n }, (_, i) => `${value}-${i}`) });
    const r = figureResultsMarkdown("tabs", { title: "Jobs", query: "type=job", group: "stage", tabs: [tab("doing", 40), tab("done", 40)] }, { n: 80, truncated: false }, { at, cap: 50 })!;
    expect(r).toMatchObject({ shown: 50, total: 80, cut: true });
    const lists = lex(r.lines.join("\n")).filter(t => t.type === "list") as Tokens.List[];
    expect(lists.map(l => l.items.length)).toEqual([40, 10]);
    expect(r.lines.join("\n")).toContain('_showing 10 of 40 · the rest: `ep0ch find --query \'(type=job) AND stage="done"\'');
  });

  test("the service's word on an answer is said under it; a question not answered says so", () => {
    const hinted = figureResultsMarkdown("table", { title: "Typo", query: "staeg=doing", headers: ["title"], rows: [], blocks: [] }, { n: 0, truncated: false }, { at }, "no notes have staeg; nearest: stage")!;
    expect(paragraphs(lex(hinted.lines.join("\n")))).toEqual([expect.stringContaining("0 rows"), "_no results_", "_no notes have staeg; nearest: stage_"]);
    const late = figureResultsMarkdown("table", { title: "Slow", query: "type=x" }, null, { at }, "the outline didn't answer in time")!;
    expect(late.lines[0]).toContain("not answered");
    expect(late.lines.at(-1)).toBe("_the outline didn't answer in time_");
  });
});

describe.skipIf(!outliner)("ep0ch show --markdown against a scratch host", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {}, page = "", argued = "";
  const crates: Record<string, string> = {};
  beforeAll(async () => {
    const sock = await scratch.start();
    env = { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name };
    const board = new SocketBoard(sock, undefined, scratch.name);
    const make = async (text: string) => (await board.request<{ id: string }>("create", { parentId: null, text, author: "agent" })).id;
    crates.apples = await make("Apples crate [type::crate] [packed::yes] [bay::north]");
    crates.beets = await make("Beets crate [type::crate] [bay::north]");
    crates.chard = await make("Chard crate [type::crate] [packed::yes] [bay::south]");
    await Promise.all(Array.from({ length: 60 }, (_, i) => make(`Seedling ${String(i + 1).padStart(2, "0")} [type::seedling] [bed::b${i % 4}]`)));
    page = await make(PAGE);
    // A figure whose question is its call-site arguments (`::graph-check{…}`), as the reader reads it.
    argued = await make('Bay north\n\n::graph-check{title=North query="type=crate bay=north"}\n---\nsort: title\ndirection: asc\n---\n::');
    board.close();
  });
  afterAll(() => scratch.dispose());

  test("the text as written, each live figure's rows under it, parsed back as Markdown", async () => {
    const r = await run(["show", page, "--markdown"], env);
    expect(r.code).toBe(0);
    // The source stays: every figure's block as written.
    for (const line of PAGE.split("\n")) expect(r.out).toContain(line);
    const tokens = lex(r.out);

    const check = results(tokens, "Crates");
    expect(paragraphs(check)[0]).toMatch(/^\*\*Results · Crates\*\* · 3 rows · as of \d{4}-\d\d-\d\d \d\d:\d\d · query: `type=crate`$/);
    const steps = first<Tokens.List>(check, "list");
    expect(steps.items.map(i => [i.checked, i.text])).toEqual([
      [true, `((${crates.apples}|Apples crate))`], [false, `((${crates.beets}|Beets crate))`], [true, `((${crates.chard}|Chard crate))`],
    ]);

    const seedlings = results(tokens, "Seedlings");
    const table = first<Tokens.Table>(seedlings, "table");
    expect(table.header.map(c => c.text)).toEqual(["title", "bed"]);
    expect(table.rows).toHaveLength(RESULTS_CAP);
    expect(table.rows[0]![0]!.text).toMatch(/^\(\([0-9a-f-]{36}\|Seedling 01\)\)$/);
    expect(table.rows[0]![1]!.text).toBe("b0");
    const cut = seedlings.find(t => t.type === "paragraph" && t.raw.startsWith("_showing"))!;
    expect(cut.raw).toContain(`_showing 50 of 60 · the rest: \`ep0ch find --ws ${scratch.name} --query type=seedling --sort title --direction asc\``);
    // The command it names reads the rest.
    const rest = await run(["find", "--query", "type=seedling", "--sort", "title", "--direction", "asc", "--ids"], env);
    expect(rest.out.trim().split("\n")).toHaveLength(60);

    // Tabs: a list per group, headed with its value and count.
    const tabs = results(tokens, "By bay");
    const heads = paragraphs(tabs).filter(t => /^\*\*(north|south)\*\* · \d$/.test(t));
    expect(heads).toEqual(["**north** · 2", "**south** · 1"]);
    const lists = tabs.filter(t => t.type === "list") as Tokens.List[];
    expect(lists.slice(0, 2).map(l => l.items.map(i => i.text))).toEqual([
      [`((${crates.apples}|Apples crate))`, `((${crates.beets}|Beets crate))`], [`((${crates.chard}|Chard crate))`],
    ]);

    // The figures' order in the copy is the note's: check, table, tabs.
    expect(r.out.indexOf("**Results · Crates**")).toBeLessThan(r.out.indexOf("**Results · Seedlings**"));
    expect(r.out.indexOf("**Results · Seedlings**")).toBeLessThan(r.out.indexOf("**Results · By bay**"));
  }, 30_000);

  test("a figure asking through its call-site arguments copies its rows too", async () => {
    const r = await run(["show", argued, "--markdown"], env);
    expect(r.code).toBe(0);
    const steps = first<Tokens.List>(resultsOf(lex(r.out), "North")!, "list");
    expect(steps.items.map(i => i.text)).toEqual([`((${crates.apples}|Apples crate))`, `((${crates.beets}|Beets crate))`]);
  }, 30_000);

  test("--source stays the text alone; --markdown with --source is refused", async () => {
    const source = await run(["show", page, "--source"], env);
    expect(source.out.trimEnd()).toBe(PAGE);
    const both = await run(["show", page, "--source", "--markdown"], env);
    expect(both.code).toBe(2);
    expect(both.err).toContain("--markdown");
  }, 30_000);
});
