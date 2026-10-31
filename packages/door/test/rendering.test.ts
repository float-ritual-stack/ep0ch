// PIE-444: door readers draw a note the way Detail does. Markdown links read as their text and open their
// destination (a web page in the browser, a pi-outliner:// link in the door); bold, italic and struck-out
// text are styled, on every row they wrap onto, by CommonMark's rules (checked against marked, which
// Detail parses with); and the BBS reader, which drew raw text, now draws its body with the same renderer and addresses a message to
// its `to::`. Fictional notes; the service ones run against a throwaway outliner only.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Msg } from "../src/board";
import { renderDoc, type DocEnv } from "../src/doc";
import { Mirror } from "../src/mirror";
import { groundSeq, setTheme, THEMES, luminance } from "../src/theme";
import { rowBytes } from "../src/term";
import { emphasis } from "../src/inline";
import { addressOf, destinationOf, external, externalOpenCommand, fileOpenCommand, notePageUrl } from "../src/open";
import { presentLinks } from "../src/refs";
import { MessageReader } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const BOLD = "\x1b[1m", ITALIC = "\x1b[3m", STRIKE = "\x1b[9m";
const ENV: DocEnv = { width: 60, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false };
const note = (text: string, props: Record<string, string> = {}): Msg => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, properties: Object.entries(props).map(([key, value]) => ({ key, value })) });

test("wrapped shell substitutions draw and copy without added backticks", () => {
  const command = "sh:: echo $(date) `whoami --version`";
  const doc = renderDoc(command, { ...ENV, width: 30 });
  expect(doc.lines.map(plain)).toEqual(["sh:: echo $(date) `whoami", "--version`"]);
  expect(doc.lines.map((row, i) => (doc.wraps?.get(i) ?? "") + plain(row)).join("")).toBe(command);
});

/** A surface on a fake host: what it flashed, copied and navigated to. `pages`: what `[[…]]` addresses resolve to. */
function setup(text: string, pages: Record<string, Msg> = {}) {
  const flashes: string[] = [], copies: string[] = [], went: Msg[] = [];
  const h: SurfaceHost = {
    ctx: {
      board: {
        ancestors: async () => [], comments: async () => [],
        resolvePage: async (a: string) => (pages[a] ? { status: "resolved", block: pages[a] } : { status: "missing" }),
      },
      flash: (m: string) => flashes.push(m), copy: (t: string) => copies.push(t), t: { cellW: 9, cellH: 16 }, graphics: false,
    } as any,
    redraw() {}, navigate(m) { went.push(m); },
  };
  const s = new NoteSurface();
  s.show(note(text), h);
  const draw = (w = 70) => s.render(w, 30, h).lines;
  const at = (t: string, lines = draw()) => {
    const y = lines.findIndex(l => plain(l).includes(t));
    if (y < 0) throw new Error(`${t} isn't drawn`);
    return { x: plain(lines[y]!).indexOf(t), y };
  };
  return { s, h, flashes, copies, went, draw, at };
}

