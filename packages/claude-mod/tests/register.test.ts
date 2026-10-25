import type { On, ProcessRunInit, ProcessRunResult, TurnCompleteInput } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const result = (exitCode: number, stdout: string, stderr: string): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const WORKSPACE = '/work/outliner'

const HERDR_LISTING = JSON.stringify({
  result: {
    plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }],
  },
})

const ANSWER: TurnCompleteInput = {
  reason: 'answer',
  answer: 'Filed [[PIE-356]] under ((88476cef-3559-492e-85c3-2d6d31de882e)).',
  durationMs: 1200,
  isAborted: false,
  turnId: 'turn-1',
}

type Run = { argv: readonly string[]; init?: ProcessRunInit }

/** `bound-folder`'s answer: WORKSPACE's .ep0ch names an outline; every other folder is unbound. */
function boundToWorkspace(folder: string): string {
  return folder === WORKSPACE || folder.startsWith(`${WORKSPACE}/`)
    ? JSON.stringify({ bound: true, folder: WORKSPACE, configPath: `${WORKSPACE}/.ep0ch`, outline: 'garden' })
    : JSON.stringify({ bound: false, folder })
}

/**
 * A session in `cwd` whose host commands answer from `answer`, recording each.
 * `bound-folder` answers from `binding` and is recorded apart, in `bindings`.
 * `workspaces` is PI_OUTLINER_MENTIONS_WORKSPACES (an opt-out list in folder mode).
 */
