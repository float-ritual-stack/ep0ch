/**
 * The repository's hard rules for a Bash call, each a refusal with the reason and the command to run instead
 * (AGENTS.md: "Never kill what you didn't start", "Merge with gh pr merge <n> --merge", "Schema and protocol";
 * the builder's "Never git stash"). Pure: register.ts asks this, and the PROTOCOL lookup, per call.
 */

import { baseName, simpleCommands } from './shell'

/** The machine where whole suites never run (AGENTS.md "Tests on a shared machine"). */
export const SHARED_MACHINE = 'float-2'
/** The test machine: whole suites run there through scripts/box-test, which caps and cleans them (PIE-998). */
export const BOX_MACHINE = 'float-box'

export type GuardContext = { hostname: string }

const MERGE = 'gh pr merge <n> --merge'

/** `gh pr merge …`'s words after `merge`, or null when this isn't one. */
export function prMergeArgs(words: readonly string[]): string[] | null {
  return baseName(words[0] ?? '') === 'gh' && words[1] === 'pr' && words[2] === 'merge' ? words.slice(3) : null
}

/** gh pr merge's options that take a value as the next word. */
const MERGE_VALUED = new Set(['-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit', '-R', '--repo'])

/** gh pr merge's flags, without the values the valued ones take (a body of `-d` is not a flag). */
function flagsOf(args: readonly string[]): string[] {
  const flags: string[] = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    if (MERGE_VALUED.has(w)) { i++; continue }
    if (w.startsWith('-')) flags.push(w)
  }
  return flags
}

/** Short-flag clusters (`-sd`) hold each letter; a long flag is itself. */
function hasFlag(flags: readonly string[], short: string, long: string): boolean {
  return flags.some(w => w === long || w.startsWith(`${long}=`) || (/^-[A-Za-z]+$/.test(w) && w.slice(1).includes(short)))
}

/** The PR a `gh pr merge` names (a number, URL or branch), or null: the current branch's. */
export function prNamed(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    if (MERGE_VALUED.has(w)) { i++; continue }
    if (w.startsWith('-')) continue
    return w
  }
  return null
}

/** The `--repo` a `gh pr merge` names, or null. */
export function repoNamed(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    if (w === '-R' || w === '--repo') return args[i + 1] ?? null
    if (w.startsWith('--repo=')) return w.slice('--repo='.length)
  }
  return null
}

/** `bun test`'s options that take the next word as a value (it is not a file). */
const TEST_VALUED = new Set(['-t', '--test-name-pattern', '--timeout', '--rerun-each', '--preload', '--bail', '--coverage-reporter', '--coverage-dir', '--reporter', '--reporter-outfile', '--max-concurrency', '--shard', '--only-failures', '-r'])

/** Whether these words run a whole suite: `bun test` naming no test file, or a package's `bun run test…` script. */
export function runsWholeSuite(words: readonly string[]): boolean {
  if (baseName(words[0] ?? '') !== 'bun') return false
  if (words[1] === 'run' || words[1] === 'x') {
    const script = words.slice(2).find(w => !w.startsWith('-'))
    return script === 'test' || (script?.startsWith('test:') ?? false)
  }
  if (words[1] !== 'test') return false
  for (let i = 2; i < words.length; i++) {
    const w = words[i]!
    if (TEST_VALUED.has(w)) { i++; continue }
    if (w.startsWith('-')) continue
    // A named file (or a name that selects one) is a focused run; a folder, or nothing, is the suite.
    if (/\.(?:[cm]?[jt]sx?)$/.test(w) || /\.test\b|\.spec\b/.test(w)) return false
  }
  return true
}

/**
 * Why a whole-suite `bun test` straight on float-box or float-2 is refused, or null. A run under `scripts/agent-env`
 * (the focused, capped way) and `scripts/box-test` itself are not `bun` commands to this rule, so they pass.
 * Pure: the Claude mod asks it per call, and the Codex hook (`.codex/hooks/box-test-only.ts`) asks it too.
 */
export function wholeSuiteRefusal(command: string, ctx: GuardContext): string | null {
  if (ctx.hostname !== SHARED_MACHINE && ctx.hostname !== BOX_MACHINE) return null
  for (const words of simpleCommands(command, { keepAgentEnv: true })) {
    if (!runsWholeSuite(words)) continue
    return `A whole-suite \`${words.join(' ')}\` is refused on ${ctx.hostname}: suites run only through scripts/box-test, which takes at most 2 runs at once, one per worktree, and kills everything a run started (a hand-started suite froze float-box at load 22 and left hundreds of orphans: PIE-998). ` +
      'Run `scripts/box-test <package>` (`scripts/box-test all --each` for a series) from your worktree; for a few test files, `scripts/agent-env <your name> --test -- timeout 900 bun test <files>`.'
  }
  return null
}

