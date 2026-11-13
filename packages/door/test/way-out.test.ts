// How a refusal's way out is said in the door (src/surface/way-out.ts, the one sayer). The layout's rules name a way
// as an act (outline-core's way-out.ts); the door words it: the key its own tables give that act now for the person,
// the act line for an agent, nothing for an action the door hasn't. So the key a refusal names is read from the
// keymap (a key moved in keybindings.json is the key named), and no refusal names an action that is no row.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../scripts/layout-contract/env";
import "../src/app";
import "../src/screens";
import "../src/desk/screen-specs";
import { way, whyNot, type Way, type Why } from "@ep0ch/outline-core/way-out";
import { containerNamed } from "../src/desk/layout-refusal";
import type { Actor } from "../src/socket";
import { allActionSets } from "../src/surface/actions";
import { reloadKeymap, resetKeys, setKeys } from "../src/surface/keymap";
import { refusalSaid, saidToPerson, wayKey, wayLine, waySaid } from "../src/surface/way-out";

const PERSON: Actor = { kind: "user" }, AGENT: Actor = { kind: "agent", id: "seedling-agent" };
const FIXTURES = join(import.meta.dir, "../../outline-core/fixtures");
const table = <T>(file: string): T => JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as T;
/** Every refusal the contract tables hold: what the layout's rules answered, as data. */
const refusals = (): Why[] => [
  ...table<{ cases: { result: { refusal?: Why } }[] }>("layout-contract.json").cases.flatMap(c => (c.result.refusal ? [c.result.refusal] : [])),
  ...table<{ cases: { placement: { destination: { kind: string; reason?: string; ways?: Way[] } }; after?: { refusal?: Why } }[] }>("place-contract.json").cases.flatMap(c => [
    ...(c.placement.destination.kind === "none" ? [whyNot(c.placement.destination.reason!, ...(c.placement.destination.ways ?? []))] : []), ...(c.after?.refusal ? [c.after.refusal] : []),
  ]),
];

