// The component library (PIE-618): a page per component schema, drawn by the readers' own renderer, every interaction
// an action (keys, the mouse, act). A scratch host with fictional notes: the outline's own heading style joins the
// values, a rule's variations are drawn as the service draws them, and `ep0ch library` writes the pages.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS, spaceSize } from "@ep0ch/outline-core/component-schema";
import { App } from "../src/app";
import { openScreen } from "../src/desk/screen-specs";
import { LIBRARY_ACTIONS, LibraryPane, PARTS, railGroups } from "../src/library/library";
import { SocketBoard, USER } from "../src/socket";
import { visible } from "../src/style";
import { Draft } from "../src/edit";
import { completerFor, completionKey } from "../src/surface/completer";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const COLS = 200, ROWS = 46;
const MAIN = join(import.meta.dir, "../src/main.ts");

test("a page is laid out from the schema alone: the table, each value with its source, the space a page at a time", () => {
  const desk: any = { ctx: { board: {} }, redraw() {} };
  const p = new LibraryPane();
  const text = () => p.render(COLS, 200, true, desk).lines.map(visible).join("\n");
  expect(text()).toContain("heading-pattern  on the declaring note  stack, waffle, uptime, dots, rule");
  expect(text()).toContain("│ ## Your calls [heading::band]");
  p.part = "property"; p.axis = 2;
  expect(p.render(COLS, 200, true, desk).lines.map(visible).filter(l => /╭─ heading-pattern: /.test(l))).toHaveLength(5);
  expect(text()).toContain("│ note · My style");
  expect(p.describe().variations.map(v => v.source)).toContain("My style [heading-style::mine] [heading-pattern::dots]\n\n## Your calls [heading::mine]");
  p.part = "space";
  expect(text()).toContain("2430 of 2430 match · 1–8 shown");
  // Every part is a digit, and every built-in component has a page.
  expect(PARTS.map(x => x.key)).toEqual(["1", "2", "3", "4"]);
  for (const s of BUILTIN_COMPONENT_SCHEMAS) { p.show(s.id); p.part = "overview"; expect(text()).toContain("╭─ source · y copies"); expect(text()).toContain(`${s.id} · ${s.group} · live: `); }
});

test("all widths: every variation drawn at 40, 80 and 160 one under another; w cycles through them", async () => {
  const desk: any = { ctx: { board: {} }, redraw() {} };
  const p = new LibraryPane({ component: "box", part: "property" });
  const text = () => p.render(COLS, 400, true, desk).lines.map(visible).join("\n");
  expect(text()).not.toContain("40 columns");
  const width = (args: object) => LIBRARY_ACTIONS.def("library.width")!.run(args as never, { pane: p } as never, {} as never);
  expect(width({ all: true })).toEqual({ width: "all" });
  expect(["40", "80", "160"].every(n => text().includes(`│ ${n} columns`))).toBe(true);
  expect(p.describe().width).toBe("all");
  expect(() => width({ cols: 40, all: true })).toThrow("give cols or all, not both");
  // From all, the next is 40 again; from 160, the next is all.
  expect(width({})).toEqual({ width: 40 });
  width({ cols: 160 });
  expect(width({})).toEqual({ width: "all" });
  // A width wider than the page is drawn at the widest that fits, and its frame says so.
  width({ cols: 160 });
  expect(p.render(120, 400, true, desk).lines.map(visible).join("\n")).toContain("at 89 (160 is wider than the page)");
});

