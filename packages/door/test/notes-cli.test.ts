// `ep0ch find` and `ep0ch show` (src/notes-cli.ts): the outline's notes for a picker's channel or a script, on a
// scratch host. find lists every note (newest first) or the service's ranked matches; show draws a note as the
// reader does, at the width asked for. Fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalLocalMachineName, everyNote, foundLine, treeLine, treeOf } from "../src/notes-cli";
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

  test("local URI machine names are stable and valid when the host name is not an ssh-name shape", () => {
    expect(canonicalLocalMachineName("garden-box")).toBe("garden-box");
    expect(canonicalLocalMachineName("___")).toBe("local");
    const long = canonicalLocalMachineName("this-host-name-is-longer-than-the-uri-machine-limit.example");
    expect(long).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/);
    expect(long).toHaveLength(32);
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

  test("under a root: that note at depth 0 and its own; a root named by anything but its whole id is null", () => {
    expect(treeOf(index, "tools")!.map(f => f.glyphs + f.title)).toEqual(["Tools", "├─ Chain oil", "└─ Track pump"]);
    expect(treeOf(index, "bench")!.map(f => f.id)).toEqual(["bench", "vise"]);
    expect(treeOf(index, "nowhere")).toBeNull();
    expect(treeOf(index, "benc")).toBeNull();                       // ids are whole, as show, open and the outline take them
  });

  test("a work id the title starts with isn't said twice; one that only looks like its start is", () => {
    const t = treeOf([row("a", null, 0, "SHED-18 — Oil the hinge", { "work-id": "SHED-18" }), row("b", null, 0, "SHED-181 — New hinge", { "work-id": "SHED-18" })])!;
    expect(t.map(f => f.about)).toEqual(["", "SHED-18"]);
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
    await make("chore1", "Water the beans [type::chore]");
    await make("chore2", "Turn the compost [type::chore]");
    await make("flow", "Delivery flow");
    await make("queued", "Queued chores [type::virtual-branch] [query::type=chore]", ids.flow);
    await make("folded", "Shed rota\n\n> [!note]- Who has the key\n> Sam, on Saturdays.");
    // PIE-541: links inside emphasis, and a line three comment threads quote (fictional).
    const shedRef = (label?: string) => `((${ids.shed}${label ? `|${label}` : ""}))`;
    await make("emph", ["Shed log", "", `_The rota is in the child blocks below: ${shedRef("Rota")}._`, `_Plain ${shedRef()} in italics._`, `**Bold ${shedRef("Shed")} and ${shedRef()}.**`].join("\n"));
    const last = `_The rota is in the child blocks below: ${shedRef("Rota")}._`;
    for (const [i, body] of ["Who keeps the key?", "Add Sam.", "Done in May."].entries()) {
      const note = (await board.get(ids.emph!))!;
      await board.comment(`pie541-${i}`, ids.emph!, note.revision!, body, { quote: last, start: note.text.indexOf(last) });
    }
    await make("figures", ["Garden figures [count::2]", "", "::graph-check", "---", "title: Chores (live query)", 'query: "type=chore"', "---", "::", "", `See ((${ids.shed}|the shed)).`, "", "::links", ""].join("\n"));
    board.close();
  });
  afterAll(async () => { await scratch.dispose(); });

  test("find --lines: every live note, id, title and path; a trashed one isn't there", async () => {
    const r = await run(["find", "--lines"], env);
    expect(r.code).toBe(0);
    const rows = r.out.trim().split("\n").map(l => l.split("\t"));
    expect(rows.find(f => f[0] === ids.oil)?.slice(0, 3)).toEqual([ids.oil!, "Chain oil", "Bike shed"]);
    expect(rows.find(f => f[0] === ids.oil)?.[3]).toContain(`ep0ch://${scratch.name}@`);
    expect(rows.find(f => f[0] === ids.shed)?.slice(1, 3)).toEqual(["Bike shed", ""]);
    expect(rows.some(f => f[0] === ids.gone)).toBe(false);
  });

  test("find --tree [<root>]: the outline depth first as the service orders it, with depths and glyphs; a trashed note isn't there", async () => {
    const all = await run(["find", "--tree", "--lines"], env);
    expect(all.code).toBe(0);
    const rows = all.out.split("\n").filter(Boolean).map(l => l.split("\t"));
    expect(rows.every(r => r.length === 7)).toBe(true);
    const shed = rows.findIndex(r => r[0] === ids.shed);
    expect(rows[shed]!.slice(1, 6)).toEqual(["Bike shed", "", expect.stringContaining(`ep0ch://${scratch.name}@`), "0", ""]);
    expect(rows[shed + 1]!.slice(0, 6)).toEqual([ids.oil!, "Chain oil", "Bike shed", expect.stringContaining(`ep0ch://${scratch.name}@`), "1", "└─ "]);
    expect(rows.some(r => r[0] === ids.gone)).toBe(false);
    const under = await run(["find", "--tree", `((${ids.shed}))`, "--lines"], env);
    expect(under.out.split("\n").filter(Boolean).map(l => l.split("\t")[0])).toEqual([ids.shed, ids.oil]);
    const drawn = await run(["find", "--tree", ids.shed!], env);
    expect(drawn.out).toBe(`${ids.shed!.slice(0, 8)}  Bike shed\n${ids.oil!.slice(0, 8)}  └─ Chain oil\n`);
    const json = JSON.parse((await run(["find", "--tree", ids.shed!, "--json"], env)).out);
    expect(json.map((f: any) => [f.id, f.depth, f.glyphs])).toEqual([[ids.shed, 0, ""], [ids.oil, 1, "└─ "]]);
    expect((await run(["find", "--tree", "00000000"], env)).code).toBe(1);
    expect((await run(["find", "--tree", "oil", "chain"], env)).code).toBe(2);
    expect((await run(["find", "--tree", "--recent"], env)).code).toBe(2);
  });

  test("find <words>: the service's forgiving ranker (typos, any order), best first", async () => {
    const r = await run(["find", "oil", "chian", "--lines"], env);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toContain(`${ids.oil}\tChain oil\tBike shed\tep0ch://${scratch.name}@`);
    // A word with a slash is a word, never read as a socket path.
    expect((await run(["find", "oil/chain", "--lines"], env)).code).toBe(0);
    const recent = (await run(["find", "--recent", "--lines"], env)).out.split("\n").filter(Boolean);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every(l => l.split("\t").length === 4)).toBe(true);
    // --json: each note as a block record (outline-core's block-record.ts), keys sorted.
    const json = JSON.parse((await run(["find", "bike", "--json"], env)).out);
    expect(json[0]).toMatchObject({ id: ids.shed, title: "Bike shed", parent: null, children: [ids.oil] });
    expect(json[0].uri).toContain(`ep0ch://${scratch.name}@`);
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

  test("show: links inside italics and bold are drawn in colour, and a line with several comment threads gets one mark (PIE-541)", async () => {
    const plain = await run(["show", ids.emph!, "--width", "120"], env);
    expect(plain.code).toBe(0);
    const lines = plain.out.trimEnd().split("\n");
    expect(plain.out).not.toContain("[38;2;");
    expect(lines).toContain("▐The rota is in the child blocks below: Rota.");
    expect(lines).toContain(" Plain Bike shed in italics.");
    expect(lines).toContain(" Bold Shed and Bike shed.");
    const ansi = (await run(["show", ids.emph!, "--width", "120", "--ansi"], env)).out;
    // Every SGR is a whole escape: none is left as text with its ESC cut off.
    expect(ansi.match(/(?<!\x1b)\[[\d;]*m/g)).toBeNull();
    const rota = ansi.split("\n").find(l => visible(l).includes("The rota"))!;
    expect(rota.split("▐").length).toBe(2);
    expect(rota).toContain("\x1b[3m");
  });

  test("show --cells: the same drawing as cells a Raster paints, row by row, colours kept", async () => {
    const plain = (await run(["show", ids.oil!, "--width", "40"], env)).out.trimEnd().split("\n");
    const r = await run(["show", ids.oil!, "--width", "40", "--cells"], env);
    expect(r.code).toBe(0);
    const grid = JSON.parse(r.out) as { id: string; uri: string; columns: number; rows: number; cells: string; replaced: number };
    expect([grid.id, grid.columns, grid.rows, grid.replaced]).toEqual([ids.oil!, 40, plain.length, 0]);
    expect(grid.uri).toContain(`ep0ch://${scratch.name}@`);
    const bytes = Buffer.from(grid.cells, "base64");
    expect(bytes.length).toBe(40 * plain.length * 12);
    const cell = (x: number, y: number) => [0, 4, 8].map(o => bytes.readUInt32LE((y * 40 + x) * 12 + o));
    const row = (y: number) => String.fromCodePoint(...Array.from({ length: 40 }, (_, x) => cell(x, y)[0]!)).trimEnd();
    expect(Array.from({ length: plain.length }, (_, y) => row(y))).toEqual(plain);
    // The title is drawn in a colour of the theme's, not the terminal's own (bit 24).
    expect(cell(0, 0)[1]! & 0x01000000).toBe(0);
    expect((await run(["show", ids.oil!, "--cells", "--ansi"], env)).code).toBe(2);
    // A preview asks for its first rows only: the whole note is never encoded.
    const two = JSON.parse((await run(["show", ids.oil!, "--width", "40", "--cells", "--rows", "2"], env)).out) as { rows: number; cells: string };
    expect([two.rows, two.cells]).toEqual([2, grid.cells.slice(0, 2 * 40 * 16)]);
    expect((await run(["show", ids.oil!, "--rows", "0"], env)).code).toBe(2);
  });

  test("show draws a live figure and ::links from the outline, as the door does", async () => {
    const r = await run(["show", ids.figures!, "--width", "60"], env);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("no outline connection");
    expect(r.out).toContain("Water the beans");                  // the figure's query, answered by the service
    expect(r.out).toContain("Turn the compost");
    expect(r.out).toContain("Bike shed");                         // ::links: its outlink, resolved
  });

  test("show draws a view note with its results, from the service's views.read, as an embedded view is drawn", async () => {
    const r = await run(["show", `((${ids.queued}))`, "--width", "60"], env);
    expect(r.code).toBe(0);
    expect(r.out).toContain("≡ Queued chores · 2 results");
    expect(r.out).toContain("∙ Water the beans");
    expect(r.out).toContain("∙ Turn the compost");
    // A note that isn't a view gets no results block.
    expect((await run(["show", ids.shed!, "--width", "60"], env)).out).not.toContain("≡");
    // --source is the text as written: no results.
    expect((await run(["show", ids.queued!, "--source"], env)).out).toBe("Queued chores [type::virtual-branch] [query::type=chore]\n");
  });

  test("show prints a folded callout unfolded, with no key hints: nobody can press z in a file", async () => {
    const r = await run(["show", ids.folded!, "--width", "60"], env);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Sam, on Saturdays.");
    expect(r.out).not.toContain("folded");
    expect(r.out).not.toContain("z unfolds");
    expect((await run(["show", ids.folded!, "--source"], env)).out).toBe("Shed rota\n\n> [!note]- Who has the key\n> Sam, on Saturdays.\n");
  });

  test("show --source: each note's text exactly as written, several ids, --- between them; plain show takes several too", async () => {
    const one = await run(["show", ids.figures!, "--source"], env);
    expect(one.code).toBe(0);
    expect(one.out).toContain("Garden figures [count::2]\n\n::graph-check\n---\ntitle: Chores (live query)");
    expect(one.out).toContain(`See ((${ids.shed}|the shed)).`);
    expect(one.out).toContain("\n::links");
    expect(one.out).not.toContain("─");                            // no header, no rule, nothing wrapped
    const two = await run(["show", "--source", ids.shed!, `((${ids.oil}))`], env);
    expect(two.code).toBe(0);
    expect(two.out).toBe("Bike shed\nWhere the bikes live.\n\n---\n\nChain oil\nThe **wax** one, not the spray. See ((x)).\n");
    const drawn = await run(["show", ids.shed!, ids.oil!, "--width", "40"], env);
    expect(drawn.code).toBe(0);
    expect(drawn.out.split("\n")[0]).toBe("Bike shed");
    expect(drawn.out).toContain("Where the bikes live.\n\nChain oil\n");    // a blank line between the drawings
    // One missing id among several: said, the others still printed, exit 1.
    const missing = await run(["show", "--source", ids.shed!, "00000000-0000-4000-8000-000000000000"], env);
    expect([missing.code, missing.err]).toEqual([1, expect.stringContaining("no note")]);
    expect(missing.out).toContain("Where the bikes live.");
    expect((await run(["show", ids.shed!, "--source", "--cells"], env)).code).toBe(2);
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

describe("the ep0ch channel's lines (ext/television's ep0ch-tv)", () => {
  const TV = join(import.meta.dir, "../ext/television/bin/ep0ch-tv");
  // The channel's templates take the id the way tv's replace does; what tv shows and matches is the line less its escapes.
  const ID = /^.*\x1b\]8;;ep0ch:([0-9A-Za-z_-]+)\x1b.*$/;
  const shown = (l: string) => l.replace(/\x1b\][^\x1b]*\x1b\\/g, "").replace(/\x1b\[[0-9;]*m/g, "");
  const row = (id: string, parentId: string | null, depth: number, title: string, props: Record<string, string> = {}) =>
    ({ id, parentId, depth, title, props, updatedAt: 0, position: 0, author: "you", createdAt: 0, hasChildren: false });
  let dir = "";
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "ep0ch-tv-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tv = async (args: string[], lines: string) => {
    const main = join(dir, "main.ts");
    await Bun.write(main, "process.stdout.write(process.env.FAKE_FIND ?? '');\n");
    const p = Bun.spawn([TV, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_DOOR_MAIN: main, FAKE_FIND: lines } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };

  test("each line shows the tree, coloured, and gives back its whole id; the id is neither shown nor matched", async () => {
    const rows = treeOf([
      row("4f6648f1-aaaa", null, 0, "Bike shed"),
      row("ae755888-bbbb", "4f6648f1-aaaa", 1, "Tools 'n' \"spares\" ]8;;ep0ch:fake\tlist", { type: "place" }),
      row("cf2e02f5-cccc", "ae755888-bbbb", 2, "Chain oil"),
    ])!;
    const { out, code } = await tv(["tree"], rows.map(r => treeLine({ ...r, uri: `ep0ch://pie@box-a/b/${r.id}` })).join("\n") + "\n");
    expect(code).toBe(0);
    const lines = out.split("\n").filter(Boolean);
    expect(lines.map(l => l.replace(ID, "$1"))).toEqual(["4f6648f1-aaaa", "ae755888-bbbb", "cf2e02f5-cccc"]);
    expect(lines.map(shown)).toEqual(["Bike shed", "└─ Tools 'n' \"spares\" ]8;;ep0ch:fake list  · place", "   └─ Chain oil"]);
    expect(lines[0]).toContain("\x1b[33;1m");                       // a level's titles in their colour
  });

  test("query: the notes a query holds for (find --query --lines), shown the same way; none named is refused", async () => {
    const main = join(dir, "args.ts");
    // stderr.write, not console.error: Bun colours that under FORCE_COLOR, even into this pipe.
    await Bun.write(main, "process.stderr.write(JSON.stringify(process.argv.slice(2))); process.stdout.write('ab12cd34-eeee\\tSeed order\\tAllotment plot\\n');\n");
    const p = Bun.spawn([TV, "query", "type=errand tag=spring"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_DOOR_MAIN: main } });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(JSON.parse(err)).toEqual(["find", "--query", "type=errand tag=spring", "--lines"]);
    expect(out.split("\n").filter(Boolean).map(shown)).toEqual(["Seed order  · Allotment plot"]);
    expect(out.replace(/\n$/, "").replace(ID, "$1")).toBe("ab12cd34-eeee");
    const none = await tv(["query"], "");
    expect([none.code, none.err]).toEqual([2, expect.stringContaining('ep0ch-tv query "type=chore')]);
  });

  test("an id handed back is only an id's letters: anything else is refused before a command sees it", async () => {
    for (const bad of ["x'; touch nope", "", "a b"]) {
      const r = await tv(["preview", bad], "");
      expect(r.code).toBe(2);
      expect(r.err).toContain("not a note id");
    }
  });
});
