// `ep0ch find` and `ep0ch show` (src/notes-cli.ts): the outline's notes for a picker's channel or a script, on a
// scratch host. find lists every note (newest first) or the service's ranked matches; show draws a note as the
// reader does, at the width asked for. Fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { everyNote, foundLine, treeLine, treeOf } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { visible, width } from "../src/style";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string> = {}, cwd?: string) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", ...(cwd ? { cwd } : {}), env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

describe("every note, for a picker that filters as it's typed", () => {
  test("newest first, each with its ancestors' titles as its path", () => {
    const at = (n: number) => n * 1000;
    const b = (id: string, parentId: string | null, title: string, updatedAt: number) =>
      ({ id, parentId, title, updatedAt, position: 0, depth: 0, author: "you", createdAt: 0, props: {}, hasChildren: false });
    const list = everyNote([b("a", null, "Allotment", at(1)), b("b", "a", "Beds", at(3)), b("c", "b", "Bean canes", at(2))]);
    expect(list.map(f => [f.id, f.title, f.path])).toEqual([["b", "Beds", "Allotment"], ["c", "Bean canes", "Allotment › Beds"], ["a", "Allotment", ""]]);
  });

  test("a --lines row is one line of three tab-separated fields, whatever the title holds", () => {
    expect(foundLine({ id: "x1", title: "Two\tlines\nof title", path: "Shed › Tools" })).toBe("x1\tTwo lines of title\tShed › Tools");
  });
});

describe("the outline as a tree, from the index in the service's order", () => {
  // The index as the service sends it: depth first, each row with its depth (here: a shed, its tools, a bench).
  const row = (id: string, parentId: string | null, depth: number, title: string, props: Record<string, string> = {}) =>
    ({ id, parentId, depth, title, props, updatedAt: 0, position: 0, author: "you", createdAt: 0, hasChildren: false });
  const index = [
    row("shed", null, 0, "Bike shed", { type: "place" }),
    row("tools", "shed", 1, "Tools"),
    row("oil", "tools", 2, "Chain oil", { stage: "todo", type: "chore" }),
    row("pump", "tools", 2, "Track pump"),
    row("bench", "shed", 1, "Work bench", { "work-id": "SHED-4", stage: "doing" }),
    row("vise", "bench", 2, "SHED-5 Vise jaws", { "work-id": "SHED-5" }),
    row("plot", null, 0, "Allotment"),
  ];

  test("each row drawn with its ancestors' rails and its own branch; the last child turns the corner", () => {
    const t = treeOf(index)!;
    expect(t.map(f => f.glyphs + f.title)).toEqual([
      "Bike shed",
      "├─ Tools",
      "│  ├─ Chain oil",
      "│  └─ Track pump",
      "└─ Work bench",
      "   └─ SHED-5 Vise jaws",
      "Allotment",
    ]);
    expect(t.map(f => f.depth)).toEqual([0, 1, 2, 2, 1, 2, 0]);
    // What it is, dim beside it: work id (unless the title says it), stage, type.
    expect(t.map(f => f.about)).toEqual(["place", "", "todo · chore", "", "SHED-4 · doing", "", ""]);
    expect(t[2]!.path).toBe("Bike shed › Tools");
    expect(treeLine(t[2]!)).toBe("oil\tChain oil\tBike shed › Tools\t2\t│  ├─ \ttodo · chore");
  });

  test("under a root: that note at depth 0 and its own; a unique prefix names it; an unknown root is null", () => {
    expect(treeOf(index, "tools")!.map(f => f.glyphs + f.title)).toEqual(["Tools", "├─ Chain oil", "└─ Track pump"]);
    expect(treeOf(index, "benc")!.map(f => f.id)).toEqual(["bench", "vise"]);
    expect(treeOf(index, "nowhere")).toBeNull();
    expect(treeOf(index, "p")).toBeNull();                          // too short to be a prefix, and two notes start so
  });

  test("past the levels drawn, the outer rails give way to …<depth>, so a deep title stays in view", () => {
    const deep = Array.from({ length: 30 }, (_, i) => row(`n${i}`, i ? `n${i - 1}` : null, i, `Level ${i}`));
    const t = treeOf(deep, undefined, 6)!;
    expect(t[5]!.glyphs).toBe("            └─ ");                  // five levels: drawn in full
    expect(t[29]!.glyphs).toBe("…29             └─ ");               // the rest: said, then the last four levels' rails
    for (const f of t) expect(width(f.glyphs)).toBeLessThanOrEqual(4 + 3 * 5);
  });
});

