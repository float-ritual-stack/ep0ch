/**
 * An extension action's returned writes as one group (PIE-784): what it makes, edits, moves and puts in order, all
 * in one transaction or none of it, attributed `ext:<id>` with who asked beside it, each one revision-checked.
 *
 * - A block it makes may be named (`create … as: "c1"`) and the group's later writes refer to it by that name: as a
 *   `parentId`, `blockId` or child of an `order`, and in text as `((c1))`, `!((c1))`, `((c1|label))` or `((c1^anchor))`
 *   (the demo notes' rewrite). Its id is minted before anything is written, so every write knows it.
 * - Updates are agents' edits: the `edit` policy's guard, through the draft-patch router. A group of updates alone goes
 *   where any patch goes (a door's live draft gets it). A group that also makes, moves or orders blocks goes through
 *   `patchGroup`: a door holding a live draft of any block it edits, moves or reorders makes the whole group one
 *   proposal beside the note it acted on.
 * - What landed is kept as an undo step (`undo`, the door's ctrl+z and `ext.undo`), the last 100 since the host
 *   started: undone whole, and only while nothing it touched changed since.
 */
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { requestLines } from "./agent-requests";
import { DRAFT_PROPOSAL_TYPE, type DraftGroup, type DraftGroupWrite, type DraftPatchApplied, type DraftPatchInput, type DraftPatchResult } from "./draft-patch";
import type { DraftGroupInput } from "./draft-patch-router";
import { namesDemoIds, rewriteDemoReferences } from "./extension-demo";
import { cleanExtensionText, extensionActorId, inertBlockdown } from "./extension-records";
import type { OutlinerStore } from "./store";
import type { MutationProvenance } from "./types";

export type ExtensionWrite =
  | { readonly op: "create"; readonly parentId: string; readonly text: string; readonly as?: string; readonly position?: number }
  | { readonly op: "update"; readonly blockId: string; readonly expectedRevision: number; readonly text: string }
  | { readonly op: "move"; readonly blockId: string; readonly parentId: string; readonly position?: number; readonly expectedRevision: number }
  /** A block's children in this order, in one step: exactly the children it has (a name made in the group among them). */
  | { readonly op: "order"; readonly parentId: string; readonly children: readonly string[] }
  /**
   * An annotation on the passage the action acts on (`on: passage`): a comment with `body`, a highlight without, with
   * its own properties (`kind`, `tags`, `color` as a theme tone, any other).
   */
  | { readonly op: "annotate"; readonly body: string; readonly properties?: Readonly<Record<string, string | readonly string[]>> };

/** A write to a block (not an annotation). */
export type BlockWrite = Exclude<ExtensionWrite, { op: "annotate" }>;

export const MAX_WRITES = 20;
export const MAX_WRITE_TEXT = 64 * 1024;
const MAX_ORDER = 500;
const LOCAL_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_UNDO = 100;

/** A draft proposal waiting under a block (src/draft-patch.ts): beside its note, not one of its children to order. */
const isProposal = (block: { properties: readonly { key: string; value: string }[] }) =>
  block.properties.some((property) => property.key === "type" && property.value === DRAFT_PROPOSAL_TYPE);

const SHAPES = `{ op: "create", parentId, text, as?, position? }, { op: "update", blockId, expectedRevision, text }, { op: "move", blockId, parentId, position?, expectedRevision }, { op: "order", parentId, children }`;

