// The schemas of the rest of what a note draws that isn't a `::graph-*` figure (PIE-701): the links components
// (`::links`, `::outlinks`, `::resources`, `::backlinks`), `::box`, the media line (a picture, a note's header image),
// embeds and references, code fences and tables. One schema each, so the library shows them and `ep0ch library --brief`
// tells an agent they exist. Their grammars are outline-core's (link-syntax.ts, media-line.ts, code-fence.ts,
// style-cascade.ts); the door's `LINK_BLOCK_KINDS` and the media line's attributes are what a test holds this list to
// (packages/door/test/component-coverage.test.ts). Pure: no I/O; types only from component-schema.ts.
import type { ComponentSchema, PropSchema, PropValue } from "./component-schema";

const enumOf = (meanings: Record<string, string>): PropValue[] => Object.entries(meanings).map(([value, meaning]) => ({ value, meaning }));

// ── the links components ──────────────────────────────────────────────────────

const LINK_GROUPS = ["links", "outlinks", "resources", "backlinks"] as const;
const GROUP_WORDS: Record<(typeof LINK_GROUPS)[number], { title: string; intro: string }> = {
  links: { title: "Links", intro: "Every link of a block in one list: what it links to (outlinks), the Resources it names and what links to it (backlinks), grouped, with a preview of each row on `⏎`." },
  outlinks: { title: "Outlinks", intro: "What a block links to: its references, page links and embeds, each with where it points." },
  resources: { title: "Resources", intro: "The Resources a block names (a file, a Jira ticket, a URL a plugin knows), whether each is registered and what is stored for it." },
  backlinks: { title: "Backlinks", intro: "What links to a block, grouped by kind, open items first." },
};

function linksComponent(name: (typeof LINK_GROUPS)[number]): ComponentSchema {
  const w = GROUP_WORDS[name];
  const props: PropSchema[] = [
    { key: "filter", where: "yaml", type: "text", meaning: "only the rows holding these words (the same matcher as search); words on the opening line or lines of their own do the same", samples: ["offer", "jira", "moth"] },
    { key: "title", where: "yaml", type: "text", meaning: "a title over the list", samples: ["What points here", "Related"] },
    { key: "of", where: "yaml", type: "ref", meaning: "whose links: a ((block)) or a block id (the note it is written in when left out)" },
    ...(name === "links" ? [{ key: "groups", where: "yaml" as const, type: "enum" as const, meaning: "narrow it to one group (the same as writing that group's name)", values: enumOf({ links: "every group", outlinks: "what it links to", resources: "the Resources it names", backlinks: "what links to it" }), default: "links" }] : []),
  ];
  return {
    id: name, title: `${w.title} (::${name})`,
    intro: `${w.intro}\n\nOne line, \`::${name} jira\`, filters by the words after the name; \`::${name} ((id))\` names whose; a block to its \`::\` takes \`of:\`, \`filter:\`, \`title:\`${name === "links" ? " and `groups:`" : ""} lines. The service answers the links and the reader lays them out, so the library has no outline to ask for the rows and draws the frame.`,
    where: `a \`::${name}\` line or block in a note; \`of:\`, \`filter:\` and \`title:\` lines inside a block`,
    props, source: { use: `::${name}\n---\n{yaml}\n---\n::` }, example: { title: w.title },
    sweep: ["filter", "title", ...(name === "links" ? ["groups"] : [])], grids: [], space: ["filter", "title"],
  };
}

// ── the box ───────────────────────────────────────────────────────────────────

const boxInt = (key: string, meaning: string, base: number, max: number): PropSchema => ({ key, where: "line", type: "int", token: `${key}={value}`, meaning, default: String(base), min: 0, max });

