import type { EngineInterface, Register } from 'claude-code'

import { pathsIn, type Rule, ruleContext, ruleOf, rulesFor } from './rules'
import { guardOf, type Merge, mergesIn, protocolOf, protocolRefusal } from './guards'
import { installedRoot, landArgv, landedSaid, lookupFailed, mergedPr } from './landed'
import { absolute, contentsOf, scratchRemovals, underScratch } from './scratch'
import { DRAIN_EVERY_MS, DRAIN_FIRST_MS, DRAIN_LOOKUPS, drainKeyOf, drainPrompt, drainsFor } from './drain'
import { agentOfEp0ch, type Counts, dueOf, SWEEP_AFTER_CHANGES, SWEEP_AFTER_TURNS, isDeploy, isMerge, isOutlineWrite, reportOf, SWEEP_SYSTEM, SWEEP_TOOLS, sweepBrief, sweepsFor } from './freshness'

const PROTOCOL_PATH = 'packages/outline-core/src/protocol.ts'
/** The sweep's agent type, `ep0ch-repo:<name>`: registered by this mod, offered to no model. */
const SWEEP_AGENT = 'freshness-sweep'
const LOOKUP_MS = 10_000
/** Landing a merge: gh once more and a few outline writes. */
const LAND_MS = 60_000

/** This machine's name, asked once (the --parallel rule holds on the shared machine only). */
let hostname: Promise<string> | undefined
/** The session's agent, and whether it sweeps, read once. */
let sessionAgent: Promise<string | null> | undefined
let sweeps: Promise<boolean> | undefined
/** The drain tick's clock (armed once per start; its generation stops an earlier start's first tick), whether a tick waits for the session, and whether a dropped one was said. */
let drainStarting: Promise<void> | undefined
let drainTimer: { cancel: () => void } | undefined
let drainGen = 0
let drainWaiting = false
/** A drain prompt is in the session and its turn hasn't ended: the next main-loop turn's end clears it. */
let drainQueued = false
/** The board at the last drain that went (drainKeyOf). */
let drainKey: string | null = null
let drainDropSaid = false
/** Deploys and merges, and turns that wrote to the outline, since the last sweep. */
const counts: Counts = { changes: 0, turns: 0 }
let wroteThisTurn = false
/** The sweep running now (its agent id), and whether one is being started. */
let sweepId: string | null = null
/** When it started (the session clock): one that never answers stops blocking the next after SWEEP_STALE_MS. */
let sweepAt = 0
const SWEEP_STALE_MS = 30 * 60_000
let starting = false
/** The path-scoped rules (`.claude/rules`), read once; and which are in each loop's context (`<agent id>|<file>`). */
let rules: Promise<Rule[]> | undefined
const attached = new Set<string>()

function hostnameOf($: EngineInterface): Promise<string> {
  return (hostname ??= $.process.run(['hostname'], { timeoutMs: 3000 }).then(r => r.stdout.trim(), () => ''))
}

/**
 * The session's agent, in the Claude mod's order (its `sessionPersonaOf`): OUTLINER_ACTOR, else EP0CH_AGENT, else the
 * nearest `.ep0ch`'s `agent` (`.ep0ch/config.toml`, or an old `.ep0ch` file); null when none names one. Read once.
 */
function agentHere($: EngineInterface): Promise<string | null> {
  return (sessionAgent ??= (async () => {
    const [actor, envAgent, root] = await Promise.all([$.env.get('OUTLINER_ACTOR'), $.env.get('EP0CH_AGENT'), $.session.root()])
    const named = actor?.trim() || envAgent?.trim()
    if (named) return named
    for (let dir = root; dir; dir = dir.slice(0, dir.lastIndexOf('/'))) {
      for (const file of [`${dir}/.ep0ch/config.toml`, `${dir}/.ep0ch`]) {
        const text = await $.fs.read(file).then(t => String(t), () => null)
        if (text !== null) return agentOfEp0ch(text)
      }
    }
    return null
  })().catch(() => null))
}

