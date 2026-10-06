// The figure kinds from mdxcn.dev's ideas (src/figures/), their rows written in Markdown (outline-core's
// figure-markdown.ts), a quote's byline, and `ep0ch export`'s ASCII twin. Pure renders: no outline.
import { describe, expect, test } from "bun:test";
import { renderDoc } from "../src/doc";
import { C, fg } from "../src/style";
import { figureAscii, figureSource, reframeAscii, renderGraph } from "../src/graphs";
import { figuresAsAscii } from "../src/export";
import { registryKeys } from "../src/figures/keys";
import { uptimeDays } from "../src/figures/days";
import { annotateMarkdown } from "../src/figures/annotate";
import { parseFigureMarkdown } from "@ep0ch/outline-core/figure-markdown";
import { NOTE_ACTIONS } from "../src/surface/note";
import { runNote, took } from "../scripts/backup-runs";
import { invalidateLive, liveSettled, setLiveSource } from "../src/live";
import { linksOf, listenLinks, setLinksSource } from "../src/links";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const draw = (kind: string, lines: string[], w = 60) => renderGraph(kind, figureSource(lines), w).map(plain);
const body = (out: string[]) => out.slice(2, -2).map(l => l.slice(2, -2).trimEnd());

describe("rows in Markdown, for the first kinds", () => {
  test("timeline: a row a dated event; bold now, italic next, a side note muted after it", () => {
    expect(body(draw("timeline", ["---", "title: plot", "---", "- Feb: dig over", "- **Mar: potatoes** — after the frost", "- *Apr: beans*"]))).toEqual([
      "●  Feb  dig over", "│", "●  Mar  potatoes  — after the frost", "│", "○  Apr  beans",
    ]);
  });
  test("the YAML wins where both give a field; the Markdown fills the rest", () => {
    const out = body(draw("check", ["---", "title: t", "items:", "  - { label: from yaml, done: true }", "---", "- [ ] from markdown"]));
    expect(out).toEqual(["[x]  from yaml"]);
    expect(body(draw("check", ["---", "title: t", "---", "- [x] boxed", "- **bold is done**", "- open — a note"]))).toEqual(["[x]  boxed", "[x]  bold is done", "[ ]  open", "      a note"]);
  });
  test("spark from runs; rank and stat take a bold row as the accent", () => {
    expect(body(draw("spark", ["- 0 4*3 8"]))).toEqual(["_▒▒▒█"]);
    expect(body(draw("rank", ["- a: 4", "- **b: 2**"]))[1]).toMatch(/^b\s+\[=+-+\]\s+2$/);
    const stat = renderGraph("stat", figureSource(["- one: 1", "- **two: 2**", "- three: 3"]), 60);
    // The accent is the bold item's colour, not the last's.
    expect(stat.find(l => plain(l).includes("1  "))!).toMatch(/\x1b\[1m2/);
  });
  test("a figure with no --- is Markdown throughout; a bad YAML says so in its frame", () => {
    expect(body(draw("rank", ["- a: 1"]))[0]).toMatch(/^a\s+\[=+\]\s+1$/);
    expect(draw("rank", ["---", "title: [unclosed", "---"]).join("\n")).toContain("bad YAML");
    // A `---` after Markdown is a rule, not YAML: only a first line of `---` opens the props.
    expect(figureSource(["1 2 3", "---", "4 5"])).toMatchObject({ yaml: "", markdown: ["1 2 3", "---", "4 5"] });
    expect(figureSource(["", "---", "title: t", "---", "- a"])).toMatchObject({ yaml: "title: t", markdown: ["- a"] });
    expect(draw("spark", ["1 2 3", "---", "4 5"]).join("\n")).not.toContain("bad YAML");
  });
});

describe("the newer kinds", () => {
  test("decision: chosen, rejected and open, each with its reason; the text and the status after", () => {
    expect(body(draw("decision", ["---", "title: d", "status: decided", "date: 2026-10-03", "---", "- **Bun** — one lockfile", "- *pnpm* — two tools", "- nx", "", "We run Bun."]))).toEqual([
      "● Bun   — one lockfile", "× pnpm  — two tools", "○ nx", "", "We run Bun.", "", "decided · 2026-10-03",
    ]);
  });
  test("chat: the first speaker prompted, a repeat unnamed, an aside dim; you: picks the prompt", () => {
    expect(body(draw("chat", ["- loki: done", "- loki: 14 snapshots", "- shypht: *nods*", "- daddy: tea?"]))).toEqual([
      "> loki    done", "          14 snapshots", "  shypht  nods", "  daddy   tea?",
    ]);
    expect(body(draw("chat", ["---", "you: daddy", "---", "- loki: hi", "- daddy: tea?"]))).toEqual(["  loki   hi", "> daddy  tea?"]);
  });
  test("keys: keycaps, then and or dim; a sheet from the action registry", () => {
    expect(body(draw("keys", ["- **e: edit**", "- g then d: the desk", "- ctrl+k: palette"]))).toEqual([
      "[e]           edit", "[g] then [d]  the desk", "[ctrl][k]     palette",
    ]);
    // The registry holds what this process has made: the reader's actions, imported above.
    expect(NOTE_ACTIONS.has("edit")).toBe(true);
    const keys = registryKeys(["note"], ["edit"]);
    expect(keys[0]).toMatchObject({ keys: "e", learn: true });
    expect(keys.some(k => /click|drag/.test(k.keys))).toBe(false);
    expect(body(draw("keys", ["---", "actions: note", "learn: [edit]", "limit: 3", "---"])).length).toBe(3);
    expect(body(draw("keys", ["---", "actions: nowhere", "---"]))[0]).toContain("no action in nowhere");
  });
  test("uptime: each dated row starts at its date; days: in YAML is a list, a number is refused, not a crash", () => {
    const out = body(draw("uptime", ["- 2026-02-01: ok*3", "- 2026-02-06: down ok"]));
    expect(out[0]).toBe("███--·█");
    expect(out[1]).toBe("2026-02-01 2026-02-07");
    expect(draw("uptime", ["---", "days: 30", "---"]).join("\n")).not.toContain("couldn't draw");
    // from: with undated rows: to is where they end.
    expect(body(draw("uptime", ["---", "from: 2026-09-01", "---", "- ok*3"]))[1]).toBe("2026-09-01 2026-09-03");
  });
  test("uptime: a glyph a day, wrapped, the % ok of the days with a run, and the worst run of a day counts", () => {
    const out = body(draw("uptime", ["---", "wrap: 10", "---", "- 2026-09-01: ok*8 degraded down ok*2 none"]));
    expect(out).toEqual(["████████▒·", "██-", "2026-09-01 2026-09-13", "", "83.3% ok · 12 of 13 days · 1 degraded · 1 down"]);
    const days = uptimeDays([{ day: 10, state: "ok" }, { day: 10, state: "down", block: "b" }, { day: 12, state: "ok" }]);
    expect(days.days).toEqual(["down", "empty", "ok"]);
    expect(days.blocks[0]).toBe("b");
  });
  test("activity: weeks as columns from the week holding the first count, shades by share of the most", () => {
    const out = body(draw("activity", ["---", "weekStartsOn: mon", "---", "- 2026-03-02: 0 1 2 4 0*3"]));
    expect(out[0]).toContain("Mar");
    expect(out.slice(1, 8).map(l => l.slice(4).trim())).toEqual(["·", "░", "▒", "█", "·", "·", "·"]);
    expect(out.at(-1)).toContain("7 in 1 week");
  });
  test("calendar: the month's grid from its first weekday, today bracketed, marks listed", () => {
    const out = body(draw("calendar", ["---", "today: 2026-03-11", "---", "- 2026-03-12: **launch**", "- 20: committee"]));
    expect(out[0]!.trim()).toBe("March 2026");
    expect(out[1]).toBe(" Mo  Tu  We  Th  Fr  Sa  Su");
    expect(out[2]!.trimEnd()).toBe("                          1");
    expect(out[4]).toContain("10 [11] 12");
    expect(out.slice(-2)).toEqual(["12   launch", "20   committee"]);
  });
  test("calendar: a row dated in another month isn't marked in the month shown", () => {
    const out = body(draw("calendar", ["---", "today: 2026-03-11", "---", "- 2026-03-12: launch", "- 2026-04-02: april fool"]));
    expect(out.join("\n")).not.toContain("april fool");
    expect(out.slice(-1)).toEqual(["12   launch"]);
    // The YAML's month wins: its marks are the rows dated in it.
    const april = body(draw("calendar", ["---", "year: 2026", "month: 4", "---", "- 2026-03-12: launch", "- 2026-04-02: april fool"]));
    expect(april.slice(-1)).toEqual([" 2   april fool"]);
  });
  test("annotate: the marked lines numbered in the gutter, their markers gone, the notes after", () => {
    expect(body(draw("annotate", ["```js", "const a = 1; // (1)", "b()", "c() # (2)", "```", "1. one", "2. two"]))).toEqual([
      "[1] const a = 1;", "    b()", "[2] c()", "", "[1] one", "[2] two",
    ]);
  });
});

describe("a quote's byline", () => {
  const doc = (text: string, width = 50) => renderDoc(text, { width, cellW: 9, cellH: 18, graphics: false, maxImageRows: 4, unfold: true }).lines.map(plain);
  test("drawn to the right inside the frame, after the quote; a note's dash line stays prose", () => {
    const out = doc("> [!quote] Sheds\n> A room that admits it is temporary.\n>\n> — Ada, the newsletter");
    expect(out.find(l => l.includes("— Ada"))).toMatch(/^│ {10,}— Ada, the newsletter │$/);
    expect(out.join("\n")).not.toContain("> —");
    expect(doc("> [!cite] S\n> words\n> — Bo").find(l => l.includes("— Bo"))).toMatch(/ {20,}— Bo │$/);
    expect(doc("> [!note] N\n> words\n> — not a byline").find(l => l.includes("— not"))).toMatch(/^│ — not a byline/);
  });
});

describe("ep0ch export's ASCII twin", () => {
  test("mdxcn's fenced frame, no colour, 60 wide, read back by reframeAscii", () => {
    const ascii = figureAscii("decision", figureSource(["---", "title: one repo", "---", "- **Bun** — one lockfile"]));
    expect(ascii[0]).toMatch(/^\+-+ \[ ONE REPO \] -+\+$/);
    expect(ascii.at(-1)).toMatch(/^\+-+\+$/);
    expect(ascii.every(l => l.length === 60 && !l.includes("\x1b"))).toBe(true);
    expect(ascii.slice(1, -1).every(l => l.startsWith("|") && l.endsWith("|"))).toBe(true);
    expect(reframeAscii(ascii, 80)!.map(plain).join("\n")).toContain("● Bun  — one lockfile");
    // Untitled: the kind is its title, so it reads back; a · in a title stays.
    const untitled = figureAscii("rank", figureSource(["- a: 1"]));
    expect(untitled[0]).toMatch(/^\+-+ \[ RANK \] -+\+$/);
    expect(reframeAscii(untitled, 80)).not.toBeNull();
    expect(figureAscii("rank", figureSource(["---", "title: a · b", "---", "- a: 1"]))[0]).toMatch(/^\+-+ \[ A · B \] -+\+$/);
  });
  test("annotate: a note numbered 0 or far past the rows is placed among them, never a hole of a million", () => {
    const md = (rows: string[]) => annotateMarkdown(parseFigureMarkdown(rows) as any).notes;
    expect(md(["0. zero", "1000000. far"])).toEqual(["zero", "far"]);
    expect(md(["2. two", "1. one"])).toEqual(["one", "two"]);
  });
  test("a note's figures become fences; code fences and the rest stay as written", () => {
    const text = ["Title", "before", "::graph-rank", "---", "title: r", "---", "- a: 1", "::", "```", "::graph-rank", "::", "```", "after"].join("\n");
    const out = figuresAsAscii(text, "n").split("\n");
    expect(out.slice(0, 3)).toEqual(["Title", "before", "```"]);
    expect(out[3]).toMatch(/^\+-+ \[ R \] -+\+$/);
    expect(out.slice(-6)).toEqual(["```", "```", "::graph-rank", "::", "```", "after"]);
    expect(out.filter(l => l === "::graph-rank").length).toBe(1);
  });
  test("an unclosed figure is plain text, as Detail and the service's sections read it: exported as written", () => {
    const text = ["Title", "::graph-rank", "- a: 1", "- b: 2"].join("\n");
    expect(figuresAsAscii(text, "n")).toBe(text);
  });
});

describe("a figure block's child bullets", () => {
  // A stand-in outline: the note's children, and a query that never answers.
  const kids = [{ id: "k1", text: "Apr: sow [type::row] - [n::1]", props: {} }, { id: "k2", text: "**May: plant**", props: {} }, { id: "c", text: "a comment", props: { type: "annotation-comment" } }];
  let asked = 0;
  const fake = { children: async () => { asked++; return kids; }, request: () => new Promise(() => {}), toMsgs: (b: any) => b } as any;
  test("its rows, their header chips and dashes gone, comments left out; the footer only when a child row drew", async () => {
    setLiveSource(fake, () => {}); invalidateLive();
    const src = figureSource(["---", "title: rows", "---"], "note", true);
    renderGraph("timeline", src, 60);
    await liveSettled();
    const out = renderGraph("timeline", src, 60).map(plain);
    expect(out.join("\n")).toContain("Apr  sow");
    expect(out.join("\n")).not.toContain(" - ");
    expect(out.join("\n")).not.toContain("a comment");
    expect(out.at(-1)).toContain("live · child notes");
    // The YAML gives the events: no child rows drawn, no footer, and the children aren't asked for.
    const before = asked; invalidateLive();
    const yaml = renderGraph("timeline", figureSource(["---", "title: rows", "events: [{ date: x, label: y }]", "---"], "note", true), 60).map(plain);
    expect(yaml.at(-1)).not.toContain("child notes");
    expect(asked).toBe(before);
  });
  test("child bullets this kind makes nothing of (a calendar's need a day) draw no footer", async () => {
    setLiveSource(fake, () => {}); invalidateLive();
    const src = figureSource(["---", "title: month", "year: 2026", "month: 3", "---"], "note", true);
    renderGraph("calendar", src, 60);
    await liveSettled();
    expect(renderGraph("calendar", src, 60).map(plain).at(-1)).not.toContain("child notes");
  });
  test("a figure block whose YAML gives its rows, never takes child bullets (nor asks for them)", () => {
    setLiveSource(fake, () => {}); invalidateLive();
    const before = asked;
    renderGraph("calendar", figureSource(["---", "marks: [{ day: 3, label: x }]", "---"], "note", true), 60);
    renderGraph("uptime", figureSource(["---", "days: [ok, down]", "---"], "note", true), 60);
    expect(asked).toBe(before);
  });
  test("only the note's figure block takes them: not one in a part drawn on its own (a callout, a fragment)", async () => {
    setLiveSource(fake, () => {}); invalidateLive();
    const env = { width: 60, cellW: 9, cellH: 18, graphics: false, maxImageRows: 4, unfold: true, note: "note" };
    const fig = "::graph-timeline\n---\ntitle: rows\n---\n::";
    renderDoc(fig, env); await liveSettled();
    expect(renderDoc(fig, env).lines.map(plain).join("\n")).toContain("Apr  sow");
    expect(renderDoc(fig, { ...env, nested: true }).lines.map(plain).join("\n")).not.toContain("Apr  sow");
    expect(renderDoc(`intro\n${fig}`, env).lines.map(plain).join("\n")).not.toContain("Apr  sow");
  });
  test("export finds the figure block as the reader does: under the title and its property lines", async () => {
    setLiveSource(fake, () => {}); invalidateLive();
    const text = "Beans\n[type::figures]\n\n::graph-timeline\n---\ntitle: rows\n---\n::";
    figuresAsAscii(text, "note"); await liveSettled();
    expect(figuresAsAscii(text, "note")).toContain("Apr  sow");
  });
  test("a ::links answer arriving tells listenLinks (drawNote's loop draws again), and an answer for an outline swapped out is dropped", async () => {
    let told = 0;
    const off = listenLinks(() => told++);
    const links = { authoredLinks: async () => [], backlinks: async () => [] } as any;
    setLinksSource(links, () => {});
    linksOf("x"); await Bun.sleep(5);
    expect(told).toBeGreaterThan(0);
    // Asked of one outline, answered after another took its place: not this outline's answer.
    let answer!: (v: unknown) => void;
    setLinksSource({ authoredLinks: () => new Promise(r => { answer = r; }), backlinks: () => new Promise(() => {}) } as any, () => {});
    linksOf("y");
    setLinksSource(links, () => {});
    answer([{ stale: true }]); await Bun.sleep(5);
    expect(JSON.stringify(linksOf("y"))).not.toContain("stale");
    off(); setLinksSource(null, () => {});
  });
  test("liveSettled gives up after its deadline when the outline never answers", async () => {
    setLiveSource(fake, () => {}); invalidateLive();
    renderGraph("check", figureSource(["---", "query: \"type=never\"", "---"]), 60);
    const t = Date.now();
    await liveSettled(200);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe("backup runs", () => {
  const script = (...args: string[]) => Bun.spawnSync(["bun", "scripts/backup-runs.ts", ...args], { cwd: `${import.meta.dir}/..`, env: { ...process.env, EP0CH_SOCKET: "/nonexistent/ep0ch.sock" }, stderr: "pipe" });
  test("a refusal says the command that works, with the values given", () => {
    const date = script("--ws", "pie", "--status", "ok", "--date", "3 Oct");
    expect(date.exitCode).toBe(2);
    // The script by its whole path: a timer runs it from anywhere.
    const self = `bun ${import.meta.dir.replace(/test$/, "scripts")}/backup-runs.ts`;
    expect(date.stderr.toString()).toContain(`${self} --ws pie --status ok --date ${new Date().getFullYear()}-`);
    const none = script("--ws", "pie");
    expect(none.stderr.toString()).toContain(`${self} --ws pie --status ok`);
  });
  test("one note a run: its properties between ` - `, as a header line writes them", () => {
    expect(runNote({ source: "restic", status: "ok", date: "2026-10-03", took: took(252_000) })).toBe(
      "restic backup 2026-10-03 [type::backup-run] - [status::ok] - [date::2026-10-03] - [source::restic] - [took::4m 12s]",
    );
  });
});

describe("the comparison kinds (PIE-575 to PIE-579)", () => {
  test("quadrant: a cell per (x, y), the axes ordered by xs: and ys:, corners named; narrow, dots and a legend", () => {
    const src = ["---", "title: q", "xs: [cheap, costly]", "ys: [prevents, nothing]", "quadrants: [edges, '', '', the hard ones]", "---", "- wire: cheap, prevents", "- **identity: costly, nothing**", "- parsers: costly, nothing"];
    const wide = body(draw("quadrant", src, 70));
    expect(wide[0]).toMatch(/^\s+edges$/);
    expect(wide[1]).toMatch(/^prevents\s+│·wire\s*$/);
    expect(wide[2]).toMatch(/^nothing\s+│\s+·identity$/);
    expect(wide[3]).toMatch(/^\s+·parsers$/);
    expect(wide.at(-1)).toMatch(/the hard ones$/);
    const narrow = body(draw("quadrant", src, 40));
    expect(narrow[2]).toMatch(/^nothing\s+│\s+●●\s*$/);
    expect(narrow.join("\n")).toContain("identity (costly, nothing)");
    // The bold row is the accent.
    expect(renderGraph("quadrant", figureSource(src), 70).join("\n")).toMatch(/\x1b\[1m[^\n]*identity/);
  });
  test("matrix: rows by one property, columns by another, cells toned and totalled; narrow heads cut to fit", () => {
    const src = ["---", "title: m", "order-across: [edges, identity]", "---", "- CodeRabbit: edges=80 identity=2", "- ultrareview: identity=2 parsers=1"];
    const out = body(draw("matrix", src, 70));
    expect(out[0]).toMatch(/^\s+edges\s+identity\s+parsers\s*$/);
    expect(out[1]).toMatch(/^CodeRabbit\s+█ 80\s+░ 2\s+·\s*$/);
    expect(out[2]).toMatch(/^ultrareview\s+·\s+░ 2\s+░ 1\s*$/);
    expect(out[4]).toMatch(/^\s+80\s+4\s+1\s*$/);
    expect(body(draw("matrix", src, 34))[0]).toMatch(/iden…/);
  });
  test("compare: cells between |s aligned by label under their column names; under 60 columns it stacks", () => {
    const src = ["---", "title: c", "columns: [Raised beds, Grow bags]", "---", "- cost: £60 of boards | £12 a bag", "- **lasts: ten years | two seasons**"];
    const wide = body(draw("compare", src, 70));
    expect(wide[0]).toMatch(/^\s+┊ Raised beds\s+┊ Grow bags\s*$/);
    expect(wide[2]).toMatch(/^cost\s+┊ £60 of boards\s+┊ £12 a bag\s*$/);
    const stacked = body(draw("compare", src, 44));
    expect(stacked.slice(0, 3)).toEqual(["cost", "  Raised beds  £60 of boards", "  Grow bags    £12 a bag"]);
  });
  test("flow: each source's total and its flows weighted by share, then the targets' totals; `->` works too", () => {
    const out = body(draw("flow", ["- main → recorded: 5", "- main -> fixed: 2", "- **Effect → fixed: 4**"], 60));
    expect(out[0]).toMatch(/^main\s+7 █+$/);
    expect(out[1]).toMatch(/^  ═+▶ recorded 5$/);
    expect(out[2]).toMatch(/^  ─+▶ fixed 2$/);
    expect(out[3]).toMatch(/^Effect\s+4 █+$/);
    expect(out.slice(-2).map(l => l.split(/\s+/)[0])).toEqual(["fixed", "recorded"]);
  });
  test("meter with a limit: a bar per row to the limit, the headroom said, an overrun marked; without one, the share as before", () => {
    const out = body(draw("meter", ["---", "title: b", "limit: 150", "unit: ms", "---", "- door: 90", "- **barrel: 181**"], 70));
    expect(out[0]).toMatch(/^door\s+█+-+┃\s+90 \/ 150 ms$/);
    expect(out[1]).toMatch(/^\s+60 ms left$/);
    expect(out[2]).toMatch(/^barrel\s+█+┃\s+181 \/ 150 ms$/);
    expect(out[3]).toMatch(/^\s+31 ms over$/);
    expect(renderGraph("meter", figureSource(["---", "limit: 150", "---", "- barrel: 181"]), 70).join("")).toContain(fg(C.lred) + "31 over");
    expect(body(draw("meter", ["---", "value: 0.4", "---"], 60))[0]).toMatch(/^█+-+\s+40%$/);
  });
});

describe("one width rule for every kind (PIE-581)", () => {
  const within = (out: string[], w: number) => out.every(l => Bun.stringWidth(plain(l)) <= w);
  test("stat tiles wrap into rows; a narrow table keeps the title column and one more and says what it dropped", () => {
    const stat = body(draw("stat", ["- a: 1", "- b: 22", "- c: 333", "- d: 4", "- e: 55", "- f: 6"], 36));
    expect(stat).toHaveLength(5);
    expect(stat[3]).toMatch(/^55\s+6\s*$/);
    const table = body(draw("table", ["---", "headers: [Job, Stage, Priority, Owner]", "rows:", "  - [Fix the gate latch, queued, medium, Ada]", "---"], 40));
    expect(table[0]).toMatch(/^Job\s+┊ Stage\s*$/);
    expect(table.at(-1)).toBe("+2 columns · widen to see");
  });
  test("narrow, a timeline's and a decision's side note goes under its row; nothing drawn is wider than the frame", () => {
    const tl = body(draw("timeline", ["- **Mar: potatoes** — after the frost, when the soil has dried"], 40));
    expect(tl[0]).toMatch(/^●  Mar  potatoes\s*$/);
    expect(tl[1]).toMatch(/^\s+after the frost/);
    const d = body(draw("decision", ["- **Raised beds** — the clay stays wet, so the roots rot"], 40));
    expect(d[0]).toMatch(/^● Raised beds\s*$/);
    expect(d[1]).toMatch(/^\s+— the clay stays wet/);
    const long = "a label far longer than any narrow column could hold, with 漢字 wide glyphs in it too";
    const cases: [string, string[]][] = [
      ["quadrant", ["---", "quadrants: [" + long + ", " + long + ", c, d]", "---", "- a: x, y", "- b: y, x", `- ${long}: x, x`]],
      ["matrix", ["- r: c=1 d=2000000", `- ${long}: a=1 b=2 c=3 d=4 e=5 f=6 g=7 h=8 i=9 j=10`]],
      ["compare", ["---", `columns: [${long}, B, C]`, "---", "- a: one | two", `- ${long}: ${long} | x`]],
      ["flow", ["- a → b: 2", `- ${long} → ${long}: 123456789012345678901`]],
      ["meter", ["---", "limit: 10", "unit: a unit with a long name", "---", "- a: 12", `- ${long}: 1234567890`]],
      ["stat", ["- a: 1", "- b: 2", "- c: 3", "- d: 4", "- e: 5", `- ${long}: ${long}`]],
      ["timeline", [`- 2026-03-02T10:00: ${long} — ${long}`]],
      ["decision", [`- **${long}** — ${long}`]],
      ["table", ["---", "headers: [a, b, c, d]", "rows:", `  - [${long}, ${long}, ${long}, ${long}]`, "---"]],
      ["quadrant", []], ["matrix", []], ["compare", []], ["flow", []],
    ];
    for (const w of [40, 80, 160]) for (const [kind, src] of cases) expect(within(renderGraph(kind, figureSource(src), w), w), `${kind} at ${w}`).toBe(true);
  });
  test("odd inputs are drawn, not thrown: a row named constructor, a zero flow, a negative meter, YAML of the wrong shape, kpi at its real width", () => {
    expect(body(draw("matrix", ["- constructor: c=1", "- __proto__: c=2"], 60))[4]).toMatch(/^\s+3\s*$/);
    const flow = body(draw("flow", ["- a → b: 0", "- a → c: 2"], 60));
    expect(flow[0]).toMatch(/^a\s+2 █+$/);
    expect(flow.find(l => l.includes("b"))).toMatch(/▶ b\s+0$/);
    // A negative value is drawn as nothing used, never a RangeError.
    expect(body(draw("meter", ["---", "limit: 10", "---", "- a: -1"], 60))[1]).toMatch(/^\s+10 left$/);
    expect(draw("meter", ["---", "limit: 0", "---", "- a: 1"], 60).join("\n")).toContain("a budget is a number above 0");
    for (const src of [["---", "entries: [{ label: cost, cells: free }]", "---"], ["---", "points: [null, 3]", "---"], ["---", "flows: [null]", "---"], ["---", "cells: { row: null, other: { c: 2 } }", "---"]]) {
      const kind = src[1]!.startsWith("entries") ? "compare" : src[1]!.startsWith("points") ? "quadrant" : src[1]!.startsWith("flows") ? "flow" : "matrix";
      expect(draw(kind, src, 60).join("\n")).not.toContain("couldn't draw");
    }
    // kpi is stat at the figure's width: two tiles fit on one row at 60.
    expect(body(draw("kpi", ["- a: 1", "- b: 2"], 60))).toHaveLength(2);
  });
});
