// Service-owned publication reachability for clients that expose outline reads outside the door.
// It reuses the publisher's `[publish::…]` semantics instead of creating an MCP-only access model.
import { blockPublishIntent, extensionSource, publishesExtension } from "./publish";
import type { OutlinerStore } from "./store";
import type { BlockProperty, BlockReadCollection, ProjectedBlock } from "./types";

const WALK_LIMIT = 256;
const READ_FIELDS = ["parent", "properties", "revision", "author"] as const;

export type PublishReachabilityStatus = "reachable" | "unpublished" | "locked" | "missing" | "trashed";

export interface PublishReachability {
  id: string;
  status: PublishReachabilityStatus;
  /** The published block whose access makes this block visible. */
  via?: string;
  /** Whether the published entry is also visible on the public listener. */
  public?: boolean;
  /** The target block revision, when the target exists. */
  revision?: number;
  reason: string;
}

interface KnownBlock {
  id: string;
  parentId: string | null;
  properties: BlockProperty[];
  revision?: number;
  author?: string;
  actorId?: string;
}

type Known = KnownBlock | { id: string; unavailable: "missing" | "trashed" };

function knownBlock(block: ProjectedBlock): KnownBlock {
  return { id: block.id, parentId: block.parentId ?? null, properties: block.properties ?? [], ...(block.revision !== undefined ? { revision: block.revision } : {}), ...(block.author ? { author: block.author } : {}), ...(block.actorId ? { actorId: block.actorId } : {}) };
}

export function publishAccessDenied(access: PublishReachability): string | null {
  if (access.status === "reachable") return null;
  return `${access.id} is not reachable through the outline's publish access setting (${access.reason}). Add [publish::true] or [publish::public] to this block or an ancestor, unless [publish::never] locks it.`;
}

export function readPublishReachability(store: OutlinerStore, ids: readonly string[]): { reachability: PublishReachability[] } {
  const requested = [...new Set(ids.filter(id => typeof id === "string" && id.trim()))];
  const known = new Map<string, Known>();
  let frontier = requested;
  for (let depth = 0; frontier.length && depth < WALK_LIMIT; depth++) {
    const read: BlockReadCollection = store.readBlocks(frontier, [...READ_FIELDS]);
    for (const block of read.blocks) known.set(block.id, knownBlock(block));
    for (const unavailable of read.unavailable) known.set(unavailable.id, { id: unavailable.id, unavailable: unavailable.status });
    frontier = [...new Set(read.blocks
      .map(block => block.parentId)
      .filter((parentId): parentId is string => !!parentId && !known.has(parentId)))];
  }

  const one = (id: string): PublishReachability => {
    const start = known.get(id);
    if (!start) return { id, status: "locked", reason: "its ancestor chain could not be checked" };
    if ("unavailable" in start) return { id, status: start.unavailable, reason: start.unavailable };

    const chain: KnownBlock[] = [];
    let current: KnownBlock | undefined = start;
    for (let depth = 0; current && depth < WALK_LIMIT; depth++) {
      chain.push(current);
      if (!current.parentId) break;
      const parent = known.get(current.parentId);
      if (!parent) return { id, status: "locked", reason: "an ancestor could not be checked", ...(start.revision !== undefined ? { revision: start.revision } : {}) };
      if ("unavailable" in parent) break;
      current = parent;
    }

    const ordered = chain.reverse();
    let via: { id: string; public: boolean } | null = null;
    let visibleFrom = -1, viaIndex = -1;
    for (let i = 0; i < ordered.length; i++) {
      const block = ordered[i]!;
      const intent = blockPublishIntent(block.properties);
      if (intent === "never") return { id, status: "locked", reason: `${block.id} is locked by [publish::never]`, ...(start.revision !== undefined ? { revision: start.revision } : {}) };
      if (typeof intent === "object") {
        if (visibleFrom < 0) visibleFrom = i;
        via = { id: block.id, public: intent.public };
        viaIndex = i;
      } else if (intent === "off" && via) {
        via = null;
        viaIndex = -1;
        visibleFrom = -1;
      }
    }
    if (!via || visibleFrom < 0 || viaIndex < 0) return { id, status: "unpublished", reason: "no block in its ancestor chain is published", ...(start.revision !== undefined ? { revision: start.revision } : {}) };
    for (let i = viaIndex + 1; i < ordered.length; i++) {
      const block = ordered[i]!;
      const extension = extensionSource(block);
      if (extension && block.id !== via.id && !ordered.slice(visibleFrom, i + 1).some(candidate => publishesExtension(candidate.properties, extension))) {
        return { id, status: "unpublished", reason: `${extension} extension data is not published; add [publish.ext::${extension}] to this block or a published ancestor`, via: via.id, public: via.public, ...(start.revision !== undefined ? { revision: start.revision } : {}) };
      }
    }
    return { id, status: "reachable", reason: "published", via: via.id, public: via.public, ...(start.revision !== undefined ? { revision: start.revision } : {}) };
  };

  return { reachability: ids.map(one) };
}
