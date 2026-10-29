import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { bashReadRefusal, isDeploy, isOutlineWrite, reportOf, SWEEP_TOOLS, sweepBrief, sweepsFor } from '../hooks/freshness'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const FRESHNESS = '# What counts as stale\n- a merged PR with no build-log line\n'

/** A session in the repository, as loki (its .ep0ch) unless `env` says otherwise; it records spawns and submits. */
function sessionIn(on: On, env: Record<string, string> = {}, ep0ch = 'ws = "garden"\nagent = "loki"\n') {
  const spawns: { prompt: string; subagentType?: string }[] = []
  const submitted: string[] = []
  const toasts: string[] = []
  const registered: { tools?: readonly string[]; hooks?: Record<string, unknown> }[] = []
  const clock = mock.clock(on)
  mock.env(on, env)
  on('session.cwd', () => ({ value: '/work/ep0ch' }))
  on('session.root', () => ({ value: '/work/ep0ch' }))
  on('fs.read', ($, e) => {
    if (e.path === '/work/ep0ch/.ep0ch') return { value: ep0ch }
    if (e.path.endsWith('/freshness.md')) return { value: FRESHNESS }
    throw Error(`ENOENT: ${e.path}`)
  })
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'hostname') return { value: result(0, 'float-2\n') }
    if (e.argv[0] === 'gh') return { value: result(0, JSON.stringify({ headRefOid: 'abc', baseRefName: 'main' })) }
    return { value: result(1) }
  })
  on('prompt.submit', ($, e) => { submitted.push(e.text); return { isSubmitted: true } as never })
  on('agent.register', ($, e) => { registered.push(e); return { value: { agent: `ep0ch-repo:${e.name}` } } })
  // The spawn the mod asks for. The kit can't start one (the engine alone names a started agent), so the mod says
  // it couldn't start; the live session proves the rest (the PR says how).
  on('agent.spawn', ($, e) => {
    const asked = e as unknown as { prompt: string; subagentType?: string; subagent_type?: string }
    spawns.push({ prompt: asked.prompt, subagentType: asked.subagentType ?? asked.subagent_type })
    return { deny: 'no agents in this test' }
  })
  on('tool.call', ($, e) => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  return { spawns, submitted, toasts, registered, clock }
}

const turn = { reason: 'answer', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't' } as const

/** One main-loop turn that ran `command` through Bash. */
async function turnRunning($: any, command: string) {
  await $.tool.call({ tool: 'Bash', command })
  await $.turn.complete(turn)
}

describe('the freshness sweep', () => {
  test('after three deploys or merges loki\'s session starts the read-only sweep agent with the stale list', async ($, on) => {
    const s = sessionIn(on)
    await turnRunning($, 'ep0ch install --apply')
    await turnRunning($, 'gh pr merge 501 --merge')
    await s.clock.settle()
    expect(s.spawns).toEqual([])
    await turnRunning($, 'gh pr merge 502 --merge')
    await s.clock.settle()
    expect(s.spawns).toHaveLength(1)
    expect(s.spawns[0]!.subagentType).toBe('ep0ch-repo:freshness-sweep')
    expect(s.spawns[0]!.prompt).toContain('a merged PR with no build-log line')
    // Read-only by the engine: read tools and Bash alone, each Bash command through the read-only hook.
    expect(s.registered[0]!.tools).toEqual(SWEEP_TOOLS)
    expect(SWEEP_TOOLS.filter(t => !['Read', 'Grep', 'Glob', 'Bash', 'ToolSearch'].includes(t)).every(t => /__outline_(read|find|changes)$/.test(t))).toBe(true)
    expect(JSON.stringify(s.registered[0]!.hooks)).toContain('scripts/read-only-bash.ts')
  })

  test('a sweep that could not start is said once, and tried again after the next change', async ($, on) => {
    const s = sessionIn(on)
    for (const n of [1, 2, 3]) await turnRunning($, `gh pr merge 50${n} --squash`)
    await s.clock.settle()
    expect(s.toasts).toEqual(["Freshness sweep couldn't start: no agents in this test"])
    await turnRunning($, 'gh pr merge 504 --merge')
    await s.clock.settle()
    expect(s.spawns).toHaveLength(2)
  })

  test('another agent\'s session (not loki) never sweeps', async ($, on) => {
    const s = sessionIn(on, {}, 'ws = "garden"\n')
    for (const n of [1, 2, 3]) await turnRunning($, `gh pr merge 50${n} --squash`)
    await s.clock.settle()
    expect(s.spawns).toEqual([])
  })

  test('a refused merge or a subagent\'s merge does not count', async ($, on) => {
    const s = sessionIn(on)
    await turnRunning($, 'gh pr merge 501 --merge --delete-branch')
    await turnRunning($, 'gh pr merge 502 -d')
    await turnRunning($, 'gh pr merge 503 --merge')
    await s.clock.settle()
    expect(s.spawns).toEqual([])
  })
})

