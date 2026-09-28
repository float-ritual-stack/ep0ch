// Board over the outliner's JSON-lines socket (protocol 80 or newer).
// Reads use the service's safe-read actions. Writes are guarded by the service, never by retrying:
// `update` (a saved edit) and `properties.patch` (a card moved between lanes) name the revision they
// started from, so a stale one is refused instead of overwriting someone else's change; a comment names
// the note's revision and an exact quote, and carries a requestId, so a retry after a lost answer
// returns the comment that was already saved instead of adding a second one.
import { connect, type Socket } from "node:net";
import { hostname } from "node:os";
import type { Board, BoardInfo, Caller, Msg } from "./board";

export const DEFAULT_SOCKET = process.env.EP0CH_SOCKET ?? `${process.env.HOME}/.local/state/pi-herdr-outliner/float-box.sock`;
/** Oldest service protocol the door reads (the actions it can't do without). */
const PROTOCOL = 80;
/** The client protocol the door speaks: 82 introduced capability negotiation, which it understands. */
const CLIENT_PROTOCOL = 82;

/**
 * Additive service features the door uses when they're there, named as the service advertises them in
 * `ping.capabilities` (PIE-402). Without that list the door tries each once and remembers an
 * "Unsupported action" answer for the session.
 */
export type Capability = "blocks.read" | "properties.preview" | "views.read" | "query.expression" | "changes.since";

/**
 * A block as the service sends it: full (`text`), or projected without text (`title`, from blocks.read
 * or blocks.query `fields`), or compact (`preview`, from views.read `format: "tree"`).
 */
interface WireBlock {
  id: string; parentId?: string | null; text?: string; title?: string; preview?: string; revision?: number;
  author?: string; actorId?: string;
  createdAt?: string; updatedAt?: string; deletedAt?: string; effectiveDeletedRootId?: string;
  properties?: { key: string; value: string }[];
}
/** Everything a list row needs, without the note's full text. */
export const LIST_FIELDS = ["parent", "title", "properties", "revision", "timestamps", "author", "hasChildren"] as const;

export interface Activity { cursor: number; block: Msg; author: string; actor: string; kind: string; at: number }
export interface Comment {
  id: string; author: string; body: string; quote: string; at: number; open: boolean;
  /** Where the quote sits in the note's current text (UTF-16 offsets), when the service could place it. */
  start: number | null; end: number | null;
  replies: { id: string; author: string; body: string; at: number }[];
}
/** A passage to comment on: exact source text of the note, and where it starts (UTF-16 offset). */
export interface CommentPassage { quote: string; start: number }
export interface CommentReceipt { id: string; deduplicated: boolean }
/** One row of the whole-outline index: everything but the full text. */
export interface IndexBlock {
  id: string; parentId: string | null; position: number; title: string; author: string;
  createdAt: number; updatedAt: number; props: Record<string, string>; hasChildren: boolean;
}
export interface Backlink { id: string; title: string; context: string; updatedAt: number; kinds: string; snippet: string }
/** The service's record of one committed change (PIE-399), on content events and from `changes.since`. */
export interface Change {
  sequence: number; changeId: number; action: string;
  kind: "create" | "edit" | "move" | "delete" | "restore" | "purge" | "annotate" | "draft" | "reorder" | "other";
  blockId?: string; parentId?: string | null; previousParentId?: string | null;
  revision?: number; deleted?: boolean; actor?: { author?: string; actorId?: string }; recordedAt: string;
}
/**
 * An outline event. Besides the service's own, the door makes two after a reconnect:
 * `reset` (reload everything: the service has no feed, or its history doesn't reach back far enough)
 * and `reconnected` (caught up; `caughtUp` changes were replayed as ordinary events first).
 */
export interface OutlineEvent {
  domain: string; action: string; blockId?: string; sequence: number;
  change?: Change;
  /** Replayed from `changes.since` after a reconnect, not live. */
  catchUp?: boolean;
  reason?: string;
  caughtUp?: number;
}
/** views.read's answer (PIE-397), blocks as list rows. */
export interface SavedViewRead {
  status: "ready" | "invalid" | "unsupported" | "missing" | "changed" | "failed";
  viewId: string; revision?: number; sequence: number;
  configuredLimit?: number; effectiveLimit?: number; offset?: number; total?: number; nextOffset?: number;
  blocks: Msg[];
  completeness: { kind: string } | null;
  errors: string[];
  problems?: { code: string; message: string; property?: string; position?: number }[];
}
export type ChangePage =
  | { kind: "changes"; changes: Change[]; nextSequence: number; completeness: { kind: string }; sequence: number }
  | { kind: "reset"; reason: string; oldestSequence: number; sequence: number };

