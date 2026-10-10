// A note's comment threads as the remote MCP gateway shows them (outline_threads, and outline_read's summary): the
// door's `Comment` rows (SocketBoard.comments, the one reader of `annotations.list`) put into the words an agent reads.
// Pure: no I/O, so the tool and its tests share one shape. The writes that answer them are outline_reply and
// outline_resolve_thread (src/mcp-writes.ts).
//
// The service doesn't record whether a comment asks for an answer (PIE-551 isn't built), so no field here says so:
// whoever reads a thread decides from its last comment, which is why outline_read shows each thread's latest.
import { actorHandle, actorLabel, parseActor } from "@ep0ch/outline-core/attribution";
import type { Comment, IndexBlock } from "./socket";

/** `author` is the actor id as recorded; `by` how a person reads it (`loki (claude-code@float-2)`). */
export interface ThreadComment { id: string; author: string; by: string; at: string | null; body: string }
export interface ThreadRow {
  /** The thread's id: what outline_reply and outline_resolve_thread take. */
  thread: string;
  status: "open" | "resolved";
  /** The passage it is about, as first quoted; empty for a thread on the whole note. */
  quote: string;
  /** Whether the quote still sits in the note (false: the passage was edited away, or the thread is on the whole note). */
  anchored: boolean;
  /** The first comment, then each reply, oldest first. */
  comments: ThreadComment[];
  /** The thread's own properties (ADR 0004 contract 6), open: kind (a highlight has no comment text), tags, color. */
  properties: Record<string, string[]>;
}

const iso = (ms: number) => ms > 0 ? new Date(ms).toISOString() : null;

export function threadRows(comments: Comment[]): ThreadRow[] {
  return comments.map(t => ({
    thread: t.id,
    status: t.open ? "open" : "resolved",
    quote: t.quote,
    anchored: t.start !== null,
    comments: [{ id: t.id, author: t.author, by: actorLabel(t.author), at: iso(t.at), body: t.body }, ...t.replies.map(r => ({ id: r.id, author: r.author, by: actorLabel(r.author), at: iso(r.at), body: r.body }))],
    properties: t.props ?? {},
  }));
}

const SNIPPET = 160;

/** outline_read's compact view: how many are open, and each of the open threads' (and the latest resolved's) last comment. */
export function threadSummary(rows: ThreadRow[]) {
  const open = rows.filter(r => r.status === "open");
  const latest = (r: ThreadRow) => {
    const last = r.comments.at(-1)!;
    const body = last.body.replace(/\s+/g, " ");
    return { thread: r.thread, status: r.status, quote: r.quote.slice(0, 80), comments: r.comments.length, last: { by: last.by, at: last.at, body: body.length > SNIPPET ? `${body.slice(0, SNIPPET - 1)}…` : body } };
  };
  return { open: open.length, resolved: rows.length - open.length, latest: [...open, ...rows.filter(r => r.status === "resolved").slice(0, 1)].slice(0, 10).map(latest), said: rows.length ? "outline_threads reads every comment; outline_reply and outline_resolve_thread answer" : "no comment threads" };
}

/** A person or agent id as the filters compare it: case-folded, a gateway's `mcp:` prefix off (`mcp:daddy` is `daddy`). */
const idOf = (who: string) => actorHandle(who);
/** The same person or agent: by name (`daddy` is `mcp:daddy` and `mcp:daddy/claude.ai`), or by principal when the filter names one (`claude-code@float-2`). */
export const sameWho = (a: string, b: string) => {
  const [x, y] = [parseActor(a), parseActor(b)];
  return y.principal?.includes("@") && !y.persona ? y.principal === x.principal : idOf(a) === idOf(b);
};

/** Whether a text mentions `@name` (the @ is optional in the filter), as a word. */
export function mentions(text: string, name: string): boolean {
  const bare = name.trim().replace(/^@/, "");
  return !!bare && new RegExp(`(^|[^\\w])@${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(text);
}

export interface InboxFilter { status: "open" | "resolved" | "all"; since?: number }

/**
 * The notes that hold comment threads, from the outline's index (a thread's activity is its newest comment's creation, so `since` agrees with the thread's last comment; a thread root is a child of the note it is on, with
 * `type::annotation`, and carries its status; a reply is `annotation-reply`): note id -> the threads' latest activity,
 * newest first. This only narrows by status and time; the threads themselves are read per note (`threadRows`).
 */
export function notesWithThreads(index: IndexBlock[], filter: InboxFilter): { noteId: string; title: string; at: number }[] {
  const byId = new Map(index.map(b => [b.id, b]));
  const roots = index.filter(b => b.props.type === "annotation" && b.parentId && (filter.status === "all" || (b.props["annotation-status"] ?? "open") === filter.status));
  const activity = new Map<string, number>();
  for (const r of roots) activity.set(r.id, r.createdAt);
  for (const b of index) if (b.props.type === "annotation-reply" && activity.has(b.props["parent-annotation"] ?? "")) activity.set(b.props["parent-annotation"]!, Math.max(activity.get(b.props["parent-annotation"]!)!, b.createdAt));
  const notes = new Map<string, number>();
  for (const r of roots) {
    const at = activity.get(r.id)!;
    if (filter.since !== undefined && at < filter.since) continue;
    notes.set(r.parentId!, Math.max(notes.get(r.parentId!) ?? 0, at));
  }
  return [...notes].map(([noteId, at]) => ({ noteId, title: byId.get(noteId)?.title ?? "", at })).sort((a, b) => b.at - a.at);
}

export interface InboxQuery { lastFrom?: string; mentions?: string; since?: number; status: "open" | "resolved" | "all" }

/** The threads of one note that an inbox query keeps: by status, by who spoke last, by a mention, by activity since. */
export function inboxThreads(rows: ThreadRow[], q: InboxQuery): ThreadRow[] {
  return rows.filter(t => {
    const last = t.comments.at(-1)!;
    if (q.status !== "all" && t.status !== q.status) return false;
    if (q.lastFrom && !sameWho(last.author, q.lastFrom)) return false;
    if (q.mentions && !t.comments.some(c => mentions(c.body, q.mentions!))) return false;
    if (q.since !== undefined && !(last.at && Date.parse(last.at) >= q.since)) return false;
    return true;
  });
}
