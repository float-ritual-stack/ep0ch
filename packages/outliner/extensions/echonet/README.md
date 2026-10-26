# EchoNet (outlines as nodes, store and forward)

Each outline is a node, named `outline@machine`, on a FidoNet-style network. Nothing is synced. A node copies the
messages of the areas it subscribes to, carries marks back to where they came from as netmail, and keeps a nodelist.
A copy is a photocopy sent to a friend: it takes on a life of its own here, and replies still find their way home.
Nodes mail, they never write each other's notes ([ADR 0005](../../../../docs/adr/0005-agents-act-nodes-mail.md)): each
node's tosser publishes a **bulletin** (what its areas offer) and hands **packets** (netmail, seen-by) to the nodes
whose notes they are about; each outline's own tosser writes its own notes, from the bulletins it reads and the packets
it was handed, and only where its own notes ask. The host carries the mail (`src/echonet-mail.ts`), to the outlines it
serves and, through the shared ssh forward, to other machines.

```text
shack@float-2 (origin)                                cafe@float-2 (subscriber)
Recon [type::virtual-branch] [query::type=recon]      Recon from the shack [subscribe::shack@float-2] [echo::recon]
      [echo::recon]                                     └─ shack@float-2 [echo-source::shack@float-2]
Recon: flaky cron on larder [type::recon]  ── bulletin ─▶     └─ Recon: flaky cron on larder [type::recon]
  ◀── packet: seen-by "also in: cafe@float-2"                    [from::shack@float-2/<id>] [echo::recon] [from-rev::3] [tossed::…]
  ◀── packet: netmail, the cafe's comment                        a comment here, and the shack's reply under it
  ── a reply written here, in the next bulletin ─▶
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
  [from-author::user|agent:<id>] [tossed::<time>]` on its first line, and the notes under it (copies too). A reference into the origin (`((id))`,
  `[[page]]`) becomes an `ep0ch://` link into it, its label kept whole (`((id|Rough edges (x)))` reads
  `[Rough edges (x)](ep0ch://…)`, `[[PIE-12|the plan]]` links PIE-12 as "the plan"); links are read by outline-core's
  grammar, bundled beside the tosser as `link-grammar.js` (`bun scripts/link-grammar.ts` writes it); a `[page::…]`, `[work-id::…]` or `[publish::…]` the original owns
  becomes `[from-page::…]` and so on, and a key EchoNet writes becomes `source-<key>`. A rule note's keys become
  `[from-rule-name::…]` and so on: a copy never runs as a rule here. An original kept off the web
  (`[publish::never]`) makes a copy kept off it too, and one kept off after it was copied makes the copy kept off at
  the next toss; a copy kept off here stays off when it takes the newer text.
- **A comment can be a message.** A comment or question whose tags put it in an area (a lane's
  `[query::#pie-request]` lists comments as well as notes) is copied as a note, never as a mark with no passage: its
  heading says what it's on and links the note there (`Comment on “Mulch is thin” in [The north bed](ep0ch://…)`), its
  store keys read `[from-type::annotation]`, `[from-annotation-status::open]`, and its replies are copied under it, its
  thread. A comment on that copy goes back as a reply in the original's thread. A note's own marks are never copied
  with it: they travel as netmail and seen-by.
- **Copies never post.** A note with a `from` in that shape is never a message, whatever its tags, so two nodes that
  read each other never bounce a copy; a mark that came over the network (`netmail-from`) never goes out again. The
  loop guard holds across any number of nodes.
- **Drift is the point.** A copy is a local note: edit it, move it, trash it; a trashed copy stays trashed. When the
  original changes, the copy gets `[upstream-newer::<n>]`; when it's trashed or deleted, `[upstream-gone::<day>]`
  (cleared if it comes back). The copy's text is never written by a toss. Two actions on a copy take the newer
  version when the person asks: **take-newer** replaces its text (its own edits stay in its history), and
  **compare-newer** proposes the original's text beside it, the difference drawn, to apply or dismiss.
- **A bulletin** is what a node publishes, written by its tosser at every toss (`<outlines>/<name>/echonet/
  bulletin.json`): its areas' messages and the notes under them, the originals other nodes hold copies of (so they can
  tell newer from gone), the netmail threads on those, and who left seen-by. A subscriber copies from it, never from
  the node's notes, so what it sees is the node as of its last toss.
