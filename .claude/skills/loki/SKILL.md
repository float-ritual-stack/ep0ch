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

## Reorient first

At session start and after every compaction, read pie's **Reorient here** note before anything else (`ep0ch show --ws pie 63132a65-e443-422f-85a7-10e5a64b9869 --machine float-2`) and run its checklist: am I the only loki, who else is running (Claude sessions and Codex), build log current, landed notes and deliveries synced, validate, builders to nudge (`~/.local/state/ep0ch/box-test.tsv`), free slots, hand-offs, health. Fix what's stale before new work.

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
3. **The laptop** (`laptop`, which dials in): read `ep0ch link status --json` on float-2. The inbound `laptop` row
   with `transport: "link"` owns presence: `up: false` (or no row) means "laptop: away"; retain its last-up time
   and down reason when useful. Use `ep0ch find --ws float-hub --machine laptop` for outline reads; it tries the
   link before SSH. Inbound SSH is gated by work policy and is not a presence probe. Report away as status,
   never as a warning. When the link is up and a deploy is needed, SSH is still required to execute the install;
   if policy keeps it off, leave the laptop update for Evan's local install. Reachable over SSH and behind main:
   `ssh laptop 'ep0ch install --apply'` (install refreshes the unchanged copies of the built-in extensions, echonet
   among them, and lists any changed there; its PATH must
   include `~/.bun/bin`, `~/.local/bin` and `/opt/homebrew/bin`).
4. **float-2 health:** load; disk free (warn under 3G, and find who's filling it); the outline host, the publishers,
   the MCP gateway and the backup timer active; `ep0ch echo status` (a stale tosser exits 1).
   On float-2 and float-box, run `bun scripts/fake-ssh-check.ts` from the checkout: more than 10 forwards is a
   leak (exit 1). Find the owning runs; stop only your own. `scripts/agent-env <name> --clean` sweeps that agent's
   old forwards as well as its scratch folders.
5. **Deploys:** read `ep0ch find --ws pie --query "type=deploy machine=install created >= -40m" --json`
   on float-2. Compare the records' Who and Session with your actor and session and the installs you ran since the
   last check-in. Flag any deploy you did not run (including one by another session with the same persona), link
   its note, and put it in the build log. An unfinished record needs its install output checked; it is not proof
   that the install finished. The Deploys view is newest first; the live table in its note can be copied into the
   build log to show the last five.
6. **main's CI:** `gh run list --branch main --limit 3 --json conclusion,name,headSha` in `~/projects/ep0ch`. A failed
   run on main gets fixed (a ticket and an agent, or a small PR), never left red. It gets at most **one** rerun
   (`gh run rerun <id> --failed`); a second red means the diagnosing-bugs method (root cause and a reproduction
   before any fix), not another rerun.

## The freshness sweep

The repository's mod (`.claude/skills/ep0ch-repo/`) runs it in your sessions (the `.ep0ch` in `~/projects/ep0ch` says
`agent = "loki"`). After every three deploys or merges (or ten turns that wrote to the outline), a read-only agent checks
what `.claude/freshness.md` lists as stale, and its findings arrive as a prompt from the ep0ch-repo plugin. Check each
finding, make the updates that hold up as yourself, and say which you skipped and why. What counts as stale is that
file: edit it like any rule. `EP0CH_FRESHNESS=off` stops the sweep for a session; `on` runs it in any session.

## A settled thread (the settle check wakes you)

