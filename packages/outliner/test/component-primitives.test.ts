// The shared primitive catalogue (kind 3 of the extension design) and its render targets, the handler
// line grammar every extension shares, and how Detail lays out an extension's output. Made-up data.
import { expect, test } from "bun:test";
import { renderComponent, validateComponent, validatePrimitive, type ComponentOutput } from "../src/component-primitives";
import { readImages } from "../src/publish-components";
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
  expect(() => validatePrimitive({ type: "chart" })).toThrow("view.type must be one of text, blockdown, badge, stat, bar, table, checklist, sparkline, card, box, stack, row, band, track, image, button, list");
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

test("an image primitive (PIE-827): a file the outline names, said as its words and file where it can't be drawn, a numbered place on a page", () => {
  const view = validateComponent({ data: null, view: { type: "card", title: "Beetroot", children: [
    { type: "image", src: "/plot/pics/seed packet.webp", alt: "a packet of <seed>", size: "50%", fit: "cover", height: 6 },
    { type: "image", src: "file:/plot/pics/dusk.jpg" },
  ] } });
  expect(renderComponent(view, "terminal").body).toBe("▌ Beetroot\n  [image: a packet of <seed>] /plot/pics/seed packet.webp\n  [image] /plot/pics/dusk.jpg");
  // Markdown names the file, never its folders, and never asks a reader to fetch a path it can't reach.
  expect(renderComponent(view, "markdown").body).toBe("**Beetroot**\n\n*image: a packet of \\<seed\\>* `seed packet.webp`\n\n*image* `dusk.jpg`");
  const html = renderComponent(view, "html").body;
  expect(html).toContain('<figure class="media media-missing ext-image" data-ext-image="0"><span class="media-what">image</span> a packet of &lt;seed&gt; <code>seed packet.webp</code></figure>');
  expect(html).toContain('data-ext-image="1"');
  expect(html).not.toContain("/plot/pics");
  // The publisher puts each in its place by its number, an alt text over two lines too.
  const twoLines = renderComponent(validateComponent({ data: null, view: { type: "stack", children: [{ type: "image", src: "a.png", alt: "one\ntwo" }, { type: "image", src: "b.png" }] } }), "html").body;
  expect(readImages(twoLines, (n) => `<img data-n="${n}">`)).toBe('<div class="ext-component"><div class="ext-stack"><img data-n="0"><img data-n="1"></div></div>');
  expect(() => validatePrimitive({ type: "image", src: "web:https://example.com/a.png" })).toThrow("view.src must be a file's path or a file: Resource ref");
  expect(() => validatePrimitive({ type: "image", src: "a.png", size: "huge" })).toThrow("view.size must be a size as [size::] writes it");
  expect(() => validatePrimitive({ type: "image", src: "a.png", height: 0 })).toThrow("view.height must be a whole number of rows from 1 to 60");
  expect(() => validatePrimitive({ type: "image", src: "a.png", fit: "stretch" })).toThrow("view.fit must be cover or contain");
  // A cover drawn alone (PIE-839): caption: false is kept for the reader; anything but true or false is refused.
  expect(validatePrimitive({ type: "image", src: "a.png", caption: false })).toEqual({ type: "image", src: "a.png", caption: false });
  expect(() => validatePrimitive({ type: "image", src: "a.png", caption: "no" })).toThrow("view.caption must be true or false");
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
  // Options read quotes as a shell's words do; an apostrophe in the argument is the person's own text, never an opening quote.
  const [quoted] = handlerCalls(`stars:: Bob's --mood="wild"`, stars);
  expect(quoted).toMatchObject({ argument: "Bob's", options: { mood: "wild" }, unknown: [] });
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
  // A row in a row: the inner one's breaks stay inside its own fence.
  const nested = detailComponentMarkdown({ type: "row", minWidth: 8, children: [
    { type: "row", minWidth: 8, children: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
    { type: "text", text: "c" },
  ] })!;
  const row = AttributedMarkdown.compile(generatedDocument(nested, "component"), theme, false)!.render(80).map((line) => line.trimEnd()).filter(Boolean);
  expect(row).toEqual([`${`${"a".padEnd(20)}b`.padEnd(41)}c`]);
  const authored = sourceDocument(observeDocument({ kind: "block", blockId: "00000000-0000-4000-8000-000000000001" }, markdown));
  expect(AttributedMarkdown.compile(authored, theme, false)!.render(80).map((line) => line.trim())).toContain("```ep0ch-row 24");
});

test("a button, or a badge, text, card or table row, can carry an action line to press; every other target ignores it (PIE-957, PIE-981)", () => {
  const act = "ttt-move at=5";
  const view = validatePrimitive({ type: "stack", children: [
    { type: "button", label: "Play", act: "layout.load name=review", tone: "accent" },
    { type: "badge", label: "5", act },
    { type: "text", text: "Play", act: "ext.script:ttt-move.run at=5" },
    { type: "card", title: "Square", act },
    { type: "table", columns: ["Square"], rows: [["1"], ["2"]], acts: [act, null] },
  ] });
  expect(JSON.stringify(view)).toContain('"act":"ttt-move at=5"');
  for (const target of ["html", "markdown", "terminal"] as const) {
    const body = renderComponent({ data: null, view } as ComponentOutput, target).body;
    expect(body).toContain("Play");
    expect(body).not.toContain("ttt-move");
    expect(body).not.toContain("layout.load");
  }
  expect(renderComponent({ data: null, view } as ComponentOutput, "html").body).not.toContain("<button");
  // Refused with a path: a link and an action on one card, a line that is no action line, one that names another actor.
  expect(() => validatePrimitive({ type: "card", title: "x", link: "file:/a.md", act })).toThrow("view.act");
  expect(() => validatePrimitive({ type: "badge", label: "x", act: "rm -rf /" })).toThrow("view.act");
  expect(() => validatePrimitive({ type: "badge", label: "x", act: "go as=someone" })).toThrow("as=");
  expect(() => validatePrimitive({ type: "button", label: "x" })).toThrow("view.act");
  expect(() => validatePrimitive({ type: "table", columns: ["a"], rows: [["1"]], acts: [] })).toThrow("view.acts");
});

// ── the list primitive (PIE-747, ADR 0004 contract 3) ──────────────────────────────────────────────────

const GARDEN = {
  type: "list", preview: "right", empty: "no seeds yet",
  groups: [{ name: "sow", label: "Sow now", glyph: "☀", count: 2, note: "frost-free" }, { name: "later", label: "Later", count: 1 }],
  rows: [
    { id: "pea", label: "Pea trellis", detail: "next", mark: "●", tone: "good", group: "sow", do: { open: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" }, preview: { markdown: "Order 40 packets of sugar snap." } },
    { id: "bean", label: "Bean *poles*", group: "sow", do: { copy: "bean poles" } },
    { id: "hdr", label: "Needs a spade", group: "later" },
    { id: "ins", label: "Spade", detail: "shed", group: "later", do: { insert: "[[Shed]]" } },
  ],
};

test("a list validates its rows, one activation each, and says what is wrong where", () => {
  const view = validatePrimitive(GARDEN);
  expect(view).toMatchObject({ type: "list", preview: "right", rows: [{ id: "pea", do: { open: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" } }, { id: "bean" }, { id: "hdr" }, { id: "ins" }] });
  expect((view as { rows: { do?: unknown }[] }).rows[2]!.do).toBeUndefined();
  const bad = (patch: object, rowAt = 0) => () => validatePrimitive({ ...GARDEN, rows: GARDEN.rows.map((r, i) => (i === rowAt ? { ...r, ...patch } : r)) });
  expect(bad({ do: { open: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", copy: "x" } })).toThrow("view.rows[0].do must do exactly one thing, not 2");
  expect(bad({ do: {} })).toThrow("must do exactly one thing, none given");
  expect(bad({ do: { open: "not a block" } })).toThrow("view.rows[0].do.open must be a block id or a Resource ref");
  expect(bad({ do: { insert: "two\nlines" } })).toThrow("view.rows[0].do.insert must be one line");
  expect(bad({ do: { run: { action: "ttt-move", args: { as: "x" } } } })).toThrow("a press runs as the person");
  expect(bad({ id: "bean" })).toThrow("repeats bean");
  expect(bad({ label: "two\nlines" })).toThrow("view.rows[0].label must be one line");
  expect(bad({ preview: { block: "x", markdown: "y" } })).toThrow("must be exactly one of { block } or { markdown }");
  expect(bad({ colour: "red" })).toThrow("has a field it doesn't know: colour");
  expect(() => validatePrimitive({ type: "list", rows: Array.from({ length: 201 }, (_, i) => ({ id: String(i), label: "x" })) })).toThrow("at most 200 rows");
  expect(() => validatePrimitive({ ...GARDEN, preview: "above" })).toThrow("must be one of right, below, none");
});

test("a list draws as text, Markdown, a page's <ul> and CSV: its groups, its rows, the first preview", () => {
  const output = validateComponent({ data: [], view: GARDEN });
  expect(renderComponent(output, "terminal").body).toBe([
    "▾ ☀ Sow now (2) · frost-free",
    "  ● Pea trellis · next",
    "  · Bean *poles*",
    "▾ Later (1)",
    "  ■ Needs a spade",
    "  · Spade · shed",
  ].join("\n"));
  const markdown = renderComponent(output, "markdown").body;
  expect(markdown).toContain("**☀ Sow now (2)** · frost-free");
  expect(markdown).toContain("- ● Pea trellis — next")
  expect(markdown).toContain("- Bean \\*poles\\*");
  expect(markdown).toContain("- **Needs a spade**");
  expect(markdown).toContain("> Order 40 packets of sugar snap.");
  const html = renderComponent(output, "html").body;
  expect(html).toContain('<ul><li class="ext-row-item ext-good"><span class="ext-mark">●</span> Pea trellis <span class="ext-label">next</span></li>');
  expect(html).toContain('<li class="ext-row-head"><strong>Needs a spade</strong></li>');
  expect(html).toContain('ext-list-preview">Order 40 packets of sugar snap.');
  expect(html).not.toContain("<a ");
  expect(renderComponent(output, "csv").body).toBe("label,detail\nPea trellis,next\nBean *poles*,\nNeeds a spade,\nSpade,shed");
  expect(renderComponent(validateComponent({ data: [], view: { type: "list", rows: [], empty: "no seeds yet" } }), "terminal").body).toBe("no seeds yet");
});