/** The first line of a compact tree preview (it joins a property-less note's lines with ` ↵ `). */
const previewTitle = (p: string) => p.split(" \u21b5 ")[0]!.trim();

const toMsg = (b: WireBlock, childIds: string[] = []): Msg => ({
  id: b.id,
  text: b.text ?? b.title ?? (b.preview !== undefined ? previewTitle(b.preview) : ""),
  parentId: b.parentId ?? null,
  childIds,
  createdAt: b.createdAt ? Date.parse(b.createdAt) : 0,
  updatedAt: b.updatedAt ? Date.parse(b.updatedAt) : 0,
  author: b.actorId ?? b.author ?? null,
  props: Object.fromEntries((b.properties ?? []).map(p => [p.key, p.value])),
  revision: b.revision,
  properties: (b.properties ?? []).map(p => ({ key: p.key, value: p.value })),
  ...(b.text === undefined ? { partial: true } : {}),
});

const unsupportedAction = (e: unknown) => /unsupported action|unknown action/i.test(e instanceof Error ? e.message : String(e));

/** One property token in a block's text, numbered the way `properties.patch` addresses it. */
export interface PropertyToken { key: string; value: string; ordinal: number; scope: "block" | "line" | "inline" }
/** The outliner's PropertyPatchOperation. */
export type PropertyPatch =
  | { op: "replace"; ordinal: number; value: string }
  | { op: "append"; key: string; value: string };

/** The block changed after the draft was read; the service kept the other writer's text. */
export class EditConflict extends Error {
  constructor(readonly blockId: string, message: string) { super(message); this.name = "EditConflict"; }
}

/**
 * The service answered with an error: it refused the request and wrote nothing. Anything else that
 * fails (a timeout, a dropped socket) leaves the outcome unknown, which is why comment writes carry a requestId.
 */
export class Refused extends Error {
  constructor(message: string) { super(message); this.name = "Refused"; }
}

/**
 * The door's actor id, per machine (`ep0ch-door:float-box`), so `activity.recent` tells a laptop edit
 * from a float-box one.
 */
export const ACTOR_ID = `ep0ch-door:${hostname()}`;
/** How door edits are attributed: a person typing in the door, like the outliner's own Detail. */
export const EDIT_MUTATION = { author: "user", actorId: ACTOR_ID } as const;
/**
 * Comments and replies are a person's, like the outliner's own Detail sends them. The service takes an
 * actor id only on agent-authored annotations, so these can't name the door; resolve/reopen can.
 */
export const COMMENT_AUTHOR = "user";

class Line {
  private buf = "";
  constructor(private readonly onLine: (v: any) => void) {}
  feed(d: Buffer | string) {
    this.buf += typeof d === "string" ? d : d.toString("utf8");
    for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (line.trim()) { try { this.onLine(JSON.parse(line)); } catch { /* ignore garbage */ } }
    }
  }
}

