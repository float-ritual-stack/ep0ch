# EchoNet

Notes from your other outlines, and other people's, copied into this one by subscription. Nothing is synced: a copy is a photocopy sent to a friend, and replies still find their way home.

## Where to look

- **Your subscription note:** its children are one source board per node it reads, each with that node's copies.
- **`Nodelist`:** every known node, whether it's reachable, and when it last tossed.
  - Under it, a toss log for each toss that moved something or found trouble.
- **The door:** `ep0ch --screen echonet` reads the areas as message areas.
- **From a shell:** `ep0ch echo areas` shows what the outline offers, what it reads and what other nodes offer.

## What you do

- **Offer an area:** write `[echo::<name>]` on a view (a note with a `[query::…]`, a board lane included).
- **Post one note:** write `[echo::<name>]` on a plain note. Two values cross-post: `[echo::recon, ideas]`.
- **Subscribe:** write `[subscribe::<node mask>] [echo::<area>]` on any note, or run `ep0ch echo subscribe <mask> <area>`.
  - Options: `--since all|<date>`, `--cap n`, `--under <id>`.
  - In the door, `,` on a subscription opens its settings card.
- **Toss now:** `ep0ch echo toss [--ws <outline>]`. It tosses every 30 minutes by itself.
- **Check it ran:** `ep0ch echo status` says when each tosser last ran, and warns with the command when it's overdue.
- **Take the newer version of a copy:** run **take-newer** to replace its text, or **compare-newer** to see the difference first.
- **Reply to a copy:** comment or highlight on it; it goes back to the original as netmail.

## Good to know

- **A copy is a local note.** Edit it, move it, trash it; a trashed copy stays trashed.
- **The copy's text is never rewritten by a toss.** When the original changes it gets `[upstream-newer::<n>]`.
  - When the original is trashed or deleted it gets `[upstream-gone::<day>]`, cleared if it comes back.
- **Copies never post.** A note with a `from` is never a message, so two nodes that read each other never bounce a copy.
- **A conflict is a note, never an overwrite.** Netmail on words the original no longer has lands on the whole note and quotes them.
- **Offline is normal.** A node that doesn't answer is skipped, its copies stay as they are and its packets wait.
- **Consent is the notes.** An area offers, a subscription asks, and a packet lands only on a note its receiver publishes.
  - `ep0ch mcp access` is for agents; EchoNet never reads it, so an outline at `none` still mails.
- **Kept-off notes stay off.** A copy of a `[publish::never]` original is kept off the web too.
- **One toss at a time** per outline: the schedule, a packet's arrival and `ep0ch echo toss` share a lock.

## Setup

- **Install:** `ep0ch ext add echonet --outline-folder <outlines>/<name>`, per outline; it's off by default.
  - Run it again to update the copy.
- **Machine name:** other machines reach this one by the name in `<outlines>/.host/machine-name`.
  - Set it with `ep0ch install --apply --machine-name <name>`, or `EP0CH_MACHINE_NAME`; else the host name is used.
- **A machine in another place:** if its outlines aren't where its login `ep0ch status` says, add `<outlines>/.remote/<machine>.json`.
  - Its content: `{ "outlines": "/abs/folder/there" }`.
- **Config:** `offline`, `keepLogs` (20), `cap` (25) and `undeliverableAfter` (3) in `config.json`.
  - `offline` shuts a lid on purpose by listing nodes to treat as unreachable.

### A laptop that dials in

- **When to use it:** inbound ssh to the laptop is off, but it can still ssh out.
- **Mark it, on the laptop:** `ep0ch install --apply --machine-name laptop --dials-in`. `--no-dials-in` undoes it.
- **Each toss then calls** every node on another machine it knows.
  - It takes the packets held for it, imports them, and leaves its own bulletin there.
- **The node it calls** learns the laptop dials in and never ssh's to it again.
  - What it packs for the laptop waits in `echonet/outbound/float-hub@laptop/` until the next call.
- **The nodelist shows** `- dials in · last call …` and `- netmail held: n`; the door says `DIAL`, never `DOWN`.
- **Override on float-2:** `<outlines>/.remote/laptop.json` with `{ "dialsIn": true }` before the first call, or `false` to call it anyway.
- **Both hosts need protocol 154,** and each outline's echonet copy this version.

### A node shows under two names

- **Symptom:** the nodelist has `## float-hub@laptop` and `## float-hub@evans-MacBook-Pro.local`, or an original has two seen-by marks from one outline.
- **Cause:** that machine signs with its host name while this one reaches it as `laptop`.
- **Fix, on that machine:** `ep0ch install --apply --machine-name laptop`; from here, `ssh laptop ep0ch install --apply --machine-name laptop`.
  - Both hosts need the same protocol.
- **Afterwards,** the next toss there signs as `float-hub@laptop`, and the next toss here lists the old name as `- also known as:`.
  - The old marks count as that node's.

## How it works

```text
shack@float-2 (origin)                                cafe@float-2 (subscriber)
Recon [type::virtual-branch] [query::type=recon]      Recon from the shack [subscribe::shack@float-2] [echo::recon]
      [echo::recon]                                     └─ shack@float-2 [echo-source::shack@float-2]
Recon: flaky cron on larder [type::recon]  ── bulletin ─▶     └─ Recon: flaky cron on larder [type::recon]
  ◀── packet: seen-by "also in: cafe@float-2"                    [from::shack@float-2/<id>] [echo::recon] [from-rev::3] [tossed::…]
  ◀── packet: netmail, the cafe's comment                        a comment here, and the shack's reply under it
  ── a reply written here, in the next bulletin ─▶
```

