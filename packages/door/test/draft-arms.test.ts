// Press it again has one owner (PIE-1616): a draft holds one arm (Again in src/arm.ts), its words on the draft's line. The
// second press does what the first said, whatever came between; anything else lets the arm go, and a change the
// person didn't press (an agent's edit, a reload, $EDITOR coming back) lets it go too. Made-up notes; no service.
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { AGAIN_MS, Again } from "../src/arm";
import { DraftSession } from "../src/draft-session";
import { Draft, UNDO_ASK_PAUSE_MS } from "../src/edit";
import { USER } from "../src/socket";
import type { Key } from "../src/term";
import type { Msg } from "../src/board";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const ESC: Key = { kind: "esc" };
const AGENT = { kind: "agent", id: "tidy" } as const;
const typed = (text = "Sowing") => { const d = new Draft("n1", 1, text); d.key(char("!")); return d; };
const msg = (text: string, revision: number) => ({ id: "n1", text, revision, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", properties: [] }) as unknown as Msg;
afterEach(() => { setSystemTime(); });

describe("each arm: the second press does what the first said", () => {
  test("esc twice puts it aside; ctrl+x ctrl+e opens $EDITOR; ctrl+x a attaches", () => {
    const d = typed();
    expect(d.key(ESC)).toBe("keep");
    expect(d.note).toContain("esc again");
    expect(d.key(ESC)).toBe("discard");
    expect(d.key(ctrl("x"))).toBe("keep");
    expect(d.note).toContain("ctrl+e opens $EDITOR");
    expect(d.key(ctrl("e"))).toBe("editor");
    d.attachChord = true;
    d.key(ctrl("x"));
    expect(d.key(char("a"))).toBe("attach");
  });

  test("ctrl+z at a save asks; after a pause and within the window it goes past; held down it only asks", () => {
    setSystemTime(new Date(1_000_000));
    const d = new Draft("n1", 1, "Sowing");
    d.undos = [{ what: "typing", before: "Sow", after: "Sowing", at: 0, caret: 6, by: USER, open: false, saved: 3 } as never];
    d.key(ctrl("z"));
    expect(d.note).toContain("ctrl+z again in 5s undoes typing");
    expect(d.text).toBe("Sowing");
    d.key(ctrl("z"));                                       // no pause: key repeat asks again
    expect(d.text).toBe("Sowing");
    setSystemTime(new Date(1_000_000 + UNDO_ASK_PAUSE_MS));
    d.key(ctrl("z"));
    expect(d.text).toBe("Sow");
  });
});

describe("any other key lets it go, and the line stops saying it", () => {
  test("esc, a key, esc asks again", () => {
    const d = typed();
    d.key(ESC);
    d.key({ kind: "left" });
    expect(d.note).toBe("");
    expect(d.key(ESC)).toBe("keep");
  });

  test("ctrl+x, a key that says nothing, ctrl+e is the line's end", () => {
    const d = typed();
    d.key(ctrl("x"));
    d.key({ kind: "left" });
    expect(d.note).toBe("");
    expect(d.key(ctrl("e"))).toBe("keep");
    expect(d.col).toBe(d.lines[0]!.length);
  });

  test("ctrl+z's ask, a key, ctrl+z asks again rather than going past the save", () => {
    setSystemTime(new Date(1_000_000));
    const d = new Draft("n1", 1, "Sowing");
    d.undos = [{ what: "typing", before: "Sow", after: "Sowing", at: 0, caret: 6, by: USER, open: false, saved: 3 } as never];
    d.key(ctrl("z"));
    d.key({ kind: "left" });
    expect(d.note).not.toContain("again undoes");
    setSystemTime(new Date(1_000_000 + UNDO_ASK_PAUSE_MS));
    d.key(ctrl("z"));
    expect(d.text).toBe("Sowing");
    expect(d.note).toContain("ctrl+z again in 5s undoes typing");
  });

  test("a snippet's tab between two escs is a key too", () => {
    const d = typed("Sow a b");
    d.key(ESC);
    d.startSnippet([{ start: 4, end: 5 }, { start: 6, end: 7 }] as never, 0);
    d.anchor = null;
    d.key({ kind: "tab" });
    d.snippet = null; d.anchor = null;
    expect(d.key(ESC)).toBe("keep");
    expect(d.note).toContain("esc again");
  });

  test("a click or the wheel between two escs lets it go; a button's release doesn't", () => {
    for (const action of ["down", "wheel-up"] as const) {
      const d = typed();
      d.key(ESC);
      d.key({ kind: "mouse", action, button: 0, x: 1, y: 1 });
      expect(d.key(ESC)).toBe("keep");
    }
    const d = typed();
    d.key(ESC);
    d.key({ kind: "mouse", action: "up", button: 0, x: 1, y: 1 });
    expect(d.key(ESC)).toBe("discard");
  });

  test("cmd+c between two escs copies and keeps the arm", () => {
    const d = typed();
    d.key(ESC);
    expect(d.key({ kind: "super", ch: "c" })).toBe("copy");
    expect(d.key(ESC)).toBe("discard");
  });

  test("a key a host takes before the draft sees it lets it go (the session's hold is the first to hear every key)", () => {
    const s = DraftSession.open({ place: "edit:arms-host", back: "e", label: "arms", what: "the edit", verb: "save", leaveWrites: true, async submit() { return { ok: true }; } }, { text: "Sowing", base: 1 });
    const d = s.draft;
    d.key(ctrl("x"));
    expect(s.holding({ kind: "alt", ch: "t" }, () => {})).toBe(false);   // a rich edit's key, say
    expect(d.key(ctrl("e"))).toBe("keep");
    d.key(char("!"));
    d.key(ESC);
    expect(s.holding(ESC, () => {})).toBe(false);
    expect(d.key(ESC)).toBe("discard");
    s.dispose();
  });
});

describe("what the person didn't press lets it go too", () => {
  const under: [string, (d: Draft) => void][] = [
    ["an agent's text", d => d.replace("Sowing peas", AGENT)],
    ["$EDITOR coming back", d => d.replace("Sowing beans", USER)],
    ["a reload", d => d.rebase(msg("Sowing leeks", 2))],
    ["an agent's patch", d => d.applyPatch({ patchId: "p1", patches: [{ observed: "Sowing", replacement: "Planting", range: { start: 0, end: 6 } }], revision: d.base, force: true }, AGENT)],
    ["a click", d => d.place(0, 1)],
  ];
  for (const [what, change] of under) {
    test(`esc, then ${what}, then esc asks again`, () => {
      const d = typed();
      d.key(ESC);
      change(d);
      expect(d.key(ESC)).not.toBe("discard");   // a reload leaves nothing written: esc just closes
    });
    test(`ctrl+x, then ${what}, then ctrl+e is the line's end`, () => {
      const d = typed();
      d.key(ctrl("x"));
      change(d);
      expect(d.key(ctrl("e"))).toBe("keep");
    });
  }

  test("something else said on the line lets it go: an arm is never held unseen", () => {
    const d = typed();
    d.key(ESC);
    d.status.say("the note was moved");
    expect(d.key(ESC)).toBe("keep");
    expect(d.note).toContain("esc again");
  });

  test("a write starting lets it go: an agent's save under the person's first esc", () => {
    const d = typed();
    d.key(ESC);
    d.status.phase = "saving";
    d.status.phase = null;
    expect(d.key(ESC)).toBe("keep");
  });

  test("an agent's ctrl+z at a save only hears the question: the person's next one asks too", () => {
    setSystemTime(new Date(1_000_000));
    const d = new Draft("n1", 1, "Sowing");
    d.undos = [{ what: "tidy's edit", before: "Sow", after: "Sowing", at: 0, caret: 6, by: AGENT, open: false, saved: 3 } as never];
    expect(d.undoStep(AGENT).asked).toBe(true);
    setSystemTime(new Date(1_000_000 + UNDO_ASK_PAUSE_MS));
    d.key(ctrl("z"));
    expect(d.text).toBe("Sowing");
  });
});

describe("the window running out", () => {
  test("esc's window out: the line stops saying it, the next esc asks", () => {
    setSystemTime(new Date(1_000_000));
    const d = typed();
    d.key(ESC);
    setSystemTime(new Date(1_000_000 + AGAIN_MS));
    expect(d.note).toBe("");
    expect(d.key(ESC)).toBe("keep");
    expect(d.note).toContain("esc again");
  });

  test("ctrl+z's ask has the same window: much later it asks again", () => {
    setSystemTime(new Date(1_000_000));
    const d = new Draft("n1", 1, "Sowing");
    d.undos = [{ what: "typing", before: "Sow", after: "Sowing", at: 0, caret: 6, by: USER, open: false, saved: 3 } as never];
    d.key(ctrl("z"));
    setSystemTime(new Date(1_000_000 + AGAIN_MS));
    d.key(ctrl("z"));
    expect(d.text).toBe("Sowing");
  });

  test("the chord has no window: bash's doesn't, and the line keeps saying it", () => {
    setSystemTime(new Date(1_000_000));
    const d = typed();
    d.key(ctrl("x"));
    setSystemTime(new Date(1_000_000 + 60 * AGAIN_MS));
    expect(d.note).toContain("ctrl+e opens $EDITOR");
    expect(d.key(ctrl("e"))).toBe("editor");
  });

  test("a redraw comes when it runs out, so the line doesn't lie until the next key", async () => {
    let drawn = 0;
    const a = new Again<string>({ ms: 5, lapsed: () => { drawn++; } });
    a.arm("trash");
    await Bun.sleep(30);
    expect(drawn).toBe(1);
    expect(a.armed()).toBeNull();
    a.arm("trash");
    a.clear();
    await Bun.sleep(30);
    expect(drawn).toBe(1);
  });
});

// PIE-1738: the undo's second press has a window, and the line says how much of it is left, second by second.
describe("ctrl+z at a save says its window as a countdown", () => {
  test("5s, then 4s, then 1s; gone when it runs out, and a ctrl+z after that asks again from 5s, saying it came late (PIE-1741)", () => {
    setSystemTime(new Date(1_000_000));
    const d = new Draft("n1", 1, "Sowing");
    d.undos = [{ what: "typing", before: "Sow", after: "Sowing", at: 0, caret: 6, by: USER, open: false, saved: 3 } as never];
    d.key(ctrl("z"));
    expect(d.note).toBe("saved · ctrl+z again in 5s undoes typing");
    setSystemTime(new Date(1_000_000 + 1_200));
    expect(d.note).toBe("saved · ctrl+z again in 4s undoes typing");
    setSystemTime(new Date(1_000_000 + 4_100));
    expect(d.note).toBe("saved · ctrl+z again in 1s undoes typing");
    setSystemTime(new Date(1_000_000 + AGAIN_MS));
    expect(d.note).toBe("");
    d.key(ctrl("z"));
    expect(d.text).toBe("Sowing");
    expect(d.note).toBe("late · saved · ctrl+z again in 5s undoes typing");
  });

  test("what act answers stays the same while the line counts down: no seconds in it, and the revision it keeps", () => {
    setSystemTime(new Date(1_000_000));
    const d = new Draft("n1", 1, "Sowing");
    d.undos = [{ what: "typing", before: "Sow", after: "Sowing", at: 0, caret: 6, by: USER, open: false, saved: 3 } as never];
    const r = d.undoStep(USER);
    expect(r).toEqual({ asked: true, said: "saved · ctrl+z again undoes typing; revision 3 stays in its history" });
  });

  test("a waiting press ticks while it waits, so its owner draws the count; a clear stops it", async () => {
    let ticks = 0;
    const a = new Again<string>({ ms: 60, tick: { ms: 10, then: () => { ticks++; } } });
    a.arm("undo");
    await Bun.sleep(35);
    expect(ticks).toBeGreaterThanOrEqual(2);
    a.clear();
    const at = ticks;
    await Bun.sleep(30);
    expect(ticks).toBe(at);
    expect(a.left()).toBe(0);
  });
});

describe("Again states its rule", () => {
  test("each `what` its own window and pause: too soon lets go, in the window confirms", () => {
    const a = new Again<"soon" | "any">({ ms: w => (w === "soon" ? 100 : Infinity), pause: w => (w === "soon" ? 10 : 0) });
    a.arm("soon", 0);
    expect(a.press(5)).toBeNull();
    a.arm("soon", 0);
    expect(a.press(10)).toBe("soon");
    a.arm("soon", 0);
    expect(a.press(100)).toBeNull();
    a.arm("any", 0);
    expect(a.press(1e12)).toBe("any");
  });
  test("ripe says the pause has passed; the callback comes once it has", async () => {
    let told = 0;
    const a = new Again<string>({ ms: Infinity, pause: 5, ripe: () => { told++; } });
    a.arm("panel");
    expect(a.ripe()).toBeNull();
    await Bun.sleep(30);
    expect(a.ripe()).toBe("panel");
    expect(told).toBe(1);
  });
});
