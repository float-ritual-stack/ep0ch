// The shared primitive catalogue (kind 3 of the extension design) and its render targets, the handler
// line grammar every extension shares, and how Detail lays out an extension's output. Made-up data.
import { expect, test } from "bun:test";
import { renderComponent, validateComponent, validatePrimitive, type ComponentOutput } from "../src/component-primitives";
import { handlerCalls, type HandlerTable } from "../src/extension-handlers";
import type { ExtensionHandler, LoadedExtension } from "../src/extension-manifest";
import { resourceProjectionLayout } from "../src/detail-embeds";
import type { ResourceProjection } from "../src/resource-projection";
import { AttributedMarkdown } from "../src/attributed-markdown";
import { detailComponentMarkdown } from "../src/detail-rows";
import { generatedDocument, observeDocument, sourceDocument } from "../src/document-provenance";
import type { MarkdownTheme } from "@earendil-works/pi-tui";

const BOARD: ComponentOutput = validateComponent({
  data: [{ name: "Kettle", done: 3 }, { name: "Lamp, desk", done: 1 }],
  view: { type: "box", title: "Fixes", children: [
    { type: "stat", label: "Open", value: 2, tone: "warn" },
    { type: "table", columns: ["Item", "Done"], rows: [["Kettle", 3], ["Lamp, desk", 1]] },
    { type: "checklist", items: [{ label: "Kettle", done: true }, { label: "Lamp | desk", done: false }] },
    { type: "sparkline", label: "Week", values: [1, 3, 2, 5] },
  ] },
});

test("each target composes from the primitives; csv takes the first table; json is the data", () => {
  expect(renderComponent(BOARD, "terminal").body).toBe([
    "┌─ Fixes ",
    "│ Open  2",
    "│ Item        Done",
    "│ ──────────  ────",
    "│ Kettle      3",
    "│ Lamp, desk  1",
    "│ [x] Kettle",
    "│ [ ] Lamp | desk",
    "│ Week  ▁▅▃█",
    "└─",
  ].join("\n"));
  const markdown = renderComponent(BOARD, "markdown").body;
  expect(markdown).toContain("| Item | Done |");
  expect(markdown).toContain("- [ ] Lamp \\| desk");
  expect(renderComponent(BOARD, "csv")).toMatchObject({ via: "primitives", body: 'Item,Done\nKettle,3\n"Lamp, desk",1' });
  expect(JSON.parse(renderComponent(BOARD, "json").body)).toEqual(BOARD.data);
  expect(renderComponent(BOARD, "html").body).toContain("<table class=\"ext-table\">");
});

test("the fallback chain: the component's own rendering, then primitives, then what the requester names", () => {
  const own = { ...BOARD, targets: { html: "<b>mine</b>", blockdown: "status:: fine [x::y]" } };
  expect(renderComponent(own, "html")).toMatchObject({ via: "component", body: '<div class="ext-component"><b>mine</b></div>' });
  // BlockDown from an extension never adds properties to a note.
  expect(renderComponent(own, "blockdown").body).not.toMatch(/^status::|(?<!\\)\[x::y\]/m);
  const card = validateComponent({ data: { sign: "leo" }, view: { type: "card", title: "Leo" } });
  expect(renderComponent(card, "csv")).toMatchObject({ via: "fallback", contentType: "application/json" });
  expect(renderComponent(card, "csv", "markdown")).toMatchObject({ via: "fallback", body: "**Leo**" });
  expect(renderComponent(card, "html")).toMatchObject({ via: "primitives" });
});

test("views are checked against the catalogue with a path to what is wrong", () => {
  expect(() => validatePrimitive({ type: "chart" })).toThrow("view.type must be one of text, blockdown, badge, stat, bar, table, checklist, sparkline, card, box, stack, row");
  expect(() => validatePrimitive({ type: "row", minWidth: 2, children: [] })).toThrow("view.minWidth must be a whole number from 4 to 200");
  expect(() => validatePrimitive({ type: "box", children: [{ type: "bar", label: "x", value: 1, max: 0 }] })).toThrow("view.children[0].max must be more than 0");
  expect(() => validatePrimitive({ type: "table", columns: ["a"], rows: [["1", "2"]] })).toThrow("view.rows[0] must have 1 cells");
  expect(() => validatePrimitive({ type: "text", text: "hi", colour: "red" })).toThrow("has a field it doesn't know: colour");
  expect(() => validateComponent({ view: { type: "text", text: "no data" } })).toThrow("returns data");
  let deep: Record<string, unknown> = { type: "text", text: "bottom" };
  for (let level = 0; level < 10; level += 1) deep = { type: "stack", children: [deep] };
  expect(() => validatePrimitive(deep)).toThrow("nests deeper than 8");
});

test("a component's own HTML keeps to the page's markup: no script, style, handler or unsafe link reaches a page", () => {
  const own = (html: string) => renderComponent({ ...BOARD, targets: { html } }, "html").body;
  expect(own('<section class="mine" style="color:red" onclick="steal()"><h3>Title</h3><p>Words</p></section>'))
    .toBe('<div class="ext-component"><section class="mine"><h3>Title</h3><p>Words</p></section></div>');
  expect(own('a<script>alert(1)</script>b<style>body{display:none}</style>c<iframe src="x"></iframe>d')).toBe('<div class="ext-component">abcd</div>');
  expect(own('<a href="javascript:alert(1)">x</a><a href="&#106;avascript:alert(1)">y</a><a href="https://example.com/ok">z</a>'))
    .toBe('<div class="ext-component"><a>x</a><a>y</a><a href="https://example.com/ok" rel="noopener noreferrer">z</a></div>');
  // Unbalanced: an extension can't close the page's own markup around it, and an unknown tag keeps only its words.
  expect(own('</div></main><div><blink>hi</blink> & 1 < 2')).toBe('<div class="ext-component"><div>hi &amp; 1 &lt; 2</div></div>');
});

