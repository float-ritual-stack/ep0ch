// Invocation grants (PIE-888 slice 2): the notes that let a writer wake an agent, and the limits on a chain of wakes.
// The decision is pure; the service tests (agent-requests.test.ts) run it against a real host.
import { expect, test } from "bun:test";
import { decide, newChain, parseGrant, type InvocationGrant } from "../src/invocation-grants";
import type { Block } from "../src/types";

const note = (text: string): Block => ({ id: "g1", text, properties: [...text.matchAll(/\[([\w-]+)::([^\]]*)\]/g)].map(m => ({ key: m[1]!, value: m[2]! })), revision: 1 } as unknown as Block);
const EXT = { author: "agent" as const, actorId: "ext:requests" };
const counts = () => { const n = new Map<string, number>(); return { count: (id: string) => n.get(id) ?? 0, spend: (id: string) => void n.set(id, (n.get(id) ?? 0) + 1), unspend: (id: string) => void n.set(id, (n.get(id) ?? 1) - 1) }; };

test("a grant's properties: writers, agents, hops, budget and a daily cap; what's wrong says so and grants nothing", () => {
  const ok = parseGrant(note("Let requests wake kitty [invoke-from::ext:requests, loki] [invoke-to::kitty] [max-hops::3] [budget::4] [cap::20/day]"))!;
  expect(ok).toMatchObject({ from: ["ext:requests", "loki"], to: ["kitty"], maxHops: 3, budget: 4, cap: 20 });
  expect(ok.problem).toBeUndefined();
  expect(parseGrant(note("Just a note [type::plan]"))).toBeNull();
  expect(parseGrant(note("Half [invoke-to::kitty]"))!.problem).toContain("no [invoke-from");
  expect(parseGrant(note("Odd [invoke-from::all] [invoke-to::all] [max-hops::99] [cap::lots]"))!.problem).toMatch(/max-hops.*cap/);
});

const grant = (over: Partial<InvocationGrant> = {}): InvocationGrant => ({ id: "g1", title: "Let requests wake kitty", from: ["ext:requests"], to: ["kitty"], maxHops: 1, ...over });

test("no narrowing grant means any writer may wake any agent", () => {
  expect(decide([], EXT, "kitty", undefined, counts()).wake).toBe(true);
  expect(decide([grant({ to: ["scribe"] })], EXT, "kitty", undefined, counts()).wake).toBe(true);
  expect(decide([grant({ from: ["ext:other"] })], EXT, "kitty", undefined, counts()).wake).toBe(true);
  expect(decide([grant({ problem: "it has no [invoke-to::…]" })], EXT, "kitty", undefined, counts()).wake).toBe(true);
});

test("`agents` and `all` name a class of writer, `all` any agent", () => {
  const loki = { author: "agent" as const, actorId: "loki" };
  expect(decide([grant({ from: ["agents"] })], loki, "kitty", undefined, counts()).wake).toBe(true);
  expect(decide([grant({ from: ["agents"] })], EXT, "kitty", undefined, counts()).wake).toBe(true);
  expect(decide([grant({ from: ["all"], to: ["all"] })], EXT, "anyone", undefined, counts()).wake).toBe(true);
  expect(decide([grant({ from: ["loki"] })], loki, "kitty", undefined, counts()).wake).toBe(true);
});

test("hops, a repeat, a chain's budget and a daily cap each hold with their own reason", () => {
  const g = grant({ to: ["all"], maxHops: 2, budget: 2, cap: 3 });
  const first = decide([g], EXT, "kitty", undefined, counts());
  expect(first).toMatchObject({ wake: true, chain: { agents: ["ext:requests", "kitty"], hops: 1 } });
  const chain = (first as { chain: ReturnType<typeof newChain> }).chain;
  const second = decide([g], { author: "agent", actorId: "ext:requests" }, "scribe", chain, counts()) as { wake: true; chain: typeof chain };
  expect(second.wake).toBe(true);
  expect(second.chain.hops).toBe(2);
  // Hop 3 is past max-hops 2; the budget (2) is also spent: the first limit it meets is said.
  expect(decide([g], EXT, "third", second.chain, counts())).toEqual({ wake: false, why: "max-hops: allows 2 hops and this would be hop 3 · r to send" });
  // (With a hop limit out of the way the budget is what's met.)
  const wide = { ...g, maxHops: 8 };
  const w1 = decide([wide], EXT, "kitty", undefined, counts()) as Extract<ReturnType<typeof decide>, { wake: true }>;
  const w2 = decide([wide], EXT, "scribe", w1.chain, counts()) as Extract<ReturnType<typeof decide>, { wake: true }>;
  expect(decide([wide], EXT, "third", w2.chain, counts())).toEqual({ wake: false, why: "budget: all 2 wakes in this chain are spent · r to send" });
  expect((decide([g], EXT, "kitty", first.wake ? chain : undefined, counts()) as { why: string }).why).toBe("@kitty is already in this chain (@ext:requests → @kitty → @kitty), so a repeat is held · r to send");
  const used = counts(); for (let i = 0; i < 3; i++) used.spend("g1");
  expect((decide([g], EXT, "kitty", undefined, used) as { why: string }).why).toBe("cap: “Let requests wake kitty” is capped at 3/day, and it's used up today · r to send");
});

test("a chain keeps the tightest limits of the grants it came through, and a wake that never landed is given back", () => {
  const tight = grant({ id: "tight", to: ["all"], maxHops: 3, budget: 1 });
  const loose = grant({ id: "loose", title: "Let anything wake anything", from: ["all"], to: ["all"], maxHops: 8 });
  const day = counts();
  const first = decide([tight], EXT, "kitty", undefined, day) as Extract<ReturnType<typeof decide>, { wake: true }>;
  expect(first.wake).toBe(true);
  // The looser grant doesn't lift the first one's budget of 1.
  expect(decide([tight, loose], EXT, "scribe", first.chain, day)).toEqual({ wake: false, why: "budget: all 1 wakes in this chain are spent · r to send" });
  // Taken back (the patch didn't land): the day and the chain have their wake again.
  expect(day.count("tight")).toBe(1);
  first.refund();
  expect(day.count("tight")).toBe(0);
  expect(first.chain.spent.n).toBe(0);
});
