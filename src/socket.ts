// Board over the outliner's JSON-lines socket (protocol 80 or newer).
// Reads use the service's safe-read actions. The one write is `update`, which names the revision it
// started from, so the service refuses a stale draft instead of overwriting someone else's edit.
import { connect, type Socket } from "node:net";
import type { Board, BoardInfo, Caller, Msg } from "./board";

export const DEFAULT_SOCKET = process.env.EP0CH_SOCKET ?? `${process.env.HOME}/.local/state/pi-herdr-outliner/float-box.sock`;
const PROTOCOL = 80;

interface WireBlock {
  id: string; parentId: string | null; text: string; revision?: number; author: string; actorId?: string;
  createdAt: string; updatedAt: string; deletedAt?: string; effectiveDeletedRootId?: string;
  properties?: { key: string; value: string }[];
}

export interface Activity { cursor: number; block: Msg; author: string; actor: string; kind: string; at: number }
export interface Comment {
  id: string; author: string; body: string; quote: string; at: number; open: boolean;
  replies: { author: string; body: string; at: number }[];
}
/** One row of the whole-outline index: everything but the full text. */
export interface IndexBlock {
  id: string; parentId: string | null; position: number; title: string; author: string;
  createdAt: number; updatedAt: number; props: Record<string, string>; hasChildren: boolean;
}
export interface Backlink { id: string; title: string; context: string; updatedAt: number; kinds: string; snippet: string }
export interface OutlineEvent { domain: string; action: string; blockId?: string; sequence: number }

const toMsg = (b: WireBlock, childIds: string[] = []): Msg => ({
  id: b.id,
  text: b.text,
  parentId: b.parentId,
  childIds,
  createdAt: Date.parse(b.createdAt),
  updatedAt: Date.parse(b.updatedAt),
  author: b.actorId ?? b.author ?? null,
  props: Object.fromEntries((b.properties ?? []).map(p => [p.key, p.value])),
  revision: b.revision,
});

/** The block changed after the draft was read; the service kept the other writer's text. */
export class EditConflict extends Error {
  constructor(readonly blockId: string, message: string) { super(message); this.name = "EditConflict"; }
}

/** How door edits are attributed: a person typing in the door, like the outliner's own Detail. */
export const EDIT_MUTATION = { author: "user", actorId: "ep0ch-door" } as const;

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

  constructor(readonly path = DEFAULT_SOCKET, private readonly timeoutMs = 15_000) {}

  private conn(): Socket {
    if (this.sock && !this.sock.destroyed) return this.sock;
    const s = connect(this.path);
    const lines = new Line(r => {
      const w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id); clearTimeout(w.timer);
      r.ok ? w.resolve(r.result) : w.reject(new Error(r.error ?? "request failed"));
    });
    s.on("data", d => lines.feed(d));
    const fail = (e: Error) => { for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(e); } this.waiting.clear(); this.sock = null; };
    s.on("error", fail);
    s.on("close", () => fail(new Error("outline socket closed")));
    this.sock = s;
    return s;
  }

  request<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `d${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${action} timed out`)); }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.conn().write(JSON.stringify({ id, action, ...params }) + "\n");
    });
  }

  toMsgs(blocks: WireBlock[]): Msg[] { return blocks.map(b => toMsg(b)); }

  async info(): Promise<BoardInfo> {
    const r = await this.request<{ protocolVersion: number; location: { hostname: string; workspaceRoot: string } }>("ping");
    // Newer services add actions; the door only uses long-standing ones, so older is the only hard stop.
    if (r.protocolVersion < PROTOCOL) throw new Error(`outline speaks protocol ${r.protocolVersion}; this door needs ${PROTOCOL} or newer`);
    return { host: r.location.hostname, workspace: r.location.workspaceRoot, protocol: r.protocolVersion, blocks: null };
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

  /** Run a saved virtual-branch query (`type=roadmap-item work-stage=doing`) as filters. */
  async query(q: string, limit = 50, sort: "created" | "updated" = "updated", direction: "asc" | "desc" = "desc"): Promise<Msg[]> {
    const filters = q.split(/\s+/).filter(Boolean).map(t => { const i = t.indexOf("="); return i > 0 ? { key: t.slice(0, i), value: t.slice(i + 1) } : { key: t }; });
    const r = await this.request<{ blocks: WireBlock[] }>("blocks.query", { query: { limit: Math.min(1000, limit), filters, sort: { field: sort, direction } } });
    return r.blocks.map(b => toMsg(b));
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
    return threads.map(t => ({
      id: t.block?.id ?? "", author: who(t), body: text(t), at: when(t), open: t.lifecycle !== "resolved",
      quote: String(t.originalTarget?.anchor?.exact ?? "").replace(/\s+/g, " ").trim(),
      replies: (t.replies ?? []).map((r: any) => ({ author: who(r), body: text(r), at: when(r) })),
    })).sort((a, b) => Number(b.open) - Number(a.open) || b.at - a.at);
  }

  /** Replace a block's whole text, if it is still at `expectedRevision`. Throws EditConflict when it isn't. */
  async update(blockId: string, text: string, expectedRevision: number): Promise<Msg> {
    try {
      return toMsg(await this.request<WireBlock>("update", { blockId, text, expectedRevision, mutation: EDIT_MUTATION }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/changed since editing began/i.test(msg)) throw new EditConflict(blockId, msg);
      throw e;
    }
  }

  /** Register as an observer and stream events. The door then shows up in Who's Online, like any caller. */
  subscribe(onEvent: (e: OutlineEvent) => void): void {
    if (process.env.EP0CH_OBSERVE === "0" || this.events) return;
    const s = connect(this.path);
    const lines = new Line(r => { if (r.event) onEvent(r.event); });
    s.on("data", d => lines.feed(d));
    s.on("error", () => {});
    s.on("close", () => { this.events = null; });
    s.on("connect", () => s.write(JSON.stringify({
      id: "sub", action: "events.subscribe", client: { clientId: this.clientId, role: "observer", contextId: this.clientId },
    }) + "\n"));
    this.events = s;
  }

  close(): void { this.sock?.end(); this.events?.end(); this.sock = null; this.events = null; }
}
