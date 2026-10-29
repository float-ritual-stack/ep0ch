// PIE-1048: an action's keys are rows of keys and what each does (ActionDef.keys, KeyRow), or one line that reads
// cleanly as them. Its page (::graph-keys), the power bar's keycap column, the hint rows, the keys window and the README
// read the same rows, so a line that parses into nonsense (a lone "or", a description under the wrong key) is refused here.
import { describe, expect, test } from "bun:test";
import "../src/app";
import "../src/screens";
import { allActionSets, isKeyWord, type KeyRow } from "../src/surface/actions";
import { keyAlternatives } from "../src/figures/keys";

/** Mouse gestures a row may name instead of keys. */
const GESTURES = /^(?:(?:double|alt|ctrl|right|shift|middle|second)-)?(?:click|drag|wheel|paste|swipe|hover)$/;
/** A key row's keys, as `::graph-keys` draws them: every word a key, a gesture, or a joining word. */
const readsAsKeys = (keys: string) => keys.trim().split(/\s+/).every(w => /^(then|or|and)$/.test(w) || GESTURES.test(w) || /^✦\S$/u.test(w) || isKeyWord(w));

function builtIns() {
  const seen = new Set<string>();
  return allActionSets().flatMap(s => s.list()).filter(a => !a.name.startsWith("ext.") && !seen.has(`${a.scope}:${a.name}`) && seen.add(`${a.scope}:${a.name}`));
}

describe("an action's keys", () => {
  test("every key row reads as keycaps and says what it does; a line of keys parses without a lone `or`", () => {
    const wrong: string[] = [];
    for (const a of builtIns()) {
      if (!a.keys) continue;
      if (typeof a.keys === "string") {
        for (const r of keyAlternatives(a.keys)) if (r.keys === "or" || !readsAsKeys(r.keys)) wrong.push(`${a.scope}:${a.name}: "${r.keys === "or" ? r.action : r.keys}" isn't keys: write its keys as rows (KeyRow)`);
        continue;
      }
      for (const r of a.keys as readonly KeyRow[]) {
        if ("via" in r) { if (!r.via.trim()) wrong.push(`${a.scope}:${a.name}: an empty via row`); continue; }
        if (!readsAsKeys(r.keys)) wrong.push(`${a.scope}:${a.name}: "${r.keys}" doesn't read as keys`);
        if (!r.does.trim()) wrong.push(`${a.scope}:${a.name}: ${r.keys} says nothing about what it does`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

test("a line built from an action's keys says them as words, never [object Object] (the facets tile's hint, `actions`)", async () => {
  const { FacetsPane } = await import("../src/desk/facets");
  expect(new FacetsPane().hint()).not.toContain("[object");
  expect(new FacetsPane().hint()).toContain("[: less");
});

test("every row of the keys window reads as a whole sentence: the action's own words, then where or when (PIE-1425)", async () => {
  const { bindings } = await import("../src/surface/key-catalog");
  const wrong: string[] = [];
  for (const b of bindings()) {
    if (b.from !== "action") continue;
    // A key typed into the power bar (`> share.list`, `^K then macro.record`) isn't a binding of the action: it's the bar's.
    if ((b.key === ">" && b.does.includes("power bar")) || /^then\s+\S+\.\S/.test(b.does)) wrong.push(`${b.cap} ${b.id}: "${b.does}" is a line typed in the power bar, not a key: write it as a via row`);
    else if (!b.does.startsWith(b.about)) wrong.push(`${b.cap} ${b.id}: "${b.does}" doesn't start with what ${b.id} does ("${b.about}")`);
  }
  expect(wrong).toEqual([]);
});

test("a row says what it does in a person's words: no act arguments, no cut-off clause, and keys that do different things read differently", async () => {
  const { bindings, unbound } = await import("../src/surface/key-catalog");
  const all = bindings(), wrong: string[] = [];
  for (const b of [...all, ...unbound(all)]) {
    if (b.from === "table") continue;
    // `tile=<tile>`, `by=<rows>`: act's grammar, not words; a clause cut before its object ("put the person's").
    if (/=<|<\w[\w ]*>/.test(b.about) || /\b(the person's|a|the)$/.test(b.about) || b.about.split(/\s+/).length < 2 || /,,|, ,/.test(b.does))
      wrong.push(`${b.cap || "(no key)"} ${b.id}: "${b.about}": give its ActionDef words (what it does, as a person reads it)`);
  }
  expect([...new Set(wrong)]).toEqual([]);
  // A table's four keys each say their own operation.
  const rich = all.filter(b => b.action === "rich.change").map(b => b.does);
  expect(new Set(rich).size).toBe(rich.length);
});
