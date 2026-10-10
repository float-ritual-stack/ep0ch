/**
 * Outline and door tools for Claude (PIE-504), so an agent never hand-rolls a
 * script to read, edit or comment on a note, or to act in the door it runs in.
 *
 * - `outline_*`: each is one call to the installed CLI's `agent <operation>`
 *   (src/agent-tools.ts) with the tool's input as JSON on stdin. The service and
 *   that module own the rules; this file only names the operation and checks
 *   the input's shape.
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

import { checkToolArgs, type ToolSchema } from './tool-args'

type Json = Record<string, unknown>

export interface OutlineToolDefinition {
  name: string
  description: string
  inputSchema: Json
  /** A call that works. */
  example: Json
  /** Names this tool also answers to for an argument, beyond the reference aliases for `ref`. */
  aliases?: Record<string, readonly string[]>
  /** The CLI `agent` operation and its JSON input, or the reason the input is unusable. */
  command(input: Record<string, unknown>): { operation: string; input: Json } | string
}

const ACTOR = {
  type: 'string',
  description: 'Who this is attributed to. Leave it out: it defaults to OUTLINER_ACTOR or EP0CH_AGENT. It names a persona; the write is recorded as `<persona>/claude-code@<machine>`, so the machine and client are always shown.',
}
const REF = {
  type: 'string',
  description: 'The block: its id, ((id)), [[page]] or a Work ID (PIE-123). Never a title: find it with outline_find first.',
}
const EXPECTED = {
  type: 'integer',
  minimum: 1,
  description: 'The revision outline_read returned. A block that changed since is refused: read it again.',
}

/** A write's schema carries `actor`, the attribution override; a read's has none (outline_changes' `actor` is a filter). */
function schema(properties: Json, required: string[], writes = true): Json {
  return { type: 'object', properties: writes ? { ...properties, actor: ACTOR } : properties, required, additionalProperties: false }
}