/** Whether this session sweeps: EP0CH_FRESHNESS, else the session's agent is loki. */
function sweepsHere($: EngineInterface): Promise<boolean> {
  return (sweeps ??= (async () => sweepsFor(await $.env.get('EP0CH_FRESHNESS'), await agentHere($)))().catch(() => false))
}

/**
 * The drain tick (hooks/drain.ts, PIE-1372), in the deployer's sessions (EP0CH_DRAIN says otherwise): the drain prompt
 * every 30 minutes on the engine's clock, the first soon after the start. A prompt the session drops is said once; the
 * next tick tries again. Once per start (or, for a module reloaded mid-session, the first turn after). Never throws.
 */
function startDrainOnce($: EngineInterface): Promise<void> {
  return (drainStarting ??= startDrain($))
}

async function startDrain($: EngineInterface): Promise<void> {
  try {
    drainTimer?.cancel()
    drainTimer = undefined
    const gen = ++drainGen
    if (!drainsFor(await $.env.get('EP0CH_DRAIN'), await agentHere($))) return
    if (gen !== drainGen) return
    const tick = () => void drainTick($, gen)
    drainTimer = $.clock.every(DRAIN_EVERY_MS, tick)
    $.clock.after(DRAIN_FIRST_MS, () => { if (gen === drainGen) tick() })
  } catch (error) {
    $.ui.toast(`Drain tick couldn't start: ${error instanceof Error ? error.message : String(error)}`, { timeoutMs: 8000 })
  }
}

/**
 * One tick: quiet while the last drain hasn't had its turn (a submitted prompt only queues), and quiet when the board
 * reads as it did at the last drain that went, the same day (DRAIN_LOOKUPS); else the drain prompt.
 */
async function drainTick($: EngineInterface, gen: number): Promise<void> {
  if (drainWaiting || drainQueued) return
  drainWaiting = true
  try {
    const [cwd, now] = await Promise.all([$.session.root(), $.clock.now()])
    const answers = await Promise.all(DRAIN_LOOKUPS.map(argv => $.process.run([...argv], { cwd, timeoutMs: LOOKUP_MS })
      .then(r => (r.exitCode === 0 ? r.stdout : null), () => null)))
    const key = drainKeyOf(answers, now)
    if (gen !== drainGen || (key !== null && key === drainKey)) return
    drainQueued = true
    const sent = await $.prompt.submit({ text: drainPrompt() })
    if (sent.drop !== undefined) throw Error(sent.drop || 'the prompt was dropped')
    drainKey = key
    drainDropSaid = false
  } catch (error) {
    drainQueued = false
    if (!drainDropSaid) $.ui.toast(`Drain tick didn't reach this session (${error instanceof Error ? error.message : String(error)}); the next tick tries again.`, { timeoutMs: 8000 })
    drainDropSaid = true
  } finally {
    if (gen === drainGen) drainWaiting = false
  }
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
  // Compare the PROTOCOL value with merge-base: a GRAMMAR-only edit to this file is not a wire bump.
  const compared = await gh(['api', `repos/${repo}/compare/main...${headRefOid}`, '--jq', '.merge_base_commit.sha'])
  const mergeBase = compared?.trim()
  if (!mergeBase) return null
  const [branch, main, base] = await Promise.all([at(headRefOid), at('main'), at(mergeBase)])
  const [b, m, o] = [branch, main, base].map(text => text === null ? null : protocolOf(text))
  return b == null || m == null || o == null ? null : protocolRefusal(m, b, o, merge.pr)
}

/**
 * After a `gh pr merge` that ran, each merged PR goes on the outline's record (hooks/landed.ts): what that said, one line
 * per PR, for the agent that merged. A PR not merged yet (auto-merge, a queue) is left to the merge step's next run.
 */
