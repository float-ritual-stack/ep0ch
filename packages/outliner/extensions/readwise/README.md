# Readwise (send to Reader, pull highlights back)

A Readwise and Readwise Reader client, built only from what any extension has (PIE-743): an action on a note, a
scheduled action, a connection to the outline, a `with-secrets` key. Nothing in the outline's code knows about
Readwise.

```text
garden outline                                   readwise outline
Pond notes            ── send ──▶  Reader         Readwise [page::readwise] [readwise.synced::…]
  The heron came back …            you highlight    └─ Pond Days — Ann Example [readwise.book::8] …
  ▲                                 and take notes       └─ Moss keeps its own calendar. [readwise.highlight::201] …
  └── pull: an annotation at the passage
      [kind::highlight] [readwise.highlight::101]   ◀── pull: every other highlight
      "Same heron as last spring?"
```

- **`send`** (on a block): saves the note, and the notes under it, to Reader as one document, tagged `ep0ch`. It is
  the note as its published page reads (`notes.render`, the publisher's renderer, published or not): properties left
  out, links as their labels or web URLs. The document's URL is the note's link, and its first line is the note's
  `ep0ch://` URI, so a highlight made on it in Reader comes back to that note. A `[publish::never]` note isn't sent.
  Sending again says it's already there: Reader keeps the first copy (delete it in Reader to send a newer one).
- **`pull`** (on the outline, every hour): Readwise's export of the highlights changed since the last pull. Reader's
  highlights reach Readwise too, so this one feed has both.
  - A highlight on a document `send` made becomes an **annotation on that note, at the passage**: `kind=highlight`, your
    note on it as the body, its colour as a theme tone (`color`), its tags as `tags`. A passage in a note under it lands
    on that note. If the words aren't in the note any more (edited since), it lands on the whole note with the quote in
    the body and `[readwise.anchored::no]`, so nothing is lost.
  - Every other highlight lands on the **readwise board**: a block per book (`[readwise.book::…]`, its author, category,
    source, tags and your note on the document) and a block per highlight under it (`[readwise.highlight::…]`, the quote,
    your note). Imported words stay words: a `[key::value]` or `[[page]]` in a highlight is escaped.
  - **Idempotent.** Each highlight is known by its Readwise id. A pull run twice writes nothing new; a changed note on a
    highlight updates its annotation or block in place. Deleted highlights are skipped (what's already there stays).
  - It stops after `minutes` (default 4) and leaves the rest for the next run, keeping its place on the board page
    (`[readwise.next-page::…]`). A 429 from Readwise waits for its `Retry-After` when that fits, else stops the same way.
  - A highlight whose words cross formatting in the note (bold, a link) is found in the rendered text Reader shows but
    not in the note's source, so it lands on the whole note with its quote, as above.

## Setup

1. The token, once, in the `with-secrets` group `readwise` (from readwise.io/access_token):

   ```sh
   with-secrets --add readwise READWISE_TOKEN
   ```

   The service reads that one key at each call and hands it to this extension only; it is never in the outline,
   never logged, and scrubbed from anything the extension returns.
2. The board outline, once: `ep0ch init readwise` (or name another with `board`, below). The `readwise` page is made on
   the first pull.
3. Install it for every outline, so `send` works on any note: `ep0ch ext add readwise`.

Then, on any note in the door: `act ext.readwise.send` (or its key and click, like any action); from a shell:
`ep0ch ext act readwise send --block <id>`. Pull now: `ep0ch ext run readwise action:pull` (or
`ep0ch ext act readwise pull`). `ep0ch ext ls` shows the schedule's next run and what the last one did.

**One pull an hour, once per host.** Its schedule says `"once": "host"`: an extension in the user folder serves every
outline the host has open, and the hourly pull runs in one of them (`ep0ch ext ls` says which, `runs in …`). Pulls
run one at a time across the host, so one you ask for in another outline waits for a running one, then finds nothing
new.

## Config

`config.json` beside `extension.json` (all optional; never a secret):

```json
{ "config": { "board": "readwise", "page": "readwise", "tags": ["ep0ch"], "minutes": 4 } }
```

| Key | Default | What |
|---|---|---|
| `board` | `readwise` | The outline other highlights land in (on this host) |
| `page` | `readwise` | The page in it they land under |
| `link` | the note's published permalink, else `https://ep0ch.invalid/{outline}@{machine}/b/{id}` | The URL a sent note gets in Reader. Reader needs a unique web URL per document. A published note gets its page by id (`notes.address`'s `permalink`, from a publisher started with `--url` or `--public-url`) with `?ep0ch=<outline>`, so opening it in Reader opens the page; an unpublished one the `.invalid` form. A `link` you set must hold `{outline}` and `{id}`: the pull reads the note back out of it |
| `machine` | the service's (`notes.address`) | This machine's name in `ep0ch://` links. A document sent from another machine lands on the board |
| `tags` | `["ep0ch"]` | Tags a sent document gets in Reader |
| `minutes` | `4` | How long one pull may work (1–4) before it leaves the rest for the next |
| `api` | `https://readwise.io` | Readwise's address; the test points it at a fake |

## Finding them

Highlights are blocks with open properties, so the views' grammar finds them:

```text
Readwise highlights on my notes [type::virtual-branch] [query::type=annotation AND kind=highlight AND readwise.highlight]
Moss, from Readwise [type::virtual-branch] [query::readwise.highlight AND tags=moss]
```

## Testing

`test/readwise-extension.test.ts` runs it in a scratch outline host with two outlines, a `with-secrets` group in a
temp folder and a fake Readwise on localhost, with made-up books and highlights. It never calls the real API.

Self-contained on purpose (it imports nothing from the outline's code), so a copy works anywhere.
See [the four kinds](../../docs/extensions/README.md#extensions-as-programs).