/** One block write of an action's answer, its shape checked (`writes[index]`); what it names is checked when applied. */
export function parseBlockWrite(write: Record<string, unknown>, index: number): BlockWrite {
  const at = `writes[${index}]`;
  const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 64;
  const position = write.position;
  if (position !== undefined && (!Number.isSafeInteger(position) || (position as number) < 0)) throw new Error(`${at}.position must be a whole number from 0`);
  if (write.op === "create" || write.op === "update") {
    if (typeof write.text !== "string" || Buffer.byteLength(write.text) > MAX_WRITE_TEXT) throw new Error(`${at}.text must be text up to 64 KiB`);
  }
  if (write.op === "create" && id(write.parentId)) {
    if (write.as !== undefined && (typeof write.as !== "string" || !LOCAL_NAME.test(write.as))) throw new Error(`${at}.as must be a short name (a-z, digits, - and _), such as c1`);
    return { op: "create", parentId: write.parentId as string, text: write.text as string, ...(write.as !== undefined ? { as: write.as as string } : {}), ...(position !== undefined ? { position: position as number } : {}) };
  }
  if (write.op === "update" && id(write.blockId) && Number.isSafeInteger(write.expectedRevision)) {
    return { op: "update", blockId: write.blockId as string, expectedRevision: write.expectedRevision as number, text: write.text as string };
  }
  if (write.op === "move" && id(write.blockId) && id(write.parentId) && Number.isSafeInteger(write.expectedRevision)) {
    return { op: "move", blockId: write.blockId as string, parentId: write.parentId as string, expectedRevision: write.expectedRevision as number, ...(position !== undefined ? { position: position as number } : {}) };
  }
  if (write.op === "order" && id(write.parentId)) {
    if (!Array.isArray(write.children) || !write.children.length || write.children.length > MAX_ORDER || !write.children.every(id)) {
      throw new Error(`${at}.children must list the block's children by id (or a name made in this answer), at most ${MAX_ORDER}`);
    }
    return { op: "order", parentId: write.parentId as string, children: write.children as string[] };
  }
  throw new Error(`${at} must be ${SHAPES}, or (on a passage) { op: "annotate", body?, properties? }`);
}

/** What undoing a group puts back, in the order it was written (undone last first). */
type UndoStep =
  | { kind: "create"; blockId: string; revision: number }
  | { kind: "update"; blockId: string; before: string; revision: number }
  | { kind: "move"; blockId: string; fromParent: string | null; fromPosition: number; toParent: string }
  | { kind: "order"; parentId: string; before: string[]; after: string[] };

/**
 * A group that landed: its steps, and the outline as the group left it (each block's revision, each parent's
 * children in order), which undo finds again or refuses.
 */
interface Receipt { id: string; extension: string; action: string; steps: UndoStep[]; revisions: Map<string, number>; children: Map<string, string[]> }

/** What an applied group answers: the blocks it wrote, or the proposal it waits as; `undo` names the step that undoes it. */
export interface GroupOutcome {
  written: string[];
  proposalId?: string;
  proposed?: string;
  undo?: string;
  /** Why it can't be undone as one step here (a part went into a door's live draft, which undoes it itself). */
  undoNote?: string;
}

export interface ExtensionWritesDeps {
  /** An update: where an `@agent`'s edit goes (draft.patch, the edit policy). */
  patch?: (input: DraftPatchInput) => Promise<DraftPatchResult>;
  /** A group that also makes, moves or orders blocks (the router's `patchGroup`). */
  patchGroup?: (input: DraftGroupInput) => Promise<DraftPatchResult>;
  /** Whether a door holds a live draft of the block. */
  held?: (blockId: string) => boolean;
}

interface Plan {
  edits: { blockId: string; revision: number; patches: DraftPatchSpan[] }[];
  structure: DraftGroupWrite[];
  touched: string[];
}

export class ExtensionWrites {
  private readonly receipts = new Map<string, Receipt>();

  constructor(private readonly store: OutlinerStore, private readonly deps: ExtensionWritesDeps) {}

