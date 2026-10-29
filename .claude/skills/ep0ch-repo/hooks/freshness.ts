/**
 * The freshness sweep: after a few deploys or merges (or turns that wrote to the outline), a background agent checks
 * what `.claude/freshness.md` lists as stale here and reports to the main thread, which makes the updates. The agent
 * only reads: the engine gives it read tools alone, and its Bash commands pass the read-only rule here. Pure: what
 * counts, when to sweep, the brief and the read-only rule.
 */

import { mergesIn } from './guards'
import { baseName, simpleCommands } from './shell'

/** Deploys and merges between sweeps. */
export const SWEEP_AFTER_CHANGES = 3
/** Turns that wrote to the outline between sweeps (when fewer deploys and merges came). */
export const SWEEP_AFTER_TURNS = 10

/** Who sweeps: the deployer's sessions (the `.ep0ch` agent, or EP0CH_AGENT), unless EP0CH_FRESHNESS says otherwise. */
export const SWEEPER = 'loki'

/** `ep0ch install --apply` in a Bash command: a deploy. */
export function isDeploy(command: string): boolean {
  return simpleCommands(command).some(w => baseName(w[0] ?? '') === 'ep0ch' && w[1] === 'install' && w.includes('--apply'))
}

export function isMerge(command: string): boolean {
  return mergesIn(command).length > 0
}

/** An outline write by any of the outline tools (the mod's, the MCP gateway's). */
export function isOutlineWrite(tool: string): boolean {
  return /^mcp__.+__(outline_(edit|patch|create|new|set_property|comment|reply|resolve_thread|assign_id|archive|write_status)|work_(create|set|stage|deliver|body|complete)|note_section)$/.test(tool)
}

export type Counts = { changes: number; turns: number }

export function dueOf(c: Counts): boolean {
  return c.changes >= SWEEP_AFTER_CHANGES || c.turns >= SWEEP_AFTER_TURNS
}

/**
 * Whether this session sweeps: EP0CH_FRESHNESS `on` or `off` decides outright; else the session's agent name (the
 * nearest `.ep0ch`'s `agent`, or EP0CH_AGENT) is the sweeper.
 */
export function sweepsFor(setting: string | undefined, agent: string | null): boolean {
  const s = setting?.trim().toLowerCase()
  if (s === 'on' || s === '1' || s === 'true') return true
  if (s === 'off' || s === '0' || s === 'false') return false
  return agent === SWEEPER
}

/** `agent = "<name>"` in a `.ep0ch`, or null. */
export function agentOfEp0ch(text: string): string | null {
  const m = /^\s*agent\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/m.exec(text)
  return (m?.[1] ?? m?.[2])?.trim() || null
}

/** The sweep's task: the stale list from `.claude/freshness.md`, why it runs now, and how to answer. */
export function sweepBrief(freshness: string, why: string): string {
  return [
    'Freshness sweep. ' + why,
    '',
    'Check each item in the list below against what is true now (the outline through ep0ch show/find or the outline read tools, gh, git, systemctl --user). ' +
      'Change nothing: you have read tools alone, and a Bash command that writes is refused. Read only what you need; keep it quick.',
    '',
    'Answer with findings only, one line each: what is stale, the evidence (a ((block id)), PIE-n, #PR or file path), and the exact fix the main thread should make. ' +
      'Skip what is fine. If nothing is stale, answer "Nothing stale." Your answer is handed to the main thread, which makes the updates.',
    '',
    '--- .claude/freshness.md ---',
    freshness.trim(),
  ].join('\n')
}

/** What the main thread reads when the sweep answers. */
export function reportOf(answer: string): string {
  return `Freshness sweep (a read-only agent the ep0ch-repo mod started) found:\n\n${answer.trim() || 'Nothing stale.'}\n\n` +
    'Make the updates that hold up, attributed as yourself; the sweep changed nothing.'
}

/**
 * What the sweep agent may call: the engine refuses anything else. Bash is on the list, and each Bash command goes
 * through scripts/read-only-bash.ts (a PreToolUse hook of the agent's own), which refuses one that writes.
 */
export const SWEEP_TOOLS: readonly string[] = [
  'Read', 'Grep', 'Glob', 'Bash', 'ToolSearch',
  ...['outline_read', 'outline_find', 'outline_changes'].map(t => `mcp__ep0ch__${t}`),
]

/** The sweep agent's system prompt; the spawn's prompt is the brief. */
export const SWEEP_SYSTEM =
  "You are ep0ch's freshness sweep, started by the ep0ch-repo mod in the deployer's session. You only read: the engine " +
  'gives you read tools alone, and a Bash command that writes is refused. Check what the brief lists, quickly, and answer ' +
  'with findings only. Your answer is handed to the main thread, which makes the updates.'

