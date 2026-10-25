/**
 * The agent tools, each defined once (PIE-720, ADR 0003 §5): its name, what it does, its arguments, a call that works,
 * and the `outliner agent` operation that runs it. Every surface registers these definitions with its own identity:
 * the Claude mod (the session's outline and persona, `actor`), the MCP gateway and stdio server (the caller's outline
 * address, `uri` or `ref` in `outline`, and `call`), the outliner CLI's `agent` command, and the host API that code
 * calls (outliner `src/host-api.ts`). The handlers are the outliner's agent operations (`src/agent-tools.ts`), so a mod
 * tool, an MCP write and a script reach the same code.
 *
 * `AGENT_TOOL_SURFACES` says where each tool is registered and, where it isn't yet, why.
 *
 * The Claude mod's hooks can't import this module, so `packages/claude-mod/hooks/agent-tool-definitions.ts` carries
 * the same code below the marker line (the door's `test/tool-args.test.ts` keeps the two byte-equal). Edit this file,
 * then copy everything from the marker down.
 *
 */
import type { ToolArgsSpec, ToolSchema } from "./tool-args";

// --- agent tool definitions below this line ---

/** The `outliner agent` operations a tool runs. */
export type AgentToolOperation =
  | "artifact-deploy"
  | "read" | "find" | "resolve" | "site" | "edit" | "create" | "comment" | "reply" | "edit-comment" | "resolve-thread"
  | "proposal-apply" | "proposal-dismiss" | "proposal-resolve" | "changes" | "patch" | "set-property" | "assign-id" | "move" | "trash" | "restore" | "view-order";

/**
 * How a surface names the block a tool acts on, filled into a description's `{note}` and `{parent}`: the mod says
 * "the note `ref`", the gateway "the note (its uri, or ref in outline)".
 */
export interface TargetWords {
  note: string;
  parent: string;
}

export interface AgentToolDefinition {
  name: string;
  /** What it does; `{note}` and `{parent}` are the block it acts on, in the surface's words (`describeTool`). */
  description: string;
  /** The argument that names the block it acts on, which a surface may address its own way; none for a thread or a search. */
  target?: "ref" | "parent";
  /** Its arguments, the target among them; a surface adds its own (the mod's `actor`, the gateway's `outline` and `call`). */
  properties: Record<string, ToolSchema>;
  required: readonly string[];
  /** A call that works. */
  example: Record<string, unknown>;
  /** Names this tool also answers to for an argument, beyond the reference aliases for `ref`. */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** It writes: the write is `author: agent`, attributed to the surface's actor. */
  writes: boolean;
  /** The `outliner agent` operation that runs it (outline_reply's `edit` runs `edit-comment`). */
  operation: AgentToolOperation;
  /** The agent operation and its input for one call, or the reason the input is unusable. Pure: every surface runs it. */
  command(input: Record<string, unknown>): { operation: AgentToolOperation; input: Record<string, unknown> } | string;
}

/** The words the Claude mod and the CLI use for the block a tool acts on. */
export const REF_WORDS: TargetWords = { note: "the note `ref`", parent: "`parent` (a ref, or root)" };

/**
 * What a write tool says a note can hold (PIE-721), said where an agent writes so it reaches past prose without being
 * reminded. The components themselves are outline_components' (each outline's own, extensions' among them); this names
 * only their kinds, and what the answer reports back.
 */
const NOTE_HOLDS =
  "A note can hold more than prose: live figures (::graph-* with query: or view:, so a count or a status stays true), " +
  "callouts, views, rules, buttons, templates and the outline's own components; outline_components gives each one's " +
  "properties and an example. The answer lists the `::` components the note now holds (`components`) and its `warnings` (a " +
  "figure's name or key with a typo, YAML that doesn't read, a reference that leads nowhere): the text is saved as written, " +
  "so fix them now.";

/**
 * The tools a session lists up front instead of behind tool search (PIE-721): where an agent starts, reads, learns the
 * components and writes a note. Each surface marks the ones it registers (the mod with `isDeferred: false`, the
 * gateway with `_meta` `anthropic/alwaysLoad`); the rest wait behind tool search.
 */
export const UP_FRONT_TOOLS: readonly string[] = ["list_outlines", "outline_find", "outline_query", "outline_read", "outline_components", "outline_edit", "outline_create", "outline_patch"];

const REF: ToolSchema = {
  type: "string",
  description: "The block: its id, ((id)), [[page]] or a Work ID (PIE-123). Never a title: find it with outline_find first.",
};
const EXPECTED: ToolSchema = {
  type: "integer",
  minimum: 1,
  description: "The revision outline_read returned. A block that changed since is refused: read it again.",
};
const NOTE = "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34";
const THREAD = "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11";

