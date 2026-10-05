# 0002: Addressable resources: one URI, many clients

Status: accepted, 2026-10-05.

## Context

The outline is read and written by more than its own two clients now: Claude Code through the mod, agents through
the CLI, other harnesses (omp in Tern) through skills and `ep0ch find --json`, and soon any MCP client. Each of them
needs to name a block the same way, fetch it the same way, and open it in a door without learning how the door
lays out its readers. An agent nobody briefed found its way across machines in two minutes with the skills, the
JSON CLI and `name@machine` routing. That works because ids are everywhere and decisions are written into the
outline. This ADR fixes the shape of that so it doesn't drift per client.

It was worked out on Oct 5 by Evan, omp, daddy and loki, and built in #201–#206, #211 and #212 (PIE-559, PIE-520's
local part). Its ids follow [ADR 0001](0001-ids-names-roles.md).

## Decision

1. **One canonical address.** `ep0ch://<outline>@<machine>/b/<uuid>[#<fragment>]`
   (outline-core `addressable-resource.ts`). It says *what*, never *how*: no `?pane=`, no `?detail=`. The fragment
   names a place in the note (an `^anchor` or heading), and each viewer decides how to show it. Fields are
   percent-encoded and parsed, never interpolated into a shell. One parser accepts a uuid, `((uuid))` and the
   URI. A change to it bumps `PROTOCOL`. An outline is always `name@machine` in a stored reference or a remote call,
   never a bare name.
2. **A cache key is URI + `outlineInstanceId` + revision.** A database replaced by a restore, reset or import can
   land on the same revision (PIE-559). Its instance id changes, and every cache keyed on it is dropped. The id is
   the UUID in the database's metadata (it survives a reboot and a new inode). A restored backup carries the live
   UUID, so each open leaves a record beside the file (`<database>.instance.json`: the id, a token written into the
   database at that open, whether it closed, the sequence it closed at), and a database a clean close didn't
   describe (another token, another sequence, no record, an open that crashed) gets a fresh id before anything reads
   it (`outline-instance.ts`).
3. **Retrieval and presentation are separate.** MCP `resources/read` of a URI returns Markdown (every client can show
   it) plus an envelope: `uri`, `outlineInstanceId`, `revision`, `reachability`, `record`. Discovery and operations
   are tools with claude-mod's names (`outline_read`, `outline_find`, `outline_links`, …): one vocabulary. Rich views
   are PIE-520's one ViewSpec rendered per client (terminal, HTML as an MCP App, Markdown, JSON); `show --cells` is
   a stopgap for a client without a ViewSpec renderer. MCP promises the same read to every client, not the same
   picture.
4. **Access is the outline's own setting.** `none | read | propose | full` (PIE-562), kept by the service in the
   outline's metadata, `none` by default, set with `ep0ch mcp access`. One rule covers MCP, shares and
   subscriptions. A local stdio MCP server runs as the person and is gated by it. A remote gateway (claude.ai, a
   phone) also needs OAuth, an allowlist of who may use it (and optionally of which clients), and revocation.
   `[publish::]` is a different thing: a published block doesn't bypass `none`, and `ep0ch://` is never a public HTTP route. A remote read sends the note to the caller's
   model provider, so granting `read` is a disclosure decision.

   *Implemented (remote gateway):* `ep0ch mcp serve --http` (`packages/door/src/mcp-gateway.ts`) serves the stdio
   server's tools and resources from the same handlers (`answerMcp`) over streamable HTTP. It is an OAuth resource
   server with Clerk as the authorization server: a Clerk JWT access token (`at+jwt`), signed by the issuer's JWKS,
   with `aud` this endpoint, and a subject on `EP0CH_MCP_ALLOWED_SUBJECTS` (unset: refuse all and log the subject);
   `EP0CH_MCP_ALLOWED_CLIENTS` is the optional client allowlist. It reads only the outlines on its own machine's
   host, each still gated by its access setting, and never writes. Revocation is the access setting (at once), the
   allowlists (on restart), and Clerk's own grant (refresh). Clerk's JWT access tokens can't be recalled before
   they expire (a day).
5. **The door decides where an open lands; a host only routes and focuses.** `ep0ch open <uri> --json` resolves the
   outline and machine, finds the session, runs the door's own `open` action, and answers which session, reader and
   host pane received it (or `{opened: false, reason}`). A terminal host (Tern, Herdr, tmux) knows no socket, reader
   or landing rule: it asks ep0ch and focuses the pane ep0ch names. With no session, it starts
   `ep0ch --screen detail <uri>`: a ScreenSpec over the same NoteSurface, not another reader.
6. **Host panes are an id slot, not a privileged host.** A client reports where it runs as
   `clientHost: {kind, pane}` (`kind: "tern"` from `TERN_PANE`; Herdr's and tmux's pane ids fit the same slot), and
   `session list --json` and `open --json` report it. Nothing parses pane titles or matches a daemon's pid to a
   terminal.
7. **An agent moves what the person sees only under a visible grant.** Ordinary work: an agent's read is a trace,
   a mention is a link, a discovery is a mark, and it never navigates unasked. A *guidance lease* lets it open,
   scroll and stage for a walkthrough; focus and the cursor stay the person's, and data rules don't change. The
   lease is door session state, ephemeral like focus, shown on screen ("loki is guiding · esc takes it back"), and
   ends on esc, stop, the task's end, disconnect, timeout or a change of scope. It is granted by the person (one key
   on the door's "loki wants to guide you · ⏎ / esc", or a command they type), or by the harness from their literal
   words. A model never asserts a person's grant. A one-shot "open PIE-512" is a single-action grant, not a lease.

## Consequences

- Every output that names a block carries its URI (#203), and every new surface (MCP, shares, subscriptions,
  cross-outline links, a Tern route) takes it.
- A new client adapter is a renderer of ViewSpec, not a new UI model. ep0ch keeps its own schema.
- The remote gateway, MCP writes (`propose` and `full`, store-and-forward for a sleeping outline), the guidance
  lease and the Tern plugin are separate tickets on top of this; none needs another identity or permission model.
- A review asks of each new reference: is it a URI or an id (ADR 0001), and does its surface respect the outline's
  access setting.
