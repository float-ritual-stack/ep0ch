// The screen as data (src/screen-spec.ts), an action's row (src/action-row.ts) and the act line (src/action-line.ts),
// checked against the contract tables in ../fixtures: what the door answers for made-up layouts, opens and lines
// (packages/door/scripts/layout-contract.ts makes them, the door's test/layout-contract.test.ts keeps them true). This
// suite is the half a client without the door can run: every table reads through outline-core's own shapes and checks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { actRequestOf, lineWords } from "../src/action-line";
import { actionRow, isKeyName, type ActionRow } from "../src/action-row";
import {
  AGENT_LEVELS, canonKind, containerKeys, groupSpec, isAgentLevel, leafNames, matches, menuRowProblem, newNoteRule, parseTileAddress, partSpec, policyOf, readSpec, resolveAddress, resolveRelative,
  savedNodes, screenNameProblem, screenParts, screenSlug, slotNames, specData, tileNameProblem, whyNone, WIRE_VERBS, OPEN_RULES, ALT_RULES, POLICY_KEYS,
  type AddressCandidate, type LayoutSpec, type ScreenSpec, type TileAddress,
} from "../src/screen-spec";

const table = <T>(file: string): T => JSON.parse(readFileSync(join(import.meta.dir, "../fixtures", file), "utf8")) as T;
const screens = table<{ screens: { name: string; target?: string; spec: ScreenSpec }[] }>("screens.json").screens;
const layoutCases = table<{ cases: { name: string; layout: LayoutSpec; result: { ok: boolean; layout?: LayoutSpec; refused?: string } }[] }>("layout-contract.json").cases;
const placeCases = table<{ cases: { name: string; layout: LayoutSpec; lands: { tile: string | null; kind: string }; after?: { ok: boolean; layout?: LayoutSpec } }[] }>("place-contract.json").cases;
const everyLayout = [...layoutCases.flatMap(c => [c.layout, ...(c.result.layout ? [c.result.layout] : [])]), ...placeCases.flatMap(c => [c.layout, ...(c.after?.layout ? [c.after.layout] : [])])];

