# 0004: Kernel contracts: what every built-in and every extension is made of

Status: accepted, 2026-10-09, with Evan's amendments: the door context for sources is in (contract 4), and highlights and
margin notes are in (contract 6): years of stated need are evidence.

## Context

The north star (pie `2f3ad30a`, "a personal BBS network, built from five parts") says every feature is made of five
parts: **block, query, component, action, annotation**. A new list is a component plus a query, a new picker is a
source, a new thing you can do is an action, and a new screen is a door made from the parts. Two weeks of building went
mostly the other way: each list, picker and completion became a door feature. This ADR names the contracts that turn
them back into parts, so Evan or an agent can write the next one in an extension folder (or, with PIE-601, in a
`func::` block) and every client gets it.

It decides PIE-734 (built-ins on the extension contracts) and the model in PIE-731's comments (`where=`/`group=`/
`sort=`, presets as curried `::links`, groups as named queries). From PIE-735 it takes the passage target (B1, B4) and
says why the rest of B (span decorations, the margin, annotation properties) and D (outputs, dataflow) wait. PIE-730
(`expand` on reads) falls out of contract 1. It follows [ADR 0001](0001-ids-names-roles.md) (each
reference is an id, a name or a role), [ADR 0002](0002-addressable-resources.md) (one ViewSpec, many renderers) and
PR #345's ADR 0003 (who an agent is).

### Measured: what the built-ins do today (main at `2ebac9a3`)

Paths are under `packages/`.

**Query logic in the client.** The service answers `blocks.query` (`outliner/src/server.ts:1846`), but the door narrows,
groups and sorts rows itself, keyed to two properties:

- The links model filters every group by a hard-coded Kind and Stage (`door/src/links.ts:177-224`, `rowFacets`,
  `narrowRows`), counts them again for the tile's counters (`linkAcross`, `links.ts:230-262`), and the backlinks view
  repeats it (`door/src/backlinks.ts:141` `matchesStage`, `:147` `compareSources`, `:166` `backlinkView`).
- The tile's controls cycle those two facets (`door/src/desk/backlinks-pane.ts:425-427`).
- Stage buckets are a table in the service (`outliner/src/backlink-facets.ts:32`, `DEFAULT_BACKLINK_FACET_RULES`), sent
  per row by `blocks.facets` (`server.ts:1857`), which every links read calls after its query (`links.ts:71`, `:580`).
- Live figures group in the door (`door/src/live.ts:181`, `groupBy`), and turn rows into figure props in a 100-line
  switch (`live.ts:204-303`, `resolveLive`) that Detail, the publisher and MCP can't reach.

**Freshness by polling.** Two caches, one per feature, drop everything on any outline change and ask again on the next
paint: `live.ts:56-145` (`setLiveSource`, `cached`) and `links.ts:512-582` (`linksOf`, `blocksOf`, `invalidateLinks`,
500 ms). No answer says whether it changed.

**One component, four names.** `::links`, `::outlinks`, `::resources` and `::backlinks` are branches of one parser
(`links.ts:415` `LINK_BLOCK_KINDS`, `:475-510` `linkBlockAt`, `:508` refusing `query:` on the others) and four schemas
(`outline-core/src/component-schemas-blocks.ts:22`). Nobody can name a fifth.

**The query grammar has no `this` and no outlink atom.** Atoms are `#tag`, `links:`, `under:`, `title~`, `text~`,
`call:` (`outline-core/src/query-atoms.ts:11-17`). A target is a page, a block id or a Work ID (`:68-92`).

**Lists, one per feature.** The door has a row scroller (`door/src/scroll.ts:155`, `RowView`) and a picker on it
(`door/src/surface/picker.ts:47`, `ListPicker`). On top of those, each list re-does select, filter, preview and enter:
the inline `::links` (`links.ts:616-679` `renderLinkBlock`, its mode `door/src/surface/note.ts:2231-2290`, its actions
`links.pick`/`links.open`/`links.enter` at `note.ts:6123-6200`), the links tile (`door/src/desk/backlinks-pane.ts`, 675
lines), the power bar (`door/src/bar/bar.ts:43`) and the completer's popup (`door/src/surface/completer.ts:292`, `:562`).
An extension's view has no list at all: the primitives are text, badge, stat, bar, table, checklist, sparkline, card,
box, stack, row, band, track (`outliner/docs/extensions/README.md`, "The primitives").

