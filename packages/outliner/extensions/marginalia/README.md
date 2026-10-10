# Marginalia (read with a pen)

The forkable example for **passage actions** and **answers in a margin** (ADR 0004 contracts 5 and 6, PIE-751,
PIE-753). Select words in a reader, then:

```text
a h   highlight         an annotation with no body: [kind::highlight] [color::warn]
a d   define            the word looked up in the note's own glossary, written in the margin: [kind::define]
a k   cite              copied with a citation: > the words, then — ((note^fragment))
a a   ask               a comment on the words starting @margin; the answer lands in its thread
a c   comment           the door's own comment, on the words
```

or click the chips on the selection's line. `M` in a reader changes how the margin reads (a row each, whole, off).

- **Passage actions** (`"on": "passage"`): the service checks the passage before the action runs (the words where
  they were, or found once with the words around them), sends it as `target.passage` with the note's text, and writes
  what the action returns as `ext:marginalia`, with who asked beside it. An `annotate` write is an annotation on the
  passage; properties are open, so a highlight is found like any block (`kind=highlight`, `tags=soil`).
- **`@margin`** (`"threads": true`): a person's comment on a passage that starts `@margin …` is sent to `respond` with
  the passage, the note and the thread; the reply goes in the thread. An agent's own `@margin` never sets it off.
- **No model by default.** Set `config.answer` to a command that reads a prompt on stdin and prints an answer
  (`["claude", "-p"]`, in `config.json`); without one `@margin` answers from the note's own sentences and says so.
- **Works on files too**: a Resource's passage (a `[file::]` the note links, opened in a reader) is annotated in the
  outline; the file is never written.

The notebook is a note, not code: a saved query over every annotation, in outline order so each note's sit together,
exportable with `ep0ch export --view <its id>`:

```text
Marginalia notebook [type::virtual-branch] [query::type=annotation] [summary-properties::kind,tags]
```

Narrow it as you like: `[query::type=annotation AND kind=highlight]`, `[query::type=annotation AND tags=soil]`.

Install: `outliner ext add marginalia`. Self-contained on purpose (it imports nothing from the outline's code), so a
copy works anywhere. PDF and web pages are next (PIE-735 B6).
