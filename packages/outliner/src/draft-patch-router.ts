import { diffChars } from "diff";
import { isSqliteBusy } from "./sqlite-busy";
import { wholeTextSpan } from "./extension-writes";
/**
 * Where a `draft.patch` goes (PIE-501). Routing is the service's job, not the
 * agent's: a note a door holds a live draft of is patched in that draft (the
 * door runs the compare against its buffer), any other is patched as saved,
 * under a revision check. Several notes apply together or not at all: every
 * part is checked, the drafts are patched, then the saved notes are written in
 * one transaction; a failure anywhere reverts the drafts already patched and
 * the whole patch lands as a proposal instead.
 *
 * The rule a matching patch is held to (`policy`) is the patch's: `edit`, the
 * default, is the guard every agent edit has (`droppedLinkedStructure`, shared
 * with outline_edit), and a patch it refuses is an error, nothing written, as
 * outline_edit's is: it never parks as a proposal. `prose` (a tidy of the
 * person's words) keeps every structural token, and what it refuses becomes a
 * proposal for the person. Only a compare that fails (the note changed since
 * it was read, the passage isn't there, the cursor is in it) or a prose refusal
 * becomes a proposal.
 */
import {
  applyLocated,
  locateSpans,
  locateSpanForced,
  markStart,
  mapOffset,
  rebaseSpans,
  spanContext,
  type DraftPatchSpan,
  type LocatedSpan,
} from "@ep0ch/outline-core/draft-patch-compare";
import {
  DRAFT_PATCH_POLICIES,
  DRAFT_PATCH_PROPOSE_WHEN,
  DRAFT_PROPOSAL_TYPE,
  draftPatchPolicy,
  droppedStructure,
  draftPatchTextPolicy,
  proposalShowsPatch,
  embedLine,
  embedLineSpan,
  DRAFT_PROPOSAL_APPLIES,
  parseProposal,
  proposalChanges,
  proposalStatus,
  proposalText,
  withProposalStatus,
  type DraftHold,
  type DraftHolderAnswer,
  type DraftHolderProposal,
  type DraftHolderRequest,
  type DraftHolds,
  type DraftPatchApplied,
  type DraftPatchEdit,
  type DraftPatchInput,
  type DraftPatchPolicyName,
  type DraftPatchProposed,
  type DraftProposalsBeside,
  type DraftPatchResult,
  type DraftPatchRoute,
  type DraftProposal,
  type DraftProposalStatus,
  type DraftGroup,
} from "./draft-patch";
import { createHash } from "node:crypto";
import { embedMatches } from "./transclusions";
import { blockDisplayTitle } from "./references";
import type { OutlinerStore } from "./store";
import type { ChecklistIdentityChange, MutationProvenance } from "./types";
import { removedListItemIds } from "./checklist-items";
import { fragmentAnchors } from "./fragments";
import { droppedLinkedStructure, type WorkToolsClient } from "./work-tools";

/** What a request to a holding door carries besides its ids, which the server fills in. */
export type DraftHolderAsk =
  | { kind: "read" }
  | { kind: "patch"; undoPatches?: string[]; patchId: string; revision: number; patches: DraftPatchSpan[]; mutation: MutationProvenance; replyTo?: string; replyGroup?: string; mark?: string; output?: boolean; force?: boolean; proposal?: DraftHolderProposal }
  | { kind: "revert"; patchId: string };

export interface DraftPatchRouterDeps {
  store: OutlinerStore;
  holds: DraftHolds;
  /** Whether a door's client is still connected. */
  isLive(clientId: string): boolean;
  /**
   * Yolo is on (PIE-973): the person's door lifted the agent gate, so an agent settles proposals as the person does
   * (any proposal, applied as "apply anyway") and the `edit` policy's guard on dropped structure lets it through.
   * Who wrote what is recorded as ever.
   */
  yolo?(): boolean;
  /** Ask the door holding a draft; rejects when it doesn't answer in time (the hold is then let go). */
  ask(hold: DraftHold, request: DraftHolderAsk): Promise<DraftHolderAnswer>;
  /** Reads for the `edit` policy's guard (backlinks, block text), in process. */
  client: WorkToolsClient;
  /**
   * An agent's patch is about to go into a door's draft: the `@name` lines its spans add are held for a person's `r`
   * (PIE-888) before it lands, so the person's later save or typing doesn't send them.
   */
  heldInDraft?(blockId: string, patches: readonly DraftPatchSpan[], by: MutationProvenance): (landed: boolean) => void;
  keepResolution?(edits: DraftPatchApplied["edits"], inverse: DraftPatchEdit[]): { undo?: string; undoNote?: string };
  resolve?(input: { proposal: string; original: { text: string; revision: number }; current: { id: string; text: string; revision: number } }, by: MutationProvenance): Promise<{ patches: DraftPatchSpan[]; message?: string }>;
  /** A proposal was settled: whatever answered with it says so now. */
  proposalSettled?(proposalId: string, status: Exclude<DraftProposalStatus, "open">, by: MutationProvenance): void;
  /**
   * An extension's write group a proposal holds, applied anyway: its structural writes checked against the outline
   * as it is now (`write` runs inside the transaction that writes the saved notes), and `done` told what landed.
   */
  groups?(group: DraftGroup, by: MutationProvenance): { write(): void; done(applied: DraftPatchApplied["edits"], drafts?: DraftPatchEdit[]): { undo?: string; undoNote?: string } };
}

/** An extension's write group as the router takes it (src/extension-calls.ts builds it): its text edits and the rest. */
export interface DraftGroupInput {
  edits: DraftPatchEdit[];
  mutation: MutationProvenance;
  group: DraftGroup;
  /** Blocks it moves or puts in order: a door's live draft of one makes the whole group a proposal, as of an edited one. */
  touched: readonly string[];
  /** Its blocks made, moved and ordered, inside the transaction that writes the saved notes. */
  write(): void;
}

/** What applying or dismissing a proposal adds: `warning` when its status couldn't be written. */
export interface ProposalSettled {
  proposalId: string;
  warning?: string;
}

interface RunOptions {
  /** Ask the holding door for the inverse kept by an extension undo receipt. */
  undo?: true;
  output?: boolean;
  replyTo?: string; replyGroup?: string;
  mutation: MutationProvenance;
  mark?: { text: string; blockId: string };
  /** "Apply anyway" by the person: the observed text wherever it is now, with no revision or policy check; still above the mark. */
  force?: boolean;
  /** Compare against the text as it is now rather than the revision the patch was read at (an agent's apply). */
  current?: boolean;
  /** The rule a matching patch is held to (not checked when forced). */
  policy: DraftPatchPolicyName;
  allowStructural?: boolean;
  /** The proposal this run settles: the holding door is told, so it says what was done (PIE-510). */
  proposal?: DraftHolderProposal;
  /** Writes that land with the saved notes, in their transaction (a write group's blocks made, moved and ordered). */
  alongside?: () => void;
  /** `<copy>:<target>^<anchor>`, what a write group's netmail tells (PIE-829): that copy's link to that anchor stays. */
  told?: ReadonlySet<string>;
  /** The texts the whole patch leaves its saved notes with, which the guard judges links by (set by `run`). */
  leaves?: Map<string, string>;
  /** The texts of the blocks a write group makes: a list-item ID one of them carries moved there, it wasn't removed. */
  made?: readonly string[];
}

