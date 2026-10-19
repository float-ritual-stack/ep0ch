import type { MergeConflict } from "@ep0ch/outline-core/draft-patch-compare";
import { actRequestOf, lineWords } from "@ep0ch/outline-core/action-line";
import type { ExtensionActRequest, ExtensionActResult } from "./extension-calls";
import { createHash } from "node:crypto";
import { TLDR_KIND } from "@ep0ch/outline-core/annotation-marks";
import type { DraftPatchInput, DraftPatchResult } from "./draft-patch";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { durationMs, DEFAULT_DEADLINE_MS } from "./extension-manifest";
import { cleanExtensionText, contextAncestors, extensionActorId, inertBlockdown } from "./extension-records";
import type { ExtensionRegistry } from "./extension-registry";
import { scanPropertyLiteralRanges } from "@ep0ch/outline-core/code-ranges";
import { VIA_TRIGGER } from "@ep0ch/outline-core/rules";
import type { HeldAsk } from "@ep0ch/outline-core/protocol";
import { decide, newChain, parseGrant, personAsk, type InvocationChain, type InvocationGrant } from "./invocation-grants";
import type { ResourceProjection } from "./resource-projection";
import type { ResourceExtensionRuntime } from "./resource-extensions";
import type { AgentRequestRow, OutlinerStore } from "./store";
import type { AnnotationRecord, AnnotationThread, Block, MutationProvenance } from "./types";
import { resourceCommentSource } from "./resource-comments";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { blockDisplayTitle } from "./references";

/**
 * Agents addressed while you write (PIE-501): a person writes
 * `@tidy can you fix the formatting above` and keeps typing. The service
 * picks the line up once it has been quiet for a moment, runs the agent an
 * extension declares (`agents[]`, the `respond` operation), and:
 *
 * - applies its patches as an attributed edit through `draft.patch` with the
 *   default `edit` policy, spans ending above the request line. A note held by
 *   a door's live draft gets the patch there; only a failed compare (the
 *   person was typing in that passage) becomes a proposal under the line;
 * - shows its reply, if any, under the line (the projection slot, like an
 *   extension's output).
 *
 * Who wrote the line decides whether it runs: a person's line runs once; a
 * line an agent or an import wrote waits for a person's `r` (so agents can't
 * loop). A request runs once per text; changing the line is a new request, and
 * `r` asks again (on the note, `r` asks the requests not answered yet). A door
 * that says when the person types in a draft it holds (`drafts.touch`) gets a
 * request run while they write, before any save. Every write is `author: agent`, `actorId: ext:<id>`, under
 * `ext.<id>.agent.<name>` in the change feed.
 */

/** What a thread's agent is asked for a TL;DR (PIE-791). */
/** How long a TL;DR ask waits for its agent before saying it's being written (an agent that can't refuses at once). */
export const TLDR_WAIT_MS = 4000;
/** What answering an ask came to: refused (a TL;DR not written, and why), else it landed. */
type TurnOutcome = { refused: string };
export const TLDR_REQUEST = "TL;DR: summarize this thread in two or three short lines: what it was about, and where it landed.";

export interface RequestLine {
  readonly agent: string;
  /** What the person asked, after `@name`. */
  readonly request: string;
  /** The whole line as written: the mark a patch must end above. */
  readonly text: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  /** One request per agent and wording in a block. */
  readonly requestKey: string;
}

const REQUEST = /^([ \t]*(?:[-*+][ \t]+)?)@([a-z][a-z0-9-]{0,31})(?=$|[\s:,])[:,]?[ \t]*(.*)$/;
const MAX_REQUESTS = 8;
const MAX_NOTE_TEXT = 64 * 1024;
const MAX_REPLY = 64 * 1024;
const MAX_PATCHES = 20;
const DEFAULT_QUIET_MS = 1_500;
/** How long a removed request line's answer is kept, so undoing the removal doesn't ask again. */
const REMOVED_KEPT_MS = 10 * 60_000;
const REMOVED_KEPT_MAX = 500;
const ANSWERED: ReadonlySet<string> = new Set(["applied", "proposed", "replied", "nothing"]);

/**
 * The `@name …` lines in a block's text whose names an extension answers
 * (every `@name` line with `names` null). Code is text.
 */
export function requestLines(text: string, names: ReadonlySet<string> | null): RequestLine[] {
  if ((names && !names.size) || !text.includes("@")) return [];
  const literal = scanPropertyLiteralRanges(text);
  const found: RequestLine[] = [];
  let offset = 0;
  text.split("\n").forEach((raw, line) => {
    const start = offset;
    offset += raw.length + 1;
    const content = raw.replace(/\r$/, "");
    const match = REQUEST.exec(content);
    if (!match || (names && !names.has(match[2]!)) || found.length >= (names ? MAX_REQUESTS : 256)) return;
    const at = start + match[1]!.length;
    if (literal.some((range) => range.start <= at && at < range.end)) return;
    const request = match[3]!.trim();
    found.push({
      agent: match[2]!, request, text: content, line, start: at, end: start + content.length,
      requestKey: createHash("sha256").update(`${match[2]}\0${request}`).digest("hex").slice(0, 32),
    });
  });
  return found;
}

export interface AgentRequestDeps {
  runSource?(blockId: string, clientId: string | undefined): Promise<ExtensionActResult>;
  script?(request: ExtensionActRequest): Promise<ExtensionActResult & { error?: string }>;
  /** The note as the person sees it: its live draft when a door holds one (`drafts.read`). */
  readDraft(blockId: string): Promise<{ text: string; revision: number; holder?: string }>;
  /** `draft.patch`, routed to the live draft or the saved note. */
  patch(input: DraftPatchInput): Promise<DraftPatchResult>;
  /** A request's state changed: readers repaint the block. */
  changed(blockId: string, ask?: import("@ep0ch/outline-core/protocol").AskProgress): void;
  /** How long a person's request line must stay unchanged before it runs (default 1.5 s). */
  readonly quietMs?: number;
  readonly now?: () => number;
  /** Yolo is on (PIE-973): an agent's `r` is the person's, so it asks the lines that wait for a person too. */
  yolo?(): boolean;
}

interface RespondValue {
  message?: string;
  reply?: string;
  patches: DraftPatchSpan[];
  /** In a thread: the agent's session, kept on the thread (`[<agent>-session::<id>]`) and handed back next time. */
  session?: string;
}

/** A session id an agent keeps on its thread: a property value, no spaces or brackets. */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The property a thread keeps its agent's session in: `[margin-session::<id>]` for `@margin`. */
export const sessionKey = (agent: string) => `${agent}-session`;

