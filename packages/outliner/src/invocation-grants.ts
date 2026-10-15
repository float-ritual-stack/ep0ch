// Invocation grants (PIE-888 slice 2): who may wake whom without a person's `r`. An `@name` line an extension or an agent
// writes is held for a person (agent-requests.ts holdWritten); a grant is a note the person wrote that says some writers
// may wake some agents on their own, with the limits that keep that from running away:
//
//   Let requests wake kitty [invoke-from::ext:requests] [invoke-to::kitty] [max-hops::2] [budget::5] [cap::20/day]
//
// `invoke-from`: the writer (`ext:<id>`, an agent's actor id, `agent` or `agents` for any agent, `all`), repeatable.
// `invoke-to`: the agent's `@name`, or `all`, repeatable. `max-hops`: how many automatic wakes one ask's chain may hold
// (default 1: the writer wakes the agent, and what that agent writes is held again). `budget`: the most automatic wakes
// one chain, from the person's ask down, may spend in all. `cap`: the most wakes a day through the grant. A repeat (an
// agent already in the chain) is always held. Only a note a person last wrote counts: an agent can't grant itself.
import { parseRuleCap, ruleWriter } from "@ep0ch/outline-core/rules";
import type { Block, MutationProvenance } from "./types";
import { blockDisplayTitle } from "./references";

export const DEFAULT_MAX_HOPS = 1;
const MAX_HOPS = 8;

export interface InvocationGrant {
  /** The note's id and title (what a refusal names). */
  readonly id: string;
  readonly title: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly maxHops: number;
  readonly budget?: number;
  readonly cap?: number;
  /** What is wrong with it, said where the grant is read (it grants nothing). */
  readonly problem?: string;
}

/** An ask's chain: who woke whom, from the person's ask, shared by every wake that follows from it. */
export interface InvocationChain {
  /** The agents asked so far, first to last. */
  readonly agents: readonly string[];
  /** Automatic wakes in this chain so far. */
  readonly hops: number;
  /** Wakes the whole chain has spent, shared by every branch of it (`budget`). */
  readonly spent: { n: number };
  /** The tightest `max-hops` and `budget` of the grants it came through: a later, looser grant doesn't lift them. */
  readonly ceiling?: { readonly maxHops: number; readonly budget?: number };
}

export const newChain = (agent: string): InvocationChain => ({ agents: [agent], hops: 0, spent: { n: 0 } });

const values = (block: Pick<Block, "properties">, key: string): string[] =>
  block.properties.filter((p) => p.key === key).flatMap((p) => p.value.split(",")).map((v) => v.trim()).filter(Boolean);

/** A note's grant, when it declares one (`invoke-to` or `invoke-from`), with what's wrong with it; null for any other note. */
export function parseGrant(block: Block): InvocationGrant | null {
  const from = values(block, "invoke-from").map((v) => v.toLowerCase());
  const to = values(block, "invoke-to").map((v) => v.toLowerCase());
  if (!from.length && !to.length) return null;
  const problems: string[] = [];
  if (!from.length) problems.push("it has no [invoke-from::…] (ext:<id>, an agent's actor id, agents or all)");
  if (!to.length) problems.push("it has no [invoke-to::…] (an @name, or all)");
  let maxHops = DEFAULT_MAX_HOPS;
  const hops = values(block, "max-hops")[0];
  if (hops !== undefined) {
    const n = Number(hops);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_HOPS) maxHops = n; else problems.push(`max-hops is a whole number from 1 to ${MAX_HOPS}`);
  }
  let budget: number | undefined;
  const spend = values(block, "budget")[0];
  if (spend !== undefined) {
    const n = Number(spend);
    if (Number.isInteger(n) && n >= 1 && n <= 1000) budget = n; else problems.push("budget is a whole number of wakes, 1 to 1000");
  }
  let cap: number | undefined;
  const daily = block.properties.find((p) => p.key === "cap")?.value;
  if (daily !== undefined) {
    const parsed = parseRuleCap(daily);
    if (typeof parsed === "number") cap = parsed; else problems.push(parsed.problem);
  }
  return {
    id: block.id, title: blockDisplayTitle(block).slice(0, 60), from, to, maxHops,
    ...(budget !== undefined ? { budget } : {}), ...(cap !== undefined ? { cap } : {}),
    ...(problems.length ? { problem: problems.join("; ") } : {}),
  };
}