async function landMerges($: EngineInterface, command: string): Promise<string[]> {
  const [cwd, sessionRoot, envAgent] = await Promise.all([$.session.cwd(), $.session.root(), $.env.get('EP0CH_AGENT')])
  // The installed checkout's CLI, from its own folder: the host's PROTOCOL and the deployer's outline (hooks/landed.ts).
  const ep0ch = await $.process.run(['which', 'ep0ch'], { timeoutMs: 3000 }).then(r => r.exitCode === 0 ? r.stdout.trim() : '', () => '')
  const main = ep0ch ? await $.process.run(['readlink', '-f', ep0ch], { timeoutMs: 3000 }).then(r => r.exitCode === 0 ? r.stdout : '', () => '') : ''
  const root = installedRoot(main) ?? sessionRoot
  const said: string[] = []
  for (const merge of mergesIn(command)) {
    const view = await $.process.run(['gh', 'pr', 'view', ...(merge.pr ? [merge.pr] : []), ...(merge.repo ? ['--repo', merge.repo] : []), '--json', 'number,url,state'], { cwd, timeoutMs: LOOKUP_MS })
      .then(r => r.exitCode === 0 ? r.stdout : null, () => null)
    if (view === null) {
      said.push(lookupFailed(merge.pr))
      continue
    }
    const pr = mergedPr(view)
    if (!pr) continue
    const run = await $.process.run(landArgv(root, pr, envAgent?.trim() || 'merge-step'), { cwd: root, timeoutMs: LAND_MS })
      .catch(error => ({ exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }))
    said.push(landedSaid(pr, run))
  }
  return said
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
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `bun ${JSON.stringify(`${$.plugin.root}/scripts/read-only-bash.ts`)}` }] }] },
    })
    const taken = { ...counts }
    const why = `It runs now because this session made ${taken.changes} deploys or merges and ${taken.turns} turns that wrote to the outline since the last sweep.`
    const spawned = await $.agent.spawn({ subagentType: agent, description: 'freshness sweep', prompt: sweepBrief(freshness, why) })
    if ('deny' in spawned && spawned.deny) throw Error(spawned.deny)
    if (!spawned.agentId) throw Error('no agent was started')
    sweepId = spawned.agentId
    sweepAt = await $.clock.now()
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

/** The rule files beside the mod (`.claude/rules`, the mod being `.claude/skills/ep0ch-repo`), read once. */
function rulesOf($: EngineInterface): Promise<Rule[]> {
  return (rules ??= (async () => {
    const dir = `${$.plugin.root}/../../rules`
    const entries = await $.fs.list(dir)
    const read = await Promise.all(entries.filter(f => f.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))
      .map(async f => ruleOf(`.claude/rules/${f.name}`, String(await $.fs.read(`${dir}/${f.name}`)))))
    return read.filter((r): r is Rule => r !== null)
  })().catch(() => []))
}

/**
 * The rules a Bash command touches that this loop hasn't been given yet (once each, again after a compaction or
 * /clear): their text, for the command's result to carry. Path-scoped rules load only when a file is read.
 */
async function rulesToAttach($: EngineInterface, command: string, agentId: string | undefined): Promise<string[]> {
  const [all, cwd, root] = await Promise.all([rulesOf($), $.session.cwd(), $.session.root()])
  const loop = agentId ?? ''
  return rulesFor(pathsIn(command, cwd, root), all)
    .filter(rule => !attached.has(`${loop}|${rule.file}`))
    .map(rule => { attached.add(`${loop}|${rule.file}`); return ruleContext(rule) })
}

/**
 * The ep0ch repository's own mod (PIE-842), loaded for sessions in this repository only (it lives in the project's
 * `.claude/skills/`):
 * - guardrails: a Bash call that breaks one of the repository's hard rules is refused with the reason and the command
 *   to run instead (hooks/guards.ts);
 * - the freshness sweep: in the deployer's sessions, after a few deploys or merges, a read-only background agent checks
 *   what `.claude/freshness.md` lists as stale and hands its findings to the main thread (hooks/freshness.ts);
 * - the drain tick: in the deployer's sessions, the drain as a prompt every 30 minutes (hooks/drain.ts).
 */