describe("a screen's spec, read back (readSpec)", () => {
  test("every screen the door ships reads back as it was written", () => {
    expect(screens.length).toBeGreaterThan(10);
    for (const s of screens) expect(readSpec(specData(s.spec))).toEqual(s.spec);
  });

  test("the kinds are checked only when the caller says which exist", () => {
    const spec = screens.find(s => s.name === "lastcall")!.spec;
    expect(readSpec(spec, kind => kind === "activity" || kind === "reader")).toEqual(spec);
    expect(() => readSpec(spec, kind => kind === "reader")).toThrow(/no tile kind activity here/);
    // A retired name for a kind is asked by the kind it is now.
    const asked: string[] = [];
    readSpec({ name: "old", title: "old", layout: { root: { t: "leaf", kind: "detail", name: "detail" } } }, kind => (asked.push(kind), true));
    expect(asked).toEqual(["reader"]);
  });

  test("a bad spec is refused with what's wrong", () => {
    const ok = { name: "potting", title: "Potting bench", layout: { root: { t: "split", dir: "row", weights: [0.3, 0.7], key: "bench", kids: [{ t: "leaf", kind: "tree", name: "trays" }, { t: "leaf", kind: "reader", name: "tray", slot: "detail" }] } } };
    expect(readSpec(ok)).toEqual(ok as ScreenSpec);
    expect(() => readSpec(null)).toThrow(/is an object/);
    expect(() => readSpec({ ...ok, name: "9 trays" })).toThrow(/a screen's name/);
    expect(() => readSpec({ ...ok, title: " " })).toThrow(/title/);
    expect(() => readSpec({ ...ok, layout: {} })).toThrow(/with a root/);
    expect(() => readSpec({ ...ok, keys: [{ key: "enterr", action: "tile.close" }] })).toThrow(/names no key/);
    expect(() => readSpec({ ...ok, keys: [{ key: "x" }] })).toThrow(/names no action/);
    expect(() => readSpec({ ...ok, keys: [{ key: "x", action: "tile.close", tile: "shed" }] })).toThrow(/runs in tile shed/);
    expect(() => readSpec({ ...ok, band: "shed" })).toThrow(/band is drawn by tile shed/);
    expect(() => readSpec({ ...ok, lands: "shed" })).toThrow(/lands names shed/);
    expect(() => readSpec({ ...ok, menu: { key: "ab", label: "Potting" } })).toThrow(/menu row's key/);
    expect(() => readSpec({ ...ok, newNote: [{ opens: "window" }] })).toThrow(/opens "window"/);
    // What it names is a tile, a tile's slot, or a container's key; a key may run in every tile.
    const named = readSpec({ ...ok, lands: "detail", home: "bench", keys: [{ key: "x", action: "tile.collapse", tile: "all", unless: ["detail"] }], menu: { key: "p", label: " Potting " }, hint: { tree: "j k", "*": "q", stray: 1 }, frame: "dotted", digits: false, stray: true });
    expect(named).toMatchObject({ lands: "detail", home: "bench", keys: [{ key: "x", action: "tile.collapse", tile: "all", unless: ["reader"] }], menu: { key: "P", label: "Potting" }, hint: { tree: "j k", "*": "q" }, frame: "dotted", digits: false });
    expect("stray" in named).toBe(false);
  });

  test("names: a screen's, a title's slug, a tile's", () => {
    expect(screenNameProblem("garden-work")).toBeNull();
    expect(screenNameProblem("9lives")).toMatch(/a letter, then letters/);
    expect(screenSlug("  Garden   Work! ")).toBe("garden-work");
    expect(tileNameProblem("bed")).toBeNull();
    expect(tileNameProblem("3")).toMatch(/isn't a number/);
    expect(tileNameProblem("t4")).toMatch(/shaped like an id/);
    expect(tileNameProblem("north bed")).toMatch(/starts with a letter/);
    expect(menuRowProblem({ key: "G", label: "Garden" })).toBeNull();
    expect(newNoteRule({ newNote: [{ only: ["query"], action: "card.new" }, { opens: "tab" }] }, "query")).toEqual({ only: ["query"], action: "card.new" });
    expect(newNoteRule({ newNote: [{ only: ["query"], action: "card.new" }] }, "reader")).toBeNull();
  });
});

describe("the saved layout tree", () => {
  test("every tile in the tables is found by the one walk, by a name that is a tile's name", () => {
    expect(everyLayout.length).toBeGreaterThan(500);
    for (const l of everyLayout) {
      const leaves = savedNodes(l.root).filter(n => n.t === "leaf");
      expect(leafNames(l.root)).toEqual(leaves.map(n => n.name));
      for (const name of leafNames(l.root)) expect(tileNameProblem(name)).toBeNull();
      for (const n of savedNodes(l.root)) expect(["leaf", "split", "tabs", "dock", "columns", "flow"]).toContain(n.t);
    }
  });

  test("a policy the door saved reads back whole; a hand-edited one keeps only what a policy has", () => {
    const policies = everyLayout.flatMap(l => [l.policy, ...savedNodes(l.root).map(n => n.policy)]).filter(Boolean);
    expect(policies.length).toBeGreaterThan(100);
    for (const p of policies) expect(policyOf(p)).toEqual(p);
    for (const key of new Set(policies.flatMap(p => Object.keys(p)))) expect(POLICY_KEYS as readonly string[]).toContain(key);
    expect(policyOf({ draggable: "yes", min: 20.4, max: -3, accepts: ["detail", "reader", 7, "no such kind!"], opens: "current", altOpens: "sideways", spines: "book", host: "over", agents: "edit", stray: true }))
      .toEqual({ min: 20, accepts: ["reader"], opens: "reader", spines: "book", host: "over", agents: "edit" });
    expect(policyOf(null)).toEqual({});
    expect(canonKind("pinned")).toBe("reader");
    expect(AGENT_LEVELS.every(isAgentLevel)).toBe(true);
    expect(isAgentLevel("loose")).toBe(false);
    expect([OPEN_RULES.length, ALT_RULES.length, WIRE_VERBS.length]).toEqual([6, 4, 4]);
  });

  test("a part of a screen, and a group, are screens of their own", () => {
    const board = screens.find(s => s.name === "board")!.spec;
    expect(screenParts(board)).toEqual([...containerKeys(board.layout.root), ...leafNames(board.layout.root)]);
    const key = containerKeys(board.layout.root)[0]!;
    const part = partSpec(board, key);
    expect(part.title).toBe(`board · ${key}`);
    expect("saves" in part).toBe(false);
    // What the part names is in the part: a key bound to a tile outside it is left out.
    const inside = new Set([...slotNames(part.layout.root), ...containerKeys(part.layout.root), "all"]);
    for (const b of part.keys ?? []) if (b.tile !== undefined) expect(inside.has(b.tile)).toBe(true);
    expect(() => partSpec(board, "orchard")).toThrow(/has no part orchard/);
    expect(groupSpec({ t: "leaf", kind: "reader", name: "bed" }, "the beds")).toEqual({ name: "group", title: "the beds", digits: false, layout: { root: { t: "leaf", kind: "reader", name: "bed" } } });
  });
});

describe("the tile address", () => {
  const candidate = (id: string, name: string, role: string, screen: string, more: Partial<AddressCandidate<string>> = {}): AddressCandidate<string> => ({ value: name, id, name, role, slots: [name], screen, where: () => `${name} on ${screen}`, ...more });
  const tiles = [
    candidate("t-0a1b2c3d-0000", "beds", "tree", "garden-work"),
    candidate("t-0a1b9999-0000", "bed", "reader", "garden-work", { from: "t-0a1b2c3d-0000", slots: ["bed", "detail"] }),
    candidate("t-7e7e7e7e-0000", "glance", "reader", "board", { from: "t-0a1b9999-0000" }),
    candidate("t-5c5c5c5c-0000", "fern", "agent", "drawer", { usedAt: 10 }),
    candidate("t-6d6d6d6d-0000", "moss", "agent", "drawer", { usedAt: 30 }),
  ];

  test("the table's addresses parse as the door parses them", () => {
    const rows = table<{ addresses: { tile: string; address: TileAddress }[] }>("act-lines.json").addresses;
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) expect(parseTileAddress(r.tile)).toEqual(r.address);
  });

  test("an id, a role, a slot and a relative address each name one tile, or say why none", () => {
    const one = (text: string) => resolveAddress(parseTileAddress(text), tiles)?.name ?? null;
    expect(one("t-0a1b2c3d")).toBe("beds");
    expect(one("detail@garden-work")).toBe("bed");
    expect(one("role:tree")).toBe("beds");
    expect(one("role:reader@board")).toBe("glance");
    // Of several agent tabs, the one the person used last.
    expect(one("role:agent")).toBe("moss");
    expect(one("drawer.agent")).toBe("moss");
    expect(one("bed")).toBeNull();
    expect(() => one("role:reader")).toThrow(/names 2 tiles: .*use tile=<id> or role:reader@<screen>/);
    expect(matches(parseTileAddress("t-0a1b"), tiles)).toEqual([]);
    const up = (text: string, from?: string) => resolveRelative(parseTileAddress(text) as Extract<TileAddress, { kind: "relative" }>, tiles, from).name;
    expect(up("^", "t-7e7e7e7e-0000")).toBe("bed");
    expect(up("^^", "t-7e7e7e7e-0000")).toBe("beds");
    expect(() => up("^^^", "t-7e7e7e7e-0000")).toThrow(/nothing recorded opening it/);
    expect(() => up("^")).toThrow(/none has your keys here/);
    expect(whyNone(parseTileAddress("t-0a1b2c00"), tiles)).toMatch(/did you mean t-0a1b2c3d-0000/);
    expect(whyNone(parseTileAddress("role:gardener"), tiles)).toMatch(/roles here: agent, reader, tree/);
    expect(whyNone(parseTileAddress("detail@orchard"), tiles)).toMatch(/no screen orchard is on show/);
    expect(whyNone(parseTileAddress("shed@board"), tiles)).toMatch(/board has no slot shed; its slots: glance/);
    expect(whyNone(parseTileAddress("bed"), tiles)).toBeNull();
  });
});

describe("an action's row, and the line that runs it", () => {
  const rows = table<{ rows: (ActionRow & { scope: string })[] }>("action-rows.json").rows;

  test("every row the door has is a row: made again from itself, it is the same", () => {
    expect(rows.length).toBeGreaterThan(500);
    for (const { scope: _scope, ...row } of rows) expect(actionRow(row.id, row)).toEqual(row);
    expect(new Set(rows.map(r => `${r.scope}\0${r.id}`)).size).toBe(rows.length);
  });

  test("a row is data: what runs is left out, a lone menu row is a list", () => {
    const row = actionRow("bed.water", {
      summary: "water the bed", touches: "tile", while: "typing", keys: [{ keys: "w", does: "water it" }], args: { litres: { type: "number", optional: true, about: "how much" } },
      menu: { label: "water", group: "Bed", now: () => ({ hide: true }) } as never, examples: [], run: () => 1,
    } as never);
    expect(row).toEqual({ id: "bed.water", summary: "water the bed", args: { litres: { type: "number", optional: true, about: "how much" } }, touches: "tile", keys: [{ keys: "w", does: "water it" }], while: "typing", menu: [{ label: "water", group: "Bed" }] });
  });

  test("a screen's keys are key names", () => {
    for (const s of screens) for (const b of s.spec.keys ?? []) expect(isKeyName(b.key)).toBe(true);
    for (const k of ["q", "Q", ",", "enter", "esc", "space", "shift+tab", "alt+left", "alt+c", "ctrl+w", "super+k"]) expect(isKeyName(k)).toBe(true);
    for (const k of ["", " ", "enterr", "ctrl+W", "alt-left", "click", "drag", 3]) expect(isKeyName(k)).toBe(false);
  });

  test("every act line in the table reads as the door read it", () => {
    const lines = table<{ lines: { line: string; repeats?: "list"; words: string[]; request?: object; refused?: string }[] }>("act-lines.json").lines;
    expect(lines.length).toBeGreaterThan(30);
    for (const l of lines) {
      expect(lineWords(l.line)).toEqual(l.words);
      if (l.request) expect(actRequestOf(l.words, l.repeats ? { repeats: l.repeats } : {})).toEqual(l.request as never);
      else expect(() => actRequestOf(l.words)).toThrow(l.refused!);
    }
  });
});