/** Whether a grant's `invoke-from` names this writer. */
export function grantFromMatches(grant: InvocationGrant, actor: MutationProvenance | undefined): boolean {
  const writer = ruleWriter(actor);
  const id = actor?.actorId?.trim().toLowerCase().split("@", 1)[0];
  return grant.from.some((from) => from === "all" || (from === writer) || ((from === "agent" || from === "agents") && writer === "agent") || (!!id && from === id));
}

export const grantToMatches = (grant: InvocationGrant, agent: string): boolean => grant.to.includes("all") || grant.to.includes(agent.toLowerCase());

export type Verdict =
  | { wake: true; grant: InvocationGrant; chain: InvocationChain; /** Takes the wake back (the line never landed). */ refund(): void }
  /** Held: `why` is the line's reason after `held: `; `grant` the one that came closest, when one did. */
  | { wake: false; why: string };

/**
 * Whether `actor`'s new `@agent` line wakes the agent now, under the grants, in the chain it was written in (`parent`: the
 * ask whose answer wrote it; none for a writer that isn't answering one). `today` counts the grant's wakes today and is
 * told on a wake.
 */
export function decide(grants: readonly InvocationGrant[], actor: MutationProvenance | undefined, agent: string, parent: InvocationChain | undefined, today: { count(id: string): number; spend(id: string): void; unspend(id: string): void }): Verdict {
  const who = actor?.actorId?.trim() || actor?.author || "system";
  const plain = { wake: false as const, why: `${who} may not wake @${agent} · r to send` };
  const usable = grants.filter((g) => !g.problem && grantFromMatches(g, actor) && grantToMatches(g, agent));
  if (!usable.length) return plain;
  const chain = parent ?? newChain(who);
  const refusals: string[] = [];
  for (const grant of usable) {
    if (chain.agents.includes(agent)) { refusals.push(`@${agent} is already in this chain (${[...chain.agents, agent].map((a) => `@${a}`).join(" → ")}), so a repeat is held`); continue; }
    const maxHops = Math.min(grant.maxHops, chain.ceiling?.maxHops ?? Infinity);
    if (chain.hops + 1 > maxHops) { refusals.push(`“${grant.title}” allows ${maxHops} hop${maxHops === 1 ? "" : "s"}${maxHops < grant.maxHops ? " (the chain's tightest grant)" : ""} and this would be hop ${chain.hops + 1}`); continue; }
    const budget = grant.budget === undefined ? chain.ceiling?.budget : Math.min(grant.budget, chain.ceiling?.budget ?? Infinity);
    if (budget !== undefined && chain.spent.n >= budget) { refusals.push(`“${grant.title}” gives a chain a budget of ${budget} wake${budget === 1 ? "" : "s"}, all spent`); continue; }
    if (grant.cap !== undefined && today.count(grant.id) >= grant.cap) { refusals.push(`“${grant.title}” is capped at ${grant.cap}/day, and it's used up today`); continue; }
    chain.spent.n++;
    today.spend(grant.id);
    return {
      wake: true, grant,
      chain: { agents: [...chain.agents, agent], hops: chain.hops + 1, spent: chain.spent, ceiling: { maxHops, ...(budget !== undefined ? { budget } : {}) } },
      refund: () => { chain.spent.n--; today.unspend(grant.id); },
    };
  }
  return { wake: false, why: `${refusals[0]} · r to send` };
}