test("a triple click on a source line beside its drawing copies that line only: no drawing, padding or frame (PIE-1515)", () => {
  const desk: any = { ctx: { board: {} }, redraw() {}, press: () => Promise.resolve() };
  const p = new LibraryPane({ component: "graph-annotate" });
  const lines = p.render(200, 60, true, desk).lines.map(visible);
  const y = lines.findIndex(l => l.includes("sqlite3") && l.includes("# (1)"));
  expect(y).toBeGreaterThan(0);
  const x = lines[y]!.lastIndexOf("sqlite3") + 2;
  for (let i = 0; i < 3; i++) { p.mouse({ kind: "mouse", action: "down", button: 0, x, y } as never, x, y, desk); p.mouse({ kind: "mouse", action: "up", button: 0, x, y } as never, x, y, desk); }
  expect(p.selectedText()).toBe(`sqlite3 "$db" ".backup '$stage'"  # (1)`);
  // A drag down the drawing stays in the drawing's frame.
  const d = lines.findIndex(l => l.includes("[1] sqlite3")), dx = lines[d]!.indexOf("[1] sqlite3");
  p.mouse({ kind: "mouse", action: "down", button: 0, x: dx, y: d } as never, dx, d, desk);
  p.mouse({ kind: "mouse", action: "drag", button: 0, x: dx + 60, y: d + 1 } as never, dx + 60, d + 1, desk);
  p.mouse({ kind: "mouse", action: "up", button: 0, x: dx + 60, y: d + 1 } as never, dx + 60, d + 1, desk);
  const dragged = p.selectedText();
  expect(dragged).toStartWith(`[1] sqlite3 "$db" ".backup '$stage'"`);
  expect(dragged).toContain(`[2] restic backup "$stage"`);
  // The figure's own ┊ is the drawing's; the library's frames (│) and the source beside it are not.
  expect(dragged).not.toContain("│");
  expect(dragged).not.toContain("::graph-annotate");
  expect(dragged).not.toContain("# (1)");
});

test("the rail beside the page, folded into the header when narrow: groups and counts from the schemas, ‹ › step", () => {
  const pressed: { name: string; args: unknown }[] = [];
  const desk: any = { ctx: { board: {} }, redraw() {}, press: (_p: unknown, _set: unknown, name: string, args: unknown) => { pressed.push({ name, args }); return Promise.resolve(); } };
  const p = new LibraryPane({ component: "graph-annotate" });
  const at = (w: number) => p.render(w, 60, true, desk).lines.map(visible);
  // Each group the schemas name, once, with how many it holds: nothing in the library lists them.
  const groups = railGroups(BUILTIN_COMPONENT_SCHEMAS);
  expect(groups.reduce((n, g) => n + g.count, 0)).toBe(BUILTIN_COMPONENT_SCHEMAS.length);
  expect(new Set(groups.map(g => g.name))).toEqual(new Set(BUILTIN_COMPONENT_SCHEMAS.map(s => s.group)));
  for (const w of [120, 200]) {
    const lines = at(w);
    expect(LibraryPane.railBeside(w)).toBe(true);
    expect(lines[0]).toStartWith(`${BUILTIN_COMPONENT_SCHEMAS.length} components · / filter`);
    expect(lines[0]).toContain("│graph-annotate · figures · live: no");
    for (const g of groups) expect(lines.some(l => l.startsWith(`▾ ${g.name} (${g.count})`))).toBe(true);
    // The parts and the widths are one row, the widths close after the parts (never at the far edge).
    const ctl = lines.find(l => l.includes("one property at a time"))!;
    expect(ctl).toMatch(/every combination {3}width 40/);
    expect(lines.some(l => l.includes("╭─ drawn · title: the snapshot"))).toBe(true);
  }
  // Drawn and source side by side at 200; at 120 the source goes under the drawing.
  expect(at(200).some(l => /╭─ drawn · title: the snapshot ─+╮ ╭─ source · y copies/.test(l))).toBe(true);
  expect(at(120).some(l => /╭─ drawn .*╭─ source/.test(l))).toBe(false);
  // The properties table: the default next to its values, the meaning beside them on the same row.
  expect(at(200).find(l => l.includes("width   fit, full"))).toMatch(/width {3}fit, full {2}fit {6}fit keeps the reading measure/);
  // At 44 the rail is in the header and the page reads alone.
  const narrow = at(44);
  expect(LibraryPane.railBeside(44)).toBe(false);
  expect(narrow[0]).toStartWith("‹ graph-annotate ›  figures · ");
  expect(narrow.some(l => l.includes("│"))).toBe(true);
  expect(narrow.every(l => !l.includes("components · / filter"))).toBe(true);
  expect(narrow.some(l => l.includes("╭─ at 40 (80 is wider than the page) · dra"))).toBe(true);
  const click = (x: number, y: number) => { p.mouse({ kind: "mouse", action: "down", button: 0, x, y } as never, x, y, desk); p.mouse({ kind: "mouse", action: "up", button: 0, x, y } as never, x, y, desk); };
  // Typing the rail's filter while it's folded: the header says what's typed and how many it leaves.
  p.listHost(desk).type(p.listHost(desk).lists()[0]!);
  for (const c of "quad") p.key({ kind: "char", ch: c }, desk);
  expect(at(44)[0]).toStartWith(`‹ graph-quadrant ›  / quad▌ · 1 of ${BUILTIN_COMPONENT_SCHEMAS.length}`);
  p.key({ kind: "esc" }, desk);
  expect(at(44)[0]).toStartWith("‹ graph-quadrant ›  figures · ");
  click(narrow[0]!.indexOf("›"), 0);
  click(0, 0);
  expect(pressed.slice(-2)).toEqual([{ name: "library.component", args: { by: 1 } }, { name: "library.component", args: { by: -1 } }]);
});

