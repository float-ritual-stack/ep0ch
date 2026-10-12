# EchoNet (outlines as nodes, store and forward)

Each outline is a node, named `outline@machine`, on a FidoNet-style network. Nothing is synced. A node copies the
messages of the areas it subscribes to, carries marks back to where they came from as netmail, and keeps a nodelist.
A copy is a photocopy sent to a friend: it takes on a life of its own here, and replies still find their way home.
Built only from what any extension has: a scheduled action and a connection to the outline host, which reaches the
outlines it serves and, through the shared ssh forward, outlines on other machines.

```text
shack@float-2 (origin)                                cafe@float-2 (subscriber)
Recon [type::virtual-branch] [query::type=recon]      Recon from the shack [subscribe::shack@float-2] [echo::recon]
      [echo::recon]                                     └─ shack@float-2 [echo-source::shack@float-2]
Recon: flaky cron on larder [type::recon]  ── toss ─▶        └─ Recon: flaky cron on larder [type::recon]
  ◀── seen-by mark: "also in: cafe@float-2"                       [from::shack@float-2/<id>] [echo::recon] [from-rev::3] [tossed::…]
  ◀── netmail: the cafe's comment, via echonet:…                  a comment here, and the shack's reply under it
  ── a reply written here ─────────────────────────▶
```

## The shapes

- **An area is a named view.** `[echo::<name>]` on a view (or any block with a `[query::…]`, a board lane included)
  names it. Its messages are its children, the notes tagged `[echo::<name>]`, and what its query matches
  (`parent:this OR echo=<name> OR <its query>`). Change the query and every subscriber follows; they bind to the name.
- **A posting** is `[echo::<name>]` on a plain note: it is in that area, even when no view names it. Two values
  (`[echo::recon] [echo::ideas]` or `[echo::recon, ideas]`) cross-post. Placement decides: on a block with a query the
  tag names an area, on any other note it posts.
- **Names can be dotted** (`ep0ch.requests`, `ep0ch.recon.repos`): a namespace that grows without coordination.
- **A subscription** is `[subscribe::<node mask>] [echo::<name or mask>]` on any note. Its children are one **source
  board** per node it reads (`<node> [echo-source::<node>]`), each with that node's copies under it.
  - Node masks read like hostmasks: `pie@float-2`, `*@float-2`, `rexall-*@laptop`, `*@*`; with no `@`, any machine.
    `@<page>` reads a named list: a page whose text and notes name nodes or masks. A `*` machine is any machine this
    node knows: this one, each with a forward or a machine file in `<outlines>/.remote/`, each named outright.
  - Area masks: `ep0ch.*`, `req*`, `*`.
  - `[since::<date>|all]`: what counts as new. Left out, the first toss writes `[since::<now>]`: from now.
  - `[cap::n]`: new copies a toss takes from each node (default 25, config `cap`), oldest first; the source board
    says `[waiting::n]` while more wait.
  - In the door, `,` on a subscription opens its settings card (the `echonet-subscription` component in
    `extension.json`): `subscribe` picks from the nodelist's nodes and masks over their machines.
  - An area's card is the view's with an `echonet-area` section under it (`[echo::]` declares it only with a
    `[query::]`, so a posting gets none).
- **A copy** is the original's text with `[from::<outline>@<machine>/<id>] [echo::<area>] [from-rev::<n>]
  [tossed::<time>]` on its first line, and the notes under it (copies too). A reference into the origin (`((id))`,
  `[[page]]`) becomes an `ep0ch://` link into it; a `[page::…]`, `[work-id::…]` or `[publish::…]` the original owns
  becomes `[from-page::…]` and so on, and a key EchoNet writes becomes `source-<key>`. A rule note's keys become
  `[from-rule-name::…]` and so on: a copy never runs as a rule here. An original kept off the web
  (`[publish::never]`) makes a copy kept off it too, and one kept off after it was copied makes the copy kept off at
  the next toss; a copy kept off here stays off when it takes the newer text.
