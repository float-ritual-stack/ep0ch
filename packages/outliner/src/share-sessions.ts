// Share sessions: short-lived public links to a note and its subtree, or to the whole outline (Evan, Oct 10: a link he
// can open as an ordinary public site, an hour by default, revocable, every active one in sight, one action to end them
// all). The service keeps them in the outline's metadata (no schema of their own); the publisher's public listener
// asks `shares.resolve` on every request, so an expiry or a revoke holds from the next request, timer or not.
//
// The secret is a 256-bit token in the link's path. It is compared in constant time, never logged, and only the
// owner's own surfaces (the CLI, the tailnet's shares page, the MCP tools) show it, inside the link.
//
// Also here: what a reader of the web client has in front of them (`reader.report` / `reader.view`), presence kept in
// memory, so an agent in chat can say "you have X selected" without fetching or navigating anything.
//
// A read-only copy of another machine's outline (outline-mirror.ts) keeps both in files beside the mirror instead
// (`fileStorage`): the gateway and the web client each serve the copy from a host of their own, and a snapshot link the
// gateway mints, or a page the web client reports, is the same session or reader to both (PIE-1091).
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { READER_VISIBLE_MAX, SHARE_TTL, SHARE_VIAS, type ReaderEvent, type ReaderView, type ShareSession, type ShareVia } from "@ep0ch/outline-core/protocol";

/** Where the sessions are kept in the metadata table. */
export const SHARES_METADATA_KEY = "share_sessions";
/** An ended session answers 410 for this long, then is forgotten (and its link is a plain 404). */
const ENDED_KEPT_MS = 7 * 24 * 60 * 60_000;
/** Active sessions at once: more is a sign of a loop, not of sharing. */
const MAX_ACTIVE = 50;

/** A session as kept: the wire's, with its token, without the link (made from the publisher's address when asked). */
interface StoredShare extends Omit<ShareSession, "url"> {
  token: string;
}

/** What the publisher learns from a token: the session, or that it ended (410), or nothing (404). */
export type ShareResolution =
  | { status: "active"; share: ShareSession }
  | { status: "ended"; state: "expired" | "revoked" }
  | { status: "unknown" };

export interface ShareStartInput {
  snapshot?: ShareSession["snapshot"];
  scope: ShareSession["scope"];
  ttlMs: number;
  comments: boolean;
  by: string;
  via?: ShareVia;
  allowMail?: string[];
  opens?: ShareSession["opens"];
}

/** `via` as asked: `edge` (the default) or `cloudflare`; anything else is refused with the choices. */
export function shareVia(value: unknown): ShareVia {
  if (value === undefined || value === null || value === "") return SHARE_VIAS[0];
  if (typeof value === "string" && (SHARE_VIAS as readonly string[]).includes(value)) return value as ShareVia;
  throw new Error(`via is ${SHARE_VIAS.join(" or ")}: ${String(value)}`);
}

/**
 * Who a Cloudflare-protected share lets in: emails (`a@example.org`) or a whole domain (`@example.org`), one or a
 * list (comma-separated too), at most 20. Anything else is refused, since it goes to cloudflared as an argument.
 */
export function shareAllowMail(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  const list = (Array.isArray(value) ? value : [value]).flatMap((item) => typeof item === "string" ? item.split(",") : [null]);
  const out = list.map((item) => item?.trim().toLowerCase() ?? "").filter((item, at, all) => item && all.indexOf(item) === at);
  const bad = out.find((item) => !/^([a-z0-9._%+-]+)?@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(item));
  if (bad !== undefined || list.some((item) => item === null)) throw new Error(`allowMail is emails (a@example.org) or domains (@example.org): ${bad ?? String(value)}`);
  if (out.length > 20) throw new Error("allowMail names at most 20 emails or domains");
  return out;
}

/**
 * How long a share lives: `90m`, `1h`, `2h30m`, `1d`, or a number of seconds; the default when left out.
 * `share` (a page, the outline or an artifact, PIE-1266): until revoked unless a time is given (`never` says so), any
 * length from a minute; `fallback` is the default where until-revoked isn't (a Cloudflare tunnel's process).
 * `bounded` (a snapshot's download, a lease): a minute to a day, an hour when left out, and always ends by itself.
 */
