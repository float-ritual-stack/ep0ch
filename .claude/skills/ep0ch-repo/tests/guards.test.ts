import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { guardOf, protocolRefusal } from '../hooks/guards'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const protocolTs = (n: number) => `// the one check\nexport const PROTOCOL = ${n};\n`

/** `left`: PROTOCOL where the branch left main (default: main's, so a branch that differs changed it). */
type Case = { hostname?: string; base?: string; branch?: number; main?: number; left?: number }

/** A session on `hostname` whose gh answers from the case, recording what Bash really ran. */
function sessionIn(on: On, c: Case = {}) {
  const ran: string[] = []
  mock.clock(on)
  mock.env(on, { EP0CH_FRESHNESS: 'off' })
  on('session.cwd', () => ({ value: '/work/ep0ch' }))
  on('session.root', () => ({ value: '/work/ep0ch' }))
  on('process.run', async ($, e) => {
    const argv = e.argv
    if (argv[0] === 'hostname') return { value: result(0, `${c.hostname ?? 'float-2'}\n`) }
    if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'view') return { value: result(0, JSON.stringify({ headRefOid: 'abc123', baseRefName: c.base ?? 'main' })) }
    if (argv[0] === 'gh' && argv[1] === 'api' && argv.includes('--jq')) return { value: result(0, 'base123\n') }
    if (argv[0] === 'gh' && argv[1] === 'api') {
      const ref = argv.at(-1)!.split('ref=')[1]
      const main = c.main ?? 165
      return { value: result(0, protocolTs(ref === 'main' ? main : ref === 'base123' ? c.left ?? main : c.branch ?? main)) }
    }
    return { value: result(1, '', 'unexpected') }
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  return { ran }
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

describe('guardrails refuse with the reason and the command to run', () => {
  test('pkill and killall: refused, with how to stop your own', async ($, on) => {
    const s = sessionIn(on)
    for (const command of ['pkill -f "box-test door"', 'cd /tmp && killall bun', 'timeout 5 sudo pkill node']) {
      const { deny } = await bash($, command)
      expect(deny).toContain('is refused in this repository')
      expect(deny).toContain('scripts/agent-env <name> --clean')
    }
    expect(s.ran).toEqual([])
  })

  test('git stash: refused, with the wip commit to make; stash list and show still run', async ($, on) => {
    const s = sessionIn(on)
    for (const command of ['git stash', 'git -C ~/wt/x stash push -m tmp', 'git stash pop']) {
      expect((await bash($, command)).deny).toContain('git add -A && git commit -m "wip: <what>"')
    }
    expect((await bash($, 'git stash list')).deny).toBeUndefined()
    expect(s.ran).toEqual(['git stash list'])
  })

  test('gh pr merge -d/--delete-branch: refused, naming the merge to run', async ($, on) => {
    const s = sessionIn(on)
    for (const command of ['gh pr merge 512 --merge --delete-branch', 'gh pr merge 512 -sd', 'gh pr merge -d 512 --squash']) {
      expect((await bash($, command)).deny).toContain('Run `gh pr merge 512 --merge`')
    }
    expect(s.ran).toEqual([])
  })

  test('bun test --parallel: refused on float-2, with the focused and box-test routes; elsewhere it runs', async ($, on) => {
    const s = sessionIn(on)
    const { deny } = await bash($, 'cd packages/door && bun test --parallel test/')
    expect(deny).toContain('refused on float-2')
    expect(deny).toContain('scripts/agent-env <your name> --test -- timeout 900 bun test <files>')
    expect(deny).toContain('scripts/box-test')
    expect(s.ran).toEqual([])
  })

  test('on another machine bun test --parallel runs', async ($, on) => {
    const s = sessionIn(on, { hostname: 'float-box' })
    expect((await bash($, 'bun test --parallel')).deny).toBeUndefined()
    expect(s.ran).toEqual(['bun test --parallel'])
  })

  test('a merge into main whose PROTOCOL skips a number: refused with the number to use', async ($, on) => {
    const s = sessionIn(on, { main: 165, branch: 167 })
    const { deny } = await bash($, 'gh pr merge 520 --merge')
    expect(deny).toContain('This PR sets PROTOCOL to 167, and main is at 165')
    expect(deny).toContain('export const PROTOCOL = 166;')
    expect(deny).toContain('`gh pr merge 520 --merge`')
    expect(s.ran).toEqual([])
  })

  test('a merge at main plus one runs', async ($, on) => {
    const s = sessionIn(on, { main: 165, branch: 166 })
    expect((await bash($, 'gh pr merge 520 --merge')).deny).toBeUndefined()
    expect(s.ran).toEqual(['gh pr merge 520 --merge'])
  })

  test('a merge that leaves PROTOCOL as main has it runs', async ($, on) => {
    const s = sessionIn(on, { main: 165, branch: 165 })
    expect((await bash($, 'gh pr merge --merge')).deny).toBeUndefined()
    expect(s.ran).toEqual(['gh pr merge --merge'])
  })

  test('a branch that is only behind a bump on main (it never touched PROTOCOL) merges', async ($, on) => {
    const s = sessionIn(on, { main: 166, branch: 165, left: 165 })
    expect((await bash($, 'gh pr merge 522 --merge')).deny).toBeUndefined()
    expect(s.ran).toEqual(['gh pr merge 522 --merge'])
  })

  test('a slice into its wave branch takes its number later', async ($, on) => {
    const s = sessionIn(on, { main: 165, branch: 170, base: 'wave/margins' })
    expect((await bash($, 'gh pr merge 521 --merge')).deny).toBeUndefined()
    expect(s.ran).toEqual(['gh pr merge 521 --merge'])
  })
})

describe('what counts as the command', () => {
  const ctx = { hostname: 'float-2' }
  test('words in a commit message, a PR body heredoc or a grep pattern are not commands', () => {
    expect(guardOf('git commit -m "never pkill or git stash here"', ctx)).toBeNull()
    expect(guardOf("gh pr create --body-file - <<'EOF'\npkill -f door\ngit stash\nEOF\necho done", ctx)).toBeNull()
    expect(guardOf('grep -rn "gh pr merge -d" AGENTS.md', ctx)).toBeNull()
  })

  test('a command inside a substitution, an if, sudo -u, xargs or bash -lc is still the command', () => {
    expect(guardOf('echo "$(pkill -f victim)"', ctx)).toContain('pkill')
    expect(guardOf('if true; then pkill node; fi', ctx)).toContain('pkill')
    expect(guardOf('sudo -u root pkill node', ctx)).toContain('pkill')
    expect(guardOf('ls | xargs -r pkill', ctx)).toContain('pkill')
    expect(guardOf("bash -lc 'git stash'", ctx)).toContain('git stash')
    expect(guardOf('git \\\nstash', ctx)).toContain('git stash')
    // `<<` inside quotes opens no heredoc: the next line is still read.
    expect(guardOf('git commit -m "use <<EOF"\npkill foo', ctx)).toContain('pkill')
  })

  test('a merge whose body says -d is not a delete', () => {
    expect(guardOf("gh pr merge 512 --merge --body '-d'", ctx)).toBeNull()
  })

  test('a command inside bash -c, env or agent-env is still the command', () => {
    expect(guardOf("bash -c 'pkill -f x'", ctx)).toContain('pkill')
    expect(guardOf('env FOO=1 git stash', ctx)).toContain('git stash')
    expect(guardOf('scripts/agent-env loki --test -- bun test --parallel', ctx)).toContain('--parallel')
  })

  test('the PROTOCOL rule: equal and plus one pass, anything else names main plus one', () => {
    expect(protocolRefusal(165, 165, 165, '1')).toBeNull()
    expect(protocolRefusal(165, 166, 165, '1')).toBeNull()
    expect(protocolRefusal(166, 165, 165, '1')).toBeNull()
    expect(protocolRefusal(166, 166, 165, null)).toContain('use 167')
  })
})
