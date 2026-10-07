import type { On, ProcessRunInit, ProcessRunResult, TurnCompleteInput } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { notified, permissionAsked, questionAsked, sequenceOf, statusSetting, turnEnded } from '../hooks/claude-status'

tier('user')

const ok = (exitCode = 0): ProcessRunResult => ({ exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
type Run = { argv: readonly string[]; init?: ProcessRunInit }
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

/** A session whose terminal takes program status (or not, as `env` says); the reports it wrote to /dev/tty, decoded to `state[:kind] msg`. */
function terminal(on: On, env: Record<string, string>, pst = true) {
  const runs: Run[] = []
  mock.clock(on)
  mock.env(on, { PI_OUTLINER_MENTIONS_MODE: 'allowlist', PI_OUTLINER_MENTIONS_WORKSPACES: '', ...env })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pi-outliner__${e.name}` } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.reason === 'answer' ? e.answer : '' }))
  // No settings hook answers them: the dialog shows, and the tool runs after.
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.Notification', () => ({}))
  on('process.run', ($, e) => {
    runs.push(e)
    return { value: e.argv[0] === 'tput' ? ok(pst ? 0 : 1) : ok(e.argv[0] === 'ep0ch' ? 1 : 0) }
  })
  const reports = () => runs.filter(r => r.argv[0] === 'sh' && r.argv[1] === '-c' && String(r.argv[2]).includes('/dev/tty')).map(r => {
    const body = String(r.argv[4]).slice('\x1b]7501;'.length, -2)
    const pairs = Object.fromEntries(body.split(':').map(p => p.split('=')))
    const msg = pairs.msg ? new TextDecoder().decode(Uint8Array.from(atob(pairs.msg), c => c.charCodeAt(0))) : ''
    return `${pairs.state}${pairs.kind ? `:${pairs.kind}` : ''}${pairs.app ? ` [${pairs.app}]` : ''}${msg ? ` ${msg}` : ''}`
  })
  return { runs, reports }
}
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

const ANSWER: TurnCompleteInput = { reason: 'answer', answer: '\nDeployed v2.4.1 to staging.\nDetails follow.', durationMs: 900, isAborted: false, turnId: 'turn-1' }
const START = { surface: 'terminal', isInteractive: true, cwd: '/work/elsewhere' } as const

describe("this Claude's program status (OSC 7501)", () => {
  test('a turn: working, blocked on the permission dialog, working once the tool runs, done with its answer', async ($, on) => {
    const { reports } = terminal(on, { TERM: 'xterm-256color' })
    await $.session.start(START)
    await $.turn.start({ text: 'deploy it', turnId: 'turn-1' })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'make deploy ENV=staging' } })
    // The dialog's generic notification doesn't replace what the PermissionRequest said.
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission' })
    await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'make deploy ENV=staging' }, tool_response: {}, tool_use_id: 'tu-1' })
    await $.turn.complete(ANSWER)
    await settle()
    expect(reports()).toEqual([
      'idle [claude-code]',
      'working [claude-code]',
      'blocked:permission [claude-code] Allow Bash: make deploy ENV=staging?',
      'working [claude-code]',
      'done [claude-code] Deployed v2.4.1 to staging.',
    ])
  })

  test("a subagent's turn isn't the session's; an interrupted turn is idle; the same report twice is sent once", async ($, on) => {
    const { reports } = terminal(on, { EP0CH_PROGRAM_STATUS: '1' })
    await $.session.start(START)
    await $.turn.start({ text: 'x', turnId: 'turn-1' })
    await $.turn.start({ text: '', turnId: 'turn-1' })
    await $.turn.complete({ ...ANSWER, agentId: 'agent-1' })
    await $.turn.complete({ ...ANSWER, reason: 'aborted', isAborted: true })
    await settle()
    expect(reports()).toEqual(['idle [claude-code]', 'working [claude-code]', 'idle [claude-code] interrupted'])
  })

  test('a terminal without Pst, or EP0CH_PROGRAM_STATUS=0, or no TERM: nothing is written, and tput is asked at most once', async ($, on) => {
    const { runs, reports } = terminal(on, { TERM: 'xterm-256color' }, false)
    await $.session.start(START)
    await $.turn.start({ text: 'x', turnId: 'turn-1' })
    await $.turn.complete(ANSWER)
    await settle()
    expect(reports()).toEqual([])
    expect(runs.filter(r => r.argv[0] === 'tput')).toHaveLength(1)
  })
})

test('the reports themselves', () => {
  expect(statusSetting('1')).toBe(true)
  expect(statusSetting('off')).toBe(false)
  expect(statusSetting(undefined)).toBeNull()
  expect(permissionAsked('Edit', { file_path: '/work/app.ts' })).toEqual({ state: 'blocked', kind: 'permission', msg: 'Allow Edit: /work/app.ts?' })
  expect(questionAsked({ questions: [{ question: 'Which region first?' }] })).toEqual({ state: 'blocked', kind: 'question', msg: 'Which region first?' })
  expect(notified('elicitation_dialog', 'Pick a branch')).toEqual({ state: 'blocked', kind: 'question', msg: 'Pick a branch' })
  expect(notified('idle_prompt', 'Claude is waiting for your input')).toBeNull()
  expect(turnEnded('error', '')).toEqual({ state: 'error', msg: 'stopped on an API error' })
  expect(sequenceOf({ state: 'done', msg: 'ok' })).toBe(`\x1b]7501;state=done:app=claude-code:msg=${b64('ok')}\x1b\\`)
  expect(sequenceOf({ state: 'clear' })).toBe('\x1b]7501;state=clear\x1b\\')
})
