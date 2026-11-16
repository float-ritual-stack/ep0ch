# How each component fares in the native window

<!-- Written by `cargo test` (src/tests/parts.rs, the coverage table); never edited by hand. -->

Every built-in component's own example (its schema's, as `outline-core/fixtures/component-pages.json` holds the
page the service answers of it) drawn on a headless window. **draws**: every part is primitives this window builds.
**partly**: something of it is its lines as written, the service's Markdown, or Blockdown left as words. **problem**:
the service says what is wrong, or a part drew nothing. **empty**: the service answers no part for the example.
**panicked**: building it panicked (a test failure).

Of 43 components: 31 draws, 10 partly, 1 problem, 1 empty, 0 panicked.

| Component | Group | Fared | Its parts, as written → drawn | Why |
|---|---|---|---|---|
| `heading-style` | layout | **draws** | prose → markdown |  |
| `callout` | layout | **draws** | prose → markdown |  |
| `rule` | layout | **partly** | prose → markdown | Blockdown's own forms in its prose (a property, a value, a component) stay as written |
| `note-mover` | site | **partly** | prose → markdown | Blockdown's own forms in its prose (a property, a value, a component) stay as written |
| `view` | site | **draws** | view → list |  |
| `graph-meter` | figures | **draws** | figure → bar |  |
| `graph-spark` | figures | **draws** | figure → sparkline |  |
| `graph-stat` | figures | **draws** | figure → row, stat |  |
| `graph-rank` | figures | **draws** | figure → stack, bar |  |
| `graph-tree` | figures | **draws** | figure → stack, text |  |
| `graph-check` | figures | **draws** | figure → checklist |  |
| `graph-timeline` | figures | **draws** | figure → table |  |
| `graph-table` | figures | **draws** | figure → table |  |
| `graph-tabs` | figures | **partly** | figure → markdown | a figure as the service's Markdown for it |
| `graph-decision` | figures | **draws** | figure → stack, table, text |  |
| `graph-chat` | figures | **draws** | figure → table |  |
| `graph-keys` | figures | **draws** | figure → table |  |
| `graph-props` | figures | **draws** | figure → table |  |
| `graph-example` | figures | **draws** | figure → table |  |
| `graph-uptime` | figures | **partly** | figure → source | a figure with no primitive form: its lines as written |
| `graph-activity` | figures | **partly** | figure → source | a figure with no primitive form: its lines as written |
| `graph-calendar` | figures | **partly** | figure → source | a figure with no primitive form: its lines as written |
| `graph-annotate` | figures | **draws** | figure → stack, blockdown, text |  |
| `graph-quadrant` | figures | **partly** | figure → source | a figure with no primitive form: its lines as written |
| `graph-matrix` | figures | **draws** | figure → table |  |
| `graph-compare` | figures | **draws** | figure → table |  |
| `graph-flow` | figures | **partly** | figure → source | a figure with no primitive form: its lines as written |
| `links` | links | **draws** | links → list |  |
| `outlinks` | links | **draws** | links → list |  |
| `resources` | links | **draws** | links → list |  |
| `backlinks` | links | **draws** | links → list |  |
| `box` | layout | **draws** | box → box, markdown |  |
| `image` | media | **draws** | picture → picture |  |
| `hero-image` | media | **draws** | header → picture |  |
| `header` | layout | **partly** | prose → markdown; figure → row, stat | Blockdown's own forms in its prose (a property, a value, a component) stay as written |
| `artifact` | media | **partly** | prose → markdown | Blockdown's own forms in its prose (a property, a value, a component) stay as written |
| `embed` | links | **draws** | prose → markdown |  |
| `code-fence` | layout | **draws** | prose → markdown |  |
| `table` | layout | **draws** | prose → markdown |  |
| `fields` | site | **draws** | fields → list |  |
| `if` | site | **empty** | nothing | the service answers no part for this example (an `::if` draws only while its note matches) |
| `use` | site | **problem** | use → source | the service says: no page meeting-template; a use with no primitive form: its lines as written |
| `button` | controls | **draws** | button → button |  |

## The registry

Each primitive type and how this window draws it (`tiles/prim.rs`, `PRIMS`: the entries' own words).

| Type | Drawn as |
|---|---|
| `part` | a component's frame: its name, title, the question it asks (a press opens it as a query) or how fresh its answer is, the service's word on what is wrong, then its view; prose and a picture have no frame |
| `markdown` | prose, by the kit's Markdown: headings, lists, tables, code fences, callouts as quotes with a bold lead; a link opens its note |
| `blockdown` | Blockdown read as Markdown: what the two share draws; a property, a reference or a component inside it stays as written |
| `source` | lines as they were written, in the code face: a component with no answer or no drawing |
| `picture` | a picture where it stands, at its own size up to the reading measure or the height its note gives; a header image as a band, cropped and dimmed as asked; what's wrong said under it |
| `image` | a view's picture, drawn as a note's: its file read from the host, or its own svg |
| `text` | a line of words in its tone, strong when asked; a press when it carries an act line or a link |
| `badge` | a small label; a press when it carries an act line |
| `button` | a labelled press with its keycap from the key table: an act line this window has runs here, a note's button with steps or a script is the service's to run |
| `stat` | a tile: the value large over its label, in its tone |
| `bar` | a label, its value of the most, and a track filled that far |
| `table` | a header row and rows of equal columns; a row or a cell that opens a note or runs an act line is a press |
| `checklist` | a box a row, filled when done; read-only here |
| `sparkline` | a column a value, the tallest the largest |
| `card` | a bordered card: title, subtitle, badge, then its children; a press when it carries a link or an act line |
| `box` | a bordered box, its title when it has one, then its children in order |
| `stack` | its children, one under the other |
| `row` | its children side by side, wrapping when the tile is narrow; a child that fills shares the width, a control keeps its own |
| `band` | a heading, sized by its level, on the rows of its style's glyph track when it says a pattern: shades, bars, dots or ruled lines as small boxes, fading in from the edges the words aren't at |
| `track` | one row of a glyph pattern's cells, as wide as it is given; a pattern nobody here knows is a ruled line |
| `diff` | a change to a text as the service found it: the two sides named, how many lines each way, then each line in the code face, written lines and lines taken out marked and tinted, a long run both sides share said in words; nothing is compared here |
| `list` | the one list, drawn as a list tile draws it: rows under their group headers (a table's as cells under its columns, lanes side by side), built only where they are in view; a row with an act line is a press, its cells as badges, its chips questions for the bar, its detail under it; no filter, selection or preview pane here |
