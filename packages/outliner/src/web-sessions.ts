// Signed-in web sessions (the publisher's sign-in listener, web-signin.ts): one per browser that signed in through Clerk
// as a person allowed in. The outline host keeps them for every outline it serves (`web.sessions.*`, host actions), in
// one file in its own folder (`.host/web-sessions.json`, 0600), so a session opens every outline and `ep0ch web
// sessions` lists them wherever it runs. The secret is the browser's cookie: the file keeps its SHA-256 only, and
// nothing logs it. A session lasts WEB_SESSION_TTL_MS from its last use; `lastSeenAt` moves at most once a minute.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { WEB_SESSION_TTL_MS, type WebSession } from "@ep0ch/outline-core/protocol";

/** Sessions at once: more is a loop signing in, not a person's browsers. The oldest-used go first. */
const MAX_SESSIONS = 100;
/** How often a session's last use is written down (and its life renewed). */
const TOUCH_EVERY_MS = 60_000;
const DEVICE_MAX = 160;

interface StoredWebSession extends WebSession {
  /** SHA-256 of the cookie's token, hex. */
  digest: string;
}

const digestOf = (token: string) => createHash("sha256").update(token).digest("hex");
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** The sessions over a file (`.host/web-sessions.json`). `now` is the clock, for tests. */
export class WebSessions {
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  private load(): StoredWebSession[] {
    let raw: string;
    try { raw = readFileSync(this.file, "utf8"); } catch { return []; }
    try {
      const parsed = JSON.parse(raw) as { sessions?: StoredWebSession[] };
      const now = this.now();
      return (Array.isArray(parsed.sessions) ? parsed.sessions : [])
        .filter((s) => s && typeof s.digest === "string" && typeof s.id === "string" && Date.parse(s.expiresAt) > now);
    } catch { return []; }
  }

  private save(sessions: readonly StoredWebSession[]): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ sessions }, null, 1)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }

  /** A new session for `subject`: its token (the cookie, said once, never kept) and the session. */
  start(input: { subject: unknown; name?: unknown; device?: unknown }): { token: string; session: WebSession } {
    const subject = text(input.subject, 128);
    if (!subject) throw new Error("web.sessions.start names the subject who signed in");
    const now = this.now();
    const sessions = this.load();
    const ids = new Set(sessions.map((s) => s.id));
    let id: string;
    do id = randomBytes(4).toString("hex"); while (ids.has(id));
    const token = randomBytes(32).toString("base64url");
    const at = new Date(now).toISOString();
    const name = text(input.name, 80);
    const stored: StoredWebSession = {
      id, subject, ...(name ? { name } : {}), device: text(input.device, DEVICE_MAX) || "unknown browser",
      createdAt: at, lastSeenAt: at, expiresAt: new Date(now + WEB_SESSION_TTL_MS).toISOString(), digest: digestOf(token),
    };
    const kept = [...sessions, stored].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, MAX_SESSIONS);
    this.save(kept);
    return { token, session: wire(stored) };
  }

  /**
   * The session a cookie's token opens, renewed (its last use now, its end WEB_SESSION_TTL_MS on), or undefined. Looked
   * up by the token's digest: the token itself is never compared or kept. `renewed` says the cookie should be set again.
   */
  resolve(token: unknown): { session: WebSession; renewed: boolean } | undefined {
    if (typeof token !== "string" || token.length < 16 || token.length > 128) return undefined;
    const wanted = digestOf(token);
    const sessions = this.load();
    const found = sessions.find((s) => s.digest === wanted);
    if (!found) return undefined;
    const now = this.now();
    if (now - Date.parse(found.lastSeenAt) < TOUCH_EVERY_MS) return { session: wire(found), renewed: false };
    found.lastSeenAt = new Date(now).toISOString();
    found.expiresAt = new Date(now + WEB_SESSION_TTL_MS).toISOString();
    this.save(sessions);
    return { session: wire(found), renewed: true };
  }

  /** Every live session, the most recently used first. */
  list(): WebSession[] {
    return this.load().sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).map(wire);
  }

  /** Ends one session now; an id nobody has is refused with where the ids are. */
  revoke(id: unknown): WebSession {
    const sessions = this.load();
    const found = sessions.find((s) => s.id === id);
    if (!found) throw new Error(`no web session ${String(id)} (ep0ch web sessions lists them)`);
    this.save(sessions.filter((s) => s !== found));
    return wire(found);
  }

  /** Ends every session now (sign out everywhere); answers the ones it ended. */
  revokeAll(): WebSession[] {
    const sessions = this.load();
    this.save([]);
    return sessions.map(wire);
  }
}

const wire = ({ digest: _digest, ...session }: StoredWebSession): WebSession => session;

/** The host actions, answered from the store: what `web.sessions.*` takes and gives. */
export function answerWebSessions(store: WebSessions, request: Record<string, unknown>): unknown {
  switch (request.action) {
    case "web.sessions.start": return store.start({ subject: request.subject, name: request.name, device: request.device });
    case "web.sessions.resolve": return { found: store.resolve(request.token) ?? null };
    case "web.sessions.list": return { sessions: store.list() };
    case "web.sessions.revoke":
      if (request.all === true) return { revoked: store.revokeAll() };
      if (typeof request.sessionId !== "string" || !request.sessionId.trim()) throw new Error("name the session to end (sessionId, from ep0ch web sessions), or all: true for every one");
      return { revoked: [store.revoke(request.sessionId.trim())] };
    default: throw new Error(`Unsupported host action: ${String(request.action)}`);
  }
}

export const WEB_SESSION_ACTIONS = ["web.sessions.start", "web.sessions.resolve", "web.sessions.list", "web.sessions.revoke"] as const;