/** The words after a program's name that aren't options. */
const operands = (w: readonly string[]) => w.slice(1).filter(a => !a.startsWith('-'))
const noneOf = (w: readonly string[], refused: RegExp) => !w.slice(1).some(a => refused.test(a))

/**
 * Bash programs the sweep may run, each with the check its arguments must pass. Deny by default: a program that can
 * write a file or run another command (sed's `w` and `e`, sort's `-o`, rg's `--pre`, awk, xargs) isn't here.
 */
const READ_PROGRAMS: Record<string, (w: readonly string[]) => boolean> = {
  // cd only moves where the next command reads (`cd ~/projects/ep0ch && git rev-parse HEAD` over ssh).
  cd: () => true, cat: () => true, head: () => true,
  // A follow never ends: the sweep would hang on it.
  tail: w => noneOf(w, /^(-f|-F|--follow)/), wc: () => true, ls: () => true, grep: () => true,
  stat: () => true, date: () => true, pwd: () => true, echo: () => true, cut: () => true, tr: () => true,
  hostname: () => true, uptime: () => true, df: () => true, free: () => true, ps: () => true, pstree: () => true,
  which: () => true, basename: () => true, dirname: () => true, realpath: () => true,
  jq: w => noneOf(w, /^--(rawfile|slurpfile)$/),
  rg: w => noneOf(w, /^--pre/),
  sort: w => noneOf(w, /^(-o|--output)/),
  find: w => noneOf(w, /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/),
  git: w => {
    const sub = w[1] ?? ''
    if (!noneOf(w, /^--output/)) return false
    if (['log', 'show', 'diff', 'status', 'rev-parse', 'ls-files', 'blame', 'merge-base', 'describe', 'shortlog', 'cat-file'].includes(sub)) return true
    // git branch lists only: no branch name, no flag that changes one.
    return sub === 'branch' && operands(w).length === 1 && w.slice(2).every(a => ['-a', '-r', '-v', '-vv', '--list', '--all', '--remotes', '--merged', '--no-merged', '--show-current'].includes(a))
  },
  gh: w => {
    if ((w[1] === 'pr' && ['list', 'view', 'checks', 'diff', 'status'].includes(w[2] ?? '')) || (w[1] === 'run' && ['list', 'view'].includes(w[2] ?? ''))) return true
    // gh api reads only with no fields (a field makes it a POST) and no method of its own.
    return w[1] === 'api' && noneOf(w, /^(-[fFX]|--(field|raw-field|input|method))/)
  },
  ep0ch: w => ['show', 'find', 'where', 'status', 'help'].includes(w[1] ?? '') || (w[1] === 'outline' && w[2] === 'list') || (w[1] === 'echo' && w[2] === 'status'),
  // systemctl --user <read verb> …: the verb is its first operand, and none means list-units (`systemctl --user
  // --failed`, the health check loki's checklist runs).
  systemctl: w => w.includes('--user') && ['list-units', 'status', 'is-active', 'is-enabled', 'is-failed', 'list-timers', 'show', 'cat'].includes(operands(w)[0] ?? 'list-units'),
  journalctl: w => noneOf(w, /^(-f|--follow|--(rotate|vacuum|flush|sync|relinquish|setup-keys|update-catalog))/),
  tailscale: w => w[1] === 'status',
  // ssh <machine> '<command>', no options (an option can run a command here): as read-only as the command it runs there.
  ssh: w => w.length >= 3 && !w[1]!.startsWith('-') && bashReadRefusal(w.slice(2).join(' ')) === null,
}

/** Why the sweep may not run `command`, or null when it only reads. */
export function bashReadRefusal(command: string): string | null {
  // A substitution runs a command the checks below can't see whole; process substitution too.
  if (/\$\(|`|<\(|>\(/.test(command)) return 'a command substitution runs a command of its own'
  // A redirection writes a file; one to /dev/null, or of one stream to another, doesn't. A `>` in quotes is an
  // argument (`--search "merged:>=…"`): no shell runs it, as no wrapper is allowed (ssh's command is checked on its own).
  if (command.replace(/'[^']*'|"[^"]*"/g, '').replace(/\d*>>?\s*\/dev\/null|\d*>&\d/g, '').includes('>')) return 'a redirection writes a file'
  // Wrappers are not looked through: `env`, `xargs`, `bash -c` aren't on the list.
  for (const w of simpleCommands(command, { unwrap: false })) {
    const name = baseName(w[0] ?? '')
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0] ?? '')) return 'a variable set before a command changes what it runs'
    const check = Object.hasOwn(READ_PROGRAMS, name) ? READ_PROGRAMS[name] : undefined
    if (!check) return `\`${name}\` isn't one of the commands the sweep may run`
    if (!check(w)) return `\`${w.slice(0, 3).join(' ')}\` changes something`
  }
  return null
}
