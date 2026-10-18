# Scripts in a note: the surface

A script is a note with `[script::name]` and a code fence. It runs in the outline host, in a sandbox, and sees the
note it is about, a few functions, the agent tools and a set of view builders. This page is the whole surface, written
from the code on main: every entry ends in a pointer (`path:line`) to the source, and `test/scripts-docs.test.ts` fails
when a pointer, the tool list or a view's fields drift. Read the source when a detail here isn't enough; the pointer
is where to start.

Everything below was checked against a scratch outline. Where this page and the code disagree, the code wins: fix the
page (`bun packages/outliner/scripts/scripts-doc.ts` rewrites the generated tables; the pointers you move by hand).

- [A script in one minute](#a-script-in-one-minute)
- [The script note](#the-script-note) · [Globals](#globals) · [Functions](#functions) · [tools.*](#tools) · [view.*](#view)
- [What a script returns](#what-a-script-returns) · [Record shapes](#record-shapes)
- [Modes](#modes) · [Effects, access and attribution](#effects-access-and-attribution) · [Lifecycle](#lifecycle)
- [Traps](#traps) · [Worked examples](#worked-examples) · [Source map](#source-map)

Other pages: the extensions README has the four extension kinds and where a script sits among them
([Script blocks and files](extensions/README.md#script-blocks-and-files-pie-601)); the `ep0ch-outline` skill says when
to reach for one while working in an outline.

## A script in one minute

Write a note, and a fence under it. The note's first line says what it is:

````blockdown
Week sentence [script::week-sentence] [mode::render]
```js
return `This note is ${this.title}.`;
```
````

That is a render-mode script: write `week-sentence::` on a line of any note and the line draws "This note is …" under
it, and draws again when the note changes. Drop `[mode::render]` and it is an action script instead: it runs when
you press its key, type its name in the power bar, a rule fires it or an agent asks, and it leaves a run note with what it
did. A script can write only when it says so (`[effects::write]`).

Use a script for a small thing that belongs to one note or one outline: a computed column, a sentence from properties,
a stamp on every match. Use an extension (a folder) when you need disk, network, a secret, or another language.

On a published page, render scripts run through `site.answer` with the reader's visibility cut. Query and saved-view
counts include only visible matches, before the requested limit is applied. A direct read of a hidden note still draws
“hidden here”. Script lines in an embed or a `::use` draw through the same handler path. The page's drawing does not
replace the output stored for the outline's readers.

## The script note

| Part | Written | Means | Source |
|---|---|---|---|
| `script` | `[script::name]` | The script's name: its power-bar name, its `name::` handler line, its `@name` responder (an `@name` responder only when it starts with a lower-case letter and is lower case, digits and hyphens, up to 32). | `packages/outliner/src/script-sources.ts:47` |
| the fence | a closed `js` or `ts` fence | The first closed `js`, `javascript`, `ts`, `typescript` or `actions` fence is the code. TypeScript is stripped, not type-checked. Only the first such fence counts; if it is unclosed the script is empty (nothing runs, nothing is refused). | `packages/outliner/src/script-sources.ts:11` |
| `mode` | `[mode::render]` | A handler: a line `name::` draws what the script returns. See [Modes](#modes). | `packages/outliner/src/script-sources.ts:52` |
| `effects` | `[effects::write]` | May call write tools and `act`. Absent: read-only. | `packages/outliner/src/script-sources.ts:51` |
| `deadline` | `[deadline::30s]` | When the run is cut short: `s`, `m` or `h`. Longer than `5m` is clamped to 5 minutes, not refused; a malformed value is ignored. Defaults: 5 minutes for a run, 15 seconds for a render drawing. | `packages/outliner/src/script-sources.ts:53` |
| `keys` | `[keys::alt+S]` | Binds keys (several separated by commas). | `packages/outliner/src/script-sources.ts:56` |

Other ways a script exists: a file `<outline folder>/.ep0ch/scripts/name.js` or `.ts` whose first line is
`// ep0ch-script` (or `// ep0ch-script effects=write`); an `actions` fence, which is one door action per line rather
than JavaScript (`packages/outline-core/src/action-line.ts`). Saving a malformed script still saves the note; `ep0ch ext ls`
says why it isn't served.

A script's arguments are `slot=value` words (`week=42`). The power bar offers the slots a js script reads as
`props.name`: `propsUsed` finds them in the code.

| Entry | Source |
|---|---|
| `scriptFence` | `packages/outliner/src/script-sources.ts:14` |
| `propsUsed` | `packages/outliner/src/script-sources.ts:22` |
| `MAX_DEADLINE_MS` | `packages/outliner/src/extension-manifest.ts:416` |

## Globals

The code is the body of an async function: `await` and `return` work at the top. These names exist; nothing else does
(no `fetch`, timers, `process`, `require` or imports; disk and network belong to extensions).

| Global | Is | Source |
|---|---|---|
| `this` | The note the run is about, as a record (see [Record shapes](#record-shapes)). A rule-fired script gets the matched note; a key or power-bar run, the note in front of the person; `act ext.<id>.run block=<id>` names one. With none, every read of `this.x` throws "this run has no note; pass at= or run it from a note". Frozen (an assignment is ignored without an error). | `packages/outliner/src/script-runtime.ts:12` |
| `self` | The script's own note, as a record (`null` for a file script, which has no note). Frozen. | `packages/outliner/src/script-runtime.ts:25` |
| `caller` | `{ block, line? }`: where it was invoked (the matched note of a rule, the handler line of a render). Set only when a note is in play and the run came from a rule's trigger or a line (`act ext.<id>.run line=`, a handler line); `null` for a key, the power bar, `@name` and an MCP run, even when `this` exists. | `packages/outliner/src/script-runtime.ts:26` |
| `props` | The slots, **every key a list of strings**: `week=42` is `props.week[0]`, an absent slot is `undefined`. A render line keeps repeats (`tag=a tag=b` is two values); every action run path gives one value per key. | `packages/outliner/src/script-runtime.ts:27` |
| `view` | The builders of [view.*](#view). | `packages/outliner/src/script-runtime.ts:49` |
| `tools` | The agent tools, `await tools.outline_read({ ref })`. See [tools.*](#tools). | `packages/outliner/src/script-runtime.ts:38` |
| `text(value)`, `console.log(...)` | Add a line to the run note's output (a non-string is JSON). A render ignores them: only the returned value is drawn. | `packages/outliner/src/script-runs.ts:263` |
| `exit()` | Ends the script successfully, keeping its output (the sandbox's own). | |

`text`, `console`, `exit`, `store`/`load` and `ALL_TOOLS` come from the QuickJS sandbox
(`@earendil-works/pi-codemode`, its README lists them); the rest of this page is the outline's own.

There is no `now` global. The clock is a path: `(await resolve("now.date")).values[0]`, or `new Date()` (the host's
clock, in UTC).

`this` is bound to the note inside the function body, so an arrow function keeps it and a `function () {}` loses it:
write `rows.map(x => this.title + x)`, not `rows.map(function (x) { return this.title })`.

## Functions

| Function | Returns | Source |
|---|---|---|
| `q(query, { under?, limit? })` | `{ blocks: [{ id, title, revision, parentId, updated }], complete }`. `query` is the views' grammar (`type=ticket due <= +3d`, `parent:this`, `#tag`); `limit` 1 to 200, default 20; `under` is a ref. **Rows carry no properties**: read the row to get them. | `packages/outliner/src/host-api.ts:207` |
| `read(ref, { depth?, limit? })` | The note's [record](#record-shapes) plus `outline_read`'s `children` (`[{ id, text, revision }]`, to `depth`, default 1), `revision`, `complete`. `ref` is an id, `((id))`, `[[page]]` or a Work ID. | `packages/outliner/src/host-api.ts:212` |
| `resolve(path)` | What `{{ path }}` says here, through the one resolver: `{ path, values: string[], links?, lines?, route }`, or `{ path, problem: { message, didYouMean }, route }`. Never an empty string for a typo. `this.owner`, `props.week`, `now.date`, `((id)).crop`, `this.tasks \| status=todo`. | `packages/outliner/src/host-api.ts:221` |
| `act(name, args?)` | Dispatches a door action in the connected door (**only when the run started from a door**: `ep0ch ext act` and MCP answer "act needs a connected door") (`await act("tile.open", { kind: "query", query: "#beans" })`) and answers what it did. Needs `effects=write` and a door (run from the power bar or a live draft); a saved ask or rule has none. | `packages/outliner/src/host-api.ts:224` |
| `wait(ms)` | Sleeps, then goes on. Ends with the run: its deadline or a stop cuts it short. | `packages/outliner/src/script-runtime.ts:58` |

There is no `stop()` inside a script. Ending a run is the service's `scripts.stop` (see [Lifecycle](#lifecycle)).

Each host call (`q`, `read`, `resolve`, a tool) is a plain promise; start several and `await Promise.all` when they
don't depend on each other. A refused call throws an `Error` whose message says why; an argument error also shows a call that works.

## tools.*

One function per agent tool, the same list the Claude mod and the MCP gateway register
(`packages/outline-core/src/agent-tool-definitions.ts`), each argument-checked the way those surfaces check it. A wrong
call throws with the tool's arguments and an example. A read-only script that calls a **writes** tool throws "This
script is read-only; declare effects=write to write". `tools.nope(...)` is a
TypeError (there is no such function): `Object.keys(tools)` lists the ones there are.

<!-- generated:tools:start (written by packages/outliner/scripts/scripts-doc.ts; don't edit by hand) -->

| Tool | Effect | Arguments (**required**) | What it does | Source |
|---|---|---|---|---|
| `tools.outline_read` | reads | **ref**, depth, limit | Read the note `ref`: its full text (never just the title), `properties` (each key once with its `values`, as `find --json` gives them) and `fields`… | `packages/outline-core/src/agent-tool-definitions.ts:81` |
| `tools.outline_find` | reads | text, property, hasKey, query, view, under, limit, machinery | Find blocks (no `ref` needed) by text, a property (`key=value`, or `key`), a property key (hasKey), a query in the saved-view grammar… | `packages/outline-core/src/agent-tool-definitions.ts:103` |
| `tools.outline_resolve` | reads | **ref** | Resolve `ref` ([[page]], ((id)), a Work ID or an id) to its block id, title and revision, without reading the whole note. | `packages/outline-core/src/agent-tool-definitions.ts:130` |
| `tools.outline_site` | reads | **ref**, paths, draft, chain, props, line | Read what the note `ref`'s `{{ }}` placeholders say, and any `paths` you ask, the way the person's screen reads them (the outline's one resolver). | `packages/outline-core/src/agent-tool-definitions.ts:146` |
| `tools.outline_edit` | writes | **ref**, **expectedRevision**, text, replaceSection, append, allowStructural | Rewrite the note `ref`, checked against the revision you read with outline_read: its whole `text`, one `replaceSection` (the text under a heading,… | `packages/outline-core/src/agent-tool-definitions.ts:183` |
| `tools.outline_create` | writes | **parent**, **text**, position | Create a block under `parent` (a ref, or root), at `position` among its siblings (0 is first; default last). | `packages/outline-core/src/agent-tool-definitions.ts:223` |
| `tools.outline_comment` | writes | **ref**, body, quote, whole, start, near, kind, properties, prefix, suffix, requestId, from, revision | Start a comment thread on the note `ref`, as you: on an exact `quote` of its source text (add start, near, prefix or suffix when the quote repeats),… | `packages/outline-core/src/agent-tool-definitions.ts:243` |
| `tools.outline_reply` | writes | thread, **body**, requestId, edit, observed | Reply in a comment thread, as you. | `packages/outline-core/src/agent-tool-definitions.ts:278` |
| `tools.outline_resolve_thread` | writes | **thread**, **resolved** | Resolve a comment thread (resolved: true), or reopen it (false), as you. | `packages/outline-core/src/agent-tool-definitions.ts:297` |
| `tools.view_order` | writes | **ref**, ids | Read or set the hand-set order of the view `ref` (a view with no [sort::] is ordered by hand: the order its board lanes, figures and Tree show). | `packages/outline-core/src/agent-tool-definitions.ts:310` |
| `tools.outline_changes` | reads | **since**, author, actor, limit, before, machinery | What changed since a point: an ISO time, or the `cursor` an earlier call returned. | `packages/outline-core/src/agent-tool-definitions.ts:333` |
| `tools.outline_patch` | writes | **ref**, **revision**, **patches**, mark, policy, allowStructural | Small edits to the note `ref` the person may be typing in, without waiting for their save (draft.patch); for rewriting your own pages, such as a… | `packages/outline-core/src/agent-tool-definitions.ts:357` |
| `tools.outline_proposal_apply` | writes | **ref** | Apply draft proposal the note `ref` by id, without a reader, under the agent's normal patch comparison and policy. | `packages/outline-core/src/agent-tool-definitions.ts:410` |
| `tools.outline_proposal_dismiss` | writes | **ref** | Dismiss your own draft proposal the note `ref` by id, without a reader: mark it dismissed and put it in Trash. | `packages/outline-core/src/agent-tool-definitions.ts:410` |
| `tools.outline_set_property` | writes | **ref**, **key**, **value**, **revision** | Set one [key::value] property on the header line of the note `ref` (the chips that end its first line): the value replaced where the key is, or the… | `packages/outline-core/src/agent-tool-definitions.ts:426` |
| `tools.outline_assign_id` | writes | **ref**, **revision** | Give the note `ref` the outline's next work id (outliner work-id-allocate), against the `revision` outline_read returned: the id is stamped on the… | `packages/outline-core/src/agent-tool-definitions.ts:450` |
| `tools.outline_move` | writes | **ref**, parent, before, after, position, **revision** | Move the note `ref` (with what is under it) to a new place: under `parent` (a ref, or `root`) at `position` among its children (0 is first; default… | `packages/outline-core/src/agent-tool-definitions.ts:469` |
| `tools.outline_trash` | writes | **ref**, **revision** | Put the note `ref` in Trash, with what is under it, against the `revision` outline_read returned: a note that changed since is refused and stays. | `packages/outline-core/src/agent-tool-definitions.ts:500` |
| `tools.outline_restore` | writes | **ref** | Bring the note `ref` back from Trash, with what went under it, to where it was. | `packages/outline-core/src/agent-tool-definitions.ts:518` |

<!-- generated:tools:end -->

| Entry | Source |
|---|---|
| `hostApi` | `packages/outliner/src/host-api.ts:184` |
| `AGENT_TOOL_DEFINITIONS` | `packages/outline-core/src/agent-tool-definitions.ts:79` |
| `AGENT_TOOL_SURFACES` | `packages/outline-core/src/agent-tool-definitions.ts:560` |

## view.*

`view.<type>(fields)` returns `{ ...fields, type }`: a plain object, checked when it is drawn. Return one from a render
script (or put several in a `stack`, `row`, `box` or `card`) and every client draws it with the primitive it already
has. The tone is one of `default`, `good`, `warn`, `bad`, `dim`, `accent`.

<!-- generated:view:start (written by packages/outliner/scripts/scripts-doc.ts; don't edit by hand) -->

| Builder | Fields (anything else is refused) | Source |
|---|---|---|
| `view.text` | `text`, `tone`, `strong`, `act` | `packages/outliner/src/component-primitives.ts:205` |
| `view.blockdown` | `text` | `packages/outliner/src/component-primitives.ts:210` |
| `view.badge` | `label`, `tone`, `act` | `packages/outliner/src/component-primitives.ts:213` |
| `view.stat` | `label`, `value`, `unit`, `tone` | `packages/outliner/src/component-primitives.ts:220` |
| `view.bar` | `label`, `value`, `max`, `tone` | `packages/outliner/src/component-primitives.ts:227` |
| `view.table` | `columns`, `rows`, `links`, `acts` | `packages/outliner/src/component-primitives.ts:234` |
| `view.checklist` | `items` | `packages/outliner/src/component-primitives.ts:260` |
| `view.sparkline` | `label`, `values` | `packages/outliner/src/component-primitives.ts:271` |
| `view.card` | `title`, `subtitle`, `badge`, `link`, `act`, `children` | `packages/outliner/src/component-primitives.ts:277` |
| `view.box` | `title`, `children` | `packages/outliner/src/component-primitives.ts:295` |
| `view.stack` | `children` | `packages/outliner/src/component-primitives.ts:298` |
| `view.row` | `children`, `minWidth` | `packages/outliner/src/component-primitives.ts:301` |
| `view.band` | `text`, `level`, `style`, `pattern`, `align`, `row`, `tone` | `packages/outliner/src/component-primitives.ts:306` |
| `view.track` | `style`, `pattern`, `tone` | `packages/outliner/src/component-primitives.ts:322` |
| `view.image` | `src`, `alt`, `size`, `fit`, `height`, `caption` | `packages/outliner/src/component-primitives.ts:329` |
| `view.button` | `label`, `act`, `tone` | `packages/outliner/src/component-primitives.ts:217` |

<!-- generated:view:end -->

What the fields mean:

- `text`: `text`, `tone?`, `strong?`, `act?`. `blockdown`: `text`, drawn by each client's note reader (headings, lists, links).
- `badge`: `label`, `tone?`, `act?`. `button`: `label`, `act`, `tone?`. `stat`: `label`, `value` (text or number), `unit?`, `tone?`. `bar`: `label`, `value`, `max` (> 0).
- `table`: `columns` (1 to 12 names), `rows` (up to 200, each as long as `columns`, cells text or numbers; `""` is a valid empty cell, a number is shown as written), `links?` (one per row:
  a block id, a `file:`/`web:`/`resource:` ref, or `null`; Enter or a click opens it), `acts?` (an action line per row or `null`, pressed in place of its link).
- `checklist`: `items: [{ label, done }]`. `sparkline`: `values` (1 to 200 numbers), `label?`.
- `card`: `title`, `subtitle?`, `badge?: { label, tone? }`, `link?`, `act?`, `children?`. `box`: `title?`, `children`. `stack`: `children`
  one under another. `row`: `children` side by side, stacked when narrower than `minWidth` (4 to 200, default 12 characters).
- `band`: a heading in glyph tracks (`text`, `level` 1 to 3, `style`, `pattern`, `align`, `row`, `tone`). `track`: one row of
  glyph track, a divider. `image`: `src` (a path or `file:` ref), `alt?`, `size?` (`24`, `50%`, `full`), `fit?`, `height?`, `caption?`.
- Limits: nested 8 deep, 400 nodes, 100 children per container, text up to 2,000 characters (`blockdown` 16,000).
  A field a primitive doesn't know is refused with the field's name.

#### Pressing a view

`act` is an **action line** (`ttt-play cell=5`, `layout.load name=review`: a script's name and its slots, or a door action).
In the door a click, or Enter on the element, runs it as the person through the door's one dispatcher, on the note the view
is drawn in (`this`); `act` runs the same line. The click is the consent, so there is no confirm, and what it does is
attributed and undoable (`ext.undo`, `layout.undo`). A script run that a press starts may move the person's tiles (the
press invites it); an agent's run of the same script may not move the tile the person is in. Any other client draws the
primitive's label without the line. In a note the same press is `::button{label="Review" act="layout.load name=review"}`,
`::button{label="Play" of=ttt-play cell=5}` or `[review](act: layout.load name=review)`. An agent presses one with `button.press label="Play"` (the door's action, through the same dispatcher; `n=` from `elements`).

| Entry | Source |
|---|---|
| `validatePrimitive` | `packages/outliner/src/component-primitives.ts:193` |
| `PRIMITIVE_TYPES` | `packages/outliner/src/component-primitives.ts:27` |
| `PRIMITIVE_FIELDS` | `packages/outliner/src/component-primitives.ts:28` |
| `MAX_NODES` | `packages/outliner/src/component-primitives.ts:121` |

## What a script returns

The returned value becomes text, the same way in a run note and a drawn line:

| Returned | Shown as | Source |
|---|---|---|
| `string` | as it is (Blockdown: a table, a list, a link all draw) | `packages/outliner/src/script-runs.ts:33` |
| `{ view }`, or one `view.x(…)` itself | the view, as Blockdown. **Any returned object with a `view` key is read as a view** (and refused when it isn't one): name your own keys otherwise | `packages/outliner/src/script-runs.ts:27` |
| `undefined` | nothing (a run note ends at the output lines) | `packages/outliner/src/script-runs.ts:264` |
| `JSON` (anything else) | JSON | `packages/outliner/src/script-runs.ts:37` |

## Record shapes

`this`, `self` and `read()` answer a note as a record (`packages/outline-core/src/block-record.ts`). The shapes the
examples lean on:

- `properties`: `[{ key, values: string[] }]`. A key appears once with all its values, in order. Look one up with
  `this.properties.find(p => p.key === "owner")?.values[0]`. There is no `properties.owner`.
- `fields`: `[{ key, value, scope: "line" | "inline", line, column, offset }]`: the properties that belong to one line or spot
  rather than to the whole note. A `[key::value]` chip or a `key:: value` line in a note is whole-note, so it is in
  `properties` and `fields` is usually `[]`. **`line` counts from 0.**
- `header`: `[{ key, value }]`, the chips on the first line, in order. `title`: the first line without its chips. `body`: the text without the chips. `text`: exactly as stored.
- `tasks`: `[{ status, text, line, id }]`. `children`: ids. `links`, `backlinks`, `resources`, `created`, `updated`, `author`, `revision`, `parent`.
- **`this` and `self` are text records**: `children`, `links`, `backlinks` and `resources` are empty (`truncated` lists
  links and resources). `read(this.id)` is the full record, and `q("parent:this")` lists the children.
- A `q` row is `{ id, title, revision, parentId, updated }`; a `read` child is `{ id, text, revision }`; `read()` itself
  returns `title`, `text`, `properties` and the rest of the record. **`q` rows come in no promised order** (an edited note
  came first in a check): sort them, or take outline order from `read(this.id).children`.
- **The host of a `name::` line is `this`**, so `q("parent:this")` lists that note's children, and `this.owner` is its owner.

| Entry | Source |
|---|---|
| `BlockRecord` | `packages/outline-core/src/block-record.ts:14` |
| `textRecord` | `packages/outliner/src/block-records.ts:35` |
| `ScriptSiteGlobals` | `packages/outliner/src/script-runtime.ts:11` |
| `bind` | `packages/outliner/src/script-runs.ts:85` |

## Modes

| Mode | Written | Runs | Draws or writes | Source |
|---|---|---|---|---|
| action | `[script::name]` | when asked: key, power bar, `/name slot=value`, `@name`, a rule's `[rule-on::script:name]` (also `-stop`, `-change`), `ext.<id>.run`, MCP `script_run` | a run note beside the source, plus whatever it writes | `packages/outliner/src/script-runs.ts:160` |
| render | `[script::name] [mode::render]` and a line `name:: week=42` | when a line asks, and again when what it read changes | the returned value, under the line; **no run note, no undo step, nothing written** | `packages/outliner/src/script-runs.ts:112` |
| `pipelineCalls` (the `::=` line) | `::= (await resolve("this.owner")).values[0]` | like a render script whose code is `return (expression);` | the value, under the line | `packages/outliner/src/extension-handlers.ts:150` |

**Render mode in detail.**

- A render script is read-only whatever else it says, and `[mode::render] [effects::write]` isn't served (the script is
  listed with why). It is drawn with a 15-second deadline unless `[deadline::]` says otherwise.
- The line's `week=42` words are `props`; two lines with different words are two drawings.
- **What a drawing depends on, and nothing else** (`ExtensionCalls.inputs`, and the reads the run records): the host
  note's text (first 16,000 characters), its direct children's ids and text (first 50 children, 2,000 characters each),
  any note named by `((id))` on the line itself (first 8), the script's own note (always, whether or not the code asks
  for `self`), and every note any answer the run received mentions: a `read()`'s record (its children, links, backlinks), a
  `q()`'s rows, a `resolve()`'s deps and links. All by revision, so editing any of them redraws. A `q()` without `under`
  also registers its query, so a new match redraws it. An answer too large to list marks the output untracked. A
  change made by another script or an extension doesn't redraw it, and the service remembers at most 5,000 watched
  queries and notes (the oldest are dropped).
- Drawing the same line again leaves every block and revision as it was.
- A `::=` line is the argument of the call, so its expression is at most 500 characters.

**Action mode in detail.** The run is described in [Lifecycle](#lifecycle).

| Entry | Source |
|---|---|
| `slotProps` | `packages/outliner/src/script-runs.ts:40` |
| `scriptRender` (the one producer path of every handler line) | `packages/outliner/src/extension-calls.ts:804` |
| `DEFAULT_DEADLINE_MS` | `packages/outliner/src/extension-manifest.ts:417` |

## Effects, access and attribution

- **Effects.** A script is read-only unless the note says `[effects::write]` (a file: `// ep0ch-script effects=write`).
  Read-only means the write tools and `act` refuse; reads, `q`, `read`, `resolve` and `wait` work.
- **Who wrote it.** Every write is `author: agent` with the actor id `script:<name>`, the run's undo id as the session, and
  the task id `trigger:script:<extension id>`. Whoever asked is recorded as `requestedBy` (the person at their keyboard,
  or the agent that ran `script_run`). The run note's second line says both.
- **Outside agents** run a script with the MCP tool `script_run` (`ref` or `uri` of the script's note). It runs as
  `script:<name>` with the caller as `requestedBy`, and has no `this`, no `props` and no `act` (no note, no slots, no door).
  The run is capped by the outline's MCP access level: `propose` turns each write into a proposal, `full` applies it,
  `none` and `read` can't start a run. `script_run` appears only when the gateway registers write tools.
- **Yolo** (the person's switch, `agents.yolo`): while it is on the MCP access level reads as `full`, so the outline answers `full`
  (a `script_run` is still capped by the level its own request carries), and every agent request, a script's included, carries `via:yolo` on its task id.
  A script's authorship doesn't change: it is still `script:<name>`.
- **Undo.** The run answers an undo id (the receipt); `extensions.undo` with it takes back the saved writes, door
  actions and live-draft patches together, and a conflict with typing since refuses the undo. Receipts last as long as
  the host process does.

| Entry | Source |
|---|---|
| `actor` (who a script's writes belong to) | `packages/outliner/src/script-runs.ts:161` |
| `script_run` (the gateway tool) | `packages/door/src/mcp.ts:714` |
| `scripts.run` (the service request, capped by the access level) | `packages/outliner/src/server.ts:1928` |
| `mcpAccess` (a script's write, by access level) | `packages/outliner/src/host-api.ts:137` |
| `mcpAccess` (yolo reads as full) | `packages/outliner/src/server.ts:4185` |
| `viaYolo` | `packages/outliner/src/server.ts:4208` |
| `inverse` (the undo's draft part) | `packages/outliner/src/script-runs.ts:279` |

## Lifecycle

1. **Start.** A run returns at once with its run note (`<name> · working [script-run::<undo id>] [machine::script]`, a
   child of the script's note) and the undo id. Machinery: a run note counts for no backlink.
2. **Progress.** Each finished tool call appends a line `N. tool: result` to the run note (`q` and `read` log their `outline_find` and `outline_read`; `resolve`, `act` and `wait` log nothing). `text()` and `console.log` lines
   come after the calls; the returned value is last. The first line becomes `· done` or `· failed`.
3. **Deadline.** Default 5 minutes (the maximum), or `[deadline::2m]`. A render drawing defaults to 15 seconds.
   A run past it fails with "The script ran past its deadline (Ns)".
4. **Stop.** `scripts.stop` with the run's undo id (`script.stop run=<undo id>` in the door) ends one run; its next call
   is refused and the note says "Stopped by <who>". `{ stopped: false }` when it isn't running.
5. **Edits.** Changing the script's **code** while it runs ends it ("The script source changed; run its saved revision
   again"). The check is made at the run's next host call, not at the edit. A script that writes into its own note goes on: only the fence counts. At the end, a changed script setting (its stamp) discards the output ("The script source changed during this run").
6. **End.** The run's undo is prepared; "Undo unavailable: why" is added when it can't be.

| Entry | Source |
|---|---|
| `ScriptRuns.start` | `packages/outliner/src/script-runs.ts:158` |
| `setTimeout` (the deadline timer) | `packages/outliner/src/script-runs.ts:170` |
| `stopRun` | `packages/outliner/src/script-runs.ts:151` |
| `The script source changed` (during a run) | `packages/outliner/src/script-runs.ts:220` |
| `scripts.stop` | `packages/outliner/src/server.ts:1919` |
| `scripts.stop` request | `packages/outliner/src/types.ts:2459` |

## Traps

Each of these cost someone an hour.

- **`this.children` is empty.** `this` and `self` are text records. List children with `q("parent:this")` or
  `read(this.id)`. The same for `links` and `backlinks`.
- **A `q` row has no properties.** `(await q("parent:this")).blocks[0].qty` is `undefined`: `read(row.id)` and look in `properties`.
- **Properties are `[{ key, values }]`, not an object**, and `props.x` is a list: `props.week[0]`, not `props.week`.
- **`line` counts from 0**, in `fields[].line`, `tasks[].line`, `caller.line` and a handler line's index. The first line of a
  note is line 0, the header chips' line.
- **A render script redraws for what it read, not for what it could have** (the list under *Render mode*). `this`
  and `self` are snapshots taken when the line is drawn, and `this.children` is always empty: use `q("parent:this")` or
  `read(this.id)`. A note the script never touched, by any answer, doesn't redraw it.
- **`ep0ch show` doesn't draw a handler line.** A note with `hello::` prints `hello::` and nothing under it (a test checks it);
  the door opens the note and asks for the drawing, and so do Detail and the publisher. To see what a line drew from a
  test, ask the service (`resources.projection.read` with `materialize: true`) and read the output store, as the tests here do.
- **`ext.<id>.run` on a render script runs it as an action** (with a run note), instead of refreshing its line. To draw a
  line again, `projection.refresh` (the door's `r` on the note).
- **`[mode::render]` with `[effects::write]` isn't served.** Split it: a render script to show, an action script to do.
- **A render drawing can't `act` or write**, and never could: its refusal reads "This script is read-only".
- **`text()` and `console.log` are for run notes.** A render shows only what it returns.
- **`function () { this }` loses `this`.** Use arrows.
- **Saving a script that fails to load is allowed.** `ep0ch ext ls` is where the error shows; the note itself is fine.
- **Files need the opt-in line** (`// ep0ch-script` first) and live under `.ep0ch/scripts/`; the old `scripts/` folder is ignored.

## Worked examples

Each example is the notes to paste (the fences marked `note`; `parent=` nests one under another), and what it draws. The
showcase seeds all of them (`ep0ch --showcase`, the *script examples* section), and `test/scripts-docs.test.ts` creates
each from this page, draws or runs it and compares the result to the "shows" block under it.

#### Example 1: A note that reads its own properties into a sentence

A render script, a note with properties, and a line that asks. `this.properties` is the record's list of
`{ key, values }`; `props.week` is a list.

````note ex1-script
Sow sentence [script::sow-sentence] [mode::render]
```js
const get = key => (this.properties.find(p => p.key === key)?.values ?? []).join(", ");
return `${get("owner")} sows ${get("crop")} in week ${props.week?.[0] ?? "?"}.`;
```
````

````note ex1-bed
Bed 4 [owner::Sam] [crop::beans]
sow-sentence:: week=12
````

````shows ex1
Sam sows beans in week 12.
````

The same in one line, with no script note: `::= (await resolve("this.owner")).values[0] + " sows " + (await resolve("this.crop")).values[0]`.

#### Example 2: A table of this note's children, with a computed column

A render script reads the children of the note it sits in, one `read` each, and computes `Qty * Price`. Edit a quantity,
add a child or remove one and the table draws again. The last row is a total; `links` makes each row open its note.

````note ex2-script
Seed table [script::seed-table] [mode::render]
```js
const host = await read(this.id, { depth: 1 });
const rows = [], links = [];
let total = 0;
for (const child of host.children) {
  const note = await read(child.id);
  const number = key => Number(note.properties.find(p => p.key === key)?.values[0] ?? 0);
  const cost = number("qty") * number("price");
  total += cost;
  rows.push([note.title, number("qty"), number("price"), cost]);
  links.push(child.id);
}
rows.push(["Total", "", "", total]);
links.push(null);
return view.table({ columns: ["Item", "Qty", "Price", "Cost"], rows, links });
```
````

````note ex2-order
Seed order
seed-table::
````

````note ex2-beans parent=ex2-order
Beans [qty::5] [price::2]
````

````note ex2-peas parent=ex2-order
Peas [qty::3] [price::4]
````

````shows ex2
| Item | Qty | Price | Cost |
| --- | --- | --- | --- |
| Beans | 5 | 2 | 10 |
| Peas | 3 | 4 | 12 |
| Total |  |  | 22 |
````

#### Example 3: Tic-tac-toe, with the board in a property

The state is one property, `[board::.........]` (nine cells, `.` empty), so it is a note like any other: a view can
query it, a person can edit it, undo takes a move back. A render script draws the board and says whose turn it is or
who won; an action script plays a cell.

Press a cell by running `ttt-play cell=5` from the power bar while the board is in front of you. (A view can also carry
the press itself: `view.badge({ label: "5", act: "ttt-play cell=5" })` is a square a click plays, see Pressing a view.)

````note ex3-draw
Tic-tac-toe board [script::ttt-draw] [mode::render]
```js
const board = this.properties.find(p => p.key === "board")?.values[0] ?? ".........";
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const won = lines.map(l => l.map(i => board[i]).join("")).find(s => s === "XXX" || s === "OOO");
const turn = [...board].filter(c => c === "X").length <= [...board].filter(c => c === "O").length ? "X" : "O";
const status = won ? `${won[0]} wins` : board.includes(".") ? `${turn} to play` : "a draw";
const cell = i => board[i] === "." ? String(i + 1) : board[i];
const rows = [0, 3, 6].map(r => [cell(r), cell(r + 1), cell(r + 2)]);
return view.stack({ children: [view.table({ columns: ["A", "B", "C"], rows }), view.text({ text: status, strong: true })] });
```
````

````note ex3-play
Tic-tac-toe move [script::ttt-play] [effects::write]
```js
const board = this.properties.find(p => p.key === "board")?.values[0] ?? ".........";
const cell = Number(props.cell?.[0]);
if (!(cell >= 1 && cell <= 9)) throw new Error("cell=1 to 9");
if (board[cell - 1] !== ".") throw new Error(`cell ${cell} is taken`);
const turn = [...board].filter(c => c === "X").length <= [...board].filter(c => c === "O").length ? "X" : "O";
const me = await read(this.id);
await tools.outline_set_property({ ref: this.id, key: "board", value: board.slice(0, cell - 1) + turn + board.slice(cell), revision: me.revision });
return `${turn} played ${cell}`;
```
````

````note ex3-game
Game 1 [board::.........]
ttt-draw::
````

````shows ex3
| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |
| 7 | 8 | 9 |

**X to play**
````

#### Example 4: A template stamped on every match

A rule note fires a write script on every note that starts matching a tag; the script stamps a checklist under it,
written from a template in the script. The rule's `[rule-batch::]` and `[rule-cap::]` keep a mistake from stamping a hundred notes.

````note ex4-script
Ship checklist [script::ship-checklist] [effects::write]
```js
const items = ["Pack", "Label", "Hand over"];
await tools.outline_create({ parent: this.id, text: `Ship list for ${this.title}\n${items.map(item => `- [ ] ${item}`).join("\n")}` });
return `stamped ${this.title}`;
```
````

````note ex4-rule
Ship rule [rule-name::ship-checklist] [rule-match::#shipit] [rule-on::script:ship-checklist] [rule-cap::20/day]
````

````note ex4-match
Beans for the swap #shipit
````

````shows ex4
Ship list for Beans for the swap
- [ ] Pack
- [ ] Label
- [ ] Hand over
````

#### Example 5: List the children with a query, read their properties

The same table by the other route: `q("parent:this")` lists the children (the host of the line is `this`), a `q` row has no
properties so each row is read, and the rows are sorted because `q` promises no order. The reads run side by side.

````note ex5-script
Cost list [script::cost-list] [mode::render]
```js
const kids = (await q("parent:this", { limit: 200 })).blocks.sort((a, b) => a.title.localeCompare(b.title));
const notes = await Promise.all(kids.map(kid => read(kid.id)));
const number = (note, key) => Number(note.properties.find(p => p.key === key)?.values[0] ?? 0);
const rows = notes.map(note => [note.title, number(note, "qty"), number(note, "price"), number(note, "qty") * number(note, "price")]);
rows.push(["Total", "", "", rows.reduce((sum, row) => sum + row[3], 0)]);
return view.table({ columns: ["Item", "Qty", "Price", "Cost"], rows });
```
````

````note ex5-host
Cost list order
cost-list::
````

````note ex5-peas parent=ex5-host
Peas [qty::3] [price::4]
````

````note ex5-beans parent=ex5-host
Beans [qty::5] [price::2]
````

````shows ex5
| Item | Qty | Price | Cost |
| --- | --- | --- | --- |
| Beans | 5 | 2 | 10 |
| Peas | 3 | 4 | 12 |
| Total |  |  | 22 |
````

#### Fantasia: a button, a transaction, motion, undo (needs a door)

`::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 motion=fantasia stay=1}` in a note (`stay=1` leaves the tiles where they danced, so `layout.undo` has something to take back; without it the script undoes itself at the end), and this script as `[script::fantasia] [effects::write]`.
It is the acceptance test of the self-reference wave: one click runs the whole chain. It needs several tiles the person isn't holding to show anything, and unlike examples 1 to 5 it needs a connected door (it moves tiles), so it is not pasted by the scripts-docs test; the showcase's *fantasia* section runs it live.

```js
const beats = Math.max(1, Math.min(12, Number(props.beats && props.beats[0]) || 4));
const tempo = Math.max(150, Math.min(3000, Number(props.tempo && props.tempo[0]) || 500));
const style = (props.motion && props.motion[0]) || 'fantasia';
const home = (props.layout && props.layout[0]) || '';
const stay = !!(props.stay && props.stay[0]);
const before = await act('layout.get');
if (before.locked) return 'fantasia: the screen is locked; alt+k unlocks it, then run again';
const dancers = (before.tiles || []).filter(t => t.shown && t.kind !== 'drawer.own').map(t => ({ id: t.id, name: t.name }));
const notes = [], floated = [];
for (const d of dancers) {
  try { const r = await act('tile.float', { tile: d.id, on: true, motion: style }); floated.push({ id: r && r.now && r.now !== d.name ? r.now : d.id, name: d.name }); }
  catch (e) { notes.push(d.name + ' stayed put: ' + (e && e.message || e)); }
}
if (!floated.length) return 'fantasia: no tile would float. ' + notes.join('; ');
const drift = [[7, -2], [-5, 3], [6, 2], [-8, -3], [4, 4], [-4, -4], [9, 1], [-6, 2]];
for (let beat = 0; beat < beats; beat++) {
  for (let i = 0; i < floated.length; i++) {
    const [dx, dy] = drift[(beat + i * 3) % drift.length];
    try { await act('float.place', { tile: floated[i].id, dx: i % 2 ? -dx : dx, dy, motion: style }); }
    catch (e) { notes.push('beat ' + (beat + 1) + ', ' + floated[i].name + ': ' + (e && e.message || e)); }
  }
  await wait(tempo);
}
let settled = '';
if (stay) settled = 'and left where they danced (layout.undo puts them back)';
if (!settled && home) {
  try { await act('layout.load', { name: home, motion: 'settle' }); settled = 'into the screen ' + home; }
  catch (e) { notes.push('layout.load ' + home + ': ' + (e && e.message || e)); }
}
if (!settled) {
  // No layout asked: the run's own changes are taken back, so the screen is as it began.
  try { await act('layout.undo'); settled = 'the layout as it began'; } catch (e) { notes.push('layout.undo: ' + (e && e.message || e)); }
}
if (!settled) settled = 'left where they danced (layout.undo, or ctrl+z, puts them back)';
return 'fantasia: ' + floated.length + ' tile' + (floated.length === 1 ? '' : 's') + ' danced ' + beats + ' beat' + (beats === 1 ? '' : 's') + ' at ' + tempo + ' ms, ' + settled + (notes.length ? '\nnotes: ' + notes.join('; ') : '');
```

What happens, step by step:

1. **The note.** The door reads `::button{…}` (outline-core `button-call.ts`) and draws a chip; `of=` names a script and every other word is a slot, so the press is the action line `fantasia beats="3" tempo="450" motion="fantasia"`.
2. **The press.** A click, or ⏎ on the chip, runs the line through the door's one dispatcher as you. The script is resolved to its `ext.<id>.run`; `motion=` on a press becomes the script's `props.motion`. Because you pressed, the door mints a one-run invitation (shape, screen): the run may move the tile you are in; it never reaches a draft's text.
3. **The run.** The service starts the run (`requestedBy` you, the button's author recorded on its note). Every `act()` goes back to your door as `script:fantasia` on your behalf, carrying the run's id as `txn=` and the invitation, so the run's layout changes are **one transaction**.
4. **The dance.** `layout.get` lists the tiles; each shown tile but the drawer's is floated (`tile.float on=true`, so a tile already floating isn't toggled back) and nudged (`float.place`) a few beats with `motion: "fantasia"`. The desk draws each change as movement (`motion.set` caps it: calm is a short plain glide, off snaps). A refusal (a locked screen, the tile somebody types in) is caught per tile and said at the end; a locked screen refuses up front.
5. **The settle.** `layout=<screen>` loads that screen. With none, the run takes its own changes back (`layout.undo`, which inside a run is the run's transaction), so the screen is as it began; where that is refused (an uninvited run on a screen the person holds) it leaves the tiles where they danced and says so, and `layout.undo` puts them back. `stay=1` does the same by choice, a scene to undo.
6. **The close.** The run note ends with `fantasia: 3 tiles danced 3 beats at 450 ms, the layout as it began`, and the status bar says once how many layout changes the run made and that ctrl+z puts them back.

Paths:

- **An agent's run** (`act ext.<id>.run block=<the note> beats=3`) is the same script on the same path, attributed to the agent (`onBehalfOf` it, `layout.undo` by it works on its own run), but with no press there is no invitation: the tile the person's keys are on is refused and left docked, and said in the run note.
- **Stop**: **Esc** (or a click on "■ stop the dance" in the status bar) while the screen is dancing (the status bar says so when it starts), or `layout.stop` / `script.stop run=<id>`: the run ends, the service says `scripts.ended`, the door's end rule puts the layout back (as far as nobody changed it since) and says so. Floats never stay strewn.
- **Undo** (`layout.undo`, ctrl+z, or `ext.undo` for the run's writes and layout together; a run with `stay=1` or `layout=` leaves something to undo): the whole run is taken back, newest step first; it is refused over a change somebody else made since ("undo that first").
- **By hand**, with no script: `door_act tile.float tile=… on=true txn=g1 motion=fantasia` per tile, `door_act layout.load name=… txn=g1`, then `door_act layout.txn.end txn=g1`. `txn=` and `motion=` are the dispatcher's own arguments, open to every actor.

Try it: `ep0ch --showcase`, `act section name=fantasia`.

## Source map

| Concern | Where |
|---|---|
| The sandbox, its globals, `view`, `wait` | `packages/outliner/src/script-runtime.ts` |
| `q`, `read`, `resolve`, `act`, `tools` (the host API) | `packages/outliner/src/host-api.ts` |
| Runs, render, stop, the Site binding, run notes | `packages/outliner/src/script-runs.ts` |
| Finding scripts: fences, properties, files | `packages/outliner/src/script-sources.ts` |
| Handler lines and `::=` | `packages/outliner/src/extension-handlers.ts` |
| One producer path of every handler line | `packages/outliner/src/extension-calls.ts` |
| The primitives behind `view.*` | `packages/outliner/src/component-primitives.ts` |
| The tool list | `packages/outline-core/src/agent-tool-definitions.ts` |
| The Site (`this`, `self`, `caller`, `props`) as a type | `packages/outline-core/src/site.ts` |
| Records | `packages/outline-core/src/block-record.ts`, `packages/outliner/src/block-records.ts` |
| Tests that pin it | `packages/outliner/test/script-site.test.ts`, `host-api.test.ts`, `scripts-docs.test.ts` |
| Showcase | `ep0ch --showcase`, sections *scripts*, *scripts in place* and *script examples* |
