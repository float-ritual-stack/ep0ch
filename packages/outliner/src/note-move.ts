import type { NoteMoveIntent, NoteMoveReceipt } from "@ep0ch/outline-core/protocol";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance } from "./types";
import { blockDisplayTitle } from "./references";
import { isSystemNote, systemNoteKind } from "./note-placement";

const label = (block: Block) => `((${block.id}|${blockDisplayTitle(block).slice(0, 50).replace(/[|()]/g, " ").trim()}))`;

/**
 * Where a relative move (`step`) puts a note, as the place a move names (`before`, `after` or under `to`), from its
 * siblings in order; a step it can't take is refused in the words every client says. The service's move and an agent's
 * proposed move (the CLI at propose) both read it here.
 */
export function stepPlace(block: Pick<Block, "id" | "parentId" | "text" | "properties">, siblings: readonly Pick<Block, "id">[], step: string): { before?: string; after?: string; to?: string } {
  const named = label(block as Block);
  const i = siblings.findIndex(b => b.id === block.id);
  switch (step) {
    case "up":
      if (i <= 0) throw new Error(`${named} is already first under its parent`);
      return { before: siblings[i - 1]!.id };
    case "down":
      if (i >= siblings.length - 1) throw new Error(`${named} is already last under its parent`);
      return { after: siblings[i + 1]!.id };
    case "in":
      if (i <= 0) throw new Error(`${named} has no note above it to go in under`);
      return { to: siblings[i - 1]!.id };
    case "out":
      if (block.parentId === null) throw new Error(`${named} is at the top level: there is no outer level to go out to`);
      return { after: block.parentId };
    default: throw new Error("step is up, down, in or out");
  }
}

/** Why a note isn't empty for a conditional trash (`ifEmpty`), or null: the store's trash and an agent's proposed one say it alike. */
export function notEmptyWhy(id: string, text: string, children: number): string | null {
  if (children > 0) return `Block is not empty: it has ${children} ${children === 1 ? "child" : "children"} now: ${id}`;
  if (text.trim()) return `Block is not empty: it has text now: ${id}`;
  return null;
}

/** No await between reading the intent's places and writing: every client gets the same atomic move. */
export function moveNote(store: OutlinerStore, id: string, intent: NoteMoveIntent, expectedRevision: number, mutation?: MutationProvenance): Block & NoteMoveReceipt {
  return store.database.transaction((): Block & NoteMoveReceipt => {
    const block = store.resolveBlockRef(id);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("move needs expectedRevision from the note you read");
    if (block.revision !== expectedRevision) throw new Error(`${label(block)} changed since you read it (revision ${block.revision} now, you have ${expectedRevision}): outline_read it again, and move it only if it's still the note you mean`);
    const named = (ref: string, role: string): Block => {
      const found = store.lookupBlockRef(ref);
      if (found.kind === "found") return found.block;
      if (found.kind === "trashed") throw new Error(`${found.message}: choose another parent, before or after a note outside Trash, or root`);
      const near = store.searchTree(ref.replace(/^\[\[|\]\]$|^\(\(|\)\)$/g, "")).matches.slice(0, 3);
      throw new Error(`${role} ${JSON.stringify(ref)} doesn't resolve to a note: ${found.message}.${near.length ? ` Did you mean ${near.map(m => `((${m.block.id}|${m.title}))`).join(", ")}?` : ""} outline_find finds a note by its words.`);
    };
    const given = [intent.to !== undefined || intent.parentId !== undefined, intent.before !== undefined, intent.after !== undefined, intent.step !== undefined].filter(Boolean).length;
    if (given !== 1 || (intent.to !== undefined && intent.parentId !== undefined)) throw new Error("Give exactly one of parent (under it; or root), before or after (beside a note), or a step");
    if (intent.position !== undefined && intent.to === undefined && intent.parentId === undefined) throw new Error("position goes with parent (before and after are the place already)");
    if (intent.position !== undefined && (!Number.isSafeInteger(intent.position) || intent.position < 0)) throw new Error("position counts from 0");
    let { to, parentId, before, after } = intent;
    const previous = store.children(block.parentId);
    const previousPosition = previous.findIndex(b => b.id === block.id);
    if (intent.step) ({ to, before, after } = { to, before, after, ...stepPlace(block, previous, intent.step) });
    let beside: Block | undefined;
    if (before !== undefined || after !== undefined) {
      beside = named((before ?? after)!, `The note to go ${before !== undefined ? "before" : "after"}`);
      if (beside.id === block.id) throw new Error("A note can't go beside itself; name a sibling or give parent");
      parentId = beside.parentId;
    } else if (to !== undefined) {
      if (to === "inbox") {
        const inbox = store.queryBlocks({ filters: [{ key: "system-view", value: "inbox" }], limit: 1 }).blocks[0];
        if (!inbox) throw new Error("This outline has no Inbox: choose a parent, before or after another note, or root");
        parentId = inbox.id;
      } else parentId = to === "root" ? null : named(to, "The parent").id;
    }
    const parent = parentId === null ? null : named(parentId!, "The parent");
    if (parent && isSystemNote(parent) && !parent.properties.some(p => p.key === "system-view" && ["inbox", "deploys"].includes(p.value.toLowerCase()))) {
      throw new Error(`${label(parent)} is ${systemNoteKind(parent)}, which the service fills itself: put the note under a note of the outline's, or under the Inbox, or root`);
    }
    for (let at = parent; at; at = at.parentId ? store.require(at.parentId) : null) {
      if (at.id === block.id) throw new Error(`${label(block)} can't go ${parentId === block.id ? "under itself" : "inside itself (the place is under its own descendants)"}: pick a parent outside it, or root`);
    }
    const siblings = store.children(parentId!).filter(b => b.id !== block.id);
    const position = beside ? siblings.findIndex(b => b.id === beside.id) + (after !== undefined ? 1 : 0) : Math.min(intent.position ?? siblings.length, siblings.length);
    const unchanged = parentId === block.parentId && previousPosition === position;
    const where = parent ? `under ${label(parent)}` : "at the top level";
    return { ...(unchanged ? block : store.move(block.id, parentId!, position, mutation)),
      outcome: unchanged ? "unchanged" : "applied", previousParentId: block.parentId, previousPosition,
      said: `${unchanged ? `${label(block)} is already` : `moved ${label(block)}`} ${where} at position ${position}` };
  }).immediate();
}