describe.skipIf(!outliner)("ep0ch find and show against a scratch host", () => {
  const scratch = new Scratch();
  let sock = "", env: Record<string, string> = {};
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    sock = await scratch.start();
    env = { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name };
    const board = new SocketBoard(sock, undefined, scratch.name);
    const make = async (key: string, text: string, parentId: string | null = null) => { ids[key] = (await board.request<{ id: string }>("create", { parentId, text, author: "agent" })).id; };
    await make("shed", "Bike shed\nWhere the bikes live.");
    await make("oil", "Chain oil\nThe **wax** one, not the spray. See ((" + "x" + ")).", ids.shed);
    await make("gone", "Old padlock code\nNobody needs this.", ids.shed);
    await board.trash(ids.gone!);
    board.close();
  });
  afterAll(async () => { await scratch.dispose(); });

  test("find --lines: every live note, id, title and path; a trashed one isn't there", async () => {
    const r = await run(["find", "--lines"], env);
    expect(r.code).toBe(0);
    const rows = r.out.trim().split("\n").map(l => l.split("\t"));
    expect(rows.find(f => f[0] === ids.oil)).toEqual([ids.oil!, "Chain oil", "Bike shed"]);
    expect(rows.find(f => f[0] === ids.shed)?.slice(1)).toEqual(["Bike shed", ""]);
    expect(rows.some(f => f[0] === ids.gone)).toBe(false);
  });

  test("find --tree [<root>]: the outline depth first as the service orders it, with depths and glyphs; a trashed note isn't there", async () => {
    const all = await run(["find", "--tree", "--lines"], env);
    expect(all.code).toBe(0);
    const rows = all.out.split("\n").filter(Boolean).map(l => l.split("\t"));
    expect(rows.every(r => r.length === 6)).toBe(true);
    const shed = rows.findIndex(r => r[0] === ids.shed);
    expect(rows[shed]!.slice(1, 5)).toEqual(["Bike shed", "", "0", ""]);
    expect(rows[shed + 1]!.slice(0, 5)).toEqual([ids.oil!, "Chain oil", "Bike shed", "1", "└─ "]);
    expect(rows.some(r => r[0] === ids.gone)).toBe(false);
    const under = await run(["find", "--tree", `((${ids.shed}))`, "--lines"], env);
    expect(under.out.split("\n").filter(Boolean).map(l => l.split("\t")[0])).toEqual([ids.shed, ids.oil]);
    const drawn = await run(["find", "--tree", ids.shed!], env);
    expect(drawn.out).toBe(`${ids.shed!.slice(0, 8)}  Bike shed\n${ids.oil!.slice(0, 8)}  └─ Chain oil\n`);
    expect((await run(["find", "--tree", "00000000"], env)).code).toBe(1);
    expect((await run(["find", "--tree", "oil", "chain"], env)).code).toBe(2);
    expect((await run(["find", "--tree", "--recent"], env)).code).toBe(2);
  });

  test("find <words>: the service's forgiving ranker (typos, any order), best first", async () => {
    const r = await run(["find", "oil", "chian", "--lines"], env);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe(`${ids.oil}\tChain oil\tBike shed`);
    // A word with a slash is a word, never read as a socket path.
    expect((await run(["find", "oil/chain", "--lines"], env)).code).toBe(0);
    const recent = (await run(["find", "--recent", "--lines"], env)).out.split("\n").filter(Boolean);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every(l => l.split("\t").length === 3)).toBe(true);
    const json = JSON.parse((await run(["find", "bike", "--json"], env)).out);
    expect(json[0]).toEqual({ id: ids.shed, title: "Bike shed", path: "" });
  });

  test("show: the note as a reader draws it, at the width asked for; --ansi keeps the colours", async () => {
    const plain = await run(["show", ids.oil!, "--width", "40"], env);
    expect(plain.code).toBe(0);
    const lines = plain.out.trimEnd().split("\n");
    expect(lines[0]).toBe("Chain oil");
    expect(lines[2]).toBe("Bike shed");                          // its crumbs, read from the outline
    expect(plain.out).toContain("The wax one, not the spray.");      // inline Markdown drawn, not typed
    expect(plain.out).not.toContain("\x1b[");
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(40);
    const ansi = await run(["show", ids.oil!, "--width", "40", "--ansi"], env);
    expect(ansi.out).toContain("\x1b[");
    expect(ansi.out.split("\n").map(l => visible(l).trimEnd())).toEqual(plain.out.split("\n"));
    // ((id)) as a picker outputs it is taken as the id.
    expect((await run(["show", `((${ids.oil}))`, "--width", "40"], env)).out).toBe(plain.out);
  });

  test("refusals: no such note, a bad width, nothing to show, an outline nobody names", async () => {
    const none = await run(["show", "00000000-0000-4000-8000-000000000000"], env);
    expect([none.code, none.err]).toEqual([1, expect.stringContaining("no note")]);
    expect((await run(["show", ids.oil!, "--width", "3"], env)).code).toBe(2);
    expect((await run(["show"], env)).code).toBe(2);
    expect((await run(["find", "--bogus"], env)).code).toBe(2);
    expect((await run(["find", "--lines", "--json"], env)).code).toBe(2);
    expect((await run(["find", "--recent", "oil"], env)).code).toBe(2);
    // A folder (and home) that names no outline: said, never a guess.
    const nowhere = mkdtempSync(join(tmpdir(), "ep0ch-find-"));
    const unnamed = await run(["find", "--lines"], { EP0CH_SOCKET: sock, EP0CH_WS: "", HOME: nowhere }, nowhere);
    rmSync(nowhere, { recursive: true, force: true });
    expect([unnamed.code, unnamed.err]).toEqual([1, expect.stringContaining("no outline is named here")]);
  });
});