/** The input's own keys among `keys`, without the ones left undefined. */
function inputOf(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (input[key] !== undefined) out[key] = input[key];
  return out;
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  {
    name: "artifact_deploy", operation: "artifact-deploy", writes: true,
    description: "Deploy an ep0ch-artifacts repo, register it and update notes that name it. The repo decides static store or Vercel.",
    example: { repo: "ep0ch-artifacts/moth-garden" }, properties: { repo: { type: "string" }, domain: { type: "string" } }, required: ["repo"],
    command(input) { return { operation: "artifact-deploy", input: inputOf(input, ["repo", "domain"]) }; },
  },
  {
    name: "outline_read",
    operation: "read",
    example: { ref: "PIE-123", depth: 1 },
    writes: false,
    target: "ref",
    description:
      "Read {note}: its full text (never just the title), `properties` (each key once with its `values`, as `find --json` gives them) and `fields` (the properties of a line or a spot in the text), revision, who last wrote it and when, and its " +
      "children to `depth` levels (default 1), at most `limit` descendants (default 50), each with full text. " +
      "`complete` says whether anything was left out; a child with `more` has unread children. A note that holds " +
      "a `{{ }}` also returns `site`: what each placeholder reads as (`values`, or a `problem` with the nearest keys), " +
      "how it was found (`route`), and the notes it came from (`deps`); `text` stays what the author wrote. Read before you " +
      "edit: outline_edit and outline_patch need the revision this returns. A Resource (`resource:<id>`, or a " +
      "`[file::path]` token) reads as its stored text with the comment threads that are open on it: read a file " +
      "that has threads before you rewrite it.",
    properties: { ref: REF, depth: { type: "integer", minimum: 0, maximum: 6 }, limit: { type: "integer", minimum: 0, maximum: 500 } },
    required: ["ref"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref: a block id, ((id)), [[page]] or Work ID.";
      return { operation: "read", input: inputOf(input, ["ref", "depth", "limit"]) };
    },
  },
  {
    name: "outline_find",
    operation: "find",
    example: { text: "seed swap" },
    writes: false,
    description:
      "Find blocks (no `ref` needed) by text, a property (`key=value`, or `key`), a property key (hasKey), a query in the saved-view " +
      "grammar (`type=roadmap-item AND work-stage=doing`), or a saved view. text, property, hasKey, query and under " +
      "combine; view stands alone. Returns rows (id, title, revision); read one with outline_read.",
    properties: {
      text: { type: "string" },
      property: { type: "string", description: "key=value, or key for any value" },
      hasKey: { type: "string" },
      query: { type: "string" },
      view: { type: "string", description: "A saved view (virtual branch): its id or ((id))" },
      under: { type: "string", description: "Only blocks under this one (a ref)" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      machinery: { type: "string", enum: ["hide", "only", "show"], description: "Notes tools wrote for their own bookkeeping (file touches, tosses, deliveries): left out unless this is show or only" },
    },
    required: [],
    command(input) {
      if (!["text", "property", "hasKey", "query", "view"].some(key => nonEmpty(input[key]))) {
        return "Give text, property, hasKey, query or view to find blocks by.";
      }
      return { operation: "find", input: inputOf(input, ["text", "property", "hasKey", "query", "view", "under", "limit", "machinery"]) };
    },
  },
  {
    name: "outline_resolve",
    operation: "resolve",
    example: { ref: "[[Seed Swap]]" },
    writes: false,
    target: "ref",
    description:
      "Resolve `ref` ([[page]], ((id)), a Work ID or an id) to its block id, title and revision, without " +
      "reading the whole note. An unknown page is an error, never a new page.",
    properties: { ref: REF },
    required: ["ref"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref to resolve.";
      return { operation: "resolve", input: inputOf(input, ["ref"]) };
    },
  },
  {
    name: "outline_site",
    operation: "site",
    example: { ref: "PIE-123", paths: ["this.owner", "this.tasks | status=todo"] },
    writes: false,
    target: "ref",
    description:
      "Read what {note}'s `{{ }}` placeholders say, and any `paths` you ask, the way the person's screen reads them (the " +
      "outline's one resolver): `this.owner`, `parent.project`, a bare `project` (the nearest value up the outline), " +
      "`((id)).query`, `[[page]].title`, `person.firstName` through a link value, `this.tasks | status=todo`, " +
      "`this.children | type=task .count`, `now.date-1d`, `props.week`. Every key is a list. A key the note writes wins over " +
      "its record field of the same name; `this.$created` is the record's. A key with a dot is `this[\"echo.node\"]`. " +
      "Returns, per placeholder and path: `values`, or a `problem` with a did-you-mean and an example that works; `route` " +
      "(which resolver answered, which fallback was taken); `links` (values that name a note); and `deps`, the notes it was " +
      "computed from. `draft` reads the text you are about to write, unsaved; `chain` reads a note as drawn inside another " +
      "(a `::use` in a host: `[{kind: \"use\", block, line}]`); `props` are the call's arguments. A note that holds `::use` " +
      "lines also returns `uses`: each call as the service reads it (its template, the `props` it gets, `problems` with the " +
      "nearest name and a call that works, `missing` required props). Only reads.",
    properties: {
      ref: REF,
      paths: { type: "array", items: { type: "string" }, description: "Paths to read besides the note's own placeholders: this.owner, parent.project, this.tasks | status=todo, now.date-1d" },
      draft: { type: "string", description: "The note's unsaved text: its placeholders are read as if it were saved" },
      chain: { type: "array", items: { type: "object" }, description: "Where the note is drawn, outermost first: [{ kind: \"use\" | \"embed\" | \"box\", block: <the note holding the invocation>, line?: number }]" },
      props: { type: "object", description: "The call's arguments, read as props.<name>: { status: \"paused\" }" },
      line: { type: "integer", minimum: 0, description: "The line of the note a bare key's lookup starts from (default: the first)" },
    },
    required: ["ref"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref: a block id, ((id)), [[page]] or Work ID.";
      if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some(p => !nonEmpty(p)))) return "paths is a list of paths, such as [\"this.owner\", \"this.tasks | status=todo\"].";
      if (input.draft !== undefined && typeof input.draft !== "string") return "draft is the note's unsaved text.";
      const props = input.props && typeof input.props === "object" && !Array.isArray(input.props)
        ? Object.fromEntries(Object.entries(input.props as Record<string, unknown>).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map(String)]))
        : undefined;
      return { operation: "site", input: { ...inputOf(input, ["ref", "paths", "draft", "chain", "line"]), ...(props ? { props } : {}) } };
    },
  },
  {
    name: "outline_edit",
    operation: "edit",
    example: { ref: "PIE-123", expectedRevision: 3, append: "One more line." },
    writes: true,
    target: "ref",
    description:
      "Rewrite {note}, checked against the revision you read with outline_read: its whole `text`, one " +
      "`replaceSection` (the text under a heading, subheadings included, as Detail folds it), or an `append` at the end. Give exactly one. With append, `at: \"^log\"` adds an output region after that anchor through placement: a held draft gets it in place, or outcome: proposed at a conflict; it returns the placement receipt instead of a diff. " +
      "Refused before anything is written: an empty or whitespace-only result, a stale revision (read again, then " +
      "edit in the same turn), and dropping a [page::…] property or an ^anchor other notes link to (pass allowStructural: true only " +
      "when removing them is the point). Returns the new revision and a short diff. Use it for rewriting your own " +
      "pages, such as a status page; for small edits to a note the person may be typing in, use outline_patch. " + NOTE_HOLDS,
    properties: {
      ref: REF,
      expectedRevision: EXPECTED,
      text: { type: "string", description: "The whole new text: title line, properties and body" },
      replaceSection: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Heading text, optionally with its ## level" },
          body: { type: "string" },
        },
        required: ["heading", "body"],
        additionalProperties: false,
      },
      append: { type: "string", description: "Added as a new paragraph at the end (start it with a newline to join the last line)" },
      at: { type: "string", description: "With append: ^anchor to add an output region after, through the held draft; returns outcome applied or proposed" },
      allowStructural: { type: "boolean" },
    },
    required: ["ref", "expectedRevision"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref of the note to edit.";
      if (typeof input.expectedRevision !== "number") return "Give expectedRevision: read the note with outline_read first.";
      const modes = ["text", "replaceSection", "append"].filter(key => input[key] !== undefined && input[key] !== null);
      if (modes.length !== 1) return "Give exactly one of text, replaceSection or append.";
      if (modes[0] === "text" && !nonEmpty(input.text)) return "The new text is empty; an edit never blanks a note.";
      if (modes[0] === "append" && !nonEmpty(input.append)) return "The text to append is empty.";
      return { operation: "edit", input: inputOf(input, ["ref", "expectedRevision", "text", "replaceSection", "append", "at", "allowStructural"]) };
    },
  },
  {
    name: "outline_create",
    operation: "create",
    example: { parent: "PIE-123", text: "Bring labels" },
    writes: true,
    target: "parent",
    description:
      "Create a block under {parent}, at `position` among its siblings (0 is first; default last). " +
      "Returns its id, ((ref)) and revision. " + NOTE_HOLDS,
    properties: {
      parent: { type: "string", description: "The parent: a ref, or root" },
      text: { type: "string" },
      position: { type: "integer", minimum: 0 },
    },
    required: ["parent", "text"],
    command(input) {
      if (!nonEmpty(input.parent) || !nonEmpty(input.text)) return "Give the parent and non-empty text.";
      return { operation: "create", input: inputOf(input, ["parent", "text", "position"]) };
    },
  },
  {
    name: "outline_comment",
    operation: "comment",
    example: { ref: "PIE-123", body: "Is this still true?", whole: true },
    writes: true,
    target: "ref",
    description:
      "Start a comment thread on {note}, as you: on an exact `quote` of its source text (add start, near, prefix or " +
      "suffix when the quote repeats), or on the `whole` note. With a quote and no body it's a highlight. properties (open: kind, tags, color as a theme tone, or any key) are written on the thread; an @name line in the body asks an agent that answers in threads, in the thread. Returns the thread id for outline_reply and " +
      "outline_resolve_thread. A requestId makes a retry return the same thread. `ref` may be a Resource " +
      "(`resource:<id>` or a `[file::path]` token) instead of a note: the quote is exact text of the file as " +
      "outline_read returned it, `from` names the note whose link opened it, and the file is never written.",
    properties: {
      ref: REF,
      body: { type: "string" },
      quote: { type: "string", description: "Exact source text the comment is about" },
      whole: { type: "boolean", description: "true: about the whole note, instead of a quote" },
      start: { type: "integer", minimum: 0, description: "The quote’s UTF-16 offset, when it repeats" },
      near: { type: "integer", minimum: 0, description: "When the quote repeats: the offset to be nearest" },
      kind: { type: "string", description: "The thread’s kind, written as [kind::…] on it (patch-note, question, highlight…); the same as properties.kind" },
      properties: { type: "object", description: "The thread’s own properties, open: kind (highlight, note, question, define…), tags, color (a theme tone: default, good, warn, bad, dim, accent), any other key" },
      prefix: { type: "string" },
      suffix: { type: "string" },
      requestId: { type: "string" },
      from: { type: "string", description: "A Resource comment: the note whose link opened it" },
      revision: { type: "integer", minimum: 1, description: "A Resource comment: the revision outline_read returned; the comment is refused if the file changed since" },
    },
    required: ["ref"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the note.";
      if ((input.whole === true) === (typeof input.quote === "string")) return "Give either quote (exact source text) or whole: true.";
      if (!nonEmpty(input.body) && (input.whole === true || (input.body !== undefined && input.body !== ""))) return "Give a non-empty comment (only a quote with no body is a highlight).";
      return { operation: "comment", input: inputOf(input, ["ref", "body", "quote", "whole", "start", "near", "prefix", "suffix", "requestId", "from", "revision", "kind", "properties"]) };
    },
  },
  {
    name: "outline_reply",
    operation: "reply",
    example: { thread: THREAD, body: "Yes, checked today." },
    writes: true,
    description: "Reply in a comment thread, as you. `thread` is the id outline_comment returned (or a thread you read). " +
      "With `edit` (a posted comment's or reply's id) instead of `thread`, change its words to `body`: give `observed`, its words as you read them, " +
      "so an edit made meanwhile is refused, never overwritten. It stays its author's, shown as edited by you; its earlier words are kept in its revisions.",
    properties: { thread: { type: "string" }, body: { type: "string" }, requestId: { type: "string" }, edit: { type: "string" }, observed: { type: "string" } },
    required: ["body"],
    command(input) {
      if (nonEmpty(input.edit)) {
        if (!nonEmpty(input.body) || typeof input.observed !== "string") return "Give edit (the comment or reply), observed (its words as you read them) and the new, non-empty body.";
        return { operation: "edit-comment", input: { mark: input.edit, ...inputOf(input, ["body", "observed"]) } };
      }
      if (!nonEmpty(input.thread) || !nonEmpty(input.body)) return "Give the thread and a non-empty reply (or edit: a comment's id, to change its words).";
      return { operation: "reply", input: inputOf(input, ["thread", "body", "requestId"]) };
    },
  },
  {
    name: "outline_resolve_thread",
    operation: "resolve-thread",
    example: { thread: THREAD, resolved: true },
    writes: true,
    description: "Resolve a comment thread (resolved: true), or reopen it (false), as you.",
    properties: { thread: { type: "string" }, resolved: { type: "boolean" } },
    required: ["thread", "resolved"],
    command(input) {
      if (!nonEmpty(input.thread) || typeof input.resolved !== "boolean") return "Give the thread and resolved: true or false.";
      return { operation: "resolve-thread", input: inputOf(input, ["thread", "resolved"]) };
    },
  },
  {
    name: "view_order",
    operation: "view-order",
    example: { ref: `((${NOTE}))`, ids: ["PIE-123", "PIE-124"] },
    writes: true,
    target: "ref",
    aliases: { ref: ["view"] },
    description:
      "Read or set the hand-set order of the view `ref` (a view with no [sort::] is ordered by hand: the order its board lanes, " +
      "figures and Tree show). With `ids`, put those members first, in the order given; the rest keep their order " +
      "after them. Ids are block ids, ((id)) or Work IDs. Refused for a sorted view (the refusal names the fix) and " +
      "for an id the view doesn't hold. Returns the order after the write.",
    properties: {
      ref: { type: "string", description: "The view (a virtual-branch block): id, ((id)) or [[page]]" },
      ids: { type: "array", items: { type: "string" }, description: "Members to put first, in this order; omit to read the order" },
    },
    required: ["ref"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref of the view: its id or ((id)).";
      if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some(id => !nonEmpty(id)))) return "ids is a list of block ids, ((id))s or Work IDs.";
      return { operation: "view-order", input: { view: input.ref, ...inputOf(input, ["ids"]) } };
    },
  },
  {
    name: "outline_changes",
    operation: "changes",
    example: { since: "2026-03-01T09:00:00Z" },
    writes: false,
    description:
      "What changed since a point: an ISO time, or the `cursor` an earlier call returned. Each block once, at its " +
      "latest change, newest first, with who made it (author, actorId, sessionId). `author` (user, agent, system) and " +
      "`actor` (an agent id, such as claude-code) narrow it. `complete: false`: more changed than `limit`; call again " +
      "with the same since and the returned `before` for older ones. Once complete, pass `cursor` as since next time.",
    properties: {
      since: { type: ["string", "integer"], description: "An ISO time, or a cursor from an earlier call" },
      author: { type: "string", enum: ["user", "agent", "system"] },
      actor: { type: "string", description: "Only this agent’s changes, by actor id (claude-code, garden-agent…)" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      before: { type: "integer", minimum: 1, description: "The `before` an incomplete answer returned: its older changes" },
      machinery: { type: "string", enum: ["hide", "only", "show"], description: "Notes tools wrote for their own bookkeeping (file touches, tosses, deliveries): left out unless this is show or only" },
    },
    required: ["since"],
    command(input) {
      if (!nonEmpty(input.since) && typeof input.since !== "number") return "Give since: an ISO time or a cursor.";
      return { operation: "changes", input: inputOf(input, ["since", "author", "actor", "limit", "before", "machinery"]) };
    },
  },
  {
    name: "outline_patch",
    operation: "patch",
    example: { ref: "PIE-123", revision: 3, patches: [{ observed: "Borlotti", replacement: "Borlotti only" }] },
    writes: true,
    target: "ref",
    description:
      "Small edits to {note} the person may be typing in, without waiting for their save (draft.patch); for " +
      "rewriting your own pages, such as a status page, use outline_edit. Each patch names the exact `observed` text " +
      "(never empty) and its `replacement`, against the `revision` outline_read returned; all apply as one edit or " +
      "none. A live draft gets it in place; otherwise it is an ordinary edit of the saved note. policy `edit` (the " +
      "default) has outline_edit's guard (allowStructural likewise); `prose` keeps every link, anchor and property. " +
      "If the note was saved since you read it, the patch applies on the newer text when every observed span is still there " +
      "once and nobody rewrote its line (the answer says rebasedFrom: the revision you read); it is refused with an error when a span is gone, changed or ambiguous, when it touches the paragraph, list item or heading at the cursor or selection endpoint, the draft is busy or unavailable, or when prose refuses. Treat refusal as a task now: re-read the note and retry against the new text in the same turn. With mark, spans must also stay above the mark and above the cursor block when the cursor is before that mark. This leaves the passage being typed in alone; an unmarked patch can land above or below it. " +
      "Use propose: true only for an intentional suggestion for Evan to decide. A proposal sits beside the note and never changes its text or revision; sending the same patch again while yours is open " +
      "returns that proposal (deduped: true) instead of a second copy. " + NOTE_HOLDS,
    properties: {
      ref: REF,
      revision: EXPECTED,
      patches: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            observed: { type: "string" },
            replacement: { type: "string" },
            range: {
              type: "object",
              properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } },
              required: ["start", "end"],
              description: "Where you saw it (UTF-16 offsets): a hint",
            },
          },
          required: ["observed", "replacement"],
        },
      },
      mark: { type: "string", description: "The @request line the patch answers: spans must end above it" },
      policy: { type: "string", enum: ["edit", "prose"], default: "edit" },
      allowStructural: { type: "boolean" },
      propose: { type: "boolean", description: "An intentional suggestion for Evan to decide instead of applying the patch" },
    },
    required: ["ref", "revision", "patches"],
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== "number") return "Give the ref and the revision you read.";
      if (!Array.isArray(input.patches) || input.patches.length === 0) return "Give at least one patch: {observed, replacement}.";
      for (const patch of input.patches as { observed?: unknown; replacement?: unknown }[]) {
        if (!patch || (typeof patch.observed !== "string" || patch.observed.length === 0) || typeof patch.replacement !== "string") return "Each patch needs observed (the exact text you read, never empty) and replacement.";
      }
      if (input.policy !== undefined && input.policy !== "edit" && input.policy !== "prose") return "policy is edit (the default) or prose.";
      return { operation: "patch", input: { policy: "edit", ...inputOf(input, ["ref", "revision", "patches", "mark", "policy", "allowStructural", "propose"]) } };
    },
  },
  ...(["apply", "dismiss", "resolve"] as const).map(op => ({
    name: `outline_proposal_${op}`,
    operation: `proposal-${op}` as const,
    example: { ref: NOTE },
    writes: true,
    target: "ref" as const,
    description: op === "resolve" ? "Ask the outline agent to resolve a stale proposal against the current note, preserving other edits. Ambiguous intent stays open with both readings." : op === "dismiss"
      ? "Dismiss your own draft proposal {note} by id, without a reader: mark it dismissed and put it in Trash. Another agent's proposal is refused."
      : "Apply draft proposal {note} by id, without a reader, under the agent's normal patch comparison and policy. An agent cannot force a proposal over changed text.",
    properties: { ref: REF },
    required: ["ref"],
    command(input: Record<string, unknown>) {
      if (!nonEmpty(input.ref)) return "Give the ref of the proposal: its id or ((id)).";
      return { operation: `proposal-${op}` as const, input: inputOf(input, ["ref"]) };
    },
  })),
  {
    name: "outline_set_property",
    operation: "set-property",
    example: { ref: "PIE-123", key: "status", value: "open", revision: 3 },
    writes: true,
    target: "ref",
    description:
      "Set [key::value] properties on the header line of {note} (the chips that end its first line): the value replaced " +
      "where the key is, or the chip added at the line's end. One property is `key` and `value`; several are " +
      "`properties: { key: value, key: null }` (null removes the key), all in one write that takes one revision. Against the " +
      "`revision` outline_read returned, as one outline_patch span, so it has the patch's rules: a live draft gets it in place, and a note that changed since " +
      "is refused if it cannot rebase; re-read and retry in the same turn. A key written more than once is a list: edit it with outline_patch.",
    properties: {
      ref: REF,
      key: { type: "string", description: "The property key: letters, digits, - and _ (with value; or use properties for several)" },
      value: { type: "string", description: "One line, without ]" },
      properties: { type: "object", description: "Several at once: { key: \"one line, without ]\", other: null }; a null value removes that key. Instead of key and value" },
      revision: EXPECTED,
    },
    required: ["ref", "revision"],
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== "number") return "Give the ref and the revision you read.";
      if (input.properties !== undefined) {
        if (input.key !== undefined || input.value !== undefined) return "Give either key and value (one property) or properties (several), not both.";
        if (typeof input.properties !== "object" || input.properties === null || Array.isArray(input.properties)) return "properties is an object: { key: value, key: null } (null removes the key).";
        const values = Object.values(input.properties as Record<string, unknown>);
        if (!values.length) return "Give at least one property in properties: { key: value } (null removes the key).";
        if (values.some(v => v !== null && typeof v !== "string")) return "Each value in properties is a string (one line, without ]), or null to remove the key.";
        return { operation: "set-property", input: inputOf(input, ["ref", "properties", "revision"]) };
      }
      if (!nonEmpty(input.key) || !nonEmpty(input.value)) return "Give the key and a non-empty value, or properties: { key: value } for several.";
      return { operation: "set-property", input: inputOf(input, ["ref", "key", "value", "revision"]) };
    },
  },
  {
    name: "outline_assign_id",
    operation: "assign-id",
    example: { ref: `((${NOTE}))`, revision: 3 },
    writes: true,
    target: "ref",
    description:
      "Give {note} the outline's next work id (outliner work-id-allocate), against the `revision` " +
      "outline_read returned: the id is stamped on the note and is its page address, so `[[HUB-002]]` reaches it " +
      "(no [page::…] needed; adding one duplicates it). The prefix is whatever the outline has. For notes that " +
      "aren't roadmap items, such as an outbox draft; work_create is only for roadmap items on the workboard. " +
      "A note that already has an id answers with it, unchanged. Returns `workId` and `page`.",
    properties: { ref: REF, revision: EXPECTED },
    required: ["ref", "revision"],
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== "number") return "Give the ref and the revision you read.";
      return { operation: "assign-id", input: inputOf(input, ["ref", "revision"]) };
    },
  },
  {
    name: "outline_move",
    operation: "move",
    example: { ref: "PIE-123", parent: `((${NOTE}))`, position: 0, revision: 3 },
    writes: true,
    target: "ref",
    description:
      "Move {note} (with what is under it) to a new place: under `parent` (a ref, or `root`) at `position` among " +
      "its children (0 is first; default last), or just `before` or `after` a sibling note. Give exactly one of parent, " +
      "before, after. Give `revision` (what outline_read returned); it is refused if the note changed since. Attributed to " +
      "you; the note keeps its id, text and links. Refused, with what to give instead: a place under Trash, " +
      "Bookmarks or a guide (the service fills them itself; the Inbox and the Deploys record take children), a place inside the note itself, a note in Trash, a ref that " +
      "doesn't resolve (with the nearest notes). A move to where it already is answers unchanged.",
    properties: {
      ref: REF,
      parent: { type: "string", description: "The new parent: a ref, or root" },
      before: { type: "string", description: "A note to go just before (a ref): it gives the parent and the place" },
      after: { type: "string", description: "A note to go just after (a ref)" },
      position: { type: "integer", minimum: 0, description: "With parent: among its children, 0 first (default last)" },
      revision: EXPECTED,
    },
    required: ["ref", "revision"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref of the note to move.";
      const places = ["parent", "before", "after"].filter(key => input[key] !== undefined);
      if (places.length !== 1) return "Give exactly one of parent (under it; or root), before or after (beside a note).";
      if (!nonEmpty(input[places[0]!])) return `${places[0]} is a ref (or root, for parent); it is empty.`;
      if (input.position !== undefined && places[0] !== "parent") return "position goes with parent: before and after already say where.";
      return { operation: "move", input: inputOf(input, ["ref", "parent", "before", "after", "position", "revision"]) };
    },
  },
  {
    name: "outline_trash",
    operation: "trash",
    example: { ref: "PIE-123", revision: 3 },
    writes: true,
    target: "ref",
    description:
      "Put {note} in Trash, with what is under it, against the `revision` outline_read returned: a note that " +
      "changed since is refused and stays. Attributed to you. outline_restore brings it back. Use it for a duplicate " +
      "or a stray, never to hide a note someone may want; a system note (the Inbox, Trash, Bookmarks) or a note holding one is refused. " +
      "A note already in Trash answers unchanged.",
    properties: { ref: REF, revision: EXPECTED },
    required: ["ref", "revision"],
    command(input) {
      if (!nonEmpty(input.ref) || typeof input.revision !== "number") return "Give the ref and the revision you read.";
      return { operation: "trash", input: inputOf(input, ["ref", "revision"]) };
    },
  },
  {
    name: "outline_restore",
    operation: "restore",
    example: { ref: `((${NOTE}))` },
    writes: true,
    target: "ref",
    description:
      "Bring {note} back from Trash, with what went under it, to where it was. Give its id or ((id)) (a trashed " +
      "note has no page address). A note that went to Trash inside another is restored with that one: the refusal names it.",
    properties: { ref: REF },
    required: ["ref"],
    command(input) {
      if (!nonEmpty(input.ref)) return "Give the ref (id or ((id))) of the trashed note.";
      return { operation: "restore", input: inputOf(input, ["ref"]) };
    },
  },
];

