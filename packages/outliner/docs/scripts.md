# Scripts in a note: the surface

A script is a named fence in any note (`js script=name`), or a note with `[script::name]` and a code fence. It runs in the outline host, in a sandbox, and sees the
note it is about, a few functions, the agent tools and a set of view builders. This page is the whole surface, written
from the code on main: every entry ends in a pointer (`path:line`) to the source, and `test/scripts-docs.test.ts` fails
when the tool list or a view's fields drift, or when a pointer's symbol is gone (a line that only moved is not drift). Read the source when a detail here isn't enough; the pointer
is where to start.

Everything below was checked against a scratch outline. Where this page and the code disagree, the code wins: fix the
page (`bun packages/outliner/scripts/scripts-doc.ts` rewrites the generated tables and every pointer's line from the symbol it sits beside).

- [A script in one minute](#a-script-in-one-minute)
- [The script note](#the-script-note) · [Globals](#globals) · [Functions](#functions) · [tools.*](#tools) · [view.*](#view)
- [What a script returns](#what-a-script-returns) · [Record shapes](#record-shapes)
- [Modes](#modes) · [Effects, access and attribution](#effects-access-and-attribution) · [Lifecycle](#lifecycle)
- [Traps](#traps) · [Worked examples](#worked-examples) · [Source map](#source-map)

Other pages: the extensions README has the four extension kinds and where a script sits among them
([Script blocks and files](extensions/README.md#script-blocks-and-files-pie-601)); the `ep0ch-outline` skill says when
to reach for one while working in an outline.

## A script in one minute

Write the script next to the button that runs it:

````blockdown
My workbench
```js script=hello
return `This note is ${this.title}.`;
```
::button{label="Say hello" of=hello}
````

A press runs `hello` with this note as `this`. Two named fences in one note are two scripts. Move the fence into
another note and the button still finds `hello` by name; adding `[script::hello]` to that note does not register it twice.
A button resolves this note's fences first, then the Site's nearest ancestors, then the outline's note and file scripts.
When names repeat, `ep0ch ext ls` lists both locations and which runs first. The fence header has a run chip and names
its buttons. Completion after `js ` offers `script=`; `of=` offers this note's scripts first.

Add `mode=render` to draw the return value under a `hello::` line and redraw when a note it read changes.
Render scripts draw and have only read functions. Action scripts (buttons, `of=`, keys and rules) have the person's reach even with `effects=read`. Use `effects=write` to describe an action script that writes. The note form below uses `[mode::render]` and `[effects::write]`.

Use a script for a small thing that belongs to one note or one outline: a computed column, a sentence from properties,
a stamp on every match. Use an extension (a folder) when you need disk, network, a secret, or another language.

On a published page, render scripts run through `site.answer` with the reader's visibility cut. Query and saved-view
counts include only visible matches, before the requested limit is applied. Child reads and recent changes apply the
same cut before their limits: `complete` and child `more` describe visible notes only. A direct read of a hidden note still draws
“hidden here”. Script lines in an embed or a `::use` draw through the same handler path. The page's drawing does not
replace the output stored for the outline's readers. A script whose own note is not visible draws “not shared”,
like an embed: `self` is content too. Hidden parent references in `this.parent`, `self.parent`, query rows' `parentId`
and read records are `null`; checking them still records a dependency for the page's visibility cut.

A button body composes scripts and actions. Plain lines use the `actions` fence grammar; a `((name))` line runs
that script in the button's Site. Each script sees the last return as `input`. Acts are tap: their answer appears in
Sources and the previous value continues. A script returning nothing replaces the value with `undefined` (Sources
says "returned nothing"). `act=["action one", "action two"]` and `of=[first, second]` are one-line sugar for the
same steps. A press is one undo group, stops at its first failure, and reports completed steps and remaining effects.
Only a `::button{...}` without `act=` or `of=` has a body: its steps begin on the next line and close with `::` before any blank line.
Script steps keep their own slots (`((fold tile=links))` fills `{{props.tile}}` in an `actions` fence).
A render script stays read-only as a step and can pass its return to the next step.
Each press has its own run-id undo group. Undo refuses an older group while a later group's layout changes remain, even for the same button.
The kitchen sink's **One button, two tiles** demonstrates both forms. Disk/network effects remain after undo.

**Buttons that ask.** A `{key}` in `act=` (or in an `of=` script's values) is filled from the word `key=` on the same line:
`::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}`. Left empty, a person's press asks for it in the
kind the action's own argument takes (a tile: click one in the door), writes the answer on the line (`target=t-…`, an identity
address of the tile grammar, never a name or a number) and runs nothing: the next press runs it. alt+click asks again. An agent is never asked: it writes the
value with `button.slot label="pop it" key=target value=<tile>`. A button whose line reads differently than it was written
(nested quotes that end `act=` early, stray words) runs nothing and says the line to write, in the editor as you type and on save.

## The script note

A named fence accepts `script=<name>`, `effects=write` and `mode=render` in its info string, for example
`js script=week-sentence mode=render`. The language may also be `javascript`, `ts`, `typescript` or `actions`.
An `actions script=name` fence runs the same action-line format as an `actions` fence in a script note.
A named fence is its own script, with its own effects: `script=x` and `effects=` on the fence decide x's effects; absent `effects=`, its description is `read`. An ordinary note's `[effects::]` does not pass down. The one exception is a matching script note (`[script::x]` with `script=x`): the fence's `effects=` wins when written, otherwise the note's `[effects::]` applies. Other fence settings also override a matching script note's settings. Other notes' properties do not configure their fences. An unclosed fence saves as written and runs no code.

A note's `[script::y]` script is its first eligible fence with no `script=` name, or the fence named `y`. A fence named something else is never also the note's script. If there is no unnamed or matching fence, the note script has no code:


| Part | Written | Means | Source |
|---|---|---|---|
| `script` | `[script::name]` | The script's name: its power-bar name, its `name::` handler line, its `@name` responder (an `@name` responder only when it starts with a lower-case letter and is lower case, digits and hyphens, up to 32). | `packages/outliner/src/script-sources.ts:50` |
| the fence | a closed `js` or `ts` fence | The matching named fence, or the first unnamed `js`, `javascript`, `ts`, `typescript` or `actions` fence, is the code. TypeScript is stripped, not type-checked. For the note form, only that fence counts; if it is unclosed the script is empty (nothing runs, nothing is refused). | `packages/outliner/src/script-sources.ts:50` |
| `mode` | `[mode::render]` | A handler: a line `name::` draws what the script returns. See [Modes](#modes). | `packages/outliner/src/script-sources.ts:71` |
| `effects` | `[effects::write]` | Describes writes to readers and the restart replay rule. Absent: `read`. | `packages/outliner/src/script-sources.ts:44` |
| `deadline` | `[deadline::30s]` | When the run is cut short: `s`, `m` or `h`. Longer than `5m` is clamped to 5 minutes, not refused; a malformed value is ignored. Defaults: 5 minutes for a run, 15 seconds for a render drawing. | `packages/outliner/src/script-sources.ts:98` |
| `keys` | `[keys::alt+S]` | Binds keys (several separated by commas). | `packages/outliner/src/script-sources.ts:106` |

Other ways a script exists: a file `<outline folder>/.ep0ch/scripts/name.js` or `.ts` whose first line is
`// ep0ch-script` (settings after it: `effects=write`, `mode=render`, as in `// ep0ch-script mode=render`); an `actions` fence, which is one door action per line rather
than JavaScript (`packages/outline-core/src/action-line.ts`). Saving a malformed script still saves the note; `ep0ch ext ls`
says why it isn't served.

A script's arguments are `slot=value` words (`week=42`). The power bar offers the slots a js script reads as
`props.name`: `propsUsed` finds them in the code.

| Entry | Source |
|---|---|
| `scriptFence` | `packages/outliner/src/script-sources.ts:37` |
| `propsUsed` | `packages/outliner/src/script-sources.ts:51` |
| `MAX_DEADLINE_MS` | `packages/outliner/src/extension-manifest.ts:430` |

**Script IDs:** a note's `[script::name]` is its power-bar and handler name; the action uses `ext.<id>.run`.
**Find the action:** `ep0ch ext ls --ws <ws>` lists each name and ID; a script ID is `script-` plus the first 24 SHA-256 hex characters of its identity (note ID or file path), not its name.
**Example:** copy the ID beside `weekly`, then `ep0ch act ext.<id>.run block=<note-id> --as <actor>`.

## Installable layout script: neat

[neat's worked example](../extensions/neat/README.md) follows a complete layout script:
`props.page` and `read`, tile ids from `layout.get`, the shared layout actions,
drawer links and their wires, and the `step`/`failed` pattern for reporting refusals.
Install it from the power bar (ctrl+k, `&neat`, pick **install Neat**) or
`ep0ch act extensions.install id=neat`. Then try `::button{label="neat" of=neat page=[[Garden plan]] page=[[Shed repairs]]}`.
Without slots it arranges this outline's welcome/home and the reader with the person's keys.

Script lookup uses the invoking note and its nearest ancestors first, then other outline
script notes, outline files, then the scripts declared by installed extensions. An outline's
`[script::neat]` therefore overrides the installed `neat`. Each extension's manifest lists
`{ name, file, about }` in `scripts`; the folder reader checks that each file exists and opts in.
Uninstalling or disabling an extension removes its scripts; a button naming one says how to install the extension.
Extension script files opt in with the same `// ep0ch-script` header as outline files;
`effects=write` permits actions, and `mode=render` makes the file a render script (its `name::` lines draw what it
returns, as a note's `[mode::render]` does) that updates with `ep0ch install --apply`; a note with the same `[script::name]` still wins. They run through the same runtime and source-change checks.

## Globals

The code is the body of an async function: `await` and `return` work at the top. These names exist; nothing else does
(no `fetch`, timers, `process`, `require` or imports; disk and network belong to extensions).

| Global | Is | Source |
|---|---|---|
| `this` | The note the run is about, as a record (see [Record shapes](#record-shapes)). A rule-fired script gets the matched note; a key or power-bar run, the note in front of the person; `act ext.<id>.run block=<id>` names one. With none, every read of `this.x` throws "this run has no note; pass at= or run it from a note". Frozen (an assignment is ignored without an error). | `packages/outliner/src/script-runtime.ts:12` |
| `input` | The previous value in a button sequence; initially `undefined`. A script return replaces it, including `undefined`; action steps pass it through. | `packages/outliner/src/script-runtime.ts:12` |
| `self` | The note containing the script fence, as a record (`null` for a file script, which has no note). Frozen. | `packages/outliner/src/script-runtime.ts:25` |
| `caller` | `{ block, line? }`: where it was invoked (the matched note of a rule, the handler line of a render). Set only when a note is in play and the run came from a rule's trigger or a line (`act ext.<id>.run line=`, a handler line); `null` for a key, the power bar, `@name` and an MCP run, even when `this` exists. | `packages/outliner/src/script-runtime.ts:26` |
| `props` | The slots, **every key a list of strings**: `week=42` is `props.week[0]`, an absent slot is `undefined`. Render lines and `of=` buttons keep repeats (`tag=a tag=b` is two values); other action run paths give one value per key. | `packages/outliner/src/script-runtime.ts:27` |
| `view` | The builders of [view.*](#view). | `packages/outliner/src/script-runtime.ts:52` |
| `tools` | The agent tools, `await tools.outline_read({ ref })`. See [tools.*](#tools). | `packages/outliner/src/script-runtime.ts:38` |
| `text(value)`, `console.log(...)` | Keep a line as run-note output (a non-string is JSON). A render ignores them: only the returned value is drawn. | `packages/outliner/src/script-runs.ts:450` |
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
| `q(query, { under?, limit? })` | `{ blocks: [{ id, title, revision, parentId, created, updated }], complete }`. `query` is the views' grammar (`type=ticket due <= +3d`, `parent:this`, `#tag`); `limit` 1 to 200, default 20; `under` is a ref. **Rows carry no properties**: read the row to get them. | `packages/outliner/src/host-api.ts:222` |
| `read(ref, { depth?, limit? })` | The note's [record](#record-shapes) plus `outline_read`'s `children` (`[{ id, text, revision }]`, to `depth`, default 1), `revision`, `complete`. `ref` is an id, `((id))`, `[[page]]` or a Work ID. | `packages/outliner/src/host-api.ts:227` |
| `resolve(path)` | What `{{ path }}` says here, through the one resolver: `{ path, values: string[], links?, lines?, route }`, or `{ path, problem: { message, didYouMean }, route }`. Never an empty string for a typo. `this.owner`, `props.week`, `now.date`, `((id)).crop`, `this.tasks \| status=todo`. | `packages/outliner/src/host-api.ts:236` |
| `act(name, args?)` | Dispatches a door action in the connected door (**only when the run started from a door**: `ep0ch ext act` and MCP answer "act needs a connected door") (`await act("tile.open", { kind: "query", query: "#beans" })`) and answers what it did. Needs a door (run from the power bar or a live draft); a saved ask or rule has none. | `packages/outliner/src/host-api.ts:240` |
| `wait(ms)` | Sleeps, then goes on. Ends with the run: its deadline or a stop cuts it short. | `packages/outliner/src/script-runtime.ts:62` |

There is no `stop()` inside a script. Ending a run is the service's `scripts.stop` (see [Lifecycle](#lifecycle)).

Each host call (`q`, `read`, `resolve`, a tool) is a plain promise; start several and `await Promise.all` when they
don't depend on each other. A refused call throws an `Error` whose message says why; an argument error also shows a call that works.

## tools.*

One function per agent tool, the same list the Claude mod and the MCP gateway register
(`packages/outline-core/src/agent-tool-definitions.ts`), each argument-checked the way those surfaces check it. A wrong
call throws with the tool's arguments and an example. Effects do not restrict write tools. `tools.nope(...)` is a
TypeError (there is no such function): `Object.keys(tools)` lists the ones there are.

<!-- generated:tools:start (written by packages/outliner/scripts/scripts-doc.ts; don't edit by hand) -->

| Tool | Effect | Arguments (**required**) | What it does | Source |
|---|---|---|---|---|
| `tools.artifact_deploy` | writes | **repo**, domain | Deploy an ep0ch-artifacts repo, register it and update notes that name it. | `packages/outline-core/src/agent-tool-definitions.ts:121` |
| `tools.outline_read` | reads | **ref**, depth, limit | Read the note `ref`: its full text (never just the title), `properties` (each key once with its `values`, as `find --json` gives them) and `fields`… | `packages/outline-core/src/agent-tool-definitions.ts:127` |
| `tools.outline_find` | reads | text, property, hasKey, query, view, under, limit, propertyScope, machinery | Find blocks (no `ref` needed) by text, a property (`key=value`, or `key`), a property key (hasKey), a query in the saved-view grammar… | `packages/outline-core/src/agent-tool-definitions.ts:149` |
| `tools.outline_resolve` | reads | **ref** | Resolve `ref` ([[page]], ((id)), a Work ID or an id) to its block id, title and revision, without reading the whole note. | `packages/outline-core/src/agent-tool-definitions.ts:179` |
| `tools.outline_site` | reads | **ref**, paths, draft, chain, props, line | Read what the note `ref`'s `{{ }}` placeholders say, and any `paths` you ask, the way the person's screen reads them (the outline's one resolver). | `packages/outline-core/src/agent-tool-definitions.ts:195` |
| `tools.outline_edit` | writes | **ref**, **expectedRevision**, text, replaceSection, append, at, allowStructural | Rewrite the note `ref`, checked against the revision you read with outline_read: its whole `text`, one `replaceSection` (the text under a heading,… | `packages/outline-core/src/agent-tool-definitions.ts:232` |
| `tools.outline_create` | writes | **parent**, **text**, position | Create a block under `parent` (a ref, or root), at `position` among its siblings (0 is first; default last). | `packages/outline-core/src/agent-tool-definitions.ts:273` |
| `tools.outline_comment` | writes | **ref**, body, quote, whole, start, near, kind, properties, prefix, suffix, requestId, from, revision | Start a comment thread on the note `ref`, as you: on an exact `quote` of its source text (add start, near, prefix or suffix when the quote repeats),… | `packages/outline-core/src/agent-tool-definitions.ts:293` |
| `tools.outline_reply` | writes | thread, **body**, requestId, edit, observed | Reply in a comment thread, as you. | `packages/outline-core/src/agent-tool-definitions.ts:328` |
| `tools.outline_resolve_thread` | writes | **thread**, **resolved** | Resolve a comment thread (resolved: true), or reopen it (false), as you. | `packages/outline-core/src/agent-tool-definitions.ts:347` |
| `tools.view_order` | writes | **ref**, ids | Read or set the hand-set order of the view `ref` (a view with no [sort::] is ordered by hand: the order its board lanes, figures and Tree show). | `packages/outline-core/src/agent-tool-definitions.ts:360` |
| `tools.outline_changes` | reads | **since**, author, actor, limit, before, machinery | What changed since a point: an ISO time, or the `cursor` an earlier call returned. | `packages/outline-core/src/agent-tool-definitions.ts:383` |
| `tools.outline_patch` | writes | **ref**, **revision**, **patches**, mark, policy, allowStructural, propose | Small edits to the note `ref` the person may be typing in, without waiting for their save (draft.patch); for rewriting your own pages, such as a… | `packages/outline-core/src/agent-tool-definitions.ts:407` |
| `tools.outline_proposal_apply` | writes | **ref** | Apply draft proposal the note `ref` by id, without a reader, under the agent's normal patch comparison and policy. | `packages/outline-core/src/agent-tool-definitions.ts:460` |
| `tools.outline_proposal_dismiss` | writes | **ref** | Dismiss your own draft proposal the note `ref` by id, without a reader: mark it dismissed and put it in Trash. | `packages/outline-core/src/agent-tool-definitions.ts:460` |
| `tools.outline_proposal_resolve` | writes | **ref** | Ask the outline agent to resolve a stale proposal against the current note, preserving other edits. | `packages/outline-core/src/agent-tool-definitions.ts:460` |
| `tools.outline_set_property` | writes | **ref**, key, value, properties, **revision** | Set [key::value] properties on the header line of the note `ref` (the chips that end its first line): the value replaced where the key is, or the… | `packages/outline-core/src/agent-tool-definitions.ts:476` |
| `tools.outline_assign_id` | writes | **ref**, **revision** | Give the note `ref` the outline's next work id (outliner work-id-allocate), against the `revision` outline_read returned: the id is stamped on the… | `packages/outline-core/src/agent-tool-definitions.ts:510` |
| `tools.outline_move` | writes | **ref**, parent, before, after, position, **revision** | Move the note `ref` (with what is under it) to a new place: under `parent` (a ref, or `root`) at `position` among its children (0 is first; default… | `packages/outline-core/src/agent-tool-definitions.ts:529` |
| `tools.outline_trash` | writes | **ref**, **revision** | Put the note `ref` in Trash, with what is under it, against the `revision` outline_read returned: a note that changed since is refused and stays. | `packages/outline-core/src/agent-tool-definitions.ts:560` |
| `tools.outline_restore` | writes | **ref** | Bring the note `ref` back from Trash, with what went under it, to where it was. | `packages/outline-core/src/agent-tool-definitions.ts:578` |

<!-- generated:tools:end -->

| Entry | Source |
|---|---|
| `hostApi` | `packages/outliner/src/host-api.ts:193` |
| `AGENT_TOOL_DEFINITIONS` | `packages/outline-core/src/agent-tool-definitions.ts:117` |
| `AGENT_TOOL_SURFACES` | `packages/outline-core/src/agent-tool-definitions.ts:620` |

## view.*

`view.<type>(fields)` returns `{ ...fields, type }`: a plain object, checked when it is drawn. Return one from a render
script (or put several in a `stack`, `row`, `box` or `card`) and every client draws it with the primitive it already
has. The tone is one of `default`, `good`, `warn`, `bad`, `dim`, `accent`.

<!-- generated:view:start (written by packages/outliner/scripts/scripts-doc.ts; don't edit by hand) -->

| Builder | Fields (anything else is refused) | Source |
|---|---|---|
| `view.text` | `text`, `tone`, `strong`, `act` | `packages/outliner/src/component-primitives.ts:321` |
| `view.blockdown` | `text` | `packages/outliner/src/component-primitives.ts:326` |
| `view.badge` | `label`, `tone`, `act` | `packages/outliner/src/component-primitives.ts:329` |
| `view.stat` | `label`, `value`, `unit`, `tone` | `packages/outliner/src/component-primitives.ts:336` |
| `view.bar` | `label`, `value`, `max`, `tone` | `packages/outliner/src/component-primitives.ts:343` |
| `view.table` | `columns`, `rows`, `links`, `acts` | `packages/outliner/src/component-primitives.ts:350` |
| `view.checklist` | `items` | `packages/outliner/src/component-primitives.ts:376` |
| `view.sparkline` | `label`, `values` | `packages/outliner/src/component-primitives.ts:387` |
| `view.card` | `title`, `subtitle`, `badge`, `link`, `act`, `children` | `packages/outliner/src/component-primitives.ts:393` |
| `view.box` | `title`, `children` | `packages/outliner/src/component-primitives.ts:411` |
| `view.stack` | `children` | `packages/outliner/src/component-primitives.ts:414` |
| `view.row` | `children`, `minWidth` | `packages/outliner/src/component-primitives.ts:417` |
| `view.band` | `text`, `level`, `style`, `pattern`, `align`, `row`, `tone` | `packages/outliner/src/component-primitives.ts:422` |
| `view.track` | `style`, `pattern`, `tone` | `packages/outliner/src/component-primitives.ts:438` |
| `view.image` | `src`, `alt`, `size`, `fit`, `height`, `caption` | `packages/outliner/src/component-primitives.ts:445` |
| `view.button` | `label`, `act`, `tone` | `packages/outliner/src/component-primitives.ts:333` |
| `view.list` | `rows`, `groups`, `preview`, `filter`, `enter`, `empty` | `packages/outliner/src/component-primitives.ts:459` |

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
| `validatePrimitive` | `packages/outliner/src/component-primitives.ts:309` |
| `PRIMITIVE_TYPES` | `packages/outliner/src/component-primitives.ts:27` |
| `PRIMITIVE_FIELDS` | `packages/outliner/src/component-primitives.ts:28` |
| `MAX_NODES` | `packages/outliner/src/component-primitives.ts:130` |

## What a script returns

The returned value becomes text, the same way in a run note and a drawn line:

| Returned | Shown as | Source |
|---|---|---|
| `string` | as it is (Blockdown: a table, a list, a link all draw) | `packages/outliner/src/script-runs.ts:44` |
| `{ view }`, or one `view.x(…)` itself | the view, as Blockdown. **Any returned object with a `view` key is read as a view** (and refused when it isn't one): name your own keys otherwise | `packages/outliner/src/script-runs.ts:44` |
| `undefined` | no returned content; the status says `<script title> done` | `packages/outliner/src/script-runs.ts:316` |
| `JSON` (anything else) | JSON | `packages/outliner/src/script-runs.ts:44` |

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
- A `q` row is `{ id, title, revision, parentId, created, updated }`; a `read` child is `{ id, text, revision }`; `read()` itself
  returns `title`, `text`, `properties` and the rest of the record. **`q` rows come in no promised order** (an edited note
  came first in a check): sort them, or take outline order from `read(this.id).children`.
- **The host of a `name::` line is `this`**, so `q("parent:this")` lists that note's children, and `this.owner` is its owner.

| Entry | Source |
|---|---|
| `BlockRecord` | `packages/outline-core/src/block-record.ts:14` |
| `textRecord` | `packages/outliner/src/block-records.ts:35` |
| `ScriptSiteGlobals` | `packages/outliner/src/script-runtime.ts:11` |
| `bind` | `packages/outliner/src/script-runs.ts:117` |

## Modes

| Mode | Written | Runs | Draws or writes | Source |
|---|---|---|---|---|
| action | `[script::name]` | when asked: key, power bar, `/name slot=value`, `@name`, a rule's `[rule-on::script:name]` (also `-stop`, `-change`), `ext.<id>.run`, MCP `script_run` | a run note beside the source, plus whatever it writes | `packages/outliner/src/script-runs.ts:230` |
| render | `[script::name] [mode::render]` and a line `name:: week=42` | when a line asks, and again when what it read changes | the returned value, under the line; **no run note, no undo step, nothing written** | `packages/outliner/src/script-runs.ts:146` |
| `pipelineCalls` (the `::=` line) | `::= (await resolve("this.owner")).values[0]` | like a render script whose code is `return (expression);` | the value, under the line | `packages/outliner/src/extension-handlers.ts:150` |

**Render mode in detail.**

- A render drawing has no write functions: no `act`, `place`, writing tools or `draft.patch`, regardless of its effects description. A write during render would feed its own redraw. A missing function gives its JavaScript error and the Sources hint "render scripts draw; use an action script (a button or of=) to change things". It is drawn with a 15-second deadline unless `[deadline::]` says otherwise.
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
| `slotProps` | `packages/outliner/src/script-runs.ts:52` |
| `scriptRender` (the one producer path of every handler line) | `packages/outliner/src/extension-calls.ts:817` |
| `DEFAULT_DEADLINE_MS` | `packages/outliner/src/extension-manifest.ts:431` |

## Effects, access and attribution

- **Render and action are kinds, not permissions.** A render context contains only read functions. Every action invocation (buttons, `of=`, keys and rules included) has the person's reach; `effects=read` does not prevent writing. `effects=read` and `effects=write` describe the script in Sources, x-ray and `ext ls`. A matching `[script::name]` note supplies `[effects::]` only when the fence omits `effects=`; files describe effects in `// ep0ch-script effects=write`.
  Effects also keep their restart replay meaning: an `actions` macro marked as writing is not re-run by itself after a restart.
- **Trust the source.** Code in this outline, written by the person or their agents and attributed, runs. EchoNet packets never execute. Actual writes are recorded through the run's attribution and undo, and shown in Sources.
- **Who wrote it.** Every write is `author: agent` with the actor id `script:<name>`, the run's undo id as the session, and
  the task id `trigger:script:<extension id>`. Whoever asked is recorded as `requestedBy` (the person at their keyboard,
  or the agent that ran `script_run`). The run note's second line says both.
- **Outside agents** run a script with the MCP tool `script_run` (`ref` or `uri` of the script's note). It runs as
  `script:<name>` with the caller as `requestedBy`, and has no `this`, no `props` and no `act` (no note, no slots, no door).
  Running by block id selects the note's `[script::name]` from all authored sources; without that property, a single script is used, and several scripts are refused with their names. An empty or failed selected source refuses with its reason and never falls through to another script. Duplicate fence names in one note fail at load with both line numbers, visible in `ext ls`.
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
| `actor` (who a script's writes belong to) | `packages/outliner/src/script-runs.ts:253` |
| `script_run` (the gateway tool) | `packages/door/src/mcp.ts:731` |
| `scripts.run` (the service request, capped by the access level) | `packages/outliner/src/server.ts:1625` |
| `mcpAccess` (a script's write, by access level) | `packages/outliner/src/host-api.ts:145` |
| `mcpAccess` (yolo reads as full) | `packages/outliner/src/server.ts:4445` |
| `viaYolo` | `packages/outliner/src/server.ts:4475` |
| `inverse` (the undo's draft part) | `packages/outliner/src/script-runs.ts:473` |

## Lifecycle

1. **Start.** A run returns at once with its undo id. A one-line scalar answer is shown in the door's plain status voice;
   a run that returns nothing says `<script title> done`. Property-only writes and short answers create no run note.
   Script identity remains in attribution, revisions and inspection, with the requester recorded separately.
2. **Keep content.** A returned document (a string with newlines), structured data or a view, and explicit `text()` or
   `console.log()` output, create a run note under the script. `[results::keep]` on the script asks for a full run record
   from the start, even for a short answer or no return. A run note is machinery and counts for no backlink.
   Tool-call progress is buffered; when a record is requested it streams there as `N. tool: result`. `q` and `read` log
   their `outline_find` and `outline_read`; `resolve`, `act` and `wait` log nothing. The return value is last.
   `place()` still writes an output region in its note, and a render line's `.keep` still keeps its drawn output.
3. **Deadline.** Default 5 minutes (the maximum), or `[deadline::2m]`. A render drawing defaults to 15 seconds.
   A run past it fails with "The script ran past its deadline (Ns)".
4. **Stop.** `scripts.stop` with the run's undo id (`script.stop run=<undo id>` in the door) ends one run; its next call
   is refused and the completion says "Stopped by <who>". `{ stopped: false }` when it isn't running.
5. **Edits.** Changing the script's **code** while it runs ends it ("The script source changed; run its saved revision
   again"). The check is made at the run's next host call, not at the edit. A script that writes into its own note goes on: only the fence counts. At the end, a changed script setting (its stamp) discards successful output ("The script source changed during this run"); a failed call keeps its refusal reason.
6. **End.** The run's undo is prepared; "Undo unavailable: why" is added to a kept record when it can't be.
   `scripts.ended` carries the answer (`message`), retained note ids (`written`), requester and end reason. The initiating
   door shows that answer, with `ctrl+z undoes` on success; actual failures use the refusal voice with a next action.
   An inline `@script` ask uses the same answer when there is no retained note to link.
   **The caller is answered too** (PIE-1264): `extensions.act`, `scripts.run` and `scripts.sequence` (so `ep0ch act`, the
   MCP `script_run` and the door's press) wait up to 3 seconds for the run's end and answer with its last word:
   `message` (a returned line, the error that ended it, or "<name> done"), `state` (`done`, `failed`, `stopped`, or
   `running` when the wait ran out, with `script.stop run=<id>` named in the message) and `answer`, the whole returned
   text when it is more than a line. An agent's door press of a failed run is refused with that message. A background
   ask (an agent's answer), a rule's trigger and a person's press (their door hears `scripts.ended`) don't wait. The wait never
   holds the connection: the next request on it is served once the run has started.

| Entry | Source |
|---|---|
| `ScriptRuns.start` | `packages/outliner/src/script-runs.ts:243` |
| `setTimeout` (the deadline timer) | `packages/outliner/src/script-runs.ts:262` |
| `stopRun` | `packages/outliner/src/script-runs.ts:217` |
| `The script source changed` (during a run) | `packages/outliner/src/script-runs.ts:330` |
| `scripts.stop` | `packages/outliner/src/server.ts:2055` |
| `scripts.stop` request | `packages/outliner/src/types.ts:2508` |

## Traps

Each of these cost someone an hour.

- **`this.children` is empty.** `this` and `self` are text records. List children with `q("parent:this")` or
  `read(this.id)`. The same for `links` and `backlinks`.
- **A `q` row has no properties.** `(await q("parent:this")).blocks[0].qty` is `undefined`: `read(row.id)` and look in `properties`.
- **Properties are `[{ key, values }]`, not an object**, and `props.x` is a list: `props.week[0]`, not `props.week`.
- **`line` counts from 0**, in `fields[].line`, `tasks[].line`, `caller.line` and a handler line's index. The drawn `::fields` figure labels lines from **1**; its API offsets stay zero-based. The first line of a
  note is line 0, the header chips' line.
- **A render script redraws for what it read, not for what it could have** (the list under *Render mode*). `this`
  and `self` are snapshots taken when the line is drawn, and `this.children` is always empty: use `q("parent:this")` or
  `read(this.id)`. A note the script never touched, by any answer, doesn't redraw it.
- **`ep0ch show <note>` draws handler output through the door's note surface.** It loads the outline's
  extensions before drawing, so a cold CLI can inspect a render script without opening a door. `--source`
  still prints only the authored text. The draw waits up to three seconds for live answers.
- **`ext.<id>.run` on a render script runs it as an action** (with a run note), instead of refreshing its line. To draw a
  line again, `projection.refresh` (the door's `r` on the note).
- **A render drawing has no write functions.** Run it as an action (a button or `of=`) when it needs to change things.
- **`text()` and `console.log` are for run notes.** A render shows only what it returns.
- **`function () { this }` loses `this`.** Use arrows.
- **Saving a script that fails to load is allowed.** `ep0ch ext ls` is where the error shows; the note itself is fine.
- **Files need the opt-in line** (`// ep0ch-script` first) and live under `.ep0ch/scripts/`; the old `scripts/` folder is ignored.

## Anchored append and held drafts

**Append:** `await tools.outline_edit({ ref: this.id, expectedRevision: this.revision, append: "One more entry", at: "^log" })` appends an output region after the anchor's region; without `at`, append remains end-of-note.
**Placement:** it uses PIE-956's placement planner and draft router; at a heading it follows the output regions directly beneath the heading, before the person's prose.
**Receipt:** anchored append returns `outcome: "applied"` or `"proposed"`, an `anchor`, and the placement message; it does not return the whole-note edit's diff.
**A held draft:** `outline_patch` lands at its observed passage in the live draft, as one attributed edit; without a draft it edits the saved note.
**A proposal:** a missing, changed or ambiguous observed span, a patch touching the paragraph, list item or heading at the cursor or selection endpoint, or a busy or unavailable draft leaves a proposal instead.
**The cursor matters:** an unmarked patch can land above or below the block being typed in; with `mark`, spans must stay above the mark and above the cursor's block when the cursor is before it.
**Placement marks:** anchored append uses a mark below its target, so type in a later paragraph for the non-conflicting run.
**Save:** the saved note waits for the person's save when the edit landed in their draft.
**Script-owned output:** `place("Report", { at: "^weekly", mode: "upsert" })` creates or replaces this script's own region; a person's edit inside that region makes replacement a proposal.
**Worked run:** [task 4](PROGRAMMABLE-NOTES.md#4-append-while-a-person-holds-a-draft) drives append and the conflicting cursor on a scratch door.

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

Click an empty square to play it (each is a `view.badge` whose `act` is `ttt-play cell=<n>`, see Pressing a view), or
run `ttt-play cell=5` from the power bar; "new game" (`ttt-play new=1`) clears the board.

````note ex3-draw
Tic-tac-toe board [script::ttt-draw] [mode::render]
```js
const board = this.properties.find(p => p.key === "board")?.values[0] ?? ".........";
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const won = lines.map(l => l.map(i => board[i]).join("")).find(s => s === "XXX" || s === "OOO");
const turn = [...board].filter(c => c === "X").length <= [...board].filter(c => c === "O").length ? "X" : "O";
const status = won ? `${won[0]} wins` : board.includes(".") ? `${turn} to play` : "a draw";
// An empty square is a press that plays it; a played one is just its mark.
const square = i => board[i] === "." && !won ? view.badge({ label: String(i + 1), act: `ttt-play cell=${i + 1}` })
  : view.badge({ label: board[i] === "." ? "·" : board[i] });
const rows = [0, 3, 6].map(r => view.row({ children: [square(r), square(r + 1), square(r + 2)] }));
return view.stack({ children: [...rows, view.text({ text: status, strong: true }), view.badge({ label: "new game", act: "ttt-play new=1" })] });
```
````

````note ex3-play
Tic-tac-toe move [script::ttt-play] [effects::write]
```js
const me = await read(this.id);
if (props.new) {
  await tools.outline_set_property({ ref: this.id, key: "board", value: ".........", revision: me.revision });
  return "a new game";
}
const board = this.properties.find(p => p.key === "board")?.values[0] ?? ".........";
const cell = Number(props.cell?.[0]);
if (!(cell >= 1 && cell <= 9)) throw new Error("cell=1 to 9");
if (board[cell - 1] !== ".") throw new Error(`cell ${cell} is taken`);
const turn = [...board].filter(c => c === "X").length <= [...board].filter(c => c === "O").length ? "X" : "O";
await tools.outline_set_property({ ref: this.id, key: "board", value: board.slice(0, cell - 1) + turn + board.slice(cell), revision: me.revision });
return `${turn} played ${cell}`;
```
````

````note ex3-game
Game 1 [board::.........]
ttt-draw::
````

````shows ex3
`1` `2` `3`

`4` `5` `6`

`7` `8` `9`

**X to play**

`new game`
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

#### One button, two tiles

Keep this code and its button together in any note. The screen needs tiles named `backlinks` and `preview`.

````blockdown
My workbench
```js script=toggle-pair effects=write
const { tiles } = await act('layout.get');
const on = !tiles.find(t => t.name === 'backlinks')?.collapsed;
for (const tile of ['backlinks', 'preview']) await act('tile.collapse', { tile, on });
return on ? 'folded both' : 'opened both';
```
::button{label="Make it work" of=toggle-pair}
````

#### Example 6: One button, two things

A note can keep two named fences beside their buttons. Here a single press updates this note's property and adds a child:

````note ex6-desk
Packing desk
```js script=pack-pair effects=write
await tools.outline_set_property({ ref: this.id, key: 'packing', value: 'ready', revision: this.revision });
await tools.outline_create({ parent: this.id, text: 'Labels ready' });
return 'Packing ready';
```
::button{label="Prepare both" of=pack-pair}
````

````shows ex6
Packing ready
````

Either fence can move to its own note without changing the button's `of=` name.

#### Fantasia: a button, a transaction, motion, undo (needs a door)

**Body line:** below a title, write `::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 layout=focus motion=fantasia}` in a note, and save the complete script note linked below. First save the `focus` screen as described below. For a dance left floating to undo, replace `layout=focus` with `stay=1`; stay takes precedence if both are present. With neither, the script undoes its own layout at the end.
It is the acceptance test of the self-reference wave: one click runs the whole chain. It needs several tiles the person isn't holding to show anything, and unlike examples 1 to 5 it needs a connected door (it moves tiles), so it is not pasted by the scripts-docs test; the showcase's *fantasia* section runs it live.

Save the [complete Fantasia note in task 5](PROGRAMMABLE-NOTES.md#5-fantasia-settles-into-a-saved-screen), including its title and `js` fence.

**Prepare the settle target:** `ep0ch act screen.open name=desk`, arrange several tiles, then `ep0ch act screen.save name=focus`.
**Settle:** put `layout=focus` on the button and omit `stay=1`; run it on the Desk (or a blank screen), since Detail keeps its own layout.
**Agent press:** `act button.press` is an agent action and gets no invitation; only a person's click or Enter invites the run to move the held tile.
**Undo:** prepare a reader of the script definition before running, and include it in the saved settle layout (the receipt calls that note `undoOn`); then `act ext.undo tile=<that reader>` as the actor that ran it; it takes no `run=`. `layout.undo txn=<undo id>` takes back just the layout.

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