**Two picker contracts.** The bar has a source registry (`door/src/bar/source.ts:13-78`: `BarRow`, `BarSource`) with
five built-ins (`door/src/bar/sources.ts:68` tiles, `:143` notes, `:201` actions, `:256` recent, `:274` screens) and
an extension's sources bound through the service (`door/src/extensions.ts:295` `barEntry`, wire row
`outline-core/src/protocol.ts:238` `ExtensionBarRow`). Completion is a separate path: one `if` per trigger
(`completer.ts:113-176`, `lookupCompletion`) over a trigger detector that exists twice, `door/src/completion.ts` (170
lines) and `outliner/src/completion.ts` (155 lines). Component schemas already feed `[key::` completion
(`completer.ts:203`). An extension can add bar rows, never completion rows. An extension's bar source sees only the
note in front of the person (`outliner/src/extension-calls.ts:704-731`), so the bar's own tiles, actions and recent
sources couldn't be written as one.

**No span anywhere in an action.** Action targets are `block`, `handler:<key>`, `tile:<kind>` and `bar`
(`outliner/src/extension-manifest.ts:111`). Decorations go `above`, `below`, `replace` or `around` whole lines
(`outline-core/src/rules.ts:170`). The annotation store already has the passage shape, a text-quote anchor with
`exact`, `prefix`, `suffix`, `start`, `end` (`outliner/src/annotations.ts:104-125`), and the door's selection maps to
source only line by line when `sourceExact` is false (`note.ts:4532-4537`).

**No outputs.** A component's result is kept per line (`extension_outputs`) and drawn; nothing else can read it.

**Passages are built three ways.** Detail builds a text-quote anchor from its selection
(`outliner/src/detail-controller.ts:996`), MCP's `outline_comment` takes `quote`, `start`, `prefix`, `suffix` and
`revision` (`door/src/mcp-writes.ts:195-196`), and the door's `mark` takes `quote=` with `near=` (`note.ts:3049-3052`).
Each finds the passage its own way.

## The rule this ADR applies

A part climbs chat → skill → helper and API → kernel, and only on evidence (pie `3684a9fe`, "Coherence", and
`23cfe45d`, "Progressive determinization"). The evidence is one of: a prompt can't hold the boundary; runs disagree;
writes race; it's too slow; it must be audited; a second workflow needs it. Here, **built-ins that already need a
contract count as its second use**, and so does **what Evan has asked for again and again**: the ladder guards against
guessing, not against a need he has stated for months. Each contract below names its evidence. What has none yet is listed under
[Not yet](#not-yet-stays-a-convention-or-a-kit) with what would make it climb.

Two tests from the same note hold for every contract:

- **A door is removed by deleting its folder.** Whatever an extension adds through these contracts (a handler's
  question, a source, a preset it declares, a passage action) goes when its folder goes. Notes it or a person wrote
  stay, because they are data.
- **Every terminal gets it, or the ADR says why not.** Each contract has a line for the door, the console (Tree and
  Detail), published pages, chat over MCP and the CLI.

## Decision

Five kernel contracts. Each gives its evidence, its wire shape, the built-ins that move onto it (and what they
delete), what stays a door's own, which terminals get it, and what it does to `PROTOCOL`. The build order is at the
end, one PR per slice.

Words: a **row** is one item a query or source answers. **View state** is what one viewer has done to a view
(selection, typed filter, folds, entered, scroll). It is never written to the outline and never sent to the service.
A person and each agent have their own (an agent's selection is drawn in its tint, as `select` already does).

### 1. A component's query input

**Evidence.** Two built-ins re-implement query work in one client: `::links` narrows and counts by Kind and Stage
(`links.ts:177-262`, `backlinks.ts:141-166`), live figures group (`live.ts:181`). Runs disagree: the door's Kind filter
and the service's `type=` are two matchers. Refreshing needs coalescing: both keep a cache dropped on any change and
asked again on paint (`live.ts:56-145`, `links.ts:512-582`). And it's one client only: Detail, pages and MCP can't
see a figure's data (PIE-730).

**The service evaluates the question, passes the answer in, and says when it changed.** No client evaluates, narrows,
groups or sorts rows. The one exception is the viewer's typed filter: words over rows already answered (outline-core's
matcher), view state, never sent.

The question, the same everywhere (a `::links` attribute, a `::graph-*` YAML key, a handler's manifest, a tile's saved
args, `outline_query`):

```ts
interface Question {
  where: string;              // the views' grammar (block-query.ts, outline-core's atoms); `blocks.query`'s
                              // `expression` is renamed `where`
  this?: string;              // the block `this` stands for (below)
  group?: string;             // a property name; created:day|week|month, updated:day|week|month
  sort?: string;              // "<property|created|updated|title>[ asc|desc]"; property:<name> for a property so named
  limit?: number;             // rows returned: default 200, at most 1000
  facets?: true | string[];   // value counts for every key the matches carry, or these keys
}
// blocks.query { query: Question, watch?: string, generation?: number } answers
{
  generation: number,                       // this watch's answer generation (0 when it registers)
  blocks: Row[],                            // after sort, cut to limit
  completeness: { kind: "complete" } | { kind: "truncated", matched: number },
  groups?: { value: string | null, count: number, ids: string[] }[],  // count over every match; ids of returned rows
  facets?: { key: string, count: number, values: { value: string, count: number }[], more?: number }[],
                                            // over every match; 50 keys and 50 values each at most, `more` says the rest
  hint?: string                              // "no notes have <key>; nearest: <keys>"
}
Row = { id, revision, title, workId?, props: Record<string, string | string[]>, createdAt, updatedAt, author }
```

- **`this`** is a target wherever a target goes: `links:this`, `linkedfrom:this`, `under:this`, `parent:this`. It is a
  **role** (ADR 0001): the note the question sits in (a component), the note a tile is aimed at (a links tile), the
  block a handler line is in. A question that says `this` with none given is refused: "this is the note the query sits
  in; this query has none (pass this=<block id>)". A saved view read as a group binds `this` to the component reading
  it.
- **New atoms** (outline-core `query-atoms.ts`):
  - `linkedfrom:<target>`: blocks the target links to (the outlink index behind `blocks.authored-links`), the
    counterpart of `links:`. `links:this NOT linkedfrom:this` is the backlinks this note doesn't link back.
  - `parent:<target>`: the target's direct children. `under:` stays the whole subtree.
- **Properties are open.**
  - No computed `kind` or `stage`: group and sort by the properties rows carry (`type`, `work-stage`, anything).
    Sorting by `work-stage` uses the workboard's stage order (the workboard owns that key's meaning, as
    `backlink-facets.ts:32` does now); any other key sorts as numbers, then text, rows without it last
    (`block-query.ts:900`).
  - A multi-valued property puts a row in each of its values' groups and counts it once per value.
  - `hint` comes back only when no block in the outline carries the key. A known key with no matches answers empty.
  - The per-row `blocks.facets` (kind, stage) is retired in slice 2, with its last readers (the Kind and Stage
    controls): rows carry their props. `blocks.facets` becomes `{ query: Question }` → `facets` alone, for a control
    that offers choices before rows are wanted.
