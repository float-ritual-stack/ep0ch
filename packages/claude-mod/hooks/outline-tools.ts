/**
 * Outline and door tools for Claude (PIE-504), so an agent never hand-rolls a
 * script to read, edit or comment on a note, or to act in the door it runs in.
 *
 * - `outline_*`: each is one call to the installed CLI's `agent <operation>`
 *   (src/agent-tools.ts) with the tool's input as JSON on stdin. Each tool is
 *   defined once, for every surface (agent-tool-definitions.ts, PIE-720); this
 *   file registers them with the session's identity (`actor`).
 * - `outline_components`: `ep0ch library --brief`, the components a note can hold as this session's outline has them
 *   (its own styles and types, its extensions'). It is the door's CLI that answers, from the schema read the
 *   door and the MCP gateway share.
 * - `door_*`: each is one `ep0ch` command on the session's EP0CH_CONTROL, the
 *   door this Claude runs in. They exist only when EP0CH_CONTROL is set. The
 *   door enforces its rules (an agent never takes the person's focus); its
 *   refusals come back as the tool's denial.
 *
 * Every write is `author: agent`, attributed to the actor `actorOf` picks.
 */

import { checkToolArgs, REF_ALIASES, type ToolSchema } from './tool-args'
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOL_SURFACES, describeTool, toolInputSchema, type AgentToolDefinition } from './agent-tool-definitions'

type Json = Record<string, unknown>

export interface OutlineToolDefinition {
  name: string
  description: string
  inputSchema: Json
  /** A call that works. */
  example: Json
  /** Names this tool also answers to for an argument, beyond the reference aliases for `ref`. */
  aliases?: Readonly<Record<string, readonly string[]>>
  /** The CLI `agent` operation and its JSON input, or the reason the input is unusable. */
  command(input: Record<string, unknown>): { operation: string; input: Json } | string
}

const ACTOR = {
  type: 'string',
  description: 'Who this is attributed to. Leave it out: it defaults to OUTLINER_ACTOR, EP0CH_AGENT, else the agent the folder\'s .ep0ch names. It names a persona; the write is recorded as `<persona>/claude-code@<machine>`, so the machine and client are always shown.',
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** A shared definition as this mod registers it: a write's schema carries `actor`, the attribution override (outline_changes' `actor` is a filter). */
function modTool(definition: AgentToolDefinition): OutlineToolDefinition {
  return {
    name: definition.name,
    description: describeTool(definition),
    inputSchema: toolInputSchema(definition, definition.writes ? { actor: ACTOR } : {}) as Json,
    example: definition.example,
    ...(definition.aliases ? { aliases: definition.aliases } : {}),
    command: input => definition.command(input),
  }
}

/** The outline tools: each defined once (agent-tool-definitions.ts, PIE-720), the ones this mod registers. */
export const OUTLINE_TOOLS: readonly OutlineToolDefinition[] = AGENT_TOOL_DEFINITIONS.filter(d => AGENT_TOOL_SURFACES[d.name]?.mod === true).map(modTool)

// ─── Door tools ────────────────────────────────────────────────────────────

export interface DoorToolDefinition {
  name: string
  description: string
  inputSchema: Json
  /** A call that works. */
  example: Json
}

export const COMPONENTS_TOOL = {
  name: 'outline_components',
  example: { components: ['callout'] } as Json,
  description:
    'The components a note can hold, as this session\'s outline has them (ep0ch library --brief): per component its ' +
    'purpose, where it goes, each property as `key: values (default) — meaning`, and a minimal example. The ' +
    "outline's own heading styles, callout types and its extensions' components are among the values. Name " +
    'components to read only those. Only reads; the library screen is for people.',
  inputSchema: {
    type: 'object',
    properties: { components: { type: 'array', items: { type: 'string' }, description: 'Component ids (heading-style, callout, rule, …); leave out for all' } },
    additionalProperties: false,
  } as Json,
} as const

/** `ep0ch library --brief` argv for the components named (all when none are), or the reason the input is unusable. */
export function componentsArgv(input: Record<string, unknown>): { argv: string[] } | string {
  const names = input.components ?? []
  if (!Array.isArray(names) || !names.every(n => typeof n === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(n))) {
    return 'components is a list of component ids such as heading-style or callout (leave it out for all).'
  }
  return { argv: ['ep0ch', 'library', '--brief', ...(names as string[])] }
}