describe("inline Markdown, by Detail's rules", () => {
  // Every case marked (Detail's parser) and the door must agree on: flanking, `_` inside words, the rule
  // of three, nesting, escapes, code spans. Marked's single-tilde extension is excluded here;
  // text.test.ts covers Blockdown's literal single tildes through the reader renderer.
  const CORPUS = [
    "plain text", "**bold** and *italic* and ~~gone~~", "__bold__ and _italic_", "snake_case_name stays", "__init__ stays",
    "2*3*4 multiplies", "[stage::in_progress] stays", "a * b * c", "***both***", "**bold *nested italic* bold**",
    "*italic **nested bold** italic*", "**unclosed bold", "*a **b** c*", "~~~three~~~ tildes",
    "**`code`** in bold", "`**not bold**` in code", "\\*escaped\\* stars", "a**b**c", "a__b__c", "_a_b", "**a**b**c**",
    "*a*b*c*", "foo*bar*", "foo_bar_", "**foo bar **", "** foo**", "*(**foo**)*", "**foo*bar*baz**", "*foo**bar**baz*",
    "_foo_bar_baz_", "**Note:** do this", "- **bold** item", "x **y** z **w**", "*****x*****", "**a *b** c*",
    "*a **b* c**", "~~a~~b", "a~~b~~c", "~~ a~~", "__a *b* c__", "_a __b__ c_", "it's *really* nice", "“*quoted*”",
    "*(parenthetical)*", "**—dash—**", "*ünicode* ok", "中*文*字", "**bold**:", "(*a*)",
  ];
  const door = (s: string) => emphasis(s).replace(//g, "<b>").replace(//g, "</b>").replace(//g, "<i>")
    .replace(//g, "</i>").replace(//g, "<s>").replace(//g, "</s>");

  test.skipIf(!outliner)("the door styles CommonMark emphasis and double-tilde strikes as marked does", async () => {
    const { Marked } = await import(join(outliner!, "node_modules/marked/lib/marked.esm.js"));
    const lexer = new Marked().Lexer;
    const canon = (toks: any[]): string => toks.map(t => t.type === "strong" ? `<b>${canon(t.tokens)}</b>` : t.type === "em" ? `<i>${canon(t.tokens)}</i>`
      : t.type === "del" ? `<s>${canon(t.tokens)}</s>` : t.type === "codespan" ? t.raw : t.type === "escape" ? t.text : t.tokens ? canon(t.tokens) : t.text ?? t.raw).join("");
    expect(CORPUS.map(door)).toEqual(CORPUS.map(c => canon(lexer.lexInline(c))));
  });

  test("bold, italic and strikethrough are drawn as styles, and the delimiters are gone", () => {
    const lines = renderDoc(presentLinks("A **firm** plan, a *soft* one, a ~~dropped~~ one; `**code**` stays.", false, null), ENV).lines;
    expect(plain(lines.join("\n"))).toBe("A firm plan, a soft one, a dropped one; **code** stays.");
    expect(lines[0]).toContain(`${BOLD}firm`);
    expect(lines[0]).toContain(`${ITALIC}soft`);
    expect(lines[0]).toContain(`${STRIKE}dropped`);
  });

  test("bold has one brighter tone across rows and restores surrounding colours", () => {
    for (const name of ["calm", "night", "classic"] as const) {
      setTheme(name);
      try {
        const source = [
          "**Standalone**", "", "Before **Inline** after.", "",
          "[Link **Strong** tail](https://example.org)", "",
          "**Around [Link](https://example.org) tail** after.", "",
          "## Heading **Strong** tail", "",
          "> [!note] Callout", "> Before **Strong** tail.", "",
          "- Before **Strong** tail.", "",
          "**Wrapped words carried across several rows** after.", "",
          "**Start `code` resume** after.", "",
          "**Start [plot::north] resume** after.",
        ].join("\n");
        const lines = renderDoc(presentLinks(source, false, null), { ...ENV, width: 36 }).lines;
        const mirror = new Mirror(80, lines.length);
        mirror.write(groundSeq());
        lines.forEach((line, y) => mirror.write(rowBytes(y, line, 80)));
        const cell = (row: string, word: string) => {
          const y = lines.findIndex(l => plain(l).includes(row));
          expect(y).toBeGreaterThanOrEqual(0);
          return mirror.cells[y]![plain(lines[y]!).indexOf(word)]!.fg;
        };
        const strong = cell("Standalone", "Standalone"), body = THEMES[name].palette[7]!;
        expect(luminance(strong as [number, number, number])).toBeGreaterThan(luminance(body));
        expect(cell("Before Inline", "Inline")).toEqual(strong);
        expect(cell("Before Inline", "after")).toEqual([...body]);
        expect(cell("Link Strong tail", "Strong")).toEqual([...THEMES[name].external]);
        expect(cell("Link Strong tail", "tail")).toEqual([...THEMES[name].external]);
        expect(cell("Around Link", "Link")).toEqual([...THEMES[name].external]);
        expect(cell("Around Link", "tail")).toEqual(strong);
        expect(cell("Heading Strong", "Strong")).toEqual(cell("Heading Strong", "Heading"));
        expect(cell("Heading Strong", "tail")).toEqual(cell("Heading Strong", "Heading"));
        const bodies = lines.map(plain).map((l, y) => ({ l, y })).filter(({ l }) => l.includes("Before Strong"));
        expect(bodies.length).toBe(2);
        for (const { l, y } of bodies) {
          expect(mirror.cells[y]![l.indexOf("Strong")]!.fg).toEqual(strong);
          expect(mirror.cells[y]![l.indexOf("tail")]!.fg).toEqual(mirror.cells[y]![l.indexOf("Before")]!.fg);
        }
        expect(cell("Start code resume", "resume")).toEqual(strong);
        expect(cell("Start [plot::north] resume", "resume")).toEqual(strong);
        expect(cell("Wrapped words", "Wrapped")).toEqual(strong);
        expect(cell("rows after.", "rows")).toEqual(strong);
        expect(cell("rows after.", "after")).toEqual([...body]);
      } finally { setTheme("calm"); }
    }
  });

  test("a bold span that wraps is bold on every row it's on, and the rows keep their width", () => {
    const lines = renderDoc(presentLinks("Start **the whole of this phrase is bold across rows** end.", false, null), { ...ENV, width: 16 }).lines;
    const rows = lines.map(plain);
    expect(rows.join(" ")).toBe("Start the whole of this phrase is bold across rows end.");
    expect(rows.every(r => [...r].length <= 16)).toBe(true);
    const bold = lines.filter(l => /whole|phrase|bold|across|rows/.test(plain(l)));
    expect(bold.length).toBeGreaterThan(2);
    for (const l of bold) expect(l).toContain(BOLD);
    expect(lines.at(-1)!.indexOf("end")).toBeGreaterThan(lines.at(-1)!.lastIndexOf("\x1b[22m"));
  });

  test("a heading keeps its weight around a strong span, and takes italics", () => {
    const lines = renderDoc(presentLinks("## The **big** *dig*", false, null), ENV).lines;
    expect(plain(lines[0]!)).toBe("## The big dig");
    expect(lines[0]).not.toContain("\x1b[22m");
    expect(lines[0]).toContain(`${ITALIC}dig`);
  });
});

describe("Markdown links", () => {
  let runs: string[][] = [];
  const run = external.run, display = process.env.DISPLAY, ssh = process.env.SSH_CONNECTION, sshClient = process.env.SSH_CLIENT, tty = process.env.SSH_TTY;
  beforeAll(() => { process.env.DISPLAY = ":fictional"; delete process.env.SSH_CONNECTION; delete process.env.SSH_CLIENT; delete process.env.SSH_TTY; external.run = cmd => { runs.push(cmd); }; });
  afterEach(() => { runs = []; });
  afterAll(() => { external.run = run; if (display === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = display; if (ssh === undefined) delete process.env.SSH_CONNECTION; else process.env.SSH_CONNECTION = ssh; if (sshClient === undefined) delete process.env.SSH_CLIENT; else process.env.SSH_CLIENT = sshClient; if (tty === undefined) delete process.env.SSH_TTY; else process.env.SSH_TTY = tty; });
  const shed = note("Bike shed\nThree bikes.");
  const TEXT = "Allotment notes\nAsk [the society](https://example.org/allotments) or see [the shed](pi-outliner://page/Bike%20shed), not ![a photo](plot.png).";

  test("read as their text; an image stays as typed; a drag (and y) copies what's drawn", () => {
    const { s, h, copies, draw, at } = setup(TEXT);
    const row = plain(draw()[at("Ask").y]!).trim();
    // The ↗ after a link to the web is drawn, and never copied or part of the link's label (an adornment: ADORN).
    expect(row).toBe("Ask the society↗ or see the shed, not ![a photo](plot.png).");
    const a = at("Ask"), z = at("shed,");
    s.press(a.x, a.y, h); s.drag(z.x + 5, z.y, h); s.release(z.x + 5, z.y, h);
    expect(copies).toEqual(["Ask the society or see the shed,"]);   // copy on select
    s.key(char("y"), h);
    expect(copies).toEqual(["Ask the society or see the shed,", "Ask the society or see the shed,"]);
  });

  test("[ ] stops on each in reading order, and ⏎ opens a web page in the browser", () => {
    const { s, h, flashes, draw } = setup(TEXT);
    draw();
    s.key(char("]"), h); draw();
    expect(s.describe().elements!.current).toMatchObject({ n: 1, kind: "link", label: "the society", target: "https://example.org/allotments" });
    expect(s.hint()).toContain("⏎ open");
    s.key({ kind: "enter" }, h);
    expect(runs).toEqual([externalOpenCommand("https://example.org/allotments")]);
    expect(flashes.at(-1)).toBe("opened https://example.org/allotments in the browser");
    s.key(char("]"), h); draw();
    expect(s.describe().elements!.current).toMatchObject({ n: 2, kind: "link", label: "the shed" });
  });

  test("a click opens it too, and a pi-outliner:// page link opens the note in the door", async () => {
    const { s, h, went, at } = setup(TEXT, { "Bike shed": shed });
    const web = at("the society");
    s.click(web.x + 2, web.y, h);
    expect(runs).toEqual([externalOpenCommand("https://example.org/allotments")]);
    const p = at("the shed");
    s.click(p.x + 2, p.y, h);
    await Bun.sleep(20);
    expect(went.map(m => m.text)).toEqual([shed.text]);
    expect(runs.length).toBe(1);
  });

  test("a destination that's neither a web page nor an outliner link says so and opens nothing", () => {
    const { s, h, flashes, draw } = setup("Odd links\nSee [the plan](plan.md) and [a call](tel:123).");
    draw();
    s.key(char("]"), h); s.key({ kind: "enter" }, h);
    s.key(char("]"), h); s.key({ kind: "enter" }, h);
    expect(runs).toEqual([]);
    expect(flashes.slice(-2)).toEqual(["not a web or outliner link: plan.md", "not a web or outliner link: tel:123"]);
  });

  test("the command that opens a web page is Detail's, per platform", () => {
    expect(externalOpenCommand("https://example.org/a b", "linux")).toEqual(["xdg-open", "https://example.org/a%20b"]);
    expect(externalOpenCommand("https://example.org/", "darwin")).toEqual(["open", "https://example.org/"]);
    expect(() => externalOpenCommand("file:///etc/passwd", "linux")).toThrow();
    // A figure's file opens in the system viewer the same way: xdg-open on Linux (`open` is macOS's).
    expect(fileOpenCommand("/tmp/figures/bean-trench.png", "linux")).toEqual(["xdg-open", "/tmp/figures/bean-trench.png"]);
    expect(fileOpenCommand("/tmp/figures/bean-trench.png", "darwin")).toEqual(["open", "/tmp/figures/bean-trench.png"]);
  });
});

test("a ```component:<name> fence is a code block like any other, drawn as code", () => {
  const { draw } = setup("Status\n```component:status\nTo do :: 4\n```");
  const lines = draw().map(l => plain(l).trim());
  // The block's copy control (PIE-638) is at the right end of its first row.
  expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^╭ component:status +⧉$/), "│ To do :: 4"]));
});