/** The input without the actor, which travels as a CLI flag, and without keys left undefined. */
function inputOf(input: Record<string, unknown>, keys: readonly string[]): Json {
  const out: Json = {}
  for (const key of keys) if (input[key] !== undefined) out[key] = input[key]
  return out
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

export const OUTLINE_TOOLS: readonly OutlineToolDefinition[] = [
  {
    name: 'outline_read',
    example: {"ref": "PIE-123", "depth": 1},
    description:
      "Read the note `ref`: its full text (never just the title), properties, revision, who last wrote it and when, and its " +
      'children to `depth` levels (default 1), at most `limit` descendants (default 50), each with full text. ' +
      '`complete` says whether anything was left out; a child with `more` has unread children. Read before you ' +
      'edit: outline_edit and outline_patch need the revision this returns. A Resource (`resource:<id>`, or a ' +
      '`[file::path]` token) reads as its stored text with the comment threads that are open on it: read a file ' +
      'that has threads before you rewrite it.',
    inputSchema: schema({
      ref: REF,
      depth: { type: 'integer', minimum: 0, maximum: 6 },
      limit: { type: 'integer', minimum: 0, maximum: 500 },
    }, ['ref'], false),
    command(input) {
      if (!nonEmpty(input.ref)) return 'Give the ref: a block id, ((id)), [[page]] or Work ID.'
      return { operation: 'read', input: inputOf(input, ['ref', 'depth', 'limit']) }
    },
  },
  {
    name: 'outline_find',
    example: {"text": "seed swap"},
    description:
      'Find blocks (no `ref` needed) by text, a property (`key=value`, or `key`), a property key (hasKey), a query in the saved-view ' +
      'grammar (`type=roadmap-item AND work-stage=doing`), or a saved view. text, property, hasKey, query and under ' +
      'combine; view stands alone. Returns rows (id, title, revision); read one with outline_read.',
    inputSchema: schema({
      text: { type: 'string' },
      property: { type: 'string', description: 'key=value, or key for any value' },
      hasKey: { type: 'string' },
      query: { type: 'string' },
      view: { type: 'string', description: 'A saved view (virtual branch): its id or ((id))' },
      under: { type: 'string', description: 'Only blocks under this one (a ref)' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    }, [], false),
    command(input) {
      if (!['text', 'property', 'hasKey', 'query', 'view'].some(key => nonEmpty(input[key]))) {
        return 'Give text, property, hasKey, query or view to find blocks by.'
      }
      return { operation: 'find', input: inputOf(input, ['text', 'property', 'hasKey', 'query', 'view', 'under', 'limit']) }
    },
  },
  {
    name: 'outline_resolve',
    example: {"ref": "[[Seed Swap]]"},
    description:
      'Resolve `ref` ([[page]], ((id)), a Work ID or an id) to its block id, title and revision, without ' +
      'reading the whole note. An unknown page is an error, never a new page.',
    inputSchema: schema({ ref: REF }, ['ref'], false),
    command(input) {
      if (!nonEmpty(input.ref)) return 'Give the ref to resolve.'
      return { operation: 'resolve', input: inputOf(input, ['ref']) }
    },
  },
  {
    name: 'outline_edit',
    example: {"ref": "PIE-123", "expectedRevision": 3, "append": "One more line."},
    description:
      'Rewrite the note `ref`, checked against the revision you read with outline_read: its whole `text`, one ' +
      '`replaceSection` (the text under a heading, subheadings included, as Detail folds it), or an `append` at the end. Give exactly one. ' +
      'Refused before anything is written: an empty or whitespace-only result, a stale revision (read again, then ' +
      'edit), and dropping a [page::…] property or an ^anchor other notes link to (pass allowStructural: true only ' +
      'when removing them is the point). Returns the new revision and a short diff. Use it for rewriting your own ' +
      'pages, such as a status page; for small edits to a note the person may be typing in, use outline_patch.',
    inputSchema: schema({
      ref: REF,
      expectedRevision: EXPECTED,
      text: { type: 'string', description: 'The whole new text: title line, properties and body' },
      replaceSection: {
        type: 'object',
        properties: {
          heading: { type: 'string', description: 'Heading text, optionally with its ## level' },
          body: { type: 'string' },
        },
        required: ['heading', 'body'],
        additionalProperties: false,
      },
      append: { type: 'string', description: 'Added as a new paragraph at the end (start it with a newline to join the last line)' },
      allowStructural: { type: 'boolean' },
    }, ['ref', 'expectedRevision']),
    command(input) {
      if (!nonEmpty(input.ref)) return 'Give the ref of the note to edit.'
      if (typeof input.expectedRevision !== 'number') return 'Give expectedRevision: read the note with outline_read first.'
      const modes = ['text', 'replaceSection', 'append'].filter(key => input[key] !== undefined && input[key] !== null)
      if (modes.length !== 1) return 'Give exactly one of text, replaceSection or append.'
      if (modes[0] === 'text' && !nonEmpty(input.text)) return 'The new text is empty; an edit never blanks a note.'
      if (modes[0] === 'append' && !nonEmpty(input.append)) return 'The text to append is empty.'
      return { operation: 'edit', input: inputOf(input, ['ref', 'expectedRevision', 'text', 'replaceSection', 'append', 'allowStructural']) }
    },
  },
  {
    name: 'outline_create',
    example: {"parent": "PIE-123", "text": "Bring labels"},
    description:
      'Create a block under `parent` (a ref, or root), at `position` among its siblings (0 is first; default last). ' +
      'Returns its id, ((ref)) and revision.',
    inputSchema: schema({
      parent: { type: 'string', description: 'The parent: a ref, or root' },
      text: { type: 'string' },
      position: { type: 'integer', minimum: 0 },
    }, ['parent', 'text']),
    command(input) {
      if (!nonEmpty(input.parent) || !nonEmpty(input.text)) return 'Give the parent and non-empty text.'
      return { operation: 'create', input: inputOf(input, ['parent', 'text', 'position']) }
    },
  },
  {
    name: 'outline_comment',
    example: {"ref": "PIE-123", "body": "Is this still true?", "whole": true},
    description:
      'Start a comment thread on the note `ref`, as you: on an exact `quote` of its source text (add start, near, prefix or ' +
      'suffix when the quote repeats), or on the `whole` note. With a quote and no body it\'s a highlight. properties (open: kind, tags, color as a theme tone, or any key) are written on the thread; an @name line in the body asks an agent that answers in threads, in the thread. Returns the thread id for outline_reply and ' +
      'outline_resolve_thread. A requestId makes a retry return the same thread. `ref` may be a Resource ' +
      '(`resource:<id>` or a `[file::path]` token) instead of a note: the quote is exact text of the file as ' +
      'outline_read returned it, `from` names the note whose link opened it, and the file is never written.',
    inputSchema: schema({
      ref: REF,
      body: { type: 'string' },
      quote: { type: 'string', description: 'Exact source text the comment is about' },
      whole: { type: 'boolean', description: 'true: about the whole note, instead of a quote' },
      start: { type: 'integer', minimum: 0, description: 'The quote’s UTF-16 offset, when it repeats' },
      near: { type: 'integer', minimum: 0, description: 'When the quote repeats: the offset to be nearest' },
      properties: { type: 'object', description: 'The thread’s own properties, open: kind (highlight, note, question, define…), tags, color (a theme tone: default, good, warn, bad, dim, accent), any other key' },
      prefix: { type: 'string' },
      suffix: { type: 'string' },
      requestId: { type: 'string' },
      from: { type: 'string', description: 'A Resource comment: the note whose link opened it' },
      revision: { type: 'integer', minimum: 1, description: 'A Resource comment: the revision outline_read returned; the comment is refused if the file changed since' },
    }, ['ref']),
    command(input) {
      if (!nonEmpty(input.ref)) return 'Give the note.'
      if ((input.whole === true) === (typeof input.quote === 'string')) return 'Give either quote (exact source text) or whole: true.'
      if (!nonEmpty(input.body) && (input.whole === true || (input.body !== undefined && input.body !== ''))) return 'Give a non-empty comment (only a quote with no body is a highlight).'
      return { operation: 'comment', input: inputOf(input, ['ref', 'body', 'quote', 'whole', 'start', 'near', 'prefix', 'suffix', 'requestId', 'from', 'revision', 'properties']) }
    },
  },
  {
    name: 'outline_reply',
    example: {"thread": "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11", "body": "Yes, checked today."},
    description: 'Reply in a comment thread, as you. `thread` is the id outline_comment returned (or a thread you read).',
    inputSchema: schema({ thread: { type: 'string' }, body: { type: 'string' }, requestId: { type: 'string' } }, ['thread', 'body']),
    command(input) {
      if (!nonEmpty(input.thread) || !nonEmpty(input.body)) return 'Give the thread and a non-empty reply.'
      return { operation: 'reply', input: inputOf(input, ['thread', 'body', 'requestId']) }
    },
  },
  {
    name: 'outline_resolve_thread',
    example: {"thread": "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11", "resolved": true},
    description: 'Resolve a comment thread (resolved: true), or reopen it (false), as you.',
    inputSchema: schema({ thread: { type: 'string' }, resolved: { type: 'boolean' } }, ['thread', 'resolved']),
    command(input) {
      if (!nonEmpty(input.thread) || typeof input.resolved !== 'boolean') return 'Give the thread and resolved: true or false.'
      return { operation: 'resolve-thread', input: inputOf(input, ['thread', 'resolved']) }
    },
  },
  {
    name: 'view_order',
    example: {"ref": "((7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34))", "ids": ["PIE-123", "PIE-124"]},
    aliases: { ref: ['view'] },
    description:
      'Read or set the hand-set order of the view `ref` (a view with no [sort::] is ordered by hand: the order its board lanes, ' +
      'figures and Tree show). With `ids`, put those members first, in the order given; the rest keep their order ' +
      'after them. Ids are block ids, ((id)) or Work IDs. Refused for a sorted view (the refusal names the fix) and ' +
      'for an id the view doesn\'t hold. Returns the order after the write.',
    inputSchema: schema({
      ref: { type: 'string', description: 'The view (a virtual-branch block): id, ((id)) or [[page]]' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Members to put first, in this order; omit to read the order' },
    }, ['ref']),
    command(input) {
      if (!nonEmpty(input.ref)) return 'Give the ref of the view: its id or ((id)).'
      if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some(id => !nonEmpty(id)))) return 'ids is a list of block ids, ((id))s or Work IDs.'
      return { operation: 'view-order', input: { view: input.ref, ...inputOf(input, ['ids']) } }
    },
  },
  {
    name: 'outline_changes',
    example: {"since": "2026-03-01T09:00:00Z"},
    description:
      'What changed since a point: an ISO time, or the `cursor` an earlier call returned. Each block once, at its ' +
      'latest change, newest first, with who made it (author, actorId, sessionId). `author` (user, agent, system) and ' +
      '`actor` (an agent id, such as claude-code) narrow it. `complete: false`: more changed than `limit`; call again ' +
      'with the same since and the returned `before` for older ones. Once complete, pass `cursor` as since next time.',
    inputSchema: schema({
      since: { type: ['string', 'integer'], description: 'An ISO time, or a cursor from an earlier call' },
      author: { type: 'string', enum: ['user', 'agent', 'system'] },
      actor: { type: 'string', description: 'Only this agent’s changes, by actor id (claude-code, garden-agent…)' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      before: { type: 'integer', minimum: 1, description: 'The `before` an incomplete answer returned: its older changes' },
    }, ['since'], false),
    command(input) {
      if (!nonEmpty(input.since) && typeof input.since !== 'number') return 'Give since: an ISO time or a cursor.'
      return { operation: 'changes', input: inputOf(input, ['since', 'author', 'actor', 'limit', 'before']) }
    },
  },
  {
    name: 'outline_patch',
    example: {"ref": "PIE-123", "revision": 3, "patches": [{"observed": "Borlotti", "replacement": "Borlotti only"}]},
    description:
      'Small edits to the note `ref` the person may be typing in, without waiting for their save (draft.patch); for ' +
      'rewriting your own pages, such as a status page, use outline_edit. Each patch names the exact `observed` text ' +
      '(never empty) and its `replacement`, against the `revision` outline_read returned; all apply as one edit or ' +
      'none. A live draft gets it in place; otherwise it is an ordinary edit of the saved note. policy `edit` (the ' +
      'default) has outline_edit\'s guard (allowStructural likewise); `prose` keeps every link, anchor and property. ' +
      'If the note was saved since you read it, the patch applies on the newer text when every observed span is still there ' +
      'once and nobody rewrote its line (the answer says rebasedFrom: the revision you read); it becomes one proposal for the ' +
      'person (outcome: proposed) when a span is gone, changed or ambiguous, when the note is open in a draft, or when prose refuses. ' +
      'A proposal sits beside the note and never changes its text or revision; sending the same patch again while yours is open ' +
      'returns that proposal (deduped: true) instead of a second copy.',
    inputSchema: schema({
      ref: REF,
      revision: EXPECTED,
      patches: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            observed: { type: 'string' },
            replacement: { type: 'string' },
            range: {
              type: 'object',
              properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } },
              required: ['start', 'end'],
              description: 'Where you saw it (UTF-16 offsets): a hint',
            },
          },
          required: ['observed', 'replacement'],
        },
      },
      mark: { type: 'string', description: 'The @request line the patch answers: spans must end above it' },
      policy: { type: 'string', enum: ['edit', 'prose'], default: 'edit' },
      allowStructural: { type: 'boolean' },
    }, ['ref', 'revision', 'patches']),
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== 'number') return 'Give the ref and the revision you read.'
      if (!Array.isArray(input.patches) || input.patches.length === 0) return 'Give at least one patch: {observed, replacement}.'
      if (input.policy !== undefined && input.policy !== 'edit' && input.policy !== 'prose') return 'policy is edit (the default) or prose.'
      return { operation: 'patch', input: { policy: 'edit', ...inputOf(input, ['ref', 'revision', 'patches', 'mark', 'policy', 'allowStructural']) } }
    },
  },
  {
    name: 'outline_set_property',
    example: {"ref": "PIE-123", "key": "status", "value": "open", "revision": 3},
    description:
      'Set one [key::value] property on the header line of the note `ref` (the chips that end its first line): the value replaced ' +
      'where the key is, or the chip added at the line\'s end. Against the `revision` outline_read returned, as one ' +
      'outline_patch span, so it has the patch\'s rules: a live draft gets it in place, and a note that changed since ' +
      'becomes a proposal (outcome: proposed). A key written more than once is a list: edit it with outline_patch.',
    inputSchema: schema({
      ref: REF,
      key: { type: 'string', description: 'The property key: letters, digits, - and _' },
      value: { type: 'string', description: 'One line, without ]' },
      revision: EXPECTED,
    }, ['ref', 'key', 'value', 'revision']),
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== 'number') return 'Give the ref and the revision you read.'
      if (!nonEmpty(input.key) || !nonEmpty(input.value)) return 'Give the key and a non-empty value.'
      return { operation: 'set-property', input: inputOf(input, ['ref', 'key', 'value', 'revision']) }
    },
  },
  {
    name: 'outline_assign_id',
    example: {"ref": "((7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34))", "revision": 3},
    description:
      'Give the note `ref` the outline\'s next work id (outliner work-id-allocate), against the `revision` ' +
      'outline_read returned: the id is stamped on the note and is its page address, so `[[HUB-002]]` reaches it ' +
      '(no [page::…] needed; adding one duplicates it). The prefix is whatever the outline has. For notes that ' +
      'aren\'t roadmap items, such as an outbox draft; work_create is only for roadmap items on the workboard. ' +
      'A note that already has an id answers with it, unchanged. Returns `workId` and `page`.',
    inputSchema: schema({ ref: REF, revision: EXPECTED }, ['ref', 'revision']),
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== 'number') return 'Give the ref and the revision you read.'
      return { operation: 'assign-id', input: inputOf(input, ['ref', 'revision']) }
    },
  },
]

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
    description: 'What the door shows the person now (ep0ch peek): the screen as structured state and as text. Only reads.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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