function sessionIn(
  on: On,
  cwd: string | (() => string),
  answer: (run: Run) => ProcessRunResult | Promise<ProcessRunResult>,
  workspaces = '',
  env: Record<string, string> = {},
  binding: (folder: string) => ProcessRunResult = folder => result(0, `${boundToWorkspace(folder)}\n`, ''),
) {
  const runs: Run[] = []
  const bindings: Run[] = []
  const toasts: string[] = []
  const clock = mock.clock(on)
  mock.env(on, {
    PI_OUTLINER_MENTIONS_WORKSPACES: workspaces,
    HERDR_PANE_ID: 'w:p9',
    HERDR_TAB_ID: 'w:t1',
    HERDR_WORKSPACE_ID: 'w',
    ...env,
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own drawing of a reply, where the plugin leaves it.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ key: 'engine', children: Text({ children: e.props.text }) })
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ key: 'engine-prompt', children: Text({ children: e.props.text }) })
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: typeof cwd === 'function' ? cwd() : cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('process.run', async ($, e) => {
    // This machine's name, which a write's principal carries (claude-code@garden-host).
    if (e.argv[0] === 'hostname') return { value: result(0, 'garden-host\n') }
    if (e.argv.includes('bound-folder')) {
      bindings.push(e)
      return { value: binding(e.argv.at(-1)!) }
    }
    runs.push(e)
    return { value: await answer(e) }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  /**
   * Starts the session and lets its reference context load, then forgets
   * those runs: what a test records is its own turn's or click's.
   */
  async function begin(start: () => Promise<unknown>) {
    await start()
    await clock.settle()
    runs.length = 0
    bindings.length = 0
    toasts.length = 0
  }
  /** The runs after the session's workspace was found: its Herdr discovery is dropped. */
  const delivered = () => runs.slice(1)
  return { runs, bindings, toasts, clock, begin, delivered }
}

const START = { surface: 'terminal', isInteractive: true, cwd: WORKSPACE } as const

const BLOCK = '11111111-2222-4333-8444-555555555555'

/** A session outside Herdr: a door tile drops Herdr's pane variables, and a plain terminal never had them. */
const NOT_IN_HERDR = { HERDR_PANE_ID: '', HERDR_TAB_ID: '', HERDR_WORKSPACE_ID: '' }

/** A reply drawn with its references as links. */
function mountReply($: { ui: { mount: (init: any) => Promise<any> } }, text: string) {
  return $.ui.mount({ plugin: 'ep0ch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
}

/** The Outliner's Herdr opens the mod ran (`src/herdr-open.ts`), by mode: the one Detail finder. */
function herdrOpens(runs: readonly Run[], mode?: 'ensure-detail' | 'find-detail') {
  return runs.filter(run => run.argv[2]?.endsWith('/src/herdr-open.ts') && (!mode || run.argv.includes(mode)))
}

/** What ensure-detail answers: the admin Detail linked to the Tree beside Claude, reused (`opened: false`). */
const ENSURED = JSON.stringify({ treePane: 'w:p1', detailPane: 'w:p2', detailClientId: 'admin-detail', opened: false, outline: 'garden' })

function succeeding(run: Run): ProcessRunResult {
  const ok = (stdout: string) => result(0, stdout, '')
  if (run.argv[0] === 'herdr') {
    return ok(run.argv[2] === 'pane' ? '{"result":{"plugin_pane":{"pane":{"pane_id":"w:p10"}}}}' : HERDR_LISTING)
  }
  if (run.argv.includes('resolve')) return run.argv.includes('--session')
    ? result(1, '', 'error: resolve requires one pi-outliner URL')
    : ok(`{"id":"${BLOCK}","title":"Daily notes"}`)
  if (run.argv.includes('work-id-status')) return ok('{"prefix":"PIE","observedPrefixes":["PIE","OLD"]}')
  if (herdrOpens([run]).length) return ok(`${run.argv.includes('find-detail') ? JSON.stringify({ detailClientId: 'admin-detail', detailPane: 'w:p2' }) : ENSURED}\n`)
  if (run.argv.includes('link')) return ok('{"kind":"page","title":"Daily notes"}')
  return ok('{"references":2}')
}

describe('register', () => {
  test('a bound folder: the answer is ingested into its outline after the turn', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))

    const { text } = await $.turn.complete(ANSWER)
    await session.clock.settle()

    expect(text).toBe(ANSWER.answer)
    // The CLI says which folder is bound, from the session's cwd up; nothing is guessed here.
    expect(session.bindings.map(run => [run.argv.slice(3), run.init?.cwd, run.init?.env])).toEqual([[['bound-folder', WORKSPACE], WORKSPACE, undefined]])
    // The ingest, then the Recent mentions band reads the list again: this conversation's, as Tree's `s` scopes it.
    // Then, in Herdr, the Outliner's find-detail says whether a Detail is beside Claude, for the heading.
    expect(session.delivered().map(run => run.argv[0])).toEqual(['herdr', '/bin/sh', 'herdr', '/bin/sh', 'herdr', '/bin/sh'])
    expect(session.delivered()[5]!.argv.slice(2)).toEqual(['/opt/outliner/src/herdr-open.ts', '--mode', 'find-detail'])
    expect(session.delivered()[3]!.argv.slice(3)).toEqual(['mentions', 'list', '--limit', '9', '--agent', 'claude', '--session', 'session-1'])
    const ingest = session.delivered()[1]!
    expect(ingest.argv.slice(1)).toEqual([
      '/opt/outliner/scripts/run-bun.sh',
      '/opt/outliner/src/cli.ts',
      'mentions',
      'ingest',
    ])
    expect(ingest.init?.cwd).toBe(WORKSPACE)
    expect(ingest.init?.env).toEqual({ OUTLINER_WORKSPACE_ROOT: WORKSPACE, EP0CH_WS: 'garden', EP0CH_MACHINE: '' })
    expect(JSON.parse(ingest.init?.stdin ?? '')).toEqual({
      workspaceRoot: WORKSPACE,
      agent: 'claude',
      sessionId: 'session-1',
      messageId: 'turn-1',
      text: ANSWER.answer,
    })
    expect(session.toasts).toEqual([])
  })

  test('a nested folder feeds its nearest binding, the folder the CLI names', async ($, on) => {
    const nested = `${WORKSPACE}/projects/mod`
    // projects/ has a binding of its own (to another outline), nearer than the workspace's.
    const session = sessionIn(on, `${nested}/src`, succeeding, '', {}, folder =>
      result(0, folder.startsWith(`${nested}/`) ? `{"bound":true,"folder":"${nested}","outline":"mod-notes"}` : boundToWorkspace(folder), ''))
    await session.begin(() => $.session.start({ ...START, cwd: `${nested}/src` }))
    await $.turn.complete(ANSWER)
    await session.clock.settle()
    const ingest = session.delivered()[1]!
    expect(ingest.init?.cwd).toBe(nested)
    expect(ingest.init?.env).toEqual({ OUTLINER_WORKSPACE_ROOT: nested, EP0CH_WS: 'mod-notes', EP0CH_MACHINE: '' })
    expect(JSON.parse(ingest.init?.stdin ?? '').workspaceRoot).toBe(nested)
  })

  test('an unbound folder: nothing is ingested, nothing linked, and no outline is guessed or defaulted', async ($, on) => {
    const session = sessionIn(on, '/home/sam/scratch', succeeding)
    await session.begin(() => $.session.start({ ...START, cwd: '/home/sam/scratch' }))

    await $.turn.complete(ANSWER)
    await session.clock.settle()

    expect(session.bindings.map(run => run.argv.at(-1))).toEqual(['/home/sam/scratch'])
    // Only Herdr's discovery of the CLI ran: no ingest, no work-id-status, nothing addressed to an outline.
    expect(session.runs.map(run => run.argv[0])).toEqual(['herdr'])
    expect(session.toasts).toEqual([])
    const drawn = await mountReply($, 'See PIE-7 and [[Daily notes]].')
    expect(await drawn.find({ key: 'outliner-references' })).toBeUndefined()
  })

  test('an answer the CLI binds outside the session folder is not trusted', async ($, on) => {
    const session = sessionIn(on, '/home/sam/scratch', succeeding, '', {}, () =>
      result(0, `{"bound":true,"folder":"${WORKSPACE}","outline":"garden"}`, ''))
    await session.begin(() => $.session.start({ ...START, cwd: '/home/sam/scratch' }))
    await $.turn.complete(ANSWER)
    await session.clock.settle()
    expect(session.runs.filter(run => run.argv.includes('ingest'))).toEqual([])
  })

  for (const listed of [`${WORKSPACE}/`, `/elsewhere,${WORKSPACE}/projects`]) {
    test(`an opted-out folder (${listed}): nothing is ingested, and its binding is never asked for`, async ($, on) => {
      const cwd = `${WORKSPACE}/projects/mod`
      const session = sessionIn(on, cwd, succeeding, listed, { PI_OUTLINER_MENTIONS_MODE: 'folder' })
      await session.begin(() => $.session.start({ ...START, cwd }))
      await $.turn.complete(ANSWER)
      await session.clock.settle()
      expect(session.bindings).toEqual([])
      expect(session.runs).toEqual([])
      const drawn = await mountReply($, 'See PIE-7.')
      expect(await drawn.find({ key: 'outliner-references' })).toBeUndefined()
    })
  }

  test('a sibling of an opted-out folder is not opted out', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding, `${WORKSPACE}-other`, { PI_OUTLINER_MENTIONS_MODE: 'folder' })
    await session.begin(() => $.session.start(START))
    await $.turn.complete(ANSWER)
    await session.clock.settle()
    expect(session.runs.filter(run => run.argv.includes('ingest'))).toHaveLength(1)
  })

  test('strict allowlist mode: only listed folders feed, bound or not, as before folder mode', async ($, on) => {
    const listed = '/work/listed'
    const session = sessionIn(on, `${listed}/src`, succeeding, `${listed}/`, { PI_OUTLINER_MENTIONS_MODE: 'allowlist' })
    await session.begin(() => $.session.start({ ...START, cwd: `${listed}/src` }))
    await $.turn.complete(ANSWER)
    await session.clock.settle()
    // The listed folder needs no binding; bound-folder is never run.
    expect(session.bindings).toEqual([])
    expect(session.runs.map(run => run.argv[0])).toEqual(['herdr', '/bin/sh', 'herdr', '/bin/sh', 'herdr', '/bin/sh'])
    const ingest = session.runs[1]!
    expect(ingest.init?.cwd).toBe(listed)
    expect(ingest.init?.env).toEqual({ OUTLINER_WORKSPACE_ROOT: listed })
  })

  test('a list with no mode is a legacy allowlist: an unlisted bound folder feeds nothing, and the tools still work', async ($, on) => {
    {
      const cwd = WORKSPACE
      const session = sessionIn(on, cwd, succeeding, `${WORKSPACE}-listed`)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start({ ...START, cwd }))
      await $.turn.complete(ANSWER)
      await session.clock.settle()
      expect(JSON.stringify(session.runs)).not.toContain('ingest')
      expect(session.toasts.join(' ')).not.toContain('PI_OUTLINER_MENTIONS_MODE')
      const called = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'doing' })
      expect(String((called as { deny?: string }).deny ?? '')).not.toContain('No Outliner outline')
    }
  })

  test("a remote socket in Claude's environment: nothing is fed, and it says why once", async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding, '', { EP0CH_SOCKET: '/elsewhere/host.sock' })
    await session.begin(() => $.session.start(START))
    await $.turn.complete(ANSWER)
    await $.turn.complete({ ...ANSWER, turnId: 'turn-2' })
    await session.clock.settle()
    expect(session.bindings).toEqual([])
    expect(session.runs).toEqual([])
    expect(session.toasts).toHaveLength(1)
    expect(session.toasts[0]).toContain('EP0CH_SOCKET')
  })

  test('strict allowlist mode: a bound folder that is not listed feeds nothing', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding, '/work/listed', { PI_OUTLINER_MENTIONS_MODE: 'allowlist' })
    await session.begin(() => $.session.start(START))
    await $.turn.complete(ANSWER)
    await session.clock.settle()
    expect(session.bindings).toEqual([])
    expect(session.runs).toEqual([])
  })

  test('an unknown mode is one toast, and nothing is ingested', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding, '', { PI_OUTLINER_MENTIONS_MODE: 'everywhere' })
    await session.begin(() => $.session.start(START))
    await $.turn.complete(ANSWER)
    await $.turn.complete({ ...ANSWER, turnId: 'turn-2' })
    await session.clock.settle()
    expect(session.runs).toEqual([])
    expect(session.toasts).toEqual(['Outliner recent mentions unavailable: Outliner mentions mode "everywhere" is neither folder nor allowlist'])
  })

  test('an Outliner older than bound-folder feeds nothing and says so once', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding, '', {}, () =>
      result(1, '', '1016 |     throw new Error(`Unknown command: ${command}`);\nerror: Unknown command: bound-folder\n      at cli.ts:1016:15\n\nBun v1.4.2 (Linux x64)'))
    await session.begin(() => $.session.start(START))
    await $.turn.complete(ANSWER)
    await $.turn.complete({ ...ANSWER, turnId: 'turn-2' })
    await session.clock.settle()
    expect(session.runs.filter(run => run.argv.includes('ingest'))).toEqual([])
    expect(session.toasts).toEqual([
      "Outliner recent mentions unavailable: the installed Outliner is too old to find this folder's outline (no bound-folder); update it",
    ])
  })

  test('subagent, interrupted and empty turns are not ingested', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))

    await $.turn.complete({ ...ANSWER, agentId: 'agent-1' })
    await $.turn.complete({ ...ANSWER, reason: 'aborted', isAborted: true })
    await $.turn.complete({ ...ANSWER, answer: '  ' })
    await session.clock.settle()

    expect(session.runs).toEqual([])
    expect(session.bindings).toEqual([])
  })

  test('a disabled Outliner plugin is skipped quietly', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, () =>
      result(0, HERDR_LISTING.replace('"enabled":true', '"enabled":false'), ''))
    await session.begin(() => $.session.start(START))

    await $.turn.complete(ANSWER)
    await session.clock.settle()

    // The CLI is never asked for the folder's binding, nor anything else.
    expect(session.runs.map(run => run.argv[0])).toEqual(['herdr'])
    expect(session.bindings).toEqual([])
    expect(session.toasts).toEqual([])
  })

  test('an unreachable service leaves the answer and shows one toast', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, run =>
      run.argv[0] === 'herdr'
        ? succeeding(run)
        : result(1, '', 'trace\nerror: connect ENOENT outliner.sock'),
    )
    await session.begin(() => $.session.start(START))

    const { text } = await $.turn.complete(ANSWER)
    await session.clock.settle()

    expect(text).toBe(ANSWER.answer)
    expect(session.toasts).toEqual([
      'Outliner recent mentions unavailable: mentions ingest failed: connect ENOENT outliner.sock',
    ])
  })

  test('an invalid workspaces entry is one toast, and nothing is ingested or bound by name', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding, `${WORKSPACE}=fred`)
    await session.begin(() => $.session.start(START))

    const { text } = await $.turn.complete(ANSWER)
    await session.clock.settle()

    expect(text).toBe(ANSWER.answer)
    expect(session.runs.filter(run => run.argv.includes('ingest'))).toEqual([])
    expect(session.toasts).toEqual([
      `Outliner recent mentions unavailable: Outliner workspaces entry "${WORKSPACE}=fred" is not an absolute folder; list folders only, and name a folder's outline in its .ep0ch (ep0ch init)`,
    ])
  })

  test('Outliner references in a reply are drawn as their labels, never an address; other replies are left to the engine', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))

    const drawn = await mountReply($, [
      'Filed PIE-356 and OLD-2 beside `PIE-1`, then PIE-7.',
      `Read https://my.ep0ch.sh/pub/p/PIE-8, https://my.ep0ch.sh/pub/p/Daily%20notes. and https://example.com/x.`,
      'And [the ticket](https://my.ep0ch.sh/pub/p/PIE-9?x=1) or [more](https://example.com/more).',
    ].join('\n'))
    const shown = (await drawn.find({ type: 'Box' }))?.text ?? ''
    expect(shown).not.toMatch(/pi-outliner\.invalid|my\.ep0ch\.sh/)
    expect(shown).toContain('Filed PIE-356 and OLD-2 beside PIE-1, then PIE-7.')
    expect(shown).toContain('Read PIE-8, Daily notes. and ')
    // A link to another site is a Link out (PIE-1043, below); one to my.ep0ch.sh is its label.
    expect(shown).toContain('And the ticket or ')
    expect((await drawn.findAll({ type: 'Link' })).find(l => l.props.href === 'https://example.com/more')).toBeDefined()
    // Every reference is a pressable label; no line is left to Markdown, whose links would print their address.
    for (const label of ['PIE-356', 'OLD-2', 'PIE-7', 'PIE-8', 'Daily notes', 'the ticket']) {
      expect(await drawn.find({ type: 'Text', text: label })).toBeDefined()
    }
    expect(await drawn.find({ type: 'Markdown' })).toBeUndefined()

    // A line with no reference stays the engine's Markdown.
    const mixed = await mountReply($, 'Plain **line** first.\nThen PIE-3 here.')
    expect((await mixed.find({ type: 'Markdown' }))?.props.text).toBe('Plain **line** first.')
    expect(((await mixed.find({ type: 'Box' }))?.text ?? '')).not.toContain('pi-outliner.invalid')

    await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-8' })
    await session.clock.settle()
    expect(session.runs.find(run => run.argv.includes('link'))?.argv.slice(3, 5)).toEqual(['link', 'pi-outliner://work/PIE-8'])

    const plain = await $.ui.mount({
      plugin: 'ep0ch',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: 'Nothing to link here.', isFirstOfReply: true },
    })
    expect(await plain.find({ key: 'outliner-references' })).toBeUndefined()
    expect((await plain.find({ key: 'engine' }))?.text).toBe('Nothing to link here.')
  })

  test('prompt references draw as labels without replacing the prompt (PIE-1054)', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))
    const drawn = await $.ui.mount({
      plugin: 'ep0ch', surface: 'terminal', component: 'UserMessage',
      props: { text: `See [[Daily notes]], ((${BLOCK})), ((${BLOCK}|the note)), PIE-7, https://my.ep0ch.sh/pub/p/PIE-8 and https://example.com/docs.`, origin: { kind: 'composer' }, isExpanded: false, onScreen: null },
    })
    await session.clock.settle()
    for (const [key, label] of [
      ['https://pi-outliner.invalid/page/Daily%20notes', 'Daily notes'],
      [`https://pi-outliner.invalid/block/${BLOCK}`, 'Daily notes'],
      [`https://pi-outliner.invalid/block/${BLOCK}#2`, 'the note'],
      ['https://pi-outliner.invalid/work/PIE-7', 'PIE-7'],
      ['https://pi-outliner.invalid/work/PIE-8', 'PIE-8'],
    ]) {
      expect((await drawn.find({ key }))?.text).toBe(label)
    }
    expect(await drawn.find({ text: /https:\/\/example\.com\/docs/ })).toBeDefined()
    const row = await drawn.find({ type: 'Box' })
    expect(row?.text).toContain('\u276f See ')
    expect(row?.props.backgroundColor).toBe('userMessageBackground')
    await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
    await session.clock.settle()
    expect(session.runs.find(run => run.argv.includes('link'))?.argv.slice(3, 5)).toEqual(['link', 'pi-outliner://work/PIE-7'])
  })

  test('prompts with attachments or no references and other user rows stay with the engine', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))
    for (const props of [
      { text: 'Nothing to link here.' },
      { text: 'See https://example.com/docs.' },
      { text: 'See PIE-7 and [Image #1]' },
      { text: 'See PIE-7 and [Image]' },
      { text: 'See PIE-7 and [Pasted text #2 +30 lines]' },
      { text: 'See PIE-7 and [...Truncated text #2 +30 lines...]' },
      { text: 'See PIE-7', isExpanded: true },
      { text: 'See PIE-7', origin: { kind: 'bridge' as const } },
      { text: 'See PIE-7', from: { name: 'helper' } },
      { text: 'See PIE-7', task: { id: 'task-1', status: 'completed' as const } },
    ]) {
      const drawn = await $.ui.mount({
        plugin: 'ep0ch', surface: 'terminal', component: 'UserMessage',
        props: { origin: { kind: 'composer' }, isExpanded: false, ...props },
      })
      expect((await drawn.find({ key: 'engine-prompt' }))?.text).toBe(props.text)
    }
  })

  test('an unaliased ((id)) draws as its short id, then as the note title once looked up, and still opens (PIE-1043)', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, `See ((${BLOCK})) here.`)
    expect((await drawn.find({ type: 'Box' }))?.text ?? '').toContain(`See ${BLOCK.slice(0, 8)}… here.`)
    await session.clock.settle()
    expect((await drawn.find({ type: 'Box' }))?.text ?? '').toContain('See Daily notes here.')
    expect((await drawn.find({ type: 'Box' }))?.text ?? '').not.toContain(BLOCK)
    await drawn.press({ key: `https://pi-outliner.invalid/block/${BLOCK}` })
    await session.clock.settle()
    expect(session.runs.find(run => run.argv.includes('link'))?.argv.slice(3, 5)).toEqual(['link', `pi-outliner://block/${BLOCK}`])
  })

  test('a web note link recovers its title after failed lookups, with backoff and a late redraw (PIE-1130)', async ($, on) => {
    let attempts = 0
    let land: ((value: ProcessRunResult) => void) | undefined
    const session = sessionIn(on, WORKSPACE, run => {
      if (!run.argv.includes('resolve')) return succeeding(run)
      attempts++
      if (attempts <= 3) return result(1, '', 'error: connect ENOENT host.sock')
      return new Promise<ProcessRunResult>(resolve => { land = resolve })
    })
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, `See https://my.ep0ch.sh/pub/p/${BLOCK} here.`)
    expect((await drawn.find({ type: 'Box' }))?.text).toContain(`See ${BLOCK.slice(0, 8)}… here.`)
    await session.clock.settle()
    for (const delay of [2000, 10_000, 60_000]) {
      const before = attempts
      await session.clock.advance(delay - 1)
      expect(attempts).toBe(before)
      await session.clock.advance(1)
      expect(attempts).toBe(before + 1)
    }
    expect((await drawn.find({ type: 'Box' }))?.text).toContain(`${BLOCK.slice(0, 8)}…`)
    land!(result(0, JSON.stringify({ id: BLOCK, title: 'Daily notes', outline: 'garden' }), ''))
    await session.clock.settle()
    expect((await drawn.find({ type: 'Box' }))?.text).toContain('See Daily notes here.')
    await session.clock.advance(60_000)
    expect(attempts).toBe(4)
  })

  test('an external link in a reply is a dim Link with a CP437 marker, apart from the underlined references that open in the door (PIE-1043)', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, 'Read [the docs](https://example.com/a) and https://example.com/b. Also `https://example.com/c` and PIE-7.\n\nOnly [a link](https://example.com/d) here.')
    const shown = (await drawn.find({ type: 'Box' }))?.text ?? ''
    expect(shown).not.toMatch(/\]\(|pi-outliner\.invalid/)
    expect(shown).toContain('. Also https://example.com/c and PIE-7.')
    // A bare URL is text: Link's fallback would print the same address a second time.
    const links = await drawn.findAll({ type: 'Link' })
    const link = async (href: string) => links.find(l => l.props.href === href)
    expect((await link('https://example.com/a'))?.text).toContain('the docs »')
    expect(shown.split('https://example.com/b').length - 1).toBe(1)
    expect((await drawn.find({ type: 'Text', text: 'https://example.com/b' }))?.props.color).toBe('inactive')
    expect((await link('https://example.com/d'))?.text).toContain('a link »')
    expect((await drawn.find({ type: 'Text', text: '»' }))?.props.color ?? (await drawn.find({ type: 'Text', text: ' »' }))?.props.color).toBe('inactive')
    expect(await link('https://example.com/a')).toBeDefined()
    expect(await link('https://example.com/b')).toBeUndefined()
    expect(await link('https://example.com/c')).toBeUndefined()
    expect(await link('https://example.com/d')).toBeDefined()
    // The internal reference is still a pressable, underlined Button, never a Link.
    expect(await drawn.find({ key: 'https://pi-outliner.invalid/work/PIE-7' })).toBeDefined()
  })

  test('a bold line and a table with references are drawn as bold and a whole table, their references pressable (PIE-1043)', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, '**A bold line with PIE-1030 inside it**\n\n| Ticket | What |\n| --- | --- |\n| PIE-1031 | argument forms |\n| PIE-1032 | more |')
    const shown = (await drawn.find({ type: 'Box' }))?.text ?? ''
    expect(shown).not.toContain('**')
    expect(shown).not.toMatch(/\| PIE-1031|\| PIE-1032/)
    expect(shown).toContain('Ticket')
    expect(shown).toContain('argument forms')
    expect(await drawn.find({ key: 'https://pi-outliner.invalid/work/PIE-1031' })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: 'bold ', bold: true })).toBeDefined()
    await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-1032' })
    await session.clock.settle()
    expect(session.runs.find(run => run.argv.includes('link'))?.argv.slice(3, 5)).toEqual(['link', 'pi-outliner://work/PIE-1032'])
  })

  test('clicking a reference shows it in the Outliner Detail beside Claude, found by ensure-detail, without focus', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, 'See [[Daily notes]].')

    await drawn.press({ key: 'https://pi-outliner.invalid/page/Daily%20notes' })
    await session.clock.settle()

    // The Outliner's own ensure-detail, from Claude's pane, in the session's workspace, never focusing.
    const [ensure] = herdrOpens(session.runs, 'ensure-detail')
    expect(ensure?.argv).toEqual(['/bin/sh', '/opt/outliner/scripts/run-bun.sh', '/opt/outliner/src/herdr-open.ts', '--mode', 'ensure-detail', '--no-focus'])
    expect(ensure?.init?.cwd).toBe(WORKSPACE)
    expect(ensure?.init?.env).toMatchObject({ OUTLINER_WORKSPACE_ROOT: WORKSPACE, OUTLINER_OPEN_WORKSPACE_ROOT: WORKSPACE, HERDR_ENV: '1' })
    // The existing admin Detail is navigated, without focus; the mod opens and focuses no pane of its own.
    const link = session.runs.find(run => run.argv.includes('link'))
    expect(link?.argv.slice(3)).toEqual(['link', 'pi-outliner://page/Daily%20notes', '--detail-client', 'admin-detail', '--no-focus'])
    expect(link?.init?.cwd).toBe(WORKSPACE)
    expect(session.runs.filter(run => run.argv[0] === 'herdr' && run.argv[1] !== 'plugin')).toEqual([])
    expect(session.runs.some(run => run.argv.includes('focus'))).toBe(false)
    expect(session.toasts).toEqual([])
  })

  test('with no Detail beside Claude, ensure-detail opens one (unfocused) and the click shows it there', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, run => herdrOpens([run], 'ensure-detail').length
      ? result(0, JSON.stringify({ treePane: 'w:p10', detailPane: 'w:p11', detailClientId: 'opened-detail', opened: true }), '')
      : succeeding(run))
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, 'See PIE-7.')

    await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
    await session.clock.settle()

    expect(herdrOpens(session.runs, 'ensure-detail')).toHaveLength(1)
    expect(herdrOpens(session.runs, 'ensure-detail')[0]!.argv).toContain('--no-focus')
    expect(session.runs.find(run => run.argv.includes('link'))?.argv.slice(3)).toEqual(['link', 'pi-outliner://work/PIE-7', '--detail-client', 'opened-detail', '--no-focus'])
    expect(session.runs.some(run => run.argv.includes('focus'))).toBe(false)
    expect(session.toasts).toEqual([])
  })

  test('a Detail beside Claude that is mid-edit is a toast; nothing else is opened', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, run =>
      run.argv.includes('link')
        ? result(1, '', 'error: Destination is protected: active edit\nBun v1.3.14 (Linux x64)')
        : succeeding(run))
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, 'See PIE-7.')

    await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
    await session.clock.settle()

    expect(herdrOpens(session.runs, 'ensure-detail')).toHaveLength(1)
    expect(session.toasts).toEqual(['Could not open PIE-7 in the Outliner: the Outliner Detail beside you is mid-edit; finish or cancel it there'])
  })

  test("ensure-detail's refusal (two Trees in the tab) is the toast", async ($, on) => {
    const session = sessionIn(on, WORKSPACE, run => herdrOpens([run], 'ensure-detail').length
      ? result(1, '', 'Outliner could not open: Multiple live Tree clients are registered in tab w:t1\n')
      : succeeding(run))
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, 'See PIE-7.')

    await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
    await session.clock.settle()

    expect(session.runs.some(run => run.argv.includes('link'))).toBe(false)
    expect(session.toasts).toEqual(['Could not open PIE-7 in the Outliner: Multiple live Tree clients are registered in tab w:t1'])
  })

  test('a click and a show call at once run one after the other: the Detail the first opened is the one the second reuses', async ($, on) => {
    let opened = false
    const order: string[] = []
    // ensure-detail takes a while: two at once would interleave their start and end.
    const session = sessionIn(on, WORKSPACE, async run => {
      if (!herdrOpens([run], 'ensure-detail').length) return succeeding(run)
      order.push('start')
      await new Promise(resolve => setTimeout(resolve, 30))
      order.push('end')
      const answer = JSON.stringify({ detailClientId: 'new-detail', opened: !opened })
      opened = true
      return result(0, answer, '')
    })
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start(START))
    const drawn = await mountReply($, 'See PIE-7.')

    await Promise.all([
      drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' }),
      $.tool.call({ tool: 'mcp__ep0ch__show', reference: 'PIE-8' }),
    ])
    await session.clock.settle()

    expect(order).toEqual(['start', 'end', 'start', 'end'])
    expect(session.runs.filter(run => run.argv.includes('link')).map(run => run.argv.at(-2))).toEqual(['new-detail', 'new-detail'])
  })

  test('the show tool puts a reference in the Outliner Detail beside Claude and reports it', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, succeeding)
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start(START))

    const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
    expect(shown).toMatchObject({ result: 'Showing Daily notes in the Outliner Detail beside you.' })
    expect(session.runs.find(run => run.argv.includes('link'))?.argv).toContain('admin-detail')

    const empty = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: ' ' })
    expect(empty.deny).toContain('Give the ref')
  })

  describe("a Claude that does not descend from a tile reaches its folder's door (PIE-715)", () => {
    const SOCK = '/state/sessions/local/garden/door.sock'
    const whereJson = (reach: object, door: object | null) => JSON.stringify({
      inDoor: false, reach, here: { machine: 'garden-host', folder: WORKSPACE, persona: null }, herdr: { pane: 'w1:p2P', label: null, agent: false }, door,
    })
    const FOLDER = whereJson(
      { rule: 'folder', text: "reached garden's door session by folder; you are not in a tile of it, so your keys are not the person's" },
      { answers: true, control: SOCK, outline: 'garden', machine: null, host: null, tile: null, stale: null },
    )
    const NONE = whereJson({ rule: 'none', text: 'no door runs on garden · `ep0ch --ws garden` starts one' }, null)
    const answering = (where: string) => (run: Run) =>
      run.argv[0] === 'ep0ch' && run.argv[1] === 'where' ? result(0, where, '') : succeeding(run)
    // A stale Herdr pane id and no EP0CH_CONTROL: a background job from systemd.
    const STALE = { HERDR_PANE_ID: 'w1:p2P', EP0CH_CONTROL: '' }

    test('the door tools are offered, and act on the door `ep0ch where` found, in the session\'s folder', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering(FOLDER), '', STALE)
      const registered: string[] = []
      on('tool.register', ($, e) => { registered.push(e.name); return { value: { tool: `mcp__ep0ch__${e.name}` } } })
      await session.begin(() => $.session.start(START))
      expect(registered).toEqual(expect.arrayContaining(['door_where', 'door_peek', 'door_act', 'door_open']))

      const peeked = await $.tool.call({ tool: 'mcp__ep0ch__door_peek' })
      expect(peeked.deny).toBeUndefined()
      const run = session.runs.find(r => r.argv[1] === 'peek')!
      expect(run.init?.env?.EP0CH_CONTROL).toBe(SOCK)
      expect(run.init?.cwd).toBe(WORKSPACE)
    })

    test('with no door running the tools are not offered, and a call says why with the command that starts one', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering(NONE), '', STALE)
      const registered: string[] = []
      on('tool.register', ($, e) => { registered.push(e.name); return { value: { tool: `mcp__ep0ch__${e.name}` } } })
      await session.begin(() => $.session.start(START))
      expect(registered.some(name => name.startsWith('door_'))).toBe(false)
      const called = await $.tool.call({ tool: 'mcp__ep0ch__door_peek' })
      expect(called.deny).toContain('`ep0ch --ws garden` starts one')
    })
  })

  describe('a press on a reference in a reply follows the door that answers (PIE-1043)', () => {
    const LIVE = '/state/sessions/local/garden/door.sock'
    const STALE_SOCK = '/state/old/agent-door-claude.sock'
    const where = (reach: object, door: object | null) => JSON.stringify({ inDoor: false, reach, here: { machine: 'garden-host', folder: WORKSPACE, persona: null }, herdr: { pane: 'w1:p2P', label: null, agent: false }, door })
    const FOUND = where({ rule: 'folder', text: "reached garden's door session by folder" }, { answers: true, control: LIVE, outline: 'garden', machine: null, host: null, tile: null, stale: null })
    const MISSING = where({ rule: 'none', text: 'no door runs on garden · `ep0ch --ws garden` starts one' }, null)
    // A door that answers only on its live socket; any other socket is gone (exit 3).
    const answers = (whereOut: string) => (run: Run) => {
      if (run.argv[0] === 'ep0ch' && run.argv[1] === 'where') return result(0, whereOut, '')
      if (run.argv.includes('door-open')) {
        return run.argv[run.argv.indexOf('--control') + 1] === LIVE ? result(0, '{"tile":"t-fixture","name":"centre","id":"x"}\n', '') : result(3, '', 'error: no door at it (ECONNREFUSED)\n')
      }
      return succeeding(run)
    }
    for (const [name, control] of [['a Claude with no EP0CH_CONTROL at all', ''], ['a stale EP0CH_CONTROL', STALE_SOCK]] as const) {
      test(`${name}: the press opens in the door \`ep0ch where\` found, not the mentions pane`, async ($, on) => {
        const session = sessionIn(on, WORKSPACE, answers(FOUND), '', { ...NOT_IN_HERDR, EP0CH_CONTROL: control })
        on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
        await session.begin(() => $.session.start(START))
        const drawn = await mountReply($, 'See [[Daily notes]].')
        await drawn.press({ key: 'https://pi-outliner.invalid/page/Daily%20notes' })
        await session.clock.settle()
        const opened = session.runs.find(run => run.argv.includes('door-open'))!
        expect(opened.argv[opened.argv.indexOf('--control') + 1]).toBe(LIVE)
        expect(session.toasts).toEqual([])
      })
    }

    for (const [name, json, expected] of [
      ['opens from the tile the door finds for its ssh connection', '{"tile":"claude","id":"t3","by":"port"}', ['--from', 'claude']],
      ['opens where the screen\'s opens land, silently, when the door finds no tile', '{"tile":null,"id":null,"by":null}', []],
    ] as const) {
      test(`a Claude that came in over ssh (no tile variables) ${name}`, async ($, on) => {
        const asked: string[][] = []
        const session = sessionIn(on, WORKSPACE, run => {
          if (run.argv[1] === 'act') { asked.push(run.argv); return result(0, json, '') }
          return answers(FOUND)(run)
        }, '', { ...NOT_IN_HERDR, EP0CH_CONTROL: '', SSH_CONNECTION: '10.0.0.2 51234 10.0.0.3 22' })
        on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
        await session.begin(() => $.session.start(START))
        const drawn = await mountReply($, 'See [[Daily notes]].')
        await drawn.press({ key: 'https://pi-outliner.invalid/page/Daily%20notes' })
        await session.clock.settle()
        expect(asked[0]!.slice(0, 4)).toEqual(['ep0ch', 'act', 'host.tileOf', 'port=51234'])
        const opened = session.runs.find(run => run.argv.includes('door-open'))!
        expect(opened.argv.slice(opened.argv.indexOf('--actor') + 2)).toEqual(expected)
        expect(session.toasts).toEqual([])
      })
    }

    test('with no door answering the toast says so, with the command that starts one', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answers(MISSING), '', { ...NOT_IN_HERDR, EP0CH_CONTROL: STALE_SOCK })
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      on('ui.open', () => ({ value: { isPlaced: false, reason: 'opened unasked under 144 columns (120 now)' } }))
      await session.begin(() => $.session.start(START))
      const drawn = await mountReply($, 'See [[Daily notes]].')
      await drawn.press({ key: 'https://pi-outliner.invalid/page/Daily%20notes' })
      await session.clock.settle()
      expect(session.toasts.join('\n')).toContain('no door runs on garden')
    })
  })

  describe('in neither a door nor Herdr: the note opens here, in the mentions pane (openNote\'s third case)', () => {
    const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa'
    const CHILD = '77777777-8888-4999-8aaa-bbbbbbbbbbbb'
    const DETAIL = 'outliner-mentions'
    const ok = (stdout: string) => result(0, stdout, '')
    /** Two notes: Daily notes (a child linking [[Other page]] and PIE-7) and Other page. */
    const SUBTREES: Record<string, unknown[]> = {
      [BLOCK]: [
        { id: BLOCK, parentId: null, position: 0, depth: 0, text: 'Daily notes\n[type::note]\n## Today\n- rode to the shed' },
        { id: CHILD, parentId: BLOCK, position: 0, depth: 1, text: 'Bring the [[Other page]] list, see PIE-7' },
      ],
      [OTHER]: [{ id: OTHER, parentId: null, position: 0, depth: 0, text: 'Other page\nThe chain oil is the wax one.' }],
    }
    /** The export of each note: front matter, the body, children as nested lists (as `ep0ch export --children` prints it). */
    const EXPORTED: Record<string, string> = {
      [BLOCK]: `---\nid: "${BLOCK}"\nauthor: "user"\n---\nDaily notes\n[type::note]\n## Today\n- rode to the shed\n\n- Bring the [[Other page]] list, see PIE-7\n`,
      [OTHER]: `---\nid: "${OTHER}"\n---\nOther page\nThe chain oil is the wax one.\n`,
    }
    /** The installed Outliner and ep0ch, answering for the two notes; `export: false` is an ep0ch older than export. */
    function answering(options: { export?: boolean; cells?: boolean } = {}) {
      return (run: Run): ProcessRunResult => {
        if (run.argv.includes('resolve')) {
          const uri = run.argv.at(-1)!
          return ok(uri.includes('Other') || uri.includes(OTHER) ? `{"id":"${OTHER}","title":"Other page"}` : `{"id":"${BLOCK}","title":"Daily notes"}`)
        }
        if (run.argv.includes('--subtree')) {
          return ok(JSON.stringify({ blocks: SUBTREES[run.argv[run.argv.indexOf('--subtree') + 1]!] ?? [], completeness: { kind: 'complete' } }))
        }
        if (run.argv[0] === 'ep0ch') {
          if (run.argv[1] === 'help') {
            return ok(`  ep0ch show <id>… [--source | --ansi | --cells] [--width <n>] [--rows <n>]\n${options.export === false ? '' : '  ep0ch export [<id>…] [--query "<expression>"]\n'}`)
          }
          if (run.argv[1] === 'export') return ok(EXPORTED[run.argv[2]!]!)
          if (run.argv.includes('--cells') && options.cells !== false) {
            const width = Number(run.argv[run.argv.indexOf('--width') + 1])
            // One row of 'A' in white on black: [codePoint, fg, bg] as u32 LE, base64.
            const words = new Uint32Array(width * 3).fill(0x01000000)
            for (let i = 0; i < width; i++) words[i * 3] = 0x41
            let binary = ''
            for (const byte of new Uint8Array(words.buffer)) binary += String.fromCharCode(byte)
            return ok(JSON.stringify({ id: run.argv[2], columns: width, rows: 1, cells: btoa(binary), replaced: 0 }))
          }
          return result(1, '', 'ep0ch: no\n')
        }
        return succeeding(run)
      }
    }
    /** The engine's panes: each open recorded, placed (or waiting, `placed: false`). */
    function panesIn(on: On, placed = true) {
      const opened: string[] = []
      on('ui.open', ($, e) => { opened.push(e.id); return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'opened unasked under 144 columns (120 now)' } } })
      on('ui.close', () => ({ value: undefined }))
      return opened
    }
    const detail = ($: any, surface: 'terminal' | 'desktop' | 'vscode') =>
      $.ui.mount({ plugin: 'ep0ch', surface, component: 'Pane', requestId: DETAIL, props: { title: 'Mentions', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30, rows: 0 }, view: {} } })
    const titleOf = async (pane: any) => (await pane.find({ type: 'Text', text: /^(Daily notes|Other page)$/ }))?.text

    test('desktop: a click opens the note in the pane as Markdown (heading, list, links); a link navigates there, back, forward, back to the list', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering(), '', NOT_IN_HERDR)
      const opened = panesIn(on)
      await session.begin(() => $.session.start({ ...START, surface: 'desktop' }))
      const reply = await $.ui.mount({ plugin: 'ep0ch', surface: 'desktop', component: 'AssistantMessage', props: { text: 'See [[Daily notes]].', isFirstOfReply: true } })

      await reply.press({ key: 'outliner-references', link: { href: 'https://pi-outliner.invalid/page/Daily%20notes' } })
      await session.clock.settle()
      // Seated by the press itself (the person's ask), then opened by openNote; nothing copied, no toast, no Herdr.
      expect(opened).toEqual([DETAIL, DETAIL])
      expect(session.toasts).toEqual([])
      expect(herdrOpens(session.runs)).toEqual([])
      // The door's export of the note and its children, on the session's outline.
      const read = session.runs.find(run => run.argv[1] === 'export')!
      expect(read.argv).toEqual(['ep0ch', 'export', BLOCK, '--children', '--format', 'md', '--out', '-'])
      expect(read.init?.cwd).toBe(WORKSPACE)
      expect(read.init?.env).toMatchObject({ EP0CH_WS: 'garden' })

      const pane = await detail($, 'desktop')
      expect(await titleOf(pane)).toBe('Daily notes')
      expect(await pane.find({ type: 'Text', text: /^opens here: no door or Herdr around/ })).toBeDefined()
      const body = await pane.find({ key: 'detail-body' })
      expect(body?.type).toBe('Markdown')
      expect(body?.props.text).toBe(
        '# Daily notes\n[type::note]\n## Today\n- rode to the shed\n\n' +
        '- Bring the [Other page](https://pi-outliner.invalid/page/Other%20page) list, see [PIE-7](https://pi-outliner.invalid/work/PIE-7)',
      )
      expect(body?.props.dimColor).toBeUndefined()
      expect(body?.props.pressableLinks).toEqual(['https://pi-outliner.invalid/page/Other%20page', 'https://pi-outliner.invalid/work/PIE-7'])
      // Desktop's links are in the Markdown: no link buttons.
      expect(await pane.find({ key: 'detail-link-1' })).toBeUndefined()
      // Back from the first note is the mentions list.
      expect((await pane.find({ key: 'detail-back' }))?.text).toBe('← mentions')

      // A link in the note opens in the pane, through the same open.
      await pane.press({ key: 'detail-body', link: { href: 'https://pi-outliner.invalid/page/Other%20page' } })
      await session.clock.settle()
      expect(await titleOf(pane)).toBe('Other page')
      expect((await pane.find({ key: 'detail-body' }))?.props.text).toBe('# Other page\nThe chain oil is the wax one.')
      expect(await pane.find({ type: 'Text', text: /2 of 2/ })).toBeDefined()

      expect((await pane.find({ key: 'detail-back' }))?.text).toBe('← Daily notes')
      await pane.press({ key: 'detail-back' })
      await session.clock.settle()
      expect(await titleOf(pane)).toBe('Daily notes')
      await pane.press({ key: 'detail-forward' })
      await session.clock.settle()
      expect(await titleOf(pane)).toBe('Other page')
      // `l`: straight back to the list, from any depth.
      await pane.press({ key: 'detail-list' })
      await session.clock.settle()
      expect(await pane.find({ key: 'detail-body' })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /^Mentioned · opens here, in a detail pane$/ })).toBeDefined()
      expect(session.toasts).toEqual([])
    })

    test('vscode draws Markdown too; the copy button keeps the command that reads it anywhere', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering(), '', NOT_IN_HERDR)
      panesIn(on)
      const copied: string[] = []
      on('ui.copy', ($, e) => { copied.push(e.text); return { value: { isCopied: true } } })
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))
      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      expect(shown).toMatchObject({ result: 'Showing Daily notes in the mentions pane beside this conversation.' })
      // The agent's show copies nothing.
      expect(copied).toEqual([])
      // The note is read off the open queue: show answers once the pane is open.
      await session.clock.settle()

      const pane = await detail($, 'vscode')
      expect((await pane.find({ key: 'detail-body' }))?.type).toBe('Markdown')
      await pane.press({ key: 'detail-copy' })
      await session.clock.settle()
      expect(copied).toEqual([`ep0ch show ${BLOCK} --ws garden`])
      expect(session.toasts).toEqual([`Copied \`ep0ch show ${BLOCK} --ws garden\`: it reads the note in any terminal.`])
    })

    test('terminal outside Herdr: the door draws it (BlockView cells), its references are buttons, and a button navigates there', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering(), '', NOT_IN_HERDR)
      const opened = panesIn(on)
      await session.begin(() => $.session.start(START))
      const drawn = await mountReply($, 'See [[Daily notes]].')
      await drawn.press({ key: 'https://pi-outliner.invalid/page/Daily%20notes' })
      await session.clock.settle()
      expect(opened[0]).toBe(DETAIL)

      const pane = await detail($, 'terminal')
      await session.clock.settle()
      const body = await pane.find({ key: 'detail-body' })
      expect(body?.type).toBe('Raster')
      // Drawn tall, at the pane's width, kept apart from the previews' drawings.
      const show = session.runs.find(run => run.argv[0] === 'ep0ch' && run.argv.includes('--cells'))!
      expect(show.argv).toEqual(['ep0ch', 'show', BLOCK, '--cells', '--width', '59', '--rows', '400'])
      const link = await pane.find({ key: 'detail-link-1' })
      expect([link?.type, link?.props.hotkey, link?.text]).toEqual(['Button', '1', 'Other page'])
      expect((await pane.find({ key: 'detail-link-2' }))?.text).toBe('PIE-7')

      await pane.press({ key: 'detail-link-1' })
      await session.clock.settle()
      expect(await titleOf(pane)).toBe('Other page')
      await pane.press({ key: 'detail-back' })
      await session.clock.settle()
      expect(await titleOf(pane)).toBe('Daily notes')
      expect(session.toasts).toEqual([])
    })

    test("no ep0ch with export: the outliner's read, laid out the same way, its links still links", async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering({ export: false }), '', NOT_IN_HERDR)
      panesIn(on)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__ep0ch__show', reference: `((${BLOCK}))` })
      await session.clock.settle()
      expect(session.runs.some(run => run.argv[1] === 'export')).toBe(false)
      const read = session.runs.find(run => run.argv.includes('--subtree'))!
      expect(read.argv.slice(3)).toEqual(['list', '--subtree', BLOCK, '--limit', '200'])
      expect(read.init?.cwd).toBe(WORKSPACE)
      const body = await (await detail($, 'desktop')).find({ key: 'detail-body' })
      expect(body?.props.text).toBe(
        '# Daily notes\n[type::note]\n## Today\n- rode to the shed\n\n' +
        '- Bring the [Other page](https://pi-outliner.invalid/page/Other%20page) list, see [PIE-7](https://pi-outliner.invalid/work/PIE-7)',
      )
    })

    test('show opened unasked on a narrow terminal: the pane waits, and show says so', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, answering(), '', NOT_IN_HERDR)
      panesIn(on, false)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))
      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      expect(shown).toMatchObject({ result: 'Showing Daily notes in the mentions pane beside this conversation (the pane is not on screen yet: opened unasked under 144 columns (120 now)).' })
    })

    test("a folder bound to no outline: nothing to read it in, so show says so with the command and the ((id)) to copy", async ($, on) => {
      const session = sessionIn(on, '/elsewhere', answering(), '', NOT_IN_HERDR)
      const opened = panesIn(on)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start({ ...START, cwd: '/elsewhere' }))
      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: `((${BLOCK}))` })
      expect(shown.deny).toBe(`Can't open ${BLOCK} here: this session is not in an ep0ch-door tile, nor in Herdr. Read it with \`ep0ch show ${BLOCK}\`, or copy ((${BLOCK})) to open it in the Outliner.`)
      expect(opened).toEqual([])
    })
  })

  describe('in an ep0ch-door tile', () => {
    const DOOR = { EP0CH_TILE: 'claude', EP0CH_CONTROL: '/state/ep0ch-door/agent-door-claude.sock' }
    const doorOpenOf = (runs: readonly Run[]) => runs.find(run => run.argv.includes('door-open'))

    test('show opens the note in the door as an agent, from its own tile, and splits nothing in Herdr', async ($, on) => {
      // The door says where the tile's opens landed (its link).
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open') ? result(0, '{"tile":"t-fixture","name":"centre","id":"x"}\n', '') : succeeding(run),
      '', DOOR)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))

      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      expect(shown).toMatchObject({ result: "Showing Daily notes in the door's centre reader." })
      const opened = doorOpenOf(session.runs)!
      // From its own tile, never a reader by name (door-control asks again naming none when the door lacks the tile).
      expect(opened.argv.slice(-8)).toEqual([
        'door-open', BLOCK, '--control', DOOR.EP0CH_CONTROL, '--actor', 'claude-code@garden-host', '--from', 'claude',
      ])
      expect(opened.argv).not.toContain('--reader')
      expect(opened.init?.cwd).toBe(WORKSPACE)
      expect(herdrOpens(session.runs, 'ensure-detail')).toEqual([])
      expect(session.runs.some(run => run.argv.includes('link'))).toBe(false)
    })

    test("the person on middle and a door that doesn't know this tile: show lands where the door's opens land, not refused", async ($, on) => {
      // What this proves is the argv: --from alone, never --reader (the stub refuses one, as a door would with the
      // person on middle). The CLI's ask-again naming no tile is door-control's, proved in test/door-control.test.ts.
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open')
          ? run.argv.includes('--reader') ? result(1, '', "error: middle has the person's keys; an agent doesn't open there\n") : result(0, '{"tile":"t-fixture","name":"side","id":"x"}\n', '')
          : succeeding(run),
      '', { ...DOOR, EP0CH_TILE: 'claude-gone' })
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))

      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      expect(shown).toMatchObject({ result: "Showing Daily notes in the door's side reader." })
      const opened = doorOpenOf(session.runs)!
      expect(opened.argv.slice(-2)).toEqual(['--from', 'claude-gone'])
      expect(opened.argv).not.toContain('--reader')
      expect(herdrOpens(session.runs, 'ensure-detail')).toEqual([])
    })

    test('show is attributed like every other write: OUTLINER_ACTOR before EP0CH_AGENT', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open') ? result(0, '{"tile":"t-fixture","name":"centre","id":"x"}\n', '') : succeeding(run),
      '', { ...DOOR, OUTLINER_ACTOR: 'garden-agent', EP0CH_AGENT: 'loki' })
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      const opened = doorOpenOf(session.runs)!
      // The door acts as the same actor id the outline writes carry: one agent, one id.
      expect(opened.argv[opened.argv.indexOf('--actor') + 1]).toBe('garden-agent/claude-code@garden-host')
    })

    test('with no door answering (it quit), show falls back to the Outliner Detail beside Claude in Herdr', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open') ? result(3, '', 'error: no door at /state/x (ECONNREFUSED)\n') : succeeding(run),
      '', DOOR)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))

      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      expect(shown).toMatchObject({ result: 'Showing Daily notes in the Outliner Detail beside you.' })
      expect(doorOpenOf(session.runs)).toBeDefined()
      expect(session.runs.find(run => run.argv.includes('link'))?.argv).toContain('admin-detail')
    })

    test('a door that refuses is denied with its reason, never shown elsewhere', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open')
          ? result(1, '', "error: the menu screen can't open blocks; open the board or desk first\n")
          : succeeding(run),
      '', DOOR)
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))

      const shown = await $.tool.call({ tool: 'mcp__ep0ch__show', reference: '[[Daily notes]]' })
      expect(shown.deny).toContain("the menu screen can't open blocks")
      expect(herdrOpens(session.runs, 'ensure-detail')).toEqual([])
      expect(session.runs.some(run => run.argv.includes('link'))).toBe(false)
    })

    test("a click in a terminal tile (^W o s, no Herdr pane) opens in the door, from the tile's id when its name is empty", async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open') ? result(0, '{"tile":"t-fixture","name":"right","id":"x"}\n', '') : succeeding(run),
      '', { ...NOT_IN_HERDR, EP0CH_CONTROL: DOOR.EP0CH_CONTROL, EP0CH_TILE: '', EP0CH_TILE_ID: 't21' })
      await session.begin(() => $.session.start(START))
      const drawn = await mountReply($, 'See PIE-7.')

      await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
      await session.clock.settle()

      const opened = doorOpenOf(session.runs)!
      expect(opened.argv.slice(-8)).toEqual([
        'door-open', BLOCK, '--control', DOOR.EP0CH_CONTROL, '--actor', 'claude-code@garden-host', '--from', 't21',
      ])
      expect(herdrOpens(session.runs, 'ensure-detail')).toEqual([])
      expect(session.toasts).toEqual([])
    })

    test("a click the door refuses is a toast with the door's reason", async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open')
          ? result(1, '', 'error: right holds an edit; an agent never takes it\n')
          : succeeding(run),
      '', { ...NOT_IN_HERDR, ...DOOR })
      await session.begin(() => $.session.start(START))
      const drawn = await mountReply($, 'See PIE-7.')

      await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
      await session.clock.settle()

      expect(session.toasts).toEqual(['Could not open PIE-7 in the Outliner: right holds an edit; an agent never takes it'])
      expect(herdrOpens(session.runs, 'ensure-detail')).toEqual([])
    })

    test('with no door answering (it quit) and no Herdr, a click opens the note here, in the detail pane', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open') ? result(3, '', 'error: no door at /state/x (ECONNREFUSED)\n') : succeeding(run),
      '', { ...NOT_IN_HERDR, ...DOOR })
      const opened: string[] = []
      on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
      await session.begin(() => $.session.start(START))
      const drawn = await mountReply($, 'See PIE-7.')

      await drawn.press({ key: 'https://pi-outliner.invalid/work/PIE-7' })
      await session.clock.settle()

      // Not seated by the press (a door was named), but opened once the door didn't answer.
      expect(opened).toEqual(['outliner-mentions'])
      expect(session.toasts).toEqual([])
    })

    test('a click on a reference opens it in the door too', async ($, on) => {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv.includes('door-open') ? result(0, '{}\n', '') : succeeding(run),
      '', { ...DOOR, EP0CH_AGENT: 'door-claude' })
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      await session.begin(() => $.session.start(START))

      await $.tool.call({ tool: 'mcp__ep0ch__show', reference: `((${BLOCK}))` })
      const opened = doorOpenOf(session.runs)!
      expect(opened.argv).toContain('door-claude/claude-code@garden-host')
      expect(session.toasts).toEqual([])
    })
  })

  test("the folder's .ep0ch agent is the persona every write carries, outline and door alike (ADR 0003)", async ($, on) => {
    const persona = { name: 'testbot', source: 'file', file: `${WORKSPACE}/.ep0ch` }
    const session = sessionIn(on, WORKSPACE, run =>
      run.argv[0] === 'ep0ch' && run.argv[1] === 'where' ? result(0, JSON.stringify({ inDoor: false, here: { machine: 'garden-host', folder: WORKSPACE, persona } }), '')
        : run.argv.includes('work') ? result(0, '{"workId":"PIE-008","workStage":"review","revision":4}\n', '') : succeeding(run),
    )
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start(START))
    await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'review', expectedRevision: 3 })
    const run = session.runs.find(candidate => candidate.argv.includes('work'))!
    expect(run.argv[run.argv.indexOf('--actor') + 1]).toBe('testbot/claude-code@garden-host')
  })

  describe('the claude.ai connector (PIE-1256)', () => {
    const NOTE = '0f3c2a1b-1111-4222-8333-444455556666'
    const FOLDER_PERSONA = { name: 'testbot', source: 'file', file: `${WORKSPACE}/.ep0ch` }
    /** A session whose folder names `persona`, with the connector's tools answered by `by`, recording what they were called with and what was logged. */
    function connectorSession(on: On, by: string, persona: object | null = FOLDER_PERSONA, blocks = false, env: Record<string, string> = {}) {
      const session = sessionIn(on, WORKSPACE, run =>
        run.argv[0] === 'ep0ch' && run.argv[1] === 'where' ? result(0, JSON.stringify({ inDoor: false, here: { machine: 'garden-host', folder: WORKSPACE, persona } }), '') : succeeding(run),
        '', env,
      )
      on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
      const seen: Record<string, unknown>[] = []
      const logged: string[] = []
      on('tool.call', { tool: /^mcp__claude_ai_ep0ch__/ }, ($, e) => {
        seen.push(e as Record<string, unknown>)
        const answer = JSON.stringify({ outcome: 'applied', by })
        return { result: blocks ? [{ type: 'text', text: answer }] : answer, ref: 'r', text: 'ok' } as any
      })
      on('tool.call', { tool: 'mcp__other__outline_patch' }, () => ({ result: '{}', ref: 'r', text: 'ok' } as any))
      on('ui.log', ($, e) => { logged.push(e.text); return { value: undefined } })
      return { session, seen, logged }
    }

    test("a write that names no persona carries the session's, as the \"writes as\" line has it", async ($, on) => {
      const c = connectorSession(on, 'testbot (claude.ai)')
      await c.session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_patch', ref: NOTE, revision: 2, patches: [] } as any)
      expect(c.seen[0]).toMatchObject({ ref: NOTE, persona: 'testbot' })
      expect(c.logged).toEqual([])
    })

    test('a call that names a persona keeps it', async ($, on) => {
      const c = connectorSession(on, 'daddy (claude.ai)')
      await c.session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_comment', ref: NOTE, text: 'hm', persona: 'daddy' } as any)
      expect(c.seen[0]).toMatchObject({ persona: 'daddy' })
    })

    test("a read and another server's tool are left as they are", async ($, on) => {
      const c = connectorSession(on, 'testbot (claude.ai)')
      await c.session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_read', ref: NOTE } as any)
      expect(c.seen[0]).not.toHaveProperty('persona')
      const other = await $.tool.call({ tool: 'mcp__other__outline_patch', ref: NOTE } as any)
      expect(other).toMatchObject({ result: '{}' })
      expect(c.seen).toHaveLength(1)
    })

    test('a session with no persona leaves the call alone', async ($, on) => {
      const c = connectorSession(on, 'claude.ai', null)
      await c.session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_patch', ref: NOTE, revision: 2, patches: [] } as any)
      expect(c.seen[0]).not.toHaveProperty('persona')
      expect(c.logged).toEqual([])
    })

    test("a write recorded as another persona says so, once for each name, and its answer comes back as it was", async ($, on) => {
      const c = connectorSession(on, 'daddy (claude.ai)', FOLDER_PERSONA, true)
      await c.session.begin(() => $.session.start(START))
      const answered = await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_patch', ref: NOTE, revision: 2, patches: [] } as any)
      await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_patch', ref: NOTE, revision: 2, patches: [] } as any)
      expect(answered).toMatchObject({ result: [{ type: 'text', text: JSON.stringify({ outcome: 'applied', by: 'daddy (claude.ai)' }) }] })
      expect(c.logged).toHaveLength(1)
      expect(c.logged[0]).toContain('recorded as daddy (claude.ai), not testbot')
    })

    test("EP0CH_AGENT in the session's environment is its persona before the folder's", async ($, on) => {
      const c = connectorSession(on, 'loki (claude.ai)', FOLDER_PERSONA, false, { EP0CH_AGENT: 'loki' })
      await c.session.begin(() => $.session.start(START))
      await $.tool.call({ tool: 'mcp__claude_ai_ep0ch__outline_set_property', ref: NOTE, key: 'k', value: 'v' } as any)
      expect(c.seen[0]).toMatchObject({ persona: 'loki' })
    })
  })

  test('a workboard tool runs the installed CLI in the workspace as this Claude session', async ($, on) => {
    const session = sessionIn(on, `${WORKSPACE}/projects/mod`, run =>
      run.argv.includes('work') ? result(0, '{"workId":"PIE-008","workStage":"review","revision":4}\n', '') : succeeding(run),
    )
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: `${WORKSPACE}/projects/mod` }))

    const staged = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'review', expectedRevision: 3 })
    expect(staged).toMatchObject({ result: '{"workId":"PIE-008","workStage":"review","revision":4}' })
    const run = session.runs.find(candidate => candidate.argv.includes('work'))!
    expect(run.argv).toEqual([
      '/bin/sh', '/opt/outliner/scripts/run-bun.sh', '/opt/outliner/src/cli.ts',
      'work', 'stage', '--expected', '3',
      '--author', 'agent', '--actor', 'claude-code@garden-host', '--session', 'session-1', '--', 'PIE-8', 'review',
    ])
    expect(run.init?.cwd).toBe(WORKSPACE)
    expect(run.init?.env).toEqual({ OUTLINER_WORKSPACE_ROOT: WORKSPACE, EP0CH_WS: 'garden', EP0CH_MACHINE: '' })

    await $.tool.call({ tool: 'mcp__ep0ch__work_complete', item: 'PIE-8', deliveries: ['d-1', 'PIE-8/door'], proof: 'Proof\n\nChecked.' })
    const completed = session.runs.findLast(candidate => candidate.argv.includes('complete'))!
    expect(completed.argv.slice(3, 8)).toEqual(['work', 'complete', '--delivery=d-1', '--delivery=PIE-8/door', '--stdin'])
    expect(completed.argv.slice(-2)).toEqual(['--', 'PIE-8'])
    expect(completed.init?.stdin).toBe('Proof\n\nChecked.')

    await $.tool.call({ tool: 'mcp__ep0ch__work_complete', item: 'PIE-8', allMerged: true, proofBlock: 'p-1' })
    const allMerged = session.runs.findLast(candidate => candidate.argv.includes('complete'))!
    expect(allMerged.argv.slice(3, 7)).toEqual(['work', 'complete', '--all-merged', '--proof-block=p-1'])
    expect(allMerged.argv.slice(-2)).toEqual(['--', 'PIE-8'])

    await $.tool.call({ tool: 'mcp__ep0ch__work_deliver', item: 'PIE-8', repo: 'example-org/example-door', pr: 16, key: 'door' })
    const delivered = session.runs.findLast(candidate => candidate.argv.includes('deliver'))!
    expect(delivered.argv.slice(3, 8)).toEqual(['work', 'deliver', '--repo=example-org/example-door', '--pr=16', '--key=door'])
    expect(delivered.argv.slice(-2)).toEqual(['--', 'PIE-8'])

    await $.tool.call({ tool: 'mcp__ep0ch__work_set', item: 'PIE-8/door', key: 'delivery-stage', value: 'complete', expectedRevision: 2 })
    const set = session.runs.findLast(candidate => candidate.argv.includes('set'))!
    expect(set.argv.slice(3, 7)).toEqual(['work', 'set', '--expected', '2'])
    expect(set.argv.slice(-4)).toEqual(['--', 'PIE-8/door', 'delivery-stage', 'complete'])

    await $.tool.call({ tool: 'mcp__ep0ch__note_section', block: 'PIE-8', heading: '## Now', body: 'Updated.', expectedRevision: 3 })
    const section = session.runs.findLast(candidate => candidate.argv.includes('section'))!
    expect(section.argv.slice(3, 8)).toEqual(['note', 'section', '--stdin', '--expected', '3'])
    expect(section.argv.slice(-3)).toEqual(['--', 'PIE-8', '## Now'])
    expect(section.init?.stdin).toBe('Updated.')
  })

  test('a refused workboard change is denied with the reason, and unusable input never runs', async ($, on) => {
    const session = sessionIn(on, WORKSPACE, run =>
      run.argv.includes('work')
        ? result(1, '', 'error: Unknown work stage "shipping"; use one of queued, doing\n')
        : succeeding(run),
    )
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start(START))

    const refused = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'shipping' })
    expect(refused.deny).toBe('Unknown work stage "shipping"; use one of queued, doing')

    const runs = session.runs.length
    const both = await $.tool.call({ tool: 'mcp__ep0ch__work_complete', item: 'PIE-8', proof: 'x', proofBlock: 'y' })
    expect(both.deny).toContain('either proof text or an existing proofBlock')
    const named = await $.tool.call({ tool: 'mcp__ep0ch__work_complete', item: 'PIE-8', proof: 'x', deliveries: ['d-1'], allMerged: true })
    expect(named.deny).toContain('not both')
    expect(session.runs.length).toBe(runs)
  })

  test('in a folder bound to no outline, workboard tools change nothing', async ($, on) => {
    const session = sessionIn(on, '/elsewhere', succeeding)
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/elsewhere' }))
    const denied = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'doing' })
    expect(denied.deny).toContain('not bound to an Outliner outline')
    // Nothing reached an outline: only the CLI's discovery ran, and `ep0ch outline list` for the call the refusal names.
    expect(session.runs.filter(run => run.argv[1] !== 'outline').map(run => run.argv[0])).toEqual(['herdr'])
  })

  test('a not-bound answer is never sticky: the next call reads the folder again and finds it bound (PIE-755)', async ($, on) => {
    let bound = false
    const session = sessionIn(on, '/elsewhere', succeeding, '', {}, folder =>
      bound ? result(0, JSON.stringify({ bound: true, folder: '/elsewhere', outline: 'garden' }), '') : result(0, boundToWorkspace(folder), ''))
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/elsewhere' }))
    const denied = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'doing' })
    expect(denied.deny).toContain('not bound to an Outliner outline')
    bound = true
    const allowed = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'doing' })
    expect(allowed.deny).toBeUndefined()
  })

  test('a shell cd elsewhere does not unbind the tools: the lookup stays on the starting folder (PIE-755)', async ($, on) => {
    let cwd = WORKSPACE
    const session = sessionIn(on, () => cwd, succeeding)
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start(START))
    cwd = '/opt/boards'
    // The binding read again (/outline, a turn now and then) while the shell is elsewhere.
    await $.command.run({ command: 'outline', args: '' } as any)
    await session.clock.settle()
    const again = await $.tool.call({ tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'doing' })
    expect(again.deny).toBeUndefined()
    expect(session.bindings.every(run => run.argv.at(-1) === WORKSPACE)).toBe(true)
  })

  test('in a folder bound to no outline, replies are not linked', async ($, on) => {
    const session = sessionIn(on, '/elsewhere', succeeding)
    await session.begin(() => $.session.start({ ...START, cwd: '/elsewhere' }))
    const drawn = await $.ui.mount({
      plugin: 'ep0ch',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: 'See PIE-7.', isFirstOfReply: true },
    })
    expect(await drawn.find({ key: 'outliner-references' })).toBeUndefined()
    expect((await drawn.find({ key: 'engine' }))?.text).toBe('See PIE-7.')
  })
})