/** A tool's description in a surface's words for the block it acts on. */
export function describeTool(definition: AgentToolDefinition, words: TargetWords = REF_WORDS): string {
  return definition.description.replaceAll("{note}", words.note).replaceAll("{parent}", words.parent);
}

/** A tool's input schema, with a surface's own arguments added (`actor`, `call`). */
export function toolInputSchema(definition: AgentToolDefinition, extra: Record<string, ToolSchema> = {}): ToolSchema {
  return { type: "object", properties: { ...definition.properties, ...extra }, required: [...definition.required], additionalProperties: false };
}

/** What `checkToolArgs` takes for a tool, as a surface registers it. */
export function toolArgsSpec(definition: AgentToolDefinition, extra: Record<string, ToolSchema> = {}): ToolArgsSpec {
  return { name: definition.name, schema: toolInputSchema(definition, extra), example: definition.example, ...(definition.aliases ? { aliases: definition.aliases } : {}) };
}

export const agentToolDefinition = (name: string): AgentToolDefinition | undefined =>
  AGENT_TOOL_DEFINITIONS.find(definition => definition.name === name);

/** The surfaces that register agent tools. */
export type AgentToolSurface = "mod" | "gateway";

/**
 * Where each agent tool is registered: `true` from its definition above; a string, why a surface doesn't (yet). A tool a
 * surface registers that has no definition is listed with what it is: surface-only, or a gap still to close (PIE-720).
 */
