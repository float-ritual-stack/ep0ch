# Marginalia

Read with a pen: highlight a passage, look a word up, copy it with a citation, or ask `@margin` about it.

## Where to look

- **The margin:** annotations and answers sit beside the passage in the reader.
- **The notebook:** a saved query over every annotation, exportable with `ep0ch export --view <its id>`.

```text
Marginalia notebook [type::virtual-branch] [query::type=annotation] [summary-properties::kind,tags]
```

## What you do

Select words in a reader, then press a key or click the chips on the selection's line.

```text
a h   highlight         an annotation with no body: [kind::highlight] [color::warn]
a d   define            the word looked up in the note's own glossary, written in the margin: [kind::define]
a k   cite              copied with a citation: > the words, then — ((note^fragment))
a a   ask               a comment on the words starting @margin; the answer lands in its thread
a c   comment           the door's own comment, on the words
```

- **Change the margin:** `M` in a reader changes how it reads (a row each, whole, off).
- **Ask:** comment on a passage with `@margin what does this mean?`; the answer lands in that thread.
- **Follow up:** reply in the thread with `@margin …` and the agent remembers the earlier turns.
- **Write a glossary:** `define` reads lines like `**term**: meaning` or `term — meaning` in the note.
- **Leave a note to self:** a reply without `@margin` is never sent or answered.
- **Narrow the notebook:** `[query::type=annotation AND kind=highlight]` or `[query::type=annotation AND tags=soil]`.
- **Files too:** select in a Resource a note links (a `[file::]` opened in a reader); the file is never written.

## Setup

- **Install:** `ep0ch ext add marginalia`.
- **A model:** set `config.answer` in `config.json` to a command that reads a prompt on stdin and prints an answer, such as `["claude", "-p"]`.
  - Without one, `@margin` answers from the note's own sentences and says so.
  - It writes no TL;DR (PIE-860): a summary is a model's to write, so the ask says so and nothing is posted.
- **Another command:** say how it starts and resumes a session in `config.session`.
  - For example `{"start": ["--new", "{{props.id}}"], "resume": ["--continue", "{{props.id}}"]}`.
  - `claude` needs none (`--session-id`, `--resume`).

## How it works

- **Passage actions** (`"on": "passage"`): the service checks the passage before the action runs.
  - It finds the words where they were, or once with the words around them.
  - It sends them as `target.passage` with the note's text.
- **What gets written:** whatever the action returns, as `ext:marginalia`, with who asked beside it.
  - An `annotate` write is an annotation on the passage.
  - Properties are open, so a highlight is found like any block (`kind=highlight`, `tags=soil`).
- **`@margin`** (`"threads": true`): a comment or reply starting `@margin …` is sent to `respond`.
  - It carries the passage, the note, the whole thread and the page's other comments.
  - The reply goes in the thread; an agent's own `@margin` never sets it off.
- **A thread is one conversation:** the first `@margin` starts a session, kept as `[margin-session::<id>]`.
  - A session that can't be resumed starts again with the whole thread.
- **Suggested queries are checked:** an answer that writes `[query::…]`, `[sort::…]` or `[group::…]` has it asked of the outline first.
  - One that wouldn't work is marked under the answer with why.

## Making your own

- **Forkable example** for passage actions and answers in a margin (ADR 0004 contracts 5 and 6, PIE-751, PIE-753).
- **Self-contained on purpose:** it imports nothing from the outline's code, so a copy works anywhere.
- **Next:** PDF and web pages (PIE-735 B6).
