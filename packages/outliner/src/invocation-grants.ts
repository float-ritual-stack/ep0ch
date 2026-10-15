import { parseActor, parseSessionId } from "@ep0ch/outline-core/attribution";
import { parseRuleCap, ruleWriter } from "@ep0ch/outline-core/rules";
import type { Block, MutationProvenance } from "./types";
import { blockDisplayTitle } from "./references";

export const DEFAULT_MAX_HOPS = 8;
const MAX_HOPS = 8;

export interface InvocationGrant {
  /** The note's id and title (what a refusal names). */
  readonly id: string;
  readonly title: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly maxHops: number;
  readonly deny?: boolean;
  readonly budget?: number;
  readonly cap?: number;
  /** What is wrong with it, said where the grant is read (it grants nothing). */
  readonly problem?: string;
}

/** An ask's chain: who woke whom, from the person's ask, shared by every wake that follows from it. */
export interface InvocationChain {
  /** The agents asked so far, first to last. */
  readonly origin?: "user" | "agent";
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
  const denied = values(block, "invoke-deny");
  const to = [...values(block, "invoke-to"), ...denied].map((v) => v.toLowerCase());
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
    ...(denied.length ? { deny: true } : {}),
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
  | { wake: false; why: string; denied?: true };

/**
 * Whether `actor`'s new `@agent` line wakes the agent now, under the grants, in the chain it was written in (`parent`: the
 * ask whose answer wrote it; none for a writer that isn't answering one). `today` counts the grant's wakes today and is
 * told on a wake.
 */
export function decide(grants: readonly InvocationGrant[], actor: MutationProvenance | undefined, agent: string, parent: InvocationChain | undefined, today: { count(id: string): number; spend(id: string): void; unspend(id: string): void }): Verdict {
  const who = actor?.actorId?.trim() || actor?.author || "system";
  const chain = parent ?? newChain(who);
  // A copied or connector-approved ask is the person's own ask. Replies start guarded agent work.
  if (chain.origin === "user" || personAsk(actor)) return { wake: true, grant: DEFAULT_GRANT,
    chain: { ...newChain(agent), origin: "agent" }, refund() {} };
  const usable = grants.filter(g => !g.problem && grantFromMatches(g, actor) && grantToMatches(g, agent));
  const denied = usable.find(g => g.deny);
  if (denied) return { wake: false, denied: true, why: `invoke-deny: “${denied.title}” denies ${who} → @${agent} · r to send` };
  const limits = [DEFAULT_GRANT, ...usable];
  const maxHops = Math.min(chain.ceiling?.maxHops ?? Infinity, ...limits.map(g => g.maxHops));
  const budget = Math.min(chain.ceiling?.budget ?? Infinity, ...limits.map(g => g.budget ?? Infinity));
  let why: string | undefined;
  if (chain.agents.includes(agent)) why = `@${agent} is already in this chain (${[...chain.agents, agent].map(a => `@${a}`).join(" → ")}), so a repeat is held`;
  else if (chain.hops + 1 > maxHops) why = `max-hops: allows ${maxHops} hop${maxHops === 1 ? "" : "s"} and this would be hop ${chain.hops + 1}`;
  else if (chain.spent.n >= budget) why = `budget: all ${budget} wakes in this chain are spent`;
  else {
    const capped = limits.find(g => g.cap !== undefined && today.count(g.id) >= g.cap);
    if (capped) why = `cap: “${capped.title}” is capped at ${capped.cap}/day, and it's used up today`;
  }
  if (why) return { wake: false, why: `${why} · r to send` };
  chain.spent.n++;
  for (const g of limits) today.spend(g.id);
  return { wake: true, grant: usable[0] ?? DEFAULT_GRANT,
    chain: { agents: [...chain.agents, agent], origin: "agent", hops: chain.hops + 1, spent: chain.spent,
      ceiling: { maxHops, ...(Number.isFinite(budget) ? { budget } : {}) } },
    refund: () => { chain.spent.n--; for (const g of limits) today.unspend(g.id); },
  };
}

const DEFAULT_GRANT: InvocationGrant = { id: "default", title: "Default wakes", from: ["all"], to: ["all"], maxHops: DEFAULT_MAX_HOPS };

/** Connector sessions carry the person's OAuth subject; stdio calls are autonomous agent work. */
export function personAsk(actor: MutationProvenance | undefined): boolean {
  if (actor?.author === "user") return true;
  const subject = parseSessionId(actor?.sessionId).subject;
  return parseActor(actor?.actorId).mcp && !!subject && subject !== "stdio";
}
