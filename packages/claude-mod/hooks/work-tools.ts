/**
 * Workboard tools for Claude: each one is a thin call to the installed CLI's
 * `work` / `note` commands (src/work-tools.ts), so Claude, Codex and Pi share
 * one implementation. This file only turns tool arguments into CLI argv.
 */

type Json = Record<string, unknown>

export interface WorkToolDefinition {
  name: string
  description: string
  inputSchema: Json
  /** A call that works. */
  example: Json
  /** Names this tool also answers to for an argument (`item` is `ref`). */
  aliases?: Record<string, readonly string[]>
  /** The CLI arguments and stdin for one call, or the reason the input is unusable. */
  command(input: Record<string, unknown>): { args: string[]; stdin?: string } | string
}

const ITEM = { type: 'string', description: 'The roadmap item: a Work ID (PIE-123) or its block UUID. Never a title.' }
const EXPECTED = {
  type: 'integer',
  minimum: 1,
  description: 'The revision you read; the write is refused if the block changed since.',
}

function text(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function expected(input: Record<string, unknown>): string[] {
  const value = input.expectedRevision
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? ['--expected', String(value)] : []
}

/**
 * `--name=value`, one word: a value that begins with `--` (a title about `--machine`) is the option's value, never
 * read as an option of its own ("argument is ambiguous").
 */
function opt(name: string, value: string): string {
  return `--${name}=${value}`
}

/**
 * `args` with `options` added before its operands: before a `--` that ends the options (an item, a heading or a value
 * that begins with `--` is an operand after it), else at the end. How the caller's own flags (who, which session) join.
 */
export function withOptions(args: readonly string[], options: readonly string[]): string[] {
  const at = args.indexOf('--')
  return at < 0 ? [...args, ...options] : [...args.slice(0, at), ...options, ...args.slice(at)]
}

function schema(properties: Json, required: string[]): Json {
  return { type: 'object', properties, required, additionalProperties: false }
}

export const WORK_TOOLS: readonly WorkToolDefinition[] = [
  {
    name: 'work_create',
    example: {"title": "Show the weather on the home screen", "project": "ep0ch", "arc": "door", "priority": "medium", "tracks": ["door"]},
    description:
      "Create a roadmap item under the project's work queue with a newly allocated Work ID. Returns the Work ID, " +
      'block reference and revision. New work defaults to unprioritized; pass stage only when it was agreed.',
    inputSchema: schema({
      title: { type: 'string', description: 'Concise outcome, without a Work ID or property tokens' },
      project: { type: 'string' },
      arc: { type: 'string' },
      tracks: { type: 'array', items: { type: 'string' }, minItems: 1 },
      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      stage: { type: 'string', enum: ['unprioritized', 'later', 'queued', 'doing', 'review', 'validate'] },
      batch: { type: 'string', description: 'UUID of the agreed work-batch' },
      body: { type: 'string', description: 'Markdown body: context and acceptance criteria' },
    }, ['title', 'project', 'arc', 'tracks', 'priority']),
    command(input) {
      const tracks = Array.isArray(input.tracks) ? input.tracks.filter((track): track is string => typeof track === 'string') : []
      const [title, project, arc, priority] = ['title', 'project', 'arc', 'priority'].map(key => text(input, key))
      if (!title || !project || !arc || !priority || tracks.length === 0) return 'Give a title, project, arc, priority and at least one track.'
      const args = ['work', 'create', opt('title', title), opt('project', project), opt('arc', arc), opt('priority', priority),
        ...tracks.map(track => opt('track', track))]
      const stage = text(input, 'stage')
      const batch = text(input, 'batch')
      if (stage) args.push(opt('stage', stage))
      if (batch) args.push(opt('batch', batch))
      const body = text(input, 'body')
      return body ? { args: [...args, '--stdin'], stdin: body } : { args }
    },
  },
  {
    name: 'work_stage',
    example: {"ref": "PIE-123", "stage": "doing"},
    aliases: { ref: ['item'] },
    description:
      "Move the roadmap item `ref` to another work stage (queued, doing, review, validate, later…), checked against its " +
      'revision and read back. Done needs proof: use work_complete.',
    inputSchema: schema({ ref: ITEM, stage: { type: 'string' }, expectedRevision: EXPECTED }, ['ref', 'stage']),
    command(input) {
      const [item, stage] = [text(input, 'ref'), text(input, 'stage')]
      if (!item || !stage) return 'Give the ref and the stage.'
      return { args: ['work', 'stage', ...expected(input), '--', item, stage] }
    },
  },
  {
    name: 'work_set',
    example: {"ref": "PIE-123", "key": "priority", "value": "high"},
    aliases: { ref: ['item'] },
    description:
      'Set one single-valued property on the roadmap item `ref` (priority, work-batch, arc…), checked against its revision ' +
      'and read back. Identity properties and multi-valued ones are refused. On a delivery only delivery-stage can ' +
      'be set: complete finishes a merged delivery (e.g. one left in validate on an item already done), validate reopens it.',
    inputSchema: schema({
      ref: {
        type: 'string',
        description: 'A roadmap item (Work ID or block UUID), or for delivery-stage a delivery: its block UUID or key (PIE-123/door).',
      },
      key: { type: 'string' },
      value: { type: 'string' },
      expectedRevision: EXPECTED,
    }, ['ref', 'key', 'value']),
    command(input) {
      const [item, key, value] = [text(input, 'ref'), text(input, 'key'), text(input, 'value')]
      if (!item || !key || !value) return 'Give the ref, the property key and its value.'
      return { args: ['work', 'set', ...expected(input), '--', item, key, value] }
    },
  },
  {
    name: 'work_deliver',
    example: {"ref": "PIE-123", "repo": "example-org/example-repo", "pr": 42},
    aliases: { ref: ['item'] },
    description:
      "Record a GitHub pull request as one of the deliveries of the item `ref` and sync its live state: an open PR moves the " +
      "item to review, a merged one to validate. The PR's branches must match the delivery's. An item can have " +
      'several deliveries (one per repository or branch), each under its own key.',
    inputSchema: schema({
      ref: ITEM,
      repo: { type: 'string', description: 'owner/name' },
      pr: { type: 'integer', minimum: 1 },
      key: {
        type: 'string',
        description:
          'Delivery name (door → PIE-123/door). Omitted: the delivery already recording this repo and branch, else ' +
          'primary, else (primary is another repo) the repository name. A second branch in the same repo needs one.',
      },
      base: { type: 'string', description: "Base branch; defaults to the PR's" },
      branch: { type: 'string', description: "Work branch; defaults to the PR's head" },
    }, ['ref', 'repo', 'pr']),
    command(input) {
      const [item, repo] = [text(input, 'ref'), text(input, 'repo')]
      const pr = input.pr
      if (!item || !repo || typeof pr !== 'number' || !Number.isSafeInteger(pr) || pr < 1) return 'Give the ref, repo and PR number.'
      const args = ['work', 'deliver', opt('repo', repo), opt('pr', String(pr))]
      const [key, base, branch] = [text(input, 'key'), text(input, 'base'), text(input, 'branch')]
      if (key) args.push(opt('key', key))
      if (base) args.push(opt('base', base))
      if (branch) args.push(opt('branch', branch))
      return { args: [...args, '--', item] }
    },
  },
  {
    name: 'work_complete',
    example: {"ref": "PIE-123", "allMerged": true, "proof": "Shipped\n\nChecked on a scratch host."},
    aliases: { ref: ['item'] },
    description:
      'Accept the roadmap item `ref` with linked proof. Every incomplete delivery must be covered: name them in deliveries ' +
      'or set allMerged; each must be merged. If another delivery is still incomplete the call is refused, naming it ' +
      'and how to finish it. The proof is added as a child block (or an existing linked proof block is used), the ' +
      'covered deliveries become complete and the item done.',
    inputSchema: schema({
      ref: ITEM,
      deliveries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Deliveries to complete: block UUID, key (PIE-123/door) or name (door)',
      },
      allMerged: { type: 'boolean', description: 'Complete every delivery whose PR is merged, instead of naming them' },
      proof: { type: 'string', description: 'Proof as Markdown: first line is its title' },
      proofBlock: { type: 'string', description: 'An existing proof block UUID linked to the item, instead of proof text' },
    }, ['ref']),
    command(input) {
      const item = text(input, 'ref')
      const [proof, proofBlock] = [text(input, 'proof'), text(input, 'proofBlock')]
      const deliveries = Array.isArray(input.deliveries)
        ? input.deliveries.filter((delivery): delivery is string => typeof delivery === 'string' && delivery.trim() !== '')
        : []
      if (!item) return 'Give the ref.'
      if (!proof === !proofBlock) return 'Give either proof text or an existing proofBlock.'
      if (input.allMerged === true && deliveries.length) return 'Name deliveries or set allMerged, not both.'
      const args = ['work', 'complete', ...deliveries.map(delivery => opt('delivery', delivery)),
        ...(input.allMerged === true ? ['--all-merged'] : [])]
      return proof ? { args: [...args, '--stdin', '--', item], stdin: proof } : { args: [...args, opt('proof-block', proofBlock!), '--', item] }
    },
  },
  {
    name: 'work_body',
    example: {"ref": "PIE-123", "body": "Context and acceptance criteria."},
    aliases: { ref: ['item'] },
    description:
      "Replace the body of the roadmap item (or any block) `ref` below its title and property lines, checked against its revision.",
    inputSchema: schema({ ref: ITEM, body: { type: 'string' }, expectedRevision: EXPECTED }, ['ref', 'body']),
    command(input) {
      const item = text(input, 'ref')
      if (!item || typeof input.body !== 'string') return 'Give the ref and its new body.'
      return { args: ['work', 'body', '--stdin', ...expected(input), '--', item], stdin: input.body }
    },
  },
  {
    name: 'note_section',
    example: {"ref": "PIE-123", "heading": "## Now", "body": "Updated text."},
    aliases: { ref: ['item'] },
    description:
      'Replace one Markdown section of the note `ref`: the text under a heading up to the next heading of its level, as ' +
      'Detail folds it. The heading stays; the replaced text is returned as "previous".',
    inputSchema: schema({
      ref: { type: 'string', description: 'The note: block UUID or Work ID' },
      heading: { type: 'string', description: 'Heading text, optionally with its ## level' },
      body: { type: 'string' },
      expectedRevision: EXPECTED,
    }, ['ref', 'heading', 'body']),
    command(input) {
      const [block, heading] = [text(input, 'ref'), text(input, 'heading')]
      if (!block || !heading || typeof input.body !== 'string') return 'Give the ref of the note, the heading and the new section text.'
      return { args: ['note', 'section', '--stdin', ...expected(input), '--', block, heading], stdin: input.body }
    },
  },
]