describe('a session names its outline, and the shell\'s folder never picks it (PIE-756)', () => {
  /** `ep0ch outline list --all --lines`: gurgle here, garden on far-box. */
  const listing = (run: Run): ProcessRunResult | null =>
    run.argv[0] === 'ep0ch' && run.argv[1] === 'outline' ? result(0, 'gurgle\t\t\ngarden\tfar-box\t\n', '') : null
  const answering = (run: Run) => listing(run) ?? succeeding(run)
  const stage = { tool: 'mcp__ep0ch__work_stage', item: 'PIE-8', stage: 'doing' }
  const stageRuns = (runs: readonly Run[]) => runs.filter(run => run.argv.includes('work'))

  test('with EP0CH_WS set and the shell in /tmp, the session stays bound: no folder lookup, the run lands on that outline', async ($, on) => {
    let cwd = '/tmp'
    const session = sessionIn(on, () => cwd, answering, '', { EP0CH_WS: 'gurgle', EP0CH_CONTROL: '/run/door.sock' })
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/tmp' }))
    cwd = '/opt/elsewhere'
    const allowed = await $.tool.call(stage)
    expect(allowed.deny).toBeUndefined()
    const ran = stageRuns(session.runs).at(-1)!
    expect(ran.init?.env).toMatchObject({ EP0CH_WS: 'gurgle', EP0CH_MACHINE: '' })
    expect(ran.init?.cwd).toBe('/tmp')
    // EP0CH_WS wins over the folder's .ep0ch: it was never asked.
    expect(session.bindings).toEqual([])
  })

  test('EP0CH_MACHINE goes with EP0CH_WS; a name that is not one is said, with the call that fixes it', async ($, on) => {
    const session = sessionIn(on, '/tmp', answering, '', { EP0CH_WS: 'garden', EP0CH_MACHINE: 'far-box' })
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/tmp' }))
    await $.tool.call(stage)
    expect(stageRuns(session.runs).at(-1)!.init?.env).toMatchObject({ EP0CH_WS: 'garden', EP0CH_MACHINE: 'far-box' })
  })

  test('after a lost binding every refusal names the call, and outline_bind brings it back (a shell cd does not matter)', async ($, on) => {
    let cwd = '/elsewhere'
    const session = sessionIn(on, () => cwd, answering)
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/elsewhere' }))
    const denied = await $.tool.call(stage)
    expect(denied.deny).toContain('not bound to an Outliner outline')
    expect(denied.deny).toContain('outline_bind {"name":"gurgle"}')
    expect(denied.deny).toContain('/outline gurgle')

    const typo = await $.tool.call({ tool: 'mcp__ep0ch__outline_bind', name: 'gurgel' })
    expect(typo.deny).toContain('there is no outline "gurgel"')
    expect(typo.deny).toContain('outline_bind {"name":"gurgle"}')
    expect((await $.tool.call(stage)).deny).toContain('not bound')

    const bound = await $.tool.call({ tool: 'mcp__ep0ch__outline_bind', name: 'gurgle' })
    expect(bound.deny).toBeUndefined()
    cwd = '/tmp'
    const allowed = await $.tool.call(stage)
    expect(allowed.deny).toBeUndefined()
    expect(stageRuns(session.runs).at(-1)!.init?.env).toMatchObject({ EP0CH_WS: 'gurgle', EP0CH_MACHINE: '' })

    // An outline on another machine is bound with its machine, and only if it is there.
    const wrong = await $.tool.call({ tool: 'mcp__ep0ch__outline_bind', name: 'garden' })
    expect(wrong.deny).toContain('outline_bind {"name":"garden","machine":"far-box"}')
    expect((await $.tool.call({ tool: 'mcp__ep0ch__outline_bind', name: 'garden', machine: 'far-box' })).deny).toBeUndefined()
    await $.tool.call(stage)
    expect(stageRuns(session.runs).at(-1)!.init?.env).toMatchObject({ EP0CH_WS: 'garden', EP0CH_MACHINE: 'far-box' })
  })

  test('/outline <name> is the same call and beats EP0CH_WS, which itself beats an opted-out folder', async ($, on) => {
    const session = sessionIn(on, '/tmp', answering, '/tmp', { EP0CH_WS: 'garden', PI_OUTLINER_MENTIONS_MODE: 'folder' })
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/tmp' }))
    expect((await $.tool.call(stage)).deny).toBeUndefined()
    expect(stageRuns(session.runs).at(-1)!.init?.env).toMatchObject({ EP0CH_WS: 'garden' })
    const said = await $.command.run({ command: 'outline', args: 'gurgle' } as any)
    expect(JSON.stringify(said)).toContain('now use gurgle')
    await $.tool.call(stage)
    expect(stageRuns(session.runs).at(-1)!.init?.env).toMatchObject({ EP0CH_WS: 'gurgle' })
    const refused = await $.command.run({ command: 'outline', args: 'nothere' } as any)
    expect(JSON.stringify(refused)).toContain('there is no outline')
  })

  test('an EP0CH_WS that is not a name is refused saying so, with the call that fixes it', async ($, on) => {
    const session = sessionIn(on, '/tmp', answering, '', { EP0CH_WS: 'Not A Name' })
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    await session.begin(() => $.session.start({ ...START, cwd: '/tmp' }))
    const denied = await $.tool.call(stage)
    expect(denied.deny).toContain("isn't an outline name")
    expect(denied.deny).toContain('outline_bind {"name":"gurgle"}')
  })
})