  /**
   * Commits an action's writes as the extension, with who asked beside it. Every write is checked first (a block
   * that exists and isn't in the Trash or owned by an extension's record, no new `@name` request line, an update's or a
   * move's revision still the saved one, a name made before it's used), so a refusal writes nothing. They may land
   * anywhere in the outline (PIE-754): the limit is attribution, not place. A created block's text is inert BlockDown.
   * `hostId`: the block it acted on, beside which a proposal waits.
   */
  async apply(extension: string, action: string, writes: readonly BlockWrite[], requestedBy: MutationProvenance | undefined, hostId: string | undefined): Promise<GroupOutcome> {
    const plan = this.plan(action, writes);
    const actor: MutationProvenance = { author: "agent", actorId: extensionActorId(extension) };
    const attribution = this.store.changes.attribution({ action, actor, ...(requestedBy ? { requestedBy } : {}) });
    const made = plan.structure.filter((write) => write.op === "create").length;
    const unwritten = made ? `; its ${made === 1 ? "new block wasn't" : `${made} new blocks weren't`} written` : "";
    if (!plan.structure.length) {
      if (!plan.edits.length) return { written: [] };
      if (!this.deps.patch) throw new Error(`${action}'s update can't be checked here (no draft.patch); nothing was written`);
      const outcome = await this.store.changes.run(attribution, () => this.deps.patch!({ edits: plan.edits, mutation: actor, policy: "edit" }));
      if (outcome.outcome !== "applied") return { written: [], proposalId: outcome.proposalId, proposed: `proposed instead: ${outcome.reason}` };
      return { written: outcome.edits.map((edit) => edit.blockId), ...this.keep(extension, action, [], outcome.edits) };
    }
    if (!this.deps.patchGroup) throw new Error(`${action}'s writes can't be applied together here (no draft.patch); nothing was written`);
    const host = hostId ?? plan.edits[0]?.blockId ?? plan.structure.map((write) => write.op === "move" || write.op === "create" || write.op === "order" ? write.parentId : "")[0]!;
    const group: DraftGroup = { extension, action, hostId: host, writes: plan.structure };
    const writer = this.writer(extension, group.writes, actor);
    const outcome = await this.store.changes.run(attribution, () => this.deps.patchGroup!({ edits: plan.edits, mutation: actor, group, touched: plan.touched, write: writer.write }));
    if (outcome.outcome !== "applied") return { written: [], proposalId: outcome.proposalId, proposed: `proposed instead: ${outcome.reason}${unwritten}` };
    const written = [...new Set([...writer.steps.map((step) => step.kind === "order" ? step.parentId : step.blockId), ...outcome.edits.map((edit) => edit.blockId)])];
    return { written, ...this.keep(extension, action, writer.steps, outcome.edits) };
  }

  /**
   * A group a proposal holds, applied anyway (the router's `groups`): its writes checked against the outline now and
   * written by `write` in the router's transaction; `done` keeps the undo step.
   */
  forProposal(group: DraftGroup, by: MutationProvenance): { write(): void; done(applied: DraftPatchApplied["edits"]): void } {
    for (const write of group.writes) {
      if (write.op === "create" && this.store.get(write.id)) throw new Error("it was applied already: its new block is there");
      const parent = write.parentId;
      const current = this.store.get(parent);
      if (!current || current.effectiveDeletedRootId) {
        if (!group.writes.some((other) => other.op === "create" && other.id === parent)) throw new Error(`${parent} is gone or in the Trash`);
      }
    }
    // The blocks it makes are still the extension's; who applied it moves and orders.
    const writer = this.writer(group.extension, group.writes, by);
    return { write: writer.write, done: (applied) => void this.keep(group.extension, group.action, writer.steps, applied) };
  }

