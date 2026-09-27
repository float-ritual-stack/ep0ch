// Read-only Board over the outliner's JSON-lines socket (protocol 80).
// Only actions from the service's safe-read list are sent; nothing here mutates.
import { connect, type Socket } from "node:net";
import type { Board, BoardInfo, Caller, Msg } from "./board";

export const DEFAULT_SOCKET = process.env.EP0CH_SOCKET ?? `${process.env.HOME}/.local/state/pi-herdr-outliner/float-box.sock`;
const PROTOCOL = 80;

interface WireBlock {
  id: string; parentId: string | null; text: string; author: string; actorId?: string;
  createdAt: string; updatedAt: string; deletedAt?: string; effectiveDeletedRootId?: string;
  properties?: { key: string; value: string }[];
}

export interface Activity { cursor: number; block: Msg; author: string; actor: string; kind: string; at: number }
export interface Comment {
  id: string; author: string; body: string; quote: string; at: number; open: boolean;
  replies: { author: string; body: string; at: number }[];
}
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
});

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

  async info(): Promise<BoardInfo> {
    const r = await this.request<{ protocolVersion: number; location: { hostname: string; workspaceRoot: string } }>("ping");
    if (r.protocolVersion !== PROTOCOL) throw new Error(`outline speaks protocol ${r.protocolVersion}; this door was written for ${PROTOCOL}`);
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
