import type { EngineInterface, Register } from 'claude-code'

import { guardOf, type Merge, mergesIn, protocolOf, protocolRefusal } from './guards'
import { agentOfEp0ch, type Counts, dueOf, SWEEP_AFTER_CHANGES, SWEEP_AFTER_TURNS, isDeploy, isMerge, isOutlineWrite, reportOf, SWEEP_SYSTEM, SWEEP_TOOLS, sweepBrief, sweepsFor } from './freshness'

const PROTOCOL_PATH = 'packages/outline-core/src/protocol.ts'
/** The sweep's agent type, `ep0ch-repo:<name>`: registered by this mod, offered to no model. */
const SWEEP_AGENT = 'freshness-sweep'
const LOOKUP_MS = 10_000

/** This machine's name, asked once (the --parallel rule holds on the shared machine only). */
let hostname: Promise<string> | undefined
/** Whether this session sweeps, read once. */
let sweeps: Promise<boolean> | undefined
/** Deploys and merges, and turns that wrote to the outline, since the last sweep. */
const counts: Counts = { changes: 0, turns: 0 }
let wroteThisTurn = false
/** The sweep running now (its agent id), and whether one is being started. */
let sweepId: string | null = null
let starting = false

function hostnameOf($: EngineInterface): Promise<string> {
  return (hostname ??= $.process.run(['hostname'], { timeoutMs: 3000 }).then(r => r.stdout.trim(), () => ''))
}

/** Whether this session sweeps: EP0CH_FRESHNESS, else the nearest `.ep0ch`'s agent (or EP0CH_AGENT) is loki. */
function sweepsHere($: EngineInterface): Promise<boolean> {
  return (sweeps ??= (async () => {
    const [setting, envAgent, root] = await Promise.all([$.env.get('EP0CH_FRESHNESS'), $.env.get('EP0CH_AGENT'), $.session.root()])
    let agent: string | null = null
    for (let dir = root; dir; dir = dir.slice(0, dir.lastIndexOf('/'))) {
      const text = await $.fs.read(`${dir}/.ep0ch`).then(t => String(t), () => null)
      if (text !== null) { agent = agentOfEp0ch(text); break }
    }
    return sweepsFor(setting, agent ?? (envAgent?.trim() || null))
  })().catch(() => false))
}

/** Why a merge's PROTOCOL is wrong (see protocolRefusal), or null: right, untouched, not into main, or not known in time. */
async function protocolCheck($: EngineInterface, merge: Merge): Promise<string | null> {
  const cwd = await $.session.cwd()
  const gh = (args: string[]) => $.process.run(['gh', ...args], { cwd, timeoutMs: LOOKUP_MS })
    .then(r => r.exitCode === 0 ? r.stdout : null, () => null)
  const view = await gh(['pr', 'view', ...(merge.pr ? [merge.pr] : []), ...(merge.repo ? ['--repo', merge.repo] : []), '--json', 'headRefOid,baseRefName'])
  if (!view) return null
  const { headRefOid, baseRefName } = JSON.parse(view) as { headRefOid?: string; baseRefName?: string }
  // Only a PR into main: a slice merging into its wave branch takes its number at the wave's merge.
  if (!headRefOid || baseRefName !== 'main') return null
  const repo = merge.repo ?? '{owner}/{repo}'
  const at = (ref: string) => gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${PROTOCOL_PATH}?ref=${ref}`])
  const [branch, main] = await Promise.all([at(headRefOid), at('main')])
  const b = branch === null ? null : protocolOf(branch)
  const m = main === null ? null : protocolOf(main)
  return b === null || m === null ? null : protocolRefusal(m, b, merge.pr)
}

/** The first merge in `command` whose PROTOCOL is wrong, said; null when none is. */
async function protocolChecks($: EngineInterface, command: string): Promise<string | null> {
  for (const merge of mergesIn(command)) {
    const why = await protocolCheck($, merge)
    if (why) return why
  }
  return null
}

/**
 * Starts the sweep when this session sweeps: an agent type of this mod's own, read-only by the engine's rules (its
 * tools are read tools and Bash, each Bash command through scripts/read-only-bash.ts), given the brief from
 * `.claude/freshness.md`. Not a fork of the session: a plugin's fork runs under the plugin's own origin, so its calls
 * skip this mod's hooks, and nothing here could refuse its writes. Never throws.
 */
async function startSweep($: EngineInterface): Promise<void> {
  try {
    if (!(await sweepsHere($))) {
      // Not the sweeper's session: nothing to count toward.
      counts.changes = 0
      counts.turns = 0
      return
    }
    // The file beside the mod: .claude/freshness.md, the mod being .claude/skills/ep0ch-repo.
    const freshness = String(await $.fs.read(`${$.plugin.root}/../../freshness.md`))
    const { agent } = await $.agent.register({
      name: SWEEP_AGENT,
      description: "Checks, read-only, what .claude/freshness.md lists as stale; started by the ep0ch-repo mod, never by hand.",
      prompt: SWEEP_SYSTEM,
      tools: SWEEP_TOOLS,
      model: 'sonnet',
      background: true,
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `bun ${$.plugin.root}/scripts/read-only-bash.ts` }] }] },
    })
    const taken = { ...counts }
    const why = `It runs now because this session made ${taken.changes} deploys or merges and ${taken.turns} turns that wrote to the outline since the last sweep.`
    const spawned = await $.agent.spawn({ subagentType: agent, description: 'freshness sweep', prompt: sweepBrief(freshness, why) })
    if ('deny' in spawned && spawned.deny) throw Error(spawned.deny)
    if (!spawned.agentId) throw Error('no agent was started')
    sweepId = spawned.agentId
    // What came in while it started counts toward the next sweep.
    counts.changes -= taken.changes
    counts.turns -= taken.turns
    $.ui.toast('Freshness sweep: a read-only agent is checking .claude/freshness.md; its findings come back here.', { timeoutMs: 6000 })
  } catch (error) {
    // No brief, or the agent was refused: said, and tried again after the next change (not the next turn).
    counts.changes = Math.min(counts.changes, SWEEP_AFTER_CHANGES - 1)
    counts.turns = Math.min(counts.turns, SWEEP_AFTER_TURNS - 1)
    $.ui.toast(`Freshness sweep couldn't start: ${error instanceof Error ? error.message : String(error)}`, { timeoutMs: 8000 })
  } finally {
    starting = false
  }
}

