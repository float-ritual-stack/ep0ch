import type { EngineInterface, On, PluginOptions, RenderElement, RenderInput, RenderSurface, UiOpenResult } from 'claude-code'

import {
  boundWorkspaceOf,
  effectiveWorkspaces,
  failureReasonOf,
  isIngestible,
  type MentionMessage,
  mentionMessageOf,
  mentionsModeOf,
  sessionWorkspaceOf,
  type Workspace,
  doorWorkspaceOf,
  workspaceEnvOf,
  workspaceForCwd,
} from './mention-message'
import {
  isProtectedDestination,
  linkifyReferences,
  outlinerBlockIdOf,
  outlinerLabelOf,
  outlinerReferenceOf,
  outlinerUriFor,
  outlinerUriOf,
} from './references'
import { actorOf, doorActorOf, machineNameOf, checkedInput, COMPONENTS_TOOL, componentsArgv, DOOR_TOOLS, doorActArgv, OUTLINE_TOOLS, peekOf, SHOW_TOOL } from './outline-tools'
import { WORK_TOOLS, withOptions } from './work-tools'
import { type StatusInput } from './program-status'
import { notified, permissionAsked, PST_ARGV, questionAsked, sequenceOf, sessionEnded, sessionStarted, statusSetting, stopFailed, ttyArgv, turnEnded, working } from './claude-status'
import { projectOf, touchInputOf, touchOf } from './file-touches'
import { fileRefOf, threadedPathOf, threadsHeldNote } from './file-threads'
import {
  FILE_DIFF_REF,
  FILE_REF,
  FILE_TOOLS,
  fileRowOf,
  idsToTitle,
  READ_TOOLS,
  TOOL_PREFIX,
  TOOL_ROWS_COMMAND,
  TOOL_ROWS_STORE_KEY,
  TOOL_ROWS_USAGE,
  toolResultLineOf,
  toolRowOf,
  type ToolRowElements,
  toolRowsCommandOf,
  toolRowsPrefsOf,
  toolRowTree,
  WRITE_TOOLS,
} from './tool-rows'
import {
  bandHasContent,
  choicesText,
  COMMAND_USAGE,
  commandChoice,
  mentionRowsOf,
  mentionsListArgs,
  mentionsTree,
  opensIn,
  PANE_ID as MENTIONS_PANE,
  PREFS_STORE_KEY,
  PREVIEW_ROWS,
  prefsOf,
  previewedRows,
  previewWidthOf,
  DEFAULT_PREFS,
  type SiteElements,
} from './mentions-view'
import { BlockView, type BlockViewElements, type BlockViewProps, type BlockViewSource, blockViewId, ep0chHelp, loadBlockView, viewColumns } from './block-view'
import {
  currentOf,
  DETAIL_ROWS,
  detailSourceOf,
  detailTree,
  historyOf,
  knowsExport,
  listed,
  moved,
  pushed,
  routeOf,
  exportArgv,
  exportBodyOf,
  SUBTREE_LIMIT,
  subtreeMarkdownOf,
  type DetailElements,
} from './detail-view'
import type { DetailEntry, DetailSource, MentionRow, MentionsList, MentionsPrefs } from '../types'
import {
  type DoorEnv,
  doorTileOf,
  envSummaryOf,
  inDoorEnv,
  WHERE_BLOCK,
  WHERE_TIMEOUT_MS,
  WHERE_WAIT_MS,
  whereSummaryOf,
  whereText,
  reachText,
} from './where'
import {
  BINDING_BLOCK,
  BINDING_COMMAND,
  type BindingFacts,
  bindingText,
  cardLines,
  type CardElements,
  cardTree,
  type FolderFacts,
  statusLine,
  type WhereFacts,
  whereFactsOf,
} from './binding'

type AbovePromptRender = RenderInput<'AbovePrompt'>
/** The binding card's state: written here, in this file, as the engine lists what a module reads and writes. */
const BINDING_STATE = { plugin: 'pi-outliner', key: 'binding' } as const
/** One run of `ep0ch where --json`: its summary (null: it didn't answer) and the facts the binding card reads. */
type WhereRun = { summary: string | null; facts: WhereFacts | null; why?: string }

/**
 * What drawing a reply needs, read once per session: the Outliner workspace the
 * session belongs to (null: its folder is bound to no outline, or opted out;
 * nothing is linked) and its Work-ID prefixes. A render hook only reads, so
 * this is loaded beside it, not in it.
 */
type ReferenceContext = { workspace: Workspace | null; prefixes: string[]; why?: string; optedOut?: string }
let references: ReferenceContext | undefined
/** The load in flight, so a tool call made while the session starts waits for it rather than being refused. */
let loadingReferences: Promise<void> | undefined
/** Its first half in flight: the session's workspace found (`references.workspace` set), before the Work-ID prefixes. */
let loadingWorkspace: Promise<void> | undefined
/**
 * The environment an Outliner CLI run gets for one workspace: its bound
 * folder, and the outline its `.ep0ch` names, so the run lands on that outline
 * whatever Claude's environment says.
 */
const envFor = workspaceEnvOf
/** Each reason the session's workspace could not be found is toasted once. */
const toldWorkspaceFailures = new Set<string>()
/** Shows run one at a time, so concurrent clicks and tool calls split one pane. */
let showQueue: Promise<unknown> = Promise.resolve()
/**
 * `ep0ch where --json`, run once at session.start (and again when the binding
 * is read again): its summary for the first prompt's context in a door, and
 * the facts the binding card reads.
 */
let whereLoad: Promise<WhereRun> | undefined
/** Where this Claude is bound (hooks/binding.ts): the load in flight, and when the last one started (the session clock). */
let bindingLoad: Promise<BindingFacts> | undefined
let bindingReadAt = -Infinity
/**
 * Program status (OSC 7501, hooks/claude-status.ts): whether this terminal takes it (asked once), the report last sent
 * (the same one twice is sent once), and the sends in order, each after the one before.
 */
let statusWanted: Promise<boolean> | undefined
let statusSent = ''
let statusChain: Promise<void> = Promise.resolve()
/** The last report asked for (sent or not): what a later event's report is weighed against. */
let statusAsked: StatusInput | null = null

/** Say what this Claude is doing to its terminal, off the event's dispatch, in order. Nothing when the terminal doesn't speak it. */
function reportStatus($: EngineInterface, r: StatusInput): void {
  statusAsked = r
  statusChain = statusChain.then(async () => {
    statusWanted ??= (async () => statusSetting(await $.env.get('EP0CH_PROGRAM_STATUS'))
      ?? (!!(await $.env.get('TERM')) && (await $.process.run([...PST_ARGV]).then(x => x.exitCode === 0, () => false))))()
    if (!(await statusWanted)) return
    const seq = sequenceOf(r)
    if (seq === statusSent) return
    // Remembered as sent only once it was: a failed write is tried again with the next report, even the same one.
    const ran = await $.process.run(ttyArgv(seq), { timeoutMs: 3000 })
    statusSent = ran.exitCode === 0 ? seq : ''
  }).catch(() => {})
}

/** A turn reads the binding again at most this often, so a door upgrade or reconnect shows within a turn or two. */
const BINDING_REFRESH_MS = 30_000
/** How long the first prompt waits for the binding before saying it is still being looked up: as long as for `where`. */
const BINDING_WAIT_MS = WHERE_WAIT_MS

/**
 * Registers Recent Mentions: each completed main-loop answer in a folder bound
 * to an outline goes to that outline, as the Codex Stop hook sends Codex's.
 *
 * The session's workspace is its folder's nearest bound ancestor, resolved by
 * the installed CLI the way every client resolves it (`sessionWorkspace`). An
 * unbound folder feeds nothing. The `workspaces` option, or, left empty,
 * `PI_OUTLINER_MENTIONS_WORKSPACES`, lists folders opted out; with the `mode`
 * option or `PI_OUTLINER_MENTIONS_MODE` set to `allowlist` they are instead
 * the only folders that feed (the strict mode). The engine hands an unset string
 * option over as '', so empty and unset are one case: an empty option cannot
 * override the environment.
 *
 * The answer passes on untouched. Delivery runs off the turn's dispatch, so a
 * slow or absent service never delays the prompt; a failure is one toast.
 *
 * In the same workspaces, Work IDs, `[[pages]]` and `((block references))` in
 * Claude's replies are drawn as links; a click opens the target where `show`
 * and `door_open` do (`openNote`): the door this session runs in, else the
 * Outliner Detail beside Claude in Herdr, else a toast with the `((id))` to copy.
 */
