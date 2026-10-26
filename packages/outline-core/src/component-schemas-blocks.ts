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
  links: { title: "Links", intro: "Every link of a block in one list: what it links to (outlinks), the Resources it names, what links to it (backlinks) and the notes under it (children), grouped; or the blocks a query matches. The selected row can be previewed beside the list; `[ ]` steps the rows, `⏎` on one opens it, `⏎` on the frame's `⏎ in` goes in (j k move, esc comes out)." },
  outlinks: { title: "Outlinks", intro: "What a block links to: its references, page links and embeds, each with where it points." },
  resources: { title: "Resources", intro: "The Resources a block names (a file, a Jira ticket, a URL a plugin knows), whether each is registered and what is stored for it." },
  backlinks: { title: "Backlinks", intro: "What links to a block, grouped by kind, open items first." },
};

function linksComponent(name: (typeof LINK_GROUPS)[number]): ComponentSchema {
  const w = GROUP_WORDS[name];
  const props: PropSchema[] = [
    { key: "filter", where: "yaml", type: "text", meaning: "only the rows holding these words (the same matcher as search); words on the opening line or lines of their own do the same", samples: ["offer", "jira", "moth"] },
    { key: "lines", where: "yaml", type: "int", min: 0, meaning: "maximum lines per row; 0 truncates, otherwise wraps; overrides rows.lines", samples: ["0", "1", "2", "3"] },
    { key: "title", where: "yaml", type: "text", meaning: "a title over the list", samples: ["What points here", "Related"] },
    { key: "of", where: "yaml", type: "ref", meaning: "whose links: a ((block)) or a block id (the note it is written in when left out)" },
    ...(name === "links" ? [
      { key: "groups", where: "yaml" as const, type: "list" as const, meaning: "the groups it lists, comma-separated: outlinks, resources, backlinks, children (the notes under it), matches (the query's), or links for every group of the block", samples: ["links", "backlinks,children", "matches"] },
      { key: "query", where: "yaml" as const, type: "query" as const, complete: "query" as const, meaning: "list the blocks this query matches (the saved-view grammar, the service answers it) as a group of its own, `matches`; without `groups:` it is all the list shows", samples: ["type=outbox-item status=waiting", "type=errand stage=open"] },
      { key: "preview", where: "yaml" as const, type: "enum" as const, meaning: "the selected row drawn beside the list (or under it) when the frame has the width; the person's keys stay in the note until ⏎ on the frame goes in", values: enumOf({ right: "beside the list, when it's 70 columns or wider", below: "under the list", none: "no preview" }), default: "right with a query, else none" },
    ] : []),
  ];
  return {
    id: name, group: "links", title: `${w.title} (::${name})`,
    intro: `${w.intro}\n\nOne line, \`::${name} jira\`, filters by the words after the name; \`::${name} ((id))\` names whose; a block to its \`::\` takes \`of:\`, \`filter:\`, \`title:\`${name === "links" ? ", `groups:`, `query:` and `preview:` lines, or the same keys in braces on its first line (`::links{query=\"type=outbox-item status=waiting\" preview=right}`)" : ""} lines. The service answers the links and the reader lays them out, and the library draws the same list with its own demo data.`,
    where: `a \`::${name}\` line or block in a note; \`of:\`, \`filter:\` and \`title:\` lines inside a block`,
    props, source: { use: `::${name}\n---\n{{props.yaml}}\n---\n::` }, example: { title: w.title },
    sweep: ["filter", "title", ...(name === "links" ? ["groups", "preview"] : [])], grids: [], space: ["filter", "title"],
  };
}

// ── the box ───────────────────────────────────────────────────────────────────

const boxInt = (key: string, meaning: string, base: number, max: number): PropSchema => ({ key, where: "line", type: "int", token: `${key}={value}`, meaning, default: String(base), min: 0, max });

