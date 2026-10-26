// PIE-1355: a page copied with its live figures' results. `ep0ch show --markdown` (and the reader's Y, note.copy) keep
// the text as written and put each live figure's rows under it as Markdown, read back here through a Markdown parser:
// a checklist keeps its ticks, a table is a table cut at the cap with the command that reads the rest, tabs are a list
// per group, and every row links its note as ((id|title)). Scratch host; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { marked, type Tokens } from "marked";
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
export const PAGE = [
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

const results = (tokens: marked.TokensList | Tokens.Generic[], title: string) => {
  const at = tokens.findIndex(t => t.type === "paragraph" && t.text.startsWith(`**Results · ${title}**`));
  expect(at).toBeGreaterThan(-1);
  return tokens.slice(at);
};

describe("a figure's results, as Markdown", () => {
  test("a cut says how many of how many and names the command for the rest; links stay ((id|title))", () => {
    const rows = Array.from({ length: 60 }, (_, i) => [`Row (${i})`, "a|b"]);
    const r = figureResultsMarkdown("table", { title: "Rows", query: "type=row", headers: ["Title", "Bed"], rows, blocks: rows.map((_, i) => `id-${i}`), titleColumn: 0 }, { n: 60, truncated: false }, { outline: "plot", at: Date.UTC(2026, 9, 26, 12) });
    expect(r).toMatchObject({ shown: RESULTS_CAP, total: 60, cut: true });
    const md = r!.lines.join("\n");
    const table = marked.lexer(md).find(t => t.type === "table") as Tokens.Table;
    expect(table.rows).toHaveLength(RESULTS_CAP);
    expect(table.rows[0]!.map(c => c.text)).toEqual(["((id-0|Row 0))", "a|b"]);
    expect(md).toContain('_showing 50 of 60 · the rest: `ep0ch find --ws plot --query type=row --sort updated --direction desc` · MCP: `outline_query {"outline":"plot","query":"type=row","sort":"updated desc","offset":50}`_');
  });
});

describe.skipIf(!outliner)("ep0ch show --markdown against a scratch host", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {}, page = "";
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
    board.close();
  });
  afterAll(() => scratch.dispose());

  test("the text as written, each live figure's rows under it, parsed back as Markdown", async () => {
    const r = await run(["show", page, "--markdown"], env);
    expect(r.code).toBe(0);
    // The source stays: every figure's block as written.
    for (const line of PAGE.split("\n")) expect(r.out).toContain(line);
    const tokens = marked.lexer(r.out);

    const check = results(tokens, "Crates");
    expect(check[0]!.text).toMatch(/^\*\*Results · Crates\*\* · 3 rows · as of \d{4}-\d\d-\d\d \d\d:\d\d · query: `type=crate`$/);
    const steps = check.find(t => t.type === "list") as Tokens.List;
    expect(steps.items.map(i => [i.checked, i.text])).toEqual([
      [true, `((${crates.apples}|Apples crate))`], [false, `((${crates.beets}|Beets crate))`], [true, `((${crates.chard}|Chard crate))`],
    ]);

    const seedlings = results(tokens, "Seedlings");
    const table = seedlings.find(t => t.type === "table") as Tokens.Table;
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
    const heads = tabs.filter(t => t.type === "paragraph" && /^\*\*(north|south)\*\* · \d$/.test(t.text)).map(t => t.text);
    expect(heads).toEqual(["**north** · 2", "**south** · 1"]);
    const lists = tabs.filter(t => t.type === "list") as Tokens.List[];
    expect(lists.slice(0, 2).map(l => l.items.map(i => i.text))).toEqual([
      [`((${crates.apples}|Apples crate))`, `((${crates.beets}|Beets crate))`], [`((${crates.chard}|Chard crate))`],
    ]);

    // The figures' order in the copy is the note's: check, table, tabs.
    expect(r.out.indexOf("**Results · Crates**")).toBeLessThan(r.out.indexOf("**Results · Seedlings**"));
    expect(r.out.indexOf("**Results · Seedlings**")).toBeLessThan(r.out.indexOf("**Results · By bay**"));
  }, 30_000);

  test("--source stays the text alone; --markdown with --source is refused", async () => {
    const source = await run(["show", page, "--source"], env);
    expect(source.out.trimEnd()).toBe(PAGE);
    const both = await run(["show", page, "--source", "--markdown"], env);
    expect(both.code).toBe(2);
    expect(both.err).toContain("--markdown");
  }, 30_000);
});
