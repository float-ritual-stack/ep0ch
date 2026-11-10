// Nov 3 review card 15: ctrl+z reads one journal per note. Each producer (a step, a callout, a picture, a ::use, a
// source line, an extension's write, a note move, a setting) writes an entry that carries its note, kind, what takes
// it back, its maker and a label; undo takes the newest of the note, whatever the kind. Made-up notes, no host.
import { describe, expect, test } from "bun:test";
import { newestOf, NOTE_JOURNAL, SETTINGS_JOURNAL, UndoHistory, UndoJournal, undoneSaid, type UndoKind } from "../src/undo-journal";

/** The eight producers and the action that takes each back, in the order a mix is made. */
const KINDS: [UndoKind, string, string][] = [
  ["step", "task.undo", `"Sow the beans" done`],
  ["callout", "callout.undo", "callout > [!note]+ Keys"],
  ["image", "image.undo", "picture layout width=40"],
  ["use", "use.undo", "::use fill"],
  ["source", "sources.undo", "source line edit"],
  ["ext", "ext.undo", "Tidy"],
  ["move", "note.move.undo", "move"],
];

type Plain = { by: string; context: string };
const producers = (j: UndoJournal) => new Map(KINDS.map(([kind, via, label]) => [kind, new UndoHistory<Plain>(j, { kind, via, label: () => label })]));

describe("one journal per note", () => {
  test.each([["you"], ["agent:fixture-agent"]])("an undo after a mix by %s takes back newest first, saying what and who", (maker) => {
    const j = new UndoJournal(), by = producers(j), A = "note-a", B = "note-b";
    for (const [kind] of KINDS) {
      by.get(kind)!.push({ by: maker, context: A });
      by.get(kind)!.push({ by: maker, context: B });   // another note's change between each: never A's to undo
    }
    const taken: string[] = [];
    for (let e = j.last(maker, A); e; e = j.last(maker, A)) {
      taken.push(`${e.kind} via ${e.via}: ${undoneSaid(e)}`);
      j.drop(e);
    }
    const who = maker === "you" ? "made by you" : `made by ${maker}`;
    expect(taken).toEqual([...KINDS].reverse().map(([kind, via, label]) => `${kind} via ${via}: undid ${label} (${who})`));
    // Note B's six-and-one changes are all still there, in order, and A's undo never took any.
    expect(j.list(maker, B).map(e => e.kind)).toEqual([...KINDS].reverse().map(([k]) => k));
  });

  test("the person's undo never takes an agent's change, nor an agent's the person's", () => {
    const j = new UndoJournal(), h = new UndoHistory<Plain>(j, { kind: "callout", via: "callout.undo", label: (): string => "callout" });
    h.push({ by: "you", context: "n" });
    h.push({ by: "agent:x", context: "n" });
    expect(j.last("you", "n")!.by).toBe("you");
    expect(j.last("agent:x", "n")!.by).toBe("agent:x");
    expect(undoneSaid(j.last("agent:x", "n")!)).toBe("undid callout (made by agent:x)");
  });

  test("a producer's size and advance see only its own kind", () => {
    const j = new UndoJournal();
    const steps = new UndoHistory<Plain & { block: string; at: { revision: number } }>(j, { kind: "step", via: "task.undo", label: () => "step" });
    const moves = new UndoHistory<Plain & { block: string; at: { revision: number } }>(j, { kind: "move", via: "note.move.undo", label: () => "move" });
    steps.push({ by: "you", context: "n", block: "n", at: { revision: 3 } });
    moves.push({ by: "you", context: "n", block: "n", at: { revision: 3 } });
    expect([steps.size("n"), moves.size("n")]).toEqual([1, 1]);
    steps.advance("n", 3, 4);
    expect([j.lastOf("step", "you", "n")!.at.revision, j.lastOf("move", "you", "n")!.at.revision]).toEqual([4, 3]);
  });

  test("settings keep a journal of their own scope, the same type, and the newest of both is the one taken", () => {
    expect(SETTINGS_JOURNAL).not.toBe(NOTE_JOURNAL);
    expect(SETTINGS_JOURNAL).toBeInstanceOf(UndoJournal);
    const note = new UndoJournal(), settings = new UndoJournal();
    new UndoHistory<Plain>(note, { kind: "callout", via: "callout.undo", label: () => "callout" }).push({ by: "you", context: "n" });
    new UndoHistory<Plain>(settings, { kind: "settings", via: "settings.undo", label: () => "settings sort" }).push({ by: "you", context: "n" });
    expect(newestOf([note, settings], "you", "n")!.via).toBe("settings.undo");
    const e = newestOf([note, settings], "you", "n")!;
    settings.drop(e);
    expect(newestOf([note, settings], "you", "n")!.via).toBe("callout.undo");
  });

  test("a note keeps its newest hundred", () => {
    const j = new UndoJournal(), h = new UndoHistory<Plain>(j, { kind: "source", via: "sources.undo", label: () => "edit" });
    for (let i = 0; i < 130; i++) h.push({ by: "you", context: "n" });
    h.push({ by: "you", context: "other" });
    expect(j.list("you", "n")).toHaveLength(100);
    expect(j.list("you", "other")).toHaveLength(1);
  });
});

test("an undo of a picture says which picture and who made it, short enough for the status line (walk of #1397)", async () => {
  const { IMAGE_HISTORY } = await import("../src/surface/note-undo");
  const line = "[img::/home/someone/very/long/folder/of/pictures/for/the/plot/allotment-dusk.jpg] [size::50%] [align::right]";
  IMAGE_HISTORY.push({ block: "b", edits: [{ line: 3, before: line, after: line.replace("right", "left") }], by: "you", context: "walk-note" });
  const said = undoneSaid(IMAGE_HISTORY.last("you", "walk-note")!);
  expect(said).toContain("allotment-dusk.jpg");
  expect(said).not.toContain("/home/someone");
  expect(said.endsWith("(made by you)")).toBe(true);
  expect(said.length).toBeLessThanOrEqual(100);
});