  /**
   * Undo a group, whole (`extensions.undo`): every block it made goes to the Trash, every edit, move and order is put
   * back, in one transaction, as `by`. Refused, with nothing changed, when anything it touched changed since.
   */
  undo(id: string, by: MutationProvenance): { undone: string; extension: string; action: string; written: string[] } {
    const receipt = this.receipts.get(id);
    if (!receipt) throw new Error(`No extension change ${id} to undo here: the last ${MAX_UNDO} since the host started are kept, each undone once`);
    const name = (blockId: string) => this.store.get(blockId)?.text.split("\n", 1)[0]?.slice(0, 40) || blockId;
    // Everything as the group left it: every block it made or edited at its revision (and no draft open on one), every
    // parent it changed with the same children in the same order. Anything else and nothing is undone.
    for (const [blockId, revision] of receipt.revisions) {
      const block = this.store.get(blockId);
      if (!block || block.effectiveDeletedRootId) throw new Error(`"${name(blockId)}" is gone or in the Trash since; nothing was undone`);
      if (block.revision !== revision) throw new Error(`"${name(blockId)}" changed since; nothing was undone (ep0ch revisions puts back an earlier text)`);
      if (this.deps.held?.(blockId)) throw new Error(`"${name(blockId)}" is open in a draft; save or close it, then undo`);
    }
    for (const [parentId, children] of receipt.children) {
      if (this.liveChildren(parentId).join() !== children.join()) throw new Error(`the blocks under "${name(parentId)}" changed since; nothing was undone`);
    }
    // A block it made that has a proposal waiting under it would take the proposal to the Trash with it.
    for (const step of receipt.steps) {
      if (step.kind !== "create") continue;
      const waiting = this.store.children(step.blockId).filter(isProposal).length;
      if (waiting) throw new Error(`"${name(step.blockId)}" has ${waiting === 1 ? "a proposal" : `${waiting} proposals`} waiting under it; apply or dismiss ${waiting === 1 ? "it" : "them"}, then undo (nothing was undone)`);
    }
    const attribution = this.store.changes.attribution({ action: `${receipt.action}.undo`, actor: by });
    const written = new Set<string>();
    this.store.changes.run(attribution, () => this.store.atomically(() => {
      for (const step of [...receipt.steps].reverse()) {
        if (step.kind === "update") this.store.update(step.blockId, step.before, this.store.get(step.blockId)!.revision, by);
        else if (step.kind === "create") this.store.delete(step.blockId, by, { revision: this.store.get(step.blockId)!.revision });
        else if (step.kind === "move") this.store.move(step.blockId, step.fromParent, step.fromPosition, by);
        else this.reorder(step.parentId, step.before, by);
        written.add(step.kind === "order" ? step.parentId : step.blockId);
      }
    }));
    this.receipts.delete(id);
    return { undone: id, extension: receipt.extension, action: receipt.action, written: [...written] };
  }

