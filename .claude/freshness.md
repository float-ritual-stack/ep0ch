# What counts as stale in ep0ch

The freshness sweep (the `ep0ch-repo` mod in `.claude/skills/ep0ch-repo`) hands this list to a read-only agent after
every three deploys or merges in the deployer's sessions. The agent checks each item and reports; the main thread
makes the updates. Edit this file like any rule: a line here is a check the next sweep makes.

Where to look: pie through `ep0ch show --ws pie <ref>` and `ep0ch find --ws pie --query "<query>" --json` (or the
outline read tools), GitHub through `gh pr list` and `gh pr view`, the repository through `git log`, the machine
through `systemctl --user`.

- **Build log:** a PR merged today (`gh pr list --state merged --search "merged:>=<today>"`) with no line in today's
  build log (`type=build-log`, the newest).
- **Tickets behind their PRs:** a ticket whose PR merged but is still `doing` or `review`; a `done` ticket with no
  proof child.
- **Requests:** a shipped ticket whose request copy (in pie's "ep0ch requests" subscription) has no patch note reply.
- **Waiting on Evan:** `needs::sysop` on an item that is done or superseded.
- **Idle PRs:** an open PR with no push or comment for an hour and no agent working on it.
- **Infrastructure hub** (pie `50fe932d-4314-4c1b-88c9-13e79a41ef83`): a service, timer, tunnel or Caddy site it
  names that isn't running (`systemctl --user list-units --all`), or one running that it doesn't name.
- **CHANGELOG:** a user-visible PR merged since the last release section with no entry under `[Unreleased]`.
- **Docs and skills:** a README, AGENTS.md, CONTRIBUTING.md, skill or agent definition that names a file that no
  longer exists (`git ls-files` to check the name).
- **Memory:** a memory file (`~/.claude/projects/-home-evan-projects-ep0ch/memory/`) that names a file, flag, command
  or block that no longer exists.
- **The laptop:** when `laptop` answers over ssh, its `PROTOCOL` behind main's. It is often away by design; away is
  not stale.