describe.skipIf(!outliner)("the library screen on a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, plot: any;
  let key: (k: Key) => void = () => {};
  const copied: string[] = [];
  const screen = () => (app as any).stack.at(-1) as any;
  const lines = () => screen().render(screen().ctx).lines.map(visible) as string[];
  const library = () => screen().describe().library;
  // The person's (through the screen's dispatcher, as their key or click), or an agent's through the control socket's `act`.
  const act = (action: string, args: Record<string, unknown> = {}, as?: string) => (as ? app.act({ action, args, as }) : screen().dispatch.act({ action, args }, USER));

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    plot = await board.request("create", { parentId: null, text: "Plot heading style [heading-style::plot] [heading-pattern::dots] [heading-align::left]", author: "user" });
    const term = { info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    (app as any).copy = (t: string) => { copied.push(typeof t === "string" ? t : ""); return true; };
    app.push(openScreen("library"));
  }, 30_000);

  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("the outline's own style is a value of [heading::], drawn with its source; the keys step through properties", async () => {
    await act("library.axis", { key: "heading" });
    await until(() => library().variations.some((v: any) => v.values.heading === "plot"), "the outline's own style", 8000);
    const n = library().variations.findIndex((v: any) => v.values.heading === "plot") + 1;
    await act("library.select", { n });
    await until(() => lines().some(l => l.includes("heading: plot · this outline's")), "it drawn, selected", 8000);
    const at = lines().findIndex(l => l.includes("heading: plot"));
    expect(lines().slice(at, at + 6).join("\n")).toContain("│ ## Your calls [heading::plot]");
    key(char("l"));
    await until(() => library().property === "rule", "the next property by l");
    key(char("1"));
    await until(() => library().part === "overview", "the overview by 1");
    expect(plot.id).toBeTruthy();
  });

  test("every combination by act, keys and mouse: pick values per axis, the matching variations drawn, a page at a time", async () => {
    const r: any = await act("library.pick", { axis: "heading-pattern", value: "waffle" });
    expect(r).toMatchObject({ on: true, matching: 486 });
    // ] moves the cursor down an axis (keeping its column: center under waffle), l and h along it, space picks.
    key(char("]")); key(char("l")); key(char("h")); key(char(" "));
    await until(() => library().filter?.["heading-align"]?.[0] === "center", "the cursor's value picked by keys");
    expect(library().matching).toBe(162);
    // A click on a chip picks it: heading-tone amber.
    const y = lines().findIndex(l => l.includes("heading-tone ")), x = lines()[y]!.indexOf(" amber ") + 2;
    key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => library().matching === 27, "amber picked by a click");
    expect(library().filter).toEqual({ "heading-pattern": ["waffle"], "heading-align": ["center"], "heading-tone": ["amber"] });
    expect(spaceSize(BUILTIN_COMPONENT_SCHEMAS[0]!, library().filter).matching).toBe(27);
    expect(lines().join("\n")).toContain("27 of 2430 match · 1–8 shown");
    key(char("n"));
    await until(() => library().page === 2, "the next page by n");
    expect(lines().join("\n")).toContain("27 of 2430 match · 9–16 shown");
    // Each variation drawn holds what was picked, its source underneath.
    for (const v of library().variations) expect(v.source).toContain("[heading-pattern::waffle]");
    key(char("x"));
    await until(() => library().matching === 2430, "x clears");
  });

  test("copy: the person's y goes to their clipboard; an agent's copy comes back as its answer and leaves the clipboard", async () => {
    await act("library.axis", { key: "heading-pattern" });
    key(char("J"));
    await until(() => library().selected === 2, "J selects the next variation");
    const before = copied.length;
    key(char("y"));
    await until(() => copied.length > before, "the person's copy");
    expect(copied.at(-1)).toBe("My style [heading-style::mine] [heading-pattern::waffle]\n\n## Your calls [heading::mine]");
    const r: any = await act("library.copy", { n: 4, part: "use" }, "test-agent");
    expect(r.source).toBe("## Your calls [heading::mine]");
    // The agent's copy left the person's clipboard and their selection as they were.
    expect(copied.length).toBe(before + 1);
    expect(library().selected).toBe(2);
    await expect(act("library.select", { n: 1.5 })).rejects.toThrow("n is a whole number, not 1.5");
  });

  test("a grid's cells side by side: a click on a cell's drawing selects it, and the selected cell comes into view", async () => {
    await act("library.width", { cols: 40 });
    await act("library.grid", { n: 1 });
    await until(() => lines().some(l => /heading-align: left .* heading-align: center .* heading-align: right/.test(l)), "three cells abreast", 5000);
    const y = lines().findIndex(l => l.includes("[heading-align::center]")), x = lines()[y]!.indexOf("[heading-align::center]");
    key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => library().selected === 2, "the middle cell selected by a click on its source");
    await act("library.select", { n: 15 });
    await until(() => lines().some(l => l.includes("╭─ heading-align: right")) && library().selected === 15, "the last cell scrolled into view", 5000);
    await act("library.width", { cols: 80 });
  });

  test("a rule's variations are drawn as the service draws them; an unknown component is refused with the list", async () => {
    await act("library.component", { name: "rule" });
    await act("library.axis", { key: "rule-decorate" });
    await until(() => lines().some(l => l.includes("D E C I S I O N S") || l.includes("DECISIONS")), "the band the service drew", 8000);
    await expect(act("library.component", { name: "nope" })).rejects.toThrow("no component nope; components: heading-style, callout, rule, route, view, graph-meter, graph-spark, graph-stat,");
  });

  test("an extension that ships a schema gets a page and completion, with no code of its own", async () => {
    const dir = join(scratch.workspace, "extensions", "moods");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "moods", version: 1, name: "Moods", components: [{
        id: "mood", group: "controls", title: "Mood", intro: "How a standup went.", where: "`[mood::…]` on a standup's note",
        props: [{ key: "mood", where: "line", type: "enum", meaning: "how it went", values: [{ value: "calm", meaning: "nothing on fire" }, { value: "stormy", meaning: "something is" }] }],
        source: { use: "Standup [mood::{{props.mood}}]" }, example: { mood: "calm" }, sweep: ["mood"], grids: [], space: ["mood"],
      }],
    }));
    // The host sees the folder and says so (an `extensions` event): the door asks for the components again.
    await board.request("extensions.list", { reload: true });
    await until(() => library().components.includes("mood"), "the extension's component listed", 8000);
    await act("library.component", { name: "mood" });
    await act("library.part", { part: "property" });
    expect(library().variations.map((v: any) => v.source)).toEqual(["Standup [mood::calm]", "Standup [mood::stormy]"]);
    expect(lines().join("\n")).toContain("mood: stormy · something is");
    // The same schema completes [mood:: in a draft.
    const d = new Draft("b1", 1, "Standup\n");
    d.row = 1; d.col = 0;
    const c = completerFor(d, board, () => {})!;
    for (const ch of "Today [mood::st") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the extension's values");
    expect(c.state!.items.map(i => i.insertion)).toEqual(["stormy]"]);
    expect(c.state!.items[0]!.docs).toBe("something is");
  });

  test("the rail: j k ↑ ↓ and ← → walk it and the page follows, / narrows it, a click picks; an agent's pick is its own", async () => {
    await act("library.component", { name: "heading-style" });
    await act("library.part", { part: "overview" });
    key(char("j"));
    await until(() => library().component === "callout", "j the next component");
    key({ kind: "down" }); key({ kind: "up" });
    await until(() => library().component === "callout", "↓ ↑ the same list");
    key({ kind: "right" });
    await until(() => library().group === "site", "→ the next group's first");
    key({ kind: "left" }); key({ kind: "left" });
    await until(() => library().component === "heading-style", "← back to layout's first");
    key(char("/"));
    for (const c of "annot") key(char(c));
    await until(() => library().component === "graph-annotate", "the page follows the filter as it's typed");
    key({ kind: "enter" });
    await until(() => library().rail.filter === "annot", "⏎ keeps it");
    expect(lines().join("\n")).toContain("1 of ");
    await act("list.filter", { words: "" });
    await until(() => library().rail.filter === undefined, "cleared");
    // The person's filter by action (the power bar's list.filter) moves the page as typing does, so y copies what's shown.
    await act("list.filter", { words: "quad" });
    await until(() => library().component === "graph-quadrant", "the page follows a filter set by action");
    await act("list.filter", { words: "" });
    // A click on a name in the rail shows it.
    const y = lines().findIndex(l => l.includes(" · graph-meter ")), x = lines()[y]!.indexOf("graph-meter");
    key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => library().component === "graph-meter", "the clicked component");
    // An agent's pick and filter are its own: the person's page stays, the rail says what the agent picked.
    const r: any = await act("list.pick", { id: "box" }, "test-agent");
    expect(r).toMatchObject({ text: "box", moved: false });
    expect(library().component).toBe("graph-meter");
    await until(() => lines().some(l => l.includes("test-agent: ◆ box")), "the agent's pick, in its tint");
    await expect(act("list.open", { id: "box" }, "test-agent")).rejects.toThrow("library.component name=box");
    const read: any = await act("list.blocks", {}, "test-agent");
    expect(JSON.stringify(read)).toContain("graph-annotate");
    await act("list.pick", { id: "graph-meter" }, "test-agent");
  });

  test("ep0ch library: the schemas as JSON, the outline's own values in them; --out writes a page each with drawings", async () => {
    const run = async (...args: string[]) => {
      const p = Bun.spawn(["bun", MAIN, "library", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...scratch.env } });
      const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
      return { code: await p.exited, out, err };
    };
    {
      const json = await run("heading-style", "--json");
      expect([json.code, json.err]).toEqual([0, ""]);
      const [schema] = JSON.parse(json.out);
      expect(schema.props[0].values.map((v: any) => v.value)).toContain("plot");
      const brief = await run("heading-style", "--brief");
      expect([brief.code, brief.err]).toEqual([0, ""]);
      expect(brief.out).toContain("## heading-style\n");
      expect(brief.out).toContain("- heading: band, tab, waffle, uptime, dots, rule, fade, plot — ");
      expect(brief.out).toContain("- heading-rows [on the declaring note]: 1 to 3 (default 3) — ");
      expect(brief.out).toContain("Example:\n```markdown\n");
      expect(brief.out).not.toContain("```text");
      // The extension's component (registered by the test above, nothing else changed) is in the brief and the JSON.
      const mood = await run("mood", "--brief");
      expect([mood.code, mood.err]).toEqual([0, ""]);
      expect(mood.out).toContain("## mood (ext:moods)\n");
      expect(JSON.parse((await run("--json")).out).map((c: any) => c.id)).toContain("mood");
      // The guide (PIE-721): the house lines and a line per component, the extension's marked, the outline named.
      const guide = await run("--guide");
      expect([guide.code, guide.err]).toEqual([0, ""]);
      expect(guide.out).toStartWith("# What an ep0ch outline can hold\n");
      expect(guide.out).toContain(`## Components (${BUILTIN_COMPONENT_SCHEMAS.length + 1} components, 1 from extensions; as `);
      expect(guide.out).toMatch(/\n- mood: [^\n]*\(ext:moods\)\n?/);
      expect(guide.out).toMatch(/\n- graph-tabs: [^\n]* · live\n/);
      const both = await run("--brief", "--json");
      expect(both.code).toBe(2);
      expect((await run("--guide", "--brief")).code).toBe(2);
      const dir = mkdtempSync(join(tmpdir(), "ep0ch-library-"));
      try {
        const wrote = await run("--out", dir);
        expect(wrote.out.trim()).toBe(`wrote ${BUILTIN_COMPONENT_SCHEMAS.length + 1} pages and README.md to ${dir}`);
        const page = readFileSync(join(dir, "heading-style.md"), "utf8");
        expect(page).toContain("#### heading-pattern: waffle\n\n```text\n");
        expect(page).toMatch(/```text\n[▓▒░ ·]+\n.*Your calls/);
        expect(readFileSync(join(dir, "rule.md"), "utf8")).toContain("D E C I S I O N S");
        expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("- [Callouts](callout.md)");
      } finally { rmSync(dir, { recursive: true, force: true }); }
      const bad = await run("--width", "70");
      expect([bad.code, bad.err.trim()]).toEqual([2, "ep0ch: --width is 40, 80, 160"]);
    }
  });
});
