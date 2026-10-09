# 0003: Who an agent is, and what it can reach

Status: proposed, 2026-10-09.

## Context

The outline is reached by agents through two paths that grew up apart:

- **The Claude Code mod** (`packages/claude-mod`, from the pi-outliner repository) registers its own tools
  (`mcp__pi-outliner__outline_*`, `work_*`, `door_*`, `show`) and runs the outliner's CLI for each call. It reaches
  one outline: the one the session's folder names.
- **The ep0ch MCP server** (`packages/door/src/mcp*.ts`) offers `mcp__ep0ch__*` over stdio (`ep0ch mcp`, bound to one
  outline) and over HTTP (the gateway claude.ai uses, which serves every outline on its machine, mirrors of the
  others, and queues writes for a machine that is away).

A session with both sees ten tools with the same names and different implementations. The mod's copies lack what
MCP gained since (`outline_query`, threads, write receipts, `call` attribution); MCP lacks the workboard tools,
`outline_edit`, `outline_changes`, `view_order` and the opens. That is a second implementation of the parts
AGENTS.md says every client shares.

Identity has the matching problem. The gateway's principal is what OAuth proved, so every caller through it is
`claude.ai`, and `EP0CH_MCP_PERSONAS` maps that to one persona, `daddy`. That is right for claude.ai and wrong for
anything else that goes through the gateway: this ADR was drafted in a cloud Claude Code session whose only route to
pie was the gateway, so its writes would have been daddy's. Meanwhile one persona per machine (`loki` for float-2,
`cowboy` for the laptop) was considered and dropped: it ties a name to where an agent runs, so two threads on one
machine can't be told apart, a sleeping laptop holds its persona's mail, and every exception (gurgle's `kitty`) is
another machine-by-outline entry in a file that differs per machine.

How Evan names agents settles what a persona is. Any claude.ai chat is daddy, however many threads. Loki works on
ep0ch, mostly on float-2 for now, but a second thread is still loki and so is loki on the laptop. Kitty is gurgle's.
A persona is a character tied to the work, not to a machine or a thread.

This builds on PIE-679 (principal and persona) and PIE-685 (calls), and follows [ADR 0001](0001-ids-names-roles.md):
a persona is a *name* a person chose and is resolved on purpose; a principal and a call are ids.

## Decision

### 1. Three things say who wrote something, and each has one job

| | answers | set by | example |
|---|---|---|---|
| **principal** | where it came from, as the connection proved | automatic, never configured | `claude-code@float-2`, `claude.ai` |
| **call** | which conversation (and subagent) | automatic, always recorded | `c-3f2a…` › `agent-7` |
| **persona** | which character you are talking to | the outline | `loki`, `kitty`, `daddy` |

The actor id stays `mcp:<persona>/<principal>` (outline-core `attribution.ts`) and the call stays in the write's
`sessionId` (`<subject>#<call>`). Display is the persona, with the rest one step away: `loki`, then
`loki · 3f2a (claude-code@float-2)`.

### 2. A persona is defined in the outline

- **One block per persona,** `[type::agent]`, its page the persona's name (`[[loki]]`): what it works on, how it
  writes, its inbox. It lists the principals that may write as it. Property names are the implementation's to pick.
- **The server reads every agent block in every outline it serves** (mirrors included, so the laptop's are known
  while it sleeps). A name defined twice with different principals is refused as ambiguous, with both blocks' ids
  (ADR 0001, rule 2).
- **A block can also be a principal's default:** daddy's says it is `claude.ai`'s, so claude.ai needs no claim. That
  replaces `EP0CH_MCP_PERSONAS`, which is retired once the agent blocks exist.

### 3. Where a session's persona comes from

First match wins, and every one is a claim the agent blocks must allow, never a grant:

1. `OUTLINER_ACTOR`, else `EP0CH_AGENT` (a door tile's agent).
2. The folder's `.ep0ch`: `agent = "loki"` beside `ws` and `machine`. The persona belongs to the project, so loki is
   loki on any machine and in any thread.
3. The principal's default (a block saying it is `claude-code@laptop`'s default makes laptop sessions with no
   `.ep0ch` agent `cowboy`).
4. None: the write is the principal alone.

A claim the blocks don't allow is refused with the reason, as a persona claimed across principals is today. A
subagent writes as its session's persona; its call says which subagent.

### 4. The connection decides who you are; the server decides what you can reach

- **Claude Code always uses stdio**, never the gateway: its principal is `claude-code@<machine>`, never `claude.ai`.
  The plugin's manifest starts one stdio server per session, so nobody starts a server per outline.
- **Stdio and the gateway serve the same outlines** through one implementation: every outline on the local host,
  other machines' outlines through the shared ssh forward (`ensureForward`), and the mirror with the netmail queue
  when a machine is away. Today's `local` and `remote` outline sets become one, with two front doors that differ
  only in auth.
- **The netmail queue stays on the gateway's machine,** the one place a write waits whatever client sent it. A stdio
  server elsewhere reaches it over ssh.
- **The mod passes the call.** Its `tool.call` hook on `mcp__ep0ch__*` sets the existing `call` argument from the
  Claude Code session (and subagent), so a session's writes are one call across reconnects.

### 5. One tool set: `mcp__ep0ch__*`

- The mod registers no outline, workboard or door tools. What only it has today moves into the MCP server:
  `outline_edit`, `outline_changes`, `outline_resolve`, `view_order`, `note_section` and `work_*` (under the same
  access grant), and the opens.
- **`open` routes; the agent doesn't.** One `open` tool sends a note where this agent's opens land: its door tile,
  else the Outliner Detail beside it in Herdr, else the mod's pane. The stdio server offers it, and `door_*`, only
  when its environment has a door or Herdr (`EP0CH_CONTROL`, `HERDR_PANE_ID`); a Herdr-only operation with no door
  equivalent is `herdr_*` under the same rule. The gateway never lists them.
- The mod keeps what is presentation: tool rows, references as links, the band and pane, the binding card, program
  status, mentions ingest (now over MCP).

### 6. One place decides whether an agent may write

The outline's access grant (`none | read | propose | full`, ADR 0002) and the door's per-tile agent rules
(PIE-639) decide. Claude Code allows the server wholesale (`mcp__ep0ch` in the permission allow list), and the mod's
`tool.check` asks only before `outline_archive`. A refusal is a tool error that says why, never a prompt.

## Consequences

- **Addressing works on characters.** `@loki` in a comment reaches loki on either machine. An inbox pickup runs only
  in a session where it is turned on (`/inbox on`, normally the main thread), only when that session is idle, and
  claims the thread with a reply first, so two loki threads never both act.
- **AGENTS.md changes once this is accepted:** "Outlines by name" says `.ep0ch` holds `ws` and `machine` only; it
  gains `agent`, still a name. Outline-core's location parsing reads it.
- **`PROTOCOL` bumps** with the tool-set change and with the stdio reach change (wire and shared-module changes).
- **The mod shrinks** to presentation, and the duplicated `tool-args.ts` copy goes with its tools.
- **The Herdr console is unchanged.** Its features stay; the agent no longer has to know Herdr exists.
- Older ids (`mcp:daddy`, `claude-code`) keep parsing as they are; nothing is rewritten.

## Follow-up items

To file on the workboard (project `ep0ch-door`), blockers first:

1. **Personas from the outline.** `[type::agent]` blocks, `.ep0ch` `agent`, the claim order above, retire
   `EP0CH_MCP_PERSONAS`; the mod sets `call` per session and subagent.
2. **Stdio serves what the gateway serves.** One outline set for both transports; netmail over ssh. Depends on 1
   for attribution.
3. **One tool set.** Port the mod-only tools to MCP, add `open` / `door_*` / `herdr_*` to stdio, connect stdio from
   the plugin manifest, delete the mod's tools. Fix the mod's `/resume` and `/branch` state reset and drop
   `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` from the installer on the way. Depends on 2.
4. **Permissions and formatting.** Allow `mcp__ep0ch` wholesale; load the core tools and `outline_components`
   upfront (`isDeferred: false`); the note floor as context; a formatting lint in write receipts.
5. **One band: inbox, questions, outbox, mentions.** Each a service query, so the door can show the same lists.
6. **Inbox pickup.** A comment to a persona starts a turn in that persona's session.
7. **References in the prompt.** Context for Work IDs and `[[pages]]` you type; completion once Claude Code's
   prompt API is checked against the installed types.