/** At most this much of the page's other comments goes with a question (the newest threads first are kept). */
const MAX_PAGE_COMMENTS = 24 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateRespond(value: unknown): RespondValue {
  if (!isObject(value)) throw new Error("an agent answers { message?, reply?, patches? }");
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 500)) throw new Error("message must be text up to 500 characters");
  if (value.reply !== undefined && (typeof value.reply !== "string" || Buffer.byteLength(value.reply) > MAX_REPLY)) throw new Error("reply must be markdown up to 64 KiB");
  const patches = value.patches ?? [];
  if (!Array.isArray(patches) || patches.length > MAX_PATCHES) throw new Error(`patches must be a list of at most ${MAX_PATCHES}`);
  if (value.session !== undefined && (typeof value.session !== "string" || !SESSION.test(value.session))) throw new Error("session must be an id: letters, digits and . _ : - (up to 128)");
  // Kept clean: no terminal escapes or control characters reach a reader.
  return {
    ...(typeof value.session === "string" ? { session: value.session } : {}),
    ...(typeof value.message === "string" ? { message: cleanExtensionText(value.message) } : {}),
    ...(typeof value.reply === "string" ? { reply: cleanExtensionText(value.reply, true) } : {}),
    patches: patches.map((patch, index) => {
      if (!isObject(patch) || typeof patch.observed !== "string" || !patch.observed || typeof patch.replacement !== "string") {
        throw new Error(`patches[${index}] must be { observed, replacement, before?, after? }`);
      }
      return {
        observed: patch.observed, replacement: patch.replacement,
        ...(typeof patch.before === "string" ? { before: patch.before } : {}),
        ...(typeof patch.after === "string" ? { after: patch.after } : {}),
      };
    }),
  };
}

/**
 * A page's other threads as an answer reads them: the words each is on, what was said, and its replies, newest thread
 * first, cut at MAX_PAGE_COMMENTS.
 */
function pageComments(threads: readonly AnnotationThread[], author: (r: AnnotationRecord) => string): { id: string; quote: string; thread: { author: string; body: string }[] }[] {
  const at = (t: AnnotationThread) => t.block.createdAt;
  const out: { id: string; quote: string; thread: { author: string; body: string }[] }[] = [];
  let size = 0;
  for (const t of [...threads].sort((a, b) => at(b).localeCompare(at(a)))) {
    const anchor = (t.resolvedTarget ?? t.originalTarget).anchor;
    const quote = (anchor.kind === "text-quote" || anchor.kind === "pdf-page-region") && anchor.exact ? anchor.exact : "";
    const entry = { id: t.block.id, quote, thread: [t, ...t.replies].filter((r) => r.body.trim()).map((r) => ({ author: author(r), body: r.body })) };
    if (!entry.thread.length && !quote) continue;
    size += JSON.stringify(entry).length;
    if (size > MAX_PAGE_COMMENTS) break;
    out.push(entry);
  }
  return out;
}

/** Who asked, as a request row says it: `user`, `agent:<actorId>` or `system`. */
function requester(actor: MutationProvenance | undefined): string {
  if (actor?.author === "agent") return actor.actorId ? `agent:${actor.actorId}` : "agent";
  return actor?.author === "system" ? "system" : "user";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Resource extension: /, "") : String(error);
}

/** Keep the origin of a copied request even after an agent edited another part of its note. */
export function personRequestKeys(store: OutlinerStore, blockId: string): string[] {
  let previous = new Set<string>();
  const personal = new Set<string>();
  for (const revision of [...store.revisions(blockId).revisions].reverse()) {
    const keys = new Set(requestLines(store.revisionText(blockId, revision.revision).text, null).map(line => line.requestKey));
    for (const key of personal) if (!keys.has(key)) personal.delete(key);
    if (revision.author === "user") for (const key of keys) if (!previous.has(key)) personal.add(key);
    previous = keys;
  }
  // A copied ask's durable receipt outlives revision retention and carries its origin to another copy.
  for (const row of store.agentRequests(blockId)) if (row.requestedBy === "user" && previous.has(row.requestKey)) personal.add(row.requestKey);
  return [...personal];
}

export class AgentRequests {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<string>();
  /** Each ask running now: its note, the extension answering and the chain it came in (grants' hops, PIE-888). */
  private readonly live = new Map<string, { blockId: string; extensionId: string; chain: InvocationChain }>();
  private stopped = false;

  constructor(
    private readonly store: OutlinerStore,
    private readonly registry: ExtensionRegistry,
    private readonly runtime: ResourceExtensionRuntime,
    private readonly deps: AgentRequestDeps,
  ) {}

  async resolveProposal(input: MergeConflict & { proposal_note: string }, requestedBy: MutationProvenance): Promise<{replacement: string} | {ambiguous: string}> {
    const bound = this.registry.agent("tidy");
    if (!bound) throw new Error("Install the tidy extension to resolve proposals: ep0ch ext add tidy");
    const { extension, agent } = bound;
    const result = await this.runtime.invokeLoaded(extension, "respond", {
      agent: "tidy", request: "Resolve this conflict", resolution: input,
    }, durationMs(agent.deadline) ?? DEFAULT_DEADLINE_MS, { requestedBy, label: "ext.tidy.agent.resolve" });
    const value = result.value;
    if (isObject(value) && typeof value.ambiguous === "string") return {ambiguous: cleanExtensionText(value.ambiguous)};
    if (isObject(value) && typeof value.replacement === "string") return {replacement: value.replacement};
    throw new Error("The conflict responder must return replacement or ambiguous text");
  }

  private get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * The service started. A request a restart cut off says so (it isn't "working on it" forever), and once per
   * outline every note with `@name` lines and no baseline (written before this feature) gets one: its lines
   * are old, so its first unrelated save doesn't run them.
   */
  start(): void {
    this.store.interruptAgentRequests("interrupted by a restart: r asks again", new Date(this.now).toISOString());
    this.store.seedAgentRequestBaselines((text) => requestLines(text, null).map((line) => line.requestKey));
  }

  /** A request still waiting out its quiet when the service stops is kept as waiting for `r`, not lost. */
  stop(): void {
    this.stopped = true;
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      const [blockId, requestKey] = key.split("\0") as [string, string];
      try {
        const block = this.store.get(blockId);
        const line = block ? this.lines(block).find((candidate) => candidate.requestKey === requestKey) : undefined;
        const bound = line ? this.registry.agent(line.agent) : undefined;
        if (line && bound && !this.store.agentRequests(blockId).some((row) => row.requestKey === requestKey)) {
          this.store.putAgentRequest({
            blockId, requestKey, agent: line.agent, extensionId: bound.extension.id, request: line.request, status: "waiting",
            message: `the service stopped before @${line.agent} answered: r asks it`, requestedBy: "user", requestedAt: new Date(this.now).toISOString(),
          });
        }
      } catch {
        // The store is closing: the line stays as written, and r asks.
      }
    }
    this.timers.clear();
  }

  /** Every `@name` line's key, whatever the name: what a later save is compared with. */
  private shapes(block: Block): string[] {
    if (block.effectiveDeletedRootId || this.store.extensionOwner(block.id)) return [];
    return requestLines(block.text, null).map((line) => line.requestKey);
  }

  private lines(block: Block, names: ReadonlySet<string> | null = this.registry.agentNames()): RequestLine[] {
    if (block.effectiveDeletedRootId || this.store.extensionOwner(block.id)) return [];
    return requestLines(block.text, names);
  }