describe('freshness helpers', () => {
  test('who sweeps', () => {
    expect(sweepsFor(undefined, 'loki')).toBe(true)
    expect(sweepsFor(undefined, 'w13-builder')).toBe(false)
    expect(sweepsFor('on', null)).toBe(true)
    expect(sweepsFor('off', 'loki')).toBe(false)
  })

  test('what counts: a deploy, an outline write', () => {
    expect(isDeploy('cd ~/projects/ep0ch && ep0ch install --apply')).toBe(true)
    expect(isDeploy('ep0ch install')).toBe(false)
    expect(isOutlineWrite('mcp__ep0ch__outline_edit')).toBe(true)
    expect(isOutlineWrite('mcp__ep0ch__outline_read')).toBe(false)
  })

  test('the sweep\'s Bash may read and may not write', () => {
    expect(bashReadRefusal('ep0ch find --ws pie --query "type=build-log" --json | head -50')).toBeNull()
    expect(bashReadRefusal('systemctl --user list-units --all 2>/dev/null')).toBeNull()
    expect(bashReadRefusal("ssh laptop 'ep0ch status'")).toBeNull()
    // The float-2 checks the sweep is asked for (Oct 29: both were refused, so the sweep never saw float-2).
    expect(bashReadRefusal("ssh float-2 'systemctl --user --failed'")).toBeNull()
    expect(bashReadRefusal("ssh float-2 'cd ~/projects/ep0ch && git rev-parse HEAD'")).toBeNull()
    expect(bashReadRefusal("ssh float-2 'systemctl --user restart outliner-host'")).toContain('changes something')
    expect(bashReadRefusal('git log --oneline -5 > /tmp/x')).toContain('redirection')
    expect(bashReadRefusal('sed -i s/a/b/ CHANGELOG.md')).toContain('`sed`')
    expect(bashReadRefusal('ep0ch install --apply')).toContain('changes something')
    expect(bashReadRefusal('rm -rf build')).toContain('`rm`')
    // What can write or run a command anyway is refused.
    for (const writes of [
      'echo "$(touch /tmp/x)"', "bash -c 'echo changed > /tmp/x'", "sed 'w /tmp/x' f", 'find . -fprint0 /tmp/x',
      'sort -o /tmp/x f', "rg --pre 'touch /tmp/x' p f", 'git branch sweep-write', 'git diff --output=/tmp/x',
      'gh api repos/o/r/issues/1 -ftitle=changed', 'gh api --raw-field=title=x repos/o/r/issues/1',
      "ssh -o 'ProxyCommand=touch /tmp/x' laptop 'echo ok'", 'journalctl --user --rotate', 'systemctl --user start status',
      'env LD_PRELOAD=/tmp/p.so cat f', 'xargs cat', 'awk 1 f',
    ]) expect(bashReadRefusal(writes)).not.toBeNull()
    expect(bashReadRefusal('tail -f /var/log/x')).not.toBeNull()
    expect(bashReadRefusal('constructor')).not.toBeNull()
    for (const reads of [
      'gh pr list --state merged --search "merged:>=2026-03-03" --json number','git branch -a', 'systemctl --user status outliner-host.service', 'gh api repos/o/r/pulls', 'git log --oneline 2>&1 | head -3']) {
      expect(bashReadRefusal(reads)).toBeNull()
    }
  })

  test('the brief carries the stale list; the report tells the main thread to act', () => {
    expect(sweepBrief('- a merged PR with no build-log line', 'Three merges.')).toContain('--- .claude/freshness.md ---\n- a merged PR with no build-log line')
    expect(reportOf('- PIE-12 still in review')).toContain('- PIE-12 still in review')
    expect(reportOf('')).toContain('Nothing stale.')
  })
})
