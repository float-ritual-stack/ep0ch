import { describe, expect, test } from "bun:test";
import { callOf, composeActor, composeSessionId, isCallId, mintCallId, parseActor, parseSessionId } from "../src/attribution";
import { FORBIDDEN_WORDS, NAME_FIRST, NAME_SECOND, NAME_THIRD, freeHandle, seedHandle } from "../src/call-handles";
import { parseQueryAtom, showQueryAtom } from "../src/query-atoms";

describe("call ids and handles (PIE-685)", () => {
  test("a sessionId holds the subject and the call, parseable, and the actor id is untouched", () => {
    const sessionId = composeSessionId({ subject: "user_fictional_a", call: "c-7f3a1c" });
    expect(sessionId).toBe("user_fictional_a#c-7f3a1c");
    expect(parseSessionId(sessionId)).toEqual({ subject: "user_fictional_a", call: "c-7f3a1c" });
    expect(callOf(sessionId)).toBe("c-7f3a1c");
    expect(parseSessionId("stdio")).toEqual({ subject: "stdio" });
    expect(parseSessionId("a#b#daddy-2026-10-09-0103-k7f")).toEqual({ subject: "a#b", call: "daddy-2026-10-09-0103-k7f" });
    expect(composeSessionId({ subject: "stdio", call: "not valid!" })).toBe("stdio");
    const actor = composeActor({ persona: "daddy", principal: "claude.ai", mcp: true });
    expect(parseActor(actor).label).toBe("daddy (claude.ai)");
    expect(actor).not.toContain("#");
  });

  test("minted ids are distinct and well formed", () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintCallId()));
    expect(ids.size).toBeGreaterThan(190);
    for (const id of ids) expect(isCallId(id) && /^c-[0-9a-f]{6}$/.test(id)).toBe(true);
  });

  test("a handle is seeded by the id, three words; an agent's own id is its own handle", () => {
    expect(seedHandle("c-7f3a1c")).toBe(seedHandle("c-7f3a1c"));
    expect(seedHandle("c-7f3a1c")).toMatch(/^[a-z]+_[a-z]+_[a-z]+$/);
    expect(seedHandle("daddy-2026-10-09-0103-k7f")).toBe("daddy-2026-10-09-0103-k7f");
    expect(new Set(Array.from({ length: 2000 }, (_, i) => seedHandle(`c-${(i * 7919).toString(16).padStart(6, "0")}`))).size).toBeGreaterThan(1990);
  });

  test("the word lists are about 200 each, lower case, without repeats and without persona or product words", () => {
    for (const list of [NAME_FIRST, NAME_SECOND, NAME_THIRD]) {
      expect(list.length).toBeGreaterThanOrEqual(190);
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) { expect(w).toMatch(/^[a-z]+$/); expect(FORBIDDEN_WORDS as readonly string[]).not.toContain(w); }
    }
  });

  test("a taken handle takes a suffix", () => {
    const seed = seedHandle("c-7f3a1c");
    expect(freeHandle("c-7f3a1c", () => false)).toBe(seed);
    expect(freeHandle("c-7f3a1c", h => h === seed)).toBe(`${seed}_2`);
    expect(freeHandle("c-7f3a1c", h => h === seed || h === `${seed}_2`)).toBe(`${seed}_3`);
  });

  test("call: is a query atom", () => {
    expect(parseQueryAtom("call:c-7f3a1c")).toEqual({ kind: "call", call: "c-7f3a1c" });
    expect(showQueryAtom({ kind: "call", call: "c-7f3a1c" })).toBe("call:c-7f3a1c");
    expect(() => parseQueryAtom("call:")).toThrow();
    expect(() => parseQueryAtom("call:no spaces")).toThrow();
  });
});
