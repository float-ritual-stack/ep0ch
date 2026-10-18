import type { NoteMoveIntent, NoteMoveReceipt } from "@ep0ch/outline-core/protocol";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance } from "./types";
import { blockDisplayTitle } from "./references";
import { isSystemNote, systemNoteKind } from "./note-placement";

const label = (block: Block) => `((${block.id}|${blockDisplayTitle(block).slice(0, 50).replace(/[|()]/g, " ").trim()}))`;

/** No await between reading the intent's places and writing: every client gets the same atomic move. */
export function moveNote(store: OutlinerStore, id: string, intent: NoteMoveIntent, expectedRevision: number, mutation?: MutationProvenance): Block & NoteMoveReceipt {
  return store.database.transaction((): Block & NoteMoveReceipt => {
    const block = store.resolveBlockRef(id);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("move needs expectedRevision from the note you read");
    if (block.revision !== expectedRevision) throw new Error(`${label(block)} changed since you read it (revision ${block.revision} now, you have ${expectedRevision}): outline_read it again, and move it only if it's still the note you mean`);
    const named = (ref: string, role: string): Block => {
      const found = store.lookupBlockRef(ref);
      if (found.kind === "found") return found.block;
      if (found.kind === "trashed") throw new Error(found.message);
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
    if (intent.step) {
      const i = previousPosition;
      switch (intent.step) {
        case "up":
          if (i <= 0) throw new Error(`${label(block)} is already first under its parent`);
          before = previous[i - 1]!.id; break;
        case "down":
          if (i >= previous.length - 1) throw new Error(`${label(block)} is already last under its parent`);
          after = previous[i + 1]!.id; break;
        case "in":
          if (i <= 0) throw new Error(`${label(block)} has no note above it to go in under`);
          to = previous[i - 1]!.id; break;
        case "out":
          if (block.parentId === null) throw new Error(`${label(block)} is at the top level: there is no outer level to go out to`);
          after = block.parentId; break;
        default: throw new Error("step is up, down, in or out");
      }
    }
    let beside: Block | undefined;
    if (before !== undefined || after !== undefined) {
      beside = named((before ?? after)!, `The note to go ${before !== undefined ? "before" : "after"}`);
      if (beside.id === block.id) throw new Error("A note can't go beside itself; name a sibling or give parent");
      parentId = beside.parentId;
    } else if (to !== undefined) {
      parentId = to === "root" ? null : to === "inbox" ? store.queryBlocks({ filters: [{ key: "system-view", value: "inbox" }], limit: 1 }).blocks[0]!.id : named(to, "The parent").id;
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