export const AGENT_TOOL_SURFACES: Readonly<Record<string, Readonly<Record<AgentToolSurface, true | string>>>> = {
  artifact_deploy: { mod: true, gateway: "Use the artifact CLI or local agent tool; deployment cannot be proposed." },
  outline_read: { mod: true, gateway: "its own outline_read (an enveloped block record, seen, raw): converge on one read (PIE-720)" },
  outline_find: { mod: true, gateway: "its own outline_find (the ranked search ep0ch find uses): converge on one search (PIE-720)" },
  outline_resolve: { mod: true, gateway: "not yet on the gateway (PIE-720)" },
  outline_site: { mod: true, gateway: "not yet on the gateway (PIE-533)" },
  outline_edit: { mod: true, gateway: "not yet on the gateway (PIE-720)" },
  outline_create: { mod: true, gateway: true },
  outline_comment: { mod: true, gateway: true },
  outline_reply: { mod: true, gateway: true },
  outline_resolve_thread: { mod: true, gateway: true },
  view_order: { mod: true, gateway: "not yet on the gateway (PIE-720)" },
  outline_changes: { mod: true, gateway: "not yet on the gateway (PIE-720, PIE-689)" },
  outline_patch: { mod: true, gateway: true },
  outline_proposal_apply: { mod: true, gateway: true },
  outline_proposal_dismiss: { mod: true, gateway: true },
  outline_proposal_resolve: { mod: true, gateway: true },
  outline_set_property: { mod: true, gateway: true },
  outline_assign_id: { mod: true, gateway: true },
  outline_move: { mod: true, gateway: true },
  outline_trash: { mod: true, gateway: true },
  outline_restore: { mod: true, gateway: true },
  // Defined on one surface only, for now.
  outline_quote: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  outline_threads: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  outline_query: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  outline_links: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  outline_components: { mod: "the mod's own (ep0ch library --brief, the session's outline)", gateway: "the gateway's own (the outline it addresses)" },
  work_create: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  work_set: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  work_stage: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  work_body: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  work_link: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  work_deliver: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  work_complete: { mod: "the mod's own (the work CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  note_section: { mod: "the mod's own (the note CLI; PIE-720: move it here)", gateway: "not yet on the gateway (PIE-720)" },
  // About a session, a door or a connection: one surface by nature (ADR 0003 §5).
  outline_bind: { mod: "surface-only: binds the session's outline", gateway: "surface-only: the mod's session binding" },
  show: { mod: "surface-only: the mod's pane", gateway: "surface-only: the mod's pane" },
  door_where: { mod: "surface-only: needs a door (EP0CH_CONTROL)", gateway: "surface-only: needs a door" },
  door_peek: { mod: "surface-only: needs a door (EP0CH_CONTROL)", gateway: "surface-only: needs a door" },
  door_act: { mod: "surface-only: needs a door (EP0CH_CONTROL)", gateway: "surface-only: needs a door" },
  door_open: { mod: "surface-only: needs a door (EP0CH_CONTROL)", gateway: "surface-only: needs a door" },
  list_outlines: { mod: "surface-only: the gateway's outline set (the mod has one bound outline)", gateway: "surface-only: its outline set" },
  outline_new: { mod: "surface-only: the gateway's outline admin", gateway: "surface-only: its outline admin" },
  outline_archive: { mod: "surface-only: the gateway's outline admin", gateway: "surface-only: its outline admin" },
  outline_write_status: { mod: "surface-only: the gateway's queued writes", gateway: "surface-only: its queued writes" },
  reader_view: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  share_start: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  share_list: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
  share_revoke: { mod: "not yet in the mod (PIE-720)", gateway: "the gateway's own definition (PIE-720: move it here)" },
};