describe('the settle check (PIE-1268)', () => {
  const MIN = 60_000
  const CAPABILITY = '46e391fb-dcd7-46eb-a6f2-f8f71d45f5cb'
  const LOG = '4badf9a8-7bb3-4715-9702-7c30605bd96e'
  const LOKI = { name: 'loki', source: 'file', file: `${WORKSPACE}/.ep0ch` }
  /** `ago`: minutes before the clock's now when it was first asked; it is then fixed, so time passing is not activity. */
  /** `shaped`: a ticket carries the thread; `hub`: a `type::hub` note does. */
  type Fake = { count: number; evan: number; ago: number; shaped?: boolean; hub?: boolean; last?: number }

  /**
   * A session whose outline holds `threads`, each last touched `ago` minutes before the clock's now (the test moves
   * it), answering the three facet questions by their query, the settings and build-log lookups, and recording the
   * wakes (prompt.submit) and the lines written under the build log (`ep0ch new`).
   */
  function settleSession(on: On, threads: Record<string, Fake>, persona: object | null = LOKI, env: Record<string, string> = {}, noFacets = false, byOutline: Record<string, Record<string, Fake>> = {}, config: { fresh?: boolean; toml?: string; tuning?: Record<string, { id: string; tuning?: string; outlines?: string; updatedAt: string }[]>; tuningFails?: string[] } = {}) {
    const session = sessionIn(on, WORKSPACE, run => {
      const query = run.argv[run.argv.indexOf('--query') + 1] ?? ''
      if (run.argv[0] === 'ep0ch' && run.argv[1] === 'where') return result(0, JSON.stringify({ inDoor: false, here: { machine: 'garden-host', folder: WORKSPACE, persona } }), '')
      if (run.argv.includes('--facets')) {
        // An older host: the service answers without the facet.
        if (noFacets) return result(0, '{"blocks":[]}', '')
        const now = session.clock.now()
        const rows = Object.entries(byOutline[run.init?.env?.EP0CH_WS ?? ''] ?? threads).flatMap(([thread, t]) => {
          const shapedAsk = /^\(?type=roadmap-item/.test(query)
          const count = shapedAsk ? (t.shaped ? 1 : 0) + (t.hub && query.includes('type=hub') ? 1 : 0) : query.includes('by:user') ? t.evan : t.count
          t.last ??= now - t.ago * MIN
          return count ? [{ value: thread, count, last: new Date(t.last).toISOString() }] : []
        })
        return result(0, JSON.stringify({ blocks: [], facets: [{ key: 'thread', count: rows.length, values: rows }] }), '')
      }
      if (query === 'type=capability AND (settle-tuning OR settle-outlines)') {
        if (config.tuningFails?.includes(run.init?.env?.EP0CH_WS ?? '')) return result(1, '', 'error: the host timed out')
        const rows = (config.tuning?.[run.init?.env?.EP0CH_WS ?? ''] ?? []).map(n => ({ id: n.id, title: 'Settle, then shape', properties: [...(n.tuning ? [{ key: 'settle-tuning', value: n.tuning }] : []), ...(n.outlines ? [{ key: 'settle-outlines', value: n.outlines }] : [])], updatedAt: n.updatedAt }))
        return result(0, JSON.stringify({ blocks: rows }), '')
      }
      if (query.includes('type=build-log')) return result(0, JSON.stringify({ blocks: [{ id: LOG, title: 'Build log, Oct 25', properties: [], createdAt: '2026-10-25T00:00:00Z' }] }), '')
      return succeeding(run)
    }, '', { EP0CH_SETTLE_OUTLINES: 'garden', ...env })
    on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
    // A store that already holds a check (the first one only records a baseline).
    mock.store(on, config.fresh ? {} : { 'settle.threads': {} })
    on('fs.read', ($, e, next) => (e.path.endsWith('/.ep0ch/config.toml') && config.toml !== undefined ? { value: config.toml } : next(e)) as any)
    const wakes: string[] = []
    let dropping = false
    on('prompt.submit', ($, e) => { wakes.push(e.text); return (dropping ? { drop: 'busy' } : { text: e.text }) as any })
    const lines = () => session.runs.filter(r => r.argv[0] === 'ep0ch' && r.argv[1] === 'new').map(r => r.argv[2]!)
    const asked = () => session.runs.filter(r => r.argv.includes('--facets')).length
    return { session, threads, wakes, lines, asked, drop: (on: boolean) => { dropping = on } }
  }

  async function start($: any, s: ReturnType<typeof settleSession>) {
    await s.session.clock.set(Date.parse('2026-10-25T12:00:00Z'))
    await s.session.begin(() => $.session.start(START))
    // The first look comes soon after the session starts.
    await s.session.clock.advance(20_000)
  }

  test('the deployer\'s session wakes once on a newly settled thread, with its counts, and writes the change under the build log', async ($, on) => {
    const s = settleSession(on, {
      zucchini: { count: 4, evan: 2, ago: 90 },
      beans: { count: 5, evan: 1, ago: 10 },
      thin: { count: 1, evan: 1, ago: 500 },
      tickets: { count: 6, evan: 2, ago: 500, shaped: true },
    })
    await start($, s)
    expect(s.wakes).toHaveLength(1)
    expect(s.wakes[0]).toContain("thread zucchini settled: 4 chirps, 2 Evan's, quiet 90 min, no capability or hub note yet")
    // Warming, too thin and already shaped threads are not in it.
    for (const name of ['beans', 'thin', 'tickets']) expect(s.wakes[0]).not.toContain(`thread ${name}`)
    // A new settled thread is a change; a thread first seen shaped was shaped before, and says nothing.
    expect(s.lines()).toEqual(['Thread zucchini: new → settled · 4 chirps, 2 Evan\'s, quiet 90 min'])
    const written = s.session.runs.find(r => r.argv[0] === 'ep0ch' && r.argv[1] === 'new')!
    expect(written.argv).toEqual(expect.arrayContaining(['--near', LOG, '--as', 'loki/claude-code@garden-host']))

    // The next check, nothing changed (beans is still warming): nothing said again.
    await s.session.clock.advance(31 * MIN)
    expect(s.asked()).toBe(6)
    expect(s.wakes).toHaveLength(1)
    expect(s.lines()).toHaveLength(1)
  })

  test('a settled thread that warms and goes quiet again wakes again, and each change is one build-log line', async ($, on) => {
    const s = settleSession(on, { zucchini: { count: 4, evan: 2, ago: 90 } })
    await start($, s)
    expect(s.wakes).toHaveLength(1)
    // New activity: warming. Quiet for the window again: settled once more, with a newer touch than the one told.
    s.threads.zucchini = { count: 5, evan: 2, ago: 1 }
    await s.session.clock.advance(31 * MIN)
    expect(s.wakes).toHaveLength(1)
    await s.session.clock.advance(62 * MIN)
    expect(s.wakes).toHaveLength(2)
    expect(s.wakes[1]).toContain('5 chirps')
    expect(s.lines().map(l => l.replace(/ · .*/, ''))).toEqual([
      'Thread zucchini: new → settled',
      'Thread zucchini: settled → warming',
      'Thread zucchini: warming → settled',
    ])
  })

  test('a thread that gets a ticket is shaped and stops being watched', async ($, on) => {
    const s = settleSession(on, { zucchini: { count: 4, evan: 2, ago: 90 } })
    await start($, s)
    s.threads.zucchini = { count: 4, evan: 2, ago: 120, shaped: true }
    await s.session.clock.advance(31 * MIN)
    expect(s.lines().at(-1)).toContain('settled → shaped')
    await s.session.clock.advance(31 * MIN)
    expect(s.wakes).toHaveLength(1)
    expect(s.lines()).toHaveLength(2)
  })

  test('a settled thread whose `thread` a hub note carries is shaped and does not wake; one with only chirps still does (PIE-1311)', async ($, on) => {
    const s = settleSession(on, {
      zine: { count: 18, evan: 3, ago: 90, hub: true },
      zucchini: { count: 4, evan: 2, ago: 90 },
    })
    await start($, s)
    expect(s.wakes).toHaveLength(1)
    expect(s.wakes[0]).toContain('thread zucchini settled')
    expect(s.wakes[0]).not.toContain('thread zine')
  })

  test('one wake names the newest few; the others wait for the next check, which names them', async ($, on) => {
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`t${i}`, { count: 3, evan: 1, ago: 100 + i * 10 }]))
    const s = settleSession(on, many, LOKI, { EP0CH_SETTLE_TUNING: 'wake-max=3' })
    await start($, s)
    expect(s.wakes).toHaveLength(1)
    expect(s.wakes[0]).toContain('7 threads have gone quiet')
    expect(s.wakes[0]).toContain('- and 4 more')
    expect(s.wakes[0]).toContain('thread t0 ')
    expect(s.wakes[0]).not.toContain('thread t3 ')
    await s.session.clock.advance(31 * MIN)
    expect(s.wakes).toHaveLength(2)
    expect(s.wakes[1]).toContain('4 threads have gone quiet')
    expect(s.wakes[1]).toContain('thread t3 ')
    expect(s.wakes[1]).not.toContain('thread t0 ')
  })

  test('thresholds are the settleTuning: a thread needs the notes and the person\'s own, and a dormant one is left alone', async ($, on) => {
    const s = settleSession(on, {
      two: { count: 2, evan: 1, ago: 100 },
      nobody: { count: 5, evan: 0, ago: 100 },
      dormant: { count: 5, evan: 2, ago: 9 * 24 * 60 },
    })
    await start($, s)
    expect(s.wakes).toEqual([])
    expect(s.lines()).toEqual([])
  })

  test('only the deployer\'s session runs it, unless EP0CH_SETTLE says on or off', async ($, on) => {
    const other = settleSession(on, { zucchini: { count: 4, evan: 2, ago: 90 } }, { name: 'testbot', source: 'file', file: `${WORKSPACE}/.ep0ch` })
    await start($, other)
    expect(other.asked()).toBe(0)
    expect(other.wakes).toEqual([])
  })

  test('EP0CH_SETTLE=on runs it in any session, and off stops the deployer\'s', async ($, on) => {
    const forced = settleSession(on, { zucchini: { count: 4, evan: 2, ago: 90 } }, null, { EP0CH_SETTLE: 'on' })
    await start($, forced)
    expect(forced.wakes).toHaveLength(1)
  })

  test('a prompt the session drops is not told: the next check names the thread again', async ($, on) => {
    const s = settleSession(on, { zucchini: { count: 4, evan: 2, ago: 90 } })
    s.drop(true)
    await start($, s)
    expect(s.wakes).toHaveLength(1)
    expect(s.session.toasts.some(t => t.includes('could not wake this session (busy)'))).toBe(true)
    s.drop(false)
    await s.session.clock.advance(31 * MIN)
    expect(s.wakes).toHaveLength(2)
    await s.session.clock.advance(31 * MIN)
    expect(s.wakes).toHaveLength(2)
  })

  test('a thread is one thread across the outlines it reads: tickets in one shape the conversation in the other', async ($, on) => {
    const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: 'gurgle@float-2, pie@float-2' }, false, {
      gurgle: { zucchini: { count: 4, evan: 2, ago: 90 }, beans: { count: 2, evan: 1, ago: 90 } },
      pie: { zucchini: { count: 0, evan: 0, ago: 90, shaped: true }, beans: { count: 2, evan: 1, ago: 100 } },
    })
    await start($, s)
    // zucchini has tickets in pie: shaped, not woken. beans has 2 notes in each outline: 4 together, settled.
    expect(s.wakes).toHaveLength(1)
    expect(s.wakes[0]).toContain('thread beans settled: 4 chirps, 2 Evan\'s')
    expect(s.wakes[0]).not.toContain('thread zucchini')
    expect(s.asked()).toBe(6)
  })

  test('the first check records what is already settled without waking, and says so in the build log; a thread that settles later wakes', async ($, on) => {
    const s = settleSession(on, { old1: { count: 4, evan: 2, ago: 200 }, old2: { count: 3, evan: 1, ago: 300 }, fresh: { count: 3, evan: 1, ago: 40 } }, LOKI, {}, false, {}, { fresh: true })
    await start($, s)
    expect(s.wakes).toEqual([])
    expect(s.lines()).toEqual(['Settle check baseline: 2 settled threads at the first run, recorded, not announced (0 shaped, 1 warming)'])
    // fresh goes quiet for the window: it settles now, and wakes.
    await s.session.clock.advance(31 * MIN)
    expect(s.wakes).toHaveLength(1)
    expect(s.wakes[0]).toContain('thread fresh settled')
    expect(s.wakes[0]).not.toContain('old1')
  })

  test('a thread quiet for longer than the horizon (3 days) is never newly settled', async ($, on) => {
    const s = settleSession(on, { stale: { count: 5, evan: 2, ago: 4 * 24 * 60 } })
    await start($, s)
    expect(s.wakes).toEqual([])
  })

  describe('which outlines it reads', () => {
    const byOutline = { pie: { a: { count: 3, evan: 1, ago: 100 } }, gurgle: { b: { count: 3, evan: 1, ago: 100 } }, garden: {}, extra: { c: { count: 3, evan: 1, ago: 100 } } }
    const TOML = 'ws = "garden"\nsettle-outlines = "extra@far-box"\n'
    const NOTE = { id: CAPABILITY, outlines: 'extra', updatedAt: '2026-10-25T09:00:00Z' }
    const notes = { tuning: { pie: [NOTE], gurgle: [{ ...NOTE, id: 'older', outlines: 'pie', updatedAt: '2026-10-20T09:00:00Z' }] } }

    test("with nothing named: pie and gurgle on the outline's machine", async ($, on) => {
      const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: '' }, false, byOutline)
      await start($, s)
      expect(s.wakes[0]).toContain('thread a settled')
      expect(s.wakes[0]).toContain('thread b settled')
      expect(s.wakes[0]).not.toContain('thread c')
    })

    test("the settle capability note's settle-outlines names others, the newest edited note winning", async ($, on) => {
      const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: '' }, false, byOutline, notes)
      await start($, s)
      expect(s.wakes[0]).toContain('thread c settled')
      expect(s.wakes[0]).not.toContain('thread a')
    })

    test('EP0CH_SETTLE_OUTLINES beats the note', async ($, on) => {
      const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: 'pie' }, false, byOutline, notes)
      await start($, s)
      expect(s.wakes[0]).toContain('thread a settled')
      expect(s.wakes[0]).not.toContain('thread c')
    })

    test('a settle-outlines line in .ep0ch/config.toml counts for nothing', async ($, on) => {
      const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: '' }, false, byOutline, { toml: TOML })
      await start($, s)
      expect(s.wakes[0]).toContain('thread a settled')
      expect(s.wakes[0]).toContain('thread b settled')
      expect(s.wakes[0]).not.toContain('thread c')
    })

    test('a note whose settle-outlines does not read is one toast naming it, and pie and gurgle stand', async ($, on) => {
      const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: '' }, false, byOutline, { tuning: { pie: [{ ...NOTE, outlines: 'Not A Name' }] } })
      await start($, s)
      expect(s.wakes[0]).toContain('thread a settled')
      expect(s.session.toasts.filter(t => t.includes(`settle-outlines on ((${CAPABILITY}))`))).toHaveLength(1)
    })
  })

  describe('the tuning on the settle capability note', () => {
    const NOTE = { id: CAPABILITY, tuning: 'chirps=2; base=thread AND NOT thread=pie-requests', updatedAt: '2026-10-25T09:00:00Z' }
    const two = { zucchini: { count: 2, evan: 1, ago: 90 } }
    const factsQuery = (s: ReturnType<typeof settleSession>) => s.session.runs.filter(r => r.argv.includes('--facets')).map(r => r.argv[r.argv.indexOf('--query') + 1]!)

    test('the newest note carrying settle-tuning tunes the check: its thresholds and its base query', async ($, on) => {
      const s = settleSession(on, two, LOKI, {}, false, {}, { tuning: { garden: [{ id: 'old', tuning: 'chirps=9', updatedAt: '2026-10-20T09:00:00Z' }, NOTE] } })
      await start($, s)
      expect(s.wakes).toHaveLength(1)
      expect(s.wakes[0]).toContain('thread zucchini settled: 2 chirps')
      expect(factsQuery(s)[0]).toContain('NOT thread=pie-requests')
    })

    test('without a note the defaults stand: two chirps are too few', async ($, on) => {
      const s = settleSession(on, two)
      await start($, s)
      expect(s.wakes).toEqual([])
      expect(factsQuery(s)[0]).not.toContain('pie-requests')
    })

    test('EP0CH_SETTLE_TUNING beats the note, and the note is not even asked for', async ($, on) => {
      const s = settleSession(on, two, LOKI, { EP0CH_SETTLE_TUNING: 'chirps=5' }, false, {}, { tuning: { garden: [NOTE] } })
      await start($, s)
      expect(s.wakes).toEqual([])
      expect(s.session.runs.some(r => r.argv.includes('type=capability AND (settle-tuning OR settle-outlines)'))).toBe(false)
    })

    test('a note whose tuning does not read is one toast naming it, and the defaults stand', async ($, on) => {
      const s = settleSession(on, two, LOKI, {}, false, {}, { tuning: { garden: [{ ...NOTE, tuning: 'chirps=many' }] } })
      await start($, s)
      expect(s.wakes).toEqual([])
      expect(s.session.toasts.filter(t => t.includes(`settle-tuning on ((${CAPABILITY}))`))).toHaveLength(1)
    })

    test('an outline that cannot answer the tuning lookup leaves the check undone, so another outline\'s older tuning is not taken for the newest', async ($, on) => {
      const s = settleSession(on, {}, LOKI, { EP0CH_SETTLE_OUTLINES: 'gurgle, pie' }, false, { gurgle: two, pie: two }, { tuning: { gurgle: [NOTE] }, tuningFails: ['pie'] })
      await start($, s)
      expect(s.wakes).toEqual([])
      expect(s.asked()).toBe(0)
      expect(s.session.toasts.filter(t => t.includes('pie could not be read for its settle settings: the host timed out'))).toHaveLength(1)
    })

    test('the folder config is never read for it: a settle-tuning line in .ep0ch/config.toml counts for nothing', async ($, on) => {
      const s = settleSession(on, two, LOKI, {}, false, {}, { toml: "ws = 'garden'\nsettle-tuning = 'chirps=2'\n" })
      await start($, s)
      expect(s.wakes).toEqual([])
    })
  })

  test('a host that cannot answer list --facets is one toast and no wake', async ($, on) => {
    const s = settleSession(on, { zucchini: { count: 4, evan: 2, ago: 90 } }, LOKI, {}, true)
    await start($, s)
    expect(s.wakes).toEqual([])
    expect(s.session.toasts.filter(t => t.includes('list --facets'))).toHaveLength(1)
  })
})