- **Nodes mail, they never write each other's notes** ([ADR 0005](../../../../docs/adr/0005-agents-act-nodes-mail.md)).
  - Each tosser publishes a **bulletin** and hands **packets** to the nodes whose notes they are about.
  - Each outline's own tosser writes its own notes, only where its own notes ask.
- **The host carries the mail** (`src/echonet-mail.ts`), to the outlines it serves and through the shared ssh forward to other machines.
- **An area is a named view.** Its messages are its children, the notes tagged `[echo::<name>]`, and what its query matches.
  - Change the query and every subscriber follows; they bind to the name.
- **Names can be dotted** (`ep0ch.requests`), a namespace that grows without coordination.
- **A bulletin** is what a node publishes at every toss, in `<outlines>/<name>/echonet/bulletin.json`.
  - It holds its areas' messages, the originals other nodes copied, the netmail threads, and who left seen-by.
  - A subscriber copies from it, never from the node's notes, so it sees the node as of its last toss.
- **A packet** is what one node hands another (`echonet/inbound/` there): seen-by marks and netmail, or a bulletin from a node that dials in.
  - An item about a note the receiver doesn't publish is logged and dropped (`dropped` in the toss log).
  - A bulletin no subscription reads is dropped too.
- **Seen-by:** one whole-note mark on the original per node it reached ("also in: cafe@float-2 (Recon from the shack)").
  - The original's text is never touched.
- **Netmail:** a highlight, comment or reply on a copy lands on the original as a comment, with `via=echonet:<node>`.
  - It goes at the same words when they're still there, else on the whole note, quoting them.
  - A reply written in the origin comes back into the copy's thread from its next bulletin.
- **Undeliverable netmail** is tried for 3 tosses (`undeliverableAfter`), then left as a `[type::echo-undeliverable]` note beside the copy.
- **Waiting packets** sit in `echonet/outbound/<node>/` until a toss reaches the node.

## The subscription in detail

- **Node masks read like hostmasks:** `pie@float-2`, `*@float-2`, `rexall-*@laptop`, `*@*`; with no `@`, any machine.
  - `@<page>` reads a named list: a page whose text and notes name nodes or masks.
  - A `*` machine is any machine this node knows: this one, those with a forward or a machine file, and each named outright.
- **Area masks:** `ep0ch.*`, `req*`, `*`.
- **`[since::<date>|all]`** is what counts as new. Left out, the first toss writes `[since::<now>]`.
- **`[cap::n]`** is new copies a toss takes from each node (default 25), oldest first.
  - The source board says `[waiting::n]` while more wait.
- **Placement decides:** `[echo::]` on a block with a query names an area; on any other note it posts.
  - An area's card is the view's with an `echonet-area` section under it.

## What a copy holds

- **The original's text,** with `[from::<outline>@<machine>/<id>] [echo::<area>] [from-rev::<n>] [from-author::…] [tossed::<time>]` on its first line.
  - The notes under it are copies too.
- **References become links into the origin.** `((id))` and `[[page]]` turn into `ep0ch://` links, labels kept whole.
  - `((id|Rough edges (x)))` reads `[Rough edges (x)](ep0ch://…)`.
  - Links are read by outline-core's grammar, bundled as `link-grammar.js` (`bun scripts/link-grammar.ts` writes it).
- **Owned keys are renamed.** A `[page::…]`, `[work-id::…]` or `[publish::…]` becomes `[from-page::…]` and so on.
  - A key EchoNet writes becomes `source-<key>`.
  - A rule note's keys become `[from-rule-name::…]`, so a copy never runs as a rule here.
- **A publish lock follows.** A copy of a `[publish::never]` original is kept off the web, and one locked after copying is kept off at the next toss.
  - A copy kept off here stays off when it takes the newer text.
- **A comment can be a message.** A comment whose tags put it in an area is copied as a note.
  - Its heading says what it's on, such as `Comment on “Mulch is thin” in [The north bed](ep0ch://…)`.
  - Its keys read `[from-type::annotation]` and `[from-annotation-status::open]`, and its replies come under it.
  - A comment on that copy goes back as a reply in the original's thread.
- **A note's own marks** never travel with it; they go as netmail and seen-by.

## The nodelist and toss logs

- **Nodelist:** `Nodelist [type::nodelist] [node::…] [last-toss::…]`, written again at every toss.
  - Each known node: this one, the ones it reads, the ones that read it.
  - Each says whether it's reachable (and why not), the netmail held, its areas and subscriptions, and its last toss.
- **A toss log** (`[type::toss]`) is written only for a toss that moved something or found trouble.
  - Counts: `copies`, `waiting`, `updated`, `gone`, `skipped`, `netmail-out`, `netmail-in`, `seen-by-in`, `queued`, `held`, `undeliverable`, `dropped`.
  - An `## imported` section lists each item with the note it landed on.
- **A quiet toss** writes none; `last-toss`, `ep0ch echo status` and `ep0ch doctor` say it ran.
- **The ledger** (`[type::echo-ledger]`) lists each mark packed or carried, and the last call of each node that dials in.
- **Old names:** a machine renamed after its marks were made keeps them, so they're never counted twice or sent again.

## Whose words, and who wrote them

- **A copy or carried comment is the extension's write** (`author: agent`, actor `ext:echonet`), never stored as this outline's person.
- **The source's author rides beside it:** `[from-author::user]` or `[from-author::agent:<id>]` on a copy, `netmail-author` on a comment.
- **Everything the tosser writes is marked:** a copy has `[from::]` and `[echo::]`, a carried comment `via` and `netmail-from`.
  - The nodelist, ledger, toss logs, receipts and undeliverable notes carry `[echonet::<node>]`.
- **Your later edits are yours,** and recorded as yours.
