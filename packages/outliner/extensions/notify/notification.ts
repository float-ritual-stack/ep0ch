// Pure parts of the notifications hub: the shape every source returns, and how one becomes a note. No I/O.

/** What a source returns for each notification: the same shape for GitHub, Gmail, Jira, Slack and any other. */
export interface Notification {
  /** The source's own id, unique within the source (GitHub's thread id, a Gmail message id, a Jira issue key + event). */
  readonly id: string;
  readonly source: string;
  /** What it is, in the source's words: PullRequest, Mention, Thread, Comment. */
  readonly kind: string;
  /** Who or where it is from: a repository, a sender, a channel. */
  readonly from: string;
  readonly title: string;
  readonly url?: string;
  /** Unread at the source right now. */
  readonly unread: boolean;
  /** ISO time the source says it last changed. */
  readonly received: string;
  /** A few words of detail, optional. */
  readonly snippet?: string;
}

/** A source: given its settings and the time of its last pull, the notifications changed since. */
export interface Source {
  fetch(options: { since: string; days: number }): Promise<Notification[]>;
}

export const KEY = "notify.key";
export const STATE = "notify.state";
/**
 * Every notification is stamped as machinery of its own kind (outline-core `machinery.ts`, PIE-1427): a reader's list
 * and a chat's "what changed lately" leave fetched notifications out unless asked (`machinery: show`, or `only` with
 * `machine=notification`), and the boards here say `[machinery::show]`.
 */
export const STAMP = "[machine::notification]";

/** Imported words stay words: no `[key::value]`, no `[[page]]`, no `((ref))`, no leading `word::` handler line. */
export const inert = (text: string): string => text.replace(/\r/g, "").replace(/\s*\n\s*/g, " ").trim()
  .replace(/\[(?=[A-Za-z][\w.-]*::)/g, "\\[").replace(/\[(?=\[)/g, "[\\").replace(/\((?=\()/g, "(\\")
  .replace(/^(\s*(?:[-*]\s+)?[A-Za-z][\w.-]*)::/, "$1\\::");

/** A property value can't hold `]` or a newline. */
const value = (text: string): string => text.replace(/[\]\r\n]+/g, " ").trim();

export const keyOf = (n: Pick<Notification, "source" | "id">): string => `${n.source}:${n.id}`;

/**
 * The note for a notification. `state` is what the note says now: a person's `read` is kept, and a notification
 * unread at the source arrives unread.
 */
export function noteText(n: Notification, state: "unread" | "read"): string {
  const tokens = [
    [KEY, keyOf(n)], ["notify.source", n.source], ["notify.kind", n.kind], ["notify.from", n.from],
    [STATE, state], ["notify.received", n.received], ...(n.url ? [["notify.url", n.url]] : []),
  ].map(([k, v]) => `[${k}::${value(v!)}]`).join(" ");
  return `${inert(n.title)} ${tokens} ${STAMP}${n.snippet ? `\n\n${inert(n.snippet)}` : ""}`;
}

/** A note as the service returns it: its text and its block-scope properties, every occurrence (never a first-line scan). */
export interface Existing { text: string; properties?: readonly { key: string; value: string }[] }
/** The first value of a property on a note, from the service's own parse. */
export const valueOf = (note: Pick<Existing, "properties">, key: string): string | undefined => note.properties?.find((p) => p.key === key)?.value;

/**
 * What a pull writes for a notification that may already be a note. Read never goes back to unread: a person who
 * marked it read (or moved its card) keeps that, whatever the source says later. Unread at the source becomes read
 * here only when the source says it was read.
 */
export function merged(n: Notification, current?: Existing): string {
  if (!current) return noteText(n, n.unread ? "unread" : "read");
  const was = valueOf(current, STATE) === "read" ? "read" : "unread";
  const [first = "", ...rest] = current.text.split("\n");
  // The extension owns the title, the notify.* tokens and the machine stamp of the first line; anything a person added there (their own
  // properties) and every line after it stay as they are.
  const mine = noteText(n, was === "read" || !n.unread ? "read" : "unread").split("\n")[0]!;
  const theirs = [...first.slice(Math.max(0, first.indexOf(`[${KEY}::`))).matchAll(/\s?\[(?!notify\.|machine::)[A-Za-z][\w.-]*::[^\]\n]*\]/g)].map((m) => m[0].trim());
  return [theirs.length ? `${mine} ${theirs.join(" ")}` : mine, ...rest].join("\n");
}

