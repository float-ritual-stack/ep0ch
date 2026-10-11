# EchoNet (outlines as nodes, store and forward)

A spike (spike/echonet): each outline is a node, named `outline@machine`, on a FidoNet-style network. Nothing is
synced. A node copies the messages of the areas it subscribes to, carries marks back to where they came from as
netmail, and keeps a nodelist. Built only from what any extension has: a scheduled action and a connection to the
outline host, which reaches every outline the host serves.

```text
echo-shack (origin)                                   echo-cafe (subscriber)
Recon [type::echo-area] [echo::recon]                 Recon from the shack [type::echo-sub]
      [query::type=recon]                                   [subscribe::echo-shack@float-2] [echo::recon]
Recon: flaky cron on larder [type::recon]  ── toss ─▶   └─ Recon: flaky cron on larder [type::recon]
  ◀── seen-by mark: "also in: echo-cafe@float-2"             [from::echo-shack@float-2/<id>] [echo::recon]
  ◀── netmail: the cafe's comment, via echonet:…             [from-rev::3] [tossed::…]
  ── a reply written here ─────────────────────────▶          a comment here, and the shack's reply under it
```

## The shapes

- **Echo area**, in the origin: `<Area name> [type::echo-area] [echo::<tag>] [query::<views query>]`. The blocks
  its query matches are the area's messages (never an EchoNet block, and never a copy: a copy is not echoed again).
- **Subscription**, in the subscriber: `<Area name> from <node> [type::echo-sub] [subscribe::<outline>@<machine>]
  [echo::<tag>]`. Its children are the copies.
- **Copy**: the original's text with `[from::<outline>@<machine>/<id>] [echo::<tag>] [from-rev::<n>] [tossed::<time>]`
  added to its first line, and the notes under it. A reference into the origin (`((id))`, `[[page]]`) becomes an
  `ep0ch://` link into it; a `[page::…]`, `[work-id::…]` or `[publish::…]` the original owns becomes `[from-page::…]`
  and so on.
- **Upstream newer**: when the original has a newer revision, the copy gets `[upstream-newer::<n>]`. Its text is
  never written again.
- **Trashed stays trashed**: a copy in Trash keeps its message from coming back.
- **Seen-by**: one whole-note mark on the original per node it reached (`kind=echo-seen-by`, `echo.node`), "also in:
  echo-cafe@float-2 (Recon from the shack)". The original's text is never touched.
- **Netmail**: a highlight, comment or reply on a copy is carried to the original as a comment (at the same words
  when they're still there; else on the whole note, saying which words) with `via=echonet:<node>`,
  `netmail-from=<node>/<mark id>` and `netmail-author`. A reply written on that thread in the origin comes back into
  the copy's thread the same way. What came in carries `netmail-from`, so it never goes out again.
- **Nodelist**: `Nodelist [type::nodelist] [node::…] [last-toss::…]`, written again at every toss: each known node
  (this one, the ones it reads, the ones that read it), reachable or not, its access, areas and subscriptions, its
  last toss. Under it, a **toss log** per run (`[type::toss]` with `copies`, `updated`, `skipped`, `netmail-out`,
  `netmail-in`, `queued`) and the **ledger** (`[type::echo-ledger]`), each mark carried and where it went.

## Offline, access and conflicts

- **Offline is normal.** A node on another machine is reached through the ssh forward the clients share
  (`<outlines>/.remote/<machine>.sock`); with none up it is unreachable for this toss. Its copies stay as they are,
  and netmail for it stays here, counted as queued, until a toss reaches it. `config.json`'s `offline` shuts a lid on
  purpose.
- **One access rule**: the origin's own (`ep0ch mcp access none|read|propose|full --ws <outline>`). `none` refuses,
  `read` lets a node copy, `propose` and `full` also let it leave marks there (seen-by and netmail). The host enforces
  the same rule on any extension's request to another outline, once that outline's owner set a level.
- **A conflict is a note, never an overwrite**: a newer original is a marker on the copy; netmail on words the
  original no longer has lands on the whole note and quotes them.

## Running it

Copy this folder into each node's own `extensions/` (`<outlines>/<name>/extensions/echonet`). It tosses every 30
minutes; `ep0ch echo toss [--node <outline>]` tosses now, `ep0ch echo nodelist [--node <outline>]` writes and prints
the nodelist.