const BOX: ComponentSchema = {
  id: "box", group: "layout",
  title: "Box (::box)",
  intro: "A container for the note's own content: values read this note, bold and links render as outside, and components and figures can nest inside. The same reader lays out its body, inset by the box's margin and padding. The attributes are the style tokens (`margin.x`, `pad.y`, `list.gap`…) written in braces on the opening line; the box closes with `::`. The look is drawn, never text: copying across it copies the lines.",
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
  source: { use: "::box{margin.x={{props.margin.x}} pad.x={{props.pad.x}} margin.y={{props.margin.y}} pad.y={{props.pad.y}} list.gap={{props.list.gap}} list.zebra={{props.list.zebra}} list.divider={{props.list.divider}}}\n- Water the beds before nine\n- Cover the tomatoes\n- Check the traps\n::" },
  example: { "list.gap": "1" },
  sweep: ["margin.x", "pad.x", "margin.y", "pad.y", "list.gap", "list.zebra", "list.divider"],
  grids: [["list.gap", "list.divider"]],
  space: ["margin.x", "list.gap", "list.zebra", "list.divider"],
};

// ── pictures ──────────────────────────────────────────────────────────────────

const PIC = "[img::shots/moth.png]";
const line = (key: string, type: PropSchema["type"], meaning: string, extra: Partial<PropSchema> = {}): PropSchema => ({ key, where: "line", type, meaning, ...extra, use: `${PIC} [${key}::{{props.${key}}}]` });

const IMAGE: ComponentSchema = {
  id: "image", group: "media",
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
  id: "hero-image", group: "media",
  title: "Header image (layout hero)",
  intro: "A note's header: its picture with `[layout::hero]`, drawn above the title, behind the sticky header as the note scrolls (the first image of a note that has none marked, or one that is the note's first block). `[fit::cover]` crops it to fill, `contain` shows it whole, and `[hero-focus::x,y]` keeps a point of it in view.",
  where: "an image line with `[layout::hero]` in the note's first lines",
  props: [
    { key: "layout", where: "line", type: "enum", meaning: "marks the picture as the note's header", values: enumOf({ hero: "the note's header image" }), use: `${PIC} [layout::{{props.layout}}]` },
    { key: "blur", where: "line", type: "text", meaning: "0 to 24, sharp to strongly blurred", samples: ["4"], use: `${PIC} [layout::hero] [blur::{{props.blur}}]` },
    { key: "bleed", where: "line", type: "text", meaning: "full tile width inside the frame, or measure", samples: ["full"], use: `${PIC} [layout::hero] [bleed::{{props.bleed}}]` },
    { key: "tint", where: "line", type: "text", meaning: "0 to 1, duotone toward the tile tone", samples: ["0.5"], use: `${PIC} [layout::hero] [tint::{{props.tint}}]` },
    { key: "fade", where: "line", type: "text", meaning: "bottom share fading into the reader background", samples: ["0.75"], use: `${PIC} [layout::hero] [fade::{{props.fade}}]` },
    { key: "title", where: "line", type: "text", meaning: "below or over the picture, bottom-left", samples: ["over"], use: `${PIC} [layout::hero] [title::{{props.title}}]` },
    { key: "scroll", where: "line", type: "text", meaning: "scroll away or stay pinned", samples: ["pinned"], use: `${PIC} [layout::hero] [scroll::{{props.scroll}}]` },
    { key: "fit", where: "line", type: "enum", meaning: "how it fills the header", default: "cover", values: enumOf({ cover: "crop it to fill the header", contain: "show it whole" }), use: `${PIC} [layout::hero] [fit::{{props.fit}}]` },
    { key: "hero-focus", where: "line", type: "text", meaning: "the point the crop and the backdrop keep in view: x,y as fractions or percents across and down (the middle when left out)", samples: ["0.5,0.5", "0.2,0.3", "80%,20%"], use: `${PIC} [layout::hero] [hero-focus::{{props.hero-focus}}]` },
    { key: "height", where: "line", type: "int", meaning: "rows or a share such as 33%, capped at half the tile", min: 1, max: 999, samples: ["6", "10", "16"], use: `${PIC} [layout::hero] [height::{{props.height}}]` },
    { key: "dim", where: "line", type: "number", meaning: "how far to darken it, 0 (none) to 1 (black)", samples: ["0", "0.3", "0.6"], use: `${PIC} [layout::hero] [dim::{{props.dim}}]` },
  ],
  source: { use: `${PIC} [layout::hero]` }, example: {}, sweep: ["fit", "hero-focus", "height", "dim"], grids: [], space: ["fit", "hero-focus"],
};

