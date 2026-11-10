// Which kind of refusal the outline host (or the door's control socket) is answering with. It travels on the wire
// as `kind` beside the words (`OutlinerResponse`, `ActionRefused`), so a client decides what to do next from the
// kind and never from the message: a reworded message can't break a retry. Both sides import this; nobody restates it.

/**
 * Every kind of refusal, closed. A throw site names the one that fits; a refusal nobody classified is `failed`.
 * - `stale-revision`: the note changed since the writer read it (a revision or "changed since" check); read again.
 * - `moved`: a step or position the writer addressed is no longer where it was; look it up again.
 * - `conflict`: the target is in a state that won't take this (a block that is not empty, a patch the text won't accept).
 * - `not-found`: the note, quote or destination named isn't there (any more).
 * - `ambiguous`: more than one thing matches what was named.
 * - `busy`: the host didn't answer in time or its store is locked; try again, it wrote nothing.
 * - `no-access`: this outline, copy or level takes no such write.
 * - `invalid`: the request itself is wrong (a query that doesn't parse, an argument that isn't one).
 * - `unavailable`: something the request needs (a machine, a provider, a person's door) isn't reachable.
 * - `failed`: refused, and nobody said why in a kind.
 */
export const REFUSAL_KINDS = ["stale-revision", "moved", "conflict", "not-found", "ambiguous", "busy", "no-access", "invalid", "unavailable", "failed"] as const;
export type RefusalKind = (typeof REFUSAL_KINDS)[number];

export const isRefusalKind = (value: unknown): value is RefusalKind => typeof value === "string" && (REFUSAL_KINDS as readonly string[]).includes(value);

/** An error that knows its kind: what the throw sites that clients act on throw. */
export class Refusal extends Error {
  constructor(readonly kind: RefusalKind, message: string) { super(message); this.name = "Refusal"; }
}

/** The kind an error carries, else `failed`: the one read every envelope and every client makes. */
export function refusalKindOf(error: unknown): RefusalKind {
  const kind = typeof error === "object" && error !== null ? (error as { kind?: unknown }).kind : undefined;
  return isRefusalKind(kind) ? kind : "failed";
}

/** The refusal for a note that isn't there: one spelling for every place that says it. */
export const blockNotFound = (id: string, where = ""): Refusal => new Refusal("not-found", `Block not found${where}: ${id}`);

/**
 * What a CLI prints for a refusal: its words on an `error: ` line (or `prefix`), and, when the error knows its kind, a
 * `kind: <kind>` line after it. The line is the stable form: a script or the Claude mod reads `refusalKindOfStderr`,
 * never the words, and a command that fails for any other reason prints the words alone.
 */
export function errorLines(error: unknown, prefix = "error: "): string {
  const words = `${prefix}${error instanceof Error ? error.message : String(error)}`;
  const kind = typeof error === "object" && error !== null ? (error as { kind?: unknown }).kind : undefined;
  return isRefusalKind(kind) ? `${words}\nkind: ${kind}` : words;
}

/** The kind a CLI's stderr names in its `kind: <kind>` line (the last one), or undefined when it names none. */
export function refusalKindOfStderr(stderr: string): RefusalKind | undefined {
  const found = stderr.split("\n").map(line => /^kind: ([a-z-]+)$/.exec(line.trim())?.[1]).filter(Boolean).at(-1);
  return isRefusalKind(found) ? found : undefined;
}
