/**
 * The repository's hard rules for a Bash call, each a refusal with the reason and the command to run instead
 * (AGENTS.md: "Never kill what you didn't start", "Merge with gh pr merge <n> --merge", "Schema and protocol";
 * the builder's "Never git stash"). Pure: register.ts asks this, and the PROTOCOL lookup, per call.
 */

import { type GuardContext, SHARED_MACHINE, bunTest, wholeSuiteRefusal } from './whole-suite'
import { baseName, simpleCommands } from './shell'
import { readsOnly } from './freshness'

export { wholeSuiteRefusal }


export type { GuardContext }

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

/** Where a git command's subcommand is, past git's own options (`git -C <dir> -c k=v stash`). */
export function gitSubcommandAt(words: readonly string[]): number {
  let i = 1
  while (i < words.length && words[i]!.startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(words[i]!) ? 2 : 1
  return i
}

/** Why one simple command is refused here, or null. */
function refusalOf(words: readonly string[], ctx: GuardContext): string | null {
  const name = baseName(words[0] ?? '')
  if (name === 'pkill' || name === 'killall') {
    return `${name} is refused in this repository: a pattern matches other agents' runs (one \`pkill -f "box-test door"\` killed several agents' suites). ` +
      'Stop only what you started, by its pid: check `pstree -p <pid>`, then `kill <pid>`; for a test door or run under agent-env, `scripts/agent-env <name> --clean`.'
  }
  if (name === 'git') {
    const i = gitSubcommandAt(words)
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
    const test = bunTest(words)
    if (test && test.args.some(w => w === '--parallel' || w.startsWith('--parallel='))) {
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
  return wholeSuiteRefusal(command, ctx) ?? budgetRefusal(command)
}

/** The test-time budget (PIE-1422): scripts/test-budget.json, which only Evan raises. */
export const BUDGET_FILE = 'scripts/test-budget.json'
export const BUDGET_REFUSAL = `${BUDGET_FILE} is the test-time budget, and only Evan raises it (PIE-1422): this repository's mod refuses ` +
  "an agent's change to it, in every Claude session here, the way it refuses a PROTOCOL merge that isn't main's plus one. " +
  'If the nightly is over budget, find the files that grew (its request lists them) and make them fast again. ' +
  "Evan raises it himself, in his editor or with `! bun scripts/test-budget.ts propose --log <the nightly's log> --write`; " +
  'a test that needs a budget writes a made-up one of its own and passes `--budget <file>`.'

/** Programs that run code given to them (-c, -e, a heredoc on stdin): a nudge, not a sandbox (PIE-1422). */
const INTERPRETERS = new Set(['python', 'python3', 'node', 'bun', 'deno', 'perl', 'ruby', 'php'])
const namesBudget = (word: string) => /(^|[/>])test-budget\.json$/.test(word)
const budgetScript = (w: readonly string[]) => baseName(w[0] ?? '') === 'bun' && /(^|\/)test-budget\.ts$/.test(w[1] ?? '')
/** Read-only uses of the budget beyond the sweep's list: git staging it, and the comparison reading it. */
const budgetReader = (w: readonly string[]) =>
  (baseName(w[0] ?? '') === 'git' && ['add', 'commit', 'diff', 'log', 'show', 'status', 'blame'].includes(w[gitSubcommandAt(w)] ?? '')) ||
  (budgetScript(w) && ['compare', 'times', 'propose'].includes(w[2] ?? '') && !w.includes('--write')) ||
  // A copy from it (to a scratch folder) leaves it as it was; onto it is a change.
  (['cp', 'install'].includes(baseName(w[0] ?? '')) && !namesBudget(w.at(-1) ?? ''))

/** Why a Bash command changes the test-time budget (a redirection onto it, or a command that isn't a read), or null. */
export function budgetRefusal(command: string): string | null {
  const named = command.includes('test-budget.json')
  if (!named && !command.includes('test-budget.ts')) return null
  for (const w of simpleCommands(command)) {
    // The raise itself writes the file without naming it.
    if (budgetScript(w) && w[2] === 'propose' && w.includes('--write')) return BUDGET_REFUSAL
    // A script whose code names it (`python3 -c "…"`, a heredoc fed to node): its words don't show the path, the command does.
    if (named && INTERPRETERS.has(baseName(w[0] ?? '')) && !budgetScript(w)) return BUDGET_REFUSAL

    if (!w.some(namesBudget)) continue
    const redirected = w.some((word, i) => (/^\d*>>?/.test(word) && namesBudget(word)) || (/^\d*>>?$/.test(w[i - 1] ?? '') && namesBudget(word)))
    if (redirected) return BUDGET_REFUSAL
    const words = w.filter((word, i) => !/^\d*[<>]/.test(word) && !/^\d*[<>]+$/.test(w[i - 1] ?? ''))
    if (!readsOnly(words) && !budgetReader(words)) return BUDGET_REFUSAL
  }
  return null
}

/** Why an Edit or Write of `path` is refused: it is the test-time budget (in any checkout of this repository). */
export function budgetEditRefusal(path: unknown): string | null {
  return typeof path === 'string' && (path === BUDGET_FILE || path.endsWith(`/${BUDGET_FILE}`)) ? BUDGET_REFUSAL : null
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
 * changed it (including a GRAMMAR-only change) is not a bump. Null when the branch leaves PROTOCOL alone, or bumps it right.
 */
export function protocolRefusal(main: number, branch: number, base: number, pr: string | null): string | null {
  if (branch === base || branch === main + 1) return null
  const merge = pr ? MERGE.replace('<n>', pr) : MERGE
  return `This PR sets PROTOCOL to ${branch}, and main is at ${main}: a bump merges at main's plus one, so use ${main + 1}. ` +
    `Rebase on origin/main, set \`export const PROTOCOL = ${main + 1};\` in packages/outline-core/src/protocol.ts, push, then \`${merge}\`. ` +
    'When several bumps are queued, ask the deployer (loki) for the number first.'
}
