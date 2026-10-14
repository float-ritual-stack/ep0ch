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
2. `ep0ch install` prints the plan; read it (outlines to migrate, what restarts). Then `ep0ch install --apply`: it
   backs up every outline, fast-forwards `~/projects/ep0ch`, links `ep0ch`, runs a schema step on every outline
   behind, and restarts the outline host when its code changed. It refuses before updating if an outline can't take
   the step; follow what it prints.
3. `ep0ch doctor`: the host, the CLI and the doors on one `PROTOCOL`, nothing behind.
4. Restart what install doesn't:
   - the publishers, after any deploy that touched the outliner, outline-core or the web pages:
     `systemctl --user restart outliner-publish.service outliner-publish-gurgle.service`;
   - the MCP gateway when `PROTOCOL` or the MCP server changed: `systemctl --user restart ep0ch-mcp.service`;
   - doors and agents that should run the new code (`ep0ch session upgrade`, `ep0ch act agent.restart`); say which.
5. Check it took: the tailnet page answers (`curl -s https://float-2.tail2a183e.ts.net/pub/ | head`), and
   `systemctl --user status` for what you restarted.
6. The laptop (float-hub) updates when it is reachable or when Evan runs `ep0ch install --apply` there. Inbound ssh to
   it is often off by work policy: that is normal, never work around it. A step only Evan can do goes on the build
   log's **Needs you** with the exact command.
7. Write it up: a line in today's build log, patch notes on the requests it answers, and the release notes (below).

Never deploy over someone else's half-finished migration, and never kill the outline host or a publisher you didn't
start except through its service.

## PROTOCOL numbers

Never hand out numbers in advance: messages reach busy agents late, and pre-assigned numbers clashed three times.
The rule every builder follows: at its final rebase, right before merging, `PROTOCOL` = main's value plus one; if
another bump lands first, rebase and take the next. When several PRs bumping it are ready at once, merge them one at
a time and tell the next one main's new value. A PR that bumps it says what each machine needs.

## The check-in (every half hour)

Run the steps in order and act on what you find; a step with nothing new says nothing. Put what changed in the
build log, not chat.

1. **Margins:** Evan's marks and comments since the last check-in (the saved view `[[my-marks]]`, or
   `type=annotation AND annotation-source=user`). Answer each in its thread, or do what it asks.
2. **Requests:** new request copies in pie (from the gurgle's `#pie-request` lane and float-hub, through EchoNet),
   and any older one without a reply. Each gets prior art checked, a ticket or an answer, and a reply on the copy.
3. **Agents:** each running builder's last word; a stalled one gets a nudge, a finished one its deploy (builders merge
   their own PRs; when several bump `PROTOCOL`, you say which merges next).
4. **Laptop:** is float-hub reachable and on main's `PROTOCOL` (`ep0ch doctor`)? Unreachable is a status, not a fault.
5. **float-2 health:** `uptime`, `free -h`, `df -h ~ ~/wt`, `systemctl --user --failed`, the outline host and
   publishers active, backups recent (`ep0ch doctor --backups`).
6. **main's CI:** `gh run list --branch main --limit 5`. A red run gets at most **one** rerun
   (`gh run rerun <id> --failed`). A pass doesn't clear the first failure: note it, and a failure seen twice gets a
   ticket. A second red is a bug: ticket it and give it to an ep0ch-builder with the diagnosing-bugs skill, never
   another rerun.
7. **The board:** tickets in `doing` with no agent behind them, merged work still in `review`, `validate` items you
   can close with proof.

## The build log

One note per day in pie, `[type::build-log] [page::build-log-YYYY-MM-DD] [welcome::true]`, first in the Welcome
view's hand order (`ep0ch view order`), under the Build logs note. Sections, in order: **Needs you** (checkboxes,
at most about three, each with its reason and exact command), **In flight**, **Landed** (newest first, grouped by
area; one line each: the time, what Evan will notice, then `(PIE-n, #PR)`). Every deploy and every agent report adds a
line. A new day starts a new note; yesterday's loses `welcome`. Chat replies stay to a line or two plus the link
(`https://float-2.tail2a183e.ts.net/pub/p/<page|PIE-n|id>`).

## Requests: tickets, patch notes, release notes

- **Triage** a request copy: find prior art (`ep0ch find --ws pie <words>`), then ticket it (`work_create`) or answer
  it. Link the copy to the ticket.
- **When the fix ships,** in the same step as the deploy, reply on the request's copy in pie with a whole-note
  comment (`outline_comment`, `whole: true`, `properties: {kind: "patch-note"}`): what changed, the PR, deployed or not.
  The toss carries it back to the original as netmail. The original's status chips are its outline's to set, not yours.
- **Release notes:** each deploy gets one `[type::release-notes]` note in pie (the echo area `ep0ch.releases`;
  gurgle subscribes). Sections: answers to requests, new ways to work, decided-not-built.

## The workboard

- Before launching an agent its work has a ticket in `doing` (`work_create` or `work_set`); the ticket id is in the brief.
- Agents run `work_deliver` on each PR they open and merge. Check they did.
- **Close with proof:** `work_complete` (`ref: PIE-n`, `allMerged: true`, `proof:` a first-line title, then what was
  checked and how). Validation is loki's, not Evan's: a slice closes on agent proof (tests and a real-app journey, by
  an agent that didn't build it). Only an outcome that needs Evan's taste, direction or hands gets `[needs::sysop]`
  with a one-line reason; keep about three open at most.

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