/** The copies a write group tells by netmail (its `netmail` writes). */
const toldBy = (group: DraftGroup | undefined) => new Set((group?.writes ?? []).flatMap(write =>
  write.op === "netmail" && write.about ? [`${write.blockId}:${write.about.blockId}^${write.about.anchor}`] : []));
/** The texts of the blocks a write group makes. */
const madeBy = (group: DraftGroup | undefined) => (group?.writes ?? []).flatMap(write => write.op === "create" ? [write.text] : []);

/** `refused`: the `edit` policy's guard said no; the patch is an error, never a proposal. */
type Outcome = { ok: true; applied: DraftPatchApplied["edits"]; inverse: DraftPatchEdit[] } | { ok: false; reason: string; refused?: boolean };

/** The proposal's observed passages, with their sentences, carried onto the current text. */
function resolutionScope(original: string, current: string, patches: readonly DraftPatchSpan[]): LocatedSpan[] {
  const observed = locateSpans(original, patches);
  if (!observed.ok) return [];
  const changes: LocatedSpan[] = [];
  let offset = 0;
  let pending: LocatedSpan | undefined;
  for (const part of diffChars(original, current)) {
    if (!part.added && !part.removed) {
      if (pending) changes.push(pending);
      pending = undefined;
      offset += part.value.length;
    } else {
      pending ??= {start: offset, end: offset, replacement: ""};
      if (part.removed) { offset += part.value.length; pending.end = offset; }
      else pending.replacement += part.value;
    }
  }
  if (pending) changes.push(pending);
  const boundaries = [...original.matchAll(/[.!?](?=\s|$)|\n/g)].map(match => match.index! + 1);
  return observed.spans.map(span => {
    const start = boundaries.filter(at => at <= span.start).at(-1) ?? 0;
    const end = boundaries.find(at => at >= span.end) ?? original.length;
    // Text inserted at the sentence's end belongs to what follows it.
    return {start: mapOffset(start, changes), end: mapOffset(end, changes.filter(change => change.start < end)), replacement: ""};
  });
}

/** A write group's own writes failed inside the saved notes' transaction: the group is refused, not proposed. */
class AlongsideFailure extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Runs a write group's own writes, its failure marked as theirs. */
function alongside(write: (() => void) | undefined): void {
  try {
    write?.();
  } catch (error) {
    throw new AlongsideFailure(error);
  }
}

/** A refusal by the `edit` policy: nothing was written, and the agent hears why. */
export class DraftPatchRefusal extends Error {
  constructor(reason: string) {
    super(`Not applied, nothing was written: ${reason}`);
    this.name = "DraftPatchRefusal";
  }
}

const MAX_EDITS = 50;
const MAX_SPANS = 200;

function normalizeSpan(span: DraftPatchSpan): DraftPatchSpan {
  if (!span || typeof span !== "object") throw new Error("A patch span is an object");
  if (typeof span.observed !== "string" || typeof span.replacement !== "string") {
    throw new Error("A patch span needs observed and replacement text");
  }
  if (span.unit !== undefined && span.unit !== "utf16" && span.unit !== "utf8") {
    throw new Error("A patch span's unit is utf16 or utf8");
  }
  if (span.range !== undefined && (typeof span.range !== "object" || !Number.isSafeInteger(span.range.start) || !Number.isSafeInteger(span.range.end))) {
    throw new Error("A patch span's range is { start, end }, integers");
  }
  return {
    observed: span.observed,
    replacement: span.replacement,
    ...(span.range ? { range: { start: span.range.start, end: span.range.end } } : {}),
    unit: span.unit ?? "utf16",
    ...(typeof span.before === "string" ? { before: span.before } : {}),
    ...(typeof span.after === "string" ? { after: span.after } : {}),
  };
}

/** The request's notes, checked: one note's fields, or `edits`. */
export function normalizeDraftPatchEdits(input: Pick<DraftPatchInput, "blockId" | "revision" | "patches" | "edits">): DraftPatchEdit[] {
  const single = input.blockId !== undefined || input.revision !== undefined || input.patches !== undefined;
  if (single && input.edits !== undefined) throw new Error("A patch names one note (blockId, revision, patches) or several (edits), not both");
  const raw = single ? [{ blockId: input.blockId, revision: input.revision, patches: input.patches }] : input.edits;
  if (!Array.isArray(raw) || !raw.length) throw new Error("A patch needs blockId, revision and patches, or edits");
  if (raw.length > MAX_EDITS) throw new Error(`A patch changes at most ${MAX_EDITS} notes`);
  const seen = new Set<string>();
  let spans = 0;
  return raw.map(edit => {
    const blockId = typeof edit?.blockId === "string" ? edit.blockId.trim() : "";
    if (!blockId) throw new Error("Each note of a patch needs a blockId");
    if (seen.has(blockId)) throw new Error(`A patch names ${blockId} twice; put its spans together`);
    seen.add(blockId);
    if (!Number.isSafeInteger(edit.revision) || edit.revision! < 1) throw new Error("Each note of a patch needs the positive integer revision its text was read at");
    if (!Array.isArray(edit.patches) || !edit.patches.length) throw new Error("Each note of a patch needs at least one span");
    spans += edit.patches.length;
    if (spans > MAX_SPANS) throw new Error(`A patch has at most ${MAX_SPANS} spans`);
    return { blockId, revision: edit.revision!, patches: edit.patches.map(normalizeSpan) };
  });
}

function normalizePolicy(policy: unknown): DraftPatchPolicyName {
  if (policy === undefined || policy === null) return "edit";
  if (!DRAFT_PATCH_POLICIES.includes(policy as DraftPatchPolicyName)) throw new Error(`A patch's policy is ${DRAFT_PATCH_POLICIES.join(" or ")}`);
  return policy as DraftPatchPolicyName;
}

/** How a note's spans are placed in its text: as it is, or rebased from the revision they were read at. */
type Locator = (text: string, spans: readonly DraftPatchSpan[]) => ReturnType<typeof locateSpans>;

/**
 * Which change of a patch (1-based, counted across all its notes, in the order given) is the first whose
 * application makes `fails` true of the note's text, or null when none alone does. A refusal's reason names it,
 * so a patch of six changes reads as one edit with one change at fault.
 */
function blame(edits: readonly DraftPatchEdit[], edit: DraftPatchEdit, text: string, fails: (after: string) => boolean, locate: Locator = locateSpans): number | null {
  let offset = 0;
  for (const other of edits) {
    if (other === edit) break;
    offset += other.patches.length;
  }
  for (let count = 1; count <= edit.patches.length; count += 1) {
    const located = locate(text, edit.patches.slice(0, count));
    if (!located.ok) return null;
    if (fails(applyLocated(text, located.spans))) return offset + count;
  }
  return null;
}

/** A reason that says "it would …" said of one change, when the patch has more than one. */
function blamed(reason: string, change: number | null, total: number): string {
  return change !== null && total > 1 ? reason.replace(/^it would /, `change ${change} would `) : reason;
}