  private key(blockId: string, requestKey: string): string {
    return `${blockId}\0${requestKey}`;
  }

  /** `r` pressed while that request was running: one more run after it, for whoever asked. */
  private readonly again = new Map<string, string>();

  /** Rows of request lines a save took out lately: undoing the removal brings the answer back instead of asking again. */
  private readonly removed = new Map<string, { row: AgentRequestRow; at: number }>();

  private recall(blockId: string, requestKey: string): AgentRequestRow | null {
    const key = this.key(blockId, requestKey);
    const kept = this.removed.get(key);
    if (!kept) return null;
    this.removed.delete(key);
    return this.now - kept.at <= REMOVED_KEPT_MS ? kept.row : null;
  }

  /** The `@name` lines a block holds now become what its next save is compared with (kept in the store). */
  private remember(blockId: string, keys: readonly string[]): void {
    const before = this.store.agentRequestBaseline(blockId);
    if (before === null && !keys.length) return;
    if (before && before.length === keys.length && before.every((key, index) => key === keys[index])) return;
    this.store.setAgentRequestBaseline(blockId, keys);
  }

  private schedule(blockId: string, requestKey: string): void {
    const key = this.key(blockId, requestKey);
    const previous = this.timers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.run(blockId, requestKey).catch(() => {});
    }, this.deps.quietMs ?? DEFAULT_QUIET_MS);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /**
   * An extension wrote the block (its own record, an action's write, an agent's applied patch). That runs
   * nothing, but the `@name` lines it holds now are what the next save is compared with: a line an
   * extension's write left is never taken for one the person's next save added.
   */
  observe(blockId: string, actor?: MutationProvenance, created = false, requestedBy?: MutationProvenance): void {
    if (this.stopped) return;
    const block = this.store.get(blockId);
    if (!block) return;
    // Capture precedes the wake decision, including when a loop guard holds the ask.
    const before = new Set(created ? [] : this.store.agentRequestBaseline(blockId) ?? []);
    const decided = this.holdWritten(blockId, block.text, actor, before, this.viaTrigger(block.text) ? actor : undefined, requestedBy);
    this.wake(blockId, decided.wakes);
    this.remember(blockId, this.shapes(block));
    // Requests whose lines the write took out are withdrawn, as after any save.
    if (this.withdraw(blockId, this.lines(block).map((line) => line.requestKey))) this.deps.changed(blockId);
  }

  /** Whether a block's first line says a rule's trigger made it (its own extension's agents are asked at once). */
  private viaTrigger(text: string): boolean {
    return new RegExp(`\\[${VIA_TRIGGER}::`, "i").test(text.split("\n", 1)[0]!);
  }

  /**
   * The grants this outline has: notes a person last wrote with `[invoke-from::…]` and `[invoke-to::…]`
   * (src/invocation-grants.ts). A note an agent or an extension wrote is no grant: they can't grant themselves.
   */
  grants(): InvocationGrant[] {
    const ids = new Set<string>();
    for (const key of ["invoke-to", "invoke-from", "invoke-deny"]) for (const row of this.store.queryBlocks({ filters: [{ key }], limit: 200 }).blocks) ids.add(row.id);
    const out: InvocationGrant[] = [];
    for (const id of ids) {
      const block = this.store.get(id);
      const grant = block && !block.effectiveDeletedRootId ? parseGrant(block) : null;
      if (!grant) continue;
      out.push(block!.author === "user" ? grant : { ...grant, problem: "an agent or an extension wrote it: a grant is the person's (edit it yourself to adopt it)" });
    }
    return out;
  }

  private count(id: string): number {
    const saved = this.store.readMetadata(`invocation-cap:${id}`);
    if (!saved) return 0;
    const w = JSON.parse(saved) as { day: string; n: number };
    return w.day === this.day() ? w.n : 0;
  }
  private today = {
    count: (id: string): number => this.count(id),
    spend: (id: string): void => this.store.writeMetadata(`invocation-cap:${id}`, JSON.stringify({ day: this.day(), n: this.count(id) + 1 })),
    unspend: (id: string): void => this.store.writeMetadata(`invocation-cap:${id}`, JSON.stringify({ day: this.day(), n: Math.max(0, this.count(id) - 1) })),
  };
  private day(): string { return new Date(this.now).toISOString().slice(0, 10); }

  /**
   * The chain a write belongs to: an ask `actor` (an extension) is answering now, in any note (its answer, or its process
   * writing elsewhere while it runs). With several, the longest, so no write slips into a shorter chain.
   */
  private parentChain(actor: MutationProvenance | undefined): InvocationChain | undefined {
    const id = actor?.actorId?.trim().toLowerCase().split("@", 1)[0];
    const script = actor?.taskId?.startsWith("trigger:script:") ? actor.taskId.slice("trigger:script:".length) : undefined;
    if (!id?.startsWith("ext:") && !script) return undefined;
    let found: InvocationChain | undefined;
    for (const ask of this.live.values()) if ((`ext:${ask.extensionId}` === id || ask.extensionId === script) && (!found || ask.chain.hops > found.hops)) found = ask.chain;
    return found;
  }

  /** Decide newly written requests once; saved text and live drafts share the same chain and limits. */
  holdWritten(blockId: string, text: string, actor: MutationProvenance | undefined, before: ReadonlySet<string>, own?: MutationProvenance, requestedBy?: MutationProvenance): { wakes: { requestKey: string; by: string; chain: InvocationChain; refund(): void }[]; recorded: string[] } {
    const out = { wakes: [] as { requestKey: string; by: string; chain: InvocationChain; refund(): void }[], recorded: [] as string[] };
    const block = this.store.get(blockId);
    if (!block || block.effectiveDeletedRootId || this.store.extensionOwner(blockId)) return out;
    const lines = requestLines(text, this.registry.agentNames());
    if (!lines.length) return out;
    const answered = new Set(this.store.agentRequests(blockId).map((row) => row.requestKey));
    const by = actor?.actorId ? `agent:${actor.actorId}` : actor?.author ?? "system";
    const grants = this.grants();
    const parent = this.parentChain(actor);
    for (const line of lines) {
      // A person's line still waiting out its quiet is theirs, even in a save that an agent made too.
      if (before.has(line.requestKey) || answered.has(line.requestKey) || this.timers.has(this.key(blockId, line.requestKey))) continue;
      const bound = this.registry.agent(line.agent)!;
      if (own?.actorId && `ext:${bound.extension.id}` === own.actorId.trim()) continue;
      answered.add(line.requestKey);
      // A responder inherits who asked for it, not approval for new asks it invents.
      const personal = !parent && (personAsk(requestedBy) || requestedBy?.invocationRequests?.includes(line.requestKey));
      const verdict = decide(grants, actor, line.agent, personal ? { ...newChain("user"), origin: "user" } : parent, this.today);
      if (verdict.wake) { out.wakes.push({ requestKey: line.requestKey, by: personal || personAsk(actor) ? "user" : by, chain: verdict.chain, refund: verdict.refund }); continue; }
      out.recorded.push(line.requestKey);
      this.store.putAgentRequest({
        blockId, requestKey: line.requestKey, agent: line.agent, extensionId: bound.extension.id, request: line.request,
        status: verdict.denied ? "nothing" : "waiting", message: `${verdict.denied ? "" : "held: "}${verdict.why}`, requestedBy: by, requestedAt: new Date(this.now).toISOString(),
      });
      this.deps.changed(blockId, { line: line.text, state: verdict.denied ? "nothing" : "waiting", warning: `${verdict.denied ? "" : "held: "}${verdict.why}` });
    }
    if (out.recorded.length) this.deps.changed(blockId);
    return out;
  }

  /** The requests held for a person's `r`, as the waiting-on-you list shows them (PIE-888): the note, the agent, and why. */
  held(): HeldAsk[] {
    return this.store.heldAgentRequests().flatMap((row) => {
      const block = this.store.get(row.blockId);
      if (!block || block.effectiveDeletedRootId) return [];
      const at = this.lines(block).find((candidate) => candidate.requestKey === row.requestKey)?.line ?? -1;
      return [{ blockId: row.blockId, line: at, title: blockDisplayTitle(block).slice(0, 120), agent: row.agent, extensionId: row.extensionId, request: row.request, why: (row.message ?? "").replace(/^held: /, ""), by: row.requestedBy, at: row.requestedAt }];
    });
  }

  /** Start the asks a grant woke, now that their lines are in the note. */
  private wake(blockId: string, wakes: readonly { requestKey: string; by: string; chain: InvocationChain }[]) {
    for (const wake of wakes) void this.run(blockId, wake.requestKey, wake.by, wake.chain).catch(() => {});
  }

  /**
   * An agent's patch of the note's draft is about to land: the request lines its spans add (in a replacement, not in the
   * text it replaces) are decided now, before the patch, so nothing the person does with the draft sends a held one. The
   * answer settles it: landed, the asks a grant woke start (their lines are in the draft); not, the rows it held go.
   * A line the patch doesn't end up writing has no line to ask and is withdrawn with the next save.
   */
  holdPatched(blockId: string, patches: readonly DraftPatchSpan[], actor: MutationProvenance): (landed: boolean) => void {
    const added = patches.flatMap((patch) => {
      const had = new Set(requestLines(patch.observed, null).map((line) => line.requestKey));
      return requestLines(patch.replacement, null).filter((line) => !had.has(line.requestKey));
    });
    if (!added.length) return () => {};
    const decided = this.holdWritten(blockId, added.map((line) => line.text).join("\n"), actor, new Set(this.store.agentRequestBaseline(blockId) ?? []), undefined, this.store.changes.requestedBy);
    return (landed) => {
      if (landed) return this.wake(blockId, decided.wakes);
      // Taken back: the allowance it would have spent is given back.
      for (const wake of decided.wakes) wake.refund();
      if (decided.recorded.length) {
        const keep = this.store.agentRequests(blockId).map((row) => row.requestKey).filter((key) => !decided.recorded.includes(key));
        this.store.pruneAgentRequests(blockId, keep);
        this.deps.changed(blockId);
      }
    };
  }

  /**
   * Rows and waiting timers of request lines a block no longer has go (rows of names no extension answers now
   * stay: the folder may be coming back). Whether anything was known about the block's requests.
   */
  private withdraw(blockId: string, keys: readonly string[]): boolean {
    const rows = this.store.agentRequests(blockId);
    let waiting = false;
    for (const [key, timer] of this.timers) {
      const [timerBlock, requestKey] = key.split("\0");
      if (timerBlock !== blockId) continue;
      waiting = true;
      if (!keys.includes(requestKey!)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
    if (!rows.length && !waiting) return false;
    const now = this.now;
    for (const [key, kept] of this.removed) if (now - kept.at > REMOVED_KEPT_MS) this.removed.delete(key);
    for (const row of rows) {
      // Answered ones only: a line that was waiting (an agent wrote it) and a person writes again is theirs, and new.
      if (keys.includes(row.requestKey) || !ANSWERED.has(row.status) || !this.registry.agent(row.agent)) continue;
      if (this.removed.size >= REMOVED_KEPT_MAX) this.removed.delete(this.removed.keys().next().value!);
      this.removed.set(this.key(blockId, row.requestKey), { row, at: now });
    }
    this.store.pruneAgentRequests(blockId, [...keys, ...rows.filter((row) => !this.registry.agent(row.agent)).map((row) => row.requestKey)]);
    return true;
  }

  /**
   * A block was saved (not by an extension). A request line this save added
   * runs once the note has been quiet for a moment, when a person wrote it;
   * when an agent or an import did, it is recorded as waiting for `r`. Lines
   * already there (before an install, or before this service started and no
   * reader opened the note) are never run by a save: `r` asks. `created`: the
   * save made the block, so all its lines are new.
   */
  blockChanged(blockId: string, actor: MutationProvenance | undefined, created = false): void {
    if (this.stopped) return;
    const block = this.store.get(blockId);
    if (!block) return;
    const lines = this.lines(block);
    const keys = lines.map((line) => line.requestKey);
    // The baseline is every `@name` line, answered or not: a line written before its extension was
    // installed is an old line once it is, not a new request.
    const shapes = this.shapes(block);
    // Never seen with an `@name` line: none was there before this save (the baseline is kept from every
    // save and read since this feature shipped, across restarts, and `start` gave notes from before it one).
    const before = new Set(created ? [] : this.store.agentRequestBaseline(blockId) ?? []);
    this.remember(blockId, shapes);
    const rows = this.store.agentRequests(blockId);
    // A request still waiting for quiet that the note no longer has is withdrawn; rows follow the text.
    const known = this.withdraw(blockId, keys);
    // Most saves: no request lines, nothing known, nothing waiting. No event either.
    if (!lines.length && !known) return;
    const answered = new Set(rows.map((row) => row.requestKey));
    const byPerson = actor?.author === "user";
    let writtenByAgent = false;
    for (const line of lines) {
      const key = this.key(blockId, line.requestKey);
      if (this.timers.has(key)) {
        // The key includes the wording: typing elsewhere must not postpone this ask.
        continue;
      }
      if (before.has(line.requestKey) || answered.has(line.requestKey)) continue;
      // Taken out and put back (an undo): what it had is what it has, nothing is asked again.
      const kept = this.recall(blockId, line.requestKey);
      if (kept) {
        this.store.putAgentRequest(kept);
        continue;
      }
      if (byPerson) {
        this.schedule(blockId, line.requestKey);
        continue;
      }
      writtenByAgent = true;
    }
    // Agent writes enter the same wake decision as extension writes.
    if (writtenByAgent) this.wake(blockId, this.holdWritten(blockId, block.text, actor, before).wakes);
    this.deps.changed(blockId);
  }

  private unanswered(name: string): string {
    const names = [...this.registry.agentNames()].sort().map(name => `@${name}`).join(" ");
    return `no agent answers @${name} · agents here: ${names || "none"}`;
  }

  /**
   * A person typed in a draft a door holds (`drafts.touch`; `text` is the draft as the door has it). A request
   * line the draft has and the saved note never had runs once the draft has been quiet, as a save's would: the
   * person goes on typing and the answer lands in the draft. The rows it leaves keep a later save from asking
   * again.
   */
  touched(blockId: string, text: string): void {
    if (this.stopped) return;
    const block = this.store.get(blockId);
    if (!block || block.effectiveDeletedRootId || this.store.extensionOwner(blockId)) return;
    const names = this.registry.agentNames();
    for (const line of requestLines(text, null)) {
      if (!names.has(line.agent)) this.deps.changed(blockId, { line: line.text, state: "unanswered", warning: this.unanswered(line.agent) });
    }
    const lines = requestLines(text, names);
    const keys = new Set(lines.map((line) => line.requestKey));
    // A request waiting for quiet that the draft no longer has stops waiting.
    for (const [key, timer] of this.timers) {
      const [timerBlock, requestKey] = key.split("\0");
      if (timerBlock === blockId && !keys.has(requestKey!)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
    const before = new Set(this.store.agentRequestBaseline(blockId) ?? []);
    const rows = new Map(this.store.agentRequests(blockId).map(row => [row.requestKey, row]));
    const answered = new Set(rows.keys());
    for (const line of lines) {
      const key = this.key(blockId, line.requestKey);
      const row = rows.get(line.requestKey);
      if (row) this.deps.changed(blockId, { line: line.text, state: row.status, ...(row.message ? { warning: row.message } : {}), ...(row.status === "replied" ? { beside: true } : {}) });
      // The key includes the wording; other lines changing leave its deadline alone.
      if (this.timers.has(key)) continue;
      if (before.has(line.requestKey) || answered.has(line.requestKey) || this.running.has(key)) continue;
      const kept = this.recall(blockId, line.requestKey);
      if (kept) {
        this.store.putAgentRequest(kept);
        continue;
      }
      this.deps.changed(blockId, { line: line.text, state: "queued" });
      this.schedule(blockId, line.requestKey);
    }
  }

  /**
   * `r`: on a request line (`line`), ask its agent again now; on the note, ask every request in it not answered
   * yet (not asked, waiting, failed). `actor` is who pressed it, recorded as who asked. A line an agent or an
   * import wrote waits for a person: an agent's `r` on it is refused (unless yolo is on). Returns whether a request was asked.
   */
  async refresh(blockId: string, line: number | undefined, actor?: MutationProvenance): Promise<boolean> {
    const block = this.store.get(blockId);
    if (!block) return false;
    const rows = new Map(this.store.agentRequests(blockId).map((row) => [row.requestKey, row]));
    const byAgent = actor?.author === "agent" && this.deps.yolo?.() !== true;
    const held = (candidate: RequestLine) => {
      const row = rows.get(candidate.requestKey);
      return row?.status === "waiting" && row.requestedBy !== "user";
    };
    const lines = this.lines(block);
    let chosen: RequestLine[];
    if (line !== undefined) {
      chosen = lines.filter((candidate) => candidate.line === line);
      const waits = byAgent ? chosen.find(held) : undefined;
      if (waits) throw new Error(`@${waits.agent} on this line was written by an agent or an import: it waits for a person's r`);
    } else {
      chosen = lines.filter((candidate) => {
        const row = rows.get(candidate.requestKey);
        return (!row || row.status === "waiting" || row.status === "failed") && !(byAgent && held(candidate));
      });
    }
    const asked = [...new Set(chosen.map((candidate) => candidate.requestKey))];
    for (const requestKey of asked) {
      // Asked now: a wait for quiet on it is over.
      const timer = this.timers.get(this.key(blockId, requestKey));
      if (timer) clearTimeout(timer);
      this.timers.delete(this.key(blockId, requestKey));
    }
    const by = requester(actor);
    await Promise.all(asked.map((requestKey) => this.run(blockId, requestKey, by)));
    return asked.length > 0;
  }

  /** `askedBy`: who pressed `r` (absent when a save or a draft's quiet ran it). */
  private async run(blockId: string, requestKey: string, askedBy?: string, chain?: InvocationChain): Promise<void> {
    const key = this.key(blockId, requestKey);
    if (this.stopped) return;
    if (this.running.has(key)) {
      if (askedBy) this.again.set(key, askedBy);
      return;
    }
    const block = this.store.get(blockId);
    if (!block) return;
    let found = this.lines(block).find((candidate) => candidate.requestKey === requestKey);
    if (!found && !block.effectiveDeletedRootId && !this.store.extensionOwner(blockId)) {
      // Asked while typing (`drafts.touch`): the line is in the live draft, not saved yet.
      const draft = await this.deps.readDraft(blockId).catch(() => null);
      found = draft ? requestLines(draft.text, this.registry.agentNames()).find((candidate) => candidate.requestKey === requestKey) : undefined;
      if (this.stopped || this.running.has(key)) return;
    }
    const line = found;
    const bound = line ? this.registry.agent(line.agent) : undefined;
    if (!line || !bound) return;
    const { extension, agent } = bound;
    const previous = this.store.agentRequests(blockId).find((row) => row.requestKey === requestKey);
    const base = {
      blockId, requestKey, agent: line.agent, extensionId: extension.id, request: line.request,
      requestedBy: askedBy ?? previous?.requestedBy ?? "user",
      requestedAt: previous?.requestedAt ?? new Date(this.now).toISOString(),
    };
    const stillThere = (text: string) => text.split("\n").some((candidate) => candidate.replace(/\r$/, "") === line.text);
    this.running.add(key);
    this.live.set(key, { blockId, extensionId: extension.id, chain: chain ?? newChain(line.agent) });
    this.store.putAgentRequest({ ...base, status: "running" });
    this.deps.changed(blockId, { line: line.text, state: "working" });
    let streamed = "", replySpan = line.text;
    const replyGroup = crypto.randomUUID();
    let blocks = 0;
    let answer: Pick<AgentRequestRow, "status" | "message" | "reply" | "proposalId"> | null = null;
    try {
      const draft = await this.deps.readDraft(blockId);
      // The person changed or removed the line meanwhile: that is a new request (or none), not this one.
      if (!stillThere(draft.text)) return;
      if (extension.script) {
        const req = actRequestOf(["run", ...lineWords(line.request)]);
        if (req.as !== undefined || req.tile !== undefined) throw new Error("An @script line takes slot=value arguments; its author and target stay with the script");
        const by = base.requestedBy;
        const result = await this.deps.script!({ extension: extension.id, action: "run", blockId, clientId: draft.holder, background: true,
          args: req.args as Record<string, string>,
          requestedBy: by.startsWith("agent:") ? { author: "agent", actorId: by.slice(6) } : { author: "user" } });
        const reply = result.written.map(id => `((${id}|Script run))`).join("\n");
        answer = { status: result.error !== undefined ? "failed" : "replied", message: `${result.error ?? "Script finished"} · ${reply}`, reply };
        return;
      }
      const context = this.store.blockContext(blockId);
      const result = await this.runtime.invokeLoaded(extension, "respond", {
        agent: line.agent,
        request: line.request,
        mark: line.text,
        note: { id: blockId, revision: draft.revision, text: draft.text.slice(0, MAX_NOTE_TEXT) },
        context: {
          ancestors: contextAncestors(context.ancestors),
          children: context.children.slice(0, 50).map((child) => ({ id: child.id, text: child.text.slice(0, 2_000) })),
          now: new Date(this.now).toISOString(),
        },
      }, durationMs(agent.deadline) ?? durationMs(extension.manifest.deadline) ?? DEFAULT_DEADLINE_MS, {
        writes: agent.effects === "write", requestedBy: base.requestedBy.startsWith("agent:")
          ? { author: "agent", actorId: base.requestedBy.slice(6) } : { author: "user" },
        label: `ext.${extension.id}.agent.${line.agent}`,
        reply: async chunk => {
          if (this.stopped) throw new Error("the service stopped while answering");
          const text = cleanExtensionText(chunk, true);
          if (!text) return;
          streamed += text;
          if (Buffer.byteLength(streamed) > MAX_REPLY) throw new Error("reply must be text up to 64 KiB");
          const current = await this.deps.readDraft(blockId);
          const mark = requestLines(current.text, this.registry.agentNames()).find(candidate => candidate.requestKey === requestKey);
          if (!mark) throw new Error("the ask changed while answering");
          const start = mark.end - mark.text.length;
          const after = current.text.slice(start + replySpan.length);
          if (replySpan !== line.text && ((after && !after.startsWith("\n")) || after.startsWith("\n>"))) {
            throw new Error("the answer changed while streaming; your text was kept");
          }
          const replacement = `${line.text}\n> [!note]- @${line.agent} answered\n${streamed.split("\n").map(l => `> ${l}`).join("\n")}`;
          // Keep an existing quotation outside the answer fold, including while it is edited.
          const separator = replySpan === line.text && after.startsWith("\n>") ? "\n" : "";
          const actor: MutationProvenance = { author: "agent", actorId: extensionActorId(extension.id) };
          const outcome = await this.store.changes.run(
            this.store.changes.attribution({ action: `ext.${extension.id}.agent.${line.agent}`, actor }),
            () => this.deps.patch({ blockId, revision: current.revision, mutation: actor, current: true,
              replyTo: line.text, replyGroup, patches: [{ observed: replySpan, replacement: replacement + separator, range: { start, end: start + replySpan.length } }] }),
          );
          if (outcome.outcome !== "applied") throw new Error(`answer proposed instead: ${outcome.reason}`);
          replySpan = replacement;
          blocks = streamed.split(/\n\s*\n/).filter(part => part.trim()).length;
          this.deps.changed(blockId, { line: line.text, state: "working", blocks, beside: true });
        },
      });
      let respond: RespondValue;
      try {
        respond = validateRespond(result.value);
      } catch (error) {
        throw new Error(`@${line.agent} answered something the service can't apply: ${message(error)}`);
      }
      // Reworded while it ran: the answer was to a request that isn't there any more.
      if (!stillThere((await this.deps.readDraft(blockId)).text)) return;
      if (streamed) {
        if (respond.patches.length || respond.reply !== undefined) throw new Error("a streamed answer finishes with message only, not another reply or patches");
        answer = { status: "replied", message: respond.message ?? "answer in the note" };
      } else if (respond.patches.length) {
        const actor: MutationProvenance = { author: "agent", actorId: extensionActorId(extension.id) };
        // The edit's own feed entries say which agent made it. `current`: typing elsewhere in the note
        // doesn't make it a proposal; typing in that passage does.
        const outcome = await this.store.changes.run(
          this.store.changes.attribution({ action: `ext.${extension.id}.agent.${line.agent}`, actor }),
          () => this.deps.patch({ blockId, revision: draft.revision, patches: respond.patches, mutation: actor, mark: { text: line.text, blockId }, current: true }),
        );
        answer = outcome.outcome === "applied"
          ? { status: "applied", message: respond.message ?? `applied ${respond.patches.length === 1 ? "an edit" : `${respond.patches.length} edits`}`, reply: respond.reply ?? null }
          : { status: "proposed", message: `proposed instead: ${outcome.reason}`, proposalId: outcome.proposalId, reply: respond.reply ?? null };
      } else if (respond.reply !== undefined) {
        const actor: MutationProvenance = { author: "agent", actorId: extensionActorId(extension.id) };
        let body = this.checkedQueries(respond.reply);
        if (parsePropertyRecords(body.split("\n", 1)[0]!).some(p => p.key === "script")) {
          const source = this.store.changes.run(
            this.store.changes.attribution({ action: `ext.${extension.id}.agent.${line.agent}`, actor }),
            () => this.store.create(body, blockId, "agent", { actorId: actor.actorId! }),
          );
          body = `((${source.id}|Edit or keep the script))`;
          try {
            const run = await this.deps.runSource!(source.id, draft.holder);
            body += `\n${run.written.map(id => `!((${id}))`).join("\n")}`;
          } catch (error) { body += `\n⚠ ${message(error)}`; }
        }
        const outcome = await this.store.changes.run(
          this.store.changes.attribution({ action: `ext.${extension.id}.agent.${line.agent}`, actor }),
          () => this.deps.patch({ blockId, revision: draft.revision, mutation: actor, current: true,
            replyTo: line.text, patches: [{ observed: line.text, range: { start: line.end - line.text.length, end: line.end },
              replacement: `${line.text}\n> [!note]- @${line.agent} answered\n${body.split("\n").map(l => `> ${l}`).join("\n")}` }] }),
        );
        answer = outcome.outcome === "applied"
          ? { status: "replied", message: respond.message ?? "answer in the note" }
          : { status: "proposed", message: outcome.reason, proposalId: outcome.proposalId };
      } else {
        answer = { status: "nothing", message: respond.message ?? "nothing to change" };
      }
    } catch (error) {
      answer = { status: "failed", message: message(error) };
    } finally {
      this.running.delete(key);
      this.live.delete(key);
      const current = this.store.get(blockId);
      if (answer && current) this.store.putAgentRequest({ ...base, ...answer, answeredAt: new Date(this.now).toISOString() });
      // Not answered (the line changed): put back what was known before this run, or nothing.
      else if (current && previous) this.store.putAgentRequest(previous);
      else if (current) this.store.pruneAgentRequests(blockId, this.store.agentRequests(blockId).map((row) => row.requestKey).filter((candidate) => candidate !== requestKey));
      // Different whitespace, or an identical ask twice, shares one run but every visible line gets its outcome.
      const text = await this.deps.readDraft(blockId).catch(() => null);
      const marks = text ? requestLines(text.text, this.registry.agentNames()).filter(l => l.requestKey === requestKey) : [line];
      for (const mark of marks) this.deps.changed(blockId, { line: mark.text, state: answer?.status ?? "withdrawn",
        ...(answer?.message ? { warning: answer.message } : {}), ...(answer?.status === "replied" ? { blocks: blocks || 1, beside: true } : {}) });
      const again = this.again.get(key);
      if (again) {
        this.again.delete(key);
        void this.run(blockId, requestKey, again).catch(() => {});
      }
    }
  }

  /**
   * A comment written in a thread (ADR 0004 contract 6, marginalia's Ask): a person's comment on a passage, or a reply in
   * its thread, whose body has an `@name` line for an agent that answers in threads (`threads: true`). The agent's
   * `respond` gets the request, the passage (quote, offsets and context), the note or Resource text and the thread so
   * far; its reply lands in the thread as the extension (`ext:<id>`), under `ext.<id>.agent.<name>`. It never edits:
   * patches are refused here (an answer in a margin isn't an edit). Only a person's comment asks: an agent's (or an
   * extension's) never sets one off, so agents can't loop. Runs in the background; returns at once.
   */
  threadWritten(records: readonly AnnotationRecord[], author: string | undefined): void {
    if (this.stopped || author !== "user") return;
    const names = this.registry.threadAgentNames();
    if (!names.size) return;
    for (const record of records) {
      const line = requestLines(record.body, names)[0];
      if (!line) continue;
      void this.answerInThread(record, line).catch(() => {});
    }
  }

  /** Each thread's answers, one at a time: a second `@margin` waits for the first, so it resumes the same session. */
  private readonly threadTurns = new Map<string, Promise<TurnOutcome | void>>();

  private async answerInThread(record: AnnotationRecord, line: RequestLine): Promise<void> {
    await this.queueTurn(record.parentAnnotationId ?? record.block.id, record.block.id, line);
  }

  /**
   * A TL;DR of a thread (PIE-791), asked by the person (the door's `t`, the web's TL;DR): the agent that answers in
   * threads writes a short summary as a reply with `[kind::tldr]`, which becomes the thread's face. Runs in the
   * background like any answer; says which agent was asked. With no such agent it's refused, saying how to write one.
   * An agent that can't write one (no model set up, PIE-860) answers with no reply: nothing is posted, and when that
   * answer comes within `wait` ms the ask is refused with what it said (the fix), so no reader waits for a face.
   */
  async tldr(rootId: string, wait = TLDR_WAIT_MS): Promise<string> {
    const name = [...this.registry.threadAgentNames()][0];
    if (!name) throw new Error(`no agent answers in threads in this outline, so none can write a TL;DR: write it yourself (annotations.tldr with body)`);
    // Its agent still answering in this thread: said now, not queued behind it, so a refusal (no model) reaches whoever asked.
    if (this.threadTurns.has(rootId)) throw new Error(`@${name} is still answering in this thread: ask for the TL;DR again once that's in`);
    const request = TLDR_REQUEST, gen = this.tldrGen.get(rootId) ?? 0;
    // Taken away (annotations.tldr remove) while it was being written: it isn't posted.
    const still = () => (this.tldrGen.get(rootId) ?? 0) === gen;
    const turn = this.queueTurn(rootId, rootId, { agent: name, request, text: `@${name} ${request}`, line: 0, start: 0, end: 0, requestKey: `tldr:${rootId}` }, { kind: [TLDR_KIND] }, still);
    const done = await Promise.race([turn, Bun.sleep(wait).then(() => undefined)]);
    if (done && "refused" in done) throw new Error(done.refused);
    return name;
  }
  /** A thread's TL;DR taken away: one being written for it now isn't posted. */
  tldrRemoved(rootId: string) { this.tldrGen.set(rootId, (this.tldrGen.get(rootId) ?? 0) + 1); }
  private readonly tldrGen = new Map<string, number>();

  private queueTurn(rootId: string, asked: string, line: RequestLine, properties?: Record<string, string[]>, still?: () => boolean): Promise<TurnOutcome | void> {
    const turn: Promise<TurnOutcome | void> = (this.threadTurns.get(rootId) ?? Promise.resolve()).then(() => this.answerTurn(rootId, asked, line, properties, still)).catch(() => {});
    this.threadTurns.set(rootId, turn);
    void turn.finally(() => { if (this.threadTurns.get(rootId) === turn) this.threadTurns.delete(rootId); });
    return turn;
  }

  /** One ask answered: `asked` is the comment or reply that asked (a later turn may have landed after it). */
  private async answerTurn(rootId: string, asked: string, line: RequestLine, properties?: Record<string, string[]>, still?: () => boolean): Promise<TurnOutcome | void> {
    const bound = this.registry.agent(line.agent);
    if (!bound || this.stopped) return;
    const { extension, agent } = bound;
    const root = this.store.getAnnotation(rootId);
    const target = root.resolvedTarget ?? root.originalTarget;
    const subject = target.representation.subject;
    let note: { id: string; revision: number | string; text: string } | null = null;
    if (subject.kind === "block") {
      const block = this.store.get(subject.blockId);
      if (block && !block.effectiveDeletedRootId) note = { id: block.id, revision: block.revision, text: block.text };
    } else if (subject.kind === "resource") {
      const source = resourceCommentSource(this.store.resources.describe(subject.resourceId, true));
      if (source) note = { id: `resource:${subject.resourceId}`, revision: source.representation.contentHash ?? "", text: source.text };
    }
    const anchor = target.anchor;
    const passage = (anchor.kind === "text-quote" || anchor.kind === "pdf-page-region") && anchor.exact
      ? { subject: note?.id ?? "", quote: anchor.exact, start: anchor.start ?? null, end: anchor.end ?? null, prefix: anchor.prefix ?? "", suffix: anchor.suffix ?? "" }
      : null;
    const author = (r: AnnotationRecord) => r.block.author === "agent" ? r.block.actorId ?? "agent" : "user";
    const threads = this.store.listAnnotationThreads({ subject: subject.kind === "resource" ? { kind: "resource", resourceId: subject.resourceId } : { kind: "block", blockId: (subject as { blockId: string }).blockId }, includeResolved: true });
    // The whole thread, every turn: the notes to self between two asks too, so a resumed session sees what it missed.
    const thread = [root, ...threads.find((t) => t.block.id === rootId)?.replies ?? []]
      .map((r) => ({ id: r.block.id, author: author(r), body: r.body }));
    // The page's other comments, every time (the capability's finding: an answer once said it had none).
    const comments = pageComments(threads.filter((t) => t.block.id !== rootId), author);
    const key = sessionKey(line.agent);
    const tldr = properties?.kind?.[0] === TLDR_KIND;
    const session = root.properties?.[key]?.[0];
    const actor: MutationProvenance = { author: "agent", actorId: extensionActorId(extension.id) };
    let reply: string;
    let next: string | undefined;
    try {
      const result = await this.runtime.invokeLoaded(extension, "respond", {
        agent: line.agent,
        request: line.request,
        mark: line.text,
        ...(note ? { note: { ...note, text: note.text.slice(0, MAX_NOTE_TEXT) } } : {}),
        ...(passage ? { passage } : {}),
        thread,
        asked,
        comments,
        ...(session ? { session } : {}),
        properties: root.properties ?? {},
        ...(properties?.kind?.[0] === TLDR_KIND ? { tldr: true } : {}),
        context: { now: new Date(this.now).toISOString() },
      }, durationMs(agent.deadline) ?? durationMs(extension.manifest.deadline) ?? DEFAULT_DEADLINE_MS);
      const respond = validateRespond(result.value);
      if (respond.patches.length) throw new Error("an answer in a thread can't edit the note: reply only");
      // A TL;DR is the thread's face: one the agent didn't write (no reply, only a message saying why) is never posted.
      if (tldr && !respond.reply?.trim()) return { refused: respond.message?.trim() || `@${line.agent} wrote no TL;DR` };
      reply = this.checkedQueries(respond.reply?.trim() || respond.message?.trim() || "(no answer)");
      next = respond.session;
    } catch (error) {
      // Nor is an error: it would become the face.
      if (tldr) return { refused: `@${line.agent} couldn't write the TL;DR: ${message(error)}` };
      reply = `@${line.agent} couldn't answer: ${message(error)}`;
    }
    if (this.stopped) return;
    if (still && !still()) return { refused: "the TL;DR was taken away while it was being written" };
    const attribution = this.store.changes.attribution({ action: `ext.${extension.id}.agent.${line.agent}`, actor });
    this.store.changes.run(attribution, () => {
      // Its session goes on the thread first, so the next @margin resumes it even if this reply is read at once.
      if (next && next !== session) {
        try {
          this.store.setAnnotationProperties(rootId, { [key]: [next] }, actor);
        } catch { /* the thread changed or went: the answer still lands, and the next ask starts afresh */ }
      }
      this.store.replyToAnnotation(crypto.randomUUID(), { annotationId: rootId, body: reply, source: "agent", ...(properties ? { properties } : {}) }, "agent", { actorId: actor.actorId! });
    });
    this.deps.changed(note?.id && !note.id.startsWith("resource:") ? note.id : rootId);
  }

  /**
   * An answer that suggests a saved query (`[query::…]`, `[where::…]`, with its `[sort::…]` and `[group::…]`) has it
   * asked of the service before it lands: one that wouldn't parse, or names a property no note has, is marked under
   * the answer with why. The answer itself is never refused.
   */
  private checkedQueries(reply: string): string {
    // The property grammar reads them (a page link inside a query too), in code spans as well as in prose.
    const records = parsePropertyRecords(reply.replace(/`/g, ""));
    const found = (key: string) => records.filter((record) => record.key === key).map((record) => record.value.trim()).filter(Boolean);
    const wheres = [...found("query"), ...found("where")];
    const sorts = found("sort"), groups = found("group");
    if (!wheres.length && !sorts.length && !groups.length) return reply;
    const notes: string[] = [];
    const ask = (said: string, query: Record<string, unknown>) => {
      try {
        const answer = this.store.queryBlocks({ ...query, limit: 1 } as never) as { hint?: string };
        if (answer.hint) notes.push(`${said}: ${answer.hint}`);
      } catch (error) {
        notes.push(`${said} doesn't work: ${message(error)}`);
      }
    };
    for (const where of wheres) ask(`[query::${where}]`, { where });
    for (const sort of sorts) ask(`[sort::${sort}]`, { sort });
    for (const group of groups) ask(`[group::${group}]`, { group });
    return notes.length ? `${reply}\n\n⚠ checked with the outline: ${notes.join("; ")}` : reply;
  }

  /**
   * The proposal a request left was applied anyway or dismissed (PIE-510): its row says so, so the line's
   * projection tells the truth in every client. Who did it is said when it wasn't the person.
   */
  proposalSettled(proposalId: string, status: "applied" | "dismissed" | "resolved", by: MutationProvenance): void {
    const row = this.store.agentRequestByProposal(proposalId);
    if (!row || row.status !== "proposed") return;
    const who = by.author === "agent" ? ` by @${by.actorId ?? "an agent"}` : "";
    this.store.putAgentRequest({
      ...row, status: status === "resolved" ? "applied" : status,
      message: status === "resolved" ? `its proposal was resolved${who}` : status === "applied" ? `its proposal was applied anyway${who}` : `its proposal was dismissed${who}`,
      answeredAt: new Date(this.now).toISOString(),
    });
    this.deps.changed(row.blockId);
  }

  /** One projection per request line, in the slot extension outputs use (`resources.projection.read`). */
  projections(blockId: string, line?: number): ResourceProjection[] {
    const block = this.store.get(blockId);
    if (!block) return [];
    const rows = new Map(this.store.agentRequests(blockId).map((row) => [row.requestKey, row]));
    const lines = this.lines(block, null);
    // A note a reader opens: what it holds now is the baseline a later save is compared with.
    if (this.store.agentRequestBaseline(blockId) === null) this.remember(blockId, this.shapes(block));
    return lines
      .filter((candidate) => line === undefined || candidate.line === line)
      .map((candidate) => {
        const bound = this.registry.agent(candidate.agent);
        if (!bound) return {
          anchor: { kind: "directive" as const, line: candidate.line, start: candidate.start, end: candidate.end },
          provider: "agents", label: "Agents", propertyKey: `@${candidate.agent}`, key: `@${candidate.agent}`,
          kind: "agent" as const, options: { unknown: [] }, fields: [], status: "unavailable" as const,
          reason: this.unanswered(candidate.agent),
          agent: { name: candidate.agent, status: "unanswered", message: this.unanswered(candidate.agent) },
        };
        const row = rows.get(candidate.requestKey);
        const scheduled = this.timers.has(this.key(blockId, candidate.requestKey));
        const base = {
          anchor: { kind: "directive" as const, line: candidate.line, start: candidate.start, end: candidate.end },
          provider: bound.extension.id,
          label: bound.extension.name,
          propertyKey: `@${candidate.agent}`,
          key: `@${candidate.agent}`,
          kind: "agent" as const,
          options: { unknown: [] },
          fields: [],
          agent: {
            name: candidate.agent,
            status: row?.status ?? (scheduled ? "queued" : "not-asked"),
            ...(row?.message ? { message: row.message } : {}),
            ...(row?.proposalId ? { proposalId: row.proposalId } : {}),
            ...(row ? { requestedBy: row.requestedBy } : {}),
          },
        };
        if (!row) {
          return { ...base, status: "not-run" as const, reason: scheduled ? `@${candidate.agent} answers once the line is quiet` : `r asks @${candidate.agent}` };
        }
        if (row.status === "running") return { ...base, status: "not-run" as const, fetching: true, reason: `@${candidate.agent} is working on it` };
        if (row.status === "waiting") return { ...base, status: "not-run" as const, reason: row.message ?? `r asks @${candidate.agent}` };
        if (row.status === "failed") return { ...base, status: "unavailable" as const, reason: row.message ?? "it failed", fetchError: row.message ?? "it failed" };
        const at = row.answeredAt ?? row.requestedAt;
        return {
          ...base,
          status: "ready" as const,
          summary: row.message ?? row.status,
          fetchedAt: at,
          ...(row.reply ? { output: { markdown: inertBlockdown(row.reply), ranAt: at, ...(row.message ? { title: row.message } : {}) } } : {}),
        };
      });
  }
}