export const register: Register = (on) => {
  // A registration is one session (a reload, a test case): nothing carries over from the last one.
  hostname = undefined
  rules = undefined
  attached.clear()
  sessionAgent = undefined
  sweeps = undefined
  drainTimer?.cancel()
  drainTimer = undefined
  drainStarting = undefined
  drainGen++
  drainWaiting = false
  drainQueued = false
  drainKey = null
  drainDropSaid = false
  counts.changes = 0
  counts.turns = 0
  wroteThisTurn = false
  sweepId = null
  sweepAt = 0
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
    if (result.deny !== undefined) return result
    if (e.agentId === undefined && !result.isError && (isDeploy(command) || isMerge(command))) counts.changes++
    // Every merge on the record (PIE-1352), from whichever loop merged.
    // Even when a later command in the line failed: gh's state says whether each merged.
    const landed = isMerge(command) ? await landMerges($, command).catch(() => []) : []
    const context = [...landed, ...await rulesToAttach($, command, e.agentId).catch(() => [])]
    return context.length ? { ...result, context: [...(result.context ?? []), ...context] } : result
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    // The hook itself failed (a lookup): the rules that need nothing outside the command still hold.
    const why = guardOf(e.command, { hostname: '' })
    return why ? { deny: why } : next(e)
  })

  // A cleanup of scratch folders is never stopped for a permission prompt (hooks/scratch.ts): only a command that is
  // nothing but `rm -r` of folders under the scratch roots is answered; everything else goes to the normal prompt.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'Bash') return next(e)
    const command = (e.tool_input as { command?: unknown } | null)?.command
    if (typeof command !== 'string') return next(e)
    try {
      const [uid, home, cwd] = await Promise.all([
        $.process.run(['id', '-u'], { timeoutMs: 3000 }).then(r => r.stdout.trim()),
        $.env.get('HOME'),
        $.session.cwd(),
      ])
      if (!uid || !home) return next(e)
      const ctx = { uid, home, cwd }
      const paths = scratchRemovals(command, ctx)
      if (!paths) return next(e)
      // Where each really is (links followed, `..` taken): a path that leaves the roots by either is not scratch.
      // `<folder>/*` empties the folder: it is the folder that has to be under the roots (and the roots themselves are not).
      const real = await $.process.run(['realpath', '-m', '--', ...paths.map(p => absolute(contentsOf(p) ?? p, cwd))], { timeoutMs: 3000 })
      const resolved = real.stdout.split('\n').filter(Boolean)
      if (real.exitCode !== 0 || resolved.length !== paths.length || !resolved.every(p => underScratch(p, ctx))) return next(e)
      return { decision: { behavior: 'allow' } }
    } catch {
      return next(e)
    }
  })

  // The drain tick (hooks/drain.ts), armed at each start (a resume, a /clear) in the deployer's sessions.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    drainStarting = undefined
    $.clock.after(0, () => void startDrainOnce($))
    return result
  })

  // A compaction or /clear drops what the rules said: they're given again the next time a command touches them.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const loop = e.agentId ?? ''
    if (e.trigger !== 'precompute' && !('skip' in result && result.skip)) for (const key of [...attached]) if (key.startsWith(`${loop}|`)) attached.delete(key)
    return result
  })
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') attached.clear()
    return next(e)
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
    // A module reloaded mid-session (a deploy of this mod) never sees its session.start.
    if (!drainStarting) $.clock.after(0, () => void startDrainOnce($))
    drainQueued = false
    if (wroteThisTurn) counts.turns++
    wroteThisTurn = false
    if (sweepId !== null && (await $.clock.now()) - sweepAt > SWEEP_STALE_MS) sweepId = null
    if (!dueOf(counts) || sweepId !== null || starting) return result
    // Off the turn's dispatch: reading the brief and starting the sweep never hold the answer up.
    starting = true
    $.clock.after(0, () => void startSweep($))
    return result
  })
}