- **A packet** is what one node hands another (`echonet/inbound/` there): seen-by marks and netmail for that node's
  originals, and, from a node that dials in, its bulletin. The receiving tosser imports it as its own write: an item
  about a note it doesn't publish is logged and dropped (`dropped` in the toss log), and a bulletin no subscription
  there reads is dropped too. The subscription and area notes are the whole consent.
- **Seen-by**: one whole-note mark on the original per node it reached (`kind=echo-seen-by`, `echo.node`), "also in:
  cafe@float-2 (Recon from the shack)", written by the origin's tosser from the packet. The original's text is never
  touched.
- **Netmail**: a highlight, comment or reply on a copy goes in a packet and lands on the original as a comment (at the
  same words when they're still there; else on the whole note, quoting them) with `via=echonet:<node>`,
  `netmail-from=<node>/<mark id>` and `netmail-author`. A reply written on that thread in the origin comes back into
  the copy's thread from the origin's next bulletin. Netmail to an original that's gone is tried for 3 tosses (config
  `undeliverableAfter`), then left as an **undeliverable** note beside the copy (`[type::echo-undeliverable]
  [netmail::<mark>]`), never a queue that grows forever.
- **Nodelist**: `Nodelist [type::nodelist] [node::…] [last-toss::…]`, written again at every toss: each known node
  (this one, the ones it reads, the ones that read it), reachable or not and why (another protocol says which machine
  to update and how), the netmail held for it, its areas and subscriptions and its last toss (from its bulletin).
  Under it, a **toss log** per toss that moved something or found trouble (a node unreachable, a subscription it
  can't read, a packet that stopped); a toss that moved nothing writes none, and the nodelist's `last-toss` (and the
  bulletin's age, `ep0ch echo status`, `ep0ch doctor`) says it ran (`[type::toss]` with `copies`, `waiting`, `updated`, `gone`, `skipped`,
  `netmail-out` (packed here), `netmail-in` (imported or carried in here, whoever handed it over), `seen-by-in`,
  `queued`, `held`, `undeliverable`, `dropped`; an `## imported` section lists each item with the note it landed on)
  and the **ledger** (`[type::echo-ledger]`): each mark packed or carried, and the last call of each node that dials
  in.

## Offline, consent and conflicts

- **Offline is normal.** A node's bulletin and its packets go through this node's host, and through the ssh forward
  the clients share to another machine. A machine or host that doesn't answer is unreachable for this toss: its copies
  stay as they are, and the packets for it wait in `echonet/outbound/<node>/`, counted as queued, until a toss reaches
  it. `config.json`'s `offline` shuts a lid on purpose. A machine whose outlines aren't where its login `ep0ch status`
  says gets a file beside its forward, `<outlines>/.remote/<machine>.json`: `{ "outlines": "/abs/folder/there" }`.
- **Consent is the notes, not the MCP access level** ([ADR 0005](../../../../docs/adr/0005-agents-act-nodes-mail.md)).
  An area offers (it is in the bulletin only because a view or note says `[echo::]`), a subscription asks (a packet's
  bulletin is kept, and copies made, only under one that names the node), and a packet lands only on a note its
  receiver publishes. `ep0ch mcp access` is for agents: EchoNet never reads it, so an outline at `none` for agents
  still mails. A `*` mask on another machine reads the outlines there that publish a bulletin (`echonet.list`).
  Everything a tosser writes is its own outline's, as `ext:echonet`, with its source in `from`, `via` and
  `netmail-from`.
- **One toss at a time** per outline: the schedule, a packet's arrival (the host starts the receiver's toss) and `ep0ch
  echo toss` share a lock beside the bulletin, and a second waits for the first.