export function shareTtlMs(value: unknown, kind: "share" | "bounded" = "bounded", fallback?: number): number {
  const longest = kind === "share" ? SHARE_TTL.neverMs : SHARE_TTL.maxMs;
  if (value === undefined || value === null || value === "") return kind === "share" ? fallback ?? SHARE_TTL.neverMs : SHARE_TTL.defaultMs;
  if (value === "never") {
    if (kind !== "share") throw new Error(`ttl is from 1m to 24h: ${String(value)}`);
    return SHARE_TTL.neverMs;
  }
  let ms: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) ms = Math.round(value * 1000);
  else if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (/^\d+$/.test(text)) ms = Number(text) * 1000;
    else if (/^(\d+(?:\.\d+)?\s*[smhd]\s*)+$/.test(text)) {
      const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
      ms = [...text.matchAll(/(\d+(?:\.\d+)?)\s*([smhd])/g)].reduce((sum, [, n, u]) => sum + Number(n) * unit[u as keyof typeof unit], 0);
    }
  }
  if (ms === undefined) throw new Error(`ttl is a duration such as 30m, 1h or 2h30m (or seconds): ${String(value)}`);
  if (ms < SHARE_TTL.minMs || ms > longest) throw new Error(kind === "share" ? `ttl is never (until revoked) or 1m and longer, such as 30m, 4h or 7d: ${String(value)}` : `ttl is from 1m to 24h: ${String(value)}`);
  return Math.round(ms);
}

/** What sessions or presence are kept in. */
export interface ShareStorage { read(): string | undefined; write(value: string): void }

/** One file as the storage (written whole, by rename, so a reader in another process never sees half of it). */
export function fileStorage(path: string): ShareStorage {
  return {
    read() { try { return readFileSync(path, "utf8"); } catch { return undefined; } },
    write(value) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, value, { mode: 0o600 });
      renameSync(temporary, path);
    },
  };
}

const digest = (token: string) => createHash("sha256").update(token).digest();

