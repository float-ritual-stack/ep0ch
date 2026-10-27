# ep0ch-repo: the repository's own Claude mod (PIE-842)

A Claude Code mod (a plugin of function hooks) for sessions in this repository. It lives in the project's
`.claude/skills/`, so Claude Code loads it, as `ep0ch-repo@skills-dir`, for any session started in a checkout or
worktree of ep0ch and nowhere else. There is nothing to install or enable. It is not packages/claude-mod: that one
serves every folder bound to an outline, and this one holds rules about this repository.

## Guardrails

A Bash call that breaks one of AGENTS.md's hard rules is refused. The refusal gives the reason and the command to run
instead (`hooks/guards.ts`):

| Refused | Run instead |
|---|---|
| `pkill`, `killall` (any pattern) | check `pstree -p <pid>`, then `kill <pid>`; `scripts/agent-env <name> --clean` |
| `git stash` (`list` and `show` still run) | a `wip:` commit on your branch |
| `gh pr merge … -d` / `--delete-branch` | `gh pr merge <n> --merge` |
| `bun test --parallel` on float-2 | `scripts/agent-env <name> --test -- timeout 900 bun test <files>`; `scripts/box-test` |
| a whole-suite `bun test` / `bun run test…` (no test file named) on float-box or float-2, outside `scripts/agent-env` | `scripts/box-test <package>`; a few files: `scripts/agent-env <name> --test -- timeout 900 bun test <files>` |
| `gh pr merge` into main when the PR changes `PROTOCOL` to anything but main's plus one | the number to use, and the rebase |

- The command is read the way a shell splits it (`hooks/shell.ts`): `;`, `&&` and pipes split it, wrappers such as
  `timeout`, `env`, `sudo`, `scripts/agent-env … --` and `bash -c '…'` are looked through, and quoted text and heredoc
  bodies are ignored. A commit message that mentions `pkill` is not a `pkill`.
- The PROTOCOL check asks `gh` for each merged PR's head and reads `packages/outline-core/src/protocol.ts` at that
  commit, at main, and where the branch left main. Only a branch that changed it is held to main's plus one; a branch
  merely behind a bump on main merges. A GRAMMAR-only bump is accepted, even though it edits the same file. A slice merging into its `wave/…` branch is let through: it takes its number
  when the wave merges. When `gh` can't answer within 10s, the merge goes on.

## Every merge on the record

After a `gh pr merge` that ran (from any loop), the mod asks `gh` whether each PR it names has merged, and for each that
has runs the outliner's `work deliver --repo R --pr N` with no item, as `EP0CH_AGENT` (else `merge-step`). It runs the
installed checkout's CLI (where `ep0ch` resolves) from that folder: it speaks the deployed host's PROTOCOL, and its
`.ep0ch` names the deployer's outline, where a worktree has neither (`hooks/landed.ts`, PIE-1352). That syncs every delivery
recording the PR and writes the PR's one merge row, ticket or not. The Bash result carries one line per PR: the row,
or why it isn't on the record and the command to run. A PR still waiting (auto-merge) is left to the merge step.

## Scratch cleanup never stops for a prompt

Claude Code's dangerous-command check stops some `rm -rf` shapes (a glob over the working folder, a path ending in
`..`) even under bypass permissions, and a builder's prompt surfaces in the deployer's session and waits there.
Two parts (`hooks/scratch.ts`, `scripts/scratch-clean`):

- **Agents don't write `rm -rf`:** they run `scripts/scratch-clean <dir>…`, which removes only folders under
  `/tmp/claude-<uid>/`, `/tmp/ep0ch-agent-<uid>/` and `~/.agent-env/` (and `~/wt/<name>` worktrees through `git worktree
  remove`), and refuses anything else with why. A script's own `rm` is not a command the check sees.
- **The mod answers "allow"** to a permission request for a Bash command that is nothing but `rm -r` of plain paths that
  all resolve (`realpath -m`: links followed, `..` taken) under those scratch roots. A variable, glob, other command,
  root folder, home or repository path is left to the normal prompt.

## The freshness sweep

- **Who:** a session whose nearest `.ep0ch` says `agent = "loki"` (the live checkout's does), or that has
  `EP0CH_AGENT=loki`. Builders' worktrees have no `.ep0ch`, so they never sweep. `EP0CH_FRESHNESS=on` or `off`
  overrides this.
- **When:** after 3 deploys or merges (`ep0ch install --apply`, `gh pr merge` that ran), or after 10 turns that wrote
  to the outline, counted in the main loop since the last sweep (`hooks/freshness.ts`).
- **What:** an agent type of this mod's own, `ep0ch-repo:freshness-sweep`. It is never offered to the model, runs on
  Sonnet in the background, and gets `.claude/freshness.md` as its brief.
- **Read-only by the engine:**
  - its tools are Read, Grep, Glob, ToolSearch, Bash and the outline read tools;
  - each Bash command goes through `scripts/read-only-bash.ts`, a PreToolUse hook on the agent, which refuses anything
    not on a list of read commands, and any redirection to a file.
  - It is not a fork of the session. The engine runs a plugin's fork under the plugin's own origin, so the fork's calls
    skip the plugin's hooks, and a live run showed a fork writing a file the mod meant to refuse.
- **The answer:** the agent's answer comes back as a prompt from the ep0ch-repo plugin. The main thread checks the
  findings and makes the updates as itself. A toast says when a sweep starts, or why it couldn't.

## Package rules for commands

Claude Code loads a path-scoped rule (`.claude/rules/*.md`) when an agent reads a file its `paths:` match. It never
loads one when the agent runs a command, so an agent that runs a test door from Bash without opening a door file would
miss `door.md`. The mod closes that gap (`hooks/rules.ts`):
- **What it looks at:** the paths a Bash command names, and the folder the shell is in. Relative paths are resolved
  from that folder. An absolute path to another checkout counts by its tail (`~/projects/ep0ch/scripts/agent-env` →
  `scripts/agent-env`). Wrappers count too (`scripts/agent-env … --`, `bash -c '…'`).
- **What decides:** each rule's own `paths:`. A new rule file is picked up with no change here, and a narrow rule
  (`outlines-by-name.md`) fires only for its own files.
- **How it arrives:** the first command that touches a rule's files carries the rule's text after its result, as
  context the agent reads. This happens once per loop: the main thread and each subagent get it once each, and again
  after a compaction or `/clear`. A refused command carries nothing.

## Develop

```sh
claude plugin validate .claude/skills/ep0ch-repo
claude plugin test .claude/skills/ep0ch-repo     # under scripts/agent-env <name> --test -- on float-2
```

These tests aren't in a workspace package, so neither the root `bun run test` nor CI runs them: run them when you
change the mod. An interactive session in the repository reloads the mod when its files change. `claude -p` can't show the sweep: a
headless run ends with its turn, before the agent could start.