function normalizeMutation(mutation: MutationProvenance | undefined): MutationProvenance {
  if (!mutation || (mutation.author !== "agent" && mutation.author !== "user")) {
    throw new Error("A patch names who proposes it: mutation { author: agent, actorId }");
  }
  if (mutation.author === "agent" && !mutation.actorId?.trim()) throw new Error("An agent's patch names its actorId");
  return mutation;
}

export class DraftPatchRouter {
  constructor(private readonly deps: DraftPatchRouterDeps) {}

  private yolo(): boolean { return this.deps.yolo?.() === true; }

  private holderOf(blockId: string): DraftHold | null {
    return this.deps.holds.holderOf(blockId, clientId => this.deps.isLive(clientId));
  }

  /**
   * Where a note's part goes: the one door holding a live draft of it, the saved note when none does, or
   * nowhere when more than one door does (the patch then fails into a proposal; nothing guesses).
   */
  private routeOf(blockId: string): { hold: DraftHold | null; many: boolean } {
    const holds = this.deps.holds.holdersOf(blockId, clientId => this.deps.isLive(clientId));
    return { hold: holds[0] ?? null, many: holds.length > 1 };
  }

  /** Whether a door holds a live draft of the note now. */
  isHeld(blockId: string): boolean {
    return !!this.holderOf(blockId);
  }

  /** A note's text as the draft a door holds has it now, or as saved. */
  async read(blockId: string): Promise<{ blockId: string; route: DraftPatchRoute; text: string; revision: number; holder?: string }> {
    const saved = this.deps.store.requireActive(blockId);
    const hold = this.holderOf(blockId);
    if (hold) {
      try {
        const answer = await this.deps.ask(hold, { kind: "read" });
        if ("text" in answer && typeof answer.text === "string") {
          return { blockId, route: "draft", text: answer.text, revision: answer.revision, holder: hold.clientId };
        }
      } catch {
        // The door stopped answering: its hold is gone, and the saved note is the truth.
      }
    }
    return { blockId, route: "saved", text: saved.text, revision: saved.revision };
  }

  /** Only the output planner sets output: it has checked the region belongs to its producer. */
  async patch(input: DraftPatchInput, output = false): Promise<DraftPatchResult> {
    const edits = normalizeDraftPatchEdits(input);
    if (input.replyTo !== undefined && (typeof input.replyTo !== "string" || edits.length !== 1 ||
      edits[0]!.patches.length !== 1 || (edits[0]!.patches[0]!.observed !== input.replyTo && !edits[0]!.patches[0]!.observed.startsWith(input.replyTo + "\n> [!note]- ")) ||
      !edits[0]!.patches[0]!.replacement.startsWith(input.replyTo + "\n"))) {
      throw new Error("replyTo inserts an answer after its unchanged ask line");
    }
    const mutation = normalizeMutation(input.mutation);
    const policy = normalizePolicy(input.policy);
    const allowStructural = input.allowStructural === true;
    const mark = input.mark?.text?.trim() ? { text: input.mark.text, blockId: input.mark.blockId?.trim() || edits[0]!.blockId } : undefined;
    for (const edit of edits) this.deps.store.requireActive(edit.blockId);
    if (mark) this.deps.store.requireActive(mark.blockId);
    const sent = { policy, ...(allowStructural ? { allowStructural } : {}) };
    if (input.propose !== undefined && !DRAFT_PATCH_PROPOSE_WHEN.includes(input.propose)) {
      throw new Error(`propose is ${DRAFT_PATCH_PROPOSE_WHEN.join(" or ")}`);
    }
    if (input.propose === "always") return this.propose("its writer may propose changes here, not make them", edits, mutation, mark, sent);
    if (input.propose === "held") {
      const held = edits.find(edit => this.routeOf(edit.blockId).hold);
      if (held) return this.propose("the note is open in a draft, which a remote write never changes", edits, mutation, mark, sent);
    }
    if (policy === "prose") {
      const total = proposalChanges({ edits });
      let change = 0;
      for (const edit of edits) {
        for (const span of edit.patches) {
          change += 1;
          const reason = draftPatchPolicy(span, anchor => this.inboundLinks(edit.blockId, anchor));
          if (reason) return this.propose(blamed(reason, change, total), edits, mutation, mark, sent);
        }
      }
    }
    const outcome = await this.run(edits, { mutation, mark, output, replyTo: input.replyTo, replyGroup: input.replyGroup, ...sent, ...(input.current === true ? { current: true } : {}) });
    if (outcome.ok) return { outcome: "applied", edits: outcome.applied };
    if (outcome.refused || output) throw new DraftPatchRefusal(outcome.reason);
    return this.propose(outcome.reason, edits, mutation, mark, sent);
  }

  /**
   * An extension's write group (PIE-784): its text edits and its blocks made, moved and put in order, in one
   * transaction, or none of it. A door holding a live draft of any block it edits, moves or reorders makes the whole
   * group one proposal (beside the note it acted on), never half applied; so does an edit whose compare fails. The
   * `edit` policy's guard refuses as it does a patch.
   */
  async patchGroup(input: DraftGroupInput): Promise<DraftPatchResult> {
    const mutation = normalizeMutation(input.mutation);
    const edits = input.edits.length ? normalizeDraftPatchEdits({ edits: input.edits }) : [];
    const sent = { policy: "edit" as const };
    const held = [...edits.map(edit => edit.blockId), ...input.touched].find(blockId => this.routeOf(blockId).hold);
    if (held) {
      const title = this.deps.store.get(held);
      return this.propose(`${title ? `"${blockDisplayTitle(title)}"` : "a note it changes"} is open in a draft; the whole change waits for you`, edits, mutation, undefined, sent, input.group);
    }
    const outcome = await this.run(edits, { mutation, ...sent, alongside: input.write, told: toldBy(input.group), made: madeBy(input.group) });
    if (outcome.ok) return { outcome: "applied", edits: outcome.applied };
    if (outcome.refused) throw new DraftPatchRefusal(outcome.reason);
    return this.propose(outcome.reason, edits, mutation, undefined, sent, input.group);
  }

  /** Proposals being applied or dismissed right now: a second call for one is refused, not raced (PIE-510). */
  private readonly settling = new Set<string>();

  /** The proposal block and the patch it holds, checked to be open. */
  private openProposal(proposalId: string): { block: ReturnType<OutlinerStore["requireActive"]>; proposal: DraftProposal } {
    const block = this.deps.store.requireActive(proposalId);
    const proposal = parseProposal(block.text);
    if (!proposal || !block.properties.some(property => property.key === "type" && property.value === DRAFT_PROPOSAL_TYPE)) {
      throw new Error("This block isn't a draft proposal");
    }
    const status = proposalStatus(block.properties);
    if (status !== "open") throw new Error(`This proposal was already ${status}`);
    return { block, proposal };
  }

  /** Run `work` holding the proposal: nobody else applies or dismisses it meanwhile. */
  private async settle<T>(proposalId: string, work: () => Promise<T>): Promise<T> {
    if (this.settling.has(proposalId)) throw new Error("This proposal is being applied or dismissed already");
    this.settling.add(proposalId);
    try {
      return await work();
    } finally {
      this.settling.delete(proposalId);
    }
  }

