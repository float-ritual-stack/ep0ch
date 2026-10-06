// Unsent drafts: the stray-keystroke rule (src/stray.ts), the diff of a put-aside edit against the note now, and
// "take it back" (src/unsent.ts), whose changes replay through draft.patch's own compare. Fictional notes throughout;
// the put-aside files go to a scratch state folder.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocated, locateSpanForced } from "@ep0ch/outline-core/draft-patch-compare";
import { DraftSession, hasStrays, takeStrays, unsent, type DraftTarget } from "../src/draft-session";
import { STRAY_MAX, STRAY_MS, strayKeys, strayWords } from "../src/stray";
import { diffNote, diffRows, OLD_UNSENT_DAYS, takeBackSpans, unsentEntries, unsentView } from "../src/unsent";
import { Draft } from "../src/edit";
import { shelve } from "../src/draft-session";
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

  test("the ■ unsent line: an edit offers diff, copy, dismiss and take; on an older revision it says which; an old one folds", () => {
    shelve("edit:note-hoe", Object.assign(new Draft("note-hoe", 3, "Oil the hoe"), {}), null);
    expect(unsentEntries("note-hoe", 3, () => "today")).toEqual([expect.objectContaining({ stale: false, old: false, ops: ["diff", "copy", "dismiss", "take"], text: "■ unsent edit from today · e brings it back" })]);
    expect(unsentEntries("note-hoe", 5, () => "today")[0]).toMatchObject({ stale: true, old: false, text: "■ unsent edit from today · on revision 3, the note is at 5" });
    const later = Date.now() + (OLD_UNSENT_DAYS + 1) * 86_400_000;
    expect(unsentEntries("note-hoe", 5, () => "then", later)[0]!.old).toBe(true);
    expect(unsentEntries("note-hoe", 3, () => "then", later)[0]!.old).toBe(false);   // only a stale one folds
  });

  test("the diff: - the note now, + the unsent edit, in a ```diff fence a reader colours, saying which revision it was on", () => {
    const now = { id: "note-shed", text: "Shed jobs\n- fix the hinge\n- paint the door", revision: 9, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: {} };
    expect(diffRows(now.text, "Shed jobs\n- fix the hinge\n- oil the lock")).toEqual(["  Shed jobs", "  - fix the hinge", "- - paint the door", "+ - oil the lock"]);
    const v = diffNote(now, { key: "edit:note-shed", text: "Shed jobs\n- fix the hinge\n- oil the lock", base: 7, at: 0, copy: null });
    expect(unsentView(v.id)).toEqual({ of: "note-shed", view: "diff" });
    expect(v.text).toContain("on revision 7; the note is at revision 9 now");
    expect(v.text).toContain("```diff\n  Shed jobs\n  - fix the hinge\n- - paint the door\n+ - oil the lock\n```");
    // Text with its own fence gets a longer one, so nothing in it closes the diff.
    expect(diffNote(now, { key: "k", text: "Shed jobs\n```\ncode\n```", base: 9, at: 0, copy: null }).text).toContain("````diff");
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
