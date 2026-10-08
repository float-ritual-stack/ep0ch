// Unsent drafts: the stray-keystroke rule (src/stray.ts), the diff of a put-aside edit against the note now, and
// "take it back" (src/unsent.ts), whose changes replay through draft.patch's own compare. Fictional notes throughout;
// the put-aside files go to a scratch state folder.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocated, locateSpanForced, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import { DraftSession, hasStrays, takeStrays, unsent, type DraftTarget } from "../src/draft-session";
import { STRAY_MAX, STRAY_MS, strayKeys, strayWords } from "../src/stray";
import { diffNote, diffRows, OLD_UNSENT_DAYS, settleQuietly, unsentEntries, unsentLabel, unsentView, viewVerdict } from "../src/unsent";
import { compareDraft, dayOf, startedWords, takeBackSpans, verdictWords } from "../src/unsent-compare";
import { Draft } from "../src/edit";
import { keepUnsent, shelve } from "../src/draft-session";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const ESC: Key = { kind: "esc" };

describe("stray keystrokes: an edit opened by mistake", () => {
  test("strayKeys: a few characters typed into the text, briefly, nothing taken out", () => {
    expect(strayKeys("Sow the beans", "Sow the beansj", 800)).toBe("j");
    expect(strayKeys("Sow the beans", "qSow the beans", 800)).toBe("q");
    expect(strayKeys("Sow the beans", "Sowj the beanqs", 800)).toBe("jq");
    expect(strayKeys("Sow the beans", "Sow the beansjkq", 800)).toBe("jkq");
    expect(strayWords("jq")).toBe("dropped 2 stray characters");
  });

  test("a real edit isn't stray: too many characters, anything deleted, or open too long", () => {
    expect(strayKeys("Sow the beans", "Sow the beans!!!!", 800)).toBeNull();            // over STRAY_MAX
    expect("!!!!".length).toBeGreaterThan(STRAY_MAX);
    expect(strayKeys("Sow the beans", "Sow the bean", 800)).toBeNull();                 // a character taken out
    expect(strayKeys("Sow the beans", "Sow the bexns", 800)).toBeNull();                // replaced: one out, one in
    expect(strayKeys("Sow the beans", "Sow the beansj", STRAY_MS)).toBeNull();          // open too long
    expect(strayKeys("Sow the beans", "Sow the beans", 800)).toBeNull();                // nothing typed
  });
});