  /**
   * The proposal's status written against its revision now (the person may have edited it meanwhile). A
   * warning, never a throw, when it can't be (the proposal went to the Trash while it applied): what it
   * records already happened.
   */
  private writeStatus(proposalId: string, status: Exclude<DraftProposalStatus, "open">, who: MutationProvenance): string | undefined {
    const current = this.deps.store.get(proposalId);
    let failure = "it is gone or in the Trash";
    if (current && !current.effectiveDeletedRootId) {
      try {
        this.deps.store.update(proposalId, withProposalStatus(current.text, status), current.revision, who);
        return undefined;
      } catch (error) {
        if (isSqliteBusy(error)) throw error;
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    return `the edit landed, but the proposal couldn't be marked ${status} (${failure})`;
  }

  private settled(proposalId: string, status: Exclude<DraftProposalStatus, "open">, who: MutationProvenance): void {
    try {
      this.deps.proposalSettled?.(proposalId, status, who);
    } catch {
      // The request row is a note about the proposal; the proposal's own status is the truth.
    }
  }

  /** A saved target changed: its open proposals expose staleness to ordinary property queries and rules. */
  targetChanged(blockId: string, actor: MutationProvenance): void {
    const store = this.deps.store;
    for (const block of store.children(blockId)) {
      if (!isDraftProposal(block) || proposalStatus(block.properties) !== "open") continue;
      const proposal = parseProposal(block.text);
      if (!proposal) continue;
      const stale = block.properties.some(p => p.key === "proposal-applies" && p.value === "no") || proposal.edits.some(edit => store.get(edit.blockId)?.revision !== edit.revision);
      const text = block.text.replace(/^[^\n]*/, header =>
        `${header.replace(/ \[stale::(?:true|false)\]/g, "").replace(/ \[type::proposal\]/g, "")} [type::proposal] [stale::${stale}]`);
      if (text !== block.text) store.update(block.id, text, block.revision, actor);
    }
  }

  async resolveProposal(proposalId: string, requestedBy: MutationProvenance, trigger?: string): Promise<{ outcome: "resolved" | "open"; proposalId: string; message: string; undo?: string; undoNote?: string }> {
    return this.settle(proposalId, async () => {
      const { store } = this.deps;
      const { block, proposal } = this.openProposal(proposalId);
      const actor: MutationProvenance = { author: "agent", actorId: "ext:tidy", taskId: `trigger:${trigger ?? "proposal/resolve"}` };
      const edits: DraftPatchEdit[] = [];
      const from = proposal.actor.actorId ?? proposal.actor.author;
      const messages: string[] = [];
      const leaveOpen = (message: string) => {
        const current = store.requireActive(proposalId);
        store.update(proposalId, `${current.text}\n\nResolution: ${message.replace(/\s+/g, " ")}`, current.revision, actor);
        return { outcome: "open" as const, proposalId, message };
      };
      if (!proposal.edits.length) return leaveOpen("This proposal has no text passage to resolve; apply or dismiss its structural changes.");
      try {
        for (const edit of proposal.edits) {
          const current = await this.read(edit.blockId);
          const original = store.revisionText(edit.blockId, edit.revision);
          const answer = await this.deps.resolve!({ proposal: block.text, original: { text: original.text, revision: edit.revision }, current: { id: edit.blockId, text: current.text, revision: current.revision } }, requestedBy);
          if (!answer.patches.length) return leaveOpen(answer.message ?? "The agent could not determine the intended change.");
          messages.push(answer.message ?? "Resolved the intended change.");
          const patches = answer.patches;
          const scope = resolutionScope(original.text, current.text, edit.patches);
          const located = locateSpans(current.text, patches);
          if (!located.ok) return leaveOpen(located.reason);
          if (located.spans.some(span => !scope.some(allowed => span.start >= allowed.start && span.end <= allowed.end))) {
            return leaveOpen("would change text the proposal didn't touch");
          }
          edits.push({ blockId: edit.blockId, revision: current.revision, patches });
        }
        const status = withProposalStatus(block.text, "resolved").replace("\n", ` [from::${from}]${trigger ? ` [via-trigger::${trigger}]` : ""}\n`) + `\n\nResolved: ${messages.join(" ")}\n` + edits.map(edit => `((${edit.blockId}|Resolved edit))`).join("\n");
        const prepared = proposal.group ? this.deps.groups!(proposal.group, actor) : undefined;
        const outcome = await store.changes.run(store.changes.attribution({ action: "draft.proposal.resolve", actor, requestedBy }), () => this.run(edits, {
          mutation: actor, policy: "prose", undo: true, ...(proposal.mark ? {mark: {...proposal.mark, blockId: proposal.mark.blockId ?? edits[0]!.blockId}} : {}),
          alongside: () => {
            store.update(proposalId, status, block.revision, actor);
            prepared?.write();
          },
          ...(prepared ? { told: toldBy(proposal.group), made: madeBy(proposal.group) } : {}),
        }));
        if (!outcome.ok) return leaveOpen(outcome.reason);
        outcome.applied.push({ blockId: proposalId, route: "saved", revision: store.requireActive(proposalId).revision });
        this.settled(proposalId, "resolved", actor);
        return { outcome: "resolved", proposalId, message: messages.join(" "), ...(prepared ? prepared.done(outcome.applied, outcome.inverse) : this.deps.keepResolution?.(outcome.applied, outcome.inverse)) };
      } catch (error) {
        return leaveOpen(error instanceof Error ? error.message : String(error));
      }
    });
  }

  /**
   * "Apply anyway": the proposal's patch as an ordinary edit by `mutation`, at most once. The person's is
   * forced (no revision or policy check) but never past the passage the proposal shows or below its mark;
   * an agent's is held to the same compare as a patch.
   */
  async applyProposal(proposalId: string, mutation: MutationProvenance): Promise<DraftPatchApplied & ProposalSettled> {
    const who = normalizeMutation(mutation);
    this.openProposal(proposalId);
    return this.settle(proposalId, async () => {
      // Read again once held: another apply or dismiss may have finished in between.
      const { block, proposal } = this.openProposal(proposalId);
      if (!proposalShowsPatch(block.text, proposal)) {
        throw new Error("This proposal's text no longer shows the patch it holds; it isn't applied");
      }
      if (proposal.group) return this.applyGroup(proposalId, proposal, who);
      const edits = normalizeDraftPatchEdits({ edits: proposal.edits });
      // "Apply anyway" is the person's choice. An agent's is held to the same compare as a patch, under the
      // patch's own policy (a proposal from before policies was prose), against the text as it is now (it
      // can't force its own proposal). Both stay above the mark.
      const forced = who.author !== "agent" || this.yolo();
      const policy: DraftPatchPolicyName = proposal.policy === "edit" ? "edit" : "prose";
      const allowStructural = policy === "edit" && proposal.allowStructural === true;
      if (!forced && policy === "prose") {
        for (const edit of edits) {
          for (const span of edit.patches) {
            const reason = draftPatchPolicy(span);
            if (reason) throw new Error(`Couldn't apply it: ${reason}; only the person applies that anyway`);
          }
        }
      }
      const kept = proposal.mark;
      const mark = kept && typeof kept.text === "string" && kept.text.trim()
        ? { text: kept.text, blockId: typeof kept.blockId === "string" && kept.blockId.trim() ? kept.blockId.trim() : edits[0]!.blockId }
        : undefined;
      const outcome = await this.run(edits, forced
        ? { mutation: who, force: true, policy, proposal: { id: proposalId, op: "apply" }, ...(mark ? { mark } : {}) }
        : { mutation: who, current: true, policy, proposal: { id: proposalId, op: "apply" }, ...(allowStructural ? { allowStructural } : {}), ...(mark ? { mark } : {}) });
      if (!outcome.ok) throw new Error(`Couldn't apply it: ${outcome.reason}${outcome.refused ? "; only the person applies that anyway" : ""}`);
      const warning = this.writeStatus(proposalId, "applied", who);
      this.settled(proposalId, "applied", who);
      return { outcome: "applied", edits: outcome.applied, proposalId, ...(warning ? { warning } : {}) };
    });
  }

  /**
   * A write group's proposal applied: its structural writes checked against the outline now and its edits placed as
   * any proposal's are (the person's forced, an agent's compared), all in one step. The edits go where a patch goes, a
   * door's live draft included, and are taken back there if the rest fails.
   */
  private async applyGroup(proposalId: string, proposal: DraftProposal, who: MutationProvenance): Promise<DraftPatchApplied & ProposalSettled> {
    if (!this.deps.groups) throw new Error("Couldn't apply it: this service doesn't apply extension write groups");
    let prepared: ReturnType<NonNullable<DraftPatchRouterDeps["groups"]>>;
    try {
      prepared = this.deps.groups(proposal.group!, who);
    } catch (error) {
      if (isSqliteBusy(error)) throw error;
      throw new Error(`Couldn't apply it: ${error instanceof Error ? error.message : String(error)}`);
    }
    const edits = proposal.edits.length ? normalizeDraftPatchEdits({ edits: proposal.edits }) : [];
    const forced = who.author !== "agent" || this.yolo();
    const outcome = await this.run(edits, forced
      ? { mutation: who, force: true, policy: "edit", proposal: { id: proposalId, op: "apply" }, alongside: prepared.write, made: madeBy(proposal.group) }
      : { mutation: who, current: true, policy: "edit", proposal: { id: proposalId, op: "apply" }, alongside: prepared.write, told: toldBy(proposal.group), made: madeBy(proposal.group) });
    if (!outcome.ok) throw new Error(`Couldn't apply it: ${outcome.reason}${outcome.refused ? "; only the person applies that anyway" : ""}`);
    prepared.done(outcome.applied);
    const warning = this.writeStatus(proposalId, "applied", who);
    this.settled(proposalId, "applied", who);
    return { outcome: "applied", edits: outcome.applied, proposalId, ...(warning ? { warning } : {}) };
  }

  /**
   * Dismiss a proposal without applying it: an older proposal's embed line comes out of the note it was proposed under (its
   * live draft when a door holds one), it is marked `dismissed` and goes to the Trash, all as `mutation`. The
   * embed's removal and the status are one step: if the line can't come out, nothing changes. Anyone dismisses any
   * proposal, an agent another agent's too: the one nearest the work resolves it (Evan, Oct 17: "this security check of
   * only the one who proposed is the one who can resolve never matched how i work"). The record says who dismissed
   * whose, and the Trash takes it back.
   */
  async dismissProposal(proposalId: string, mutation: MutationProvenance): Promise<{ outcome: "dismissed"; embedRemoved: DraftPatchRoute | null } & ProposalSettled> {
    const who = normalizeMutation(mutation);
    this.openProposal(proposalId);
    return this.settle(proposalId, async () => {
      const { store } = this.deps;
      const { block } = this.openProposal(proposalId);
      const line = embedLine(proposalId);
      const hostId = block.parentId;
      let embedRemoved: DraftPatchRoute | null = null;
      let revert: (() => Promise<void>) | null = null;
      const scriptRun = who.taskId?.startsWith("trigger:script:") ? who.sessionId : undefined;
      let scriptPatch: { hold: DraftHold; patchId: string; inverse?: DraftPatchEdit } | undefined;
      const { hold, many } = hostId ? this.routeOf(hostId) : { hold: null, many: false };
      if (hostId && many) {
        throw new Error("More than one door holds a live draft of the note it is under; its embed line can't come out of both. The proposal wasn't dismissed");
      }
      if (hostId && hold) {
        // The embed is in the live draft: the door takes the line out, as a patch it can take back.
        let answer: DraftHolderAnswer;
        try {
          answer = await this.deps.ask(hold, { kind: "read" });
        } catch (error) {
          throw new Error(`The door holding a draft of its note didn't answer (${error instanceof Error ? error.message : String(error)}); the proposal wasn't dismissed`);
        }
        const text = "text" in answer && typeof answer.text === "string" ? answer.text : null;
        const span = text === null ? null : embedLineSpan(text, line);
        if (span) {
          const patchId = crypto.randomUUID();
          let patched: DraftHolderAnswer;
          try {
            patched = await this.deps.ask(hold, { kind: "patch", patchId, revision: hold.revision, patches: [span], mutation: who, force: true, ...(scriptRun ? { undoPatches: this.scriptPatches.get(scriptRun)?.get(hostId)?.ids ?? [] } : {}), proposal: { id: proposalId, op: "dismiss" } });
          } catch (error) {
            void this.deps.ask(hold, { kind: "revert", patchId }).catch(() => undefined);
            throw new Error(`The door holding a draft of its note didn't answer (${error instanceof Error ? error.message : String(error)}); the proposal wasn't dismissed`);
          }
          if (!("applied" in patched) || !patched.applied) {
            throw new Error(`Its embed line couldn't come out of the draft (${"reason" in patched && patched.reason ? patched.reason : "the draft refused it"}); the proposal wasn't dismissed`);
          }
          const inverse = patched.inverse && wholeTextSpan(patched.inverse.before, patched.inverse.text);
          scriptPatch = { hold, patchId, ...(inverse && patched.inverse ? { inverse: { blockId: hostId, revision: patched.inverse.revision, patches: [inverse] } } : {}) };
          embedRemoved = "draft";
          revert = async () => { await this.deps.ask(hold, { kind: "revert", patchId }).catch(() => undefined); };
        }
      }
      try {
        store.database.transaction(() => {
          if (hostId && !hold) {
            const host = store.get(hostId);
            if (host && !host.effectiveDeletedRootId) {
              const span = embedLineSpan(host.text, line);
              if (span) {
                store.update(hostId, applyLocated(host.text, [{ start: span.range!.start, end: span.range!.end, replacement: "" }]), host.revision, who);
                embedRemoved = "saved";
              }
            }
          }
          const current = store.requireActive(proposalId);
          store.update(proposalId, withProposalStatus(current.text, "dismissed"), current.revision, who);
          store.delete(proposalId, who);
        })();
      } catch (error) {
        await revert?.();
        if (isSqliteBusy(error)) throw error;
        throw new Error(`Couldn't dismiss it: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (scriptRun && scriptPatch) this.rememberScriptPatch(scriptRun, scriptPatch);
      this.settled(proposalId, "dismissed", who);
      return { outcome: "dismissed", proposalId, embedRemoved };
    });
  }

  /** How many notes link to `^anchor` in `blockId`. */
  private inboundLinks(blockId: string, anchor: string): number {
    try {
      const sources = this.deps.store.queryBacklinks({ targetBlockId: blockId, limit: 200 }).sources;
      return sources.filter(source => this.deps.store.get(source.blockId)?.text.includes(`^${anchor}`)).length;
    } catch {
      return 0;
    }
  }

  /**
   * Check every note, patch the drafts, then write the saved notes together.
   * Any failure reverts what was patched and says why.
   */
  private readonly scriptPatches = new Map<string, Map<string, { hold: DraftHold; ids: string[]; inverse?: DraftPatchEdit }>>();

  private rememberScriptPatch(run: string, patch: { hold: DraftHold; patchId: string; inverse?: DraftPatchEdit }): void {
    let holds = this.scriptPatches.get(run);
    if (!holds) this.scriptPatches.set(run, holds = new Map());
    let entry = holds.get(patch.hold.blockId);
    if (!entry) holds.set(patch.hold.blockId, entry = { hold: patch.hold, ids: [] });
    entry.ids.push(patch.patchId);
    entry.inverse = patch.inverse;
  }

  async scriptInverse(run: string): Promise<DraftPatchEdit[]> {
    const holds = this.scriptPatches.get(run);
    this.scriptPatches.delete(run);
    return [...holds?.values() ?? []].flatMap(entry => entry.inverse ? [entry.inverse] : []);
  }

  /** The ordinary patch transaction rolls drafts back if the saved half of a run's undo refuses. */
  async undoScript(edits: DraftPatchEdit[], mutation: MutationProvenance, write: () => void): Promise<void> {
    const result = await this.run(edits, { mutation, policy: "edit", current: true, alongside: write });
    if (!result.ok) throw new Error(`${result.reason}; nothing was undone`);
  }

  private async run(edits: DraftPatchEdit[], options: RunOptions): Promise<Outcome> {
    const { store } = this.deps;
    const plan = edits.map(edit => ({ edit, ...this.routeOf(edit.blockId) }));
    const crowded = plan.find(part => part.many);
    if (crowded) return { ok: false, reason: "more than one door holds a live draft of the note; which one is being typed in isn't clear" };
    // Saved notes first: nothing is written until every part has passed. The text the policy passed is the
    // text the write below must still find.
    const checked = new Map<string, string>();
    // What the whole patch leaves each saved note with: the guard judges links by it (PIE-829), so a group that
    // repoints a link and drops the anchor it pointed at is judged on where the link ends up, not where it was.
    const leaves = new Map<string, string>();
    for (const { edit, hold } of plan) {
      if (hold || options.force) continue;
      const block = store.get(edit.blockId);
      const located = block && !block.effectiveDeletedRootId ? this.savedLocator(edit, options)(block.text, edit.patches) : null;
      if (located?.ok) leaves.set(edit.blockId, applyLocated(block!.text, located.spans));
    }
    options = { ...options, leaves };
    for (const { edit, hold } of plan) {
      if (hold) continue;
      const failure = this.checkSaved(edit, options);
      if (failure) return { ok: false, reason: failure };
      if (options.force) continue;
      const text = this.deps.store.requireActive(edit.blockId).text;
      const refusal = await this.policyFailure(edits, edit, text, options, this.savedLocator(edit, options));
      if (refusal) return refusal;
      checked.set(edit.blockId, text);
    }
    // Drafts next, read but not yet touched: the policy is checked over the whole note as typed, and a
    // forced patch (which the door doesn't hold to the mark) is checked against the mark here.
    for (const { edit, hold } of plan) {
      if (!hold) continue;
      let answer: DraftHolderAnswer;
      try {
        answer = await this.deps.ask(hold, { kind: "read" });
      } catch (error) {
        return { ok: false, reason: `the door holding its draft didn't answer (${error instanceof Error ? error.message : String(error)})` };
      }
      if (!("text" in answer) || typeof answer.text !== "string") return { ok: false, reason: "the door holding its draft didn't say what it holds" };
      const located = locateSpans(answer.text, edit.patches, options.force);
      if (!located.ok) return { ok: false, reason: located.reason };
      const past = this.pastMark(answer.text, located.spans, edit.blockId, options);
      if (past) return { ok: false, reason: past };
      const refusal = await this.policyFailure(edits, edit, answer.text, options);
      if (refusal) return refusal;
    }
    const patched: Array<{ hold: DraftHold; patchId: string; inverse?: DraftPatchEdit }> = [];
    const scriptRun = options.mutation.taskId?.startsWith("trigger:script:") ? options.mutation.sessionId : undefined;
    const applied: DraftPatchApplied["edits"] = [];
    // An agent's `@name` lines in these patches were decided before they went in: settled once they landed or were taken back.
    const settling: Array<(landed: boolean) => void> = [];
    const settle = (landed: boolean) => { for (const done of settling.splice(0)) done(landed); };
    const undo = async () => {
      settle(false);
      for (const { hold, patchId } of patched.reverse()) {
        await this.deps.ask(hold, { kind: "revert", patchId }).catch(() => undefined);
      }
    };
    for (const { edit, hold } of plan) {
      if (!hold) continue;
      const patchId = crypto.randomUUID();
      let answer: DraftHolderAnswer;
      const settled = options.mutation.author === "agent" ? this.deps.heldInDraft?.(edit.blockId, edit.patches, options.mutation) : undefined;
      if (settled) settling.push(settled);
      try {
        answer = await this.deps.ask(hold, {
          kind: "patch", patchId, revision: options.force || options.current ? hold.revision : edit.revision, patches: edit.patches,
          mutation: options.mutation,
          ...(options.replyTo ? { replyTo: options.replyTo, replyGroup: options.replyGroup } : {}),
          ...(scriptRun || options.undo ? { undoPatches: scriptRun ? this.scriptPatches.get(scriptRun)?.get(hold.blockId)?.ids ?? [] : [] } : {}),
          ...(options.mark && options.mark.blockId === edit.blockId ? { mark: options.mark.text } : {}),
          ...(options.output ? { output: true } : {}),
          ...(options.force ? { force: true } : {}),
          ...(options.proposal ? { proposal: options.proposal } : {}),
        });
      } catch (error) {
        // A slow door may still apply it after the service stopped waiting: take it back there too.
        void this.deps.ask(hold, { kind: "revert", patchId }).catch(() => undefined);
        await undo();
        return { ok: false, reason: `the door holding its draft didn't answer (${error instanceof Error ? error.message : String(error)})` };
      }
      if (!("applied" in answer) || !answer.applied) {
        await undo();
        return { ok: false, reason: "reason" in answer && answer.reason ? answer.reason : "the draft refused it" };
      }
      const span = answer.inverse && wholeTextSpan(answer.inverse.before, answer.inverse.text);
      patched.push({ hold, patchId, ...(span && answer.inverse ? { inverse: { blockId: hold.blockId, revision: answer.inverse.revision, patches: [span] } } : {}) });
      applied.push({ blockId: edit.blockId, route: "draft", holder: hold.clientId });

    }
    const saved = plan.filter(part => !part.hold);
    try {
      const written = store.database.transaction(() => (alongside(options.alongside), saved).map(({ edit }) => {
        const failure = this.checkSaved(edit, options);
        if (failure) throw new Error(failure);
        const block = store.requireActive(edit.blockId);
        if (!options.force && block.text !== checked.get(edit.blockId)) throw new Error("the note changed while the patch was being checked");
        const located = options.force ? locateSpans(block.text, edit.patches, true) : this.savedLocator(edit, options)(block.text, edit.patches);
        if (!located.ok) throw new Error(located.reason);
        const rebased = this.rebasedFrom(edit, block.revision, options);
        const after = applyLocated(block.text, located.spans);
        return { block: store.update(edit.blockId, after, block.revision, options.mutation, "text", movedListItems(store, edit.blockId, block.text, after, options)), rebased };
      }))();
      for (const { block, rebased } of written) applied.push({ blockId: block.id, route: "saved", revision: block.revision, ...(rebased ? { rebasedFrom: rebased } : {}) });
    } catch (error) {
      await undo();
      if (isSqliteBusy(error)) throw error;
      // What a write group makes, moves or orders failing is its refusal, never a proposal of it.
      if (error instanceof AlongsideFailure) throw error.cause;
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const order = new Map(edits.map((edit, index) => [edit.blockId, index]));
    applied.sort((left, right) => order.get(left.blockId)! - order.get(right.blockId)!);
    settle(true);
    if (scriptRun) for (const patch of patched) this.rememberScriptPatch(scriptRun, patch);
    return { ok: true, applied, inverse: patched.flatMap(patch => patch.inverse ? [patch.inverse] : []) };
  }

  /** The revision a saved note's part was read at when it is applied at a newer one (a rebase), else null. */
  private rebasedFrom(edit: DraftPatchEdit, revision: number, options: RunOptions): number | null {
    return !options.force && !options.current && edit.revision !== revision ? edit.revision : null;
  }

  /**
   * How a saved note's spans are placed: in the text as it is, or, when the note was saved since the patch's
   * revision, rebased from the text of that revision (kept by the store): they apply at the newer revision only
   * when every observed span is still there, once, and nobody rewrote it.
   */
  private savedLocator(edit: DraftPatchEdit, options: RunOptions): Locator {
    const block = this.deps.store.get(edit.blockId);
    if (!block || !this.rebasedFrom(edit, block.revision, options)) return (text, spans) => locateSpans(text, spans);
    const saved = `the note was saved since it was read (revision ${edit.revision}, now ${block.revision})`;
    let base: string | null = null;
    try {
      base = edit.revision < block.revision ? this.deps.store.revisionText(edit.blockId, edit.revision).text : null;
    } catch (error) {
      if (isSqliteBusy(error)) throw error;
      base = null;
    }
    if (base === null) return () => ({ ok: false, index: 0, reason: `${saved}, and that revision isn't kept to rebase from` });
    const from = base;
    return (text, spans) => {
      const placed = rebaseSpans(from, text, spans);
      return placed.ok ? placed : { ...placed, reason: `${saved}, and ${placed.reason}` };
    };
  }

  /** Why a saved note's part can't apply now, or null. */
  private checkSaved(edit: DraftPatchEdit, options: RunOptions): string | null {
    const block = this.deps.store.get(edit.blockId);
    if (!block || block.effectiveDeletedRootId) return "the note is gone or in the Trash";
    const located = options.force ? locateSpans(block.text, edit.patches, true) : this.savedLocator(edit, options)(block.text, edit.patches);
    if (!located.ok) return located.reason;
    return this.pastMark(block.text, located.spans, edit.blockId, options);
  }

  /**
   * Why located spans of `blockId`'s text reach its mark or below, or null. Forced or not, a patch stays above
   * the mark. A forced one whose mark line the person took out is placed only by its exact passage, so it goes on.
   */
  private pastMark(text: string, spans: readonly LocatedSpan[], blockId: string, options: RunOptions): string | null {
    if (!options.mark || options.mark.blockId !== blockId) return null;
    const at = markStart(text, options.mark.text);
    if (at < 0) return options.force ? null : "the mark isn't in the note";
    if (spans.some(span => span.end > at)) return "it reaches the mark or below it; a patch changes only text above the mark";
    return null;
  }

  /**
   * Whether the patch's part for one note, applied to `text` (the note as saved, or the draft as typed), passes
   * the patch's policy. `edit`: the guard every agent edit has, `droppedLinkedStructure` (unless
   * `allowStructural`), and a refusal is final, never a proposal. `prose`: every structural token kept, and a
   * refusal becomes a proposal. Null when it passes.
   */
  private async policyFailure(edits: DraftPatchEdit[], edit: DraftPatchEdit, text: string, options: RunOptions, locate: Locator = locateSpans): Promise<Extract<Outcome, { ok: false }> | null> {
    if (options.force) return null;
    const located = locate(text, edit.patches);
    if (!located.ok) return { ok: false, reason: located.reason };
    const after = applyLocated(text, located.spans);
    const total = proposalChanges({ edits });
    if (options.policy === "prose") {
      const reason = draftPatchTextPolicy(text, after);
      if (!reason) return null;
      return { ok: false, reason: blamed(reason, blame(edits, edit, text, next => draftPatchTextPolicy(text, next) !== null, locate), total) };
    }
    if (options.allowStructural || this.yolo()) return null;
    const lost = await droppedLinkedStructure(this.deps.client, edit.blockId, text, after, {
      text: blockId => options.leaves?.get(blockId), written: options.leaves?.keys() ?? [], made: options.made ?? [], ...(options.told ? { told: options.told } : {}),
    });
    if (!lost.length) return null;
    // Which change drops one of them: the first whose application loses a page or an anchor named here.
    const named = (token: string) => lost.some(entry => entry === token || entry.startsWith(`${token} (`));
    const change = blame(edits, edit, text, next => {
      const dropped = droppedStructure(text, next);
      return dropped.pages.some(named) || dropped.anchors.some(anchor => named(`^${anchor}`));
    }, locate);
    return {
      ok: false,
      refused: true,
      reason: blamed(`it would drop ${lost.join(", ")}; keep ${lost.length === 1 ? "it" : "them"}, or pass allowStructural: true if removing ${lost.length === 1 ? "it" : "them"} is the point`, change, total),
    };
  }

  /**
   * The patch as a proposal block beside the note it targets (a child of the mark's note, or of the first note
   * it patches), attributed to its proposer. The note's text and revision stay as they were: readers draw the
   * proposal after the mark line, or at the note's end (`proposalsBeside`). The same open patch from the same
   * actor already beside it is returned instead of a second copy (`deduped`).
   */
  private async propose(
    reason: string, edits: DraftPatchEdit[], mutation: MutationProvenance, mark: { text: string; blockId: string } | undefined,
    sent: { policy: DraftPatchPolicyName; allowStructural?: boolean }, group?: DraftGroup,
  ): Promise<DraftPatchProposed> {
    const { store } = this.deps;
    const hostId = group?.hostId ?? mark?.blockId ?? edits[0]!.blockId;
    const dedupe = proposalKey(edits, mutation, mark, group);
    const same = this.openProposalLike(hostId, dedupe);
    if (same) return { outcome: "proposed", reason, proposalId: same, beside: hostId, deduped: true };
    const kept: DraftPatchEdit[] = [];
    // Whether "apply anyway" could place it now: a passage already gone when it is proposed never comes back
    // by itself, so the proposal says it can only be dismissed (PIE-510).
    let applies = true;
    for (const edit of edits) {
      // Keep the text around each span as it is now, so "apply anyway" can tell which copy it means.
      const text = (await this.read(edit.blockId).catch(() => null))?.text ?? store.get(edit.blockId)?.text ?? "";
      // A forced apply stays above the mark too, so a passage at or below it can only be dismissed.
      const markAt = mark && mark.blockId === edit.blockId ? markStart(text, mark.text) : -1;
      kept.push({
        ...edit,
        patches: edit.patches.map(span => {
          const at = locateSpanForced(text, span);
          if ("reason" in at) {
            applies = false;
            return span;
          }
          if (markAt >= 0 && at.end > markAt) applies = false;
          return span.before !== undefined && span.after !== undefined ? span : { ...span, ...spanContext(text, at.start, at.end) };
        }),
      });
    }
    const proposal: DraftProposal = {
      version: 1, edits: kept, reason, ...sent, dedupe,
      ...(mark ? { mark } : {}),
      ...(group ? { group } : {}),
      actor: { author: mutation.author, ...(mutation.actorId ? { actorId: mutation.actorId } : {}) },
    };
    const names = (blockId: string) => {
      const block = store.get(blockId);
      return block ? blockDisplayTitle(block) : blockId;
    };
    // Checked again inside the write: two racing retries of one patch leave one proposal.
    const created = store.database.transaction(() => {
      const raced = this.openProposalLike(hostId, dedupe);
      if (raced) return { id: raced, deduped: true };
      const text = proposalText(proposal, names, { applies }).replace("\n", ` [type::proposal] [stale::${!applies || edits.some(edit => store.get(edit.blockId)?.revision !== edit.revision)}]\n`);
      const block = mutation.author === "agent"
        ? store.create(text, hostId, "agent", { actorId: mutation.actorId!, ...(mutation.sessionId ? { sessionId: mutation.sessionId } : {}) })
        : store.create(text, hostId, "user");
      return { id: block.id, deduped: false };
    })();
    return { outcome: "proposed", reason, proposalId: created.id, beside: hostId, ...(created.deduped ? { deduped: true as const } : {}) };
  }

  /** The open proposal beside `hostId` holding the same patch from the same actor (`proposalKey`), or null. */
  private openProposalLike(hostId: string, dedupe: string): string | null {
    for (const child of this.deps.store.children(hostId)) {
      if (child.effectiveDeletedRootId || !isDraftProposal(child) || proposalStatus(child.properties) !== "open") continue;
      if (parseProposal(child.text)?.dedupe === dedupe) return child.id;
    }
    return null;
  }

  /**
   * The open proposals beside note `blockId`, oldest first, each with the note line it is drawn after: its mark's
   * line when the note still has it, else the last line. One whose embed line the note's text still carries (a
   * proposal from before PIE-725) is left out: its embed draws it already.
   */
  proposalsBeside(blockId: string): DraftProposalsBeside {
    const host = this.deps.store.requireActive(blockId);
    const lines = host.text.split("\n");
    // Embeds the note's text draws (never inside code, by the service's one embed grammar).
    const embedded = new Set(embedMatches(host.text).map(match => match[1]!));
    const proposals: DraftProposalsBeside["proposals"] = [];
    for (const child of this.deps.store.children(blockId)) {
      if (child.effectiveDeletedRootId || !isDraftProposal(child) || proposalStatus(child.properties) !== "open") continue;
      if (embedded.has(child.id)) continue;
      const held = parseProposal(child.text);
      const mark = held?.mark && (held.mark.blockId === undefined || held.mark.blockId === blockId) ? held.mark.text.trim() : "";
      const at = mark ? lines.findIndex(line => line.trim() === mark) : -1;
      proposals.push({
        id: child.id,
        afterLine: at >= 0 ? at : lines.length - 1,
        author: child.author,
        ...(child.actorId ? { actorId: child.actorId } : {}),
        applies: !child.properties.some(property => property.key === DRAFT_PROPOSAL_APPLIES && property.value === "no"),
      });
    }
    return { blockId, revision: host.revision, proposals };
  }
}

/** Whether a block is a draft proposal by its type. */
function isDraftProposal(block: { properties: readonly { key: string; value: string }[] }): boolean {
  return block.properties.some(property => property.key === "type" && property.value === DRAFT_PROPOSAL_TYPE);
}

/**
 * What makes a retry the same patch: who sent it, its mark, and each note's spans as sent: passage, replacement and
 * where it said they are (range, unit, context), so two patches of the same words at different places stay two.
 * Hashed: it rides in the proposal's payload.
 */
function proposalKey(edits: readonly DraftPatchEdit[], actor: { author: string; actorId?: string }, mark: { text: string; blockId: string } | undefined, group?: DraftGroup): string {
  const key = JSON.stringify([
    actor.author, actor.actorId ?? null,
    mark ? [mark.text.trim(), mark.blockId] : null,
    edits.map(edit => [edit.blockId, edit.patches.map(span => [span.observed, span.replacement, span.range?.start ?? null, span.range?.end ?? null, span.unit ?? null, span.before ?? null, span.after ?? null])]),
    // A group's new blocks have fresh ids each run: it is the same group by what it writes, not by them.
    ...(group ? [[group.action, group.hostId, group.writes]] : []),
  ]);
  // A group's new blocks have fresh ids each run: it is the same group by what it writes, so they're numbered here.
  const minted = (group?.writes ?? []).flatMap(write => write.op === "create" ? [write.id] : []);
  const same = minted.reduce((text, id, index) => text.split(id).join(`#${index}`), key);
  return createHash("sha256").update(same).digest("base64url");
}

export type { DraftHolderRequest };

/**
 * The list-item IDs a patch takes out of one note and puts in another it writes or makes (PIE-829, a split or a merge
 * moving `^s5` with its line): declared to the store as moved out of this note, which it otherwise refuses as an ID
 * dropped by accident. Only for an ID the same patch writes elsewhere; one that just goes is still refused.
 */
function movedListItems(store: OutlinerStore, blockId: string, before: string, after: string, options: RunOptions): ChecklistIdentityChange[] {
  const gone = removedListItemIds(before, after);
  if (!gone.length) return [];
  const ids = (text: string) => fragmentAnchors(text).map(anchor => anchor.id);
  // Where it went: a block the patch makes, or one it writes that didn't have it before.
  const arrived = new Set([...(options.made ?? []).flatMap(ids), ...[...(options.leaves ?? new Map<string, string>())].flatMap(([id, text]) => {
    if (id === blockId) return [];
    const had = new Set(ids(store.get(id)?.text ?? ""));
    return ids(text).filter(anchor => !had.has(anchor));
  })]);
  return gone.filter(itemId => arrived.has(itemId)).map(itemId => ({ kind: "remove" as const, itemId }));
}
