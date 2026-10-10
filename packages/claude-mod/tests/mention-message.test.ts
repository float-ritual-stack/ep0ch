import { describe, expect, test, tier } from 'claude-code/testing'

import {
  boundWorkspaceOf,
  effectiveWorkspaces,
  failureReasonOf,
  mentionsModeOf,
  namedWorkspaceOf,
  sameHostSocket,
  sessionWorkspaceOf,
  workspaceEnvOf,
  workspacesOf,
} from '../hooks/mention-message'

tier('user')

describe('mention-message', () => {
  test('workspaces split on either separator; entries are absolute folders only', async () => {
    expect(workspacesOf(' /a/b/, : /c ')).toEqual(['/a/b', '/c'])
    expect(workspacesOf('')).toEqual([])
    expect(workspacesOf('/')).toEqual(['/'])
    expect(workspacesOf('~/projects/jam-shelf, ~', '/home/sam')).toEqual(['/home/sam/projects/jam-shelf', '/home/sam'])
    expect(effectiveWorkspaces('~/a', '/env', '/home/sam/')).toEqual(['/home/sam/a'])
    expect(() => workspacesOf('~/projects/jam-shelf')).toThrow('is not an absolute folder')
    // No silent fallback: a relative path, a non-string or the old folder=name form is an error.
    expect(() => workspacesOf(' /a/b/, relative : /c ')).toThrow('"relative" is not an absolute folder')
    expect(() => workspacesOf(['/a', 3])).toThrow('3 is not a folder path')
    expect(() => workspacesOf('/work/fred-folder=fred')).toThrow("name a folder's outline in its .ep0ch")
    expect(() => effectiveWorkspaces('', '/work/jam-shelf,jam')).toThrow('"jam" is not an absolute folder')
  })

  test('a CLI failure reports its error line, not the Bun trailer', async () => {
    const stderr = [
      '187 |         const response = JSON.parse(buffer.slice(0, newline)) as OutlinerResponse;',
      '188 |         if (!response.ok) responseReceived.reject(new Error(response.error));',
      '                                                            ^',
      'error: Destination is protected: active edit or source selection · finish or cancel it there',
      '      at data (node:net:281:72)',
      '',
      'Bun v1.3.14 (Linux x64)',
      '',
    ].join('\n')
    expect(failureReasonOf(stderr)).toBe('Destination is protected: active edit or source selection · finish or cancel it there')
    expect(failureReasonOf('plain failure\n    at x (y:1:2)\nBun v1.3.14 (Linux x64)')).toBe('plain failure')
    expect(failureReasonOf('')).toBe('')
  })

  test('a configured option wins; an empty or unset one falls back to the environment', async () => {
    expect(effectiveWorkspaces('/option', '/env')).toEqual(['/option'])
    expect(effectiveWorkspaces('', '/env')).toEqual(['/env'])
    expect(effectiveWorkspaces(undefined, '/env')).toEqual(['/env'])
    expect(effectiveWorkspaces(' , ', '/env')).toEqual(['/env'])
    expect(effectiveWorkspaces('', undefined)).toEqual([])
  })

  test('the mode: folder unless allowlist is asked for; the option wins over the environment', async () => {
    expect(mentionsModeOf('', undefined)).toBe('folder')
    expect(mentionsModeOf(undefined, ' ')).toBe('folder')
    expect(mentionsModeOf('', 'folder', ['/work/garden'])).toBe('folder')
    expect(mentionsModeOf('', undefined, ['/work/garden'])).toBe('allowlist')
    expect(mentionsModeOf('', 'allowlist')).toBe('allowlist')
    expect(mentionsModeOf('folder', 'allowlist')).toBe('folder')
    expect(mentionsModeOf(' allowlist ', undefined)).toBe('allowlist')
    expect(() => mentionsModeOf('', 'strict')).toThrow('"strict" is neither folder nor allowlist')
  })

  test("bound-folder's answer: the folder whose .ep0ch names an outline, holding the cwd, or nothing", async () => {
    const bound = '{"bound":true,"folder":"/work/garden","configPath":"/work/garden/.ep0ch","outline":"garden"}'
    expect(boundWorkspaceOf(bound, '/work/garden/src')).toEqual({ root: '/work/garden', outline: 'garden', pinned: true })
    expect(boundWorkspaceOf('{"bound":true,"folder":"/work/jam/notes/","outline":"jam-shelf"}', '/work/jam/notes'))
      .toEqual({ root: '/work/jam/notes', outline: 'jam-shelf', pinned: true })
    expect(boundWorkspaceOf('{"bound":false,"folder":"/tmp/scratch"}', '/tmp/scratch')).toBeNull()
    // A folder that doesn't hold the session, a sibling prefix, a relative folder or no outline binds nothing.
    expect(boundWorkspaceOf(bound, '/home/sam')).toBeNull()
    expect(boundWorkspaceOf(bound, '/work/garden-other')).toBeNull()
    expect(boundWorkspaceOf('{"bound":true,"folder":"garden","outline":"garden"}', '/work/garden')).toBeNull()
    expect(boundWorkspaceOf('{"bound":true,"folder":"/work/garden"}', '/work/garden')).toBeNull()
    expect(boundWorkspaceOf('Unknown command', '/work/garden')).toBeNull()
    // A .ep0ch on another machine pins the machine too, so an inherited EP0CH_MACHINE never moves a write.
    const far = boundWorkspaceOf('{"bound":true,"folder":"/work/far","outline":"pie","machine":"box-a"}', '/work/far')
    expect(far).toEqual({ root: '/work/far', outline: 'pie', machine: 'box-a', pinned: true })
    expect(workspaceEnvOf(far!)).toEqual({ OUTLINER_WORKSPACE_ROOT: '/work/far', EP0CH_WS: 'pie', EP0CH_MACHINE: 'box-a' })
  })

  test("the session's workspace: opt-outs first, then the binding; strict mode lists only", async () => {
    const bound = { root: '/work/garden' }
    expect(sessionWorkspaceOf('/work/garden/src', 'folder', [], bound)).toEqual(bound)
    expect(sessionWorkspaceOf('/tmp/scratch', 'folder', [], null)).toBeNull()
    expect(sessionWorkspaceOf('/work/garden/src', 'folder', ['/work/garden/src'], bound)).toBeNull()
    expect(sessionWorkspaceOf('/work/garden/src', 'folder', ['/work'], bound)).toBeNull()
    expect(sessionWorkspaceOf('/work/garden/src', 'folder', ['/work/gard'], bound)).toEqual(bound)
    expect(sessionWorkspaceOf('/work/garden/src', 'allowlist', ['/work/garden'], null)).toEqual({ root: '/work/garden' })
    expect(sessionWorkspaceOf('/work/garden/src', 'allowlist', [], bound)).toBeNull()
  })

  test("a bound workspace's CLI environment pins the outline that bound it; a strict-mode one is the CLI's to resolve", async () => {
    expect(workspaceEnvOf({ root: '/work/garden' })).toEqual({ OUTLINER_WORKSPACE_ROOT: '/work/garden' })
    expect(workspaceEnvOf({ root: '/work/jam/notes', outline: 'jam-shelf', pinned: true }))
      .toEqual({ OUTLINER_WORKSPACE_ROOT: '/work/jam/notes', EP0CH_WS: 'jam-shelf', EP0CH_MACHINE: '' })
  })

  test('a session names its outline: a call, then EP0CH_WS with its machine, else nothing; the folder is only where runs start (PIE-756)', async () => {
    expect(namedWorkspaceOf('/tmp', { outline: 'gurgle' }, 'garden', 'far')).toEqual({ root: '/tmp', outline: 'gurgle', pinned: true, via: 'call' })
    expect(namedWorkspaceOf('/tmp', null, 'garden', 'far')).toEqual({ root: '/tmp', outline: 'garden', machine: 'far', pinned: true, via: 'env' })
    expect(namedWorkspaceOf('/tmp', null, ' garden ', '')).toEqual({ root: '/tmp', outline: 'garden', pinned: true, via: 'env' })
    expect(namedWorkspaceOf('/tmp', null, undefined, 'far')).toBeNull()
    expect(() => namedWorkspaceOf('/tmp', null, 'Not A Name', undefined)).toThrow('isn\'t an outline name')
    expect(() => namedWorkspaceOf('/tmp', null, 'garden', 'a b')).toThrow('isn\'t an ssh config name')
    expect(workspaceEnvOf(namedWorkspaceOf('/tmp', null, 'garden', 'far')!)).toEqual({ OUTLINER_WORKSPACE_ROOT: '/tmp', EP0CH_WS: 'garden', EP0CH_MACHINE: 'far' })
  })

  test('EP0CH_SOCKET beside EP0CH_WS is taken only when it is this machine\'s host socket (what an outline host gives @margin)', async () => {
    const home = '/home/someone'
    expect(sameHostSocket(undefined, undefined, undefined, home)).toBe(true)
    expect(sameHostSocket('/home/someone/outlines/.host/host.sock', '', undefined, home)).toBe(true)
    expect(sameHostSocket('/scratch/outlines/.host/host.sock', '', '/scratch/outlines/', home)).toBe(true)
    // A forward anywhere else could be another machine's host: refused, wherever it lives.
    expect(sameHostSocket('/tmp/remote.sock', '', undefined, home)).toBe(false)
    expect(sameHostSocket('/tmp/outlines/.host/host.sock', '', undefined, home)).toBe(false)
    expect(sameHostSocket('/home/someone/outlines/.remote/far.sock', '', undefined, home)).toBe(false)
    expect(sameHostSocket('/home/someone/outlines/.host/host.sock', 'far', undefined, home)).toBe(false)
    expect(sameHostSocket('/home/someone/outlines/.host/host.sock', '', undefined, undefined)).toBe(false)
  })
})