/** The values `[header::…]` takes, the reader's header rows each leaves out (the door's NoteSurface.headerBlock reads them). */
export const HEADER_VALUES = { none: "no header: the body starts on the first row", crumbs: "no crumbs above the title", title: "no title (and subtitle): the crumbs and the byline stay" } as const;

const HEADER: ComponentSchema = {
  id: "header", group: "layout",
  title: "Reader header (header)",
  intro: "The rows a reader draws above a note: the crumbs, the title and the byline (author, date, properties, `[sources]`, `[comment]`). A note that is a composition (a dashboard, a contents page, a brief) can leave them out with `[header::none]` on its first line, in every reader, a river column and the drawer; `crumbs` or `title` leave out only those rows, and `crumbs, title` both. The tile's border still names the note, and the tile menu (⋯) still has the comment, comments, properties and sources rows.",
  where: "the note's first line: `[header::none]`",
  props: [
    { key: "header", where: "line", type: "enum", meaning: "which of the reader's header rows the note leaves out, on its first line (`crumbs, title` leaves out both)", values: enumOf(HEADER_VALUES) },
  ],
  source: { use: "Plot at a glance [header::{{props.header}}]\n\n::graph-stat\n---\nitems: [{ value: \"12\", label: beds }, { value: \"3\", label: sown this week }]\n---\n::" },
  example: { header: "none" }, sweep: ["header"], grids: [], space: ["header"],
};

const ART = "[artifact::artifacts/pulse-pad.jsx]";
const ARTIFACT: ComponentSchema = {
  id: "artifact", group: "media",
  title: "Artifacts (claude.ai's, in a note)",
  intro: "A runnable file in a note: write `[artifact::/path/to/lantern.jsx]`, `[artifact::artifacts/lantern.jsx]` (relative to the outline folder), or `[artifact::~/sketches/lantern.html]`. The host reads .jsx, .tsx, .html, .svg and .mermaid files into the artifact store, naming them from the file stem. Changed content gets a new snapshot on the next read. A deleted file keeps its last snapshot; the card says when it went missing. The note's text stays as written. Stored names (`[artifact::lantern]`) and pinned versions (`[artifact::lantern@1]`) also work. Web pages run it inline; the door's card opens the same stored page (`artifact.open`). The example path is illustrative, so the library shows the missing-file card.",
  where: "a line of a note: `[artifact::path]`, `[artifact::name]` or `[artifact::name@1]`, with height, size, align and alt on the same line",
  props: [
    { key: "height", where: "line", type: "int", meaning: "its frame's height on the web page, in rows", min: 1, max: 80, samples: ["16", "24", "40"], use: `${ART} [height::{{props.height}}]` },
    { key: "size", where: "line", type: "text", meaning: "its frame's width: columns, a percentage of the page, or `full`", samples: ["60%", "full"], use: `${ART} [size::{{props.size}}]` },
    { key: "align", where: "line", type: "enum", meaning: "where its frame sits across the page", default: "left", values: enumOf({ left: "at the left", center: "in the middle", right: "at the right" }), use: `${ART} [align::{{props.align}}]` },
    { key: "alt", where: "line", type: "text", meaning: "its title, over an HTML file's own <title> and its file's name", samples: ["Pulse pad"], use: `${ART} [alt::{{props.alt}}]` },
  ],
  source: { use: ART }, example: {}, sweep: ["height", "alt"], grids: [], space: ["height"],
};

// ── references, embeds, fences, tables ────────────────────────────────────────

const ID = "3f2a1c9e-0000-4000-8000-00000000a001";

const EMBED: ComponentSchema = {
  id: "embed", group: "links",
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
  source: { use: "See {{props.form}} for the plan." }, example: { form: `((${ID}|the beds))` }, sweep: ["form"], grids: [], space: ["form"],
};