/**
 * The ep0ch repository's own mod (PIE-842), loaded for sessions in this repository only (it lives in the project's
 * `.claude/skills/`):
 * - guardrails: a Bash call that breaks one of the repository's hard rules is refused with the reason and the command
 *   to run instead (hooks/guards.ts);
 * - the freshness sweep: in the deployer's sessions, after a few deploys or merges, a read-only background agent checks
 *   what `.claude/freshness.md` lists as stale and hands its findings to the main thread (hooks/freshness.ts).
 */
export const register: Register = (on) => {
  // A registration is one session (a reload, a test case): nothing carries over from the last one.
  hostname = undefined
  sweeps = undefined
  counts.changes = 0
  counts.turns = 0
  wroteThisTurn = false
  sweepId = null
  starting = false
  // The sweep's type is the mod's own: never offered to the model.
  on('agent.offer', { agent: `ep0ch-repo:${SWEEP_AGENT}` }, () => ({ isOffered: false }))

  // An outline write marks the main loop's turn as one that changed things.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && isOutlineWrite(e.tool) && !('deny' in result && result.deny) && !result.isError) wroteThisTurn = true
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = e.command
    const why = guardOf(command, { hostname: await hostnameOf($) }) ?? await protocolChecks($, command)
    if (why) return { deny: why }
    const result = await next(e)
    if (e.agentId === undefined && !('deny' in result && result.deny) && !result.isError && (isDeploy(command) || isMerge(command))) counts.changes++
    return result
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    // The hook itself failed (a lookup): the rules that need nothing outside the command still hold.
    const why = guardOf(e.command, { hostname: '' })
    return why ? { deny: why } : next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // The sweep's answer: handed to the main thread as a prompt of its own, once the session is idle.
    if (sweepId !== null && e.agentId === sweepId) {
      sweepId = null
      void $.prompt.submit({ text: reportOf(e.answer ?? '') }).catch(() => {})
      return result
    }
    if (e.agentId !== undefined) return result
    if (wroteThisTurn) counts.turns++
    wroteThisTurn = false
    if (!dueOf(counts) || sweepId !== null || starting) return result
    // Off the turn's dispatch: reading the brief and starting the sweep never hold the answer up.
    starting = true
    $.clock.after(0, () => void startSweep($))
    return result
  })
}
