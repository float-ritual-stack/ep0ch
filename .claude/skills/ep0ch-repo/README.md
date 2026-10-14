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
| `gh pr merge … -d` / `--delete-branch` | `gh pr merge <n> --squash` |
| `bun test --parallel` on float-2 | `scripts/agent-env <name> --test -- timeout 900 bun test <files>`; `scripts/box-test` |
| `gh pr merge` into main when the PR sets `PROTOCOL` to anything but main's or main's plus one | the number to use, and the rebase |

- The command is read the way a shell splits it (`hooks/shell.ts`): `;`, `&&` and pipes split it, wrappers such as
  `timeout`, `env`, `sudo`, `scripts/agent-env … --` and `bash -c '…'` are looked through, and quoted text and heredoc
  bodies are ignored. A commit message that mentions `pkill` is not a `pkill`.
- The PROTOCOL check asks `gh` for the PR's head and reads `packages/outline-core/src/protocol.ts` at that commit and
  at main. A slice merging into its `wave/…` branch is let through: it takes its number when the wave merges. When
  `gh` can't answer within 10s, the merge goes on.

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

## Develop

```sh
claude plugin validate .claude/skills/ep0ch-repo
claude plugin test .claude/skills/ep0ch-repo     # under scripts/agent-env <name> --test -- on float-2
```

An interactive session in the repository reloads the mod when its files change. `claude -p` can't show the sweep: a
headless run ends with its turn, before the agent could start.