- **Copies never post.** A note with a `from` in that shape is never a message, whatever its tags, so two nodes that
  read each other never bounce a copy; a mark that came over the network (`netmail-from`) never goes out again. The
  loop guard holds across any number of nodes.
- **Drift is the point.** A copy is a local note: edit it, move it, trash it; a trashed copy stays trashed. When the
  original changes, the copy gets `[upstream-newer::<n>]`; when it's trashed or deleted, `[upstream-gone::<day>]`
  (cleared if it comes back). The copy's text is never written by a toss. Two actions on a copy take the newer
  version when the person asks: **take-newer** replaces its text (its own edits stay in its history), and
  **compare-newer** proposes the original's text beside it, the difference drawn, to apply or dismiss.
- **Seen-by**: one whole-note mark on the original per node it reached (`kind=echo-seen-by`, `echo.node`), "also in:
  cafe@float-2 (Recon from the shack)". The original's text is never touched.
- **Netmail**: a highlight, comment or reply on a copy is carried to the original as a comment (at the same words
  when they're still there; else on the whole note, quoting them) with `via=echonet:<node>`,
  `netmail-from=<node>/<mark id>` and `netmail-author`. A reply written on that thread in the origin comes back into
  the copy's thread the same way. Netmail to an original that's gone is tried for 3 tosses (config
  `undeliverableAfter`), then left as an **undeliverable** note beside the copy (`[type::echo-undeliverable]
  [netmail::<mark>]`), never a queue that grows forever.
- **Nodelist**: `Nodelist [type::nodelist] [node::…] [last-toss::…]`, written again at every toss: each known node
  (this one, the ones it reads, the ones that read it), reachable or not and why (another protocol says which machine
  to update and how), its access, areas and subscriptions, its last toss. Under it, a **toss log** per run
  (`[type::toss]` with `copies`, `waiting`, `updated`, `gone`, `skipped`, `netmail-out`, `netmail-in`, `queued`,
  `undeliverable`) and the **ledger** (`[type::echo-ledger]`): each mark carried and where it went.

## Offline, access and conflicts

- **Offline is normal.** A node on another machine is asked through this node's host, which sends the request
  through the ssh forward the clients share. A machine or host that doesn't answer is unreachable for this toss: its
  copies stay as they are, and netmail for it stays here, counted as queued, until a toss reaches it. `config.json`'s
  `offline` shuts a lid on purpose. A machine whose outlines aren't where its login `ep0ch status` says gets a file
  beside its forward, `<outlines>/.remote/<machine>.json`: `{ "outlines": "/abs/folder/there" }`.
- **One access rule**: the origin's own (`ep0ch mcp access none|read|propose|full --ws <outline>`). `none` refuses,
  `read` lets a node copy, `propose` and `full` also let it leave marks there (seen-by and netmail). On this machine
  an outline whose owner never set a level is open to the host's extensions; on another machine it is `none`, and only
  outlines that set a level are listed to a `*` mask. What a node writes on another machine reads
  `ext:echonet@<its node>`.
- **A conflict is a note, never an overwrite**: a newer original is a marker on the copy; netmail on words the
  original no longer has lands on the whole note and quotes them.

## Running it

Off by default, installed per outline: `ep0ch ext add echonet --outline-folder <outlines>/<name>` copies it into
that outline's own `extensions/`. It tosses every 30 minutes. From the shell:

- `ep0ch echo toss [--ws <outline>]`: toss now (every node on this host with no `--ws`).
- `ep0ch echo nodelist [--ws <outline>]`: write and print the nodelist.
- `ep0ch echo subscribe <mask> <area> [--ws <outline>] [--since all|<date>] [--cap n] [--under <id>]`.
- `ep0ch echo areas [--ws <outline>]`: what the outline offers, what it reads, and what the other nodes offer.

In the door, the EchoNet screen (`ep0ch --screen echonet`) reads the areas as message areas.
