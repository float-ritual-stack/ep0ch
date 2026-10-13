# 0005: Agents act, nodes mail, readers read: three ways into an outline

Status: accepted, 2026-10-13. From Evan, on the EchoNet dial-in (#432): "are we mixing up 'mcp agents writing
across outlines' with 'netmail subs and store and forward and that whole sync process' … similar but different
enough that trying to abstract into the same system isn't the right call despite the temptation."

## Context

Three kinds of thing reach an outline from outside its own clients:

- **An agent** (claude.ai through the gateway, a Claude Code session, a door's own agent) reads and writes notes now,
  on the person's behalf ([ADR 0003](0003-agents-and-reach.md)).
- **Another node** (an outline on this machine or another, through EchoNet) sends copies of its areas and netmail
  (comments on those copies), and receives the same in return.
- **A reader** (a tailnet page, a share link, the public listener, the signed-in web) sees notes.

They look alike from far away: something outside writes or reads here. So they keep collapsing into one system. #432
gated EchoNet's writes on the MCP access level (`ep0ch mcp access none|read|propose|full`): the laptop's mail couldn't
land in pie unless pie let every MCP agent write directly. The gateway's netmail queue for an away machine (ADR 0003
§4) is the same temptation from the other side.

## Decision

### 1. Each way in has its own consent, and none borrows another's

| | who acts | what consents | the knob |
|---|---|---|---|
| **agent** | the agent, as the person's delegate, now | the person, per outline | the MCP access level (`none`, `read`, `propose`, `full`) |
| **node** | this outline's own tosser, importing what arrived | this outline's own subscription and area notes | the notes themselves (and EchoNet's nodelist, if a node must ever be refused) |
| **reader** | nobody writes; a reader only sees | what the outline publishes | `[publish::…]`, share links, sign-in |

- **The MCP access level is about agents and nothing else.** EchoNet never reads it, and a share link never reads it.
- **A node never writes another outline's blocks.** It hands over a packet (copies for the subscriptions that name it,
  netmail, seen-by marks) and picks up its own. The receiving outline's tosser imports the packet, writing as itself,
  and only where its own subscription notes ask. An item no subscription asks for is logged and dropped. That is
  FidoNet's shape: the hub holds the mail, and each system tosses its own.
- **The subscription note is the consent.** Writing `[subscribe::float-hub@laptop] [echo::recon]` under a parent is
  the outline saying "put that here". Areas are opt-in on the sending side the same way.

### 2. What they do share: provenance, revisions and undo

All three use the same parts for *recording* what happened, never for *permitting* it:

- **Attribution** follows ADR 0003: an agent's write carries its persona, principal and call; an import carries
  the tosser as its writer and `[from::outline@machine/id]` (and `netmail-from`, `via=echonet:<node>`) as its source.
- **Revisions and undo** are the same: an import is an ordinary write the person can see in history and take back.
- **"Held, then accepted locally" is one idea**, and it is fine to share its parts. An agent at `propose` leaves a
  proposal the person accepts; a node leaves a packet the tosser accepts under the subscriptions. Both mean the receiver
  decides. The *rule* for accepting stays separate: a person's judgment for an agent, the outline's notes for a node.

### 3. The tests for a change

- Does a change to one way in make another's knob mean something new? Then it's the collapse; split it.
- Does a node's delivery depend on anything but the receiving outline's own notes (and whether its tosser has run)?
  Then it's borrowing a consent that isn't its own.
- Does the gateway's away-machine queue carry anything but an agent's own writes, deferred? Notes travelling between
  outlines go through EchoNet, not the queue.

## Consequences

- The EchoNet follow-up to #432 replaces remote writes with packets in the hub's inbound and drops every
  `mcp.access.status` check. pie stays at `propose` for agents.
- The receiving tosser counts what it imported, whoever carried it, so `netmail-in` is true on every node, and two
  tossers can't make the same copy, because only the outline's own tosser writes it.
- A future "who can reach my outline" page shows the three side by side, each with its own knob. It never merges them
  into one setting.