describe("unsent drafts against the note now", () => {
  let state: string;
  const was = process.env.EP0CH_STATE;
  beforeAll(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-unsent-")); process.env.EP0CH_STATE = state; });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; rmSync(state, { recursive: true, force: true }); });

  const target = (id: string): DraftTarget => ({ place: `edit:${id}`, back: "e brings it back", label: id.slice(0, 8), what: `the edit to “${id}”`, verb: "save", blockId: id, leaveWrites: true, async submit() { return { ok: true }; } });
  const type = (s: DraftSession, ks: (Key | string)[]) => { const ran: string[] = []; for (const k of ks) for (const one of typeof k === "string" ? [...k].map(char) : [k]) s.key(one, { run: c => ran.push(c) }); return ran; };

  test("an edit opened by mistake closes on the first esc, copied but never put aside; ctrl+z's strays come back once", () => {
    const s = DraftSession.open(target("note-trowel"), { text: "Find the trowel", base: 4 });
    expect(type(s, ["j", ESC])).toEqual(["discard"]);              // one esc, not two
    expect(s.close(true)).toMatchObject({ closed: true, said: "dropped 1 stray character · ctrl+z brings them back" });
    expect(unsent("edit:note-trowel")).toBeNull();                 // no ■ unsent line
    expect(hasStrays("edit:note-trowel")).toBe(true);
    const back = takeStrays("edit:note-trowel")!;
    expect(back.u).toMatchObject({ text: "Find the trowelj", base: 4, from: "Find the trowel" });
    expect(back.u.copy).toBeTruthy();                              // its copy on disk
    expect(takeStrays("edit:note-trowel")).toBeNull();             // once
  });

  test("strays are forgotten once the note's edit opens again: ctrl+z never lays them over what came after", () => {
    const a = DraftSession.open(target("note-sieve"), { text: "Sieve the soil", base: 1 });
    type(a, ["k", ESC]); a.close(true);
    expect(hasStrays("edit:note-sieve")).toBe(true);
    const b = DraftSession.open(target("note-sieve"), { text: "Sieve the soil", base: 1 });
    expect(hasStrays("edit:note-sieve")).toBe(false);
    b.dispose();
  });

  test("a real edit keeps the esc-twice protection and is put aside, with the text it started from", () => {
    const s = DraftSession.open(target("note-rake"), { text: "Rake the leaves", base: 2 });
    expect(type(s, [" into the bay", ESC])).toEqual([]);           // the first esc only warns
    expect(type(s, [ESC])).toEqual(["discard"]);
    s.close(true);
    expect(unsent("edit:note-rake")).toMatchObject({ text: "Rake the leaves into the bay", base: 2, from: "Rake the leaves" });
  });

  test("the kept-draft line: an edit's words are the comparison's answer; one on an older revision says what's new; an old one folds", () => {
    shelve("edit:note-hoe", Object.assign(new Draft("note-hoe", 3, "Oil the hoe"), {}), null);
    // On the revision the note is at: nothing changed since, the whole edit is new, so its line offers to add it.
    expect(unsentEntries("note-hoe", 3, { text: "Oil the hoe" }, () => "today")).toEqual([expect.objectContaining({ stale: false, old: false, text: "■ your edit today was already in the note", ops: ["copy", "dismiss"] })]);
    // An older revision with its starting text kept: a changed line the note doesn't have is new.
    shelve("edit:note-rake", Object.assign(new Draft("note-rake", 3, "Rake"), { }), null);
    keepUnsent({ key: "edit:note-rake", text: "Rake the leaves\nstack the bags", base: 3, at: Date.now(), copy: null, from: "Rake the leaves" });
    const e = unsentEntries("note-rake", 5, { text: "Rake prep\nRake the leaves" }, () => "Oct 1")[0]!;
    expect(e).toMatchObject({ stale: true, old: false, text: "■ 1 line from your edit on Oct 1 isn't in the note", ops: ["diff", "add", "keep", "dismiss"] });
    expect(unsentLabel("diff", e.verdict)).toBe("[show them]");
    // Without its starting text: the two-way comparison says so; while the history is being read, it says that.
    keepUnsent({ key: "edit:note-hoe", text: "Oil the hoe\nand the saw", base: 3, at: Date.now(), copy: null });
    expect(unsentEntries("note-hoe", 5, { text: "Oil the hoe", baseOf: () => null }, () => "Oct 1")[0]).toMatchObject({ text: expect.stringContaining("differs from the note in 1 line · its starting text isn't kept"), ops: ["diff", "copy", "keep", "dismiss"] });
    expect(unsentEntries("note-hoe", 5, { text: "Oil the hoe", baseOf: () => undefined }, () => "Oct 1")[0]).toMatchObject({ pending: true, ops: ["copy", "dismiss"] });
    const later = Date.now() + (OLD_UNSENT_DAYS + 1) * 86_400_000;
    expect(unsentEntries("note-hoe", 5, { text: "Oil the hoe", baseOf: () => null }, () => "then", later)[0]!.old).toBe(true);
    expect(unsentEntries("note-hoe", 3, { text: "Oil the hoe" }, () => "then", later)[0]!.old).toBe(false);   // only a stale one folds
  });

  test("the compare view: the answer first, then only the edit's own changes, each marked; a conflict shows both versions; two-way says so", () => {
    const base = "Shed jobs\n- fix the hinge\n- paint the door\n- sweep up";
    const draft = "Shed jobs\n- fix the hinge\n- oil the lock\n- sweep up\n- lock the gate";
    const now = { id: "note-shed", text: "Shed jobs\n- fix the hinge\n- paint the door red\n- sweep up\n- lock the gate", revision: 9, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: {} };
    const oct1 = new Date(2026, 9, 1, 12).getTime();
    const v = diffNote(now, { key: "edit:note-shed", text: draft, base: 7, at: oct1, copy: null }, base);
    expect(unsentView(v.id)).toEqual({ of: "note-shed", view: "diff" });
    expect(v.text).toContain("You started editing this on Oct 1 and didn't save. The note has changed 2 times since. Your edit is kept here.");
    expect(v.text).toContain("**1 line from your edit on Oct 1 was changed differently since**");
    expect(v.text).toContain("```diff\n@@ line 3 · changed differently since @@\n- - paint the door\n+ - oil the lock\n  the note now: - paint the door red\n@@ line 5 · already in the note @@\n+ - lock the gate\n```");
    expect(viewVerdict("note-shed")).toMatchObject({ kind: "conflict" });
    // No starting text: the two-way diff, labelled as one.
    const two = diffNote(now, { key: "edit:note-shed", text: draft, base: 7, at: oct1, copy: null }, null);
    expect(two.text).toContain("compared with the note as it is now (the edit's starting text isn't kept)");
    expect(two.text).toContain("```diff\n  Shed jobs\n  - fix the hinge\n- - paint the door red\n+ - oil the lock\n  - sweep up\n  - lock the gate\n```");
    // Text with its own fence gets a longer one, so nothing in it closes the diff.
    expect(diffNote(now, { key: "k", text: "Shed jobs\n```\ncode\n```", base: 9, at: 0, copy: null }, null).text).toContain("````diff");
  });

  /** The note now, with every take-back span applied that its compare still finds; how many were left out. */
  const takeBack = (from: string, put: string, now: string) => {
    let text = now, missed = 0;
    for (const span of takeBackSpans(from, put).reverse()) {
      const at = locateSpanForced(text, span);
      if ("reason" in at) { missed++; continue; }
      text = applyLocated(text, [{ ...at, replacement: span.replacement }]);
    }
    return { text, missed };
  };

  test("take it back: the unsent changes land on the note now, and a passage changed since is left as it is", () => {
    const from = "Greenhouse\nwater the tomatoes\nshut the vents\nsweep the floor";
    const put = "Greenhouse\nwater the tomatoes twice\nshut the vents\nsweep the floor\nlock the door";
    // Nothing changed since: the unsent edit, exactly.
    expect(takeBack(from, put, from)).toEqual({ text: put, missed: 0 });
    // A newer change elsewhere is kept, the unsent changes go in around it.
    expect(takeBack(from, put, "Greenhouse (north)\nwater the tomatoes\nshut the vents\nsweep the floor")).toEqual({ text: "Greenhouse (north)\nwater the tomatoes twice\nshut the vents\nsweep the floor\nlock the door", missed: 0 });
    // A newer change to the same line: that change is left out, never overwritten.
    expect(takeBack(from, put, "Greenhouse\nwater the peppers\nshut the vents\nsweep the floor")).toEqual({ text: "Greenhouse\nwater the peppers\nshut the vents\nsweep the floor\nlock the door", missed: 1 });
    // Lines taken out go with their line breaks.
    expect(takeBack(from, "Greenhouse\nsweep the floor", from)).toEqual({ text: "Greenhouse\nsweep the floor", missed: 0 });
    expect(takeBack(from, "Greenhouse\nwater the tomatoes", from)).toEqual({ text: "Greenhouse\nwater the tomatoes", missed: 0 });
    expect(takeBack(from, "Seedlings\n" + from, from)).toEqual({ text: "Seedlings\n" + from, missed: 0 });
  });
});

describe("the three-way comparison: the draft's own changes, each against the note now", () => {
  let state: string;
  const was = process.env.EP0CH_STATE;
  beforeAll(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-unsent-compare-")); process.env.EP0CH_STATE = state; });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; rmSync(state, { recursive: true, force: true }); });
  const base = "Greenhouse\nwater the tomatoes\nshut the vents\nsweep the floor";
  const states = (draft: string, now: string) => compareDraft(base, draft, now).hunks.map(h => h.state);

  test("a change the note already has is `already`; one that still applies is `new`; one whose passage changed differently is a `conflict` with the note's version", () => {
    const draft = "Greenhouse\nwater the tomatoes twice\nshut the vents\nsweep the floor\nlock the door";
    // Nothing changed since: both are new.
    expect(states(draft, base)).toEqual(["new", "new"]);
    // Twelve revisions of other changes bury nothing: the draft's two changes are still the only hunks.
    expect(states(draft, "Greenhouse (north)\nwater the tomatoes\nshut the vents\nsweep the floor")).toEqual(["new", "new"]);
    // The note got the first change (someone typed it) and the second one is still new.
    expect(states(draft, "Greenhouse\nwater the tomatoes twice\nshut the vents\nsweep the floor")).toEqual(["already", "new"]);
    // The whole edit is in the note already.
    const all = compareDraft(base, draft, draft + "\nwater the beans");
    expect(all).toMatchObject({ basis: "three-way", kind: "nothing-new" });
    // The first line was changed another way: a conflict, showing what the note has there now.
    const clash = compareDraft(base, draft, "Greenhouse\nwater the peppers\nshut the vents\nsweep the floor");
    expect(clash.kind).toBe("conflict");
    expect(clash.hunks.map(h => [h.state, h.now])).toEqual([["conflict", ["water the peppers"]], ["new", null]]);
    // A line changed to a longer one is not mistaken for the original (whole lines are compared, not substrings).
    expect(states("Greenhouse\nwater the beans\nshut the vents\nsweep the floor", "Greenhouse\nwater the tomatoes slowly\nshut the vents\nsweep the floor")).toEqual(["conflict"]);
  });

  test("a line elsewhere that reads the same is not the change being in the note", () => {
    // Replacing `old` with `new`, while the note has another `new` further down: the passage still reads `old`, so it is new.
    const b = "A\nold\nB\nnew";
    expect(compareDraft(b, "A\nnew\nB\nnew", b).hunks.map(h => h.state)).toEqual(["new"]);
    // The note has the replacement where the change goes: already.
    expect(compareDraft(b, "A\nnew\nB\nnew", "A\nnew\nB\nnew").kind).toBe("nothing-new");
    // The lines either side were edited, so where it goes can't be found: not claimed as in the note.
    expect(compareDraft(b, "A\nnew\nB\nnew", "A (x)\nnew\nB (x)\nnew").kind).not.toBe("nothing-new");
  });

  test("lines the draft took out: gone from the note already, still there (new), or rewritten (a conflict)", () => {
    const draft = "Greenhouse\nwater the tomatoes\nsweep the floor";
    expect(states(draft, base)).toEqual(["new"]);
    expect(states(draft, "Greenhouse\nwater the tomatoes\nsweep the floor")).toEqual(["already"]);
    expect(states(draft, "Greenhouse\nwater the tomatoes\nshut the vents (west)\nsweep the floor")).toEqual(["conflict"]);
  });

  test("an unchanged draft, or no starting text: nothing is resolved without a base", () => {
    expect(compareDraft(base, base, "anything else")).toMatchObject({ kind: "nothing-new", hunks: [] });
    // Two-way: the draft against the note, labelled; even a draft the note has whole resolves nothing quietly.
    const two = compareDraft(null, "Greenhouse\nwater twice", "Greenhouse\nwater");
    expect(two).toMatchObject({ basis: "two-way", kind: "differs" });
    expect(two.hunks.every(h => h.state === "differs")).toBe(true);
    expect(compareDraft(null, "same", "same").kind).toBe("differs");
  });

  test("the words: the answer up front, in one place", () => {
    const draft = "Greenhouse\nwater the tomatoes twice\nshut the vents\nsweep the floor\nlock the door";
    expect(verdictWords(compareDraft(base, draft, base), "Oct 1")).toBe("2 lines from your edit on Oct 1 aren't in the note");
    expect(verdictWords(compareDraft(base, draft, "Greenhouse\nwater the peppers\nshut the vents\nsweep the floor"), "Oct 1")).toBe("1 line from your edit on Oct 1 isn't in the note · 1 was changed differently since");
    expect(verdictWords(compareDraft(base, draft, draft), "today")).toBe("your edit today was already in the note");
    expect(startedWords("Oct 1", 12)).toBe("You started editing this on Oct 1 and didn't save. The note has changed 12 times since. Your edit is kept here.");
    expect(dayOf(new Date(2026, 9, 1, 12).getTime(), new Date(2026, 9, 7, 9).getTime())).toBe("Oct 1");
    expect(dayOf(new Date(2026, 9, 6, 12).getTime(), new Date(2026, 9, 7, 9).getTime())).toBe("yesterday");
  });

  test("add them: the new hunks' spans apply as one patch, around newer text; settleQuietly keeps a copy and clears an edit the note has whole", async () => {
    const draft = "Greenhouse\nwater the tomatoes twice\nshut the vents\nsweep the floor\nlock the door";
    const now = "Greenhouse (north)\nwater the tomatoes\nshut the vents\nsweep the floor";
    const v = compareDraft(base, draft, now);
    const located = locateSpans(now, v.hunks.filter(h => h.state === "new").map(h => h.span!), true);
    expect(located.ok && applyLocated(now, located.spans)).toBe("Greenhouse (north)\nwater the tomatoes twice\nshut the vents\nsweep the floor\nlock the door");
    // Quietly: the note has all of it; the entry goes, a copy exists.
    keepUnsent({ key: "edit:note-glass", text: draft, base: 3, at: Date.now(), copy: null, from: base });
    const note = { id: "note-glass", text: draft, revision: 9, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: {} };
    const here = async () => note;
    const done = await settleQuietly(note, { revisionText: async () => { throw new Error("not asked"); }, get: here });
    expect(done?.copy && readFileSync(done.copy, "utf8")).toBe(draft + "\n");
    expect(unsent("edit:note-glass")).toBeNull();
    // Something new in it, or no starting text anywhere: left alone.
    keepUnsent({ key: "edit:note-glass", text: draft, base: 3, at: Date.now(), copy: null, from: base });
    expect(await settleQuietly({ ...note, text: now }, { revisionText: async () => ({ text: base }), get: async () => ({ ...note, text: now }) })).toBeNull();
    keepUnsent({ key: "edit:note-glass", text: draft, base: 3, at: Date.now(), copy: null });
    expect(await settleQuietly(note, { revisionText: async () => { throw new Error("history doesn't reach it"); }, get: here })).toBeNull();
    expect(unsent("edit:note-glass")).not.toBeNull();
    // The base from the note's history when the draft didn't keep it.
    expect((await settleQuietly(note, { revisionText: async () => ({ text: base }), get: here }))?.day).toBe("today");
    // The note moved on while its history was read (the line is gone, or a newer revision): nothing is resolved on the old snapshot.
    keepUnsent({ key: "edit:note-glass", text: draft, base: 3, at: Date.now(), copy: null });
    expect(await settleQuietly(note, { revisionText: async () => ({ text: base }), get: async () => ({ text: now, revision: 10 }) })).toBeNull();
    expect(unsent("edit:note-glass")).not.toBeNull();
    // A newer edit kept at the same place while the history was read stays.
    expect(await settleQuietly(note, { revisionText: async () => { keepUnsent({ key: "edit:note-glass", text: "newer words", base: 9, at: Date.now() + 1, copy: null }); return { text: base }; }, get: here })).toBeNull();
    expect(unsent("edit:note-glass")?.text).toBe("newer words");
  });
});
