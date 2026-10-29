import { parseActor } from "@ep0ch/outline-core/attribution";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { DRAFT_PROPOSAL_TYPE, parseProposal, proposalStatus } from "./draft-patch";
import { blockDisplayTitle } from "./references";
import type { OutlinerStore } from "./store";

/**
 * What became of an agent's proposals (PIE-1086): the outcomes of every draft proposal it wrote, read from the
 * proposal blocks' own revision records. A proposal's first line says where it is in its life (`[proposal-status::…]`,
 * `[stale::…]`, draft-patch.ts and the router write them); each revision that changed that is one outcome, so an agent
 * that looks after several changes hears each of them, in order, with who made it. Nothing is stored for this: the
 * proposal and its revisions are the record, and a dismissed proposal (in the Trash) still has its revisions.
 */

export type ProposalOutcomeState = "proposed" | "stale" | "applied" | "dismissed" | "resolved";

export interface ProposalOutcome {
  /** The proposal block, and the note it sits beside. */
  proposal: string;
  note: string;
  title: string;
  state: ProposalOutcomeState;
  /** When the revision that says it was saved, and which revision of the proposal it is. */
  at: string;
  revision: number;
  /** Who made it so: the agent for proposed, whoever changed the note for stale, whoever applied, dismissed or resolved it. */
  by?: string;
  /** Why: for proposed, why it didn't apply; for stale, that the note changed since. */
  reason?: string;
}

export interface ProposalOutcomesPage {
  actor: string;
  outcomes: ProposalOutcome[];
  /** Pass as `since` next time: the newest outcome's time, or the `since` asked when there were none. */
  cursor: string;
  /** false: more outcomes than `limit` came after `since`; ask again from `cursor`. */
  complete: boolean;
}

export const PROPOSAL_OUTCOMES_DEFAULT_LIMIT = 50;
export const PROPOSAL_OUTCOMES_MAX_LIMIT = 200;
/** How far back a first look goes when it names no `since`. */
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a proposal's author is the actor asked about: the same actor id; or, for a persona (a bare `loki`, or an id
 * that names one, `loki/claude-code@float-box`), every actor with that handle (`mcp:loki/claude.ai` too), as filters and
 * mentions compare them. An id with no persona (`claude-code@float-box`) is only itself.
 */
export function proposalAuthoredBy(recorded: string | undefined, asked: string): boolean {
  if (!recorded) return false;
  const want = asked.trim().toLowerCase();
  if (recorded.trim().toLowerCase() === want) return true;
  const persona = /[/@:]/.test(want) ? parseActor(asked).persona?.toLowerCase() : want;
  // Only a recorded persona answers to a persona: `claude-code` is no persona, and isn't every builder's principal.
  return !!persona && parseActor(recorded).persona?.toLowerCase() === persona;
}

/** Where a proposal is at one revision: its own properties, read by the one property grammar, as the router reads them. */
function stateOf(text: string): { status: string; stale: boolean } {
  const properties = parsePropertyRecords(text).filter(p => p.scope === "block");
  return { status: proposalStatus(properties), stale: properties.some(p => p.key === "stale" && p.value === "true") };
}

const SETTLED: ReadonlySet<string> = new Set(["applied", "dismissed", "resolved"]);