- **Watched.** `watch: <key>` keeps the question on the connection; the answer that registers it is generation 0.
  - After changes, the service evaluates every watched question at most every 250 ms and at least once per second
    under steady writes, and sends `queries.changed { changes: { key, generation, dropped?: true }[] }` to that
    client alone, for those whose answer changed.
  - "Changed" is a hash of the whole answer: ids, revisions, order, groups, facets, completeness.
  - It keeps the newest answer per watch. `blocks.query { watch, generation }` with that generation is served from
    it, not evaluated again; an older generation is answered with the newest. A newer answer replaces the kept one.
  - Bounds: 64 watches per connection and 512 per service. Past them the oldest is dropped, announced with
    `dropped: true`; the watch is gone and the client asks again to re-register. A connection's watches end with it.
  - Limits: a question returns at most 1000 rows (a handler's input, a figure). A list shows at most 200; a component's
    answer cuts each group to 200 with `more`.
- **Handlers.** A handler in `extension.json` may declare `query: Question` (strings take `{argument}`, `{option}`
  and `this`). Before `run`, the service evaluates it and passes `input.query` (the answer above). A `read` handler
  runs again when its question's answer changes (a watch the service holds); `spend` and `write` handlers never run by
  themselves (the `effects` table holds). This closes the README's first "Not yet".
- **Components answered whole.** A client asks for a component, never assembles one from queries:

  ```ts
  // a component written in a note, or one a tile holds in its saved args
  components.answer { at: { block, component: "^name" | number /* its line */ } | { spec: { name, args }, this },
                      watch?, generation? }
  → { generation, name, preset?: string, args: Record<string, string>,   // after preset resolution
      question?: Question,                                               // a single-question component's
      groups: { name, label, glyph?, count, note?, more?: number, rows: ListRow[] }[],   // ≤ 200 rows each
      facets?: …, completeness, problem?: string }
  ```

  The service resolves the preset (contract 2), evaluates every group, applies `where`, `group` and `sort`. `ListRow`
  is contract 3's row; it lands in slice 2 as wire, before the `list` primitive that draws it.
- **Expand on reads** (PIE-730): `outline_read`, `ep0ch export` and the CLI's read return each live component as `{
  line, name, attrs, question, results, more? }` with `expand: "titles" | "full" | false`, from `components.answer`.
  No second evaluator.

**Moves onto it.**

| Built-in | Today | Deleted |
|---|---|---|
| `::links{query=…}` matches | `matchesOf` → `queryNotes` + `facets` (`links.ts:577-582`) | `blocksOf`, `matchesOf`, `childrenOf`, `invalidateLinks`, the caches (`links.ts:512-582`) |
| live figures' questions | door cache and `groupBy` (`live.ts:56-181`) | `cached`, `sourceKey`, `groupBy`, the generation counter; the figure reads `groups` |
| backlinks narrowing and order | `matchesStage`, `compareSources`, Kind/Stage | `backlinks.ts:130-249`, `links.ts:169-262` |
| the links tile's Kind / Stage / Sort | `backlinks-pane.ts:425-427` | the two cycles; a where chip, a group chip and a sort chip whose choices are facets |

**Stays the door's.** Drawing, the chips, which question a tile holds (its saved args), the typed filter.

**Every terminal.** The door and Detail ask `components.answer`; MCP and the CLI get `expand`; pages draw the
answer as HTML when the publisher learns components (PIE-735 C).

**PROTOCOL.** Bumps: the atoms, `this`, `where`, `blocks.query`'s answer, `blocks.facets`' new shape,
`queries.changed`, `components.answer`.

### 2. Presets: a named component is a base with arguments given

**Evidence.** One component already has four names (`LINK_BLOCK_KINDS`, `links.ts:415`; four schemas,
`component-schemas-blocks.ts:22`), and the branches disagree on what each takes (`links.ts:508`). PIE-731 wants more
(`::decisions`, `::loose-ends`) and today each would be a code change. The links tile is a fifth copy of the same list
with its own saved options.

**`::backlinks` is `::links` with arguments already given.**

- **The base.** `::links` takes `of`, `groups`, `where`, `group`, `sort`, `limit`, `title`, `preview`, `filter`.
  `LINK_BLOCK_KINDS` and the per-kind branches of `linkBlockAt` become preset resolution, then one path.
- **A preset is a note,** the no-code tier, like a rule note:

  ```text
  Decisions [preset-name::decisions] [preset-base::links] [preset-where::links:this type=decision] [preset-group::work-stage]
  Loose ends [preset-name::loose-ends] [preset-base::links] [preset-where::links:this NOT linkedfrom:this]
  ```

  `preset-<arg>` sets any argument of the base (a `]` in a value is written `\x5d`, as in `rule-text`). An extension
  declares presets in `components[]` beside its schemas; they go when its folder goes.
- **Built-ins ship as presets** in outline-core (`component-presets.ts`): `backlinks = links{groups=backlinks}`,
  `outlinks = links{groups=outlinks}`, `resources = links{groups=resources}`. Nothing else is built in.
- **Resolution**, first match wins: the outline's preset note, an extension's, the built-in. A shadowed preset is
  listed as shadowed. Two notes naming one preset are refused with both ids (ADR 0001, rule 2). A preset's base may be
  another preset, four deep at most; a loop is refused naming it.
- **Arguments narrow.**
  - `where` composes: `(preset) AND (author)`, each parenthesised.
  - `of` and `groups` are fixed when the preset sets them. The author writing them is refused with why ("::backlinks
    lists backlinks; ::links{groups=…} lists others"), so a narrowed preset never becomes a different list.
  - Every other argument the author writes replaces the preset's.
- **Groups are named questions.** A group is `{ name, label, glyph, rows }`, its rows a question or one of the
  service's own row lists:

  | group | rows |
  |---|---|
  | `backlinks` | `links:this` |
  | `children` | `parent:this` |
  | `matches` | the component's own `where` |
  | `outlinks` | the service's authored-links answer (it has rows that aren't blocks: an unresolved page, a missing block, an unregistered Resource) |
  | `resources` | the same answer's Resources |
  | `((view))` or `[[page]]` | a saved view: its query, its title as the label, its `[glyph::]` |

  The service applies `where` to every group (a row list's blocks through `query.matches`, `server.ts:1885`; its rows
  that aren't blocks drop out while a `where` is set, as rows with no facets drop under a Kind filter today,
  `links.ts:173-175`) and answers the whole list (`components.answer`). A named question is a saved view: no new
  "group" kind. A group naming a missing view shows why in its header.
- **Read beside schemas.** `components.schemas` answers presets (`origin: built-in | outline | ext:<id>`), so the
  library draws a page per preset and `::` completion offers them.

**Moves onto it.** The four links components (one schema, three presets); the links tile (`::links` with its args in
the layout; the thread tile is `links{groups=children}`).

**Stays the door's.** A group's glyph in a terminal when the view gives none.

**Every terminal.** Presets resolve in the service, so every client that asks `components.answer` gets them.

**PROTOCOL.** Bumps: preset resolution is outline-core's, and `components.schemas` answers presets.

### 3. The list primitive, and component ids

**Evidence.** Three built-ins re-do select, filter, preview and enter over the same rows: the inline `::links`
(`renderLinkBlock`, `linksMode` and `linksKey`, `note.ts:2231-2290`), the links tile (`backlinks-pane.ts`), and the
tree's links under a row (`L`). An extension's view has no list, so a door like marginalia can't show its notebook
without one. And their view state is keyed by title and position (`links.ts:620-623`), so editing a title above moves
one list's selection to another: that needs ids.

**`list` joins the view primitives. Each client has one implementation.**

```ts
{ type: "list",
  rows: ListRow[],                          // at most 200
  groups?: { name: string, label: string, glyph?: string, count: number, note?: string }[],
  preview?: "right" | "below" | "none",     // default none
  filter?: boolean,                         // "/" types words over the rows (default true)
  enter?: boolean,                          // the frame's "⏎ in" takes the keys (default true)
  empty?: string }