const LANGS = ["ts", "sh", "json", "yaml", "sql", "diff", "md", "text"];
const FENCE: ComponentSchema = {
  id: "code-fence", group: "layout",
  title: "Code fences",
  intro: "Fenced code: three backticks (or more, when the code holds three) and a language, to a matching fence. It is literal: properties, references and components inside are the code's text, never read as the note's. The language names the colouring; one the reader doesn't know is drawn plain.",
  where: "a fenced block in a note; the language after the opening backticks",
  props: [{ key: "lang", where: "line", type: "enum", token: "```{value}", meaning: "the language after the opening fence", default: "text", values: LANGS.map(l => ({ value: l, meaning: l === "text" ? "plain, no colouring" : `${l} code` })) }],
  source: { use: "```{{props.lang}}\nmoths = 3  # [not::a property]\n```" }, example: { lang: "sh" }, sweep: ["lang"], grids: [], space: ["lang"],
};

const TABLE: ComponentSchema = {
  id: "table", group: "layout",
  title: "Tables",
  intro: "A table in Blockdown is Markdown's: a header row, a delimiter row, then rows, cells between `|`s. The colons in the delimiter row align a column. (A figure's `::graph-table` is the table that can be live and sorted.)",
  where: "lines of a note: a header row, a delimiter row of dashes, then the rows",
  props: [{ key: "align", where: "line", type: "enum", token: "| {value} |", meaning: "the delimiter cell of the second column: how its cells align", default: "---", values: enumOf({ "---": "the reader's default (left)", ":---": "left", "---:": "right", ":---:": "centred" }) }],
  source: { use: "| item | cost |\n| --- | {{props.align}} |\n| bolts | 12 |\n| boards | 140 |" }, example: { align: "---:" }, sweep: ["align"], grids: [], space: ["align"],
};

// ── the components that read their note (S3) ──────────────────────────────────

const FIELDS: ComponentSchema = {
  id: "fields", group: "site",
  title: "Fields (::fields)",
  intro: "Every place a note writes a key, listed: one row per occurrence of `connectTo` (a `[connectTo::…]` chip in a line, a `connectTo:: …` line), each row opening its own line with the line lit, found again by the text it was written as, so it still works after edits above it. A row appears as soon as a line is saved. A row's `¶` anchors its line (`fields.anchor`), so `((note^anchor))` links to it for good; drawing the component never writes. The service answers it (`site.answer`) and every reader draws the answer.",
  where: "a `::fields{key=connectTo}` line in a note, alone or closed by `::`",
  props: [
    { key: "key", where: "yaml", type: "property", meaning: "the property to list, case-insensitive (`connectTo`, `storyTime`)", samples: ["connectTo", "storyTime", "decision"] },
    { key: "of", where: "yaml", type: "ref", meaning: "whose fields: a ((block)) or a block id (the note it is written in when left out)" },
    { key: "title", where: "yaml", type: "text", meaning: "a title over the list (the key when left out)", samples: ["Connections", "Said so far"] },
  ],
  source: { use: "::fields{key={{props.key}}}" }, example: { key: "connectTo" },
  sweep: ["key"], grids: [], space: ["key"],
};

const IF: ComponentSchema = {
  id: "if", group: "site",
  title: "Only when (::if)",
  intro: "Its lines are drawn only while the note it sits in matches a query (the saved views' grammar: `status=active`, `owner={{this.owner}}`, `NOT type=template`). Otherwise they are not drawn at all. `{{ }}` operands in the query are bound from the note, never pasted into it. A query the service can't read hides the body and says why. Like every component, it closes with `::`, so its body holds Blockdown but no other component.",
  where: "a `::if{where=\"status=active\"}` line, the lines to show, and a closing `::`",
  props: [{ key: "where", where: "yaml", type: "query", complete: "query", meaning: "the query the note must match to draw the body", samples: ["status=active", "owner={{this.owner}}", "NOT type=template"] }],
  source: { use: "::if{where=\"{{props.where}}\"}\nShown only while the note matches.\n::" }, example: { where: "status=active" },
  sweep: ["where"], grids: [], space: ["where"],
};

/** The links components, the box, pictures, references, fences and tables, and the two that read their note's Site. */
export const BLOCK_COMPONENT_SCHEMAS: readonly ComponentSchema[] = [...LINK_GROUPS.map(linksComponent), BOX, IMAGE, HERO, HEADER, ARTIFACT, EMBED, FENCE, TABLE, FIELDS, IF];
