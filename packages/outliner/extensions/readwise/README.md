# Readwise

Send a note to Readwise Reader, and get your highlights back on the note they came from. Your Reader library comes into the outline too.

```text
garden outline                                   readwise outline
Pond notes            ── send ──▶  Reader         Readwise [page::readwise] [readwise.synced::…]
  The heron came back …            you highlight    └─ Pond Days — Ann Example [readwise.book::8] …
  ▲                                 and take notes       └─ Moss keeps its own calendar. [readwise.highlight::201] …
  └── pull: an annotation at the passage
      [kind::highlight] [readwise.highlight::101]   ◀── pull: every other highlight
      "Same heron as last spring?"
```

## Where to look

- **Highlights on a note you sent:** annotations at the passage, on that note.
- **Every other highlight:** the `readwise` page on the board outline, a block per book and a block per highlight.
- **Your Reader library:** a block per document under the `reader` page of that board.
- **Finding them:** see [Finding them](#finding-them) for queries.

## What you do

- **Send a note:** `act ext.readwise.send` in the door (or its key and click), or `ep0ch ext act readwise send --block <id>`.
  - It saves the note and the notes under it to Reader as one document, tagged `ep0ch`.
- **Pull now:** `ep0ch ext run readwise action:pull` (or `ep0ch ext act readwise pull`). It runs every hour too.
- **Pull the library now:** `ep0ch ext run readwise action:library`.
- **See the schedule:** `ep0ch ext ls --long` shows the next run and what the last one did.
- **Highlight in Reader,** and the next pull brings it back to the note.

## Good to know

- **Sending publishes the note.** It gets `[publish::public]`: a public page by its id, unlisted, reachable by link, in no index.
  - That page is the URL Reader gets. Remove the token to unpublish.
  - Set config `publish` to `false` to send without publishing.
- **`[publish::never]` wins.** A note locked that way, or under one, is not published and not sent; the answer says so.
- **No public address, no publishing.** The note goes with the placeholder URL, and the answer names the command to start a publisher.
  - A publisher serves one outline (`publish serve --ws <name>`) and needs `--public-url` or `OUTLINER_PUBLIC_URL`.
- **Sending again** says it's already there, because Reader keeps the first copy.
  - Delete it in Reader to send a newer one.
- **What Reader gets:** the note as its published page reads, with properties left out and links as labels or web URLs.
- **A pull is safe to repeat.** Each highlight is known by its Readwise id, so a second run writes nothing new.
  - A changed note, tag, favourite or author updates in place; a property you added by hand is left alone.
  - Deleted highlights are skipped, and what's already there stays.
- **Imported words stay words:** a `[key::value]` or `[[page]]` in a highlight is escaped.

## How a pull lands

- **Reader's highlights** reach Readwise too, so one export feed has both.
- **On a note you sent:** an annotation at the passage (`kind=highlight`).
  - Your note on it is the body, its colour is a theme tone (`color`), its tags are `tags`.
  - A passage in a note under it lands on that note.
- **Words gone from the note** (edited since): it lands on the whole note with the quote in the body and `[readwise.anchored::no]`.
- **Words crossing formatting** (bold, a link) are found in Reader's rendered text but not the source, so they land the same way.
- **A tweet thread** (one book of category `tweets`) reads in order: `location` when tweets have one, else `highlighted_at`.
  - The first tweet is the thread's block under the book, and the rest are its children, one level deep.
  - A late tweet never re-parents the ones after it.
  - **Thread, compiled** (`[readwise.compiled::<book id>]`) embeds each tweet with `!((id))`, so it reads as one piece with no copy.
  - A pull with more tweets extends it; a book of one tweet stays as any other.
- **Time limit:** a pull stops after `minutes` (default 4) and resumes next run, keeping its place in `[readwise.next-page::…]`.
- **Rate limit:** a 429 waits for its `Retry-After` when that fits, else stops the same way.

## How the library lands

- **Documents only:** Reader's list since the last run, one block each under the `reader` page; highlights and notes (they have a `parent_id`) are skipped, because `pull` brings those.
- **Matched by `reader.id`,** so a re-run writes nothing unless a field changed, and a move from later to archive updates in place.
- **The block:** the first line is the title, the body is the summary then your note, and the properties are under [Reader documents](#reader-documents).
- **Feed items stay out by default.** `locations` (default `["new", "later", "shortlist", "archive"]`) says which are mirrored; add `"feed"` for RSS.
  - Each location is listed on its own, so a left-out one costs no requests.
- **Its highlights:** each carries `[reader.doc::<id>]`, and the document's block gets `Highlights: ((book|its highlights))`.
  - Whichever arrives first, the next `pull` or `library` adds the link.
- **Deleted is marked, not removed:** a document gets `[reader.deleted::true]` and stays.
  - Reader may say so (`deleted`, `is_deleted` or `deleted_at`).
  - Or a finished **full pass** (the first backfill, or after you take `[reader.synced::…]` off the Reader page) never listed it, and Reader doesn't have it by id.
  - A block still in Reader but outside `locations` is left alone, and a partial or incremental run marks nothing.
- **The first run backfills.** Reader lists 100 documents a page at 20 requests a minute, so about 7,000 documents take several runs.
  - Each stops after `minutes` and leaves `[reader.next-page::…]`; at the end it sets `[reader.synced::…]` and later runs ask for `updatedAfter` that.

## Setup

1. **The token,** once, from readwise.io/access_token: `with-secrets --add readwise READWISE_TOKEN`.
   - The service reads that one key at each call and hands it to this extension only; it never reaches the outline or a log.
2. **The board outline,** once: `ep0ch init readwise`, or name another with `board`. The `readwise` page is made on the first pull.
3. **Install** for every outline, so `send` works on any note: `ep0ch ext add readwise`.

- **One pull an hour, once per host.** An extension in the user folder serves every outline the host has open, and the pull runs in one of them (`ep0ch ext ls --long` says which).
  - Pulls run one at a time across the host, so one you ask for elsewhere waits, then finds nothing new.

## Config

`config.json` beside `extension.json` (all optional; never a secret):

```json
{ "config": { "board": "readwise", "page": "readwise", "tags": ["ep0ch"], "minutes": 4 } }
```

| Key | Default | What |
|---|---|---|
| `board` | `readwise` | The outline other highlights land in (on this host) |
| `page` | `readwise` | The page in it they land under |
| `publish` | `true` | Sending publishes the note, unlisted; `false` sends without publishing |
| `link` | the note's permalink, else an `ep0ch.invalid` URL | The URL Reader gets; it must hold `{{props.outline}}` and `{{props.id}}` |
| `machine` | the service's (`notes.address`) | This machine's name in `ep0ch://` links |
| `tags` | `["ep0ch"]` | Tags a sent document gets in Reader |
| `minutes` | `4` | How long one pull may work (1 to 4) |
| `locations` | `["new", "later", "shortlist", "archive"]` | Which Reader locations the library mirrors |
| `readerPage` | `reader` | The page the Reader library lands under |
| `api` | `https://readwise.io` | Readwise's address; the test points it at a fake |

- **Why `link` is unique:** Reader needs a unique web URL per document, and the pull reads the note back out of it.
  - A published note gets its page by id with `?ep0ch=<outline>@<machine>`; an unpublished one the `.invalid` form.
- **A document from another machine** lands on the board.

## Properties

Every field in the export you could filter on is a property, and empty values are left out.

- **Every highlight carries its book's identity,** because a query reads one block's own properties, not its parent's.
- **Plain keys** where another source can share the meaning; `readwise.*` where it is Readwise's own.

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

- **Why `tags` and `book-tags` are apart:** `tags=moss` should mean a highlight you tagged moss, not every highlight in a tagged book.
  - The book's tags are `tags` on the book block and `book-tags` on each highlight.
- **The document's note** (`document_note`) stays in the book block's body.
- **Dates are days,** so "since March" is `highlighted >= 2024-03-01` (PIE-769).
  - `created` and `updated` are when the block was written, not when you highlighted.
- **Conveniences:** `highlighted-year=2024` for "from 2024"; `group=highlighted:month` groups by month without them.

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

Highlights are blocks with open properties. Use these as the `where` of a view, a virtual branch, `ep0ch find --query` or `blocks.query`:

```text
All highlights by an author:   readwise.highlight AND author="Ann Example"
Highlights with a tag:         readwise.highlight AND tags=moss
Favourites:                    readwise.highlight AND favorite=true
Highlights from 2024:          readwise.highlight AND highlighted-year=2024       (one month: highlighted-month=2024-03)
Highlighted this week:         readwise.highlight AND highlighted >= -7d
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

## For developers

- **Built from what any extension has** (PIE-743): an action on a note, a scheduled action, a connection to the outline, a `with-secrets` key.
  - Nothing in the outline's code knows about Readwise.
- **Tests:** `test/readwise-extension.test.ts` runs it in a scratch host with two outlines and a fake Readwise on localhost.
  - It uses made-up books, highlights, a tweet thread and Reader documents, and never calls the real API.
- **Self-contained on purpose:** it imports nothing from the outline's code, so a copy works anywhere.
- See [the four kinds](../../docs/extensions/README.md#extensions-as-programs).