  /** The group resolved: names minted and put in, every write checked against the outline as it is. */
  private plan(action: string, writes: readonly BlockWrite[]): Plan {
    const names = new Map<string, string>();
    const local = (value: string) => names.get(value) ?? value;
    const usable = (blockId: string) => {
      if ([...names.values()].includes(blockId)) return true;
      const block = this.store.get(blockId);
      return !!block && !block.effectiveDeletedRootId;
    };
    const updates = new Map<string, { revision: number; before: string; after: string }>();
    const structure: DraftGroupWrite[] = [];
    const touched = new Set<string>();
    const nothing = "nothing was written";
    for (const raw of writes) {
      // A name used before the write that makes it is said, rather than taken for an id that isn't there.
      const named = (value: string) => {
        if (LOCAL_NAME.test(value) && !names.has(value) && writes.some((write) => write.op === "create" && write.as === value)) {
          throw new Error(`${action} names ${value} before the write that makes it; ${nothing}`);
        }
        return local(value);
      };
      // So is a link in its text to one made later.
      const later = writes.slice(writes.indexOf(raw) + 1).flatMap((write) => write.op === "create" && write.as && !names.has(write.as) ? [write.as] : []);
      const early = "text" in raw ? later.find((name) => namesDemoIds(raw.text, [name])) : undefined;
      if (early) throw new Error(`${action} names ${early} before the write that makes it; ${nothing}`);
      if (raw.op === "create") {
        const parentId = named(raw.parentId);
        if (!usable(parentId)) throw new Error(`${action} wrote to ${raw.parentId}, which is gone or in the Trash; ${nothing}`);
        if (raw.as !== undefined && names.has(raw.as)) throw new Error(`${action} names two new blocks ${raw.as}; ${nothing}`);
        const text = inertBlockdown(rewriteDemoReferences(raw.text, names));
        if (requestLines(text, null).length) throw new Error(`${action} tried to write an @request line; extensions can't ask agents (${nothing})`);
        const id = crypto.randomUUID();
        if (raw.as !== undefined) names.set(raw.as, id);
        structure.push({ op: "create", id, parentId, text, ...(raw.position !== undefined ? { position: raw.position } : {}) });
        continue;
      }
      if (raw.op === "order") {
        const parentId = named(raw.parentId);
        if (!usable(parentId)) throw new Error(`${action} ordered the children of ${raw.parentId}, which is gone or in the Trash; ${nothing}`);
        const children = raw.children.map(named);
        structure.push({ op: "order", parentId, children });
        for (const child of children) touched.add(child);
        continue;
      }
      const blockId = named(raw.blockId);
      if ([...names.values()].includes(blockId)) throw new Error(`${action} ${raw.op === "move" ? "moved" : "updated"} ${raw.blockId}, a block made in the same answer: give it its text and place when it's made (${nothing})`);
      const current = this.store.get(blockId);
      if (!current || current.effectiveDeletedRootId) throw new Error(`${action} wrote to ${blockId}, which is gone or in the Trash; ${nothing}`);
      // A record an extension keeps is that extension's sync's to write, not an action's.
      const owner = this.store.extensionOwner(blockId);
      if (owner) throw new Error(`${action} tried to ${raw.op} ${blockId}, a record ${owner.extensionId} keeps; ${nothing}`);
      if (current.revision !== raw.expectedRevision) {
        throw new Error(`${action}: ${blockId} was saved since it was read (revision ${raw.expectedRevision}, now ${current.revision}); ${nothing}`);
      }
      if (raw.op === "move") {
        const parentId = named(raw.parentId);
        if (!usable(parentId)) throw new Error(`${action} moved ${blockId} under ${raw.parentId}, which is gone or in the Trash; ${nothing}`);
        structure.push({ op: "move", blockId, parentId, expectedRevision: raw.expectedRevision, ...(raw.position !== undefined ? { position: raw.position } : {}) });
        touched.add(blockId);
        continue;
      }
      if (updates.has(blockId)) throw new Error(`${action} updated ${blockId} twice; one update per block (${nothing})`);
      const after = cleanExtensionText(rewriteDemoReferences(raw.text, names), true);
      const had = new Set(requestLines(current.text, null).map((line) => line.requestKey));
      if (requestLines(after, null).some((line) => !had.has(line.requestKey))) {
        throw new Error(`${action} tried to write an @request line; extensions can't ask agents (${nothing})`);
      }
      if (!current.text && after) throw new Error(`${action} updated an empty block; create a child instead (${nothing})`);
      updates.set(blockId, { revision: current.revision, before: current.text, after });
    }
    const edits = [...updates].flatMap(([blockId, update]) => {
      const span = wholeTextSpan(update.before, update.after);
      return span ? [{ blockId, revision: update.revision, patches: [span] }] : [];
    });
    return { edits, structure, touched: [...touched] };
  }

  /** What writes the group's blocks in the transaction it runs in, and the undo steps it took. */
  private writer(extension: string, writes: readonly DraftGroupWrite[], by: MutationProvenance): { write(): void; steps: UndoStep[] } {
    const steps: UndoStep[] = [];
    const maker = extensionActorId(extension);
    const one = (write: DraftGroupWrite) => {
      if (write.op === "create") {
        const block = this.store.create(write.text, write.parentId, "agent", { actorId: maker }, { id: write.id, ...(write.position !== undefined ? { position: write.position } : {}) });
        steps.push({ kind: "create", blockId: block.id, revision: block.revision });
      } else if (write.op === "move") {
        const block = this.store.get(write.blockId);
        if (!block || block.effectiveDeletedRootId) throw new Error(`${write.blockId} is gone or in the Trash`);
        if (block.revision !== write.expectedRevision) throw new Error(`${write.blockId} was saved since it was read (revision ${write.expectedRevision}, now ${block.revision})`);
        const fromPosition = this.store.children(block.parentId).findIndex((child) => child.id === block.id);
        this.store.move(write.blockId, write.parentId, write.position, by);
        steps.push({ kind: "move", blockId: block.id, fromParent: block.parentId, fromPosition: Math.max(0, fromPosition), toParent: write.parentId });
      } else {
        const before = this.liveChildren(write.parentId);
        this.reorder(write.parentId, write.children, by);
        steps.push({ kind: "order", parentId: write.parentId, before, after: [...write.children] });
      }
    };
    return {
      steps,
      write: () => {
        steps.length = 0;
        try {
          for (const write of writes) one(write);
        } catch (error) {
          throw new Error(`${error instanceof Error ? error.message : String(error)}; nothing was written`);
        }
      },
    };
  }

