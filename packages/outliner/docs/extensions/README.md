# Extensions: the four kinds, and rules

An extension is a folder. Put one in a watched folder and the outline service loads it, with no
restart. Delete the folder and everything it added goes away (its handlers, actions, tiles and kept
line results); records it wrote stay, because they are data. The service runs the extension's
code; clients (Detail, the door, the publisher, agents) only draw what the service returns.

There are four kinds, and **rules** that say when a block gets one (PIE-600). One extension may provide
several of them.

| Kind | What it is | Written as | Where the result lives | How a client draws it |
|---|---|---|---|---|
| 1. **Data** | A record put into a block, as if you copied it in | `moon:: 2026-10-26`, `jira:: PC-12` | A real block the extension owns, with namespaced properties (`[moon.phase::Full Moon]`) | As any block. Under the line, a projection says what it is and when it was fetched |
| 2. **Inline output** | Markdown rendered inside a block | `horoscope:: virgo` | Kept by the service per line (`extension_outputs`); never written into the note unless you **keep** it | The projection's `output.markdown`, under the line |
| 3. **Rich component** | Data plus a view, with its own behaviour (actions) | `fancy-horror:: virgo` | Kept like an output: `{ data, view }` | The view's primitives (box, card, table, stat, bar, checklist, sparkline, badge, text, row, stack), or a rendered target |
| 4. **A whole tile** | A program in a tile of its own kind | opened from the door | Whatever its actions write | The door's tile-kind registry runs it in a terminal tile |
| **Rules** (`decorate`, `on`) | "When a block matches this, draw this on it, or run this": `match` by a property, a saved-view query, a text pattern or a construct kind | `rules[]` in `extension.json`, or a rule note (`[rule-name::name]`, no code) | Nothing in the note: a built-in decoration is computed on read; a code rule's view is kept like an output until the block's revision changes; a trigger's writes are the extension's | `decorations` in `resources.projection.read`: view primitives (plus `band` and `track`) above, below, in place of or around what matched; Detail and the publisher as text |

The canonical examples ship in [`extensions/`](../../extensions): [moon](../../extensions/moon) and
[jira](../../extensions/jira) (data), [horoscope](../../extensions/horoscope) (inline output),
[fancy-horror](../../extensions/fancy-horror) (rich component) and [tarot](../../extensions/tarot)
(a tile); [meeting-card](../../extensions/meeting-card) (a rule that decorates), [glyphs](../../extensions/glyphs) (a bar source),
[done-stamp](../../extensions/done-stamp) (a rule that runs) and [shout](../../extensions/shout) (a rule on a
text pattern). They are forkable source: `outliner ext add <name>` copies one into your folder, where it
is yours to edit.