describe.skipIf(!outliner)("the BBS reader, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const term = { cols: 100, rows: 40, cellW: 9, cellH: 16, kitty: false };
  const draw = async (m: Msg) => {
    const r = new MessageReader([m], 0);
    const ctx = { t: term, board, redraw() {}, flash() {} } as any;
    r.render(ctx);
    await Bun.sleep(300);                                   // the references are resolved by the service
    return r.render(ctx).lines;
  };
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); });
  afterAll(async () => { board.close(); await scratch.stop(); });

  test("shell embed syntax stays literal in the reader", async () => {
    const target = await create(null, "Garden instructions\nWater the seedlings.");
    const command = `sh:: printf '%s' '!((${target.id}))'`;
    const msg = await create(null, `Literal shell\n\n${command}`);
    const text = (await draw((await board.get(msg.id))!)).map(plain).join("\n");
    expect(text).toContain(command);
    expect(text).not.toContain("Water the seedlings.");
  });

  test("draws its body like every reader: labelled refs, Markdown links, bold, metadata lines hidden", async () => {
    const kettle = await create(null, "Descale the kettle");
    const msg = await create(null, `Allotment meeting [to::the plot committee]\n[season::autumn]\n\nBring ((${kettle.id}|the kettle)) and read [the rules](https://example.org/rules).\nThe **gate code** changed.`);
    const lines = await draw((await board.get(msg.id))!);
    const text = lines.map(plain).join("\n");
    expect(text).toContain("Bring the kettle and read the rules↗.");
    expect(text).not.toContain("((");
    expect(text).not.toContain("](");
    expect(text).not.toContain("**");
    expect(text).not.toContain("[season::autumn]");
    expect(lines.find(l => plain(l).includes("gate code"))).toContain(`${BOLD}gate code`);
    expect(text).toMatch(/To: the plot committee\s+Refer#/);
  });

  test("a message without to:: is to ALL", async () => {
    const msg = await create(null, "Open day\nEveryone welcome.");
    expect((await draw((await board.get(msg.id))!)).map(plain).join("\n")).toMatch(/To: ALL\s+Refer#/);
  });
});