  /** A parent's children by id, but for the proposals waiting under it (drawn beside it, never part of an order). */
  private liveChildren(parentId: string): string[] {
    return this.store.children(parentId).filter((child) => !isProposal(child)).map((child) => child.id);
  }

  /** A parent's children in the order given, any proposal waiting under it kept after them. */
  private reorder(parentId: string, ids: readonly string[], by: MutationProvenance): void {
    const listed = new Set(ids);
    const waiting = this.store.children(parentId).filter((child) => isProposal(child) && !listed.has(child.id)).map((child) => child.id);
    this.store.reorderChildren(parentId, [...ids, ...waiting], by);
  }

  /** The group as one undo step, when every part of it is the service's to undo. */
  private keep(extension: string, action: string, structure: readonly UndoStep[], edits: DraftPatchApplied["edits"]): Pick<GroupOutcome, "undo" | "undoNote"> {
    if (edits.some((edit) => edit.route === "draft")) return { undoNote: "it went into a live draft: ctrl+z there undoes it" };
    const steps: UndoStep[] = [...structure];
    for (const edit of edits) {
      if (edit.revision === undefined) return {};
      let before: string;
      try {
        before = this.store.revisionText(edit.blockId, edit.revision - 1).text;
      } catch {
        return { undoNote: "the text it replaced isn't kept, so it can't be undone in one step" };
      }
      steps.push({ kind: "update", blockId: edit.blockId, before, revision: edit.revision });
    }
    if (!steps.length) return {};
    // The outline as the group left it: what undo must find again.
    const revisions = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const step of steps) {
      if (step.kind === "create" || step.kind === "update") revisions.set(step.blockId, this.store.get(step.blockId)!.revision);
      const parents = step.kind === "create" ? [this.store.get(step.blockId)!.parentId] : step.kind === "move" ? [step.fromParent, step.toParent] : step.kind === "order" ? [step.parentId] : [];
      for (const parent of parents) if (parent) children.set(parent, this.liveChildren(parent));
      if (step.kind === "create") children.set(step.blockId, this.liveChildren(step.blockId));
    }
    const id = crypto.randomUUID();
    this.receipts.set(id, { id, extension, action, steps, revisions, children });
    while (this.receipts.size > MAX_UNDO) this.receipts.delete(this.receipts.keys().next().value!);
    return { undo: id };
  }
}

/**
 * A whole-text update as one `draft.patch` span: the changed lines (whole lines, so the compare has words to
 * find), with their range as the hint. Null when nothing changed.
 */
export function wholeTextSpan(before: string, after: string): DraftPatchSpan | null {
  if (before === after) return null;
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  let start = before.lastIndexOf("\n", prefix - 1) + 1;
  const tail = before.indexOf("\n", before.length - suffix);
  let end = tail < 0 ? before.length : tail;
  // An insertion at a blank line or an edge: widen to a neighbouring line, so there is text to compare.
  while (start === end) {
    if (start > 0) start = start >= 2 ? before.lastIndexOf("\n", start - 2) + 1 : 0;
    else if (end < before.length) end = before.indexOf("\n", end + 1) < 0 ? before.length : before.indexOf("\n", end + 1);
    else break;
  }
  if (start === end) return null;
  return {
    observed: before.slice(start, end),
    replacement: after.slice(start, after.length - (before.length - end)),
    range: { start, end },
  };
}