describe("a refusal's way out, said in the door's own words", () => {
  const was = process.env.EP0CH_KEYMAP;
  beforeAll(() => { process.env.EP0CH_KEYMAP = join(mkdtempSync(join(tmpdir(), "keymap-")), "keybindings.json"); reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });

  test("the person reads the key from the door's tables, with where their keys are; an agent reads the act line", () => {
    const kept = whyNot("log stays: s3 keeps its tiles", way("layout.policy", "turns closable on", { args: { node: "s3", closable: true }, at: "there" }));
    expect(refusalSaid(kept, PERSON)).toBe("log stays: s3 keeps its tiles · ^W P there turns closable on");
    expect(refusalSaid(kept, AGENT)).toBe("log stays: s3 keeps its tiles · layout.policy node=s3 closable=true turns closable on");
    // The ^W key that runs the act whole: the one whose arguments the act has, never a key that waits for another.
    expect(wayKey(way("tile.float", "", { args: { on: false } }))).toBe("^W f");
    expect(wayKey(way("tile.float", "", { args: { to: "glass" } }))).toBe("^W U");
    expect(wayKey(way("layout.move", "", { args: { to: "shelf", where: "right" } }))).toBe("^W T");
    // A key the desk handles itself is an act's key only when the act has what that key's run always has: ^W T takes
    // a tab out to the right, so a move that names no place is not it (a float told "^W T places it" was told a key
    // that answers "isn't in a tab set"). It is said by the key the action's own row declares.
    expect(wayKey(way("layout.move", "places it beside a tile"))).toBe("^W m");
    expect(waySaid(way("layout.move", "places it beside a tile"), PERSON)).toBe("^W m places it beside a tile");
    expect(wayKey(way("tile.close", ""))).toBe("^W x");
    // A key the action's own row declares, where the ^W table has none for it.
    expect(wayKey(way("host.toggle", ""))).toBe("alt+a");
    expect(wayKey(way("screen.back", ""))).toBe("q");
    expect(wayKey(way("layout.lock", "", { args: { on: false } }))).toBe("^W P");
    // No key runs it: the person reads the act line too.
    expect(waySaid(way("layout.get", "gives each split's id"), PERSON)).toBe("layout.get gives each split's id");
  });

  test("a control the layout names is said to the person, a way that follows another says so, and one that is the person's alone says whose", () => {
    const locked = whyNot("the screen is locked: closing log is refused", way("host.toggle", "puts the drawer away", { args: { open: false } }), way("layout.lock", "unlocks it", { args: { on: false }, at: "with the keys in the screen", on: "▣ screen locked", then: true }));
    expect(refusalSaid(locked, PERSON)).toBe("the screen is locked: closing log is refused · alt+a puts the drawer away, then a click on ▣ screen locked (or ^W P with the keys in the screen) unlocks it");
    expect(refusalSaid(locked, AGENT)).toBe("the screen is locked: closing log is refused · host.toggle open=false puts the drawer away, then layout.lock on=false unlocks it");
    const theirs = way("tile.agent", "frees it", { args: { policy: "free" }, tile: "log", on: "its chip", theirs: true });
    expect(waySaid(theirs, AGENT)).toBe("the person's ^W g (tile.agent tile=log policy=free) frees it");
    expect(waySaid(theirs, PERSON)).toBe("a click on its chip (or ^W g) frees it");
    // Another way, not a step after the first: "or".
    expect(refusalSaid(whyNot("sown stays", way("tile.collapse", "folds it to a spine", { tile: "sown" }), way("layout.policy", "turns closable on", { at: "there" })), PERSON)).toBe("sown stays · ^W c folds it to a spine, or ^W P there turns closable on");
  });

  test("a way that names a container says its act line too: the panel's key reaches only the containers of the tile with the keys", () => {
    // ^W P opens the panel for the focused tile's own containers. A container the layout names by id may be none of
    // them, so the act that names it is said first, and the key with where it holds.
    const fixed = whyNot("s3 is fixed at 20 cells", way("layout.policy", "frees it", { args: { node: "s3", clear: "fixed" } }));
    expect(refusalSaid(fixed, PERSON)).toBe("s3 is fixed at 20 cells · layout.policy node=s3 clear=fixed (or ^W P in s3) frees it");
    expect(refusalSaid(fixed, AGENT)).toBe("s3 is fixed at 20 cells · layout.policy node=s3 clear=fixed frees it");
    const locked = whyNot("g2 is locked: closing log is refused", way("layout.policy", "unlocks it", { args: { node: "g2", locked: false } }));
    expect(refusalSaid(locked, PERSON)).toBe("g2 is locked: closing log is refused · layout.policy node=g2 locked=false (or ^W P in g2) unlocks it");
    // Where the layout says where the keys are for the key to mean it, the key is enough; and every tile is in the screen.
    expect(waySaid(way("layout.policy", "turns closable on", { args: { node: "s3", closable: true }, at: "there" }), PERSON)).toBe("^W P there turns closable on");
    expect(waySaid(way("layout.policy", "loosens it", { args: { node: "screen", agents: "free" } }), PERSON)).toBe("^W P loosens it");
    // The tables hold such refusals: each names its container to the person.
    const held = refusals().flatMap(w => w.ways.filter(each => each.act === "layout.policy" && typeof each.args?.node === "string" && each.args.node !== "screen" && !each.at).map(each => waySaid(each, PERSON)!));
    expect(held.length).toBeGreaterThan(0);
    for (const said of held) expect(said).toMatch(/^layout\.policy node=[sgdcf]\d+ \S+ \(or \^W P in [sgdcf]\d+\) /);
  });

  test("what an agent was told is said again for the person: the refusal is data, and each reads their own way out", () => {
    const locked = whyNot("the screen is locked: closing log is refused", way("layout.lock", "unlocks it", { args: { on: false }, on: "▣ screen locked" }));
    const told = refusalSaid(locked, AGENT);
    expect(told).toBe("the screen is locked: closing log is refused · layout.lock on=false unlocks it");
    expect(saidToPerson(told)).toBe("the screen is locked: closing log is refused · a click on ▣ screen locked (or ^W P) unlocks it");
    // With words around it (the drawer's, a carry's), those stay.
    expect(saidToPerson(`your drawer doesn't take log there: ${told}`)).toBe("your drawer doesn't take log there: the screen is locked: closing log is refused · a click on ▣ screen locked (or ^W P) unlocks it");
    // What no refusal of the sayer's is in stays as it is, and so does what the person was told themselves.
    expect(saidToPerson("no tile named shed here")).toBe("no tile named shed here");
    expect(saidToPerson(refusalSaid(locked, PERSON))).toBe(refusalSaid(locked, PERSON));
  });

  test("why an open landed elsewhere names what undoes it as an act too: a pinned reader's key is read from the keymap", () => {
    const pinned = whyNot("pinboard is pinned: opened beside it", way("reader.pin", "unpins it", { args: { on: false }, tile: "pinboard", at: "in pinboard" }));
    expect(refusalSaid(pinned, PERSON)).toBe("pinboard is pinned: opened beside it · p in pinboard unpins it");
    expect(refusalSaid(pinned, AGENT)).toBe("pinboard is pinned: opened beside it · reader.pin tile=pinboard on=false unpins it");
    setKeys("reader.pin", ["u"]);
    try { expect(refusalSaid(pinned, PERSON)).toBe("pinboard is pinned: opened beside it · u in pinboard unpins it"); } finally { resetKeys("reader.pin"); }
    // The tables hold it so: the placement's reason, and the way beside it.
    const held = table<{ cases: { placement: { why?: string; ways?: Way[] } }[] }>("place-contract.json").cases.filter(c => c.placement.ways?.length);
    expect(held.length).toBeGreaterThanOrEqual(3);
    for (const c of held) expect(refusalSaid(whyNot(c.placement.why!, ...c.placement.ways!), PERSON)).toBe(`${c.placement.why} · p in pinboard unpins it`);
  });

  test("an action the door hasn't is not said: the reason stands alone, and with other ways they are said without it", () => {
    const gone = way("garden.dig", "turns the bed over");
    expect(waySaid(gone, PERSON)).toBeNull();
    expect(refusalSaid(whyNot("the bed is frozen", gone), AGENT)).toBe("the bed is frozen");
    expect(refusalSaid(whyNot("the bed is frozen", gone, way("tile.close", "closes it", { tile: "bed" })), AGENT)).toBe("the bed is frozen · tile.close tile=bed closes it");
  });

  test("the key named is read from the keymap: moved in keybindings.json, the refusal names where it went", () => {
    const running = whyNot("hose is running water", way("tile.close", "ends it first", { tile: "hose" }));
    expect(refusalSaid(running, PERSON)).toBe("hose is running water · ^W x ends it first");
    setKeys("tile.close", ["ctrl+w q"]);
    try {
      expect(refusalSaid(running, PERSON)).toBe("hose is running water · ^W q ends it first");
      expect(refusalSaid(running, AGENT)).toBe("hose is running water · tile.close tile=hose ends it first");   // the act is the act, whatever key runs it
    } finally { resetKeys("tile.close"); }
    expect(refusalSaid(running, PERSON)).toBe("hose is running water · ^W x ends it first");
  });

  test("every way the layout's rules name is an action the door has, and is said: to the person with no action spelled where a key runs it", () => {
    const has = (action: string) => allActionSets().some(s => s.has(action));
    const all = refusals(), ways = all.flatMap(r => r.ways);
    expect(all.length).toBeGreaterThan(120);
    expect(ways.length).toBeGreaterThan(60);
    // No refusal names an action that is no row.
    expect([...new Set(ways.map(w => w.act))].filter(act => !has(act))).toEqual([]);
    for (const r of all) {
      const person = refusalSaid(r, PERSON), agent = refusalSaid(r, AGENT);
      expect(person.startsWith(r.reason) && agent.startsWith(r.reason)).toBe(true);
      // Every way is said, by what it does.
      for (const w of r.ways) { expect(person).toContain(w.does); expect(agent).toContain(w.does); expect(agent).toContain(wayLine(w)); }
      // The person reads a key where one runs the act, with no act line beside it: but for a way that names a container
      // by id and no place for the keys, whose key may open on other containers (the act line says which).
      for (const w of r.ways) if (wayKey(w)) {
        expect(person).toContain(wayKey(w)!);
        const far = containerNamed(w) !== undefined && !w.at && !w.on;
        if (far) expect(person).toContain(`${wayLine(w)} (or ${wayKey(w)} in ${containerNamed(w)})`);
        else if (w.args) expect(person).not.toContain(wayLine(w));
      }
    }
  });
});