export function register(on: On, options: PluginOptions): void {
  const option = options
  // Recent mentions in Claude Code itself (hooks/mentions-view.ts): a band above the prompt or a pane, over the
  // outline's own mentions.list, each press opened by openNote like every other click.
  // The band above the prompt: the binding card (at the start and after /clear, until hidden) over Recent mentions.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [card, below] = await Promise.all([$.state.get(BINDING_STATE).then(({ value }) => value), mentionsBand($, e, next, option)])
    if (e.props.hasSurvey || !card?.shown) return below.tree
    const ui = $.ui.resolve(e) as unknown as CardElements
    // Beside Recent mentions, or in a short band, the card says the binding alone, so the mentions' keys stay on screen.
    const compact = below.isMentions || e.props.maxRows < 16
    const drawn = cardTree(ui, card.facts ?? null, {
      columns: e.props.bodyColumns, compact,
      hide: () => void (async () => $.state.set(BINDING_STATE, { facts: (await $.state.get(BINDING_STATE)).value?.facts ?? null, shown: false }))(),
    })
    return ui.Box({ flexDirection: 'column', children: [drawn, below.tree] })
  })

  on('ui.render', { component: 'Pane', requestId: MENTIONS_PANE }, async ($, e) => {
    const [, history] = await Promise.all([mentionsListOf($), detailHistoryOf($)])
    const workspace = references?.workspace
    if (!workspace) return $.ui.resolve(e).Text({ dimColor: true, children: references ? NOT_BOUND : "Finding this folder's outline…" })
    // A drawing that throws makes the engine drop the pane (`ui.close`, origin unload): say why in it instead.
    try {
      // No door or Herdr around: a note opened here shows in the pane in place of the list (hooks/detail-view.ts).
      if (history.isShown) return await drawDetail($, e, $.ui.resolve(e) as unknown as DetailElements & BlockViewElements, e.props.bodyColumns)
      return await drawMentions($, e, $.ui.resolve(e) as unknown as SiteElements, 'pane', e.props.bodyColumns, workspace, option)
    } catch (error) {
      return $.ui.resolve(e).Text({ dimColor: true, children: `Recent mentions could not be drawn: ${error instanceof Error ? error.message : String(error)}` })
    }
  })

  // `m` (to the pane, or back to the band) in the press's own hook: an open made with this `$` answers the person's
  // press, so the engine places the pane at any width. One made from the drawing's closure is the plugin's own, and
  // waits below 144 columns: the pane never showed and the band was gone.
  on('ui.press', { plugin: 'pi-outliner', element: 'mentions-move' }, async ($, e) => {
    const placement = e.component === 'Pane' ? 'band' : 'pane'
    await chooseMentions($, x => ({ ...x, placement }), option, true)
    return { element: e.element }
  })

  // The person closing the pane (its mark, ctrl+x x) is their choice too: kept as hidden. Any other close (the
  // engine dropping it) leaves the choice, and the band stands in for it.
  // A pane opened only for a note (the band the choice) closed by them leaves the band; the pane opens on the list next.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    const prefs = await mentionsPrefsOf($)
    if (e.id === MENTIONS_PANE && e.origin.kind === 'person' && prefs.placement === 'pane') await keepMentionsPrefs($, { ...prefs, placement: 'off' })
    if (e.id === MENTIONS_PANE) await $.state.set(DETAIL, listed(await detailHistoryOf($)))
    if (e.id === MENTIONS_PANE) $.ui.invalidate('ui.render')
    return result
  })

  // A press that opens a note here (a mention, a reference in a reply, a tool row's note) seats the mentions pane from the press itself: an open made with the press's `$`
  // answers the person, so the engine places it at any width (openNote's open that follows finds it up). In a door
  // or Herdr nothing is seated: the note opens there.
  on('ui.press', { plugin: 'pi-outliner' }, async ($, e, next) => {
    const opensNote = /^mention-\d+$/.test(e.element) || e.element.startsWith('tool-row-open-') ||
      (e.element === 'outliner-references' && !!e.link && outlinerUriOf(e.link.href) !== null)
    // The cached variables read without waiting, so the press reaches its closure before anything queued after it.
    if (opensNote && references?.workspace && routeOf(routeEnv ?? await routeEnvOf($)) === 'here') {
      await $.ui.open({ id: MENTIONS_PANE, title: MENTIONS_TITLE }).catch(() => {})
    }
    return next(e)
  })

  on('command.run', { command: 'mentions' }, async ($, e) => {
    const choice = commandChoice(e.args)
    if (!choice) return { text: COMMAND_USAGE }
    const chosen = await chooseMentions($, choice.change, option, choice.places)
    await refreshMentions($, option)
    return { text: choicesText(chosen, chosen.placement !== 'pane' || await paneIsPlaced($)) }
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    reportStatus($, sessionStarted())
    sessionCwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : null
    // A session start (or the module's reload) starts mentions again: the command, the kept choices, the list.
    mentionsStarting = undefined
    $.clock.after(0, () => void startMentionsOnce($, option))
    // Off the start's dispatch: a slow or missing `ep0ch` never holds the session up. The binding card shows from
    // the start (saying it is looking) and fills in when `where` and the folder's outline are read.
    whereLoad = new Promise(resolve => {
      $.clock.after(0, () => void runWhere($).then(resolve, () => resolve({ summary: null, facts: null, why: 'ep0ch where failed' })))
    })
    bindingLoad = undefined
    bindingGiven = undefined
    await $.state.set(BINDING_STATE, { shown: true, facts: (await $.state.get(BINDING_STATE)).value?.facts ?? null })
    $.ui.status(statusLine(null))
    $.clock.after(0, () => void readBinding($, option, false).catch(() => {}))
    await $.tool.register({ name: SHOW_TOOL.name, description: SHOW_TOOL.description, inputSchema: SHOW_TOOL.inputSchema })
    // Off the start's dispatch: each registration republishes the tool server (~20ms), and these tools are
    // loaded on demand, so the session never waits for them. The door tools act in the door this Claude runs
    // in: only in a door tile, where EP0CH_CONTROL names it.
    $.clock.after(0, () => void (async () => {
      // Offered when a door is reachable (PIE-715): EP0CH_CONTROL, or, for a Claude that does not descend from a tile
      // (a background job, a resumed session), the door of the folder's outline, by `ep0ch where`'s own resolution.
      const door = (await $.env.get('EP0CH_CONTROL'))?.trim() || (await whereLoad)?.facts?.reach?.control
      const tools = [...WORK_TOOLS, ...OUTLINE_TOOLS, COMPONENTS_TOOL, ...(door ? DOOR_TOOLS : [])]
      for (const tool of tools) {
        await $.tool.register({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
      }
    })().catch(() => {}))
    return result
  })

  // Where this session runs, as one context block of the first prompt (not a pane): waited for briefly, else
  // the variables alone. Nothing is added outside a door, and a failure adds nothing.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    try {
      const env = await doorEnvOf($)
      // Before session.start's work is queued (or after a reload): start it once, here.
      const load = (whereLoad ??= runWhere($).catch(() => ({ summary: null, facts: null })))
      const facts = (bindingLoad ?? readBinding($, option, false)).catch(() => null)
      const [ran, bound] = await Promise.all([
        inDoorEnv(env) ? Promise.race([load, $.clock.sleep(WHERE_WAIT_MS).then(() => null)]) : null,
        Promise.race([facts, $.clock.sleep(BINDING_WAIT_MS).then(() => null)]),
      ])
      const blocks = result.blocks.filter(b => b.name !== WHERE_BLOCK && b.name !== BINDING_BLOCK)
      if (inDoorEnv(env)) blocks.push({ name: WHERE_BLOCK, text: whereText(ran?.summary ?? envSummaryOf(env)) })
      else if (bound?.where?.reach?.control && bound.where.reach.rule !== 'control') blocks.push({ name: WHERE_BLOCK, text: reachText(bound.where.reach) })
      bindingGiven = bound ? bindingText(bound) : null
      blocks.push({
        name: BINDING_BLOCK,
        // Still looking: the context is made again when it lands (readBinding).
        text: bindingGiven ?? 'Which outline this Claude session is bound to is still being looked up.',
      })
      return { ...result, blocks }
    } catch {
      return result
    }
  })

  // /clear starts the conversation afresh: the card shows again, read anew, and the next first prompt carries it.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    // Its program status: a /clear is a fresh conversation at its prompt; an end takes the record away.
    reportStatus($, e.reason === 'clear' ? sessionStarted() : sessionEnded())
    if (e.reason !== 'clear') return result
    // The next conversation's first prompt reads this one, never the read before the /clear.
    bindingGiven = undefined
    void readBinding($, option, true).catch(() => {})
    await $.state.set(BINDING_STATE, { shown: true, facts: (await $.state.get(BINDING_STATE)).value?.facts ?? null })
    return result
  })

  // `/outline`: the card again, read anew, and its words in the transcript.
  on('command.run', { command: BINDING_COMMAND }, async ($) => {
    const facts = await readBinding($, option, true)
    await $.state.set(BINDING_STATE, { shown: true, facts })
    return { text: cardLines(facts).map(l => `${l.label ? `${l.label}: ` : ''}${l.text}`).join('\n') }
  })

  for (const tool of WORK_TOOLS) {
    on('tool.call', { tool: `mcp__pi-outliner__${tool.name}` }, async ($, e) => {
      const checked = checkedInput(tool, e as Record<string, unknown>)
      if (typeof checked === 'string') return { deny: checked }
      const command = tool.command(checked.input)
      if (typeof command === 'string') return { deny: command }
      if (!references?.workspace) await loadReferences($, option)
      const workspace = references?.workspace
      if (!workspace) return { deny: references?.why ? `No Outliner outline for this session: ${references.why}` : NOT_BOUND }
      try {
        return { result: await runWorkCommand($, workspace, command, await actorFor($, {})) }
      } catch (error) {
        return { deny: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  for (const tool of OUTLINE_TOOLS) {
    on('tool.call', { tool: `mcp__pi-outliner__${tool.name}` }, async ($, e) => {
      const checked = checkedInput(tool, e as Record<string, unknown>)
      if (typeof checked === 'string') return { deny: checked }
      const input = checked.input
      const command = tool.command(input)
      if (typeof command === 'string') return { deny: command }
      if (!references?.workspace) await loadReferences($, option)
      const workspace = references?.workspace
      if (!workspace) return { deny: references?.why ? `No Outliner outline for this session: ${references.why}` : NOT_BOUND }
      // outline_changes' `actor` filters by agent; every other tool's names who the write is attributed to.
      const actor = await actorFor($, tool.name === 'outline_changes' ? {} : input)
      try {
        return { result: await runOutlinerCli($, workspace, ['agent', command.operation, '--stdin', '--actor', actor], JSON.stringify(command.input)) }
      } catch (error) {
        return { deny: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  // The library's brief, from the session's outline: `ep0ch` is the door's CLI, run in the bound folder.
  on('tool.call', { tool: `mcp__pi-outliner__${COMPONENTS_TOOL.name}` }, async ($, e) => {
    const checked = checkedInput(COMPONENTS_TOOL, e as Record<string, unknown>)
    if (typeof checked === 'string') return { deny: checked }
    const command = componentsArgv(checked.input)
    if (typeof command === 'string') return { deny: command }
    if (!references?.workspace) await loadReferences($, option)
    const workspace = references?.workspace
    if (!workspace) return { deny: references?.why ? `No Outliner outline for this session: ${references.why}` : NOT_BOUND }
    const ran = await $.process.run(command.argv, { cwd: workspace.root, env: envFor(workspace), timeoutMs: 30_000 })
      .catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))
    if (ran.exitCode !== 0) return { deny: failureReasonOf(ran.stderr) || ran.stderr.trim() || 'ep0ch library --brief failed' }
    return { result: ran.stdout.trim() }
  })

  for (const tool of DOOR_TOOLS) {
    on('tool.call', { tool: `mcp__pi-outliner__${tool.name}` }, async ($, e) => {
      const reached = await doorReachFor($)
      if (!reached.control) return { deny: `No door is reachable from here: ${reached.text}` }
      const control = reached.control
      const checked = checkedInput(tool, e as Record<string, unknown>)
      if (typeof checked === 'string') return { deny: checked }
      try {
        return { result: await runDoorTool($, tool.name, checked.input, control, option) }
      } catch (error) {
        return { deny: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  on('tool.call', { tool: 'mcp__pi-outliner__show' }, async ($, e) => {
    // A plugin tool's arguments arrive flat on the event, beside `tool`.
    const checked = checkedInput(SHOW_TOOL, e as Record<string, unknown>)
    if (typeof checked === 'string') return { deny: checked }
    const reference: unknown = checked.input.ref
    const uri = typeof reference === 'string' ? outlinerUriFor(reference) : null
    if (!uri) return { deny: 'Give the ref: a Work ID, [[page]], ((block-uuid)) or pi-outliner:// URI to show.' }
    if (!references?.workspace) await loadReferences($, option)
    try {
      return { result: shownText(await openNote($, references?.workspace ?? null, uri, await doorActorFor($, {})), String(reference)) }
    } catch (error) {
      return { deny: deniedText(error, String(reference)) }
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const workspace = references?.workspace
    if (!workspace) return next(e)
    const { text, hrefs } = linkifyReferences(e.props.text, references!.prefixes)
    if (hrefs.length === 0 || text.length > 10_000) return next(e)
    const { Box, Text, Markdown } = await $.ui.resolve(e)
    return Box({
      flexDirection: 'row',
      children: [
        Box({ width: 2, flexShrink: 0, children: Text({ children: e.props.isFirstOfReply ? '⏺' : '' }) }),
        Box({
          flexGrow: 1,
          flexShrink: 1,
          children: Markdown({
            key: 'outliner-references',
            text,
            pressableLinks: hrefs.slice(0, 256),
            onLinkPress: (link, press) => void openReference($, workspace, link.href, press.surface),
          }),
        }),
      ],
    })
  })

  // The mod's own tool calls as compact rows that fold open on what they wrote (hooks/tool-rows.ts). Anything the
  // formatter doesn't recognise, a drawing that throws, or the person's `/tool-rows off` leaves the engine's row.
  // Claude Code's Edit and Write rows too (PIE-602): the file, the lines added and removed, pressed it opens in the door.
  for (const tool of [...[...WRITE_TOOLS, ...READ_TOOLS].map(name => `${TOOL_PREFIX}${name}`), ...FILE_TOOLS]) {
    on('ui.render', { component: 'ToolUse', props: { tool } }, async ($, e, next) => {
      try {
        const open = { ...TOOL_ROW_OPEN, id: e.props.tool_use_id }
        const [prefs, expanded, titles] = await Promise.all([
          $.state.get(TOOL_ROWS_PREFS).then(({ value }) => toolRowsPrefsOf(value)),
          $.state.get(open).then(({ value }) => value === true),
          toolTitlesOf($, e.props),
        ])
        if (!prefs.enabled) {
          drawnToolRows.delete(e.props.tool_use_id)
          return next(e)
        }
        const row = (FILE_TOOLS as readonly string[]).includes(tool) ? fileRowOf(e.props, sessionCwd ?? undefined) : toolRowOf(e.props, id => titles.get(id))
        if (!row) {
          drawnToolRows.delete(e.props.tool_use_id)
          return next(e)
        }
        const tree = toolRowTree($.ui.resolve(e) as unknown as ToolRowElements, row, {
          id: e.props.tool_use_id,
          expanded,
          toggle: () => void (async () => $.state.set(open, !(await $.state.get(open)).value))(),
          open: (ref, surface) => void openToolTarget($, ref, surface),
        })
        drawnToolRows.add(e.props.tool_use_id)
        return tree
      } catch {
        drawnToolRows.delete(e.props.tool_use_id)
        return next(e)
      }
    })
    // The row already says what happened: the result is one line (`✓ rev 2`), or nothing for a read. Errors in full.
    on('ui.render', { component: 'ToolResult', props: { tool } }, async ($, e, next) => {
      try {
        // Only under a row the mod drew: where the call's row is the engine's, so is its result.
        if (!toolRowsPrefsOf((await $.state.get(TOOL_ROWS_PREFS)).value).enabled || !drawnToolRows.has(e.props.tool_use_id)) return next(e)
        const line = toolResultLineOf(e.props.tool, e.props.output, e.props.isErrored)
        if (line === null) return next(e)
        const { Box, Text } = $.ui.resolve(e)
        return line ? Box({ paddingLeft: 2, children: Text({ dimColor: true, children: `⎿  ${line}` }) }) : Box({})
      } catch {
        return next(e)
      }
    })
  }

  // Each file an Edit or Write changed, recorded in the session's outline after the call ran (PIE-602): off the call, so
  // the tool's answer never waits for the outline, and one at a time, so a file's touches count up in order.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const held = await holdForThreads($, option, e)
    if (held) return { deny: held }
    const result = await next(e)
    queueTouch($, option, e, result)
    return result
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const held = await holdForThreads($, option, e)
    if (held) return { deny: held }
    const result = await next(e)
    queueTouch($, option, e, result)
    return result
  })

  on('command.run', { command: TOOL_ROWS_COMMAND }, async ($, e) => {
    const chosen = toolRowsCommandOf(e.args)
    if (!chosen) return { text: `${TOOL_ROWS_USAGE} Now ${toolRowsPrefsOf((await $.state.get(TOOL_ROWS_PREFS)).value).enabled ? 'on' : 'off'}.` }
    await $.state.set(TOOL_ROWS_PREFS, chosen)
    await $.store.set(TOOL_ROWS_STORE_KEY, chosen)
    return { text: chosen.enabled ? 'Outline tool rows on: the outline and workboard tool calls draw as compact rows; ▸ unfolds what each wrote.' : "Outline tool rows off: Claude Code's own rows draw the outline tools." }
  })

  // What this Claude is doing, to its terminal (OSC 7501; hooks/claude-status.ts has the events and why).
  on('turn.start', async ($, e, next) => { reportStatus($, working()); return next(e) })
  on('classic.PermissionRequest', async ($, e, next) => {
    const result = await next(e)
    // A hook that answered it (allow or deny) shows no dialog: nothing waits on the person.
    if (!result.decision) reportStatus($, permissionAsked(e.tool_name, e.tool_input))
    return result
  })
  on('classic.Notification', async ($, e, next) => {
    const r = notified(e.notification_type, e.message)
    // The dialog's own PermissionRequest said what it asks ("Allow Bash: …?"): its generic notification doesn't replace that.
    if (r && !(r.kind && statusAsked?.state === 'blocked' && statusAsked.kind === r.kind)) reportStatus($, r)
    return next(e)
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    reportStatus($, questionAsked(e.input))
    try { return await next(e) } finally { reportStatus($, working()) }
  })
  // The tool ran, failed or was denied after its dialog: Claude goes on.
  on('classic.PostToolUse', async ($, e, next) => { reportStatus($, working()); return next(e) })
  on('classic.PostToolUseFailure', async ($, e, next) => { reportStatus($, working()); return next(e) })
  on('classic.PermissionDenied', async ($, e, next) => { reportStatus($, working()); return next(e) })
  on('classic.StopFailure', async ($, e, next) => { reportStatus($, stopFailed(e.error, e.error_details)); return next(e) })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // The main loop's turn (a subagent's isn't the session's): done, idle when interrupted, error when it failed.
    if (e.agentId === undefined) reportStatus($, turnEnded(e.reason, e.answer))
    // A module reloaded mid-session never sees its session.start.
    if (!references) $.clock.after(0, () => void loadReferences($, option))
    // The binding read again now and then, so the status line follows a door's upgrade or reconnect, or a new .ep0ch.
    else if ((await $.clock.now()) - bindingReadAt >= BINDING_REFRESH_MS) $.clock.after(0, () => void readBinding($, option, true).catch(() => {}))
    if (!isIngestible(e)) return result
    // Off the turn's dispatch: finding the folder's outline runs the CLI, and a slow one never delays the answer.
    $.clock.after(0, () => void (async () => {
      let workspace: Workspace | null
      try {
        workspace = await sessionWorkspace($, option, 'mentions')
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (toldWorkspaceFailures.has(reason)) return
        toldWorkspaceFailures.add(reason)
        $.ui.toast(`Outliner recent mentions unavailable: ${reason}`, { timeoutMs: 6000 })
        return
      }
      const message = mentionMessageOf(e, { id: await $.session.id() }, workspace)
      if (!message || !workspace) return
      try {
        await deliver($, message, workspace)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        $.ui.toast(`Outliner recent mentions unavailable: ${reason}`, { timeoutMs: 6000 })
        return
      }
      // The band and pane read the list again; a failure there never touches the delivery.
      await refreshMentions($, option).catch(() => {})
    })())
    return result
  })
}

/** Recent mentions in the band (`isMentions`), or the engine's band (`next`) when there are none to show. */
async function mentionsBand($: EngineInterface, e: AbovePromptRender, next: (e: AbovePromptRender) => Promise<RenderElement>, option: PluginOptions): Promise<{ tree: RenderElement; isMentions: boolean }> {
  const engine = async () => ({ tree: await next(e), isMentions: false })
  // Read before anything else, so the band is drawn again when the list first lands (the outline is found then).
  const [prefs, list] = await Promise.all([mentionsPrefsOf($), mentionsListOf($)])
  // A module reloaded mid-session may not see its session.start: start mentions off the draw, once.
  if (!mentionsStarting) $.clock.after(0, () => void startMentionsOnce($, option))
  const workspace = references?.workspace
  if (e.props.hasSurvey || !workspace || prefs.placement === 'off' || !bandHasContent(list)) return engine()
  // The pane chosen but not on screen (it waits below the width an unasked pane needs, or the engine dropped it):
  // the band stands in, its `m` showing the pane, so the mentions never vanish.
  if (prefs.placement === 'pane' && await paneIsPlaced($)) return engine()
  try {
    return { tree: await drawMentions($, e, $.ui.resolve(e) as unknown as SiteElements, 'band', e.props.bodyColumns, workspace, option), isMentions: true }
  } catch (error) {
    return { tree: $.ui.resolve(e).Text({ dimColor: true, children: `Recent mentions could not be drawn: ${error instanceof Error ? error.message : String(error)}` }), isMentions: true }
  }
}

const NOT_BOUND = "This session's folder is not bound to an Outliner outline (bind it with the choose-outline action), or it is opted out."

const PLUGIN_ID = 'float.pi-outliner'

async function doorEnvOf($: EngineInterface): Promise<DoorEnv> {
  const [EP0CH_NEST, EP0CH_CONTROL, EP0CH_TILE, EP0CH_TILE_ID] = await Promise.all([
    $.env.get('EP0CH_NEST'),
    $.env.get('EP0CH_CONTROL'),
    $.env.get('EP0CH_TILE'),
    $.env.get('EP0CH_TILE_ID'),
  ])
  return { EP0CH_NEST, EP0CH_CONTROL, EP0CH_TILE, EP0CH_TILE_ID }
}

/** Whether this session's `ep0ch` knows `where` (its help asked once): null until asked. */
/**
 * `ep0ch where --json`, in a door or not, run in the session's folder: its
 * one-line summary (null when it didn't answer: not on PATH, too old, an
 * error) and the facts the binding card reads. `where` only reads.
 */
async function runWhere($: EngineInterface): Promise<WhereRun> {
  try {
    const ran = await $.process.run(['ep0ch', 'where', '--json'], { cwd: await startFolderOf($), timeoutMs: WHERE_TIMEOUT_MS })
    if (ran.exitCode !== 0) return { summary: null, facts: null, why: failureReasonOf(ran.stderr) || '`ep0ch where` failed' }
    return { summary: whereSummaryOf(ran.stdout), facts: whereFactsOf(ran.stdout) }
  } catch {
    return { summary: null, facts: null, why: 'no `ep0ch` on PATH, or `ep0ch where` did not answer in time' }
  }
}

/** Each read of the binding is numbered: only the newest one writes the card and the status line. */
let bindingGeneration = 0
/** The binding text the first prompt's context was given (null: that it was still being looked up), to redo it on a change. */
let bindingGiven: string | null | undefined

/**
 * Reads where this Claude is bound: the folder's outline as the tools found it
 * (`references`, from `bound-folder`) and `ep0ch where --json`; then the card,
 * the status line and (when it changed) the model's context show it. `again`:
 * read both anew (a /clear, `/outline`, a turn now and then); else the
 * session's first reads are used. It waits for the workspace only, never the
 * Work-ID prefixes.
 */
function readBinding($: EngineInterface, option: PluginOptions, again: boolean): Promise<BindingFacts> {
  if (!again && bindingLoad) return bindingLoad
  const generation = ++bindingGeneration
  const where = again || !whereLoad ? runWhere($) : whereLoad
  whereLoad = where
  const load = (async () => {
    bindingReadAt = await $.clock.now()
    if (again || !references) {
      void loadReferences($, option)
      await loadingWorkspace
    }
    const [ran, cwd, home, control] = await Promise.all([where, $.session.cwd(), $.env.get('HOME'), $.env.get('EP0CH_CONTROL')])
    const facts: BindingFacts = {
      folder: folderFactsOf(),
      where: ran.facts,
      ...(ran.facts ? {} : { whereWhy: ran.why ?? '`ep0ch where` did not answer' }),
      cwd,
      ...(home ? { home } : {}),
      doorTools: !!control?.trim() || !!ran.facts?.reach?.control,
    }
    if (generation !== bindingGeneration) return facts
    await $.state.set(BINDING_STATE, { shown: (await $.state.get(BINDING_STATE)).value?.shown ?? true, facts })
    $.ui.status(statusLine(facts))
    // The model was told something else (or that it was still looking): its context is made again.
    if (bindingGiven !== undefined && bindingGiven !== bindingText(facts)) $.ui.invalidate('prompt.context')
    return facts
  })()
  bindingLoad = load
  return load
}

/** The folder's outline as the tools found it (`references`): bound, none named, opted out, or why it couldn't be found. */
function folderFactsOf(): FolderFacts {
  if (references?.workspace) return { kind: 'bound', workspace: references.workspace }
  if (references?.why) return { kind: 'failed', why: references.why }
  if (references?.optedOut) return { kind: 'opted-out', root: references.optedOut }
  return references ? { kind: 'unbound' } : { kind: 'failed', why: "the folder's outline was not read yet" }
}

/**
 * The installed Outliner's root, as Herdr reports it: exactly one enabled
 * `float.pi-outliner` with an absolute `plugin_root`. Never a guessed checkout.
 * Null when the plugin is installed but disabled.
 */
async function outlinerRootOf($: EngineInterface): Promise<string | null> {
  const listed = await $.process.run(
    ['herdr', 'plugin', 'list', '--plugin', PLUGIN_ID, '--json'],
    { timeoutMs: 5000 },
  )
  if (listed.exitCode !== 0) throw Error('Herdr could not discover the Outliner installation')
  const plugins: unknown = JSON.parse(listed.stdout)?.result?.plugins
  const matches = Array.isArray(plugins)
    ? plugins.filter(plugin => plugin?.plugin_id === PLUGIN_ID)
    : []
  if (matches.length !== 1) throw Error(`Expected one installed ${PLUGIN_ID} plugin`)
  const [plugin] = matches
  if (plugin.enabled === false) return null
  if (typeof plugin.plugin_root !== 'string' || !plugin.plugin_root.startsWith('/'))
    throw Error('Herdr did not report an absolute plugin_root')
  return plugin.plugin_root
}

/**
 * The workspace a session feeds (`mentions`) or works in (`tools`: the outline
 * tools and reference links), or null (`sessionWorkspaceOf`). Strict mode's
 * list limits only what feeds; the tools follow the folder's binding.
 * In folder mode the installed CLI's `bound-folder` says which folder, from
 * the session's cwd up, is bound to an outline; an opted-out folder never
 * asks. A disabled Outliner is null; a CLI that cannot answer (one older than
 * `bound-folder`) throws with why, and nothing is fed.
 */
async function sessionWorkspace($: EngineInterface, options: PluginOptions, purpose: 'mentions' | 'tools', note: { optedOut?: string } = {}): Promise<Workspace | null> {
  const [listedEnv, modeEnv, home, cwd] = await Promise.all([
    $.env.get('PI_OUTLINER_MENTIONS_WORKSPACES'),
    $.env.get('PI_OUTLINER_MENTIONS_MODE'),
    $.env.get('HOME'),
    startFolderOf($),
  ])
  const listed = effectiveWorkspaces(options.workspaces, listedEnv, home)
  const mode = mentionsModeOf(options.mode, modeEnv, listed)
  const listedHere = workspaceForCwd(cwd, listed)
  // In folder mode a listed folder is opted out: said on the binding card as it is, never worked out again there.
  if (mode === 'folder' && listedHere !== null) note.optedOut = listedHere
  // Strict mode limits what feeds Recent Mentions; the tools and links still work in any bound folder.
  if (mode === 'allowlist' ? purpose === 'mentions' || listedHere !== null : listedHere !== null) return sessionWorkspaceOf(cwd, mode, listed, null)
  // A remote socket in Claude's environment would take every CLI run elsewhere than the folder's binding.
  const socket = await $.env.get('EP0CH_SOCKET')
  if (socket?.trim()) {
    throw Error("EP0CH_SOCKET in Claude's environment would send it to another machine's host than this folder's outline; unset it, or use strict mode (PI_OUTLINER_MENTIONS_MODE=allowlist)")
  }
  const root = await outlinerRootOf($)
  if (!root) return null
  const ran = await $.process.run(
    ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/cli.ts`, 'bound-folder', cwd],
    { cwd, timeoutMs: 30_000 },
  )
  if (ran.exitCode !== 0) {
    const reason = failureReasonOf(ran.stderr)
    throw Error(/Unknown command: bound-folder/.test(reason)
      ? "the installed Outliner is too old to find this folder's outline (no bound-folder); update it"
      : `bound-folder failed${reason ? `: ${reason}` : ''}`)
  }
  const bound = boundWorkspaceOf(ran.stdout, cwd)
  if (mode === 'allowlist') return bound
  const folderWorkspace = sessionWorkspaceOf(cwd, mode, listed, bound)
  // In a door tile the door's outline is the binding (PIE-755), whatever the folder says; opted-out folders stay off.
  if (purpose === 'tools' && (await $.env.get('EP0CH_CONTROL'))?.trim()) {
    return doorWorkspaceOf((await (whereLoad ?? runWhere($))).facts?.door, cwd, folderWorkspace)
  }
  return folderWorkspace
}

/**
 * The folder this session started in: the one its outline binding follows. A shell `cd` never moves it
 * (PIE-755); a new session, a /clear and `/outline` read it anew.
 */
async function startFolderOf($: EngineInterface): Promise<string> {
  return sessionCwd ?? (sessionCwd = await $.session.cwd())
}

/**
 * Posts one message through the installed CLI's `mentions ingest`. The
 * session's workspace selects the outline, never this process's cwd; an
 * existing connection override in the environment is kept, and no service is
 * started.
 */
async function deliver($: EngineInterface, message: MentionMessage, workspace: Workspace): Promise<void> {
  const root = await outlinerRootOf($)
  if (root === null) return
  const ingested = await $.process.run(
    ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/cli.ts`, 'mentions', 'ingest'],
    {
      cwd: workspace.root,
      env: envFor(workspace),
      stdin: JSON.stringify(message),
      timeoutMs: 30_000,
    },
  )
  if (ingested.exitCode !== 0) {
    const reason = failureReasonOf(ingested.stderr)
    throw Error(`mentions ingest failed${reason ? `: ${reason}` : ''}`)
  }
}

/**
 * Runs one `work` / `note` command through the installed CLI in the session's
 * workspace, as Claude (agent author, this session as provenance). Resolves to
 * the command's JSON; a refusal throws with the CLI's reason.
 */
async function runWorkCommand(
  $: EngineInterface,
  workspace: Workspace,
  command: { args: string[]; stdin?: string },
  actor: string,
): Promise<string> {
  return runOutlinerCli($, workspace, withOptions(command.args, ['--author', 'agent', '--actor', actor]), command.stdin)
}

/**
 * Who this session's writes are attributed to: this client on this machine (`claude-code@float-2`), with the tool
 * call's `actor`, else OUTLINER_ACTOR, else EP0CH_AGENT (the door's name for the agent) as the persona on top
 * (`loki/claude-code@float-2`). The session id goes beside it as provenance.
 */
async function actorFor($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const [OUTLINER_ACTOR, EP0CH_AGENT, machine] = await Promise.all([$.env.get('OUTLINER_ACTOR'), $.env.get('EP0CH_AGENT'), machineName($)])
  return actorOf(input, { ...(OUTLINER_ACTOR ? { OUTLINER_ACTOR } : {}), ...(EP0CH_AGENT ? { EP0CH_AGENT } : {}) }, machine)
}

/** Who a door tool names as the agent (`--as`, door-open's `--actor`): the persona alone, as before. */
async function doorActorFor($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const [OUTLINER_ACTOR, EP0CH_AGENT] = await Promise.all([$.env.get('OUTLINER_ACTOR'), $.env.get('EP0CH_AGENT')])
  return doorActorOf(input, { ...(OUTLINER_ACTOR ? { OUTLINER_ACTOR } : {}), ...(EP0CH_AGENT ? { EP0CH_AGENT } : {}) })
}

/** This machine's name, asked once (`hostname`): what tells two machines' Claudes apart in a write's principal. Undefined when it can't be read. */
let machineKnown: string | undefined
async function machineName($: EngineInterface): Promise<string | undefined> {
  if (machineKnown) return machineKnown
  try {
    const ran = await $.process.run(['hostname'], { timeoutMs: 3_000 })
    if (ran.exitCode === 0) machineKnown = machineNameOf(ran.stdout)
  } catch { /* the bare client is the principal */ }
  return machineKnown
}

/** Runs the installed CLI in the session's workspace for a read: its whole result, any exit code. */
async function runOutliner($: EngineInterface, workspace: Workspace, args: string[]) {
  const root = await outlinerRootOf($)
  if (!root) throw Error('the Outliner plugin is disabled')
  return $.process.run(
    ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/cli.ts`, ...args],
    { cwd: workspace.root, env: envFor(workspace), timeoutMs: 30_000 },
  )
}

/**
 * Runs the installed CLI in the session's workspace with this session as the
 * write's provenance (`--session`). Resolves to its output; a refusal throws
 * with the CLI's reason.
 */
async function runOutlinerCli($: EngineInterface, workspace: Workspace, args: string[], stdin?: string): Promise<string> {
  const root = await outlinerRootOf($)
  if (!root) throw Error('the Outliner plugin is disabled')
  const sessionId = await $.session.id()
  const ran = await $.process.run(
    ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/cli.ts`, ...withOptions(args, ['--session', sessionId])],
    {
      cwd: workspace.root,
      env: envFor(workspace),
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs: 60_000,
    },
  )
  if (ran.exitCode !== 0) throw Error(failureReasonOf(ran.stderr) || `${args.slice(0, 2).join(' ')} failed`)
  return ran.stdout.trim()
}

/**
 * The door this session reaches now, by `ep0ch where --json` run in the session's folder (the one resolution, PIE-715):
 * EP0CH_CONTROL or its outline's session, else the folder's outline's door, else the only one. A stale EP0CH_CONTROL
 * never wins over a door that answers. `control` is null with no door, and `text` says why.
 */
async function doorReachFor($: EngineInterface): Promise<{ control: string | null; text: string }> {
  const given = (await $.env.get('EP0CH_CONTROL'))?.trim() || null
  const where = await runWhere($)
  const reach = where.facts?.reach
  if (reach?.control) return { control: reach.control, text: reach.text }
  // `ep0ch where` too old to resolve (or not answering): EP0CH_CONTROL as it is.
  if (!reach && given) return { control: given, text: 'EP0CH_CONTROL' }
  return { control: null, text: reach?.text || where.why || '`ep0ch where` did not answer' }
}

/**
 * One door tool through `ep0ch` on this session's door (EP0CH_CONTROL, passed
 * explicitly). Acting and opening are attributed with --as; the door's
 * refusal (an agent never takes the person's focus) throws with its reason.
 */
async function runDoorTool(
  $: EngineInterface,
  name: string,
  input: Record<string, unknown>,
  control: string,
  option: PluginOptions,
): Promise<string> {
  const ep0ch = async (argv: string[], stdin?: string) => {
    const ran = await $.process.run(argv, { cwd: await $.session.cwd(), env: { EP0CH_CONTROL: control }, ...(stdin === undefined ? {} : { stdin }), timeoutMs: 15_000 })
    if (ran.exitCode !== 0) throw Error(failureReasonOf(ran.stderr) || ran.stderr.trim() || `${argv.slice(0, 2).join(' ')} failed`)
    return ran.stdout
  }
  const compact = (stdout: string) => {
    try { return JSON.stringify(JSON.parse(stdout)) } catch { return stdout.trim() }
  }
  switch (name) {
    case 'door_where': {
      return compact(await ep0ch(['ep0ch', 'where', '--json']))
    }
    case 'door_peek':
      return JSON.stringify(peekOf(await ep0ch(['ep0ch', 'peek'])))
    case 'door_act': {
      const command = doorActArgv(input, await doorActorFor($, input))
      if (typeof command === 'string') throw Error(command)
      return compact(await ep0ch(command.argv, command.stdin))
    }
    case 'door_open': {
      // The same open as a click or `show`: in this door first (EP0CH_CONTROL is set, or the tool is refused).
      const ref = typeof input.ref === 'string' ? input.ref.trim() : ''
      const uri = ref ? outlinerUriFor(ref) : null
      if (!uri) throw Error('Give the ref of the note to open: its id, ((id)), [[page]] or Work ID.')
      if (!references?.workspace) await loadReferences($, option)
      try {
        return shownText(await openNote($, references?.workspace ?? null, uri, await doorActorFor($, input), control), ref)
      } catch (error) {
        throw Error(deniedText(error, ref))
      }
    }
    default:
      throw Error(`unknown door tool ${name}`)
  }
}

/**
 * Reads the session's workspace and Work-ID prefixes into `references`. A
 * session whose folder is bound to no outline, or opted out, links nothing; a
 * service that cannot answer leaves pages and block references linked, bare
 * IDs not.
 */
function loadReferences($: EngineInterface, option: PluginOptions): Promise<void> {
  if (loadingReferences) return loadingReferences
  const workspace = (loadingWorkspace = readWorkspace($, option))
  return (loadingReferences = workspace.then(() => readPrefixes($)).finally(() => {
    loadingReferences = undefined
    loadingWorkspace = undefined
  }))
}

/**
 * The first half of loadReferences: the session's workspace, as the tools use it. A workspace found again keeps
 * its Work-ID prefixes (links don't flicker while they are read again); a new one starts with none.
 */
async function readWorkspace($: EngineInterface, option: PluginOptions): Promise<void> {
  routeEnv = undefined
  await routeEnvOf($).catch(() => undefined)
  const note: { optedOut?: string } = {}
  let workspace: Workspace | null
  try {
    workspace = await sessionWorkspace($, option, 'tools', note)
  } catch (error) {
    // Why no outline could be found: the tools' refusal says it.
    references = { workspace: null, prefixes: [], why: error instanceof Error ? error.message : String(error) }
    return
  }
  if (!workspace) {
    references = { workspace: null, prefixes: [], ...(note.optedOut ? { optedOut: note.optedOut } : {}) }
    return
  }
  const same = references?.workspace && JSON.stringify(references.workspace) === JSON.stringify(workspace)
  references = { workspace, prefixes: same ? references!.prefixes : [] }
}

/** The second half: the workspace's Work-ID prefixes. A service that cannot answer leaves pages and block references linked, bare IDs not. */
async function readPrefixes($: EngineInterface): Promise<void> {
  const workspace = references?.workspace
  if (!workspace) return
  try {
    const root = await outlinerRootOf($)
    if (!root) return
    const status = await $.process.run(
      ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/cli.ts`, 'work-id-status'],
      { cwd: workspace.root, env: envFor(workspace), timeoutMs: 30_000 },
    )
    if (status.exitCode !== 0) return
    const { prefix, observedPrefixes } = JSON.parse(status.stdout) as { prefix?: unknown; observedPrefixes?: unknown }
    const prefixes = [prefix, ...(Array.isArray(observedPrefixes) ? observedPrefixes : [])]
      .filter((value): value is string => typeof value === 'string')
    if (references?.workspace === workspace) references = { workspace, prefixes: [...new Set(prefixes)] }
  } catch {
    // Linking is a convenience: the reply is drawn as before.
  }
}

/**
 * Where a note was opened: the door this session runs in (and the reader tile
 * it landed in), the Outliner Detail beside Claude in Herdr (`pane`), or the
 * mod's mentions pane here (`here`, and why the engine hasn't placed it yet).
 */
type Shown = { title: string; place: 'door' | 'pane' | 'here'; reader?: string; waits?: string }

/**
 * Neither a door nor Herdr took the note: the message says why, with the
 * command that reads it anywhere and its `((id))` to copy. Shown as it is,
 * never prefixed. `command` and `label` are for a click, which copies it.
 */
class NotOpenedHere extends Error {
  constructor(message: string, readonly label: string, readonly why: string, readonly command: string | null) {
    super(message)
  }
}

/** A tool's denial for a note it couldn't open: NotOpenedHere as it is, any other reason after the reference. */
function deniedText(error: unknown, reference: string): string {
  if (error instanceof NotOpenedHere) return error.message
  return `Could not show ${reference}: ${error instanceof Error ? error.message : String(error)}`
}

/** How `show` and `door_open` report where a note went. */
function shownText({ title, place, reader, waits }: Shown, reference: string): string {
  const where = place === 'door'
    ? (reader ? `in the door's ${reader} reader` : 'in the door')
    : place === 'here' ? 'in the mentions pane beside this conversation' : 'in the Outliner Detail beside you'
  return `Showing ${title || reference} ${where}${waits ? ` (the pane is not on screen yet: ${waits})` : ''}.`
}

/**
 * Opens an Outliner note where the person reads beside Claude: the one open
 * every path shares (a click on a reference, `show`, `door_open`). In order:
 *
 * 1. In an ep0ch-door tile (EP0CH_CONTROL set): in that door, as the agent's
 *    `open` from this session's tile, landing where the tile's opens go (its
 *    link; the door says which reader). Attributed to `actor`; the door never
 *    lets it take the person's focus, and its refusal is the answer, never
 *    shown somewhere else instead. Only when no door answers on that socket
 *    (it quit) does it go on.
 * 2. In Herdr: the Outliner Detail beside Claude, found by the Outliner's own
 *    `ensure-detail` (herdr-open.ts, `--no-focus`): the Detail linked to the
 *    Tree in Claude's Herdr workspace, else one opened below that Tree, else a
 *    new Tree and Detail beside Claude. The Detail is navigated there, never
 *    taking focus; a Detail mid-edit refuses it.
 * 3. Here, with neither (the desktop app, VS Code, a terminal outside Herdr):
 *    the mod's own pane (`showHere`): the mentions pane shows the note in
 *    place of its list (hooks/detail-view.ts), drawn by BlockView, its links
 *    navigating within it, back to the list; the command that reads it
 *    anywhere is its copy button.
 * 4. Without the session's outline to read it in: a NotOpenedHere saying why,
 *    with the exact command that draws it (`ep0ch show <id> --ws <outline>`)
 *    and its `((id))` to copy.
 *
 * `workspace` is the session's Outliner workspace: needed to resolve a page or
 * Work ID and for Herdr; a block id opens in a door without one. Opens run one
 * at a time, so concurrent clicks and tool calls open one Detail. Resolves to
 * the title and where it went; throws with the reason otherwise.
 */
function openNote($: EngineInterface, workspace: Workspace | null, uri: string, actor: string, door?: string): Promise<Shown> {
  const shown = showQueue.then(() => openNow($, workspace, uri, actor, door))
  showQueue = shown.catch(() => {})
  return shown
}

async function openNow($: EngineInterface, workspace: Workspace | null, uri: string, actor: string, door?: string): Promise<Shown> {
  const [{ EP0CH_CONTROL: given, HERDR_PANE_ID: paneId, HERDR_WORKSPACE_ID: herdrWorkspace }, tile, tileId] = await Promise.all([
    routeEnvOf($),
    $.env.get('EP0CH_TILE'),
    $.env.get('EP0CH_TILE_ID'),
  ])
  // `door`: the door the caller resolved (door_open, PIE-715), which beats a stale EP0CH_CONTROL.
  const control = door ?? given
  // Found on first use: outside a door and Herdr, a block id needs no installed Outliner to be named.
  let installed: Promise<string | null> | undefined
  const outliner = async (args: string[]) => {
    const root = await (installed ??= outlinerRootOf($))
    if (!root) throw Error('the Outliner plugin is disabled')
    return $.process.run(
      ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/cli.ts`, ...args],
      { cwd: workspace?.root ?? await $.session.cwd(), ...(workspace ? { env: envFor(workspace) } : {}), timeoutMs: 30_000 },
    )
  }
  let target: { id: string; title?: string } | undefined
  const resolve = async () => {
    if (target) return target
    if (!workspace) {
      const id = outlinerBlockIdOf(uri)
      if (!id) throw Error("this session's folder is not bound to an Outliner outline to resolve it in; give a block id")
      return (target = { id })
    }
    const resolved = await outliner(['resolve', uri])
    if (resolved.exitCode !== 0) throw Error(failureReasonOf(resolved.stderr) || 'the target did not resolve')
    return (target = JSON.parse(resolved.stdout) as { id: string; title?: string })
  }

  let why: string
  if (control) {
    const { id, title } = await resolve()
    const from = doorTileOf({ ...(tile ? { EP0CH_TILE: tile } : {}), ...(tileId ? { EP0CH_TILE_ID: tileId } : {}) })
    // From this tile, its opens' link; a door that doesn't know the tile (or is older than `from=`) is asked again
    // naming none, and lands it where its opens land. Never a reader by name: an agent naming the reader the person
    // reads is refused (ep0ch-door round 3), and where opens land never takes their keys.
    const opened = await outliner(['door-open', id, '--control', control, '--actor', actor, ...(from ? ['--from', from] : [])])
    if (opened.exitCode === 0) {
      let reader: unknown
      try { reader = JSON.parse(opened.stdout)?.reader } catch { reader = undefined }
      return { title: title ?? '', place: 'door', ...(typeof reader === 'string' && reader ? { reader } : {}) }
    }
    // The door's refusal (it is on its menu, the reader holds an edit) is the answer.
    if (opened.exitCode !== 3) throw Error(failureReasonOf(opened.stderr) || 'the door did not open it')
    why = `no door answers on ${control} (it quit?)`
  } else {
    why = 'this session is not in an ep0ch-door tile'
  }
  if (paneId && herdrWorkspace && workspace) {
    return { title: await showInHerdrPane($, outliner, workspace, uri), place: 'pane' }
  }
  // Neither a door nor Herdr: here, in the mentions pane. A page or Work ID that doesn't resolve is the refusal.
  // A block id needs no resolving: where the outliner can't answer, `ep0ch export` may still read it.
  if (workspace) {
    const blockId = outlinerBlockIdOf(uri)
    const { id, title } = await resolve().catch(error => {
      if (blockId) return { id: blockId, title: undefined }
      throw error
    })
    return showHere($, workspace, { uri, id, title: title ?? '' })
  }
  why += paneId && herdrWorkspace ? ", and its folder is not bound to an Outliner outline for a Herdr pane" : ', nor in Herdr'
  let found: { id: string; title?: string } | null
  try {
    found = await resolve()
  } catch {
    // Unresolved here: the reference as the outline writes it, and no command.
    found = null
  }
  // A block is named by its title where the outline has one; a page or Work ID as it was written.
  const label = (outlinerBlockIdOf(uri) && found?.title) || outlinerLabelOf(uri)
  // The exact command that draws it in any terminal, with only the outline host running: the door's renderer.
  const command = found ? `ep0ch show ${found.id}${workspace ? outlineFlags(workspace) : ''}` : null
  const how = found
    ? `Read it with \`${command}\`, or copy ((${found.id})) to open it in the Outliner.`
    : `Copy ${outlinerReferenceOf(uri)} to open it in the Outliner.`
  throw new NotOpenedHere(`Can't open ${label} here: ${why}. ${how}`, label, why, command)
}

/**
 * Shows `uri` in the Outliner Detail beside Claude: the Outliner's own
 * ensure-detail finds it (or opens one) without focus, then the CLI's `link`
 * navigates it, also without focus. The heading's "opens in" learns it exists.
 */
async function showInHerdrPane(
  $: EngineInterface,
  outliner: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  workspace: Workspace,
  uri: string,
): Promise<string> {
  const ensured = await runHerdrOpen($, workspace, ['--mode', 'ensure-detail', '--no-focus'])
  // With --no-focus the Outliner leaves the saying to its caller: one line on stderr, no Herdr notification.
  if (ensured.exitCode !== 0) {
    const why = herdrOpenReasonOf(ensured.stderr) || 'Herdr could not open an Outliner Detail'
    await $.state.set(DETAIL_BESIDE, { found: 'refused', why })
    throw Error(why)
  }
  const detail = lastJsonOf(ensured.stdout)?.detailClientId
  if (typeof detail !== 'string' || !detail) throw Error('the Outliner did not name its Detail')
  await $.state.set(DETAIL_BESIDE, { found: 'detail' })
  const shown = await outliner(['link', uri, '--detail-client', detail, '--no-focus'])
  if (shown.exitCode === 0) return String(JSON.parse(shown.stdout)?.title ?? '')
  const reason = failureReasonOf(shown.stderr)
  throw Error(isProtectedDestination(reason)
    ? 'the Outliner Detail beside you is mid-edit; finish or cancel it there'
    : reason || 'navigation failed')
}

/**
 * The installed Outliner's Herdr open (`src/herdr-open.ts`, what its
 * `ensure-detail` action runs) from Claude's pane, in the session's workspace:
 * the one place a Detail beside Claude is found or opened.
 */
async function runHerdrOpen($: EngineInterface, workspace: Workspace, args: string[]) {
  const root = await outlinerRootOf($)
  if (!root) throw Error('the Outliner plugin is disabled')
  return $.process.run(
    ['/bin/sh', `${root}/scripts/run-bun.sh`, `${root}/src/herdr-open.ts`, ...args],
    // OUTLINER_OPEN_WORKSPACE_ROOT: the session's workspace is the folder, not Claude's pane's directory (a listed
    // folder may be elsewhere), so ensure-detail and `link` reach the same outline.
    { cwd: workspace.root, env: { ...envFor(workspace), OUTLINER_OPEN_WORKSPACE_ROOT: workspace.root, HERDR_ENV: '1' }, timeoutMs: 30_000 },
  )
}

/** Why herdr-open refused, from its one stderr line (`Outliner could not open: <why>`). */
function herdrOpenReasonOf(stderr: string): string {
  return failureReasonOf(stderr).replace(/^Outliner could not open: /, '').replace(/^Error: /, '')
}

/** The last line of a command's output, as JSON; undefined when it isn't. */
function lastJsonOf(stdout: string): any {
  try { return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') } catch { return undefined }
}

/** The Detail beside Claude in Herdr, as find-detail (which opens nothing) or the last open found it: what the heading's "opens in" says. */
const DETAIL_BESIDE = { plugin: 'pi-outliner', key: 'detailBeside' } as const

/**
 * Asks the Outliner's `find-detail` whether a press would reuse a Detail beside
 * Claude, for the heading. Only in Herdr outside a door; a failure leaves the
 * last answer.
 */
async function refreshDetailBeside($: EngineInterface, workspace: Workspace): Promise<void> {
  if (routeOf(await routeEnvOf($)) !== 'herdr') return
  try {
    const found = await runHerdrOpen($, workspace, ['--mode', 'find-detail'])
    if (found.exitCode !== 0) return
    const answer = lastJsonOf(found.stdout)
    await $.state.set(DETAIL_BESIDE, typeof answer?.detailClientId === 'string'
      ? { found: 'detail' }
      : typeof answer?.why === 'string' ? { found: 'refused', why: answer.why } : { found: 'none' })
  } catch {
    // The heading keeps what it said.
  }
}

// Session state through `$.state` itself, not the state library: the module has no runtime import of 'claude-code'
// (the outliner's tests load it under plain Bun).
const MENTIONS_PREFS = { plugin: 'pi-outliner', key: 'mentionsPrefs' } as const
const MENTIONS_LIST = { plugin: 'pi-outliner', key: 'mentions' } as const

/** The choices in force (the defaults before the session's start read the kept ones). Read while drawing, it redraws the site on a change. */
async function mentionsPrefsOf($: EngineInterface): Promise<MentionsPrefs> {
  return prefsOf((await $.state.get(MENTIONS_PREFS)).value ?? DEFAULT_PREFS)
}

/** The mentions shown. Read while drawing, it redraws the site when they change. */
async function mentionsListOf($: EngineInterface): Promise<MentionsList> {
  return (await $.state.get(MENTIONS_LIST)).value ?? { rows: [], loaded: false }
}
const BLOCK_VIEWS = { plugin: 'pi-outliner', key: 'blockViews' } as const
/** The mentions' start in flight or done, so the session's start and a reloaded module's first draw start it once. */
let mentionsStarting: Promise<void> | undefined
/** BlockView drawings being loaded, so a redraw before one lands doesn't start it again. */
const loadingViews = new Set<string>()

/**
 * At session start: the `/mentions` command, the choices kept from the last
 * session, the list, and the pane when that was the choice. Opened unasked,
 * the engine seats the pane only where it is a sidebar (from 144 columns);
 * below that it waits. It never opens with focus: the prompt keeps the keys.
 */
async function startMentionsOnce($: EngineInterface, option: PluginOptions): Promise<void> {
  mentionsStarting ??= (async () => {
    await loadReferences($, option)
    await startMentions($, option)
    // The band was drawn before the outline was found (or by the module before a reload): draw it again.
    $.ui.invalidate('ui.render')
  })().catch(() => {})
  return mentionsStarting
}

/**
 * Seats the pane, never with focus. Opened unasked (the session's start) on a
 * terminal too narrow for an unrequested pane, it waits undrawn; the band
 * stands in for it meanwhile, its `m` showing the pane.
 */
async function openMentionsPane($: EngineInterface): Promise<UiOpenResult> {
  const opened = await $.ui.open({ id: MENTIONS_PANE, title: MENTIONS_TITLE })
  // Placed or waiting, the band reads whether it is up: it stands in while the pane waits.
  $.ui.invalidate('ui.render')
  return opened
}

const MENTIONS_TITLE = 'Mentions'

/** Whether the mentions pane is open and on screen; one that waits undrawn, or was dropped, is not. */
async function paneIsPlaced($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === MENTIONS_PANE && pane.isPlaced)
  } catch {
    return false
  }
}

async function startMentions($: EngineInterface, option: PluginOptions): Promise<void> {
  await $.command.register({
    name: TOOL_ROWS_COMMAND,
    description: "The outline and workboard tool calls as compact rows that fold open on what they wrote, or Claude Code's own rows",
    argumentHint: '[on | off]',
  })
  await $.state.set(TOOL_ROWS_PREFS, toolRowsPrefsOf(await $.store.get(TOOL_ROWS_STORE_KEY)))
  await $.command.register({
    name: 'mentions',
    description: 'Recent mentions of the outline: in a band above the prompt or a pane beside the transcript, with block previews; or hidden',
    argumentHint: '[band | pane | off | preview | scope]',
  })
  // Here too, so a module reloaded mid-session (which starts mentions from its first draw) has it.
  await $.command.register({
    name: BINDING_COMMAND,
    description: 'Where this Claude is bound: the outline its tools use and its machine, why, where Claude runs, the door and Herdr pane',
  })
  const kept = prefsOf(await $.store.get(PREFS_STORE_KEY))
  await $.state.set(MENTIONS_PREFS, kept)
  await refreshMentions($, option)
  if (kept.placement === 'pane' && references?.workspace) await openMentionsPane($)
}

/** Writes the choices for this session and the next ones. */
async function keepMentionsPrefs($: EngineInterface, next: MentionsPrefs): Promise<void> {
  await $.state.set(MENTIONS_PREFS, next)
  await $.store.set(PREFS_STORE_KEY, next)
}

/**
 * A choice from a button, a hotkey or `/mentions`: kept, and the pane seated
 * or taken down to match; a new scope reads the list again.
 */
async function chooseMentions($: EngineInterface, change: (p: MentionsPrefs) => MentionsPrefs, option: PluginOptions, places = false): Promise<MentionsPrefs> {
  const before = await mentionsPrefsOf($)
  const next = prefsOf(change(before))
  await keepMentionsPrefs($, next)
  // Only a choice of where (m, /mentions pane) opens the pane, even when it is already the choice: previews and
  // scope leave the band or pane as it is, so a band standing in for a waiting pane stays the band.
  if (next.placement === 'pane') {
    if (places || before.placement !== 'pane') await openMentionsPane($)
  } else if (before.placement === 'pane') await $.ui.close({ id: MENTIONS_PANE })
  if (next.placement === 'off' && before.placement !== 'off') $.ui.toast('Recent mentions hidden; /mentions band or /mentions pane shows them again.', { timeoutMs: 6000 })
  if (next.scope !== before.scope) await refreshMentions($, option)
  return next
}

/**
 * Reads this session's mentions (or the outline's, by the chosen scope) the
 * way Tree and Detail do: the installed CLI's `mentions list`, the service's
 * `mentions.list`. Nothing in a folder bound to no outline; a failure keeps
 * the rows shown and says why.
 */
async function refreshMentions($: EngineInterface, option: PluginOptions): Promise<void> {
  if (!references?.workspace) await loadReferences($, option)
  const workspace = references?.workspace
  if (!workspace) {
    await $.state.set(MENTIONS_LIST, { rows: [], loaded: true, why: "this session's folder names no outline" })
    return
  }
  try {
    const ran = await runOutliner($, workspace, mentionsListArgs((await mentionsPrefsOf($)).scope, await $.session.id()))
    if (ran.exitCode !== 0) throw Error(failureReasonOf(ran.stderr) || 'mentions list failed')
    const rows = mentionRowsOf(ran.stdout)
    await $.state.set(MENTIONS_LIST, { rows, loaded: true })
    void refreshDetailBeside($, workspace)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    await $.state.set(MENTIONS_LIST, { rows: (await mentionsListOf($)).rows, loaded: true, why })
  }
}

/** The band's or the pane's tree, its previews drawn by BlockView. */
async function drawMentions(
  $: EngineInterface,
  e: { surface: RenderSurface },
  ui: SiteElements,
  site: 'band' | 'pane',
  columns: number,
  workspace: Workspace,
  option: PluginOptions,
): Promise<RenderElement> {
  const [prefs, list, env, beside] = await Promise.all([
    mentionsPrefsOf($),
    mentionsListOf($),
    routeEnvOf($),
    $.state.get(DETAIL_BESIDE).then(({ value }) => value),
  ])
  const width = previewWidthOf(site, columns)
  const source = { cwd: workspace.root, env: envFor(workspace) }
  const previews = new Map<number, RenderElement>()
  for (const i of previewedRows(site, prefs, list.rows)) {
    const row = list.rows[i]!
    previews.set(i, await drawBlock($, e, ui, { key: `mention-preview-${i + 1}`, id: row.id!, revision: row.revision, width, maxRows: PREVIEW_ROWS[site], text: row.text, source }))
  }
  return mentionsTree(ui, {
    site, columns, prefs, list, previews,
    opens: opensIn(env, beside),
    open: (row: MentionRow, surface: RenderSurface) => void openMention($, workspace, row, surface),
    choose: change => void chooseMentions($, change, option),
  })
}

/** A mention pressed: the one open; where nothing here can open it, its band or pane keeps the command to run. */
async function openMention($: EngineInterface, workspace: Workspace, row: MentionRow, surface: RenderSurface): Promise<void> {
  const said = row.id
    ? await openUri($, workspace, `pi-outliner://block/${row.id}`, surface)
    : `Can't open ${row.address}: ${row.unavailable ?? 'it no longer resolves'}`
  if (!row.id) $.ui.toast(said!, { timeoutMs: 6000 })
  const { note: _, ...list } = await mentionsListOf($)
  await $.state.set(MENTIONS_LIST, said ? { ...list, note: said } : list)
}

/**
 * `<BlockView id width/>` for any render hook of this mod: the block as the
 * door draws it (hooks/block-view.ts), the latest drawing kept for the session
 * per block and read so the site redraws when it lands. It is drawn again for a
 * new width, or a new `revision` when the caller passes one (without it, an
 * edit isn't seen this session). `source` defaults to the session's outline. The first
 * draw loads it off the render (a render hook never runs the CLI itself), and
 * only the terminal asks for cells; another surface draws the block's text.
 */
async function drawBlock(
  $: EngineInterface,
  e: { surface: RenderSurface },
  ui: BlockViewElements,
  view: {
    key: string; id: string; revision?: number | null; width: number; maxRows: number; text?: string; source?: BlockViewSource
    /** A drawing kept apart from the previews' (the detail view's, taller): its own slot, rows and links. */
    slot?: string; rows?: number; links?: BlockViewProps['links']
  },
): Promise<RenderElement> {
  const at = blockViewId(view.id, view.revision, view.width)
  const terminal = e.surface === 'terminal'
  const kept = view.slot ? `${view.slot}:${view.id}` : view.id
  // One drawing kept a block, the latest: an older revision or width is shown until the new one lands.
  const { value } = terminal ? await $.state.get({ ...BLOCK_VIEWS, id: kept }) : { value: undefined }
  if (value?.at !== at && terminal && !loadingViews.has(kept)) {
    loadingViews.add(kept)
    const workspace = references?.workspace
    const source = view.source ?? (workspace ? { cwd: workspace.root, env: envFor(workspace) } : {})
    // A first drawing at once; a new width after a pause, so a resize being dragged draws once, not at each width.
    $.clock.after(value ? 300 : 0, () => void loadBlockView((argv, init) => $.process.run(argv, init), view.id, viewColumns(view.width), source, view.rows)
      .then(data => $.state.set({ ...BLOCK_VIEWS, id: kept }, { at, data }))
      .catch(() => {})
      .finally(() => loadingViews.delete(kept)))
  }
  return BlockView(ui, {
    key: view.key, data: value?.data, surface: e.surface, maxRows: view.maxRows,
    ...(view.text === undefined ? {} : { text: view.text }),
    ...(view.links ? { links: view.links } : {}),
  })
}

/** The flags that name a workspace's outline to `ep0ch`: its name, and its machine when it is on another. */
function outlineFlags(workspace: Workspace): string {
  return `${workspace.outline ? ` --ws ${workspace.outline}` : ''}${workspace.machine ? ` --machine ${workspace.machine}` : ''}`
}

/** A click on a reference: opened by `openNote`, or a toast saying why not. */
async function openReference($: EngineInterface, workspace: Workspace, href: string, surface: RenderSurface): Promise<void> {
  const uri = outlinerUriOf(href)
  if (uri) await openUri($, workspace, uri, surface)
}

/**
 * A press on a reference or a mention: opened by `openNote`, or a toast saying
 * why not. Where nothing here can open it, the command that reads it is put on
 * the clipboard (the person asked to see it) and the toast leads with it, since
 * a toast's card shows its first lines. Resolves to that message, null once
 * opened (or another failure was toasted).
 */
async function openUri($: EngineInterface, workspace: Workspace, uri: string, surface: RenderSurface): Promise<string | null> {
  try {
    const shown = await openNote($, workspace, uri, await doorActorFor($, {}))
    // Here, from a press the pane couldn't be seated by (a door that had quit): say where it went.
    if (shown.place === 'here' && shown.waits) {
      $.ui.toast(`${shown.title || outlinerLabelOf(uri)} is open in the mentions pane, not on screen yet (${shown.waits}); /mentions pane shows it.`, { timeoutMs: 8000 })
    }
    return null
  } catch (error) {
    if (error instanceof NotOpenedHere) {
      let copied = false
      if (error.command) {
        // To the clipboard of the surface the person pressed on.
        try { copied = (await $.ui.copy({ text: error.command, surface })).isCopied } catch { copied = false }
      }
      const said = copied ? `Copied \`${error.command}\`: it reads ${error.label} in any terminal (${error.why}).` : error.message
      $.ui.toast(said, { timeoutMs: 12_000 })
      return said
    }
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.toast(`Could not open ${outlinerLabelOf(uri)} in the Outliner: ${reason}`, { timeoutMs: 6000 })
    return null
  }
}

/** `/tool-rows`: the mod's tool rows on or off (kept in `$.store` too); unset reads as on. */
const TOOL_ROWS_PREFS = { plugin: 'pi-outliner', key: 'toolRows' } as const
/** Which tool rows are folded open, by tool_use_id. */
const TOOL_ROW_OPEN = { plugin: 'pi-outliner', key: 'toolRowOpen' } as const
/** Block titles a tool row names, by block id: looked up once a session, off the draw. */
const TOOL_TITLES = { plugin: 'pi-outliner', key: 'toolTitles' } as const
const askedTitles = new Set<string>()
/** The tool calls whose row the mod drew (not the engine's): only their result rows are shortened. */
const drawnToolRows = new Set<string>()

/**
 * The titles of the blocks a tool row names by id. Each is read from state (so
 * the row draws again when it lands); one not looked up yet is resolved through
 * the CLI off the draw, once a session. Only in a folder bound to an outline.
 */
async function toolTitlesOf($: EngineInterface, view: { tool: string; input: unknown }): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const workspace = references?.workspace
  for (const id of idsToTitle({ ...view, isRunning: false, isErrored: false, isInterrupted: false })) {
    const { value } = await $.state.get({ ...TOOL_TITLES, id })
    if (value) titles.set(id, value)
    else if (workspace && !askedTitles.has(id)) {
      askedTitles.add(id)
      $.clock.after(0, () => void runOutlinerCli($, workspace, ['agent', 'resolve', '--stdin'], JSON.stringify({ ref: id }))
        .then(out => {
          const title: unknown = JSON.parse(out)?.title
          return typeof title === 'string' && title.trim() ? $.state.set({ ...TOOL_TITLES, id }, title.trim()) : undefined
        })
        .catch(() => {}))
    }
  }
  return titles
}

/** Files an Edit or Write has been checked for open threads this session: asked once each, held once when it had some. */
const threadChecked = new Set<string>()

/**
 * The first Edit or Write of a file that has open comment threads in the outline (PIE-650): held once with them, so the
 * agent reads what was said before it rewrites the file; the same call again goes through. Null for everything else,
 * and when anything fails: this never stands in the way of an edit it couldn't check.
 */
async function holdForThreads($: EngineInterface, option: PluginOptions, e: { tool: string }): Promise<string | null> {
  try {
    const path = threadedPathOf(e.tool, e)
    if (!path || threadChecked.has(path)) return null
    threadChecked.add(path)
    if (!references?.workspace) await loadReferences($, option)
    const workspace = references?.workspace
    // Not bound now: asked again next time, once it is (a not-bound answer is never sticky, PIE-755).
    if (!workspace) { threadChecked.delete(path); return null }
    const out = await runOutlinerCli($, workspace, ['agent', 'read', '--stdin', '--actor', await actorFor($, {})], JSON.stringify({ ref: fileRefOf(path) }))
    return threadsHeldNote(path, JSON.parse(out))
  } catch {
    return null
  }
}

/** After an Edit or Write answered: its touch queued for the outline, unless it was denied or failed. Never throws. */
function queueTouch($: EngineInterface, option: PluginOptions, e: { tool: string }, result: { deny?: string; isError?: boolean; result?: unknown }): void {
  try {
    if (result.deny || result.isError) return
    const touch = touchOf(e.tool, e, result.result)
    if (touch) touchQueue = touchQueue.then(() => recordTouch($, option, touch)).catch(() => {})
  } catch { /* the call's answer is never touched */ }
}

/** The touches waiting to be recorded, one after another. */
let touchQueue: Promise<void> = Promise.resolve()
/** Files this session has recorded once: the copy from before is sent with the first touch only. */
const touchedFiles = new Set<string>()
/** The snapshot a touch block names, by file: what `diff` compares a file outside git with. */
const snapshots = new Map<string, string>()
/** The git top level of each folder asked about ('' for none): one `git rev-parse` per folder a session. */
const toplevels = new Map<string, string>()
/** The session's folder, as its rows name files relative to it. */
let sessionCwd: string | null = null

/**
 * Records one touch in the session's outline: `agent touch-file` through the installed CLI, as this session. Only in
 * a folder bound to an outline; a failure is said once a session, never thrown into the call.
 */
async function recordTouch($: EngineInterface, option: PluginOptions, touch: ReturnType<typeof touchOf> & {}): Promise<void> {
  if (!references?.workspace) await loadReferences($, option)
  const workspace = references?.workspace
  if (!workspace) return
  const cwd = sessionCwd ?? (sessionCwd = await $.session.cwd())
  const dir = touch.path.slice(0, touch.path.lastIndexOf('/')) || '/'
  let top = toplevels.get(dir)
  if (top === undefined) {
    const ran = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 }).catch(() => null)
    top = ran?.exitCode === 0 ? ran.stdout.trim() : ''
    toplevels.set(dir, top)
  }
  const first = !touchedFiles.has(touch.path)
  const input = touchInputOf(first ? touch : { ...touch, original: undefined }, projectOf(touch.path, top || null, cwd), await $.session.id(), await $.clock.now())
  if (!first) delete input.original
  try {
    const out = JSON.parse(await runOutlinerCli($, workspace, ['agent', 'touch-file', '--stdin', '--actor', await actorFor($, {})], JSON.stringify(input)))
    touchedFiles.add(touch.path)
    if (typeof out?.snapshot === 'string') snapshots.set(touch.path, out.snapshot)
  } catch (error) {
    if (!touchFailed) $.ui.toast(`Files this session edits aren't being recorded in the outline: ${error instanceof Error ? error.message : String(error)}`, { timeoutMs: 8000 })
    touchFailed = true
  }
}
let touchFailed = false

/**
 * A file row pressed (PIE-602): the file, or its diff (`#diff`), opened in the door this Claude runs in, as an agent's
 * open lands (`ep0ch open file:<path>`). Outside a door there is no reader of files to open it in: the path is copied,
 * and the toast says so.
 */
async function openFileTarget($: EngineInterface, ref: string, surface: RenderSurface): Promise<void> {
  const diff = ref.startsWith(FILE_DIFF_REF)
  const path = ref.slice(diff ? FILE_DIFF_REF.length : FILE_REF.length)
  const control = (await routeEnvOf($)).EP0CH_CONTROL
  const name = path.split('/').pop() || path
  if (!control) {
    let copied = false
    try { copied = (await $.ui.copy({ text: path, surface })).isCopied } catch { copied = false }
    $.ui.toast(`${name}${diff ? "'s diff" : ''} opens in an ep0ch door, and this Claude isn't in one${copied ? ` · copied ${path}` : ` · ${path}`}`, { timeoutMs: 8000 })
    return
  }
  const against = diff ? snapshots.get(path) : undefined
  const argv = ['ep0ch', 'open', `${FILE_REF}${path}`, ...(diff ? ['diff=true'] : []), ...(against ? [`against=${against}`] : []), '--as', await doorActorFor($, {}), '--json']
  const ran = await $.process.run(argv, { env: { EP0CH_CONTROL: control }, timeoutMs: 15_000 }).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  let answer: { opened?: boolean; reason?: string } | null = null
  try { answer = JSON.parse(ran.stdout) } catch { answer = null }
  if (ran.exitCode !== 0 || answer?.opened === false) {
    $.ui.toast(`Could not open ${name}${diff ? "'s diff" : ''} in the door: ${answer?.reason ?? (failureReasonOf(ran.stderr) || 'no answer')}`, { timeoutMs: 8000 })
  }
}

/** A tool row's target pressed: opened by `openNote`, as a reference in a reply is. */
async function openToolTarget($: EngineInterface, ref: string, surface: RenderSurface): Promise<void> {
  if (ref.startsWith(FILE_REF) || ref.startsWith(FILE_DIFF_REF)) return openFileTarget($, ref, surface)
  const uri = outlinerUriFor(ref)
  const workspace = references?.workspace
  if (!uri) return
  if (!workspace) {
    $.ui.toast(NOT_BOUND, { timeoutMs: 6000 })
    return
  }
  await openUri($, workspace, uri, surface)
}

const DETAIL = { plugin: 'pi-outliner', key: 'detail' } as const
const DETAIL_SOURCES = { plugin: 'pi-outliner', key: 'detailSources' } as const

type RouteEnv = { EP0CH_CONTROL: string | undefined; HERDR_PANE_ID: string | undefined; HERDR_WORKSPACE_ID: string | undefined }
/** The variables openNote routes by, read once a module load: a press hook then decides without waiting. */
let routeEnv: RouteEnv | undefined

async function routeEnvOf($: EngineInterface): Promise<RouteEnv> {
  if (routeEnv) return routeEnv
  const [EP0CH_CONTROL, HERDR_PANE_ID, HERDR_WORKSPACE_ID] = await Promise.all([
    $.env.get('EP0CH_CONTROL'), $.env.get('HERDR_PANE_ID'), $.env.get('HERDR_WORKSPACE_ID'),
  ])
  return (routeEnv = { EP0CH_CONTROL, HERDR_PANE_ID, HERDR_WORKSPACE_ID })
}

/**
 * openNote's third case: the note in the mentions pane, in place of its
 * list, pushed on its history. The pane is opened (a press seated it
 * already); one opened unasked waits on a narrow terminal, and `waits` says
 * so. The note is read off the open queue, so a slow read never holds the
 * next open; each read lands as the latest for its note.
 */
async function showHere($: EngineInterface, workspace: Workspace, entry: DetailEntry): Promise<Shown> {
  await $.state.set(DETAIL, pushed(await detailHistoryOf($), entry))
  const opened = await openMentionsPane($)
  $.clock.after(0, () => void readDetail($, workspace, entry.id)
    .then(source => $.state.set({ ...DETAIL_SOURCES, id: entry.id }, source))
    .catch(() => {}))
  return { title: entry.title, place: 'here', ...(opened.isPlaced ? {} : { waits: opened.reason }) }
}

/**
 * A note's text for the detail view: the door's export of it and its
 * children (`ep0ch export <id> --children`, from an ep0ch whose help lists
 * it), else the outliner's read (`list --subtree`), else why neither could.
 */
async function readDetail($: EngineInterface, workspace: Workspace, id: string): Promise<DetailSource> {
  const prefixes = references?.prefixes ?? []
  const run = (argv: readonly string[], init?: Parameters<EngineInterface['process']['run']>[1]) => $.process.run(argv, init)
  let why = 'no ep0ch on PATH with export (ep0ch install)'
  try {
    // An ep0ch older than `export` (or than `help`) never runs it: the probe socket stops one at "no carrier".
    const help = await ep0chHelp(run)
    if (help !== null && knowsExport(help)) {
      const ran = await $.process.run(exportArgv(id), { cwd: workspace.root, env: envFor(workspace), timeoutMs: 15_000 })
      const body = ran.exitCode === 0 ? exportBodyOf(ran.stdout) : null
      if (body) return detailSourceOf(body, prefixes, 'ep0ch')
      why = failureReasonOf(ran.stderr).replace(/^ep0ch: /, '') || 'ep0ch export printed nothing'
    }
  } catch (error) {
    why = error instanceof Error ? error.message : String(error)
  }
  try {
    const ran = await runOutliner($, workspace, ['list', '--subtree', id, '--limit', String(SUBTREE_LIMIT)])
    const read = ran.exitCode === 0 ? subtreeMarkdownOf(ran.stdout, id) : null
    if (read) return detailSourceOf(read.markdown, prefixes, 'outliner', read.isTruncated)
    why += `; ${ran.exitCode === 0 ? 'the outliner found no such block' : failureReasonOf(ran.stderr) || 'the outliner could not read it'}`
  } catch (error) {
    why += `; ${error instanceof Error ? error.message : String(error)}`
  }
  return { kind: 'missing', why }
}

/** The detail view's history. Read while drawing, it redraws the pane when it changes. */
async function detailHistoryOf($: EngineInterface) {
  return historyOf((await $.state.get(DETAIL)).value)
}

/** The detail view's tree: its history's current note, drawn by BlockView, its links opened here by openNote. */
async function drawDetail($: EngineInterface, e: { surface: RenderSurface }, ui: DetailElements & BlockViewElements, columns: number): Promise<RenderElement> {
  const history = await detailHistoryOf($)
  const entry = currentOf(history)
  const workspace = references?.workspace ?? null
  const source = entry ? (await $.state.get({ ...DETAIL_SOURCES, id: entry.id })).value : undefined
  // A link pressed goes through the one open: with no door or Herdr around, that is this pane again.
  const follow = (href: string, surface: RenderSurface) => void (workspace && openReference($, workspace, href, surface))
  const body = entry && source?.kind === 'source'
    ? await drawBlock($, e, ui, {
        key: 'detail-body', slot: 'detail', id: entry.id, width: Math.max(20, columns - 1), maxRows: DETAIL_ROWS, rows: DETAIL_ROWS,
        text: source.markdown, links: { hrefs: source.links.map(link => link.href), press: follow },
        ...(workspace ? { source: { cwd: workspace.root, env: envFor(workspace) } } : {}),
      })
    : null
  const command = entry ? `ep0ch show ${entry.id}${workspace ? outlineFlags(workspace) : ''}` : null
  const go = (move: (h: typeof history) => typeof history) => void (async () => $.state.set(DETAIL, move(await detailHistoryOf($))))()
  return detailTree(ui, {
    history, source, body, surface: e.surface, columns, command,
    back: () => go(h => moved(h, -1)),
    forward: () => go(h => moved(h, 1)),
    list: () => go(listed),
    copy: surface => void (async () => {
      if (!command) return
      let copied = false
      try { copied = (await $.ui.copy({ text: command, surface })).isCopied } catch { copied = false }
      $.ui.toast(copied ? `Copied \`${command}\`: it reads the note in any terminal.` : `Read it in any terminal with \`${command}\`.`, { timeoutMs: 8000 })
    })(),
    follow,
  })
}
