// The figure kinds from mdxcn.dev's ideas (src/figures/), their rows written in Markdown (outline-core's
// figure-markdown.ts), a quote's byline, and `ep0ch export`'s ASCII twin. Pure renders: no outline.
import { describe, expect, test } from "bun:test";
import { renderDoc } from "../src/doc";
import { figureAscii, figureSource, reframeAscii, renderGraph } from "../src/graphs";
import { figuresAsAscii } from "../src/export";
import { registryKeys } from "../src/figures/keys";
import { uptimeDays } from "../src/figures/days";
import { NOTE_ACTIONS } from "../src/surface/note";
import { runNote, took } from "../scripts/backup-runs";
import { invalidateLive, liveSettled, setLiveSource } from "../src/live";

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
  test("an unclosed figure keeps its last line", () => {
    const out = figuresAsAscii(["T", "::graph-rank", "- a: 1", "- b: 2"].join("\n"), "n");
    expect(out).toMatch(/b\s+\[=+/);
  });
  test("a note's figures become fences; code fences and the rest stay as written", () => {
    const text = ["Title", "before", "::graph-rank", "---", "title: r", "---", "- a: 1", "::", "```", "::graph-rank", "::", "```", "after"].join("\n");
    const out = figuresAsAscii(text, "n").split("\n");
    expect(out.slice(0, 3)).toEqual(["Title", "before", "```"]);
    expect(out[3]).toMatch(/^\+-+ \[ R \] -+\+$/);
    expect(out.slice(-6)).toEqual(["```", "```", "::graph-rank", "::", "```", "after"]);
    expect(out.filter(l => l === "::graph-rank").length).toBe(1);
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
  test("only the note's figure block takes them: not one in a part drawn on its own (a callout, a fragment)", async () => {
    setLiveSource(fake, () => {}); invalidateLive();
    const env = { width: 60, cellW: 9, cellH: 18, graphics: false, maxImageRows: 4, unfold: true, note: "note" };
    const fig = "::graph-timeline\n---\ntitle: rows\n---\n::";
    renderDoc(fig, env); await liveSettled();
    expect(renderDoc(fig, env).lines.map(plain).join("\n")).toContain("Apr  sow");
    expect(renderDoc(fig, { ...env, nested: true }).lines.map(plain).join("\n")).not.toContain("Apr  sow");
    expect(renderDoc(`intro\n${fig}`, env).lines.map(plain).join("\n")).not.toContain("Apr  sow");
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
    expect(date.stderr.toString()).toContain(`bun scripts/backup-runs.ts --ws pie --status ok --date ${new Date().getFullYear()}-`);
    const none = script("--ws", "pie");
    expect(none.stderr.toString()).toContain("bun scripts/backup-runs.ts --ws pie --status ok");
    expect(none.stderr.toString()).toContain("bun scripts/backup-runs.ts --ws pie -- ~/.local/bin/ep0ch-snapshot");
  });
  test("one note a run: its properties between ` - `, as a header line writes them", () => {
    expect(runNote({ source: "restic", status: "ok", date: "2026-10-03", took: took(252_000) })).toBe(
      "restic backup 2026-10-03 [type::backup-run] - [status::ok] - [date::2026-10-03] - [source::restic] - [took::4m 12s]",
    );
  });
});