const BOX: ComponentSchema = {
  id: "box",
  title: "Box (::box)",
  intro: "A block of a note drawn with spacing and list looks of its own: the lines inside are laid out by the same reader with the box as the block level of the look, inset by its margin and padding. The attributes are the style tokens (`margin.x`, `pad.y`, `list.gap`…) written in braces on the opening line; the box closes with `::`. The look is drawn, never text: copying across it copies the lines.",
  where: "a `::box{…}` line, its attributes in braces, and the lines to the closing `::`",
  props: [
    boxInt("margin.x", "columns either side of the box's lines", 0, 12),
    boxInt("pad.x", "blank columns inside the box's frame", 0, 8),
    boxInt("margin.y", "blank rows above and below the box", 0, 4),
    boxInt("pad.y", "blank rows inside the box", 0, 4),
    boxInt("list.gap", "blank rows between a list's items", 0, 3),
    { key: "list.zebra", where: "line", type: "enum", token: "list.zebra={value}", meaning: "every other list item on a quiet tint", default: "false", values: enumOf({ false: "no tint", true: "every other item tinted" }) },
    { key: "list.divider", where: "line", type: "enum", token: "list.divider={value}", meaning: "a line between a list's items", default: "none", values: enumOf({ none: "no line", line: "a ruled line", dots: "a line of dots" }) },
  ],
  source: { use: "::box{margin.x={margin.x} pad.x={pad.x} margin.y={margin.y} pad.y={pad.y} list.gap={list.gap} list.zebra={list.zebra} list.divider={list.divider}}\n- Water the beds before nine\n- Cover the tomatoes\n- Check the traps\n::" },
  example: { "list.gap": "1" },
  sweep: ["margin.x", "pad.x", "margin.y", "pad.y", "list.gap", "list.zebra", "list.divider"],
  grids: [["list.gap", "list.divider"]],
  space: ["margin.x", "list.gap", "list.zebra", "list.divider"],
};

// ── pictures ──────────────────────────────────────────────────────────────────

const PIC = "[img::shots/moth.png]";
const line = (key: string, type: PropSchema["type"], meaning: string, extra: Partial<PropSchema> = {}): PropSchema => ({ key, where: "line", type, meaning, ...extra, use: `${PIC} [${key}::{${key}}]` });

const IMAGE: ComponentSchema = {
  id: "image",
  title: "Images (the media line)",
  intro: "A picture or video in a note: a line that is only `[img::path]` (or `[image::…]`, `[video::…]`, or `img:: path`) and its layout properties. It is content, never the note's metadata, so a picture right under a note's subject is drawn. The reader sizes and places it (`image.size`, `image.align`… rewrite the line); a terminal without graphics draws a placeholder. The path here is illustrative, so the library draws the placeholder a missing file gets.",
  where: "a line of a note: `[img::path]` and the `[size::…]`, `[align::…]`… beside it on the same line",
  props: [
    line("size", "text", "its width: columns, a percentage of the reader, or `full`", { samples: ["20", "40%", "full"] }),
    line("height", "int", "its height in rows", { min: 1, max: 40, samples: ["6", "12", "20"] }),
    line("align", "enum", "where it sits across the reader", { default: "left", values: enumOf({ left: "at the left", center: "in the middle", right: "at the right" }) }),
    line("alt", "text", "words for where the picture can't be drawn, and for a screen reader", { samples: ["a hawk moth at the buddleia"] }),
    line("dim", "number", "how far to darken it, 0 (none) to 1 (black); a bright picture is dimmed on its own when left out", { samples: ["0", "0.3", "0.6"] }),
  ],
  source: { use: PIC }, example: {}, sweep: ["size", "height", "align", "alt", "dim"], grids: [], space: ["size", "align"],
};

const HERO: ComponentSchema = {
  id: "hero-image",
  title: "Header image (layout hero)",
  intro: "A note's header: its picture with `[layout::hero]`, drawn above the title, behind the sticky header as the note scrolls (the first image of a note that has none marked, or one that is the note's first block). `[fit::cover]` crops it to fill, `contain` shows it whole, and `[hero-focus::x,y]` keeps a point of it in view.",
  where: "an image line with `[layout::hero]` in the note's first lines",
  props: [
    { key: "layout", where: "line", type: "enum", meaning: "marks the picture as the note's header", values: enumOf({ hero: "the note's header image" }), use: `${PIC} [layout::{layout}]` },
    { key: "fit", where: "line", type: "enum", meaning: "how it fills the header", default: "cover", values: enumOf({ cover: "crop it to fill the header", contain: "show it whole" }), use: `${PIC} [layout::hero] [fit::{fit}]` },
    { key: "hero-focus", where: "line", type: "text", meaning: "the point the crop and the backdrop keep in view: x,y as fractions or percents across and down (the middle when left out)", samples: ["0.5,0.5", "0.2,0.3", "80%,20%"], use: `${PIC} [layout::hero] [hero-focus::{hero-focus}]` },
    { key: "height", where: "line", type: "int", meaning: "the header's height in rows", min: 4, max: 40, samples: ["6", "10", "16"], use: `${PIC} [layout::hero] [height::{height}]` },
    { key: "dim", where: "line", type: "number", meaning: "how far to darken it, 0 (none) to 1 (black)", samples: ["0", "0.3", "0.6"], use: `${PIC} [layout::hero] [dim::{dim}]` },
  ],
  source: { use: `${PIC} [layout::hero]` }, example: {}, sweep: ["fit", "hero-focus", "height", "dim"], grids: [], space: ["fit", "hero-focus"],
};