/**
 * `outline_bind`: points this session's outline tools at the outline `name` (on `machine`, when another machine's),
 * for the rest of the session. The mod's own handler (hooks/register.ts) runs it; `/outline <name>` is the same call.
 */
export const BIND_TOOL = {
  name: 'outline_bind',
  example: { name: 'garden' } as Json,
  description:
    "Bind this session's outline, workboard and mention tools to the outline `name` (`ep0ch outline list` lists them), " +
    'on `machine` (an ssh config name) only for an outline on another machine. It stays for the rest of the session, ' +
    'over EP0CH_WS and any folder, and a shell `cd` never moves it. Use it when a tool says this session is not bound ' +
    'or is bound to the wrong outline. An outline nobody has made is refused, never created.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The outline name: lowercase letters, digits and hyphens (garden)' },
      machine: { type: 'string', description: 'An ssh config name, only for an outline on another machine' },
    },
    required: ['name'],
    additionalProperties: false,
  } as Json,
} as const

export const DOOR_TOOLS: readonly DoorToolDefinition[] = [
  {
    name: 'door_where',
    example: {},
    description:
      'Where this session runs (ep0ch where): the layers (ssh › herdr › door tile), which are live, and whether the ' +
      'person is typing in your tile. Only reads.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'door_peek',
    example: {},
    description:
      'What the door shows the person now (ep0ch peek): by default the compact text, a few lines of state (where, ' +
      'the person, the door\'s speed) and the screen as text, a few KB. `full: true` is the whole structured state as ' +
      'well (ep0ch peek --json: layout, drawer, tiles, hundreds of KB); `section` is one top-level part of it ' +
      '(speed, person, layout, drawer, state, …). Only reads.',
    inputSchema: {
      type: 'object',
      properties: {
        full: { type: 'boolean', description: 'The whole structured state and the screen text, not the compact text.' },
        section: { type: 'string', description: 'One part of the state, e.g. speed, person, layout, drawer, state, text.' },
        xray: { type: 'boolean', description: 'Include every visible tile controls as hint-card rows (the whole state, as full).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'door_act',
    example: { action: 'block.mark', args: { id: '7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34' } },
    description:
      "Run one of the door's actions as you (ep0ch act, attributed with --as and said on the person's screen). " +
      '`ep0ch actions` names them; door_peek shows the state they act on. The door never lets an agent take the ' +
      "person's focus, keys or selection: such an action is refused with the reason, which comes back as this " +
      "tool's error. To point the person at something, use block.mark. To open a note, door_open.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action name, e.g. layout.get, view.scrollTo, block.mark' },
        args: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
          description: 'The action’s arguments, key: value',
        },
        tile: { type: 'string', description: 'The tile to act in, when the action needs one' },
        actor: ACTOR,
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'door_open',
    example: { ref: 'PIE-123' },
    description:
      'Open the note `ref` in the door this session runs in, where your tile’s opens land (from=$EP0CH_TILE), as you. It ' +
      "never moves the person's focus; the door says which reader it went to.",
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'The note: a block id, ((id)), [[page]] or Work ID' }, actor: ACTOR },
      required: ['ref'],
      additionalProperties: false,
    },
  },
]

const ACT_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/**
 * `ep0ch act` argv (and stdin) for an action as `actor`. Values go as
 * `key=value` words. `ep0ch` reads a value starting with `@` as a file (`@-`
 * as stdin), so one such value is sent through stdin instead; a second is
 * refused rather than read as a path.
 */