Extensions are **trusted code, not a sandbox**, like nvim or Claude Code plugins. They run as the
service user. What keeps the outline safe is the contract below: a call gets a bounded, read-only
view of the outline and no database handle; every write it makes goes back through the service,
which checks revisions, routes an edit through a door's live draft (a proposal while the person types), and
attributes it (`author: agent`, `actorId: ext:<id>`), so every surface shows who wrote it. Since PIE-754 the
limit is attribution, not place: an extension may write anywhere in the outlines its host serves
([Extensions as programs](#extensions-as-programs)).

`ext:<id>` is reserved: only the service's extension runtime writes as an extension. A client's
write that names an `ext:` actor anywhere it says who writes (`mutation`, `provenance`) is refused,
since readers trust the prefix: an extension's write runs no
`@agent`, and the publisher credits it to the extension. To have an extension write, ask it with
`extensions.act`. A co-written id that names its saver first (`ep0ch-door:host+ext:tidy`) is the
saver's write and is accepted.

Defence in depth, not a sandbox: the service keeps what an extension returns free of terminal
escapes and control characters (outputs, replies, messages, record text, manifest names, labels and
descriptions, and what `outliner ext` prints), and scrubs a secret's exact value (and its base64)
from every answer. That scrub matches exact strings only: an extension that re-encodes a secret
(reversed, URL-encoded, split) gets it past the scrub. Trust the code you install.

## Where extensions live

| Folder | Serves |
|---|---|
| `<outline root>/extensions/<id>/` | That outline only. It travels with the outline. |
| `~/.config/pi-herdr-outliner/extensions/<id>/` (or `OUTLINER_EXTENSIONS_DIR`) | Every outline the service serves. |

- When both have the same id, the outline's copy wins; `extensions.list` (and `outliner ext ls`
  while the service runs) lists the other as `shadowed`.
- The repo's own `extensions/` folder is never loaded in place, even when an outline's root is the
  repo.
- **Watched.** The service watches both folders (recursively, 300 ms of quiet) and rebuilds its
  registry from scratch on every change. Clients get an `extensions` event (`extensions.changed`)
  and read `extensions.list` again.
- **Code needs no reload.** Each call starts a fresh process, so an edit to `horoscope.ts` applies
  on the next call. A read handler also runs again on open when the manifest's `version` changes.
- **A broken folder keeps its last good version.** It is listed as `failed`, with the reason and
  the version it still serves. One that never loaded serves nothing and says why.

The errors name the file and the field:

```text
extension.json: handlers/0/kind must be one of resource, data, output, component; still serving version 1 loaded 2026-10-01T09:00:00Z
extension.json: handlers/0 has a field it doesn't know: efects
extension.json: id other must match the folder's name (mismatch)
config.json: config doesn't match the config schema in extension.json (email must not have fewer than 1 characters)
handler horoscope:: is already served by horoscope (/home/you/outlines/pie/extensions/horoscope)
```

### From a shell

```sh
outliner ext ls                                   # every folder, its state, its error, what it serves
outliner ext add horoscope                        # a built-in, into the user folder
outliner ext add ./my-extension                   # any folder (checked first; a broken one is refused)
outliner ext add moon --outline-folder ~/outlines/pie   # into that outline's own extensions/
outliner ext remove horoscope                     # deletes the folder; the service drops it at once
outliner ext act fancy-horror ward --block <id>   # runs an action, attributed to the extension
```

They are conveniences: copying a folder in or deleting it does the same.

## The folder

```text
extensions/horoscope/
  extension.json   the manifest (contract 2)
  horoscope.ts     code; `bun` in run means the service's own Bun
  config.json      optional: this install's settings and secret references. Never a secret value.
  README.md
```

### `extension.json` (contract 2)

```json
{
  "contract": 2,
  "id": "horoscope",
  "version": 1,
  "name": "Horoscope",
  "description": "Inline output: a made-up horoscope for a sign.",
  "run": ["bun", "horoscope.ts"],
  "deadline": "15s",
  "handlers": [{
    "key": "horoscope", "kind": "output", "effects": "read",
    "argument": { "name": "sign", "required": true, "pattern": "^(aries|…|pisces)$", "description": "a zodiac sign" },
    "options": {
      "day":   { "type": "string", "pattern": "^(today|tomorrow)$", "default": "today" },
      "short": { "type": "boolean", "scope": "display" }
    },
    "staleAfter": "1h"
  }],
  "actions": [],
  "tiles": []
}
```

| Field | Meaning |
|---|---|
| `id` | Lowercase name; must match the folder's name. Its properties are `<id>.<field>`. |
| `version` | An integer. Raise it when output changes meaning: read handlers run again on open. |
| `run` | The program each call starts. Needed by handlers and actions; a tile-only extension can leave it out. |
| `deadline` | How long one call may take (`30s`, `2m`); default 15 s, at most 5 m. A handler may set its own. |
| `configSchema`, `secrets` | A JSON schema for `config.json`'s `config`, and the secrets it needs by name. |
| `handlers[]` | The `key::` lines it serves (kinds 1–3). |
| `actions[]` | What it can do: one action is a key, a click and an agent call alike. |
| `tiles[]` | Tile kinds (kind 4). |
| `agents[]` | Agents a person addresses while they write (`@tidy …`); see [Agents in the note](#agents-in-the-note). |
| `rules[]` | "When a block matches this": `match`, then `decorate` and `on`; see [Rules](#rules-when-a-block-matches). A rule with only built-in decorations needs no `run`. |
| `bar[]` | Sources of rows for a client's command palette (the door's power bar, at most 4); see [Bar sources](#bar-sources-a-command-palettes-rows). Needs `run`. |
| `components[]` | What the properties your lines or notes take are, as component schemas (at most 8); see [Component schemas](#component-schemas-docs-and-completion). Needs no `run`. |

### `config.json`

```json
{
  "config": { "authMode": "basic", "email": "you@example.com" },
  "secrets": { "token": { "keychainService": "jira-api-token" } },
  "sources": [{ "origin": "https://your-site.atlassian.net", "project": "PC" }],
  "enabled": true
}
```

Secrets are references, resolved on the service host at call time: `{"env": "NAME"}`,
`{"keychainService": "…"}` (macOS), `{"file": "~/.config/…/token"}` (mode 0600), or a `with-secrets`
group's key, `{"group": "readwise", "key": "READWISE_TOKEN"}` (PIE-754, [below](#secrets-by-with-secrets-group)).
A manifest's `secrets` may name the group itself (`"token": { "group": "readwise", "key": "READWISE_TOKEN",
"description": "…" }`), so a fresh install needs no `config.json`. The values reach the program on stdin
(`credentials`; a group key also as its own variable), and are scrubbed from what it returns. `"enabled": false` keeps the folder
but serves nothing.

## The wire

One process per call. The service writes one JSON request to stdin and reads one JSON response
from stdout, then the process exits (its whole process group is killed at the deadline). The
environment is `PATH`, `LANG`, `OUTLINER_EXTENSION` (its id), its connection to the service (`EP0CH_SOCKET`,
`EP0CH_WS`, `EP0CH_EXT_GRANT`: [Extensions as programs](#a-connection-to-the-service)) and the with-secrets keys its
manifest names, nothing else of the host's; the working directory is the extension's folder.

```json
{ "contract": 2, "operation": "run", "input": { … }, "config": { … }, "credentials": { … } }
```

The answer is `{"ok": true, "value": …}` or `{"ok": false, "code": "not-found"}` (codes:
`credentials-missing`, `unauthorized`, `forbidden`, `not-found`, `invalid-config`, `network`,
`timeout`, `rate-limited`). A provider's own error text is never stored.

An extension disabled, removed or edited (`extension.json` or `config.json`) while a call runs has
that call's answer discarded: nothing it returned is kept or written, and the call fails with
"was changed, disabled or removed while it ran". A secret from a file is read only when the file is
yours alone (`chmod 600`); otherwise the call fails naming the file and its mode, never its content.

| Operation | Called for | `input` | `value` |
|---|---|---|---|
| `read` | a data handler | `{ handler, key, options, context }` | `{ record: { title, fields: [{ key, value }], body } }`, or a collection: `{ record?, records: [{ key, title, fields, body }], complete? }` |
| `run` | an output or component handler | `{ handler, argument, options, context }` | output: `{ markdown, title? }`; component: `{ data, view, targets?, title? }` |
| `respond` | an `@name` request | `{ agent, request, mark, note: { id, revision, text }, context }` | `{ message?, reply?, patches?: [{ observed, replacement, before?, after? }] }` |
| `decorate` | a rule's hit (no `use`) | `{ rule, hit, context }` | `{ view, title? }` |
| `act` | an action | `{ action, args?, target?: { blockId, revision, line?, argument?, options? }, context, output?, scheduled? }` (no block: `context` is `{ now }`) | `{ message?, writes?: [...], copy?, open? }` |
| `bar` | a bar source, as the person types | `{ source, query, limit, context? }` (`context`: the note in front of the person) | `{ rows: [{ id, label, detail?, preview?, block?, resource?, action?, args?, copy? }] }` |
| `resolve`, `read`, `changed` | Jira's Resource path | see [resource-process.md](resource-process.md) | |

`context` is what the call sees of the outline, bounded and read-only:

```json
{
  "block": { "id": "…", "text": "…(16 000 characters at most)", "revision": 4, "properties": [{ "key": "status", "value": "doing" }] },
  "line": { "index": 1, "text": "horoscope:: virgo" },
  "children": [{ "id": "…", "text": "…" }],
  "ancestors": [{ "id": "…", "title": "…" }],
  "now": "2026-10-01T09:00:00.000Z"
}
```

## Handler lines

Every handler is written the same way, and the service parses it, not the extension:

```text
key:: [argument] [--option[=value]]…
```

- The **argument** is the words that aren't options: a sign, a date, a ticket key. `argument.pattern`
  (or `keyPattern` for data) checks it. A bad one shows its reason on the line and nothing runs.
- **Options** are typed by the manifest: `boolean` (`--short`), `integer` (`--days=3`, with `min`
  and `max`) or `string` (`--day=tomorrow`, with `pattern`). Defaults fill in.
  - `fetch` (the default scope): part of the call. Two lines that differ by one are two calls.
  - `display`: never reaches the extension. Lines that differ only by one share a result.
  - An unknown `--flag` is a warning on the line, not a failure.
- The bullet form works: `- horoscope:: virgo`. A line in a code span or fence is text.
- Keys the outline already uses (`status`, `type`, `page`, `query`, `file`, `web`, …) can't be
  handler keys.

### When a handler runs on its own: `effects`

| `effects` | Runs by itself | Otherwise |
|---|---|---|
| `read` | When the line is saved or the note is opened, if it has no result, the result is older than `staleAfter`, or (an output or component) the extension's `version` changed | `r` |
| `spend` (costs money or model time) | Once, when a person's own save adds the line. Editing it afterwards, a line an agent wrote, and a line from before the service started wait. | `r` |
| `write` | Never | `r` |

`r` is `resources.projection.refresh` (the door's `projection.refresh`; Detail's `r` on a note).
`r` on a data record refetches that one key. Saves an extension makes never trigger a run, so
extensions can't loop; the one exception is deliberate: after an action writes, its own `read` line
runs once so the view shows the change.

### What readers get

`resources.projection.read` returns handler lines in the same slot as Jira's tickets, one
projection per line, ordered by line:

```json
{
  "anchor": { "kind": "directive", "line": 1, "start": 6, "end": 23 },
  "provider": "horoscope", "label": "Horoscope", "propertyKey": "horoscope",
  "kind": "output",
  "extension": { "id": "horoscope", "handler": "horoscope", "effects": "read", "display": {}, "version": 1 },
  "key": "virgo",
  "status": "ready",
  "summary": "Virgo · 2026-10-01",
  "fetchedAt": "2026-10-01T09:00:00.000Z",
  "output": { "markdown": "**Virgo, 2026-10-01.** …", "ranAt": "2026-10-01T09:00:00.000Z", "title": "Virgo · 2026-10-01" },
  "fields": [], "options": { "unknown": [] }
}
```

- `status`: `ready`; `stale` (the last run failed, the last good result is shown, `reason` says
  why); `not-run` (with `reason`: when it will run); `not-fetched` (data not fetched yet);
  `unavailable` (a bad line, or a failure with nothing to show). `fetching: true` while it runs.
- `output.markdown` is inert BlockDown: it never adds properties or provider lines to a note.
- `output.inputsChanged` / `versionChanged`: the block or the extension changed since it ran.
- A component adds `output.component: { data, view }`; `output.markdown` is its markdown rendering.
- A data line adds `record: { blockId, pageBlockId, syncedAt }` and the `fields` the handler lists.
- A `resource-catalog` event (`extensions.output`, with `blockId`) says a line's result changed.

`extensions.render { blockId, line?, target, fallback? }` returns a line's result in one target:
`terminal`, `markdown`, `blockdown`, `html`, `json` or `csv`.

## Kind 1: data

**What it is.** A record from somewhere else put into a block, as if you had copied it in and
mapped its fields to properties yourself. Its properties are queryable (`moon.phase="Full Moon"`),
it shows in backlinks and embeds, and it is refreshed.

**The contract.** A handler with `"kind": "data"` and a `keyPattern`; the argument is the key.
`read` returns `{ record: { title, fields, body } }`. The service writes one block per key:

```text
Moon on 2026-10-26: Full Moon
[moon.key::2026-10-26] [moon.phase::Full Moon] [moon.illumination::100%] [moon.age::14.9 days]

100% lit, 14.9 days since the new moon.
```

- It sits under the key's home: the block whose `[page::KEY]` is the key, else the first block whose
  own `[moon::KEY]` names it, else the first block that asks. Every other line for that key shows
  that block. It moves when its home changes and goes to Trash (restorable) when nothing asks.
- Only the extension writes it. A person's or agent's edit is refused with the reason
  (`moon.phase comes from Moon; write your own [phase::] on the parent block`).
- Writes are diff-only (an unchanged record isn't written), attributed `ext:moon`,
  `ext.moon.sync` in the change feed. `activity.recent` with `extensions: "exclude"` leaves them out.
- `fields` in the handler lists what the projection shows beside the title.
- Jira is the full version: a Resource snapshot, comments as child blocks, a poll, drift views
  ([extensions/jira](../../extensions/jira)). Its `kind: "resource"` path is Jira's alone for now;
  a new provider uses `data`.

**Worked example: "make me an extension that puts a book's details into a block".**

1. `mkdir ~/.config/pi-herdr-outliner/extensions/book`
2. `extension.json`:

   ```json
   {
     "contract": 2, "id": "book", "version": 1, "name": "Book",
     "run": ["bun", "book.ts"],
     "handlers": [{ "key": "book", "kind": "data", "effects": "read",
       "keyPattern": "^[0-9]{10}([0-9]{3})?$", "argument": { "name": "ISBN" },
       "fields": ["author", "year"], "staleAfter": "24h" }]
   }
   ```

3. `book.ts` reads the request, looks the ISBN up (a local catalogue file, or an API with a
   secret declared in `secrets`), and answers:

   ```ts
   const { input } = await Bun.stdin.json();
   const book = lookUp(input.key);   // yours
   process.stdout.write(JSON.stringify(book
     ? { ok: true, value: { record: { title: book.title,
         fields: [{ key: "author", value: book.author }, { key: "year", value: String(book.year) }],
         body: book.summary } } }
     : { ok: false, code: "not-found" }));
   ```

4. `outliner ext ls` shows `book active`. Write `book:: 9780000000000` in a note: the record appears
   under it. A view `book.author="Ann Example"` lists your books.

## Kind 2: inline output

**What it is.** Markdown the service computes and shows under the line that asks. It isn't the
note's text: the note keeps exactly what you wrote. **keep** turns it into real blocks when you want
it to stay.

**The contract.** A handler with `"kind": "output"`. `run` returns `{ markdown, title? }` (64 KiB at
most). The service keeps the last good result per line, so a reader shows it at once and a restart
keeps it.

- **keep** is built in for every output and component handler (`ext.<id>.keep`): it writes the
  result under the block as one block, attributed to the extension.
- A failed run keeps the last good result and says why (`stale`).

**Worked example: "make me an extension that shows today's weather under a line".**

1. `extensions/weather/extension.json`:

   ```json
   {
     "contract": 2, "id": "weather", "version": 1, "name": "Weather",
     "run": ["bun", "weather.ts"],
     "secrets": { "apiKey": "Weather API key" },
     "handlers": [{ "key": "weather", "kind": "output", "effects": "read",
       "argument": { "name": "city", "required": true }, "staleAfter": "30m" }]
   }
   ```

2. `config.json`: `{ "secrets": { "apiKey": { "env": "WEATHER_API_KEY" } } }`.
3. `weather.ts`:

   ```ts
   const { input, credentials } = await Bun.stdin.json();
   const now = await fetchWeather(input.argument, credentials.apiKey);   // yours
   process.stdout.write(JSON.stringify({ ok: true, value: {
     title: `${input.argument} · ${now.summary}`,
     markdown: `**${now.temperature}°C**, ${now.summary}\n\n- Wind: ${now.wind} km/h`,
   } }));
   ```

4. `weather:: Lisbon` shows the weather under the line and refreshes after 30 minutes on open.
   `r` fetches now. For a call that costs money or model time (an LLM summary, say), use
   `"effects": "spend"` and a `"deadline"` up to `"5m"`.

[horoscope](../../extensions/horoscope) is the smallest complete one.

## Kind 3: rich component

**What it is.** Something inside a block with its own look and its own behaviour: a little board, a
gauge, a checklist you act on. It is **headless**: its data is the truth, and its view is composed
from a shared catalogue of primitives every client already draws. A new component needs no client
code.

**The contract.** A handler with `"kind": "component"`. `run` returns:

```json
{
  "title": "Virgo · week of 2026-09-28",
  "data": { "sign": "virgo", "dread": 5, "omens": [{ "omen": "…", "warded": false }] },
  "view": { "type": "card", "title": "Virgo", "badge": { "label": "uneasy", "tone": "warn" }, "children": [
    { "type": "stat", "label": "Dread", "value": 5, "unit": "/ 10", "tone": "warn" },
    { "type": "checklist", "items": [{ "label": "…", "done": false }] }
  ] },
  "targets": { "html": "<optional: its own rendering for a target>" }
}
```

Its behaviour is **actions** (below): `ward` writes a block, and the next run reads it back from
`context.children`. The component's state lives in the outline, as blocks.

### The primitives

| Primitive | Fields |
|---|---|
| `text` | `text`, `tone?`, `strong?` |
| `badge` | `label`, `tone?` |
| `stat` | `label`, `value` (number or text), `unit?`, `tone?` |
| `bar` | `label`, `value`, `max`, `tone?` |
| `table` | `columns`, `rows` (cells: text or numbers), `links?` (a block id or a [Resource ref](#opening-a-resource) per row, or null: Enter or a click opens it) |
| `checklist` | `items: [{ label, done }]` |
| `sparkline` | `label?`, `values` |
| `card` | `title`, `subtitle?`, `badge?`, `link?` (a block id or a [Resource ref](#opening-a-resource)), `children?` |
| `box` | `title?`, `children` |
| `stack`, `row` | `children` (top to bottom; side by side) |
| `band` | `text?`, `level?` (1–3), `pattern?`, `align?`, `row?`, `tone?`: a heading in glyph tracks (rules) |
| `track` | `pattern?`, `tone?`: one row of glyph track, a divider (rules) |

`tone` is `default`, `good`, `warn`, `bad`, `dim` or `accent`. Limits: depth 8, 400 primitives, 200
rows, 12 columns, 2 000 characters of text each, 256 KiB of data. A view that breaks one is refused
with a path to the problem (`view.children[0].max must be more than 0`), and the line shows it.

### Targets and fallbacks

Data first, rendered to the target the reader names (`extensions.render`, or the publisher by
`Accept` header later):

| Target | From the primitives |
|---|---|
| `terminal` | Plain text with box drawing; a client that draws primitives (the door) takes `view` instead |
| `markdown` | Lists, a GFM table, `- [x]` items |
| `blockdown` | The markdown, made inert: it can't add properties to a note |
| `html` | Semantic HTML with `ext-*` classes |
| `json` | The data |
| `csv` | The view's first table, else data that is a list of flat objects |

For one target the chain is: (1) the component's own `targets[target]`; (2) the version composed from
its primitives; (3) the fallback the requester names (`fallback`, default `json`). An unknown
component never breaks a reader: it degrades to its data.

**Worked example: "make me an extension that shows my open bugs as a little board in a note".**

1. A `kind: "component"` handler `bugs` with `"effects": "read"` and `"staleAfter": "10m"`.
2. `run` fetches the bugs (or reads them from `context`) and returns
   `data: [{ key, title, state }]` with a view:
   `{ type: "box", title: "Open bugs", children: [{ type: "stat", label: "Open", value: n },
   { type: "table", columns: ["Key", "Title", "State"], rows: [...] }] }`.
3. Add an action `"close"` (`"on": "handler:bugs"`, `"effects": "write"`) whose `act` returns a
   write (a child block "Closed PC-12"), or calls the tracker with a secret and returns a message.
4. `bugs:: mine` draws in Detail and the door; `extensions.render … target: "csv"` gives a sheet.

[fancy-horror](../../extensions/fancy-horror) is the canonical one.

## Rules: when a block matches

A **rule** says "when a block matches this, draw this on it, or run this" (PIE-600). The handler lines above
are the oldest case of it: a handler's `key` matches a `key::` line. A rule matches anything else, and never
changes the note's text.

```json
"rules": [
  { "id": "card", "match": { "property": "type=meeting" }, "decorate": { "place": "above" } },
  { "id": "bands", "match": { "kind": "heading:1", "under": "<a block id>" }, "decorate": { "use": "band", "pattern": "stack", "align": "center" } },
  { "id": "stamp", "match": { "property": "status=done" }, "on": { "start": "stamp", "stop": "unstamp", "quiet": "2s" } }
]
```

### `match`

Every condition given must hold; at least one is needed.

| Field | Matches | Evaluated by |
|---|---|---|
| `property` | `key=value` or `key`: the property case of `query` | the service's query matcher (`query.matches`), the views' grammar and index |
| `query` | a saved-view query (`type=meeting AND where="the shed"`) | the same |
| `view` | a saved view's block id: its `[query::…]` | the same |
| `under` | only blocks under this one (and it) | the same |
| `text` | a pattern, line by line, never in a code fence, a code span, a literal region or a `[key::value]` token; `(?i)` at the start ignores case; each line once, 16 lines per note at most | outline-core `ruleHits` |
| `kind` | a construct: `heading`, `heading:1`…`heading:6` (`h1`…), `callout`, `callout:<type>`, `list`, `rule` (a thematic break), `image` | outline-core `noteConstructs` |

Without `text` or `kind` the whole block matches; with them, each construct or line that does is a **hit**:
`{ at: "block" | "construct" | "text", line, end, text, level?, kind?, captures? }` (whole-text lines, `end` the line
after the last).

### `decorate`

| Field | Meaning |
|---|---|
| `place` | `above`, `below`, `replace` (in its place) or `around`. Default: a band or divider replaces, a box goes around, the rest above. A whole block's `replace` and `around` are `above`. With `match.text` also `span` (ADR 0004 contract 6: the characters the pattern hit, `hit.span`, drawn in `tone` on a capped-dark surface; the publisher a `<mark>`) and `margin` (a card beside them: the reader's margin column when it's wide, under the passage when it isn't) |
| `use` | a built-in decoration, no code: `band` (a heading in three rows of glyph track, PIE-599's banner), `divider` (one row of track), `card` (the block's title and `fields`), `badge`, `text`, `box` |
| `style` | a `band` or `divider` draws with this heading style ([heading styles](../../../../CHANGELOG.md), PIE-599: `[heading-style::name]` declarations and the built-ins `band`, `tab`, `waffle`, `uptime`, `dots`, `rule`, `fade`); `pattern`, `align` and `tone` go over it. Default: `band` (a divider: `fade`) |
| `label`, `tone`, `fields`, `pattern`, `align` | the built-in's words (a template: `{title}`, `{text}`, `{level}`, `{$1}`, any property `{status}`), tone, the card's property keys, the band's glyphs (`stack`, `waffle`, `uptime`, `dots`, `rule`) and where its words sit |
| `deadline` | a code rule's call |

Without `use`, the service runs the extension's **`decorate`** operation for each hit:

```json
{ "operation": "decorate", "input": { "rule": "card", "hit": { "at": "block", "line": 0, "end": 3, "text": "…" }, "context": { "block": { … }, "children": [ … ], "ancestors": [ … ], "now": "…" } } }
```

and it answers `{ "view": <primitive>, "title"?: "…" }`. The view is checked like a component's and kept like an
output (`extension_outputs`, `rule:` keys), known by the rule and what it matched (moving the line keeps it); it
runs again when the block's revision changes, showing the last one (`stale`) meanwhile. At most four run at once.

**What readers get:** `resources.projection.read` on a whole block carries `decorations`:

```json
{ "rule": "ext:meeting-card/card", "name": "meeting-card/card", "source": { "kind": "extension", "extension": "meeting-card", "rule": "card" },
  "hit": { "at": "block", "line": 0, "end": 1, "text": "Committee" }, "place": "above", "status": "ready",
  "view": { "type": "card", … }, "markdown": "**Committee** …", "ranAt": "…" }
```

`status` is `ready`, `stale`, `not-run` or `unavailable` (with `reason`). An `extensions.output` event names the
block when a code rule's view lands. The door draws `view` (a replaced heading keeps its fold point and `( )` stop;
`R` shows the note as written); Detail shows the decoration as text under what it matched, named by its rule; the
publisher puts its `markdown` in the page (a band is its `#` heading).

Two primitives exist for rules: `band` (`text?`, `level?` 1–3, `style?`, `pattern?`, `align?`, `row?` top, middle or
bottom, `tone?`) and `track` (`style?`, `pattern?`, `tone?`). The door draws them with the heading styles' drawer
(PIE-599): the named style (default `band`, a track `fade`) with the primitive's fields over it, and under the
figures' narrow width (48 columns) a band is its plain heading. Their text targets are a heading and `---`.

### `on`: change triggers

`on: { start?, stop?, change?, quiet? }` names actions (from `actions[]`, `on: block`) run on the block when it
**starts** matching, **stops** matching, or is saved while it **matches**, once it has been quiet for `quiet`
(default 2s): a burst of saves while typing is one trigger.

- Fed by the change feed: creates, edits, moves and restores.
- **No loops.** A save any extension made never sets a rule off; it only moves what the rule remembers. So
  `done-stamp`'s own `[done-at::]` write runs nothing, and neither does another extension's.
- **A rule starts from now.** Installing a rule over blocks that already match runs nothing for them.
- The action runs through `extensions.act`: its writes are `ext:<id>`'s, with `requestedBy` the person or agent
  whose save set it off.
- `extensions.list`'s `rules` says how many blocks match each trigger rule, and its last run (`lastRun`: when,
  which block, start, stop or change, its message or error).

### Rule notes: the no-code tier

A note with `[rule-name::name]` is a rule, with the outline (like `[callout-type::]`):

```text
Committee headings [rule-name::committee-bands] [rule-under::((<id>))] [rule-kind::heading:2] [rule-decorate::band] [rule-pattern::stack] [rule-align::center]
Meetings [rule-name::meetings] [rule-match::type=meeting] [rule-decorate::card] [rule-fields::when, attendees] [rule-label::{title} at {where}]
Shouting [rule-name::shouting] [rule-text::(\S.*?)!!!$] [rule-decorate::text] [rule-tone::warn]
```

`rule-match` (a query), `rule-view`, `rule-under`, `rule-text` (a `]` is written `\x5d`) and `rule-kind` match;
`rule-decorate`, `rule-place`, `rule-label`, `rule-tone`, `rule-fields`, `rule-pattern`, `rule-align` and `rule-style` (a heading style by name) draw. A
rule note never decorates rule notes' own words. What can't be used is listed in `extensions.list`'s
`ruleProblems` (the door says it once), and writing a rule note sends `extensions.changed`, so readers draw again.
Heading styles (PIE-599) are the outline's own list (`[heading-style::name]` on a note or any line of one, `headings.styles`); a rule's `band` and `track` are drawn by the same drawer and name a style with `rule-style` (a `--- [rule::fade]` divider's `[rule::…]` is that feature's, which is why a rule note is `[rule-name::…]`). A code rule is the tier above it.

## Component schemas: docs and completion

A component says once what its properties are (PIE-618), and the door makes its docs page and the completion of its
keys and values from that: there's no docs or completion code in an extension. `components[]` holds outline-core's
`ComponentSchema` (`@ep0ch/outline-core/component-schema`, the one the built-ins use), checked when the folder loads
by its `componentSchemaProblem` (a field it can't use fails the load, naming it: `components/0: sweep is a list of its
props' keys`):

```json
{ "id": "mood", "title": "Mood", "intro": "How a standup went.", "where": "`[mood::…]` on a standup's note",
  "props": [{ "key": "mood", "where": "line", "type": "enum", "meaning": "how it went",
              "values": [{ "value": "calm", "meaning": "nothing on fire" }, { "value": "stormy", "meaning": "something is" }] }],
  "source": { "use": "Standup [mood::{mood}]" }, "example": { "mood": "calm" },
  "sweep": ["mood"], "grids": [], "space": ["mood"] }
```

- `props[]`: `key`, `where` (`line`, `note` for a property of a note that declares a style or type, `yaml` for a
  figure's), `type` (`enum`, `int`, `number`, `levels`, `name`, `room`, `text`, `list`, `ref`, `template`, `pattern`,
  `query`), `meaning`, and as they apply `values` (each `{ value, meaning }`), `min` and `max`, `default`, `samples`
  (values worth drawing for a type with no list), `token` (how it's written when that isn't `[key::value]`), `use`
  (the source to show this property with).
- `source.use`: the text a variation writes, `{key}` a value and `{yaml}` the YAML properties given; `source.note`
  (`{ title, name, value, uses? }`): the declaring note a variation writes when it sets a `note` property.
- `example`, `sweep` (the properties drawn one value at a time), `grids` (`[key, key]` pairs), `space` (the axes of
  every combination).

The service answers every schema in one read, `components.schemas`: the built-ins (heading styles, callouts, rules,
`::graph-meter`, `::graph-spark`) with the outline's own styles and types among their values, then each serving
extension's, marked `origin: "ext:<id>"`. The door's completer offers `[key::` and the values; its library
(`ep0ch --screen library`) draws a page for each; `ep0ch library --json` prints them. A page draws a variation with
the readers' renderer, so a handler line with no projection reads as written there.

`rules.preview` (`note`, `text`): what a rule note, never saved, draws on a sample note's text, as `decorations`
draws a block's (a query, view or place in the outline is taken to hold). The library draws a rule's variations
with it.

## Actions

An action is one thing an extension can do, declared once, so every client binds the same thing:
the door as an `ActionDef` named `ext.<id>.<action>` with its key and click (the door's PIE-512: a
handler line's actions as keys and `[w ward]` controls under the line, a tile's in its tile kind),
`outliner ext act` from a shell, and `extensions.act` for agents. Detail doesn't bind extension
actions yet; `r` is its path today.

```json
{ "id": "ward", "label": "Ward off the next omen", "on": "handler:fancy-horror", "key": "w", "effects": "write" }
```

- `on`: `block` (any block; the default), `handler:<key>` (a line of that handler: the request
  names the block, and the line when there are several), `tile:<kind>` (needs no block), `bar` (a
  bar source's row runs it: no block, the row's `args`), `outline` (no block: the outline as a whole, what a
  [schedule](#a-schedule) runs; `ext act <id> <action>` and the door's `act ext.<id>.<action>` need no `block=`), or
  `passage` (below).
- **`on: "passage"`** (ADR 0004 contract 5): it acts on an exact span of a block's or a Resource's text. The request
  carries `passage: { subject, revision, quote, start, end, prefix, suffix }` (`subject` a block id or
  `resource:<id>`; outline-core `passage.ts` builds one: `passageAt`, `findPassage`). The service checks it before
  the action runs: at its revision the quote must be at `start`; at a newer one found exactly once with its prefix and
  suffix (the action gets the moved offsets); anything else is refused with the nearest match. The action gets
  `target: { passage, text, blockId?, revision?, resourceId? }` (`text`: the subject's text, to read around the
  passage). A door's selection fills it (`passage.act`, its toolbar: a click, or `a` then the action's `key`), and so
  do an agent's `quote=` with `near=` (`act ext.<id>.<action> block=… quote=…`) and `outliner ext act <id> <action>
  --block <id> --quote "<words>" [--near N]`. An action on a block's passage may update the block (through
  `draft.patch`, as below); a Resource's text is stored content, never edited, so on a Resource's passage it writes
  only blocks.
- `act` may also return `copy`: text for the person's clipboard (copy with a citation). A client copies it for the
  person; an agent gets it back and the person's clipboard is untouched.
- `act` may also return `open` (PIE-754): a block id, or a [Resource ref](#opening-a-resource) (`file:/path`,
  `web:https://…`, `resource:<id>`). The door opens it where the asker's opens land (a Resource registered first when
  it must be); `outliner ext act` prints `open <ref>`.
- `effects`: `read` (the default) answers only; `write` may return writes, and lets its process write over its
  connection. `effects` is about the outline, never about the outside world: an action that only writes to an outside
  service (sends a note to Reader, posts a message) and writes nothing in the outline is `read`; one that also writes
  the outline (a block, an annotation, a cursor on a page) is `write`. A handler that costs money or model time per
  run is `spend`. See [writes to an outside service](#writes-to-an-outside-service).
- `act` returns `{ message?, writes? }`. Writes are
  `{ "op": "create", "parentId", "text" }` or `{ "op": "update", "blockId", "expectedRevision", "text" }`,
  at most 20; an action on a passage may also write `{ "op": "annotate", "body"?, "properties"? }`, an annotation on
  the passage (ADR 0004 contract 6): no body is a highlight; `properties` are open (`kind`, `tags`, `color` as a theme
  tone: `default`, `good`, `warn`, `bad`, `dim`, `accent`, never a raw colour, or any key). They may land anywhere in
  the outline (PIE-754; a record an extension keeps is its sync's alone, so an update to one is refused); they apply
  together or not at all; each is `author: agent`, `actorId: ext:<id>`, under `ext.<id>.<action>` in the change feed.
  After an action on a `read` handler's line writes, that line runs again before the answer comes back.
- **An update is an agent's edit.** It is revision-checked against the saved note, then applied
  through `draft.patch` with the `edit` policy, as an `@agent`'s edit is: only the changed lines are
  the patch, a door's live draft of the note gets it (not the saved note under the person's typing),
  and the guard refuses one that drops a `[page::…]` or a linked `^anchor` (nothing is written; the
  error says what it would drop). When the person is typing in that passage it becomes a proposal
  (`proposalId` in the answer) and the action's other writes aren't made; its `message` says so.
- **A created block's text is inert BlockDown**: a `key::` line or `[key::value]` in it stays words,
  not a property, and terminal escapes go. (A block the extension's process creates over its
  [connection](#a-connection-to-the-service) is a normal write, properties and all, as an agent's is.) No write may add an `@name` request line (extensions
  can't ask agents).
- **Who asked.** `extensions.act` takes `mutation`: the
  person (`{ "author": "user" }`) or an agent (`{ "author": "agent", "actorId": "loki" }`);
  `author`/`provenance` as on `create` work too. The writes stay `ext:<id>`'s; each change in
  `changes.since` (and its live event) carries `requestedBy` with who asked. `outliner ext act` asks
  as the person, or as an agent with `--actor <id>`; a tile's program passes the person at its keys.
- `keep` is built in for every output and component handler.

```json
{ "action": "extensions.act", "extension": "fancy-horror", "extensionAction": "ward", "blockId": "…", "line": 1,
  "mutation": { "author": "agent", "actorId": "loki" } }
```

## Bar sources: a command palette's rows

A **bar source** (PIE-656) gives a client's command palette (the door's power bar, `ctrl+k`) rows of the extension's
own. It isn't a fifth kind: it only answers, and what a row does when picked goes through the paths every client
already has.

```json
"bar": [{ "id": "glyphs", "title": "glyphs", "prefix": "~", "description": "CP437 shades, blocks and box lines", "main": false }]
```

- `prefix`: one character (`! # $ & * : ; = ^ | ~`) that scopes the bar to this source when typed first; one the bar
  already uses (its own `% / > + @`, another extension's) is left off, and tab still reaches the source.
- `main`: its rows join the bar's main list (before a scope is chosen) as well as its own scope. Each pause in typing
  calls it, so only a quick source should.
- **The `bar` operation** gets `{ source, query, limit, context? }`: what was typed after the prefix, and the note in
  front of the person as `context` (bounded and read-only, as an action's). It returns `{ rows }`, at most 50:
  `{ id, label, detail?, preview?, block?, resource?, action?, args?, copy? }` (`resource`: a
  [Resource ref](#opening-a-resource), opened in place of a block).
  - `preview` is Markdown the client draws with its own renderer beside the list;
  - picking a row opens its `block` where opens land, runs its `action` through `extensions.act` (one of the
    extension's own, `on: bar` or `on: block` with the row's `block`; its `args` passed on, its writes attributed
    `ext:<id>` with who asked beside them), or puts `copy` on the clipboard.
- **The service checks each answer** (text cleaned, a `block` that exists, an `action` that's the extension's own and
  can run on that row, a row that does something) and refuses the whole answer, saying why, when one row is wrong.
- **`extensions.bar`** asks one: `{ "action": "extensions.bar", "extension": "glyphs", "source": "glyphs",
  "query": "shade", "near": "<block id>" }` → `{ extension, source, rows }`. It writes nothing. `extensions.list` lists
  every serving extension's sources as `barSources` (and each extension's own under `bar`), named
  `ext.<extension>.<source>`.

The example is [glyphs](../../extensions/glyphs): code page 437's shades and box lines by name, a row copying one,
and on a note a row that rules it with one (its `rule` action).

## Agents in the note

Not a fifth kind: an extension can also declare **agents** a person addresses from inside their own
writing (PIE-501). Evan writes `@tidy can you fix the formatting above` and keeps typing; the result
lands in the note while he goes on. That needs a door that says when he types in the draft it holds
(`drafts.touch`); with any other client the request runs once the line is saved.

```json
"agents": [{ "name": "tidy", "description": "Tidies the paragraph above", "effects": "read", "deadline": "30s" }]
```

- **In a comment thread** (`"threads": true` on the agent, ADR 0004 contract 6): a person's comment on a passage, or a
  reply in its thread, whose body has an `@name` line runs `respond` with `passage` (`subject`, `quote`, `start`,
  `end`, `prefix`, `suffix`), `note` (its text: the block's, or the Resource's), `thread` (each comment so far) and
  the thread's `properties`; its `reply` lands in the thread as `ext:<id>`. Patches are refused there (an answer in a
  margin isn't an edit). Only a person's comment asks: an agent's or an extension's never does. A door's Ask (the
  passage toolbar's `a a`) opens the comment on the selection with `@name ` written, `kind: question`.
  Marginalia's `@margin` is the example (`extensions/marginalia`).
- **Addressing.** A line that starts with `@name` (after an optional bullet), outside code, whose
  name an active extension answers. Any other `@word` is prose. Two extensions can't answer one
  name.
- **When it runs.** A request line that a person's save adds runs once the note has been quiet
  for a moment (1.5 s; every save restarts the wait), so a pause mid-sentence rarely sends half a
  request. A door holding the note's live draft calls `drafts.touch { holdId }` after the person
  types; the service reads that draft from the door, and a request line
  the person wrote there runs the same way once the draft is quiet, before any save. It runs once:
  rewording the line is a new request, removing an answered line and putting it back (an undo, within
  ten minutes) brings its answer back rather than asking again, and `r` on the line asks again. `r`
  on the note asks the requests in it not answered yet (not asked, waiting, failed). Lines that were
  already there wait for `r`: the service keeps, per note, the `@name` lines it last saw (any name,
  across restarts; notes from before this feature get theirs once, at start), so installing an
  extension doesn't wake old lines. A line an agent or an import wrote waits for a person's `r`, so
  agents can't set each other off: an agent's `r` on it is refused. No agent's `draft.patch` may
  write or reword a request line: one guard in `draft.patch` refuses it for every agent, with the
  reason. A request a restart cut off says so and `r` asks again; one still waiting for quiet when
  the service stops waits for `r`.
- **Who asked.** `r` takes the presser's `mutation` (`{ author: user }` or `{ author: agent,
  actorId }`; a person when absent) and records it as `requestedBy` (`user`, `agent:<id>`).
- **`respond`** gets the note as the person sees it (their live draft when a door holds one), the
  request (the words after the name) and the mark (the request line), plus bounded context. It
  answers any of:
  - `patches`: spans of the text above the mark (`observed` → `replacement`, with `before`/`after`
    context). The service applies them through `draft.patch` with the default `edit` policy: an
    ordinary edit, attributed `author: agent`, `actorId: ext:<id>`, under `ext.<id>.agent.<name>` in
    the change feed. A note held by a door gets the patch in its live draft. The spans are compared
    with the text as it is when the answer comes back (`draft.patch` with `current`), so typing
    elsewhere in the note is fine; if the person changed that passage meanwhile, the edit becomes a
    proposal beside the note, drawn under the line, to apply or dismiss. If the request line itself changed, the
    answer is dropped: the new wording is a new request.
  - `reply`: markdown shown under the line (inert, like an output). The note's text is untouched.
  - `message`: what it did, in a few words (`tidied 2 lines above`).
- **What readers get.** A projection of `kind: "agent"` on the request line, with
  `agent: { name, status, message?, proposalId?, requestedBy }`. `status` is `queued`, `not-asked`,
  `waiting` (an agent wrote it), `running`, `applied`, `proposed`, `dismissed`, `replied`, `nothing`
  or `failed`. A `proposed` request becomes `applied` or `dismissed` when the person settles its
  proposal (`draft.proposal.apply`, `draft.proposal.dismiss`).

[tidy](../../extensions/tidy) is the example: it tidies the paragraph above the line (or, with
`@tidy all`, everything above it) and never runs a model. A model-backed agent is the same folder
with `respond` calling one: `"effects": "spend"`, a `"deadline"` up to `"5m"`, and its key as a
secret reference.

## Kind 4: a whole tile

**What it is.** A program that is a tile: like nvim or the daily agent in a terminal tile, but registered as a
tile kind of its own (`tarot.reading`). The door's open tile-kind registry (PIE-505) makes, binds and
saves it like any built-in kind; the engine never switches on its name.

**The contract.** A `tiles[]` entry:

```json
{
  "kind": "reading", "name": "Tarot",
  "run": ["bun", "tile.ts"],
  "actions": ["draw", "keep"],
  "policy": { "resizable": true, "collapsible": true, "droppable": false },
  "accepts": [],
  "args": { "block": { "type": "block", "description": "Where k keeps a reading" } }
}
```

### What the door's registry consumes

`extensions.list` returns every active tile kind in `tileKinds`, ready to register:

```json
{
  "kind": "tarot.reading",
  "extension": "tarot",
  "name": "Tarot",
  "description": "Today's card; d draws again, k keeps it under the tile's block, q closes",
  "command": ["/home/you/.bun/bin/bun", "tile.ts"],
  "cwd": "/home/you/.config/pi-herdr-outliner/extensions/tarot",
  "host": "float-2",
  "env": { "OUTLINER_EXTENSION": "tarot", "EP0CH_WS": "pie", "EP0CH_SOCKET": "/home/…/outlines/.host/host.sock" },
  "actions": [
    { "id": "draw", "name": "ext.tarot.draw", "label": "Draw a card", "on": "tile:reading", "key": "d", "effects": "read" },
    { "id": "keep", "name": "ext.tarot.keep", "label": "Keep the reading", "on": "block", "key": "k", "effects": "write" }
  ],
  "policy": { "resizable": true, "collapsible": true, "droppable": false },
  "accepts": [],
  "args": { "block": { "type": "block" } },
  "save": "args"
}
```

| Registry entry | From |
|---|---|
| name | `kind` (`<extension>.<kind>`, unique) and `name` |
| how to make it | a pty tile running `command` in `cwd` with `env`, plus the door's own `EP0CH_CONTROL`, and the tile's args appended as `--name=value` |
| its actions | `actions`: bind each as an `ActionDef` named `name` with its `key`; it runs `extensions.act` (`extension`, `extensionAction: id`, and the tile's `block` arg as `blockId` when `on` is `block`) |
| default policy | `policy` (the layout design's per-container settings) |
| what it accepts | `accepts` (tile kinds it takes as drops; empty: none) |
| how it saves | `save: "args"`: a screen stores the kind and its args, nothing else |
| where it can run | `host`: the command is a path on the service's host. A door on another machine shows the kind as unavailable. |

When `extensions.changed` arrives the door reads `tileKinds` again: a removed extension's tiles say
their kind is gone instead of running something else.

**The program** draws itself in the tile's terminal and reaches the outline only through the service
(`extensions.act` on `EP0CH_SOCKET`, naming `EP0CH_WS`), or through `EP0CH_CONTROL`
for door actions. So what it writes is attributed to the extension, exactly as when an agent runs the
same action with no tile open.

**Worked example: "make me a pomodoro tile that logs each session in my journal".**

1. `extension.json` with `"run": ["bun", "pomodoro.ts"]`, an action
   `{ "id": "log", "label": "Log a session", "on": "block", "effects": "write" }`, and a tile
   `{ "kind": "timer", "name": "Pomodoro", "run": ["bun", "tile.ts"], "actions": ["log"],
   "args": { "block": { "type": "block" } } }`.
2. `pomodoro.ts` answers `act` for `log` with
   `{ writes: [{ op: "create", parentId: target.blockId, text: "Pomodoro: 25 min, " + args.task }] }`.
3. `tile.ts` draws the countdown; when it ends it sends one line to the outline socket:
   `{"id":"…","outline":"pie","action":"extensions.act","extension":"pomodoro","extensionAction":"log","blockId":"<--block>","args":{"task":"…"},"mutation":{"author":"user"}}`.
4. The door lists `pomodoro.timer` as a tile kind. An agent can log a session with no tile:
   `outliner ext act pomodoro log --block <journal id> --arg task=review`.

[tarot](../../extensions/tarot) is the canonical one; its README shows the program's key loop and
socket call.

## Extensions as programs

An extension is a program (PIE-754), not only something a line or a key calls: it can run on a schedule, reach the
outline over its own connection, write anywhere its host serves, read a `with-secrets` key, and keep a collection.
[almanac](../../extensions/almanac) is the example: every morning it writes a dated note under the `almanac` page.
[notify](../../extensions/notify) is a kit: a scheduled fetcher (GitHub for real, Gmail, Jira and Slack behind the same
shape) that writes one note per notification and seeds two boards.
[readwise](../../extensions/readwise) is the full one: an action that sends a note to Readwise Reader, and an hourly
pull, once per host, that writes each highlight back as an annotation at its passage, or onto a board in another
outline.

For a program that talks to an outside service, the sections below say how to run it once per host, make a sync
idempotent, keep its cursor, edit what it wrote, link and render a note, keep imported words inert, and test it with a
fake service; [the call reference](#the-call-reference) has every call's fields.

### A schedule

A handler or an action may declare `schedule`: `{ "every": "15m" }` (at least `1m`) or `{ "cron": "5 6 * * *" }`
(five fields, the host's local time). The service runs it and records every run.

```json
"actions": [{ "id": "write-day", "label": "Write today's almanac", "on": "outline", "effects": "write",
              "schedule": { "cron": "5 6 * * *" } }]
```

- **A scheduled action** acts on the outline (`"on": "outline"`, no block; a schedule on any other action is refused
  when the folder loads). It runs through `extensions.act` with `scheduled: { at, every | cron }` in its input and
  `context: { now }`. No one asked, so its writes carry no `requestedBy`.
- **A scheduled data handler** fetches again every key the outline asks it for (Jira's `pollEvery`, for any data
  handler). **An output or component handler** runs again every line of it in the outline.
- **When.** An `every` schedule first runs one interval after it's first seen; a cron at its next match (a cron that
  never matches, `0 0 31 2 *`, is refused when the folder loads). A run missed while the host was down runs once when
  it comes back, not once per miss. One run of an entry at a time, and an action on the outline runs one at a time
  whoever asks (its schedule, a person, an agent), so "is today's note there? then write it" never races itself.
- **Per outline, or once per host.** Runs are per outline, like everything an extension does. A folder in an outline's
  `extensions/` runs there; one in the user folder serves every outline the host opens, so its schedule runs in each
  (`EP0CH_WS` says which). Put a scheduled extension in the outline it belongs to, or, when its work isn't any one
  outline's (a sync that writes to several, a feed that notifies once), say **`"once": "host"`** (PIE-767):

  ```json
  "schedule": { "every": "1h", "once": "host" }
  ```

  Then one outline's runner holds it for the whole host (the first to see it, until that outline closes or stops serving
  the extension; then the next takes it, with its last run, so it is due one interval after that run) and the others list where it runs (`runsIn`). Its runs are one at a time across the host, and so
  is its action whoever asks, in any outline: a person's `ext act` in one outline waits for the scheduled run in
  another. `EP0CH_WS` is the outline holding it, so a host-wide program names the outlines it writes to (`outline`
  on each request). A run asked for by hand (`ext run`, `ext act`) runs in the outline it's asked in.
- **The record.** Each run's time, result and message (or error) is kept beside the outline
  (`extension-schedules.json` in its folder), so a restart keeps it. `extensions.list` gives each extension's
  `schedules: [{ entry: "action:write-day", cron, once?, runsIn?, next, running?, last?: { at, ok, message?, error?, ms } }]`
  (a host-wide one another outline holds: its `next`, `running` and `last` are that outline's);
  `ep0ch ext ls` prints `schedule action:write-day (cron 5 6 * * *): next … ; last … ok: …`; the door's
  extensions list (the showcase's `extensions` section) shows the same.
- **Run it now:** `ep0ch ext run almanac action:write-day` (`extensions.schedule.run { extension, entry }`), recorded
  like any run. A scheduled action is also an ordinary action: `ep0ch ext act almanac write-day`, or the door's
  `act ext.almanac.write-day`.

### A connection to the service

Every process the service starts for an extension (a handler, an action, a rule, a bar source, an agent) gets:

| Variable | What |
|---|---|
| `EP0CH_SOCKET` | where the service listens (the outline host's socket) |
| `EP0CH_WS` | the outline it runs for |
| `EP0CH_EXT_GRANT` | who it is: a token valid while this process runs, revoked when it ends |
| `OUTLINER_EXTENSION` | its id |

A request that carries the grant (`"grant": "<EP0CH_EXT_GRANT>"`) is the extension's: what it writes is
`author: agent`, `actorId: ext:<id>`, under `ext.<id>.<action>` in the change feed, with `requestedBy` the person or
agent who asked for the run (none for a scheduled one). Without the grant `ext:<id>` stays reserved, and a grant from
a process that ended is refused. Copy [almanac's `outline.ts`](../../extensions/almanac/outline.ts) into your folder:

```ts
import { outline } from "./outline";
const home = await outline<{ status: string; block?: { id: string } }>({ action: "pages.resolve", address: "almanac" });
const note = await outline({ action: "create", parentId: home.block!.id, text: "Almanac for 2026-10-09 [type::almanac]" });
await outline({ action: "get", blockId: "…" }, "another-outline");   // any outline the host serves, by name
```

One request per connection: a JSON line out (`{ id, outline?, grant, action, … }`), a JSON line back
(`{ ok, result | error }`). A refusal is `ok: false` with `error` in words (outline.ts throws it), and saying what
to do: `… was saved since it was read (revision 4, now 5); read it again`.

The calls an extension makes most, with what each takes and answers, are [the call reference](#the-call-reference)
below.

### Writes anywhere, through the normal paths

Over its connection an extension may **read** (`get`, `children`, `pages.resolve`, `blocks.query`, `tree.search`,
`annotations.list`, `changes.since`, `notes.address`, `notes.render`, …) and **write** through the paths a person's or an agent's writes take:

| Write | Request | What holds |
|---|---|---|
| create | `create { parentId, text }` | a normal block: properties and all, as an agent's |
| update | `update { blockId, expectedRevision, text }` | revision-checked, then a `draft.patch` under the `edit` policy: a door's live draft gets it, and while the person types in that passage it becomes a proposal (the answer is `draft.patch`'s: `{ outcome: "applied" \| "proposed", proposalId? }`); the guard refuses one that drops a `[page::…]` or a linked `^anchor` |
| edit | `draft.patch { edits \| blockId, revision, patches }` | the same guard |
| comment, annotate | `annotations.batch` (a `block-comment` on a `passage`), `annotations.create`, `annotations.reply` | an annotation with `properties` (`kind`, `tags`, `color`, any key), its source an agent's |

- **Only a call that may write writes**: an action with `effects: "write"` (or a handler with `effects: "write"`).
  Every other call's connection reads only, as its answer may, and a write from it is refused saying so.
- **No secret it was given lands in the outline**: a write's text is scrubbed of its secret values, as its answers are.
- **No extension write sets an extension off**: handler lines it writes don't run, rules don't fire, an `@name` line
  it writes waits for a person's `r`.
- Anything else (moving, deleting, settings, `extensions.act`) is refused with what it may do.
- An action's returned `writes` (above) may land anywhere in its outline too; over the connection, in any outline the
  host serves (name it with `outline`).

### Writes to an outside service

`effects` says what a call may do to the **outline**; the service can't see or limit what it does elsewhere.

| What the action does | `effects` | Why |
|---|---|---|
| Only reads the outline and writes to an outside service (sends a note to Reader, posts a notification) | `read` | Its connection reads only, which is all it needs. A person's or agent's `act` runs it. |
| Also writes the outline (the results, a cursor, a "sent" mark) | `write` | Its returned `writes` and its connection's writes are allowed, as `ext:<id>`. |
| A handler line whose every run costs money or model time | `spend` | It runs by itself only once, when a person's save adds the line. |

An outside write isn't revision-checked or undoable from the outline, so make it safe to repeat: send with the outside
service's own idempotency (Reader keeps the first document for a URL, so `send` twice says it's there), or record
what you sent in the outline and check it first. Write a refusal the person can act on into `message` (it is
shown, scrubbed of secrets); a failure the service should report is `{ ok: false, code }`.

### Making a sync idempotent

A sync runs again and again (on its schedule, by hand, after a crash halfway), so each run must find what an
earlier one wrote and write only what changed. Readwise's pull is the pattern:

1. **Key everything by the outside id, in a property.** Each highlight's block carries `[readwise.highlight::201]`;
   each annotation carries it in its `properties`. Properties are open and queryable, so the key is how you find it.
2. **Look before writing.** Find the block (`blocks.query` with `where: "readwise.book=8"` and `subtreeRootId`), or the
   annotations on a note (`annotations.list`, then `properties["readwise.highlight"]`). Found: compare, and `update`
   only when the text differs. Not found: `create`.
3. **Compare the whole text you would write** with what is there (`block.text !== wanted`): an unchanged block isn't
   written, so a run that changed nothing writes nothing and adds nothing to the change feed.
4. **Keep a cursor** (below) so the next run asks the outside service only for what changed since.

**`requestId` is a retry key, not a sync key.** `annotations.batch`, `annotations.create` and `annotations.reply`
take one: the same id with the same operations answers the first receipt again (`deduplicated: true`) and writes
nothing; the same id with *different* operations is refused (`Annotation request ID was already used with different
input`). Ids are kept for good. So make it unique per write, and stable across a retry of that same write:
Readwise uses `readwise-<highlight>-<block>-<revision>`, so a retry of one comment dedupes, and a later run against
an edited note (a new revision) is a new request. Finding what's already there is step 2's job, not the id's.

A **collection** (a data handler answering `records`, [below](#collections)) is idempotent by itself: keyed records
the service writes, updates and trashes. Use one when the outside records belong as blocks under one line and fit in
500 per answer. Anything else (annotations at a passage, writes to several notes or outlines, more than 500, a cursor)
is a program writing over its connection, with the steps above.

### Where an extension keeps its state

| State | Where | Not |
|---|---|---|
| A sync's cursor, last-synced time, a page token | Properties on a block the extension owns in the outline: Readwise keeps `[readwise.synced::…]`, `[readwise.sweep::…]` and `[readwise.next-page::…]` on its board page, and reads them back with `get` or `pages.resolve` | Its own folder: a write there is a change the service watches, so it reloads the extension and discards the answer of any call running then |
| The records it syncs | Blocks (a collection, or its own writes) with its keys as properties | A file beside the outline, which no view, search or backlink sees |
| Settings and secret references | `config.json` (the person's) and the manifest's `secrets` | Anything the extension writes |
| Its schedule's runs | The service's own record (`extension-schedules.json`) | |

State in the outline is shared by every machine that serves it, backed up with it, visible (`[readwise.synced::…]` on
the page says when it last pulled) and revision-checked: read the page, `update` it with the revision you read, and
a concurrent run fails its write instead of losing one. Namespace the keys with the extension's id.

### Editing an annotation's body

An annotation is a block: `annotations.list` answers each thread's `block` (its id and revision) and `body`. The body
is part of that block's text, so to change it, `get` the block and `update` it with the body replaced, checked
against the revision you read:

```ts
const current = await outline<Block>({ action: "get", blockId: thread.block.id });
const at = current.text.lastIndexOf(thread.body);
const text = at >= 0 ? current.text.slice(0, at) + newBody + current.text.slice(at + thread.body.length) : `${current.text.trimEnd()}\n${newBody}`;
if (text !== current.text) await outline({ action: "update", blockId: current.id, expectedRevision: current.revision, text });
```

The passage it is anchored to, its properties and its thread stay as they are. To add to the conversation instead, reply
(`annotations.reply`, its `annotationId` the thread's `block.id`).

### A note's address and its rendering

Two calls let an extension say where a note is and send it somewhere as it reads (PIE-767):

- **`notes.address`** answers the outline's name, this host's **machine** name (as `ep0ch://` URIs name it: the
  door's `canonicalLocalMachineName`) and, with `blockId`, the note's `uri` (`ep0ch://garden@float-2/b/<id>`) and, when
  it is published and not `[publish::never]`, `published`: its `slug`, whether it is `public`, and its web URLs:
  `url` (by its slug), `publicUrl` (a public note's, for anyone with the link) and `permalink` (by its id: `/p/<id>`,
  which holds while it stays published, whatever its slug). The URLs come from the publisher: `ep0ch publish serve`
  tells the service where it is opened, from `--url` (OUTLINER_PUBLISH_URL, the tailnet listener's full URL:
  `https://host.ts.net/pub`) and `--public-url`; with no publisher connected there is a slug but no URL.
- **`notes.render`** renders a note and the notes under it with the publisher's own renderer, published or not:
  `format: "markdown"`, or `"html"` (the article, no page around it). Properties are left out, embeds are drawn, a link
  to a published note is its web URL (or its label, with no publisher URL), and `audience: "public"` links only public
  notes. A note that is `[publish::never]`, or under one, is refused: nothing sends it out of the outline. Readwise's
  `send` sends this HTML.

The machine name is this host's. A person who reaches the host from another machine by an ssh name (`--machine
float-2`) may know it by that name; an extension that builds links for a particular machine takes a config override,
as Readwise's `machine` does.

### Imported text: keep its words words

Text from outside (a highlight, a message, a title) must not become properties or links when it lands in a note:

- **A code span or fence is the escape for links and properties** (PIE-764, #366): `` `[[Herons]]` ``,
  `` `((ref))` `` and `` `[mood::calm]` `` are text, for every reader, the index and the publisher. Use it for text
  that *is* code or a literal (an id, a command, a path).
- **For prose, a backslash** (a highlight in monospace reads wrong, and a backtick in the text needs a longer
  fence). A `[key::value]` takes outline-core's escape, `\[mood::calm]`. A link is a pair, so break the pair: a
  backslash after each `[` or `(` that has another after it (`[\[Herons]]`, `(\(ref))`), so no two are side by side
  and no reader finds a link. Readwise's `inert()` does both in one line:

  ```ts
  const inert = (text: string) => text.replace(/\r/g, "").replace(/\[(?=[A-Za-z][\w.-]*::)/g, "\\[")
    .replace(/\[(?=\[)/g, "[\\").replace(/\((?=\()/g, "(\\");
  ```

  The publisher, `notes.render`, Detail and Reader draw the words without the backslash (`[[Herons]]`, as Markdown
  escapes do); the door's note surface shows it as typed, as it does a `\[key::value]`'s. This is the escape: the
  grammar has no separate one for `[[` and `((`, and needs none (PIE-767 checked; adding one would change what
  outline-core matches in text people already wrote).
- **A block an action's `writes` creates is inert** by itself (its `key::` lines and `[key::value]` stay words); a
  block written over the connection is a normal write, so escape what you import there.

### Secrets by with-secrets group

```json
"secrets": { "token": { "group": "readwise", "key": "READWISE_TOKEN", "description": "Readwise access token" } }
```

When a call starts the service reads `~/.config/secrets/readwise.env` (`WITH_SECRETS_DIR` moves the folder, as for
`with-secrets`; on macOS a group with no file falls back to the Keychain the way `with-secrets` does) and passes that
one key to that extension's process only: as `credentials.token` on stdin and as `READWISE_TOKEN` in its environment.
The rest of the group never reaches it, no other extension gets it, it's never logged, stored in the outline or
returned (the answer is scrubbed). A group file others can read is refused (`run: chmod 600 …`); a missing key says
`with-secrets --add readwise READWISE_TOKEN`. The service itself never runs under `with-secrets`.

### Collections

A data handler's `read` may answer many records, keyed by the extension's own ids (a library of highlights):

```json
{ "record": { "title": "Readwise highlights", "fields": [], "body": "" },
  "records": [{ "key": "hl-1043", "title": "On herons", "fields": [{ "key": "book", "value": "Pond Days" }], "body": "…" }],
  "complete": false }
```

- The line's record (`readwise:: highlights`) is the collection's block; each record is a block under it the
  extension owns, `[readwise.key::hl-1043]` and its fields as properties, queryable like any.
- **Idempotent.** A key written again updates its own block, and an unchanged one isn't written. New keys go last.
- `complete: true` says the list is the whole collection: a member it no longer names goes to Trash (restorable, and
  back with what's on it when named again). Without it, members are only added and updated, for a sync that fetches
  what changed since.
- At most 500 records an answer; two with one key refuse the whole answer. A scheduled handler (above) keeps it
  fresh.
- **Collection or program?** A collection is the right shape when the outside records belong as blocks under the
  line that asks for them and a full or "since" list fits in 500. Annotations at a passage, writes to several notes or
  outlines, a cursor and more than 500 records a run are a program: a scheduled action writing over its connection
  ([idempotently](#making-a-sync-idempotent)).

### Opening a Resource

Where a view, a bar row or an action answer names something to open, it may name a Resource instead of a block, by a
**Resource ref** (outline-core `resource-ref.ts`): `file:/absolute/path`, `web:https://…` or `resource:<id>`.

- A bar row's `resource`; a table's `links` and a card's `link`; an action's `open`.
- The door opens it the way the links tile opens a Resource row: registered first when it isn't yet, then its
  stored text shown as a note, where opens land (`act open resource=<ref>`).
- A bad ref is refused with why (`file: takes an absolute path`). A `[file::…]` token in a block an action returns is
  inert words; write it over the connection, or link it from a view, to make it something to open.

## The call reference

What each call takes and answers (PIE-767). The tables are written from the service's own types
(`src/extension-call-reference.ts`, by `bun scripts/extension-calls-doc.ts`), and
`test/extension-call-reference.test.ts` fails when a field changes and they weren't written again. A request is
`{ action, …its fields }`; outline.ts adds `id`, `outline` and `grant`, and the service sets who wrote it (`ext:<id>`),
so no call takes `author`, `provenance` or `mutation` from an extension. Over a connection an extension may also read
`blocks.read`, `blocks.context`, `block.revisions`, `tree.search`, `references.backlinks`, `changes.since`,
`activity.recent`, `annotations.get`, `properties.inventory`, `extensions.list` and the rest of the read-only calls;
their types are in `src/types.ts` (`OutlinerRequestAction`).

<!-- extension-calls:start (written by scripts/extension-calls-doc.ts from src/extension-call-reference.ts; don't edit by hand) -->

#### `get`

One block whole: its full text, properties, revision and who last wrote it. A block that isn't there is refused.

| Field | Type | |
|---|---|---|
| `blockId` | `string` |  |

Answers `Block`.

#### `children`

A block's children in order, each whole (`null`: the outline's top level). Trash is left out.

| Field | Type | |
|---|---|---|
| `parentId` | `string \| null` |  |

Answers `Block[]`.

#### `blocks.query`

Blocks matching a question in the views' grammar (`where: "readwise.book=8"`), under a block (`subtreeRootId`), by text (`text`), sorted, grouped and counted. The usual way to find what a sync wrote before, by its own key. (`fields` projects the rows, and answers `ProjectedBlockCollection`; `watch` keeps a question on a connection, which an extension's one-request connection can't.)

| Field | Type | |
|---|---|---|
| `query` | `BlockSearchQuery` |  |

Answers `VisibleBlockCollection`.

#### `pages.resolve`

The block a page address names (`[page::readwise]` answers `readwise`), or why none does.

| Field | Type | |
|---|---|---|
| `address` | `string` |  |

Answers `PageAddressResolution`.

#### `create`

A new block under `parentId` (none: the top level), last among its siblings. Properties in its text are properties.

| Field | Type | |
|---|---|---|
| `parentId?` | `string \| null` |  |
| `text` | `string` |  |

Answers `Block`.

#### `update`

A block's whole new text, checked against the revision you read. The service applies only the lines that changed, as a `draft.patch` under the `edit` policy: a door's live draft gets it, and while the person types in that passage it becomes a proposal (`outcome: "proposed"`). Text that didn't change answers the block as it is.

| Field | Type | |
|---|---|---|
| `blockId` | `string` |  |
| `text` | `string` |  |
| `expectedRevision` | `number` |  |

Answers `Block \| DraftPatchResult`.

#### `annotations.list`

The comment threads on a block (or a Resource), each with its replies and its own properties.

| Field | Type | |
|---|---|---|
| `query` | `AnnotationListQuery` |  |

Answers `AnnotationThread[]`.

#### `annotations.batch`

Up to 100 comments in one write, all or none: a `block-comment` on a block (at a `passage`, or the whole block), a `reply`, a `resource-comment`. `requestId` makes a retry safe: the same id with the same operations answers the first receipt again (`deduplicated: true`) and writes nothing; the same id with other operations is refused.

| Field | Type | |
|---|---|---|
| `requestId` | `string` |  |
| `operations` | `AnnotationBatchOperation[]` |  |

Answers `AnnotationBatchReceipt`.

#### `annotations.reply`

A reply in a thread; `requestId` as `annotations.batch`'s.

| Field | Type | |
|---|---|---|
| `requestId` | `string` |  |
| `input` | `AnnotationReplyInput` |  |

Answers `AnnotationBatchReceipt`.

#### `changes.since`

What changed in the outline after `sequence` (a cursor you keep), oldest first: each change's block, kind and who wrote it. The way to react to the outline ("a note mentions me", "a card moved") without reading it all: keep `nextSequence` as your cursor ([where state lives](#where-an-extension-keeps-its-state)); a `reset` page says the history is gone, so read what you need afresh and resume from its `sequence`.

| Field | Type | |
|---|---|---|
| `sequence` | `number` | The cursor: the changes after it are answered. The last page's `nextSequence`. To start from now, ask with `Number.MAX_SAFE_INTEGER`: the `reset` it answers has the current `sequence`. |
| `limit?` | `number` | At most this many changes (default 200, at most 1000); a page never splits one sequence. |

Answers `ChangeFeedPage`.

#### `notes.address`

The outline, this machine's name and, with `blockId`, the note's `ep0ch://` URI and its web URLs when it is published.

| Field | Type | |
|---|---|---|
| `blockId?` | `string` |  |

Answers `NoteAddress`.

#### `notes.render`

A note and the notes under it, rendered by the publisher's renderer (Markdown or HTML), published or not.

| Field | Type | |
|---|---|---|
| `blockId` | `string` |  |
| `format` | `"markdown" \| "html"` |  |
| `audience?` | `"tailnet" \| "public"` |  |
| `marks?` | `boolean` |  |

Answers `RenderedNote`.

#### The types they name

**`Block`**: A block as the service sends it whole. Projected reads (`fields`) send a subset.

| Field | Type | |
|---|---|---|
| `id` | `string` |  |
| `parentId` | `string \| null` |  |
| `position` | `number` |  |
| `text` | `string` |  |
| `revision` | `number` |  |
| `author` | `BlockAuthor` |  |
| `actorId?` | `string` |  |
| `sessionId?` | `string` |  |
| `taskId?` | `string` |  |
| `createdAt` | `string` |  |
| `updatedAt` | `string` |  |
| `deletedAt?` | `string` |  |
| `effectiveDeletedRootId?` | `string` |  |
| `properties` | `BlockProperty[]` |  |

**`BlockProperty`**

| Field | Type | |
|---|---|---|
| `key` | `string` |  |
| `value` | `string` |  |

**`BlockSearchQuery`**: `blocks.query`'s question. `where` (the views' grammar), `this`, `group`, `sort`, `limit` and `facets` are the question every client writes (outline-core's `QuestionFields`, ADR 0004); `filters`, `predicate`, `text`, `subtreeRootId`, `rankViewId`, `includeDeleted` and `propertyScope` narrow it the way Tree and the CLI need. Normalized (`normalizeBlockSearchQuery`), `where` is parsed into `predicate`, `this` is bound, `sort` is an object and `limit` is set.

| Field | Type | |
|---|---|---|
| `filters?` | `PropertyFilter[]` |  |
| `predicate?` | `QueryExpression` | Structured predicate, ANDed with filters and `where`. |
| `where?` | `string` | Query text in the documented grammar, parsed by the service and ANDed with predicate. |
| `this?` | `string` | The block `this` stands for in `where` (a component's note, a tile's aim). |
| `text?` | `string` |  |
| `subtreeRootId?` | `string` |  |
| `rankViewId?` | `string` |  |
| `includeDeleted?` | `"roots" \| "all"` |  |
| `propertyScope?` | `PropertyQueryScope` |  |
| `sort?` | `string \| BlockQuerySort` | An object, or `"<field>[ asc\|desc]"` (asc unless said). |
| `limit?` | `number` | Rows returned: 200 when left out, at most 1000. |
| `group?` | `string` | A property name, or created:day\|week\|month, updated:day\|week\|month: the answer's `groups`, over every match. |
| `facets?` | `true \| string[]` | `true`: value counts for every key the matches carry; or these keys. |

**`VisibleBlockCollection`**

| Field | Type | |
|---|---|---|
| `blocks` | `VisibleBlock[]` |  |
| `completeness` | `BlockCollectionCompleteness` |  |
| `generation?` | `number` |  |
| `groups?` | `QuestionGroup[]` |  |
| `facets?` | `QuestionFacet[]` |  |
| `hint?` | `string` | Said only when a key the question names is carried by no block in the outline: "no notes have <key>; nearest: …". |

**`VisibleBlock`**

| Field | Type | |
|---|---|---|
| `depth` | `number` |  |
| `deletedDescendantCount?` | `number` |  |
| `hasChildren` | `boolean` |  |
| `displayText` | `string` |  |
| `propertyMatches?` | `PropertyMatchContext[]` |  |
| `id` | `string` |  |
| `parentId` | `string \| null` |  |
| `position` | `number` |  |
| `text` | `string` |  |
| `revision` | `number` |  |
| `author` | `BlockAuthor` |  |
| `actorId?` | `string` |  |
| `sessionId?` | `string` |  |
| `taskId?` | `string` |  |
| `createdAt` | `string` |  |
| `updatedAt` | `string` |  |
| `deletedAt?` | `string` |  |
| `effectiveDeletedRootId?` | `string` |  |
| `properties` | `BlockProperty[]` |  |

**`PageAddressResolution`**

| Field | Type | |
|---|---|---|
| `address` | `string` |  |
| `normalizedAddress` | `string` |  |
| `status` | `"resolved" \| "deleted" \| "missing"` | `resolved` (then `block`), `deleted` (its block is in Trash) or `missing` (no block has that address). |
| `registeredAddress?` | `string` |  |
| `kind?` | `PageAddressKind` |  |
| `block?` | `Block` |  |
| `deletionRootId?` | `string` |  |

**`DraftPatchResult`**

- `DraftPatchApplied`
- `DraftPatchProposed`

*`DraftPatchApplied`*

| Field | Type | |
|---|---|---|
| `outcome` | `"applied"` |  |
| `edits` | `{ blockId: string; route: DraftPatchRoute; revision?: number \| undefined; holder?: string \| undefined; rebasedFrom?: number \| undefined; }[]` |  |

*`DraftPatchProposed`*

| Field | Type | |
|---|---|---|
| `outcome` | `"proposed"` |  |
| `reason` | `string` | Why it didn't apply, in words. |
| `proposalId` | `string` | The proposal block, beside the note: a new one, or the same open one this actor proposed before (`deduped`). |
| `beside` | `string` | The note it sits beside (a child of it), whose text and revision it left as they were. |
| `deduped?` | `true` | Set when the same actor's same patch was already open beside the note: `proposalId` is that one, and nothing was written. |

**`AnnotationListQuery`**

| Field | Type | |
|---|---|---|
| `subject` | `{ readonly kind: "block"; readonly blockId: string; } \| { readonly kind: "resource"; readonly resourceId: string; }` | The block (`{ kind: "block", blockId }`) or Resource (`{ kind: "resource", resourceId }`) the threads are on. |
| `lifecycle?` | `AnnotationLifecycle` | Only `open` or only `resolved` threads. |
| `includeResolved?` | `boolean` | Resolved threads too (left out by default). |

**`AnnotationSubject`**

- `{ readonly kind: "block"; readonly blockId: string; }`
- `{ readonly kind: "resource"; readonly resourceId: string; }`
- `{ readonly kind: "legacy-file"; readonly sourceBlockId: string; readonly filePath: string; }`

**`AnnotationThread`**

| Field | Type | |
|---|---|---|
| `replies` | `AnnotationRecord[]` |  |
| `block` | `Block` | The annotation's own block: its id is the annotation's, and its text holds the body (update the block to edit the body). |
| `originalTarget` | `AnnotationTarget` |  |
| `resolvedTarget` | `AnnotationTarget \| null` | Where it is anchored now (the passage, re-found after edits), or null when its words are gone. |
| `currentResolution` | `AnnotationResolutionEvent` |  |
| `resolutionHistory` | `readonly AnnotationResolutionEvent[]` |  |
| `body` | `string` | What it says; empty for a highlight. |
| `source` | `AnnotationSource` |  |
| `lifecycle` | `AnnotationLifecycle` |  |
| `promotedBlockIds?` | `readonly string[]` |  |
| `parentAnnotationId?` | `string` |  |
| `properties?` | `Readonly<Record<string, readonly string[]>>` | Its own properties (`kind`, `tags`, `color`, any other), the store's bookkeeping keys left out. |

**`AnnotationBatchOperation`**

- `{ readonly operationId: string; readonly type: "block-comment"; readonly input: BlockCommentInput; }`
- `{ readonly operationId: string; readonly type: "resource-comment"; readonly input: ResourceCommentInput; }`
- `{ readonly operationId: string; readonly type: "create"; readonly input: AnnotationCreateInput; }`
- `{ readonly operationId: string; readonly type: "reply"; readonly input: AnnotationReplyInput; }`

**`BlockCommentInput`**

| Field | Type | |
|---|---|---|
| `blockId` | `string` |  |
| `expectedRevision` | `number` | The block's revision you read: a block saved since is refused. |
| `body` | `string` | Empty for a highlight (a passage's annotation with no body). |
| `source` | `AnnotationSource` | `user` or `agent`; an extension's is always `agent` (the service sets it). |
| `properties?` | `Readonly<Record<string, string \| readonly string[]>>` | Its own properties, open (`kind`, `tags`, `color` as a theme tone, any key): `annotations.list` answers them, and a view's `where=` finds them. |
| `passage?` | `BlockCommentPassage` | Omit only for an intentional whole-block comment. |

**`BlockCommentPassage`**: A quote is exact source text; optional context must identify one occurrence.

| Field | Type | |
|---|---|---|
| `quote` | `string` | The words, exactly as the block's text has them. |
| `start?` | `number` | Where the quote starts in the block's text, when you know. |
| `near?` | `number` | Among repeats, the one nearest this offset (an agent's `near=`). |
| `prefix?` | `string` | Text just before the quote, to tell repeats apart. |
| `suffix?` | `string` | Text just after the quote, to tell repeats apart. |
| `itemId?` | `string` |  |

**`AnnotationReplyInput`**

| Field | Type | |
|---|---|---|
| `annotationId` | `string` | The thread's first annotation (`AnnotationThread.block.id`). |
| `body` | `string` |  |
| `source` | `AnnotationSource` | `user` or `agent`; an extension's is always `agent` (the service sets it). |

**`AnnotationBatchReceipt`**

| Field | Type | |
|---|---|---|
| `annotations` | `AnnotationRecord[]` | What was written, one per operation, in order. |
| `deduplicated` | `boolean` | True when the `requestId` had been used with these same operations: the first receipt, and nothing written now. |

**`ChangeFeedPage`**

- `{ kind: "changes"; changes: OutlinerChange[]; nextSequence: number; completeness: BlockCollectionCompleteness; sequence: number; }`
- `{ kind: "reset"; reason: "history-unavailable" \| "sequence-ahead"; oldestSequence: number; sequence: number; }`

**`OutlinerChange`**

| Field | Type | |
|---|---|---|
| `sequence` | `number` | Service sequence after the change; changes are ordered by sequence, then `changeId`. |
| `changeId` | `number` | Monotonic feed position; unique even when two changes share a sequence. |
| `action` | `string` | The request (or internal) action that caused the change. |
| `kind` | `OutlinerChangeKind` |  |
| `blockId?` | `string` | Primary block. Other blocks (a moved subtree, reordered siblings) may change too. |
| `parentId?` | `string \| null` | Parent after the change; `null` for a root. Absent without a readable block. |
| `previousParentId?` | `string \| null` | Parent before a `move`. |
| `revision?` | `number` | Block revision after the change. |
| `deleted?` | `boolean` | True when the block is in Trash after the change. |
| `actor?` | `MutationProvenance` | Declared provenance of the request; absent when the request carried none. |
| `requestedBy?` | `MutationProvenance` | Who asked for the change when that isn't its writer: an extension's action (`actor` `ext:<id>`) run for the person or an agent (`extensions.act`'s `mutation`). Absent when the writer acted on its own. |
| `recordedAt` | `string` |  |

**`NoteAddress`**: A note's address (`notes.address`, PIE-767): the outline and this host's machine name (what an `ep0ch://` URI names), the note's URI, and where it is published when it is.

| Field | Type | |
|---|---|---|
| `outline?` | `string` | The outline's name; absent on a service that serves no named outline. |
| `machine` | `string` | This host's machine name in `ep0ch://` URIs (the door's `canonicalLocalMachineName`). |
| `blockId?` | `string` |  |
| `uri?` | `string` | `ep0ch://<outline>@<machine>/b/<id>`, with `blockId` and a named outline. |
| `published?` | `NotePublication` | Where the publisher serves it, when it is published (and not `[publish::never]`). |

**`NotePublication`**: Where a note is published (`notes.address`, PIE-767).

| Field | Type | |
|---|---|---|
| `slug` | `string` | Its slug: the page is at `/p/<slug>` below the publisher's base. |
| `public` | `boolean` | `[publish::public…]`: anyone with the link may open it. |
| `url?` | `string` | Its tailnet URL, by its slug: when the publisher said where it is opened (`--url`). |
| `publicUrl?` | `string` | Its URL for anyone with the link, by its slug: a public note, when the public URL is known (`--public-url`). |
| `permalink?` | `string` | Its URL by its block id (`/p/<id>`): holds while it stays published, whatever its slug. The public one when it is public. |

**`RenderedNote`**: A note rendered as its published page renders it (`notes.render`, PIE-767).

| Field | Type | |
|---|---|---|
| `blockId` | `string` |  |
| `title` | `string` | Its title as the page shows it. |
| `format` | `"markdown" \| "html"` |  |
| `text` | `string` | The Markdown, or the HTML article (no page, styles or scripts around it). |
| `published` | `boolean` | Whether it is published itself (rendering doesn't need it to be). |

<!-- extension-calls:end -->

## ADR 0004: what has shipped

The kernel contracts of [ADR 0004](../../../../docs/adr/0004-kernel-contracts.md), kept current with each slice.

| Contract | Slice | State | Where |
|---|---|---|---|
| 1. A component's query input: `this`, `linkedfrom:`, `parent:`, groups, facets, watched questions | PIE-745 | shipped | `blocks.query`, `queries.changed` |
| 1. `::links` answered whole (`components.answer`) | PIE-746 | not yet | |
| 2. Presets | PIE-746 | not yet | |
| 3. The `list` primitive, component ids | PIE-747 | not yet | |
| 1. A handler declares a question | PIE-748 | not yet | this README's first "Not yet" |
| 1. Live figures' data from the service, `expand` on reads | PIE-749 | not yet | |
| 4. One source row contract, `sources[]`, contract 3 | PIE-750 | not yet (manifests are contract 2) | |
| 5. The passage target | PIE-751 | shipped | [`on: "passage"`](#actions) |
| 6. Highlights and margin notes, annotation properties | PIE-753 | shipped | `annotate` writes, `properties` on annotations |
| Extensions as programs (not in 0004: schedule, connection, writes anywhere, group secrets, collections, Resource refs) | PIE-754 | shipped | [above](#extensions-as-programs) |
| Cold-start run 2's gaps: the call reference, a schedule once per host, `notes.address`, `notes.render` | PIE-767 | shipped | [the call reference](#the-call-reference), [a schedule](#a-schedule), [a note's address](#a-notes-address-and-its-rendering) |

### The cold-start gap list

The first fresh agent to build a real extension from these docs (the Readwise extension, PIE-743, Oct 9) stopped on
these. Each is closed here or tracked:

| Gap | Now |
|---|---|
| Annotation properties on the wire (`kind=highlight`, `source=readwise`) | shipped, PIE-753: `properties` on `annotations.*` and `annotate` writes |
| The passage target: an extension can't write an annotation at a passage | shipped, PIE-751: `on: "passage"`, and over the connection a `block-comment` with a `passage` |
| Action writes only inside the acted block | gone, PIE-754: [anywhere](#writes-anywhere-through-the-normal-paths) |
| The process gets only `PATH` and `LANG`, no socket | PIE-754: [a connection](#a-connection-to-the-service) |
| No schedule (`pollEvery` is Jira's) | PIE-754: [`schedule`](#a-schedule) on any handler or action |
| No writes to the notes documents came from, or to another outline | PIE-754: by `outline` over the connection |
| `with-secrets` groups as a secret reference | PIE-754: [`{ group, key }`](#secrets-by-with-secrets-group) |
| (kitty, lego night) A Resource can be listed but not opened; an action can't say what to open | PIE-754: [Resource refs](#opening-a-resource) and `open` |

### Cold-start run 2 (Readwise, after PIE-754)

Run 2 built the Readwise extension with no core change, reading the source for these. PIE-767 closed them:

| Gap | Now |
|---|---|
| Call shapes for `blocks.query`, `annotations.list/batch`, `children`, `get` | [The call reference](#the-call-reference), written from the types and checked by a test |
| `requestId` dedupes on id plus content, so it isn't an idempotency key | [Making a sync idempotent](#making-a-sync-idempotent) |
| Editing an annotation's body | [Editing an annotation's body](#editing-an-annotations-body) |
| A schedule once per host, or in one outline (Readwise needed a claim on its board page) | [`"once": "host"`](#a-schedule); Readwise's claim is gone |
| Where a sync keeps its cursor (its folder reloads it) | [Where an extension keeps its state](#where-an-extension-keeps-its-state) |
| A collection doesn't fit annotations or cursors, and caps at 500 | [Collection or program?](#collections) |
| No escape for `[[page]]` or `((ref))` in imported text | [Imported text](#imported-text-keep-its-words-words): code spans (PIE-764) for literals; for prose, the pair broken with a backslash, which every renderer but the door's surface draws as the plain words. No grammar escape is needed |
| No web URL for a note, no machine name for an `ep0ch://` link | [`notes.address`](#a-notes-address-and-its-rendering) |
| No HTML or Markdown render of a note | [`notes.render`](#a-notes-address-and-its-rendering), the publisher's renderer |
| Whether a write only to an outside service is `read` or `write` | [Writes to an outside service](#writes-to-an-outside-service) |
| Tests across two outlines | [Testing an extension](#testing-an-extension): `OutlineHost` and the variables |
| A showcase for an extension that calls an outside API | [A showcase recipe](#a-showcase-recipe-an-extension-that-calls-an-outside-api) |
| A worked "sync from an outside API" | [Worked example](#worked-example-sync-my-starred-items-from-an-outside-api-every-hour) |
| The suggested `pgrep` check matched other agents' runs | [Running it on float-2](#testing-an-extension): `agent-env --test` waits for a slot itself |

## `extensions.list`

```json
{
  "generation": 3,
  "roots": [{ "path": "/home/you/outlines/pie/extensions", "origin": "outline", "exists": true }, { "path": "…/extensions", "origin": "user", "exists": true }],
  "extensions": [{
    "id": "horoscope", "name": "Horoscope", "version": 1, "origin": "user", "directory": "…", "state": "active",
    "loadedAt": "…", "runsCode": true,
    "handlers": [{ "key": "horoscope", "kind": "output", "effects": "read", "argument": { … }, "options": { … }, "staleAfter": "1h" }],
    "actions": [{ "id": "keep", "name": "ext.horoscope.keep", "builtIn": true, … }],
    "tiles": [],
    "bar": [],
    "schedules": [{ "entry": "handler:horoscope", "every": "1h", "next": "…", "last": { "at": "…", "ok": true, "message": "ran 2 horoscope:: lines", "ms": 210 } }]
  }],
  "tileKinds": [ … ],
  "barSources": [{ "id": "glyphs", "extension": "glyphs", "name": "ext.glyphs.glyphs", "title": "glyphs", "prefix": "~", "main": false }],
  "primitives": ["text", "badge", "stat", "bar", "table", "checklist", "sparkline", "card", "box", "stack", "row", "band", "track"],
  "rules": [{ "key": "ext:done-stamp/stamp", "name": "done-stamp/stamp", "source": { "kind": "extension", … }, "match": { "query": "status=done" }, "on": { "start": "stamp", "stop": "unstamp", "quiet": "2s" }, "matching": 3 }],
  "ruleProblems": [],
  "targets": ["terminal", "markdown", "blockdown", "html", "json", "csv"],
  "trust": "Extensions are trusted code, not a sandbox: they run as the service user."
}
```

`state` is `active`, `failed` (with `error`; it may still serve its last good version), `disabled`
or `shadowed`. `extensions.list { reload: true }` reads the folders now instead of waiting for the
watcher.

## Testing an extension

Never against a real outline, a real token or a real outside service. Start a scratch service in a temp folder, copy
the extension in, and drive it over the socket with made-up data. The runtime is the same one the live service uses.

**The environment a scratch service reads**, set before it starts and put back after (a test changes `process.env`;
anything it spawns gets the environment passed explicitly):

| Variable | Point it at |
|---|---|
| `OUTLINER_EXTENSIONS_DIR` | the user folder: a temp folder the test copies the extension into (an extension there serves every outline) |
| `OUTLINER_RESOURCE_EXTENSIONS` | a file that doesn't exist, so no old registry is read |
| `WITH_SECRETS_DIR` | a temp folder with a made-up group file (`readwise.env`, mode 0600), never `~/.config/secrets` |

**One outline:** an `OutlinerServer` over an `OutlinerStore` in the temp folder, with `server.setOutline({ name })` so
`EP0CH_WS` and `notes.address` have a name; the extension in `<outline root>/extensions/<id>/` or the user folder.
[`test/extension-programs.test.ts`](../../test/extension-programs.test.ts)'s `setup()` is the one to copy (its
`scheduleTickMs` and `scheduleNow` drive a schedule by hand: `server.extensionSchedules.tick()`).

**Two outlines** (a sync that writes to another outline, a host-wide schedule): an `OutlineHost`, as the live host
runs, over an outlines folder in the temp folder; make the outlines over its socket, and name the outline on each
request:

```ts
const outlines = outlineLayout(join(root, "outlines"));          // outline-core's layout: <root>/<name>.sqlite, .host/
const host = new OutlineHost({ outlinesFolder: outlines.root, log: () => {} });
await host.start();
await send(host.socketPath, { action: "outlines.create", name: "garden" });
await send(host.socketPath, { action: "outlines.create", name: "readwise" });
await send(host.socketPath, { outline: "garden", action: "extensions.list", reload: true });   // the extension loads
await send(host.socketPath, { outline: "garden", action: "extensions.act", extension: "readwise", extensionAction: "pull", mutation: { author: "user" } });
```

[`test/readwise-extension.test.ts`](../../test/readwise-extension.test.ts) is the whole recipe: two outlines, a
group file, a fake outside API and a publisher.

**A fake outside API:** `Bun.serve({ port: 0, hostname: "127.0.0.1", fetch })` answering the few paths the extension
calls, as the real API's docs describe them, checking the made-up token, and recording what it was sent; the extension
takes the API's address in its config (`"api": "http://127.0.0.1:<port>"`, written to its `config.json` by the test).
Make it able to fail the ways the real one does (401, 429 with `Retry-After`, a second page), and assert on what the
outline holds afterwards and on the fake's record of requests.

**A publisher** (for `notes.address`'s URLs and `notes.render`'s links): `new Publisher({ client: createOutlinerClient({
socket, mode: "host", outline }), url: "https://pub.example.invalid/pub" })`, then `start()`; it registers with the
service as `publish serve` does.

**Running it on float-2:** one file at a time, through the test slots: `scripts/agent-env <your name> --test --
timeout 900 bun test test/<file>.test.ts` (it waits for a free slot itself, so there's nothing to check with `pgrep`,
which also matches other agents' runs). Whole suites run on CI or `scripts/box-test`.

### A showcase recipe: an extension that calls an outside API

The door's showcase (`ep0ch --showcase`, `packages/door/src/showcase/`) runs a scratch service and installs the
outliner's example extensions into its own config folder (`installExamples` in `src/showcase/tickets/install.ts`).
An extension that calls an outside API is shown the same way, with the outside world made up:

1. **A fake, in the showcase.** Either the extension answers from a file in its folder (the showcase's ticket
   provider, `src/showcase/tickets/tickets.ts`, is a Jira-shaped extension that reads `tickets.json` and contacts
   nothing), or the showcase process serves a fake API on `127.0.0.1:0` and writes the extension's `config.json` with
   `api` pointing at it.
2. **A made-up secret, never the person's.** The showcase's scratch service must not read `~/.config/secrets`: give it
   `WITH_SECRETS_DIR` pointing at a folder the showcase writes (a group file with a made-up token, mode 0600), or give
   the extension no secret in the showcase. Don't install an extension that names a real group into a showcase
   without one: its first call would send the person's real token to the real service.
3. **A section and its test.** The section shows what the person would see (the extension's lines, its schedule in the
   extensions list, the notes it wrote), and `packages/door/test/showcase.test.ts` opens it, runs the action through
   `act` (`ext.<id>.<action>`) and checks what the fake was sent and what the outline holds.

### Worked example: "sync my starred items from an outside API every hour"

1. **The manifest:** a scheduled action on the outline that writes, the token by `with-secrets` group, the API's
   address in config so a test can point it at a fake:

   ```json
   {
     "contract": 2, "id": "stars", "version": 1, "name": "Stars", "run": ["bun", "stars.ts"], "deadline": "2m",
     "secrets": { "token": { "group": "stars", "key": "STARS_TOKEN", "description": "Stars API token" } },
     "configSchema": { "type": "object", "properties": { "api": { "type": "string" } }, "additionalProperties": false },
     "actions": [{ "id": "pull", "label": "Pull starred items", "on": "outline", "effects": "write",
                   "schedule": { "every": "1h", "once": "host" } }]
   }
   ```

2. **The page it owns, and its cursor:** `pages.resolve` for `stars`; none, `create` it (`Stars [page::stars]`). Read
   `[stars.synced::…]` from its first line.
3. **Fetch what changed since**, with the token from `credentials.token` (`?updated_after=<synced>`), a page at a time.
4. **Write each item idempotently:** `blocks.query` `{ where: "stars.item=<id>", subtreeRootId: <page>, limit: 1 }`;
   found and different, `update` with the revision you read; not found, `create` under the page with
   `[stars.item::<id>]` and its fields as properties. Escape the item's words ([imported text](#imported-text-keep-its-words-words)).
5. **Move the cursor** last: `update` the page with `[stars.synced::<when this run started>]`. A run that fails halfway
   leaves the old cursor, and the next run writes only what's missing.
6. **Answer** `{ ok: true, value: { message: "pulled: 3 new, 1 changed" } }`: the schedule's record shows it
   (`ep0ch ext ls`), and a refusal from the API is `{ ok: false, code: "unauthorized" }`.
7. **Test it** against a fake API in two outlines ([above](#testing-an-extension)), twice: the second run writes
   nothing.

[readwise](../../extensions/readwise) is this, with annotations at passages and a board in another outline.

**Around the extension (a kit).** A sync is usually one part of a kit: what it writes is shown and sorted by parts
that are notes, not code. An inbox is a **view** (`[type::virtual-branch]` with a `[query::…]` on the sync's own
properties, `stars.state=unread`), a board is a **hub** with two or more views under it, a familiar filter is a saved
query, and a "when an item lands, tag it" step is a [rule note](#rule-notes-the-no-code-tier). Their syntax is the
`ep0ch-outline` skill's "Views, boards and hubs" (`packages/door/skills/ep0ch-outline/SKILL.md`). Query the
properties your sync writes; never a list of keys in code ([properties are open](../../../../AGENTS.md#properties-are-open)).

## Not yet

- **The door's `::graph-*` figures** (`graph-check`, `graph-stat`, `graph-table`, `graph-rank`) stay
  in the door for now. They are a rich component in shape, but they live in the door's core and
  read the outline through queries on every paint. The door draws components from the service now
  (the door's PIE-512); moving them still needs a query input in the `run` contract (a handler that
  declares the query it reads, evaluated by the service). The primitives here are
  the target they move to.
- **Actions in Detail.** The service lists them with keys and labels; the door binds them
  (the door's PIE-512), Detail doesn't yet: its selection builds a passage through outline-core's
  `findPassage` for a comment, but doesn't run a passage action. Until then in Detail: `outliner ext act --quote`
  and `extensions.act`. Detail does draw highlights and margin notes (contract 6).
- **The same request twice in one note.** Requests are known by their words: a second `@tidy` line
  that says exactly what an earlier one in the note says shows that one's answer and isn't asked
  until `r` on it (or it's worded differently).
- **The publisher** shows data records (they are blocks) but not yet handler outputs; it will ask
  `extensions.render` for `html`. So `notes.render` doesn't draw a handler line's output either.
- **Generic Resource providers.** `kind: "resource"` is Jira's path; others use `data`.
