/**
 * Whether a shell command runs a whole test suite straight on the shared test machines (PIE-998), shared by the Claude mod
 * (`hooks/guards.ts`) and the Codex hook (`.codex/hooks/box-test-only.ts`) so the two tools
 * never disagree. Pure.
 */
import { baseName, simpleCommands } from './shell'

export type GuardContext = { hostname: string }

/** The machine where whole suites never run (AGENTS.md "Tests on a shared machine"). */
export const SHARED_MACHINE = 'float-2'
/** The test machine: whole suites run there through scripts/box-test, which caps and cleans them (PIE-998). */
export const BOX_MACHINE = 'float-box'

/** bun's own options that take the next word (`bun --cwd packages/door test`, `bun run --cwd … test`). */
const BUN_VALUED = new Set(['--cwd', '--filter', '--config', '-c', '--env-file', '--elide-lines', '--shell', '--install'])
/** `bun test`'s options that take the next word as a value (not a file). Flags like --bail take theirs with `=`. */
const TEST_VALUED = new Set(['-t', '--test-name-pattern', '--timeout', '--rerun-each', '--preload', '--coverage-reporter', '--coverage-dir', '--reporter', '--reporter-outfile', '--max-concurrency', '--shard'])

/** The index of the first word from `from` that is not an option (or the value of a valued one), or -1. */
function firstWord(words: readonly string[], from: number, valued: ReadonlySet<string>): number {
  for (let i = from; i < words.length; i++) {
    const w = words[i]!
    if (valued.has(w)) { i++; continue }
    if (!w.startsWith('-')) return i
  }
  return -1
}

/**
 * What a `bun test …` or `bun run test…` command is, or null for any other command: its arguments after the
 * subcommand (a `run`'s script is the first of them) and the files it names. The one place that reads bun's command line.
 */
export function bunTest(words: readonly string[]): { args: string[]; files: string[]; script: boolean } | null {
  if (baseName(words[0] ?? '') !== 'bun') return null
  const sub = firstWord(words, 1, BUN_VALUED)
  if (sub < 0) return null
  if (words[sub] === 'run' || words[sub] === 'x') {
    const at = firstWord(words, sub + 1, BUN_VALUED)
    const script = at < 0 ? undefined : words[at]
    return script === 'test' || script?.startsWith('test:') ? { args: words.slice(at + 1) as string[], files: [], script: true } : null
  }
  if (words[sub] !== 'test') return null
  const args = words.slice(sub + 1) as string[]
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    if (TEST_VALUED.has(w)) { i++; continue }
    if (w.startsWith('-')) continue
    // A named file (or a name that selects one) is a focused run; a folder is not.
    if (/\.(?:[cm]?[jt]sx?)$/.test(w) || /\.test\b|\.spec\b/.test(w)) files.push(w)
  }
  return { args, files, script: false }
}

/**
 * Why a whole-suite run straight on float-box or float-2 is refused, or null. A run under `scripts/agent-env` (the
 * focused, capped way) is not a `bun` command to this rule, so it passes, and `scripts/box-test` is not bun at all.
 */
export function wholeSuiteRefusal(command: string, ctx: GuardContext): string | null {
  if (ctx.hostname !== SHARED_MACHINE && ctx.hostname !== BOX_MACHINE) return null
  for (const words of simpleCommands(command, { keepAgentEnv: true })) {
    const test = bunTest(words)
    if (!test || test.files.length > 0) continue
    return `A whole-suite \`${words.join(' ')}\` is refused on ${ctx.hostname}: suites run only through scripts/box-test, which limits how many run at once (EP0CH_BOX_SLOTS), allows one per worktree, and kills everything a run started (a hand-started suite froze float-box at load 22 and left hundreds of orphans: PIE-998). ` +
      'Run `scripts/box-test <package>` (`scripts/box-test all --each` for a series) from your worktree; for a few test files, `scripts/agent-env <your name> --test -- timeout 900 bun test <files>`.'
  }
  return null
}

/**
 * A Codex PreToolUse hook's answer to its input (the event JSON): the JSON to print to refuse the command, or null to
 * let it run. Anything unreadable, or not a Bash command, runs.
 */
export function codexPreToolUse(input: string, ctx: GuardContext): string | null {
  try {
    const command = (JSON.parse(input) as { tool_input?: { command?: unknown } }).tool_input?.command
    const why = typeof command === 'string' ? wholeSuiteRefusal(command, ctx) : null
    return why ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }) : null
  } catch {
    return null
  }
}