export class SocketBoard implements Board {
  private sock: Socket | null = null;
  private waiting = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer }>();
  private seq = 0;
  private events: Socket | null = null;
  readonly clientId = `ep0ch-door-${crypto.randomUUID().slice(0, 8)}`;
  /** What `ping.capabilities` advertised, or null when the service doesn't advertise (older than PIE-402). */
  capabilities: Set<string> | null = null;
  /** Actions this service answered "Unsupported action" to, this session. */
  private unsupported = new Set<string>();
  /** Every request's action, newest last: which paths the door actually took (tests read it). */
  readonly sent: string[] = [];

  constructor(readonly path = DEFAULT_SOCKET, private readonly timeoutMs = 15_000) {}

  private conn(): Socket {
    if (this.sock && !this.sock.destroyed) return this.sock;
    const s = connect(this.path);
    const lines = new Line(r => {
      const w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id); clearTimeout(w.timer);
      r.ok ? w.resolve(r.result) : w.reject(new Refused(r.error ?? "request failed"));
    });
    s.on("data", d => lines.feed(d));
    const fail = (e: Error) => { for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(e); } this.waiting.clear(); if (this.sock === s) this.sock = null; };
    s.on("error", fail);
    s.on("close", () => fail(new Error("outline socket closed")));
    this.sock = s;
    return s;
  }

  request<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `d${++this.seq}`;
    if (this.sent.length > 5000) this.sent.splice(0, 2500);
    this.sent.push(action);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${action} timed out`)); }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.conn().write(JSON.stringify({ id, action, ...params }) + "\n");
    });
  }

  /**
   * Whether the service has `name`: true or false when it said so (its capability list, or an
   * "Unsupported action" answer this session), undefined when the only way to know is to try.
   */
  supports(name: Capability): boolean | undefined {
    if (this.capabilities) return this.capabilities.has(name);
    return this.unsupported.has(name) ? false : undefined;
  }

  /**
   * A request that newer services answer and older ones refuse with "Unsupported action". Null when
   * this service doesn't have it; that answer is remembered, so the door asks once per session.
   */
  async optional<T>(capability: Capability, action: string, params: Record<string, unknown> = {}): Promise<T | null> {
    if (this.supports(capability) === false) return null;
    try {
      return await this.request<T>(action, params);
    } catch (e) {
      if (e instanceof Refused && unsupportedAction(e)) { this.unsupported.add(capability); return null; }
      throw e;
    }
  }

  toMsgs(blocks: WireBlock[]): Msg[] { return blocks.map(b => toMsg(b)); }

  async info(): Promise<BoardInfo> {
    const r = await this.request<{ protocolVersion: number; minClientProtocol?: number; capabilities?: string[]; location: { hostname: string; workspaceRoot: string } }>("ping");
    // Newer services add actions; the door only needs long-standing ones, so older is the hard stop.
    if (r.protocolVersion < PROTOCOL) throw new Error(`outline speaks protocol ${r.protocolVersion}; this door needs ${PROTOCOL} or newer`);
    if (r.minClientProtocol !== undefined && r.minClientProtocol > CLIENT_PROTOCOL)
      throw new Error(`outline (protocol ${r.protocolVersion}) no longer serves clients older than protocol ${r.minClientProtocol}; this door speaks ${CLIENT_PROTOCOL}`);
    // A capability list is the service's word; without one, each feature is tried once (see optional()).
    this.capabilities = Array.isArray(r.capabilities) ? new Set(r.capabilities) : null;
    this.unsupported.clear();
    return { host: r.location.hostname, workspace: r.location.workspaceRoot, protocol: r.protocolVersion, blocks: null, capabilities: r.capabilities ?? null };
  }

  async roots(): Promise<Msg[]> {
    return (await this.request<WireBlock[]>("children", { parentId: null })).map(b => toMsg(b));
  }

  async get(id: string): Promise<Msg | null> {
    try {
      const ctx = await this.request<{ selected: WireBlock | null; children: WireBlock[] }>("blocks.context", { blockId: id });
      return ctx.selected ? toMsg(ctx.selected, ctx.children.map(c => c.id)) : null;
    } catch { return null; }
  }

  /** Breadcrumb, root first. */
  async ancestors(id: string): Promise<Msg[]> {
    const ctx = await this.request<{ ancestors: WireBlock[] }>("blocks.context", { blockId: id });
    return ctx.ancestors.map(b => toMsg(b));
  }

  async children(id: string): Promise<Msg[]> {
    return (await this.request<WireBlock[]>("children", { parentId: id })).map(b => toMsg(b));
  }

  async changedSince(since: number, limit: number): Promise<Msg[]> {
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", {
      query: { limit: Math.min(1000, limit), sort: { field: "updated", direction: "desc" } },
    });
    return r.blocks.map(b => toMsg(b)).filter(m => m.updatedAt > since);
  }

  async search(text: string, limit: number): Promise<Msg[]> {
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", {
      query: { limit: Math.min(1000, limit), text, sort: { field: "updated", direction: "desc" } },
    });
    return r.blocks.map(b => toMsg(b));
  }

  async callers(): Promise<Caller[]> {
    const list = await this.request<any[]>("clients.list");
    return list.map(c => ({
      id: c.clientId,
      name: c.role,
      host: c.runtime?.hostname ?? (String(c.clientId).startsWith("ep0ch-door") ? "ep0ch door" : "—"),
      activity: c.currentTarget?.kind === "block" ? `reading ${c.currentTarget.blockId.slice(0, 8)}`
        : c.currentTarget?.kind === "resource" ? "in the file area" : c.role === "observer" ? "lurking" : "idle",
      since: null,
      target: c.currentTarget?.kind === "block" ? c.currentTarget.blockId : null,
    }));
  }

  /** Who edited what, across all three author classes, newest first. */
  async activity(limit = 60): Promise<Activity[]> {
    const pages = await Promise.all((["user", "agent", "system"] as const).map(author =>
      this.request<{ entries: any[] }>("activity.recent", { author, limit: Math.min(100, limit) }).catch(() => ({ entries: [] }))));
    return pages.flatMap(p => p.entries).map(e => ({
      cursor: e.cursor, block: toMsg(e.block), author: e.author, actor: e.actorId ?? e.author, kind: e.kind, at: Date.parse(e.editedAt),
    })).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  /** The whole outline without full text (tree.index): parents, properties, titles. ~1 MB for 1.5k blocks. */
  async index(): Promise<IndexBlock[]> {
    // Its own connection: the service answers one socket strictly in order, and this call takes seconds.
    const lane = new SocketBoard(this.path, 90_000);
    const r = await lane.request<{ blocks: any[] }>("tree.index", {}).finally(() => lane.close());
    return r.blocks.map(b => ({
      id: b.id, parentId: b.parentId ?? null, position: b.position ?? 0, title: String(b.preview ?? "").trim() || "(untitled)",
      author: b.actorId ?? b.author ?? "?", createdAt: Date.parse(b.createdAt), updatedAt: Date.parse(b.updatedAt),
      props: Object.fromEntries((b.properties ?? []).map((p: any) => [p.key, p.value])), hasChildren: !!b.hasChildren,
    }));
  }

  /** Blocks carrying one property value, newest first (a virtual branch). */
  async byProp(key: string, value: string, limit = 200): Promise<Msg[]> {
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", {
      query: { limit, filters: [{ key, value }], sort: { field: "updated", direction: "desc" } },
    });
    return r.blocks.map(b => toMsg(b));
  }

  /**
   * Blocks matching property clauses (`type=roadmap-item work-stage=doing`). `list` asks for rows
   * without full text (PIE-400 `fields`); a service that doesn't know `fields` sends whole blocks, which
   * read the same.
   */
  async query(q: string, limit = 50, sort: "created" | "updated" = "updated", direction: "asc" | "desc" = "desc", list = false): Promise<Msg[]> {
    const filters = q.split(/\s+/).filter(Boolean).map(t => { const i = t.indexOf("="); return i > 0 ? { key: t.slice(0, i), value: t.slice(i + 1) } : { key: t }; });
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", { query: { limit: Math.min(1000, limit), filters, sort: { field: sort, direction } }, ...this.listFields(list) });
    return r.blocks.map(b => toMsg(b));
  }

  /** `fields` for a list-shaped read, unless this service has said it doesn't project. */
  listFields(list = true): { fields?: readonly string[] } {
    return list && this.supports("blocks.read") !== false ? { fields: LIST_FIELDS } : {};
  }

  /**
   * Several blocks at once, as list rows (PIE-400 `blocks.read`), in the order asked. Missing and
   * trashed ids are left out. Older services: one `blocks.context` per id.
   */
  async readMany(ids: string[], fields: readonly string[] = LIST_FIELDS): Promise<Msg[]> {
    if (!ids.length) return [];
    const r = await this.optional<{ blocks: WireBlock[] }>("blocks.read", "blocks.read", { ids, fields });
    if (r) return r.blocks.map(b => toMsg(b));
    return (await Promise.all(ids.map(id => this.get(id)))).filter((m): m is Msg => !!m);
  }

  /**
   * A saved view's members as the service evaluates them (PIE-397 `views.read`), as list rows.
   * Null when this service can't; the door then evaluates the view itself (src/views.ts).
   */
  async readSavedView(viewId: string): Promise<SavedViewRead | null> {
    const r = await this.optional<Omit<SavedViewRead, "blocks"> & { blocks: WireBlock[] }>("views.read", "views.read", { viewId, format: "tree" });
    return r && { ...r, blocks: r.blocks.map(b => toMsg(b)) };
  }

  /** What changed after `sequence` (PIE-399), or an explicit reset. Null when this service has no feed. */
  changesSince(sequence: number, limit = 500): Promise<ChangePage | null> {
    return this.optional<ChangePage>("changes.since", "changes.since", { sequence, limit });
  }

  /** Blocks that point at this one, excluding itself. */
  async backlinks(id: string, limit = 100): Promise<Backlink[]> {
    const r = await this.request<{ sources: any[] }>("references.backlinks", { query: { targetBlockId: id, limit } });
    return r.sources.filter(s => s.blockId !== id).map(s => ({
      id: s.blockId, title: s.title, context: s.parentContext ?? "", updatedAt: Date.parse(s.updatedAt),
      kinds: (s.referenceGroups ?? []).map((g: any) => `${g.kind}×${g.count}`).join(" "),
      snippet: String(s.occurrences?.[0]?.snippet ?? "").replace(/\s+/g, " ").trim(),
    }));
  }

  /** Comment threads anchored on a block (open ones first). */
  async comments(blockId: string): Promise<Comment[]> {
    const threads = await this.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId }, includeResolved: true } });
    const who = (r: any) => r?.block?.actorId ?? r?.source ?? r?.block?.author ?? "?";
    const text = (r: any) => String(r?.body ?? r?.block?.text ?? "").trim();
    const when = (r: any) => Date.parse(r?.block?.createdAt ?? r?.createdAt ?? "") || 0;
    const offset = (v: unknown) => (typeof v === "number" ? v : null);
    return threads.map(t => {
      // resolvedTarget follows the quote through later edits; null means the service lost it.
      const at = t.resolvedTarget?.anchor;
      return {
        id: t.block?.id ?? "", author: who(t), body: text(t), at: when(t), open: t.lifecycle !== "resolved",
        quote: String(t.originalTarget?.anchor?.exact ?? "").replace(/\s+/g, " ").trim(),
        start: at?.kind === "text-quote" ? offset(at.start) : null, end: at?.kind === "text-quote" ? offset(at.end) : null,
        replies: (t.replies ?? []).map((r: any) => ({ id: r.block?.id ?? "", author: who(r), body: text(r), at: when(r) })),
      };
    }).sort((a, b) => Number(b.open) - Number(a.open) || b.at - a.at);
  }

  /**
   * A block comment on an exact passage (`annotations.batch` / `block-comment`). The service refuses it
   * when the note is no longer at `expectedRevision` or the quote isn't where `start` says. `requestId`
   * must be the same on a retry of the same comment: the service then returns the saved one.
   */
  async comment(requestId: string, blockId: string, expectedRevision: number, body: string, passage: CommentPassage): Promise<CommentReceipt> {
    const r = await this.request<{ annotations: { block: { id: string } }[]; deduplicated: boolean }>("annotations.batch", {
      requestId, author: COMMENT_AUTHOR,
      operations: [{ operationId: "comment", type: "block-comment", input: { blockId, expectedRevision, body, source: COMMENT_AUTHOR, passage } }],
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /** A reply on a comment thread, idempotent by `requestId` like `comment`. */
  async reply(requestId: string, annotationId: string, body: string): Promise<CommentReceipt> {
    const r = await this.request<{ annotations: { block: { id: string } }[]; deduplicated: boolean }>("annotations.reply", {
      requestId, author: COMMENT_AUTHOR, input: { annotationId, body, source: COMMENT_AUTHOR },
    });
    return { id: r.annotations[0]!.block.id, deduplicated: r.deduplicated };
  }

  /** Resolve or reopen a thread. It sets a state rather than adding anything, so repeating it is harmless. */
  async setLifecycle(annotationId: string, lifecycle: "open" | "resolved"): Promise<void> {
    await this.request("annotations.lifecycle", { input: { annotationId, lifecycle }, mutation: EDIT_MUTATION });
  }

  /** Replace a block's whole text, if it is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async update(blockId: string, text: string, expectedRevision: number): Promise<Msg> {
    try {
      return toMsg(await this.request<WireBlock>("update", { blockId, text, expectedRevision, mutation: EDIT_MUTATION }));
    } catch (e) {
      const { conflict, now } = await this.conflictCheck(blockId, expectedRevision, e);
      // No answer, yet the note now holds exactly this text: the save landed before the answer was lost.
      if (conflict && now && !(e instanceof Refused) && now.text === text) return now;
      if (conflict) throw new EditConflict(blockId, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /**
   * After a failed write: is it a revision conflict? The service says so only in words today
   * ("changed since editing began"), which could be reworded, so the door also reads the block again:
   * a revision past `expected` is a conflict whatever the message said. Returns that current block.
   */
  private async conflictCheck(blockId: string, expected: number, e: unknown): Promise<{ conflict: boolean; now: Msg | null }> {
    const worded = /changed since editing began/i.test(e instanceof Error ? e.message : String(e));
    const now = await this.get(blockId);
    return { conflict: worded || (now?.revision !== undefined && now.revision !== expected), now };
  }

  /**
   * The properties the service would store for `text` (PIE-401 `properties.preview`), without saving.
   * Null when this service is older and doesn't offer it; the answer is remembered for the session.
   */
  async previewProperties(text: string): Promise<Record<string, string> | null> {
    const r = await this.optional<{ properties: { key: string; value: string }[] }>("properties.preview", "properties.preview", { text });
    return r && Object.fromEntries(r.properties.map(p => [p.key, p.value]));
  }

  /**
   * The block's own property tokens for `key`, as the service numbers them (`ordinal` is what
   * `properties.patch` replaces), at the revision the service read them. Asking the service keeps the
   * door from re-deriving the property parser: fences, code spans, hashtags and bare `key::` lines.
   */
  async propertyTokens(blockId: string, key: string): Promise<{ revision: number; tokens: PropertyToken[] }> {
    const r = await this.request<{ blocks: (WireBlock & { propertyMatches?: PropertyToken[] })[]; completeness: { kind: string } }>("blocks.query", {
      query: { filters: [{ key }], subtreeRootId: blockId, propertyScope: "all", limit: 200 },
    });
    const own = r.blocks.find(b => b.id === blockId);
    if (own) return { revision: own.revision!, tokens: (own.propertyMatches ?? []).filter(t => t.key === key) };
    if (r.completeness?.kind !== "complete") throw new Error(`couldn't read ${key}:: on the card (its subtree is too large to scan)`);
    // The block has no such token, in any scope; its revision still has to be known.
    const b = await this.request<{ selected: WireBlock | null }>("blocks.context", { blockId });
    if (!b.selected) throw new Error("the card is gone from the outline");
    return { revision: b.selected.revision!, tokens: [] };
  }

  /** Patch property tokens, if the block is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async patchProperties(blockId: string, expectedRevision: number, operations: PropertyPatch[]): Promise<Msg> {
    try {
      return toMsg(await this.request<WireBlock>("properties.patch", { blockId, expectedRevision, operations, mutation: EDIT_MUTATION }));
    } catch (e) {
      // Only a refusal can be called a conflict here: without an answer the patch may have landed.
      if (e instanceof Refused && (await this.conflictCheck(blockId, expectedRevision, e)).conflict) throw new EditConflict(blockId, e.message);
      throw e;
    }
  }

  // ── events ─────────────────────────────────────────────────────────────────

  /** The newest service sequence the door has seen events up to; a reconnect catches up from here. */
  lastSequence = 0;
  private lastChangeId = 0;
  private sub: { onEvent: (e: OutlineEvent) => void; attempt: number; retry: Timer | null; lost: boolean } | null = null;
  private closing = false;
  /** First reconnect delay; it doubles per failed try, up to 5 s. */
  reconnectMs = 250;
  /** Told when the event connection drops and when it's back (with what the catch-up did). */
  onConnection: (state: "lost" | "restored", detail: string) => void = () => {};

  /**
   * Register as an observer and stream events; the door then shows up in Who's Online, like any caller.
   * If the connection drops (the service restarted), it reconnects with backoff and catches up: with a
   * change feed, the missed changes are replayed as events; otherwise, or when the feed's history
   * doesn't reach back, a `reset` event tells screens to reload everything.
   */
  subscribe(onEvent: (e: OutlineEvent) => void): void {
    if (process.env.EP0CH_OBSERVE === "0" || this.sub) return;
    this.closing = false;
    this.sub = { onEvent, attempt: 0, retry: null, lost: false };
    this.openEvents(false);
  }

  private openEvents(reconnect: boolean) {
    const sub = this.sub;
    if (!sub || this.closing) return;
    const s = connect(this.path);
    let subscribed = false;
    // Live events that arrive while the catch-up is still reading wait for it, so order holds.
    let held: OutlineEvent[] | null = reconnect ? [] : null;
    const lines = new Line(r => {
      if (r.id === "sub") {
        if (!r.ok) return;
        subscribed = true; sub.attempt = 0;
        if (!reconnect) { this.lastSequence = Math.max(this.lastSequence, Number(r.sequence) || 0); return; }
        void this.catchUp(Number(r.sequence) || 0).then(({ replayed, reset }) => {
          if (this.sub !== sub) return;                   // closed while catching up
          sub.lost = false;
          const rest = held ?? []; held = null;
          for (const e of rest) this.deliver(e);
          this.onConnection("restored", reset ? `reloaded everything (${reset})` : `caught up ${replayed} change${replayed === 1 ? "" : "s"}`);
        });
        return;
      }
      if (!r.event) return;
      if (held) held.push(r.event); else this.deliver(r.event);
    });
    s.on("data", d => lines.feed(d));
    s.on("error", () => {});
    s.on("close", () => {
      if (this.events === s) this.events = null;
      if (this.closing || this.sub !== sub) return;
      // A service shutting down drops its subscribers, then waits for every other connection to end.
      // Let go of the idle request connection too, so a restart isn't held up by the door; the next
      // request opens a new one.
      if (!this.waiting.size && this.sock) { this.sock.end(); this.sock = null; }
      if (subscribed || !sub.lost) { sub.lost = true; this.onConnection("lost", "outline connection lost · reconnecting"); }
      const wait = Math.min(5000, this.reconnectMs * 2 ** sub.attempt++);
      sub.retry = setTimeout(() => this.openEvents(true), wait);
    });
    s.on("connect", () => s.write(JSON.stringify({
      id: "sub", action: "events.subscribe", client: { clientId: this.clientId, role: "observer", contextId: this.clientId },
    }) + "\n"));
    this.events = s;
  }

  /** One event to the screens, once: a change the catch-up already replayed isn't delivered again. */
  private deliver(e: OutlineEvent) {
    if (e.change) {
      if (e.change.changeId <= this.lastChangeId) return;
      this.lastChangeId = e.change.changeId;
    }
    if (e.sequence > this.lastSequence) this.lastSequence = e.sequence;
    this.sub?.onEvent(e);
  }

  /**
   * After a reconnect: ask again what the service can do (it may have been upgraded), then replay what
   * was missed. More than a page of changes, no feed, or a feed reset all mean "reload everything".
   */
  private async catchUp(subscribedAt: number): Promise<{ replayed: number; reset: string | null }> {
    // `subscribedAt` is the service's sequence when the new subscription started: after a reset, events
    // from there on are what the reloaded screens haven't seen.
    const reset = (reason: string, sequence = subscribedAt || this.lastSequence) => {
      // Resume from the service's own position: after "sequence-ahead" (a different or restored
      // database) the door's cursor and change ids mean nothing there.
      this.lastSequence = sequence; this.lastChangeId = 0;
      this.sub?.onEvent({ domain: "content", action: "reset", sequence: this.lastSequence, reason });
      return { replayed: 0, reset: reason };
    };
    try {
      await this.info();
      const page = await this.changesSince(this.lastSequence);
      if (!page) return reset("this service has no change feed");
      if (page.kind === "reset") return reset(`the feed's history ${page.reason === "sequence-ahead" ? "is behind the door" : "doesn't reach back"}`, page.sequence);
      if (page.completeness.kind !== "complete") return reset("too much changed while away", page.sequence);
      for (const c of page.changes)
        this.deliver({ domain: "content", action: c.action, blockId: c.blockId, sequence: c.sequence, change: c, catchUp: true });
      this.lastSequence = Math.max(this.lastSequence, page.sequence);
      this.sub?.onEvent({ domain: "content", action: "reconnected", sequence: this.lastSequence, caughtUp: page.changes.length });
      return { replayed: page.changes.length, reset: null };
    } catch (e) {
      return reset(`catch-up failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  close(): void {
    this.closing = true;
    if (this.sub?.retry) clearTimeout(this.sub.retry);
    this.sub = null;
    this.sock?.end(); this.events?.end(); this.sock = null; this.events = null;
  }
}
