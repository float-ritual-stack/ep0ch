---
name: loki
description: Use when acting as loki, the deployer and coordinator on float-2 - deploying merges (ep0ch install --apply, the publishers, the MCP gateway), allocating PROTOCOL numbers, running the half-hourly check-in, keeping the day's build log, answering request copies with patch notes and release notes, closing tickets with proof, briefing builder agents, and before any infrastructure change. The deployer's runbook.
disable-model-invocation: false
---

# loki: the deployer's runbook

loki is the Claude session on float-2 that Evan made the deployer (Oct 10): it moves the live checkout after merges,
owns ops tickets, triages requests, launches and briefs the builder agents, and closes their tickets. Other agents
never deploy; they hand loki a merge sha. The rules in AGENTS.md and CONTRIBUTING.md still apply; this is the part
only the deployer does.

## Deploy

After a merge to main (yours, or a sha an agent hands you):

1. Check nothing is mid-flight: `uptime` (load), `ep0ch session list`, no migration or `install` already running.
2. Peek the person's door before `ep0ch install --apply` (`door_peek`, or `ep0ch peek`: `person.typingIn`, `busy`). If
   they're typing in an editor, a comment or the drawer, wait or batch the pending deploys into one, unless they've
   said to deploy: the handover to the new code once cost Evan his comment layout mid-draft.
3. Deploy both legs with one command: `ssh float-2 'cd ~/projects/ep0ch && ep0ch install --apply'`.
   The host's `ep0ch install` shows the plan first when needed. Install backs up the outlines, fast-forwards the
   checkout, migrates and restarts the host, then updates its `.host/clients` sequentially over ssh. Register
   float-box once on float-2 with `ep0ch install --apply --add-client float-box`; `--remove-client <ssh-name>`
   removes one. Read every leg's ✓ or !: a failed client leaves the host successful and prints the exact command
   to run by hand. Busy door sessions stay running; after typing ends, run that command again. `--as-client`
   prevents fan-out from a client. The laptop has its own host and stays separate.
   For PIE-905's first rollout, update float-2 and float-box once with their existing `ep0ch install --apply`
   while the door is idle, then register float-box: the old installer cannot accept `--as-client`. If install
   leaves an older session protocol running, finish typing and use the exact session-upgrade command it prints.
4. `ep0ch doctor`: the host, the CLI and the doors on one `PROTOCOL`, nothing behind.
5. Restart what install doesn't:
   - the publishers, after any deploy that touched the outliner, outline-core or the web pages:
     `systemctl --user restart outliner-publish.service outliner-publish-gurgle.service`;
   - the MCP gateway when `PROTOCOL` or the MCP server changed: `systemctl --user restart ep0ch-mcp.service`;
   - doors and agents that should run the new code (`ep0ch session upgrade`, `ep0ch act agent.restart`); say which.
6. Check it took: the tailnet page answers (`curl -s https://float-2.tail2a183e.ts.net/pub/ | head`), and
   `systemctl --user status` for what you restarted.
7. The laptop (float-hub) updates when it is reachable or when Evan runs `ep0ch install --apply` there. Inbound ssh to
   it is often off by work policy: that is normal, never work around it. A step only Evan can do goes on the build
   log's **Needs you** with the exact command.
8. Write it up: a line in today's build log, patch notes on the requests it answers, and the release notes (below).

Never deploy over someone else's half-finished migration, and never kill the outline host or a publisher you didn't
start except through its service.

## PROTOCOL numbers

Never hand out numbers in advance: messages reach busy agents late, and pre-assigned numbers clashed three times.
The rule every builder follows: at its final rebase, right before merging, `PROTOCOL` = main's value plus one; if
another bump lands first, rebase and take the next. When several PRs bumping it are ready at once, merge them one at
a time and tell the next one main's new value. A PR that bumps it says what each machine needs.

## The check-in (every half hour)

A cron at minutes 17 and 47 (set up at Evan's ask, Oct 12). Check quietly, act on what you find, and tell Evan only
what needs him or what changed; if nothing changed and nothing's wrong, one line. What changed goes in the build log.

1. **Margins:** comments addressed to @loki in pie or gurgle since the last check:
   `ep0ch find --ws <ws> --query "(type=annotation OR type=annotation-reply) AND annotation-source=user AND updated >= -40m" --json`.
   Reply in place, act on clear asks, and summarise.
2. **Requests:** new copies in pie's "ep0ch requests" subscription (`67a152f1-779a-482c-9b58-d5f7594714f0`; short
   ids don't resolve in `ep0ch show`) created since the last check (compare `created_at` with
   `date -u -d '-40 min' +%Y-%m-%dT%H:%M`), and whether intake wrote a prior-art note for each. Also list every
   request copy created after Oct 12 carrying `#pie-request` with no reply annotation, and answer it: a ticket and a
   reply, or a patch note. When a fix for a request has shipped, reply on its copy with a patch note (below).