// ── references, embeds, fences, tables ────────────────────────────────────────

const ID = "3f2a1c9e-0000-4000-8000-00000000a001";

const EMBED: ComponentSchema = {
  id: "embed",
  title: "Embeds and references",
  intro: "A note points at another by its id: `((id))` is a reference, `((id|label))` a labelled one, `!((id))` an embed that draws the block in place, `((id^anchor))` a line within it, and `[[Page name]]` a page by its name. The link grammar is outline-core's (link-syntax.ts); the service resolves, indexes and keeps the backlinks. The ids here are made up, so the library draws them as references that don't resolve.",
  where: "anywhere in a note's text; `!` before a reference embeds it",
  props: [{
    key: "form", where: "line", type: "enum", token: "{value}", meaning: "how the link is written",
    values: [
      { value: `((${ID}))`, meaning: "a reference to a block, drawn as its title" },
      { value: `((${ID}|the beds))`, meaning: "a labelled reference: your words, the block behind them" },
      { value: `!((${ID}))`, meaning: "an embed: the block drawn in place" },
      { value: `((${ID}^watering))`, meaning: "a reference to a line of a block, by its anchor (`^watering` at that line's end)" },
      { value: "[[Moth Garden]]", meaning: "a page, by its name" },
    ],
  }],
  source: { use: "See {form} for the plan." }, example: { form: `((${ID}|the beds))` }, sweep: ["form"], grids: [], space: ["form"],
};

const LANGS = ["ts", "sh", "json", "yaml", "sql", "diff", "md", "text"];
const FENCE: ComponentSchema = {
  id: "code-fence",
  title: "Code fences",
  intro: "Fenced code: three backticks (or more, when the code holds three) and a language, to a matching fence. It is literal: properties, references and components inside are the code's text, never read as the note's. The language names the colouring; one the reader doesn't know is drawn plain.",
  where: "a fenced block in a note; the language after the opening backticks",
  props: [{ key: "lang", where: "line", type: "enum", token: "```{value}", meaning: "the language after the opening fence", default: "text", values: LANGS.map(l => ({ value: l, meaning: l === "text" ? "plain, no colouring" : `${l} code` })) }],
  source: { use: "```{lang}\nmoths = 3  # [not::a property]\n```" }, example: { lang: "sh" }, sweep: ["lang"], grids: [], space: ["lang"],
};

const TABLE: ComponentSchema = {
  id: "table",
  title: "Tables",
  intro: "A table in Blockdown is Markdown's: a header row, a delimiter row, then rows, cells between `|`s. The colons in the delimiter row align a column. (A figure's `::graph-table` is the table that can be live and sorted.)",
  where: "lines of a note: a header row, a delimiter row of dashes, then the rows",
  props: [{ key: "align", where: "line", type: "enum", token: "| {value} |", meaning: "the delimiter cell of the second column: how its cells align", default: "---", values: enumOf({ "---": "the reader's default (left)", ":---": "left", "---:": "right", ":---:": "centred" }) }],
  source: { use: "| item | cost |\n| --- | {align} |\n| bolts | 12 |\n| boards | 140 |" }, example: { align: "---:" }, sweep: ["align"], grids: [], space: ["align"],
};

/** The links components, the box, pictures, references, fences and tables. */
export const BLOCK_COMPONENT_SCHEMAS: readonly ComponentSchema[] = [...LINK_GROUPS.map(linksComponent), BOX, IMAGE, HERO, EMBED, FENCE, TABLE];