export function doorActArgv(
  input: Record<string, unknown>,
  actor: string,
): { argv: string[]; stdin?: string } | string {
  const action = input.action
  if (!nonEmpty(action) || /\s/.test(action)) return 'Give the action name (door_peek and `ep0ch actions` list them).'
  const args = input.args ?? {}
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'args is an object of key: value.'
  const words: string[] = []
  let stdin: string | undefined
  for (const [key, raw] of Object.entries(args as Record<string, unknown>)) {
    if (!ACT_KEY.test(key) || key === 'as' || key === 'tile') return `"${key}" is not an argument name (use tile and actor for those).`
    if (!['string', 'number', 'boolean'].includes(typeof raw)) return `${key} must be a string, number or boolean.`
    const value = String(raw)
    if (value.startsWith('@')) {
      if (stdin !== undefined) return 'Only one argument may start with @.'
      stdin = value
      words.push(`${key}=@-`)
    } else {
      words.push(`${key}=${value}`)
    }
  }
  if (input.tile !== undefined) {
    if (!nonEmpty(input.tile) || String(input.tile).startsWith('@')) return 'tile is a tile name.'
    words.push(`tile=${input.tile}`)
  }
  return { argv: ['ep0ch', 'act', action, ...words, '--as', actor], ...(stdin === undefined ? {} : { stdin }) }
}

/** What a `door_peek` call asks `ep0ch peek` for: the compact text (`text`), one `section` of the state, or the `full` state as one JSON object. */
export type PeekCall = { argv: string[]; reads: 'text' | 'section' | 'full' }
export function peekArgv(input: Json): PeekCall | string {
  const section = typeof input.section === 'string' ? input.section.trim() : ''
  if (section && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(section)) return 'section is the name of one part of the state: speed, person, layout, drawer, state, text.'
  if (section) {
    if (input.full === true || input.xray === true) return 'section is one part of the state; full and xray are the whole of it: give one or the other.'
    return { argv: ['ep0ch', 'peek', section], reads: section === 'text' ? 'text' : 'section' }
  }
  const full = input.full === true || input.xray === true
  return { argv: ['ep0ch', 'peek', ...(full ? ['--json'] : []), ...(input.xray === true ? ['--xray'] : [])], reads: full ? 'full' : 'text' }
}

/**
 * What `ep0ch peek` printed, as one compact value: the compact text as `{ text }`; the full state (`--json`: one object
 * holding the screen's `text` lines) as `{ screen, text }`; a section (JSON alone) as `{ section }`.
 */
export function peekOf(stdout: string, reads: PeekCall['reads'] = 'text'): { screen?: unknown; section?: unknown; text?: string } {
  if (reads !== 'text') {
    try {
      const value = JSON.parse(stdout) as Json
      if (reads === 'section') return { section: value }
      const { text, ...screen } = value
      return { screen, text: Array.isArray(text) ? text.join('\n').trimEnd() : '' }
    } catch {
      // Not the JSON this asked for: the text alone.
    }
  }
  return { text: stdout.trimEnd() }
}

/** A persona's name: what an actor id holds before the `/`. */
const PERSONA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** This machine's name as a principal holds it: letters, digits, `.`, `_` and `-`, starting with a letter or digit, up to 31. */
export function machineNameOf(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 31)
  return cleaned || undefined
}

/**
 * Who a write is attributed to (PIE-679, ADR 0003): the principal, which is this client on this machine
 * (`claude-code@float-2`), and the persona on top, first match wins: the caller's `actor`, else OUTLINER_ACTOR, else
 * EP0CH_AGENT (the door's own name for the agent), else `folder`, the `agent` the session folder's `.ep0ch` names (as
 * `ep0ch where` reads it). `loki/claude-code@float-2`; with no persona, the principal alone. The door tools act as the
 * same id, so one agent's door writes and outline writes are one actor. A persona is a recorded name, never a
 * permission. Without a machine (it couldn't be read) the principal is the bare client, as it was.
 */
export function actorOf(input: Record<string, unknown>, env: { OUTLINER_ACTOR?: string; EP0CH_AGENT?: string }, machine?: string, folder?: string): string {
  const principal = machine ? `claude-code@${machine}` : 'claude-code'
  const persona = sessionPersonaOf(input, env, folder)
  return persona ? `${persona}/${principal}` : principal
}

/**
 * The persona a session writes as, `actorOf`'s first-match rule without the principal: what the "writes as" line
 * shows, and what the claude.ai connector's writes are filled with (hooks/connector-persona.ts).
 */
export function sessionPersonaOf(input: Record<string, unknown>, env: { OUTLINER_ACTOR?: string; EP0CH_AGENT?: string }, folder?: string): string | undefined {
  return personaOf(input, env) ?? personaOf({}, { OUTLINER_ACTOR: folder })
}

