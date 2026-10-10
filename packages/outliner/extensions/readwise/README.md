# Readwise (send to Reader, pull highlights and the Reader library back)

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
  - Every other highlight lands on the **readwise board**: a block per book and a block per highlight under it (the
    quote, your note). Imported words stay words: a `[key::value]` or `[[page]]` in a highlight is escaped. What each
    carries is under [Properties](#properties).
  - **A tweet thread** (Readwise saves one as one book of category `tweets` whose highlights are the tweets) reads as
    a thread: in order (`location` when each tweet has an order, else `highlighted_at`), the first tweet is the
    thread's block under the book and the rest are its children. One level, not each under the one before: a long
    thread stays two deep, and a tweet that arrives late never re-parents the ones after it. A block on the book,
    **Thread, compiled** (`[readwise.compiled::<book id>]`), holds an embed `!((id))` of each tweet in order, so it
    reads as one piece with no copy of the text. A pull that brings more tweets extends it, and one with nothing new
    leaves it alone. A book of one tweet stays as any other.
  - **Idempotent.** Each highlight is known by its Readwise id. A pull run twice writes nothing new; a field that
    changed on Readwise (a note, a tag, a favourite, the author) updates the block's or annotation's properties in
    place, and a property someone added by hand is left alone. Deleted highlights are skipped (what's already there stays).
  - It stops after `minutes` (default 4) and leaves the rest for the next run, keeping its place on the board page
    (`[readwise.next-page::…]`). A 429 from Readwise waits for its `Retry-After` when that fits, else stops the same way.
  - A highlight whose words cross formatting in the note (bold, a link) is found in the rendered text Reader shows but
    not in the note's source, so it lands on the whole note with its quote, as above.

- **`library`** (on the outline, every hour, once per host): your Reader library, not just its highlights. Reader's
  document list (`/api/v3/list/`) since the last run becomes **a block per document** under the `reader` page of the
  readwise board. Highlights and notes are documents too (they have a `parent_id`); they are skipped, because `pull`
  brings the highlights.
  - Matched by `reader.id`, so it is idempotent: a re-run writes nothing unless a field changed, and a document that
    moves from later to archive is updated in place, never duplicated.
  - The block's first line is the title; the properties are under [Reader documents](#reader-documents); the body is
    the summary, then your note on the document.
  - **Feed items stay out by default.** `locations` (default `["new", "later", "shortlist", "archive"]`) says which Reader
    locations are mirrored; add `"feed"` to bring RSS items in. A large feed would otherwise swamp the board and the
    backfill. Each location is listed on its own (`location=`), so a left-out one costs no requests.
  - **Deleted is marked, not removed:** a document gets `[reader.deleted::true]` and stays, in two ways. Reader may say
    so (`deleted`, `is_deleted` or `deleted_at` in its list entry). And a **full pass** (the first backfill, or one you
    ask for by taking `[reader.synced::…]` off the Reader page) stamps each document it lists with `[reader.seen::<pass>]`;
    when the pass has finished, a block it never listed is looked up in Reader by id, and marked deleted if Reader does
    not have it. One that is still there, only outside `locations` (moved to feed, say), is left alone. Only a finished
    full pass does this: an incremental run lists just what changed, and a partial or failed pass marks nothing.
  - **One note with its highlights.** The export's book `external_id` is the Reader document's id when the source is
    `reader`, so each of its highlights carries `[reader.doc::<id>]`, and the document's block holds a line
    `Highlights: ((book|its highlights))` linking to its book on the board. Whichever arrives first, the next
    `pull` or `library` adds the link.
  - **The first run backfills.** Reader lists 100 documents a page and allows 20 requests a minute (a 429 waits for its
    `Retry-After`), so about 7,000 documents take several runs: each stops after `minutes` (default 4) and leaves
    `[reader.next-page::…]` on the page, and the next hourly run carries on. When it reaches the end it sets
    `[reader.synced::…]`, and later runs ask only for `updatedAfter` that.

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
| `link` | the note's published permalink, else `https://ep0ch.invalid/{outline}@{machine}/b/{id}` | The URL a sent note gets in Reader. Reader needs a unique web URL per document. A published note gets its page by id (`notes.address`'s `permalink`, from a publisher started with `--url` or `--public-url`) with `?ep0ch=<outline>@<machine>`, so opening it in Reader opens the page; an unpublished one the `.invalid` form. A `link` you set must hold `{outline}` and `{id}`: the pull reads the note back out of it |
| `machine` | the service's (`notes.address`) | This machine's name in `ep0ch://` links. A document sent from another machine lands on the board |
| `tags` | `["ep0ch"]` | Tags a sent document gets in Reader |
| `minutes` | `4` | How long one pull may work (1–4) before it leaves the rest for the next |
| `locations` | `["new", "later", "shortlist", "archive"]` | Which Reader locations the library mirrors; add `"feed"` for RSS items |
| `readerPage` | `reader` | The page in the board outline the Reader library lands under |
| `api` | `https://readwise.io` | Readwise's address; the test points it at a fake |

## Properties

Every field in the export a person could filter on is a property, and **every highlight carries its book's identity**
(a query reads one block's own properties, not its parent's, so the author is copied onto each highlight). Empty
values are left out. Plain keys where the meaning is general and another source can share it; `readwise.*` where it is
Readwise's own.

| Key | On | From |
|---|---|---|
| `title`, `author`, `category`, `source` | book, highlight, annotation | the book (`title` is `readable_title` when there is one; `readwise.title` keeps the raw one) |
| `url` | book, highlight, annotation | the book's `source_url`, else `unique_url` |
| `readwise.book` | book, highlight, annotation | `user_book_id` |
| `tags` | book: the book's tags. Highlight: the highlight's own tags | `book_tags` / `tags` |
| `book-tags` | highlight, annotation | the book's tags, copied |
| `readwise.highlight`, `readwise.color`, `color` | highlight, annotation | `id`, `color` (`color` is the theme tone an annotation gets) |
| `highlighted`, `highlighted-year`, `highlighted-month` | highlight, annotation | `highlighted_at` as `2024-03-02`, `2024`, `2024-03` |
| `readwise.created`, `readwise.updated` | highlight | `created_at`, `updated_at` as days |
| `favorite`, `readwise.discard`, `readwise.has-note` | highlight | `is_favorite`, `is_discard`, a note present: `true`, else absent |
| `readwise.location`, `readwise.location-type`, `readwise.end-location` | highlight | the same |
| `readwise.url`, `readwise.external-id`, `readwise.source-url` | highlight | `readwise_url`, `external_id`, the highlight's `url` |
| `readwise.url`, `readwise.external-id`, `readwise.unique-url`, `readwise.cover`, `readwise.asin`, `readwise.summary` | book | the book's own (`summary` only when 160 characters or fewer) |

A Reader highlight (a book whose `source` is `reader`) also carries `reader.doc`, the document's id.

Why `tags` and `book-tags` are apart: `tags=moss` should mean a highlight you tagged moss, not every highlight in a
book somebody tagged. The book's tags are `tags` on the book block itself and `book-tags` on each highlight. The
document's note (`document_note`) stays in the book block's body.

Dates are days, and the grammar compares a property for equality only (ranges are for `created` and `updated`, which
are when the block was written, not when you highlighted), so "from 2024" is `highlighted-year=2024`.

### Reader documents

| Key | From |
|---|---|
| `reader.id`, `reader.url` | the document's `id` and its address in Reader |
| `title`, `author`, `category`, `site` | `title`, `author`, `category` (article, pdf, epub, tweet, video, email, rss), `site_name` |
| `url` | `source_url` |
| `location` | `new`, `later`, `shortlist`, `archive` or `feed` |
| `tags` | the document's tags, a token each |
| `reading-progress` | `reading_progress` as 0 to 100 |
| `saved`, `published` | `saved_at`, `published_date` as days |
| `words` | `word_count` |
| `reader.deleted` | `true` when Reader says it is deleted, or a full pass found it gone |
| `reader.seen` | the full pass that last listed it (bookkeeping for the deletion sweep) |

## Finding them

Highlights are blocks with open properties, so the views' grammar (`where=`, `group=`, `sort=`) finds them. As the
`where` of a view, a virtual branch, `ep0ch find --query` or `blocks.query`:

```text
All highlights by an author:   readwise.highlight AND author="Ann Example"
Highlights with a tag:         readwise.highlight AND tags=moss
Favourites:                    readwise.highlight AND favorite=true
Highlights from 2024:          readwise.highlight AND highlighted-year=2024       (one month: highlighted-month=2024-03)
One book's highlights:         readwise.highlight AND readwise.book=8
Highlights from tagged books:  readwise.highlight AND book-tags=fiction
Grouped by author:             where=readwise.highlight  group=author
```

The same on your own notes (annotations carry the same properties):

```text
Readwise highlights on my notes [type::virtual-branch] [query::type=annotation AND kind=highlight AND readwise.highlight]
Moss, from Readwise [type::virtual-branch] [query::readwise.highlight AND tags=moss]
```

The Reader library, the same way (`reader.id` is what only a document has):

```text
The later queue:               reader.id AND location=later
In progress:                   reader.id AND reading-progress AND NOT location=archive
From one site:                 reader.id AND site="Pond Blog"
With a tag:                    reader.id AND tags=moss
Archived PDFs:                 reader.id AND location=archive AND category=pdf
Grouped by where it sits:      where=reader.id  group=location
Deleted in Reader:             reader.id AND reader.deleted=true
```

A saved view for the queue, in your own outline:

```text
Reading queue [type::virtual-branch] [query::reader.id AND location=later] [sort::saved]
```

## Testing

`test/readwise-extension.test.ts` runs it in a scratch outline host with two outlines, a `with-secrets` group in a
temp folder and a fake Readwise on localhost, with made-up books, highlights, a tweet thread and Reader documents (paginated, moved, deleted, with highlight documents among them), in Readwise's export and Reader's list shapes. It asks `blocks.query` the questions above. It never calls the real API.

Self-contained on purpose (it imports nothing from the outline's code), so a copy works anywhere.
See [the four kinds](../../docs/extensions/README.md#extensions-as-programs).