- **One name per machine.** A node's machine is the name its person gave it: `<outlines>/.host/machine-name`
  (`ep0ch install --apply` asks once, or `--machine-name <name>`; `EP0CH_MACHINE_NAME` overrides it), else its host
  name. Give it the ssh name other machines reach it by. A machine named after its marks were made under its host
  name keeps them: each host says the names it went by (`notes.address`'s `aliases`), so a seen-by mark or netmail
  under the old name is the same node's (never counted twice, never sent again), and the nodelist lists them under
  the node as `- also known as:`.
- **A conflict is a note, never an overwrite**: a newer original is a marker on the copy; netmail on words the
  original no longer has lands on the whole note and quotes them.

## Running it

Off by default, installed per outline: `ep0ch ext add echonet --outline-folder <outlines>/<name>` copies it into
that outline's own `extensions/`. It tosses every 30 minutes. From the shell:

- `ep0ch echo toss [--ws <outline>]`: toss now (every node on this host with no `--ws`).
- `ep0ch echo nodelist [--ws <outline>]`: write and print the nodelist.
- `ep0ch echo subscribe <mask> <area> [--ws <outline>] [--since all|<date>] [--cap n] [--under <id>]`.
- `ep0ch echo areas [--ws <outline>]`: what the outline offers, what it reads, and what the other nodes offer.
- `ep0ch echo status [--ws <outline>]`: when each outline's tosser last ran ("tossed 4 min ago (every 30m)"), and a
  warning with the command when it's older than twice its schedule (exit 1). `ep0ch doctor` says the same.

In the door, the EchoNet screen (`ep0ch --screen echonet`) reads the areas as message areas.

### A machine that dials in

A laptop whose inbound ssh is off (a work policy, or gated by hand) can still ssh out. Mark it as the one that calls,
on it: `ep0ch install --apply --machine-name laptop --dials-in` (`<outlines>/.host/dials-in`; `--no-dials-in` undoes
it). Nothing can hand it anything, so each of its tosses **calls** every node on another machine it knows (the ones
that read it, the ones it reads, the ones that publish there): it **takes** the packets that node holds for it
(netmail and seen-by on its originals, `echonet.take`, kept here before they are acknowledged), imports them as any
packet, and at the end **leaves its bulletin** there (`echonet.put`), with what it packed for that node.

The node it calls (`pie@float-2`) learns from that packet that the machine dials in (`call float-hub@laptop -> <time>`
in its ledger, with `aka <old name> -> float-hub@laptop` for each name it went by) and never ssh's to it again. Its own
toss copies from the bulletin the laptop left, into its own subscriptions that name the laptop, exactly as from any
bulletin; what it packs for the laptop waits in `echonet/outbound/float-hub@laptop/` until the next call takes it.
The nodelist shows `- dials in · last call 2026-10-12 14:02 UTC` with `- netmail held: n` (the door's nodelist says
`DIAL`, never `DOWN`). Nothing grows beyond those packets. `<outlines>/.remote/laptop.json` on float-2 can say it
outright: `{ "dialsIn": true }` before the first call, `false` to call it again whatever the ledger learned. Both hosts
need protocol 154, and each outline's echonet copy this version (`ep0ch ext add echonet --outline-folder
<outlines>/<name>` again updates it).

### Troubleshooting: a node shows under two names

The nodelist has `## float-hub@laptop` and `## float-hub@evans-MacBook-Pro.local`, or an original has two seen-by
marks from one outline: that machine signs with its host name while this one reaches it as `laptop`. Name it as the
others reach it, on that machine: `ep0ch install --apply --machine-name laptop` (from here, `ssh laptop ep0ch install
--apply --machine-name laptop`). Both hosts need the same protocol. The next toss there signs as
`float-hub@laptop`; the next toss here learns the old name from it, lists it under `## float-hub@laptop` as
`- also known as:`, and counts the old marks as that node's.

## Whose words, and who wrote them

A copy or a carried comment holds words written elsewhere, and is **the extension's write** here (`author: agent`, actor
`ext:echonet`): never stored as this outline's person. The source's author rides beside it: `[from-author::user]` or
`[from-author::agent:<id>]` on a copy, `netmail-author` on a carried comment. Everything the tosser writes carries a mark
that tells it apart: a copy has `[from::]` and `[echo::]`, a carried comment `via` and `netmail-from`, and the nodelist, the
ledger, the toss logs, the receipts and the undeliverable notes `[echonet::<node>]`. A later edit by a person (a
property set on a copy, a replaced text) is theirs and is recorded as theirs.