describe("link schemes", () => {
  test("http(s) schemes match in any case, as CommonMark and Detail treat them", () => {
    expect(destinationOf("HTTPS://example.org/allotment")).toEqual({ web: "https://example.org/allotment" });
    expect(destinationOf("Http://example.org")).toEqual({ web: "http://example.org/" });
    expect(destinationOf("ftp://example.org")).toMatchObject({ refused: expect.any(String) });
  });

  // PIE-1297: note.copy-ref kind=link writes a note's web address; another outline's opens back in the door.
  test("a note's web link names its outline (/pub/o/<name>/p/), on the web client's origin; none known, /pub/p/", () => {
    const id = "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34";
    expect(notePageUrl("PIE-12", undefined, {})).toBe("https://my.ep0ch.sh/pub/p/PIE-12");
    expect(notePageUrl(id, "orchard", { EP0CH_WEB_URL: "https://web.example.org/, https://other.example.org" })).toBe(`https://web.example.org/pub/o/orchard/p/${id}`);
    expect(destinationOf(notePageUrl(id, "orchard", {}))).toEqual({ target: { outline: "orchard", block: id } });
    // PIE-1398: every form it writes reads back as the note: /pub/p/ (this outline's), a Work ID's, on the web client's own origin.
    expect(destinationOf(notePageUrl(id, undefined, {}))).toEqual({ target: { block: id } });
    expect(destinationOf(notePageUrl("PIE-12", undefined, {}))).toEqual({ target: { page: "PIE-12" } });
    const env = { EP0CH_WEB_URL: "https://web.example.org" };
    expect(destinationOf(notePageUrl(id, "orchard", env), env)).toEqual({ target: { outline: "orchard", block: id } });
    expect(destinationOf("https://example.org/pub/p/PIE-12", env)).toEqual({ web: "https://example.org/pub/p/PIE-12" });
    expect(addressOf(`((orchard:${id}^beds|the beds line))`)).toEqual({ block: id, outline: "orchard", fragment: "beds", label: "the beds line" });
    expect(addressOf("garden plan")).toBeNull();
    expect(addressOf("tile.open kind=query")).toBeNull();
  });
});