/** One proposal's outcomes, oldest first, from its revisions. */
export function outcomesOf(store: OutlinerStore, proposalId: string): ProposalOutcome[] {
  const block = store.get(proposalId);
  if (!block) return [];
  const rows = store.database.query("SELECT revision, text, saved_at, actor_id, author FROM block_revisions WHERE block_id = ? ORDER BY revision")
    .all(proposalId) as Array<{ revision: number; text: string; saved_at: string; actor_id: string | null; author: string | null }>;
  const current = store.revisions(proposalId, true).revisions[0]!;
  const texts = [
    ...rows.filter(r => r.revision !== block.revision).map(r => ({ revision: r.revision, text: r.text, at: r.saved_at, by: r.actor_id ?? (r.author === "user" ? "user" : undefined) })),
    { revision: block.revision, text: block.text, at: current.savedAt, by: current.actorId ?? (current.author === "user" ? "user" : undefined) },
  ];
  const proposal = parseProposal(texts[0]!.text) ?? parseProposal(block.text);
  const note = block.parentId ?? "";
  const host = note ? store.get(note) : null;
  const title = host ? blockDisplayTitle(host) : "";
  const out: ProposalOutcome[] = [];
  const push = (state: ProposalOutcomeState, t: (typeof texts)[number], reason?: string) =>
    out.push({ proposal: proposalId, note, title, state, at: t.at, revision: t.revision, ...(t.by ? { by: t.by } : {}), ...(reason ? { reason } : {}) });
  let was: { status: string; stale: boolean } | undefined;
  for (const t of texts) {
    const now = stateOf(t.text);
    if (!was) push("proposed", { ...t, by: proposal?.actor.actorId ?? t.by }, proposal?.reason);
    else if (now.status !== was.status && SETTLED.has(now.status)) push(now.status as ProposalOutcomeState, t);
    else if (now.status === "open" && now.stale && !was.stale) push("stale", t, "the note changed since it was proposed: re-read it and send the edit again, or leave the proposal to Evan");
    was = now;
  }
  return out;
}

/**
 * The outcomes of `actor`'s proposals (with `session`, only the ones that session wrote) after `since` (an ISO time; a week back when left out), oldest first, at most
 * `limit`. Candidates are the proposals changed since then, the Trash's among them, by their author as the proposal
 * itself records it (its patch's actor), not whoever touched it last.
 */
export function proposalOutcomes(store: OutlinerStore, input: { actor: string; session?: string; since?: string; limit?: number }, now = Date.now()): ProposalOutcomesPage {
  const actor = typeof input.actor === "string" ? input.actor.trim() : "";
  if (!actor) throw new Error("proposals.outcomes needs actor: the agent whose proposals to follow (an actor id, or a persona such as loki)");
  if (input.since !== undefined && (typeof input.since !== "string" || !Number.isFinite(Date.parse(input.since)))) {
    throw new Error(`since is an ISO time (2026-01-31T09:00:00Z), or left out for the last week: ${String(input.since)}`);
  }
  const limit = Math.max(1, Math.min(PROPOSAL_OUTCOMES_MAX_LIMIT, Math.floor(Number(input.limit ?? PROPOSAL_OUTCOMES_DEFAULT_LIMIT)) || PROPOSAL_OUTCOMES_DEFAULT_LIMIT));
  const since = input.since ? new Date(Date.parse(input.since)).toISOString() : new Date(now - DEFAULT_WINDOW_MS).toISOString();
  const after = Date.parse(since);
  const ids = store.database.query(
    "SELECT b.id AS id FROM blocks b JOIN block_properties p ON p.block_id = b.id AND p.key = 'type' AND p.value = ? WHERE b.updated_at >= ? GROUP BY b.id ORDER BY b.updated_at",
  ).all(DRAFT_PROPOSAL_TYPE, since) as Array<{ id: string }>;
  const outcomes: ProposalOutcome[] = [];
  for (const { id } of ids) {
    const block = store.get(id);
    if (!block || !proposalAuthoredBy(parseProposal(block.text)?.actor.actorId ?? block.actorId, actor)) continue;
    // One session of an actor with no persona (several builders write as claude-code@float-box): its own proposals only.
    if (input.session && block.sessionId !== input.session) continue;
    outcomes.push(...outcomesOf(store, id).filter(o => Date.parse(o.at) > after));
  }
  outcomes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.revision - b.revision);
  let page = outcomes.slice(0, limit);
  // The next page starts after the cursor's time, so a cut page never ends inside one millisecond (one save that made
  // several proposals stale): it stops before that time, or, when the whole page is that time, takes all of it.
  if (outcomes.length > limit) {
    const last = page.at(-1)!.at, before = page.filter(o => o.at !== last);
    page = before.length ? before : outcomes.filter(o => o.at === last);
  }
  return { actor, outcomes: page, cursor: page.at(-1)?.at ?? since, complete: outcomes.length <= page.length };
}
