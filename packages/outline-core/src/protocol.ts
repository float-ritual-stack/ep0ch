// The wire contract between the outline service (packages/outliner) and its clients (the door, Tree, Detail,
// the CLI, the Claude mod). Both sides import this file; neither restates it. It does no I/O.
//
// PROTOCOL is the one compatibility check: `ping` reports the service's number and a client refuses a service
// whose number differs from its own. Bump it with any change to the wire (an action, a field, a meaning) and
// with any change to what outline-core's shared modules match or compute (the property grammar, the
// draft.patch compare, the search matcher), since a long-running service and a remote door can run different
// checkouts.

/** The wire protocol both sides of this checkout speak. */
export const PROTOCOL = 83;

/**
 * Why a service speaking `serviceProtocol` can't serve this client, in words that name both numbers and the side
 * to update; undefined when they agree. `client` is what this side is called ("this door", "this Detail").
 */
export function protocolMismatch(serviceProtocol: unknown, client = "this client"): string | undefined {
  if (serviceProtocol === PROTOCOL) return undefined;
  const theirs = typeof serviceProtocol === "number" ? `protocol ${serviceProtocol}` : "no protocol it reports";
  if (typeof serviceProtocol === "number" && serviceProtocol > PROTOCOL) {
    return `${client} speaks protocol ${PROTOCOL} and the outline host ${theirs}: update ${client.replace(/^this /, "the ")} (ep0ch install --apply) and restart it`;
  }
  return `${client} speaks protocol ${PROTOCOL} and the outline host ${theirs}: restart the outline host on current code (ep0ch install --apply updates and restarts it)`;
}

/** An outline's name: a short slug of lowercase letters, digits and hyphens. The name is how an outline is found. */
export const OUTLINE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export type BlockAuthor = "user" | "agent" | "system";

export interface BlockProperty {
  key: string;
  value: string;
}

/** A block as the service sends it whole. Projected reads (`fields`) send a subset. */
export interface Block {
  id: string;
  parentId: string | null;
  position: number;
  text: string;
  revision: number;
  author: BlockAuthor;
  actorId?: string;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  effectiveDeletedRootId?: string;
  properties: BlockProperty[];
}

/** A query the service refused, with where. */
export interface OutlinerRequestProblem {
  code: "query-syntax" | "query-invalid";
  message: string;
  /** Query field that failed, such as expression. */
  field?: string;
  /** 0-based character position within that field's text. */
  position?: number;
}

/** One answer line on the socket. */
export type OutlinerResponse =
  | { id: string; ok: true; result: unknown; sequence: number }
  | { id: string; ok: false; error: string; problem?: OutlinerRequestProblem; sequence: number };
