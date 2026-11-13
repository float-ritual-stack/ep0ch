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
import type { Actor } from "../src/socket";
import { allActionSets } from "../src/surface/actions";
import { reloadKeymap, resetKeys, setKeys } from "../src/surface/keymap";
import { refusalSaid, wayKey, wayLine, waySaid } from "../src/surface/way-out";

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
      // The person reads a key where one runs the act, never the act line beside it.
      for (const w of r.ways) if (wayKey(w)) { expect(person).toContain(wayKey(w)!); if (w.args) expect(person).not.toContain(wayLine(w)); }
    }
  });
});