/** Share sessions over the outline's metadata (`read`/`write` the one key). `now` is the clock, for tests. */
export class ShareSessions {
  constructor(
    private readonly storage: ShareStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): StoredShare[] {
    const raw = this.storage.read();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { sessions?: StoredShare[] };
      return Array.isArray(parsed.sessions) ? parsed.sessions.filter((s) => s && typeof s.token === "string" && typeof s.id === "string") : [];
    } catch {
      return [];
    }
  }

  /** Each session's state as of now (an active one past its time is expired), the long-ended ones dropped. */
  private current(): StoredShare[] {
    const now = this.now();
    return this.load().map((session) => session.state === "active" && Date.parse(session.expiresAt) <= now ? { ...session, state: "expired" as const } : session)
      .filter((session) => session.state === "active" || (session.snapshot && !session.snapshot.removed) || now - Date.parse(session.revokedAt ?? session.expiresAt) < ENDED_KEPT_MS);
  }

  private save(sessions: readonly StoredShare[]): void {
    this.storage.write(JSON.stringify({ sessions }));
  }

  start(input: ShareStartInput): StoredShare {
    const sessions = this.current();
    if (sessions.filter((session) => session.state === "active").length >= MAX_ACTIVE) {
      throw new Error(`${MAX_ACTIVE} shares are open already: end some first (ep0ch share list, ep0ch share revoke --all)`);
    }
    const now = this.now();
    const ids = new Set(sessions.map((session) => session.id));
    let id: string;
    do id = randomBytes(4).toString("hex"); while (ids.has(id));
    const session: StoredShare = {
      ...(input.snapshot ? { snapshot: input.snapshot } : {}),
      id, token: randomBytes(32).toString("base64url"), scope: input.scope, comments: input.comments,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + input.ttlMs).toISOString(), state: "active", by: input.by,
      via: input.via ?? "edge",
      ...(input.opens ? { opens: input.opens } : {}),
      ...(input.via === "cloudflare" ? { tunnel: { state: "starting" as const }, ...(input.allowMail?.length ? { allowMail: input.allowMail } : {}) } : {}),
    };
    this.save([...sessions, session]);
    return session;
  }

  /** The active sessions, soonest to end first; with `all`, the recently ended ones too. */
  list(all = false): StoredShare[] {
    return this.current().filter((session) => all || session.state === "active")
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  /** Ends one session now. An ended one stays ended; an id nobody has is refused with where the ids are. */
  revoke(id: string): StoredShare {
    const sessions = this.current();
    const at = sessions.findIndex((session) => session.id === id);
    if (at < 0) throw new Error(`no share ${id} (ep0ch share list shows the open ones)`);
    const session = sessions[at]!;
    if (session.state !== "active") return session;
    const ended = { ...session, state: "revoked" as const, revokedAt: new Date(this.now()).toISOString() };
    sessions[at] = ended;
    this.save(sessions);
    return ended;
  }

  /**
   * What the publisher running a `cloudflare` share's tunnel reported: up on its host, or failed (the share ends, so its
   * token opens nothing anywhere). Undefined for a session nobody has.
   */
  setTunnel(id: string, tunnel: NonNullable<ShareSession["tunnel"]>): StoredShare | undefined {
    const sessions = this.current();
    const at = sessions.findIndex((session) => session.id === id && session.via === "cloudflare");
    if (at < 0) return undefined;
    const failed = tunnel.state === "failed" && sessions[at]!.state === "active";
    sessions[at] = { ...sessions[at]!, tunnel, ...(failed ? { state: "revoked" as const, revokedAt: new Date(this.now()).toISOString() } : {}) };
    this.save(sessions);
    return sessions[at];
  }

  snapshotRemoved(id: string): void {
    this.save(this.current().map(session => session.id === id && session.snapshot ? { ...session, snapshot: { ...session.snapshot, removed: true } } : session));
  }

  /** Ends every active session now; answers the ones it ended. */
  revokeAll(): StoredShare[] {
    const at = new Date(this.now()).toISOString();
    const ended: StoredShare[] = [];
    const sessions = this.current().map((session) => {
      if (session.state !== "active") return session;
      const revoked = { ...session, state: "revoked" as const, revokedAt: at };
      ended.push(revoked);
      return revoked;
    });
    this.save(sessions);
    return ended;
  }

  /**
   * The session a link's token opens, compared in constant time against every kept session (their digests, so every
   * comparison is the same length and a near miss takes as long as a far one).
   */
  resolve(token: string): StoredShare | undefined {
    if (typeof token !== "string" || token.length < 16 || token.length > 128) return undefined;
    const wanted = digest(token);
    let found: StoredShare | undefined;
    for (const session of this.current()) if (timingSafeEqual(digest(session.token), wanted)) found ??= session;
    return found;
  }
}

/**
 * A kept session as the wire shows it: without its token, with its link when it has a host: the public listener's
 * origin for `edge` (when the publisher said it), the tunnel's once it is up for `cloudflare`.
 */
export function shareOnWire(session: StoredShare, publicUrl: string | undefined): ShareSession {
  const { token, ...rest } = session;
  // Sessions kept before there were two ways are the edge's.
  const via = rest.via ?? "edge";
  const origin = rest.snapshot?.base ?? (via === "cloudflare" ? (rest.tunnel?.state === "up" && rest.tunnel.host ? `https://${rest.tunnel.host}` : undefined) : publicUrl ? new URL(publicUrl).origin : undefined);
  return { ...rest, via, ...(origin ? { url: `${shareUrl(origin, token)}${rest.snapshot ? "snapshot.sqlite" : rest.opens ? `p/${rest.opens.blockId}` : ""}` } : {}) };
}

/** A share's link: `/s/<token>/` at the root of its host (`https://pie.ep0ch.sh/s/<token>/`); no proxy route is added per share. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${token}/`;
}

/** At most this many characters of a selection are kept, and of the text either side. */
export const READER_SELECTION_MAX = 2000;
const READER_CONTEXT_MAX = 200;
/** A reader not heard from for this long is no longer reading. */
const READER_STALE_MS = 12 * 60 * 60_000;

