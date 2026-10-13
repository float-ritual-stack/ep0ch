---
name: echonet
description: Use when someone wants notes from one ep0ch outline to show up in another (on this machine or another), when setting up, checking or fixing EchoNet - areas, subscriptions, node masks, the nodelist, netmail, a toss that copied nothing, an unreachable or refused node, a protocol mismatch, undeliverable netmail - or when they say "echo", "subscribe to", "carry X into pie", "recon from every outline". Covers what EchoNet is (copies that drift, named views as areas), the exact properties, masks and dotted names, access levels, installing it, checking a toss, the common setups, troubleshooting, and a worked setup from the outline tools alone.
---

# echonet: outlines as nodes, copies that drift

EchoNet makes each outline a node (`outline@machine`, as `pie@float-2`) on a FidoNet-style network. A node's
machine is the name its person gave it (`<outlines>/.host/machine-name`, written by `ep0ch install --apply`; else its
host name), and it should be the ssh name other machines reach it by, so both sides call it the same. An outline
**offers areas**; another **subscribes** and gets **copies**. Nothing syncs. A copy is a photocopy sent to a friend:
it is an ordinary local note that can be edited, moved, tagged and talked about here, while marks on it travel
home as **netmail** and replies travel back. Live views across outlines are a different thing (for looking);
EchoNet is for keeping, drifting and talking.

It is the `echonet` extension (`packages/outliner/extensions/echonet`, its README has every shape), off by default,
installed per outline. Its **tosser** runs every 30 minutes in each outline it's installed in, or on demand.

## The shapes (properties by placement)

| What | Write | Where |
|---|---|---|
| An **area** | `[echo::<name>]` on a view or any block with a `[query::…]` (a board lane too) | the offering outline |
| A **posting** | `[echo::<name>]` on a plain note; `[echo::a, b]` or two tokens cross-post | the offering outline |
| A **subscription** | `[subscribe::<node mask>] [echo::<name or mask>]` on any note | the reading outline |
| Optional on it | `[since::all]` or `[since::2026-10-01]`; `[cap::<n>]` (default 25) | the subscription |

- An area's messages: its children, every note tagged with its name, and what its query matches. Subscribers bind
  to the *name*; change the query and they follow. A name with no view is an area too (its postings).
- Placement decides: `[echo::x]` on a block with a query names area x; on any other note it posts to x.
- Names can be dotted, Usenet-style: `ep0ch.requests`, `ep0ch.recon.repos`, `float.dispatch`. Naming with dots costs
  nothing now and lets `ep0ch.*` take a whole family later.
- **Node masks** read like hostmasks: `pie@float-2` (one), `*@float-2` (every outline there), `rexall-*@laptop`,
  `*@*` (everywhere this node knows: this machine, each with a forward or a machine file in `<outlines>/.remote/`, and
  any named outright in the subscription), a bare name (`pie`: any machine). `@<page>` reads a named list: a note
  with `[page::<page>]` whose text and child notes name `outline@machine` nodes or masks, anywhere in the text.
- **Area masks**: `ep0ch.*`, `req*`, `*`.
- `since` left out: the first toss writes `[since::<now>]` on the subscription. **From now** is the default (notes
  written or changed since); write `[since::all]` (or a date) to take what's already there. `cap` limits the new
  messages a subscription copies from each node per toss, oldest first (the notes under each come with it).