function personaOf(input: Record<string, unknown>, env: { OUTLINER_ACTOR?: string; EP0CH_AGENT?: string }): string | undefined {
  for (const candidate of [input.actor, env.OUTLINER_ACTOR, env.EP0CH_AGENT]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    // A claimed persona is a label, never a principal: anything before a `/` or `@` the claim brings is dropped.
    const persona = candidate.trim().split(/[/@]/)[0]!.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64)
    if (persona && PERSONA.test(persona) && persona !== 'claude-code') return persona
  }
  return undefined
}

// ─── Checked input ─────────────────────────────────────────────────────────

/** Any tool this mod registers, as `checkedInput` needs it. */
export interface ToolWithSchema {
  name: string
  inputSchema: Json
  example?: Json
  aliases?: Record<string, readonly string[]>
}

/**
 * A tool call's input checked once, for every tool: aliases of `ref` renamed, unknown, missing and mistyped
 * arguments answered with the schema line and a working call (tool-args.ts). A plugin tool's arguments arrive flat on
 * the event, beside `tool`, so `tool` is not one of them. The input to use, or the denial text.
 */
export function checkedInput(tool: ToolWithSchema, event: Record<string, unknown>): { input: Record<string, unknown>; dropped: string[] } | string {
  const checked = checkToolArgs(
    { name: tool.name, schema: tool.inputSchema as ToolSchema, example: tool.example ?? {}, ...(tool.aliases ? { aliases: tool.aliases } : {}), ignore: EVENT_KEYS, dropUnknown: true },
    event,
  )
  if (!checked.ok) return checked.error
  // What was dropped as no argument (host metadata, or a name the model made up: PIE-871's `kind`): said with the answer.
  const declared = (tool.inputSchema as ToolSchema).properties ?? {}
  const known = new Set<string>([...EVENT_KEYS, ...Object.keys(declared), ...('ref' in declared ? REF_ALIASES : []), ...Object.values(tool.aliases ?? {}).flat()])
  return { input: checked.args, dropped: Object.keys(event).filter(key => event[key] !== undefined && !known.has(key)) }
}

/** The line put before a tool's answer when names were dropped (checkedInput): the call ran without them. */
export function droppedNote(tool: ToolWithSchema, dropped: readonly string[]): string {
  if (!dropped.length) return ''
  const names = Object.keys((tool.inputSchema as ToolSchema).properties ?? {}).filter(name => name !== 'actor')
  return `Not used: ${dropped.map(name => `\`${name}\``).join(', ')} ${dropped.length === 1 ? 'is no argument' : 'are no arguments'} of ${tool.name} (its arguments: ${names.join(', ')}); the call ran without ${dropped.length === 1 ? 'it' : 'them'}.\n`
}

/** What a plugin tool event carries besides the tool's arguments. */
const EVENT_KEYS = ['tool', 'tool_use_id', 'toolUseId', 'type', 'hook_event_name', 'session_id', 'cwd', 'agentId', 'agent_id', 'agentType', 'agent_type'] as const

/** `show`: opens a note for the person (the mod's own handler, hooks/register.ts). */
export const SHOW_TOOL: ToolWithSchema & { description: string } = {
  name: 'show',
  example: { ref: 'PIE-123' },
  description:
        'Show the note `ref` to the person: in the Outliner Detail beside this conversation in Herdr (the one linked to the ' +
        "Tree in this Herdr workspace, or one opened when there is none), so the person can read it beside the chat. " +
        "When this session runs in an ep0ch-door tile, it opens in that door, where its tile's opens land, instead; " +
        'with neither (the desktop app, VS Code, a terminal outside Herdr), in this mod\'s mentions pane beside the chat. ' +
        'It never moves their focus, and a Detail they are editing in refuses it. Use it when pointing the person at a note matters; ' +
        'references in replies are already clickable.',
  inputSchema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'The note: a Work ID (PIE-123), [[page]], ((block-uuid)), bare block UUID, or pi-outliner:// URI.' },
    },
    required: ['ref'],
    additionalProperties: false,
  },
}