/** A stop on a web reader's trail (PIE-208): a note its tab opened, by the title it had then, and when. */
export interface ReaderStop { blockId: string; title: string; at: string }

/** At most this many of what readers did are kept (the journal), newest last. */
export const READER_JOURNAL_MAX = 200;

/**
 * What each reader of the web client has in front of them, as their pages last said, and what they did lately (the
 * journal: pages opened, words selected, folds opened or closed): in memory only. Pages and selections are read off
 * the reports themselves, so a page says only where it is and what's selected; a fold it says (`fold`).
 */
export class ReaderPresence {
  private readers = new Map<string, ReaderView>();
  /** Each visitor's last report (a share's reader is everyone with its link), to say what changed for them. */
  private last = new Map<string, ReaderView>();
  private events: (ReaderEvent & { visitor: string })[] = [];
  private next = 1;

  /** `storage`: kept there as well as in memory, read again before each answer (a copy's, shared by two processes). */
  constructor(private readonly now: () => number = Date.now, private readonly storage?: ShareStorage) {}

  /** What the storage holds now, when there is one. */
  private load(): void {
    const raw = this.storage?.read();
    if (!raw) return;
    try {
      const kept = JSON.parse(raw) as { readers: [string, ReaderView][]; last: [string, ReaderView][]; events: (ReaderEvent & { visitor: string })[]; next: number };
      this.readers = new Map(kept.readers);
      this.last = new Map(kept.last);
      this.events = kept.events;
      this.next = kept.next;
    } catch { /* an unreadable file is no presence */ }
  }

  private save(): void {
    this.storage?.write(JSON.stringify({ readers: [...this.readers], last: [...this.last], events: this.events, next: this.next }));
  }