ListRow = { id: string, label: string, detail?: string, mark?: string, tone?: Tone, group?: string,
            preview?: { block: string } | { markdown: string },
            do?: Activation }                // what ⏎ does: one of the four below; none is a header
Activation = { open: string } | { run: { action: string, args?: Record<string, string> } } | { copy: string } | { insert: string }
```

- **One activation, never several.** A row does exactly one thing when picked; the service refuses a row with two.
  The same union is contract 4's, so a source's rows are list rows.
- **An activation runs as the picker, under the picker's rules.** `open` lands where the picker's opens land (ADR 0002
  rule 5). `run` goes through the dispatcher's actor rules, so an action that touches the person's tile, focus or keys
  is refused for an agent with its `way`. `insert` goes only into the picker's own draft; an agent picking an `insert`
  row is refused ("an agent writes with outline_edit, not into the person's draft"). `copy` puts text on the
  person's clipboard, and answers an agent with the text.
- **Component ids.** `^name` at the end of a component's first line names it inside its block (`::links{…} ^outbox`),
  as an anchor names a line now. `((id^outbox))` opens it. View state is keyed by note and `^name`; a component with
  none is keyed by its position, and the client drops its view state when the note's component lines change.
- **View state is the viewer's.** Selection, typed filter, entered and scroll are never written, never in a
  projection, never sent. A published page (no viewer state) previews the first row.
- **Actions, one set for every list.** `list.blocks` (the lists as drawn, numbered), `list.pick { list, n | id }`,
  `list.step { list, by }`, `list.open { list, where? }`, `list.filter { list, words }` and `list.enter { list, on }`,
  in the door's `ActionSet` with keys and clicks. They replace `links.blocks`, `links.pick`, `links.open` and
  `links.enter` (`note.ts:6123-6200`).
  - An agent's `pick`, `step` and `filter` move its own selection and filter, drawn in its tint; its `open` lands
    where its opens land. None touches the person's.
  - `list.enter` gives a list the keyboard, so it is the person's; an agent's is refused with what to do instead
    (`list.pick`, then `list.open`), as `ActionDef.person` already says for others.
- **Renderers.** The door: one `ListView` over `RowView` (`scroll.ts:155`) with the filter's `LineInput` and the
  preview slot. Detail: rows as text, ⏎ opens. The publisher: `<ul>`, the first row's preview after it. Markdown: a
  bulleted list. JSON: the rows. CSV: label and detail.

**Moves onto it.** The inline `::links`, the links tile's list, the tree's links under a row.

**Stays the door's.** `ListView`, its keys (`j k`, `[ ]`, `/`, ⏎, alt+⏎, esc) and hit areas, every viewer's view
state.

**Every terminal.** Door, Detail, pages, Markdown, JSON (MCP), CSV, as above.

**PROTOCOL.** Bumps: the primitive catalogue (`component-primitives.ts`, `extensions.list`'s `primitives`), the
`^name` component form (outline-core `component-block.ts`).

### 4. Sources: one row contract for the bar and completion

**Evidence.**
- The trigger detector exists twice (`door/src/completion.ts`, `outliner/src/completion.ts`): runs can disagree on
  what `[[` the cursor is in.
- Completion is one branch per kind (`completer.ts:113-200`): pages, blocks, fragments, files, callouts, properties,
  filters. Seven built-in uses of one shape.
- The bar has two row types for one job (`BarRow`, `source.ts:13`; `ExtensionBarRow`, `protocol.ts:238`).
- Evan asked for it by name (PIE-734): "how do custom components add to the existing autocomplete?"
- **The door context is part of it.** Evan's stated end state, for months: the power bar as a Raycast-like launcher
  that extensions extend, agents writing UI in the moment, and the bar's own tiles, actions, recent and screens
  sources being things an extension could have written (PIE-734). Their door-side copies are the first users of
  the context; an extension asking "the note in front of me and the tiles beside it" is the second.

**A source answers rows for typed words. The bar and the completer ask sources; nothing is rebuilt per feature.**
Component schemas are the declarative tier of completion; sources are the dynamic tier.

```ts
SourceRow = ListRow                        // contract 3's row: id, label, detail, preview, do
SourceDecl = {
  id: string, title: string, description?: string,
  prefix?: string,                          // the bar: one character that scopes it
  triggers?: ("[[" | "((" | "@" | "::" | "[key" | "key::" | "yaml-key" | "yaml-value" | "[file::" | "> [!")[],
  main?: boolean,                           // its rows join the bar's main list
  deadline?: string
}
// the extension operation `bar` becomes `source`:
input = { source, query, limit, context?,       // context: the note in front of the viewer
          trigger?: { kind, key?, component?, target?: string } }  // key: a value's property; component: a YAML key's;
                                                  // target: `((note#` / `((note^`'s note part, parsed by outline-core
// context.door, on the picking person's own ask only (never an agent's, never cached), read-only:
//   { screen, focused: tile, tiles: [{ name, kind, showing?: id, title }], recent: id[], selection?: passage }
value = { rows: SourceRow[] }               // ≤ 50, checked: text cleaned, one activation each, an `open` that
                                            // exists, a `run` that is the extension's own and can run on that row,
                                            // an `insert` of one line, ≤ 500 characters, no control characters
```

- **One manifest field.** `bar[]` becomes `sources[]`, and the manifest's `contract` becomes 3. A contract-2 manifest
  is refused with the field to rename. The shipped examples (`glyphs`) move in the same PR. `ExtensionBarRow` and
  `BarRow` both become `SourceRow`.
- **Triggers are outline-core's**: `completion-triggers.ts` says which trigger the cursor is in, its token and its
  replacement range, and absorbs both detectors. `key::` carries the key. `::` completes a component name (schemas and
  presets). `@` is a mention (ADR 0003's personas, the `@name` agents extensions declare).
- **Asking.** The completer asks every source registered for the trigger, the built-ins first, each capped, 20 in all,
  rows with the same `insert` kept once. Sources are stateless: the completer keeps, per ask, the draft, a generation
  and the token's range. An answer for an older generation is dropped, and a pick re-checks the range against the
  draft before splicing (what `insertCompletion` does for references now, `completer.ts:252`).
- **`insert` is the person's.** It goes into the draft of whoever completes, which is always the person typing. An
  agent doesn't complete; it writes with `outline_edit`. A source never writes the note.
- **Built-in sources, on the same row contract:**
  - in the service: `pages` (`[[`), `blocks` (`((`), `fragments` (`((note#`, `((note^`), `files` (`[file::`), `notes`
    (the bar's `/`);
  - declarative, from schemas and the outline's lists: `properties` (`[key`, `key::`, YAML keys), `callouts` (`> [!`),
    `components` (`::`);
  - in the door: `tiles` (`%`), `actions` (`>`), `recent` (`+`), `screens` (`@` in the bar; the bar's prefixes and
    completion's triggers are separate namespaces). They are written on the same contract an extension uses, reading
    `context.door`, so an extension can do what they do; moving them into an extension folder later is a move, not a
    rewrite.

**Moves onto it.** The bar's five sources and the extension binding (`extensions.ts:295-341`), the completer's
per-kind branches, both trigger detectors.

**Stays the door's.** The bar's palette and the completer's popup, the four door-side sources' code, the clipboard.

**Every terminal.** The door (bar and completer) and Detail's completer ask the same sources. The four door-side
sources are door-only: they list the door's own tiles, actions and screens, which no other terminal has. MCP gets the
service-side sources as tools that exist (`outline_find`); no palette.

**PROTOCOL.** Bumps: `SourceRow`, the `source` operation, `extensions.source`, contract 3, the triggers.

### 5. The passage target

**Evidence.** Three paths build a passage, each its own way: Detail's selection (`detail-controller.ts:996`), MCP's
`outline_comment` (`mcp-writes.ts:195-196`) and the door's `mark quote=` (`note.ts:3049`). The door's `C` maps a
selection only to lines when `sourceExact` is false (`note.ts:4532-4537`). No action can take a span at all
(`extension-manifest.ts:111`), so "do X with this passage" is a new door feature each time.

**An action can act on a passage.**

```ts
// extension.json actions[].on = "passage"; act's input gains target: { passage: Passage }
Passage = {
  subject: string,            // a block id, or resource:<id>
  revision: number | string,  // the block's revision, or the Resource's content hash
  quote: string,              // the exact text
  start: number, end: number, // UTF-16 offsets in the subject's source text
  prefix: string, suffix: string  // up to 32 characters either side
}
```

- It is the annotation store's text-quote anchor (`annotations.ts:104-125`) plus a subject and a revision, so a passage
  becomes an annotation unchanged.
- **Filled by** a selection in the door (exact offsets, or the action is refused with why), Detail's selection, an
  agent's `quote=` with `near=`, and a click in a published page when pages take input (PIE-735 C).
- **Checked by the service before the action runs.** At the given revision the quote must be at `start`. At a newer
  revision it must be found exactly once, with its prefix and suffix, and the action gets the moved offsets. Anything
  else (gone, or found twice) is refused with the nearest match: select it again. The fuzzy and agent-assisted rungs
  of the re-anchoring ladder are for showing annotations, never for a write.
- **Writes.** An action on a block passage writes through `draft.patch` with the `edit` policy, its precondition the
  revision it was checked at. A Resource's text is stored content, never edited: an action on a Resource passage may
  write only blocks (an annotation, a note).
- The three paths above build a `Passage` through one helper in outline-core (`passage.ts`: find, check, move).

**Moves onto it.** The door's `C` and `mark quote=`, Detail's comment selection, MCP's `outline_comment` quote.

**Stays the door's.** Mapping a drawn selection to source offsets (`sourceOf`).

**Every terminal.** The door, Detail, MCP (`quote=`), the CLI (`ep0ch act … --quote`); pages once they take input.

**PROTOCOL.** Bumps: `Passage`, `on: "passage"`, the helper in outline-core.

### 6. Highlights and margin notes: span decorations, a margin place, annotations with properties

**Evidence.** This is the need the whole line of reasoning started from, stated for years: Evan's conversation exports
and board notes on float-box (`/opt/float/data/floatctl-extract`, `/opt/float/bbs/boards`) mention Readwise or Reader
about 38,000 times, and about 15,000 files there touch Readwise, Hypothesis, highlights or annotation. A decade of
Readwise highlights and a 2,836-annotation Hypothesis archive are his. The marginalia prototype (Oct 9) is the shape.
The annotation store, anchors and re-anchoring ladder are built (PIE-138, 210, 250 to 257); what's missing is the
drawing and the properties. The second uses are already queued: the Readwise board (PIE-743), the browser and page
overlay (PIE-735 C), the browser tile (PIE-742).

- **A highlight is an annotation with no body.** Annotations carry ordinary properties: `kind` (highlight, note,
  question, define, explain), `tags`, `color` (a theme tone name, never a raw colour). Properties are open: these are
  conventions the kit writes and every query reads, not a closed list.
- **Span decorations** (`place: "span"`): a rule or component marks characters, by an annotation's anchor or by a
  passage target (contract 5). The door draws them in its renderer (a tone background, capped dark), the publisher as
  `<mark>`; Detail as its comment marks do.
- **A margin place** (`place: "margin"`): a card beside a passage, from an annotation thread or a component's view
  spec. The door draws it in the comment gutter's column, widening into a side column when the tile is wide; narrow, it
  folds under the passage (as the prototype does). The publisher and the page overlay draw an aside.
- **Every terminal:** the door and Detail draw spans and margins; published pages draw them read-only now and take
  them back with the one sign-in (PIE-735 C); MCP reads annotations with their properties (`outline_threads`), and an
  agent writes one with a passage target.

**PROTOCOL.** Bumps: the `span` and `margin` places, the annotation properties on the wire.

## Not yet: stays a convention or a kit

Each of these was asked for. None has the evidence yet. Each says what would make it climb.

| Part | Rung now | Stays as | Climbs when |
|---|---|---|---|
| **Component outputs and dataflow** (`((id^name)).field`, one-way, cycles refused) | 1: the showcase repeats queries | each component asks its own question (contract 1 makes that cheap: watched and coalesced) | two components in real notes need one value and their answers disagree, or `{{ }}` interpolation (PIE-533) lands and needs a value to read |
| **Bindings** (a property whose value is a link reads that block's record, PIE-533) | 2: designed | properties as written | the same: PIE-533's first slice |
| **The bar's list and the completer's popup as `ListView`** | 4, separately | their own lists | a fix lands in one and is missed in the other |
| **The bookkeeping fold** (PIE-731 item 4) | 2 | a saved view note Evan edits, used as a `where` (`::backlinks{where=((bookkeeping))}`), never a type list in code | it's written into a third preset by hand |

## Constraints, and how each holds

- **Two tiers.** Presets, saved views and rule notes are the no-code tier. Handlers with questions, sources and
  passage actions are the code tier. Every contract has a built-in and an extension on it.
- **Agent code trusted by hash (PIE-601).** A `func::` block compiles into the same manifest, so it can declare a
  question, a source or a passage action, and none runs until the person trusts that exact text. Presets are data and
  need no trust.
- **Blockdown is canonical; render never rewrites it.** Answers, presets and expansions are computed on read. `insert`
  enters only the person's draft. Passage writes go through `draft.patch`.
- **One view spec, many renderers.** `list` is a primitive; each client draws it with its own renderer.
- **Mouse, keys and `act`.** `list.*`, source picks and passage actions are `ActionSet` actions with keys and clicks.
  An agent's runs are attributed and use its own view state; what would take the person's keys (`list.enter`) is
  refused with what to do instead.
- **Properties are open.** `where`, `group`, `sort` and facets take any key, and there are no computed kind or stage
  fields. Controls offer what the rows carry.
- **One version.** Each slice that touches the wire bumps `PROTOCOL` (main is at 126; the deployer allocates numbers
  when several PRs bump at once). The manifest's `contract` goes to 3 with no reader for 2.

## Consequences

- `packages/outliner/docs/extensions/README.md` loses its first "Not yet" and gains `query`, `sources[]`,
  `on: "passage"` and `list`.
- `docs/UI-GRAMMAR.md`'s reuse map gains rows for presets, `ListView`, sources and the passage, and its `::links` and
  power bar rows point at them.
- The door stops owning query meaning: no Kind or Stage, no grouping, no freshness cache.
- A review asks of a new list, picker or completion: which contract is it on? And of a new contract: what's its
  evidence? A "no" to either is an ADR, not a feature.

## Build order

Each slice is one PR with a kitchen-sink section (`ep0ch --showcase`) and its test in
`packages/door/test/showcase.test.ts`, and deletes what it replaces in the same PR. Each bumps `PROTOCOL`.

| # | Item | Slice | Contract | Demo | Deletes |
|---|---|---|---|---|---|
| 1 | PIE-745 | Watched questions: `this`, `linkedfrom:`, `parent:`, groups and facets answered by the service | 1 | a hub note with 25+ fictional backlinks: `links:this NOT linkedfrom:this`, grouped by any property; a `::graph-tabs` grouped by the service | `links.ts:512-582` and `live.ts`'s caches, `groupBy` |
| 2 | PIE-746 | `::links` is one component answered whole (`components.answer`, `ListRow` on the wire): presets, named-question groups, where/group/sort on the block and the tile | 1, 2 | `::backlinks`, `::decisions` and `::loose-ends` as presets; the tile's chips listing facets | `LINK_BLOCK_KINDS` branches, `narrowRows`, `rowFacets`, `linkAcross`'s kinds, `matchesStage`, `compareSources`, the Kind/Stage cycles, the per-row `blocks.facets` |
| 3 | PIE-747 | The `list` primitive, `^name` component ids, the door's one `ListView`, `list.*` actions; Detail and the publisher draw it | 3 | the links block, the links tile and an extension's `list` view side by side; an agent's pick in its tint | `linksMode`/`linksKey`, the tile's list body, `links.*` actions |
| 4 | PIE-748 | A handler declares a question; the service re-runs it on change | 1 | a fictional "errands" extension whose component lists `type=errand` | the README's "Not yet" |
| 5 | PIE-749 | Live figures' data computed by the service; `expand` on reads (PIE-730) | 1 | a `::graph-tabs` read by `ep0ch show`, Detail and `outline_read` alike | `resolveLive` and its helpers leave the door for outline-core |
| 6 | PIE-750 | One source row contract; completion asks sources by trigger; `sources[]` and contract 3 | 4 | an extension's `@` completion source and its bar scope | `lookupCompletion`'s branches, both trigger detectors, `BarRow` and `ExtensionBarRow` |
| 7 | PIE-751 | The passage target, exact selection to source, one passage helper | 5 | a fictional "define on select" extension, from the door's selection and from an agent's `quote=` | the three passage builders' own matching |
| 8 | PIE-753 | Highlights and margin notes: span decorations, the margin place, annotation properties (contract 6) | 5, 7 | marginalia's kit on a note and a file: select, highlight, ask; the notebook as a query | the gutter-only comment marks' own drawing |

1–3 are PIE-731 and the base the rest use. 4–5 finish the figures. 6 is the bar and completion. 7 is PIE-735 B1 and
B4; the rest of PIE-735 B and D waits in [Not yet](#not-yet-stays-a-convention-or-a-kit) for marginalia's kit.

## Shipped

Kept current with each slice's PR (the extensions README keeps the same table, with where each lives:
[ADR 0004: what has shipped](../../packages/outliner/docs/extensions/README.md#adr-0004-what-has-shipped)).

| # | Item | Contract | State |
|---|---|---|---|
| 1 | PIE-745 | 1 | shipped (#356) |
| 2 | PIE-746 | 1, 2 | not yet |
| 3 | PIE-747 | 3 | not yet |
| 4 | PIE-748 | 1 | not yet |
| 5 | PIE-749 | 1 | not yet |
| 6 | PIE-750 | 4 | not yet: manifests stay contract 2 until it lands |
| 7 | PIE-751 | 5 | shipped (#360) |
| 8 | PIE-753 | 5, 7 | shipped (#360): annotation properties, the `annotate` write; span and margin drawing with it |

Outside this ADR, PIE-754 (extensions as first-class programs: a schedule, a connection to the service, writes
anywhere they're attributed, secrets by `with-secrets` group, collections, Resource refs) added only optional manifest
fields (`schedule`, `on: "outline"`, a secret's `{ group, key }`), so contract 2 stands and slice 6 still moves it to 3.
