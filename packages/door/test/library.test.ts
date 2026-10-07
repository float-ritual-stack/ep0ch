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
import { LibraryPane, PARTS } from "../src/library/library";
import { SocketBoard, USER } from "../src/socket";
import { visible } from "../src/style";
import { Draft } from "../src/edit";
import { completerFor, completionKey } from "../src/surface/completer";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const COLS = 150, ROWS = 46;
const MAIN = join(import.meta.dir, "../src/main.ts");

test("a page is laid out from the schema alone: the table, each value with its source, the space a page at a time", () => {
  const desk: any = { ctx: { board: {} }, redraw() {} };
  const p = new LibraryPane();
  const text = () => p.render(COLS, 200, true, desk).lines.map(visible).join("\n");
  expect(text()).toContain("heading-pattern  on the declaring note   stack, waffle, uptime, dots, rule");
  expect(text()).toContain("┆ ## Your calls [heading::band]");
  p.part = "property"; p.axis = 2;
  expect(p.render(COLS, 200, true, desk).lines.map(visible).filter(l => /^. heading-pattern: /.test(l))).toHaveLength(5);
  expect(text()).toContain("┆ note · My style [heading-style::mine] [heading-pattern::dots]");
  p.part = "space";
  expect(text()).toContain("2430 of 2430 match · 1–8 shown");
  // Every part is a digit, and every built-in component has a page.
  expect(PARTS.map(x => x.key)).toEqual(["1", "2", "3", "4"]);
  for (const s of BUILTIN_COMPONENT_SCHEMAS) { p.component = s.id; p.part = "overview"; expect(text()).toContain("Minimal example"); }
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
    plot = await board.request<any>("create", { parentId: null, text: "Plot heading style [heading-style::plot] [heading-pattern::dots] [heading-align::left]", author: "user" });
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
    expect(lines().slice(at + 1, at + 6).join("\n")).toContain("┆ ## Your calls [heading::plot]");
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
    key(char("j"));
    await until(() => library().selected === 2, "j selects the next variation");
    const before = copied.length;
    key(char("y"));
    await until(() => copied.length > before, "the person's copy");
    expect(copied.at(-1)).toBe("My style [heading-style::mine] [heading-pattern::waffle]\n\n## Your calls [heading::mine]");
    const r: any = await act("library.copy", { n: 4, part: "use" }, "test-agent");
    expect(r.source).toBe("## Your calls [heading::mine]");
    expect(copied.length).toBe(before + 1);
    await act("library.width", { cols: 160 });
    await until(() => lines().some(l => l.includes("drawn at 160 columns, cut at")), "a width wider than the tile, said");
    await act("library.width", { cols: 80 });
  });

  test("a rule's variations are drawn as the service draws them; an unknown component is refused with the list", async () => {
    await act("library.component", { name: "rule" });
    await act("library.axis", { key: "rule-decorate" });
    await until(() => lines().some(l => l.includes("D E C I S I O N S") || l.includes("DECISIONS")), "the band the service drew", 8000);
    await expect(act("library.component", { name: "nope" })).rejects.toThrow("no component nope; components: heading-style, callout, rule, graph-meter, graph-spark");
  });

  test("an extension that ships a schema gets a page and completion, with no code of its own", async () => {
    const dir = join(scratch.workspace, "extensions", "moods");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "moods", version: 1, name: "Moods", components: [{
        id: "mood", title: "Mood", intro: "How a standup went.", where: "`[mood::…]` on a standup's note",
        props: [{ key: "mood", where: "line", type: "enum", meaning: "how it went", values: [{ value: "calm", meaning: "nothing on fire" }, { value: "stormy", meaning: "something is" }] }],
        source: { use: "Standup [mood::{mood}]" }, example: { mood: "calm" }, sweep: ["mood"], grids: [], space: ["mood"],
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
    expect(c.state!.items[0]!.context).toBe("something is");
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
      const dir = mkdtempSync(join(tmpdir(), "ep0ch-library-"));
      try {
        const wrote = await run("--out", dir);
        expect(wrote.out.trim()).toBe(`wrote 6 pages and README.md to ${dir}`);
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