/** Why one simple command is refused here, or null. */
function refusalOf(words: readonly string[], ctx: GuardContext): string | null {
  const name = baseName(words[0] ?? '')
  if (name === 'pkill' || name === 'killall') {
    return `${name} is refused in this repository: a pattern matches other agents' runs (one \`pkill -f "box-test door"\` killed several agents' suites). ` +
      'Stop only what you started, by its pid: check `pstree -p <pid>`, then `kill <pid>`; for a test door or run under agent-env, `scripts/agent-env <name> --clean`.'
  }
  if (name === 'git') {
    let i = 1
    while (i < words.length && words[i]!.startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(words[i]!) ? 2 : 1
    if (words[i] === 'stash' && !['list', 'show'].includes(words[i + 1] ?? '')) {
      return 'git stash is refused in this repository: stashes are shared by every worktree of the repo, so one agent pops another\'s. ' +
        'Commit to your branch instead: `git add -A && git commit -m "wip: <what>"` (a merge commit keeps it in the branch history, which is fine).'
    }
    return null
  }
  const merge = prMergeArgs(words)
  if (merge && hasFlag(flagsOf(merge), 'd', '--delete-branch')) {
    const pr = prNamed(merge)
    return 'gh pr merge with -d/--delete-branch is refused: it also deletes the local branch and its worktree, which can be another agent\'s, ' +
      `and GitHub already deletes the remote branch. Run \`${pr ? MERGE.replace('<n>', pr) : MERGE}\`.`
  }
  if (name === 'bun' && ctx.hostname === SHARED_MACHINE) {
    const test = words[1] === 'test' || (words[1] === 'run' && words[2] === 'test')
    if (test && words.some(w => w === '--parallel' || w.startsWith('--parallel='))) {
      return `bun test --parallel is refused on ${SHARED_MACHINE}: several agents testing at once froze it (4 cores). ` +
        'Run a focused test as `scripts/agent-env <your name> --test -- timeout 900 bun test <files>`, and a whole suite on float-box: `scripts/box-test <package>` (`scripts/box-test all --each` for a series).'
    }
  }
  return null
}

/** Why `command` is refused here (the first rule it breaks), or null. */
export function guardOf(command: string, ctx: GuardContext): string | null {
  for (const words of simpleCommands(command)) {
    const why = refusalOf(words, ctx)
    if (why) return why
  }
  return wholeSuiteRefusal(command, ctx)
}

export type Merge = { pr: string | null; repo: string | null }

/** Each `gh pr merge` in `command`: its PR (null: the current branch's) and `--repo`. */
export function mergesIn(command: string): Merge[] {
  return simpleCommands(command).flatMap(words => {
    const merge = prMergeArgs(words)
    return merge ? [{ pr: prNamed(merge), repo: repoNamed(merge) }] : []
  })
}

/** `export const PROTOCOL = N` in outline-core's protocol.ts, or null. */
export function protocolOf(source: string): number | null {
  const m = /^export const PROTOCOL\s*=\s*(\d+)\s*;/m.exec(source)
  return m ? Number(m[1]) : null
}

/**
 * A PR that bumps PROTOCOL merges only at main's plus one (AGENTS.md "Rebase on the way in"): another merge may have
 * taken the number since the branch picked it. `base` is PROTOCOL where the branch left main: a branch that never
 * changed it (only behind main) is not a bump. Null when the branch leaves PROTOCOL alone, or bumps it right.
 */
export function protocolRefusal(main: number, branch: number, base: number, pr: string | null): string | null {
  if (branch === base || branch === main + 1) return null
  const merge = pr ? MERGE.replace('<n>', pr) : MERGE
  return `This PR sets PROTOCOL to ${branch}, and main is at ${main}: a bump merges at main's plus one, so use ${main + 1}. ` +
    `Rebase on origin/main, set \`export const PROTOCOL = ${main + 1};\` in packages/outline-core/src/protocol.ts, push, then \`${merge}\`. ` +
    'When several bumps are queued, ask the deployer (loki) for the number first.'
}