/**
 * `ep0ch peek` prints the screen's state as indented JSON, then the screen's
 * text. Both, as one compact value; the text alone when the state doesn't parse.
 */
export function peekOf(stdout: string): { screen?: unknown; text: string } {
  const lines = stdout.split('\n')
  const end = lines.findIndex(line => line === '}' || line === ']')
  if (lines[0]?.startsWith('{') || lines[0]?.startsWith('[')) {
    try {
      return { screen: JSON.parse(lines.slice(0, end + 1).join('\n')), text: lines.slice(end + 1).join('\n').trimEnd() }
    } catch {
      // Not the state this expects: the text alone.
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
 * Who a write is attributed to (PIE-679): the principal, which is this client on this machine (`claude-code@float-2`),
 * and the persona the caller declared on top: the caller's `actor`, else OUTLINER_ACTOR, else EP0CH_AGENT (the door's own
 * name for the agent). `loki/claude-code@float-2`; with no persona, the principal alone. A persona only labels the principal
 * it is declared under, so two machines' `claude-code` are told apart even when both say `loki`. Without a machine
 * (it couldn't be read) the principal is the bare client, as it was.
 */
export function actorOf(input: Record<string, unknown>, env: { OUTLINER_ACTOR?: string; EP0CH_AGENT?: string }, machine?: string): string {
  const principal = machine ? `claude-code@${machine}` : 'claude-code'
  return personaOf(input, env) ? `${personaOf(input, env)}/${principal}` : principal
}

/**
 * The persona alone, as the door's tools take it (`--as`, door-open's `--actor`): those name an agent on screen and write
 * no note, so they keep the short name. The caller's `actor`, else OUTLINER_ACTOR, else EP0CH_AGENT, else claude-code.
 */
export function doorActorOf(input: Record<string, unknown>, env: { OUTLINER_ACTOR?: string; EP0CH_AGENT?: string }): string {
  for (const candidate of [input.actor, env.OUTLINER_ACTOR, env.EP0CH_AGENT]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return 'claude-code'
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
export function checkedInput(tool: ToolWithSchema, event: Record<string, unknown>): { input: Record<string, unknown> } | string {
  const checked = checkToolArgs(
    { name: tool.name, schema: tool.inputSchema as ToolSchema, example: tool.example ?? {}, ...(tool.aliases ? { aliases: tool.aliases } : {}), ignore: EVENT_KEYS, dropUnknown: true },
    event,
  )
  return checked.ok ? { input: checked.args } : checked.error
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