  /**
   * A page's report, capped and trimmed; the newest one per reader is kept, and what changed for its `visitor` (one
   * browser tab, a random id the page keeps) goes in the journal. Answers the view and the journal the page may see:
   * the tailnet's (the person's own), or on a share only this visitor's, since anyone with the link reads as the share.
   */
  report(input: Record<string, unknown>): { view: ReaderView; journal: ReaderEvent[]; trail: ReaderStop[] } {
    this.load();
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
    const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined);
    const reader = text(input.reader, 64);
    if (!/^(tailnet|share:[0-9a-f]{8})$/.test(reader)) throw new Error("reader is tailnet or share:<id>");
    const selection = input.selection && typeof input.selection === "object" ? input.selection as Record<string, unknown> : undefined;
    const selected = selection ? text(selection.text, 100_000) : "";
    const offsets = selection?.offsets && typeof selection.offsets === "object" ? selection.offsets as Record<string, unknown> : undefined;
    const [start, end, revision] = [count(offsets?.start), count(offsets?.end), count(selection?.revision)];
    const visible = Array.isArray(input.visible)
      ? input.visible.filter((id): id is string => typeof id === "string" && !!id).slice(0, READER_VISIBLE_MAX).map((id) => id.slice(0, 64))
      : undefined;
    const scroll = input.scroll && typeof input.scroll === "object" ? input.scroll as Record<string, unknown> : undefined;
    const [y, max] = [count(scroll?.y), count(scroll?.max)];
    const view: ReaderView = {
      reader,
      ...(typeof input.blockId === "string" && input.blockId ? { blockId: input.blockId.slice(0, 64) } : {}),
      title: text(input.title, 300),
      url: text(input.url, 2000),
      ...(selected.trim() ? { selection: {
        text: selected.slice(0, READER_SELECTION_MAX),
        before: text(selection!.before, 100_000).slice(-READER_CONTEXT_MAX),
        after: text(selection!.after, READER_CONTEXT_MAX),
        ...(typeof selection!.blockId === "string" && selection!.blockId ? { blockId: selection!.blockId.slice(0, 64) } : {}),
        ...(start !== undefined && end !== undefined && end > start ? { offsets: { start, end } } : {}),
        ...(revision !== undefined ? { revision } : {}),
        ...(selected.length > READER_SELECTION_MAX ? { truncated: true } : {}),
      } } : {}),
      ...(visible ? { visible } : {}),
      ...(y !== undefined && max !== undefined ? { scroll: { y: Math.min(y, max), max } } : {}),
      at: new Date(this.now()).toISOString(),
    };
    const visitor = /^[A-Za-z0-9-]{8,64}$/.test(text(input.visitor, 64)) ? text(input.visitor, 64) : "";
    const key = `${reader} ${visitor}`;
    const before = this.last.get(key);
    if (!before || before.url !== view.url || before.blockId !== view.blockId) {
      this.log({ reader, visitor, kind: "page", ...(view.blockId ? { blockId: view.blockId } : {}), title: view.title, url: view.url });
    }
    if (view.selection && view.selection.text !== before?.selection?.text) {
      this.log({ reader, visitor, kind: "selection", ...(view.selection.blockId ? { blockId: view.selection.blockId } : {}), text: view.selection.text });
    }
    const fold = input.fold && typeof input.fold === "object" ? input.fold as Record<string, unknown> : undefined;
    if (fold && typeof fold.blockId === "string" && fold.blockId) {
      this.log({ reader, visitor, kind: "fold", blockId: fold.blockId.slice(0, 64), open: fold.open === true });
    }
    this.readers.set(reader, view);
    this.last.delete(key);
    this.last.set(key, view);
    if (this.last.size > READER_JOURNAL_MAX) this.last.delete(this.last.keys().next().value!);
    this.save();
    return { view, journal: this.journal(reader, 0, reader === "tailnet" ? undefined : visitor), trail: this.trail(reader, visitor) };
  }

  /**
   * The notes one tab (`visitor`) opened, newest first, each once at its latest visit (PIE-208): the trail its page
   * lists, read from the journal's page events, so it is as long as the journal still holds them.
   */
  trail(reader: string, visitor: string): ReaderStop[] {
    const out: ReaderStop[] = [], seen = new Set<string>();
    for (let at = this.events.length - 1; at >= 0; at -= 1) {
      const event = this.events[at]!;
      if (event.kind !== "page" || event.reader !== reader || event.visitor !== visitor || !event.blockId || seen.has(event.blockId)) continue;
      seen.add(event.blockId);
      out.push({ blockId: event.blockId, title: event.title ?? "", at: event.at });
    }
    return out;
  }

  /** The reader seen most recently (or `reader`'s), every reader seen lately (newest first), and its journal. */
  view(reader?: string, since = 0): { view: ReaderView | null; readers: ReaderView[]; journal: ReaderEvent[] } {
    this.load();
    const now = this.now();
    for (const [key, value] of this.readers) if (now - Date.parse(value.at) > READER_STALE_MS) this.readers.delete(key);
    const readers = [...this.readers.values()].sort((a, b) => b.at.localeCompare(a.at));
    const view = (reader ? this.readers.get(reader) : readers[0]) ?? null;
    return { view, readers, journal: view ? this.journal(view.reader, since) : [] };
  }

  /** What `reader` (or only its `visitor`) did after event `since`, oldest first. */
  journal(reader: string, since = 0, visitor?: string): ReaderEvent[] {
    return this.events
      .filter((event) => event.reader === reader && event.n > since && (visitor === undefined || event.visitor === visitor))
      .map(({ visitor: _, ...event }) => event);
  }

  private log(event: Omit<ReaderEvent, "n" | "at"> & { visitor: string }): void {
    this.events.push({ n: this.next++, at: new Date(this.now()).toISOString(), ...event });
    if (this.events.length > READER_JOURNAL_MAX) this.events.splice(0, this.events.length - READER_JOURNAL_MAX);
  }

  /** A reader that's gone (its share ended): forgotten. */
  forget(reader: string): void {
    this.load();
    this.readers.delete(reader);
    for (let at = this.events.length - 1; at >= 0; at -= 1) if (this.events[at]!.reader === reader) this.events.splice(at, 1);
    for (const key of this.last.keys()) if (key.startsWith(`${reader} `)) this.last.delete(key);
    this.save();
  }
}
