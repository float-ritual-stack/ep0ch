import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { pathsIn, ruleOf, rulesFor } from '../hooks/rules'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const ROOT = '/work/ep0ch'
/** The rule files as the repository writes them: the same `paths:`, made-up bodies. */
const RULES: Record<string, string> = {
  'door.md': '---\npaths:\n  - "packages/door/**"\n  - "scripts/agent-env"\n---\n\n# The door\n\nA test door runs under agent-env.\n',
  'outliner.md': '---\npaths:\n  - "packages/outliner/**"\n---\n\n# The outliner\n\nThe service owns truth.\n',
  'outline-core.md': '---\npaths:\n  - "packages/outline-core/**"\n---\n\n# outline-core\n\nNo I/O.\n',
  'claude-mod.md': '---\npaths:\n  - "packages/claude-mod/**"\n---\n\n# The mod\n\nOnly register.ts gets $.\n',
  'outlines-by-name.md': '---\npaths:\n  - "packages/outline-core/src/{outline-location,machine}.ts"\n  - "packages/door/src/{home,pick}.ts"\n---\n\n# Outlines by name\n\nFlag, env, .ep0ch.\n',
}

/** A session in the repository whose shell is in `cwd()`; every Bash call answers plainly. */
function sessionIn(on: On, cwd: () => string = () => ROOT) {
  mock.clock(on)
  mock.env(on, { EP0CH_FRESHNESS: 'off' })
  on('session.cwd', () => ({ value: cwd() }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', () => ({ value: Object.keys(RULES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }) as never)
  on('fs.read', ($, e) => {
    const name = e.path.slice(e.path.lastIndexOf('/') + 1)
    if (e.path.includes('/rules/') && RULES[name]) return { value: RULES[name] }
    throw Error(`ENOENT: ${e.path}`)
  })
  on('process.run', ($, e) => ({ value: e.argv[0] === 'hostname' ? result(0, 'float-2\n') : result(1) }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('session.end', () => ({ sessionId: 'session-1' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
}

const bash = async ($: any, command: string, agentId?: string) => {
  const r = await $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) })
  return (r.context ?? []) as string[]
}
const files = (context: string[]) => context.map(c => c.slice(0, c.indexOf(' applies')))

describe('path-scoped rules reach a command that touches their package', () => {
  test('a test door from Bash gets door.md once, with its text', async ($, on) => {
    sessionIn(on)
    const first = await bash($, 'scripts/agent-env wq -- bun packages/door/src/main.ts --ws garden')
    expect(files(first)).toEqual(['.claude/rules/door.md'])
    expect(first[0]).toContain('A test door runs under agent-env.')
    expect(first[0]).not.toContain('paths:')
    expect(await bash($, 'cd packages/door && bun test test/menu.test.ts')).toEqual([])
  })

  test('the folder the shell is in counts: bun test in packages/outliner gets outliner.md', async ($, on) => {
    sessionIn(on, () => `${ROOT}/packages/outliner`)
    expect(files(await bash($, 'bun test test/store.test.ts'))).toEqual(['.claude/rules/outliner.md'])
  })

  test('a command that touches no package gets nothing', async ($, on) => {
    sessionIn(on)
    expect(await bash($, 'git status && gh pr list')).toEqual([])
  })

  test('after a compaction the rule is given again', async ($, on) => {
    sessionIn(on)
    expect(files(await bash($, 'ls packages/claude-mod/hooks'))).toEqual(['.claude/rules/claude-mod.md'])
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'plant the beans', toolUses: [] }] })
    expect(files(await bash($, 'ls packages/claude-mod/hooks'))).toEqual(['.claude/rules/claude-mod.md'])
  })

  test('each loop gets its own: a subagent is given the rule the main thread already has; /clear gives it again', async ($, on) => {
    sessionIn(on)
    expect(files(await bash($, 'ls packages/outline-core'))).toEqual(['.claude/rules/outline-core.md'])
    expect(files(await bash($, 'ls packages/outline-core', 'agent-7'))).toEqual(['.claude/rules/outline-core.md'])
    expect(await bash($, 'ls packages/outline-core', 'agent-7')).toEqual([])
    await $.session.end({ reason: 'clear' } as never)
    expect(files(await bash($, 'ls packages/outline-core'))).toEqual(['.claude/rules/outline-core.md'])
  })

  test('a refused command gets no rule', async ($, on) => {
    sessionIn(on)
    expect(await bash($, 'cd packages/door && git stash')).toEqual([])
    expect(files(await bash($, 'cd packages/door && git status'))).toEqual(['.claude/rules/door.md'])
  })
})

describe('which rules a command touches', () => {
  const rules = Object.entries(RULES).map(([name, text]) => ruleOf(`.claude/rules/${name}`, text)!)
  const names = (command: string, cwd = ROOT) => rulesFor(pathsIn(command, cwd, ROOT), rules).map(r => r.file.slice('.claude/rules/'.length))

  test('by a relative path, a path from the shell\'s folder, or another checkout\'s absolute path', () => {
    expect(names('bun test packages/outline-core/test/x.test.ts')).toEqual(['outline-core.md'])
    expect(names('bun test ../outline-core/test/x.test.ts', `${ROOT}/packages/door`)).toEqual(['door.md', 'outline-core.md'])
    expect(names('~/projects/ep0ch/scripts/agent-env loki -- ep0ch act open')).toEqual(['door.md'])
  })

  test('a cd in the command moves where what follows is read from; a bare file name counts in that folder', () => {
    expect(names('cd packages/door/src && cat ./home.ts')).toEqual(['door.md', 'outlines-by-name.md'])
    expect(names('cat home.ts', `${ROOT}/packages/door/src`)).toEqual(['door.md', 'outlines-by-name.md'])
    expect(names('cd packages && bun test outline-core/test/x.test.ts')).toEqual(['outline-core.md'])
    // Each reading of the command follows its cd once: never packages/door/src/src.
    expect(pathsIn('cd src && cat home.ts', `${ROOT}/packages/door`, ROOT)).not.toContain('packages/door/src/src/home.ts')
    // From packages/outliner, packages/door/x.ts is packages/outliner/packages/door/x.ts: not the door.
    expect(names('cat packages/door/x.ts', `${ROOT}/packages/outliner`)).toEqual(['outliner.md'])
  })

  test('paths: is read as written: either quotes, CRLF, and no other key\'s list', () => {
    const rule = ruleOf('r.md', "---\r\ntags:\r\n  - nope\r\npaths:\r\n  - 'packages/door/**/*.ts'\r\n---\r\nBody\r\n")!
    expect(rule.globs).toEqual(['packages/door/**/*.ts'])
    expect(rulesFor(['packages/door/main.ts'], [rule])).toHaveLength(1)
  })

  test('a narrow rule matches its own files only', () => {
    expect(names('cat packages/door/src/home.ts')).toEqual(['door.md', 'outlines-by-name.md'])
    expect(names('cat packages/door/src/menu.ts')).toEqual(['door.md'])
    expect(names('cat packages/outline-core/src/machine.ts')).toEqual(['outline-core.md', 'outlines-by-name.md'])
  })

  test('a rule with no paths: loads anyway, so it is not one of these', () => {
    expect(ruleOf('.claude/rules/x.md', '# Always\n')).toBeNull()
  })
})
