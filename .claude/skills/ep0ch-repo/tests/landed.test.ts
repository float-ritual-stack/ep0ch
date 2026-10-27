import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const ROW = '11111111-2222-4333-8444-555555555555'

/** A session whose gh says PR `state`, and whose outliner CLI answers `land`; records each landing argv. */
function sessionIn(on: On, state: string | null, land: ProcessRunResult, bashFails = false) {
  const landed: string[][] = []
  mock.clock(on)
  mock.env(on, { EP0CH_FRESHNESS: 'off', EP0CH_AGENT: 'loki' })
  on('session.cwd', () => ({ value: '/work/ep0ch' }))
  on('session.root', () => ({ value: '/work/ep0ch' }))
  on('process.run', async ($, e) => {
    const argv = e.argv
    if (argv[0] === 'hostname') return { value: result(0, 'float-box\n') }
    if (argv[0] === 'which') return { value: result(0, '/home/example/.local/bin/ep0ch\n') }
    if (argv[0] === 'readlink') return { value: result(0, '/home/example/live/packages/door/src/main.ts\n') }
    if (argv[0] === 'gh' && argv.includes('number,url,state')) {
      if (state === null) return { value: result(1, '', 'HTTP 502') }
      return { value: result(0, JSON.stringify({ number: 960, url: 'https://github.com/example-org/example-app/pull/960', state })) }
    }
    // The PROTOCOL check: a PR that leaves it alone.
    if (argv[0] === 'gh' && argv[1] === 'pr') return { value: result(0, JSON.stringify({ headRefOid: 'abc123', baseRefName: 'main' })) }
    if (argv[0] === 'gh' && argv[1] === 'api' && argv.includes('--jq')) return { value: result(0, 'base123\n') }
    if (argv[0] === 'gh' && argv[1] === 'api') return { value: result(0, 'export const PROTOCOL = 5;\n') }
    if (argv[0] === '/bin/sh') { landed.push(argv); return { value: land } }
    return { value: result(1, '', 'unexpected') }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: bashFails ? 'boom' : '', interrupted: false }, ...(bashFails ? { isError: true } : {}) }) as never)
  return { landed }
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

describe('every merge on the record (PIE-1352)', () => {
  test('a merge that ran lands the PR through the installed checkout\'s work deliver with no item, and says the row', async ($, on) => {
    const s = sessionIn(on, 'MERGED', result(0, JSON.stringify({ landed: { blockId: ROW, created: true, tickets: [] }, deliveries: [] })))
    const out = await bash($, 'gh pr merge 960 --merge')
    expect(s.landed).toEqual([['/bin/sh', '/home/example/live/packages/outliner/scripts/run-bun.sh', '/home/example/live/packages/outliner/src/cli.ts',
      'work', 'deliver', '--repo=example-org/example-app', '--pr=960', '--author=agent', '--actor=loki']])
    expect(out.context.join('\n')).toContain(`example-org/example-app#960 is on the record: merge row ((${ROW})), with no ticket.`)
  })

  test('a merge followed by a command that failed is still landed', async ($, on) => {
    const s = sessionIn(on, 'MERGED', result(0, JSON.stringify({ landed: { blockId: ROW, tickets: ['PIE-8'] }, deliveries: [{}], failed: [] })), true)
    const out = await bash($, 'gh pr merge 960 --merge && false')
    expect(s.landed).toHaveLength(1)
    expect(out.context.join('\n')).toContain('delivering PIE-8.')
  })

  test('gh not answering says the merge is not on the record yet, with the command', async ($, on) => {
    const s = sessionIn(on, null, result(0, '{}'))
    const out = await bash($, 'gh pr merge 960 --merge')
    expect(s.landed).toEqual([])
    expect(out.context.join('\n')).toContain("gh didn't say whether PR 960 merged")
  })

  test('a PR not merged yet (auto-merge) is left alone', async ($, on) => {
    const s = sessionIn(on, 'OPEN', result(0, '{}'))
    await bash($, 'gh pr merge 960 --merge --auto')
    expect(s.landed).toEqual([])
  })

  test('a landing that fails says so with the command to run', async ($, on) => {
    sessionIn(on, 'MERGED', result(1, '', 'No outline: this folder names none'))
    const out = await bash($, 'gh pr merge 960 --merge')
    expect(out.context.join('\n')).toContain("isn't on the record yet (No outline: this folder names none); land it with `bun packages/outliner/src/cli.ts work deliver --repo example-org/example-app --pr 960` from the installed checkout")
  })
})