What the tosser writes (never edit these by hand; they're rewritten or read back):

- Under each subscription, a **source board** per node: `<node> [echo-source::<node>]`, `[waiting::n]` while more wait.
- A **copy** under the board: the original's text plus `[from::<node>/<id>] [echo::<area>] [from-rev::<n>]
  [tossed::<time>]`. References into the origin become `ep0ch://` links; `[page::]`, `[work-id::]`, `[publish::]`
  become `[from-page::]` etc., and a rule note's `[rule-*::]` keys `[from-rule-*::]` (a copy never runs as a rule). An
  original kept off the web (`[publish::never]`), then or later, gives a copy that is too; a copy kept off stays off.
- On a copy: `[upstream-newer::<n>]` (the original changed), `[upstream-gone::<day>]` (it was trashed or deleted).
  The text is never rewritten by a toss. The person chooses: the extension's actions **take-newer** (replace the text)
  and **compare-newer** (a proposal beside the copy showing the difference). In the door they're
  `ext.echonet.take-newer` / `ext.echonet.compare-newer` on the copy; from a shell `ep0ch ext act echonet take-newer --block <id>`.
- On the original: one **seen-by** mark per node ("also in: cafe@float-2 (…)"), never a text change.
- **Netmail**: a comment, highlight or reply on a copy goes to the original as a comment (`via=echonet:<node>`); a
  reply there comes back into the copy's thread. Netmail to an original that's gone is tried 3 tosses (config
  `undeliverableAfter`), then becomes an **undeliverable** note beside the copy (`[type::echo-undeliverable]`), and
  that mark is never sent, even if the original comes back.
- **Nodelist** `[type::nodelist]`: this node, the nodes it reads (a board each) and the ones that read it (their
  seen-by marks), reachable or not and why, access, areas, subscriptions, last toss. Under it, a **toss log** per run (`[type::toss]`, counts as properties, the why in its
  text) and the **ledger** (`[type::echo-ledger]`).

Copies never post: a note with an EchoNet `from` is never a message, so two outlines reading each other don't bounce,
and a mark that came over the network never goes out again.

## Access: one rule, the origin's own

`ep0ch mcp access none|read|propose|full --ws <outline>` (add `--machine <ssh-name>` for another machine's outline).
It's the same level the MCP gateway and shares use: raising it for EchoNet raises it for MCP clients too, so say so
before suggesting a change.

| Level | A subscriber may |
|---|---|
| `none` | nothing (refused) |
| `read` | copy (no seen-by, netmail queues saying it needs propose) |
| `propose` | copy, seen-by, netmail (comments only, never a change to a note) |
| `full` | the same, plus any write (EchoNet never needs it) |

On the **same machine**, an outline whose owner never set a level is open to the host's extensions. From **another
machine** an unset level is `none`, and `*@<machine>` lists only the outlines there that set one. So an outline
offered across machines needs a level set; `propose` is the usual one.

## Installing and running

- Install (the owner's step; it runs code in their host): `ep0ch ext add echonet --outline-folder <outlines>/<name>`
  for each outline that subscribes or offers. Plain `ep0ch ext add echonet` would turn it on for every outline.
- Toss now: `ep0ch echo toss --ws <name>` (no `--ws`: every outline on this host with it installed).
- Subscribe: `ep0ch echo subscribe '<mask>' <area> --ws <name> [--since all] [--cap n] [--title "…"] [--under <id>]`.
- Look: `ep0ch echo areas --ws <name>` (what it offers, what it reads with copies and waiting per node, what the
  nodelist says others offer); `ep0ch echo nodelist --ws <name>`.
- In the door: menu `A` or `ep0ch --screen echonet`: message areas, new counts, a reader with Origin and SEEN-BY.
- Another machine is reached through the shared ssh forward (`<outlines>/.remote/<ssh-name>.sock`). If that machine's
  own `ep0ch status` isn't the host to reach (an old `ep0ch` on its login PATH, a second host), name its outlines
  folder: `<outlines>/.remote/<ssh-name>.json` with `{ "outlines": "/abs/path/to/outlines" }`.

## Checking a toss

1. `ep0ch echo areas --ws <reader>`: does the subscription list a board for the node, with copies or `waiting`?
2. The last toss log (`outline_find` with `query: "type=toss"`; its `[at::]` says when): each node with a board, or
   named outright, has a line saying what it saw, copied, held back, refused or couldn't reach; the netmail lines say
   what went out, came in or queued and why. A `*` mask's nodes without a matching area aren't said.
3. The nodelist: `## <node>` sections, `- reachable · access <level>` or `- unreachable: <why>`.
4. In the offering outline: `ep0ch echo areas --ws <origin>` lists its areas; a seen-by mark on an original says it
   reached a node.

## Troubleshooting

| The log or nodelist says | Meaning | Do |
|---|---|---|
| `copies 0` on the first toss of a new subscription, and `[since::…]` appeared on it | it reads from now | `[since::all]` on the subscription, toss again |
| `no area there named X` | the origin offers no view or posting with that name | tag the view `[echo::X]` there, or fix the mask |
| `matches no node` | the mask found nothing (another machine lists only outlines with a level) | set a level there, check the machine name |
| `refused (… grants none …)` | the origin's level is none (or unset across machines) | the owner runs the command it names |
| `grants read; netmail needs propose` | copies come, marks queue | `ep0ch mcp access propose --ws <origin>` if they want marks to travel |
| `unreachable: …` (ssh, no host answers, a timeout) | that machine is off, asleep or its host is down | nothing: netmail queues and the next toss delivers. Check `ssh <machine> ep0ch status` |
| `protocol mismatch: … update <machine> (…)` | the two hosts run different versions | run the command it names on that machine (`ep0ch install --apply`) |
| `couldn't be listed` for a machine | a `*` mask couldn't ask that machine | as unreachable; or name the outline outright |
| `[waiting::n]` on a board | the cap held back n | wait for the next tosses, or raise `[cap::]` |
| an undeliverable note | the original was trashed or deleted upstream | read it; the comment stays on the copy. Restore the original there if it was a mistake (new comments go; that one stays) |
| `[upstream-newer::n]` | the original changed | leave it (drift is fine), or take-newer / compare-newer |
| a node shows under two names (`## float-hub@laptop` and `## float-hub@evans-MacBook-Pro.local`, or a second seen-by mark from one node) | that machine signed with its host name while others reach it by an ssh name | name it as the others reach it: `ssh <machine> ep0ch install --apply --machine-name <ssh-name>` (here: `ep0ch install --apply --machine-name <name>`). The next toss knows the old name as `also known as:` in the nodelist and counts its marks as the same node's |
| a toss log `stopped [failed::yes]` | the toss hit an error midway | its text says why; the next toss carries on from where it was |

## Common setups

- **ep0ch requests into pie** (from the gurgle on float-2 and float-hub on the laptop): in each source, tag the view or
  the notes that hold the requests `[echo::ep0ch.requests]` (in the gurgle a view `[query::#pie-request]` does it);
  float-hub sets `ep0ch mcp access propose --ws float-hub` on the laptop. In pie: `ep0ch echo subscribe '*@*'
  ep0ch.requests --ws pie --title "ep0ch requests"`.
- **Recon from every outline**: each outline tags its recon view `[echo::recon]` (or `ep0ch.recon.<topic>`); the
  reader writes `[subscribe::*@*] [echo::recon]` (or `ep0ch.recon.*`). Each source gets its own board.
- **A named set of nodes**: a note `Known nodes [page::known]` listing `pie@float-2`, `float-hub@laptop` one per line,
  then `[subscribe::@known] [echo::ep0ch.*]`. Edit the list to add or drop a node.

## Worked setup with the outline tools: the gurgle's requests into pie

Both outlines on float-2, EchoNet installed in both (if `ep0ch ext --ws pie ls` doesn't list echonet, ask
the owner to run the install lines above; don't run them for them unasked).

1. `outline_bind {"name": "gurgle"}`. Find what holds the requests: `outline_find {"query": "#pie-request"}`. If a view
   already lists them, `outline_read` it and `outline_set_property {"ref": "<view>", "key": "echo", "value":
   "ep0ch.requests", "revision": <its revision>}`. If none, make one: `outline_create {"parent": "root", "text":
   "pie requests [type::virtual-branch] [query::#pie-request] [echo::ep0ch.requests]"}`.
2. `outline_bind {"name": "pie"}`. Make the subscription where they want it read (ask where; a hub or the root):
   `outline_create {"parent": "<ref>", "text": "ep0ch requests [subscribe::gurgle@float-2] [echo::ep0ch.requests]
   [since::all] [cap::25]"}`. Use `[since::all]` only if they want the backlog; otherwise leave it out.
3. Toss: ask them to run `ep0ch echo toss --ws pie`, or wait for the half-hour run.
4. Check: `outline_read` the subscription with `depth: 2`: a board `gurgle@float-2 [echo-source::gurgle@float-2]` with
   copies under it. If not, `outline_find {"query": "type=toss"}` and read the newest log's lines, then the table above.
5. Tell them what landed, linking the subscription (`((id|ep0ch requests))`), and that comments on a copy reach the
   gurgle's note at the next toss.

Every write is yours, attributed; the tosser writes as `ext:echonet`. Never edit a source board, a copy's EchoNet keys,
the nodelist, toss logs or the ledger: change the subscription or the area instead.