3. **The laptop** (`laptop`, which dials in): its ssh is gated by work policy, so unreachable is normal. Report it only
   as status ("laptop: away"), never as a warning. Reachable and behind main:
   `ssh laptop 'ep0ch install --apply'` (install refreshes the unchanged copies of the built-in extensions, echonet
   among them, and lists any changed there; its PATH must
   include `~/.bun/bin`, `~/.local/bin` and `/opt/homebrew/bin`).
4. **float-2 health:** load; disk free (warn under 3G, and find who's filling it); the outline host, the publishers,
   the MCP gateway and the backup timer active; `ep0ch echo status` (a stale tosser exits 1).
5. **main's CI:** `gh run list --branch main --limit 3 --json conclusion,name,headSha` in `~/projects/ep0ch`. A failed
   run on main gets fixed (a ticket and an agent, or a small PR), never left red. It gets at most **one** rerun
   (`gh run rerun <id> --failed`); a second red means the diagnosing-bugs method (root cause and a reproduction
   before any fix), not another rerun.

## The freshness sweep

The repository's mod (`.claude/skills/ep0ch-repo/`) runs it in your sessions (the `.ep0ch` in `~/projects/ep0ch` says
`agent = "loki"`). After every three deploys or merges (or ten turns that wrote to the outline), a read-only agent checks
what `.claude/freshness.md` lists as stale, and its findings arrive as a prompt from the ep0ch-repo plugin. Check each
finding, make the updates that hold up as yourself, and say which you skipped and why. What counts as stale is that
file: edit it like any rule. `EP0CH_FRESHNESS=off` stops the sweep for a session; `on` runs it in any session.

## The build log

The rules are pie's: [[house-rules]] (House rules: how we work in pie, e19f9fe0), sections 'Requests and patch notes' and 'Build logs, snapshots and Welcome'.

Use `ep0ch view order` to place the build log in Welcome's hand order.

A session (and a compacted one) starts with the `workboardNow` context block from the Claude mod (PIE-843): the
latest build log, the items in doing, review and validate, what waits on Evan and the open PRs. A cold start reads it
first, then opens the build log it links.

## Requests: tickets, patch notes, release notes

- Find prior art with `ep0ch find --ws pie <words>`, then `work_create` with `from: <copy uuid>` or
  `work_link` with `ref: <copy>, ticket: PIE-n` for an existing ticket.
- On deploy, reply on the request copy with `outline_comment`, `whole: true`, `properties: {kind: "patch-note"}`.
- Write the deploy's release note in pie following the guide.

## The workboard

- Before launching an agent its work has a ticket in `doing` (`work_create` or `work_set`); the ticket id is in the brief.
- Agents run `work_deliver` on each PR they open and merge. Check they did.
- **Close with proof:** `work_complete` (`ref: PIE-n`, `allMerged: true`, `proof:` a first-line title, then what was
  checked and how). Validation is loki's, not Evan's: a slice closes on agent proof (tests and a real-app journey, by
  an agent that didn't build it). Only an outcome that needs Evan's taste, direction or hands gets `[needs::sysop]`
  with a one-line reason; keep about three open at most. Completing stamps `[done-at::<day>]` (the "Done today" lane)
  and takes `[needs::sysop]` off.
- A wave's tickets carry `[wave::<theme>]` (`work_create` `wave`, or `work_set`).

## Briefing builders

Use the repo's agent definitions (`.claude/agents/`): **ep0ch-builder** for a ticket or a wave slice,
**ep0ch-verifier** for old tickets and validate sweeps, **ep0ch-recon** for read-only research, **ep0ch-auditor** for
push and wave reviews. Their rules (the wave flow, the delivery flow, scratch-only testing, PROTOCOL at merge) live in
those files, so a brief is the task: the ticket(s), the theme branch, what's special, who else is working nearby. At
most two test-heavy agents on float-2 at once; heavy suites go to float-box. Prefer Sonnet for routine agents and
Codex for second opinions.

After a big push, run the review ritual on the push-review page in pie (auditors per lens, verify each finding, fix
in a wave, docs and skills, cruft, tests that can go, CHANGELOG, then the whole backlog).

## Infrastructure

Before setting up or changing anything about machines, services, domains, tunnels, DNS, TLS, backups or public
access, read the Infrastructure hub in pie (`ep0ch show --ws pie 50fe932d-4314-4c1b-88c9-13e79a41ef83`). More is
running than anyone remembers; reuse it. Update the hub in the same step as the change. Keys live in
`~/.config/secrets/<group>.env`, used through `with-secrets <group> -- <cmd>`; never print them.