test("a blockdown primitive is the reader's to draw: its source in every text target, escaped in HTML; a row says its minWidth", () => {
  const view = validateComponent({ data: null, view: { type: "row", minWidth: 24, children: [
    { type: "box", title: "Left", children: [{ type: "blockdown", text: "## Plan\n- one <b>\n- [[A page]]" }] },
  ] } });
  expect(renderComponent(view, "markdown").body).toBe("**Left**\n\n## Plan\n- one <b>\n- [[A page]]");
  expect(renderComponent(view, "html").body).toBe('<div class="ext-component"><div class="ext-row" style="--ext-min:24ch"><section class="ext-box"><h4>Left</h4>' +
    '<div class="ext-blockdown">## Plan\n- one &lt;b&gt;\n- [[A page]]</div></section></div></div>');
});

function table(handlers: ExtensionHandler[]): HandlerTable {
  const extension = { id: "stars", name: "Stars", version: 1, manifest: { handlers } } as unknown as LoadedExtension;
  const bound = new Map(handlers.map((handler) => [handler.key, { extension, handler }]));
  return { handler: (key) => bound.get(key), handlerKeys: () => new Set(bound.keys()) };
}

test("handler lines: one grammar, typed options, display options left out of the call, problems and unknown flags named", () => {
  const stars = table([{
    key: "stars", kind: "output", effects: "read",
    argument: { name: "sign", required: true, pattern: "^[a-z]+$" },
    options: {
      days: { type: "integer", min: 1, max: 7, default: 1 },
      short: { type: "boolean", scope: "display" },
      mood: { type: "string", pattern: "^(calm|wild)$" },
    },
  }]);
  const [plain, short, wrong, missing] = handlerCalls([
    "stars:: leo",
    "- stars:: leo --short",
    "stars:: Leo --days=9 --mood=grim --colour",
    "stars::",
    "`stars:: in code`",
  ].join("\n"), stars);
  expect(plain).toMatchObject({ argument: "leo", options: { days: 1 }, display: {}, problems: [], line: 0 });
  expect(short).toMatchObject({ argument: "leo", display: { short: true }, line: 1 });
  expect(short!.callKey).toBe(plain!.callKey);
  expect(wrong!.problems).toEqual(["--days is at most 7", "--mood doesn't match ^(calm|wild)$", "Leo isn't a sign stars:: knows"]);
  expect(wrong!.unknown).toEqual(["--colour"]);
  expect(missing!.problems).toEqual(["stars:: needs sign"]);
  expect(handlerCalls("stars:: leo", table([]))).toEqual([]);
});

test("Detail draws an output's markdown under its line, with when it ran, and a handler that hasn't run with its reason", () => {
  const base: ResourceProjection = {
    anchor: { kind: "directive", line: 1, start: 0, end: 10 }, provider: "horoscope", label: "Horoscope", propertyKey: "horoscope",
    options: { unknown: [] }, status: "ready", key: "virgo", fields: [], kind: "output",
  };
  const ready = resourceProjectionLayout({ ...base, fetchedAt: "2026-10-01T09:00:00.000Z",
    output: { markdown: "**Virgo.** Say yes to soup.\n\n- Colour: teal", ranAt: "2026-10-01T09:00:00.000Z" } });
  expect(ready.lines[0]).toMatch(/^- Horoscope virgo · ran 2026-10-01 \d\d:00$/);
  expect(ready.lines.slice(1)).toEqual(["  **Virgo.** Say yes to soup.", "", "  - Colour: teal"]);
  expect(ready.fetchedLine).toBe(0);
  const waiting = resourceProjectionLayout({ ...base, status: "not-run", reason: "costs model time or money: it runs once when you write the line; r runs it" });
  expect(waiting.lines).toEqual(["- Horoscope virgo · not run yet", "  costs model time or money: it runs once when you write the line; r runs it"]);
});

test("Detail lays a row side by side when each child gets its minWidth, stacks it when not; an authored ep0ch-row fence is code", () => {
  const plain = (text: string) => text;
  const theme = Object.fromEntries(["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"]
    .map((key) => [key, plain])) as unknown as MarkdownTheme;
  const markdown = detailComponentMarkdown({ type: "row", minWidth: 24, children: [
    { type: "box", title: "Concept", children: [{ type: "blockdown", text: "## Idea\n- one\n- two" }] },
    { type: "box", title: "Build", children: [{ type: "blockdown", text: "Boxes in a row." }] },
  ] })!;
  const drawn = (width: number) => AttributedMarkdown.compile(generatedDocument(markdown, "component"), theme, false)!.render(width).map((line) => line.trimEnd());
  expect(drawn(80).filter(Boolean)).toEqual([
    // Each child 38 cells (80, less a 3-cell gap, halved), then the gap.
    `${"Concept".padEnd(41)}Build`,
    `${"Idea".padEnd(41)}Boxes in a row.`,
    "- one",
    "- two",
  ]);
  expect(drawn(40).filter(Boolean)).toEqual(["Concept", "Idea", "- one", "- two", "Build", "Boxes in a row."]);
  const authored = sourceDocument(observeDocument({ kind: "block", blockId: "00000000-0000-4000-8000-000000000001" }, markdown));
  expect(AttributedMarkdown.compile(authored, theme, false)!.render(80).map((line) => line.trim())).toContain("```ep0ch-row 24");
});