The Claude mod (`packages/claude-mod/hooks/settle.ts`) runs the check in your sessions every 30 minutes (PIE-1268, the
capability ((46e391fb-dcd7-46eb-a6f2-f8f71d45f5cb|Settle, then shape))). Per `[thread::…]` it counts the notes, Evan's
own among them, and the last touch, across `settleOutlines`; a thread with at least 3 notes (one of them Evan's), quiet
for an hour, wakes you once: `thread <x> settled: <n> chirps, <m> Evan's, quiet <t> min, no capability or hub note yet …`. A ticket, a
capability note or a hub (`type=hub`, `type=thread`) carrying the `thread` shapes it, so a stream with a home never wakes you. Up to
five a wake; the rest come at the next check. The pie "Threads" page (hub › Browse) shows warming and shaped live;
each move into or out of settled or shaped is already a line under the day's build log, so you don't write it.

1. **Read the thread** (`ep0ch find --ws gurgle --query 'thread="<x>"' --sort created`), not only the wake. If it is
   chatter that needs no shape, say so in one line on the thread's note and go on: it stays settled until someone
   touches it.
2. **Shape it on a capability note** (an idea's own, or a new `[type::capability]` note under Capabilities, with
   `[thread::<x>]` on it; a stream that already has a hub gets `[thread::<x>]` on the hub instead, and needs no more): the north star in Evan's words, the parts it uses, the glue, open
   questions. A new framing is a line there, not a ticket.
3. **Cut tickets only for primitives**, each with the Parts-it-uses table the root AGENTS.md asks for, and
   `[thread::<x>]` on every ticket (the capability note already turned the thread shaped; the tickets keep it so).
4. **Start builders within budget** (two test-heavy agents on float-2, five in all); the rest wait for a free slot (below).
5. **Gate only taste and direction** (`[needs::sysop]`, about three open). Evan does not have to say go for the rest.

The check is off in every session but yours: `EP0CH_SETTLE=on|off` (or the mod's `settle` option) overrides, and
two properties on the settle capability note (the newest edited note carrying each; the folder's `.ep0ch/config.toml` holds names only and is never read): `[settle-outlines::gurgle@float-2, pie@float-2]` (default `pie` and `gurgle` on the outline's machine; `EP0CH_SETTLE_OUTLINES` overrides) and `[settle-tuning::chirps=3; quiet=60; within=4320; wake-max=5; base=…]` (`settleTuning` or `EP0CH_SETTLE_TUNING` overrides) tune
it. The first check only records what was already settled (one baseline line in the build log). Thresholds are guesses: tune them from a week of real threads.

## Draining Up next

When a builder slot or a box-test slot is free and nothing is settling (no wake pending, no thread you owe a shape),
take the next item from Up next (the briefing's section, aca85598, or the Waiting to start lane in the Roadmap Hub),
start a builder on it within the budget, and close it on proof the same day. The backlog drains because there was room,
not because Evan said go; one-way doors (infrastructure, deletion, a protocol bump) still get a one-line heads-up first.

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

## Restarting your own session

Your session is a Claude Code background job (`claude agents --json` lists it; `ssh` and the drawer are only windows onto
it), so a changed `~/.bashrc` reaches you only through a restart. `scripts/agent-restart <your session id> --fresh-daemon
--check-env <VAR>`, run detached (`setsid nohup … &`), waits until your builders have pushed and stopped, then stops you,
starts a fresh daemon and resumes you with a note pointing at its log. Stop each builder once its branch is pushed (a
running one holds the restart), and touch `~/.local/state/ep0ch/agent-restart.hold` before a merge or deploy (remove it
after) so the restart can't cut one. The new session reads the log, checks its `env ok` line, reorients and re-arms its
watchers. Its session id may change: say the new one to Evan.

A Claude Code update is the same restart: `scripts/agent-restart --all --if-update --bg` restarts each background
session running an older version than the installed `claude`, one at a time, each at a safe moment (between turns, its
builders done), and leaves current ones alone. Evan fires it and forgets it; so can you after `claude update`.
`ep0ch agent ls [--machine <ssh-name>]` shows each session's version beside the installed one (background and interactive
ones, `behind` marked), and `ep0ch agent restart <name | short id | --all> [--if-update] [--fresh-daemon] [--check-env VAR]
[--machine <ssh-name>]` is the person-facing form of the script (detached, from a laptop too, a name that matches nothing
is refused at once). An interactive session (a `claude --continue` in a door terminal tile) isn't the daemon's: the
command refuses it and says to `/exit`, then `claude --continue` in its tile; restarting a tile's program from the door is
a follow-up.

## Infrastructure

Before setting up or changing anything about machines, services, domains, tunnels, DNS, TLS, backups or public
access, read the Infrastructure hub in pie (`ep0ch show --ws pie 50fe932d-4314-4c1b-88c9-13e79a41ef83`). More is
running than anyone remembers; reuse it. Update the hub in the same step as the change. Keys live in
`~/.config/secrets/<group>.env`, used through `with-secrets <group> -- <cmd>`; never print them.
