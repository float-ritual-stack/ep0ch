// The door on a Mac: what differs there and how the door meets it. These run on any machine; the parts that
// read the platform take it as an argument or a fake.
import { describe, expect, test } from "bun:test";
import { App } from "../src/app";
import { OPTION_KEYS, optionKeysOn } from "../src/term";
import { procAncestors } from "../src/where";

/** A door on a fake terminal with one screen that records its keys; `holds` says whether text is being typed. */
function door(holds = false, optionKeys = true) {
  const keys: unknown[] = [];
  let flashed = "";
  const term = { info: { cols: 80, rows: 24, cellW: 9, cellH: 18, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {} };
  const app = new App(term as any, {} as any, Date.now(), () => {});
  const screen = { title: "desk", render: () => ({ lines: [] }), key: (k: unknown) => keys.push(k), holdsKeys: () => holds };
  app.optionKeys = optionKeys;
  app.push(screen as any);
  const real = app.flash.bind(app);
  app.flash = (m: string, ms?: number) => { flashed = m; real(m, ms); };
  return { keys, press: (k: unknown) => (app as any).key(k), get flashed() { return flashed; }, quit: () => app.quit() };
}

describe("Option typing characters instead of sending Alt (kitty's default)", () => {
  test("the US keyboard's Option letters map back to the keys the door binds", () => {
    const bound = { "¬": "l", "∂": "d", "π": "p", "µ": "m", "≈": "x", "∫": "b", "ƒ": "f", "ç": "c", "å": "a" };
    for (const [ch, key] of Object.entries(bound)) expect(OPTION_KEYS[ch]).toBe(key);
    // Option+n is a dead key: it types nothing by itself, so there's no character for alt+n.
    expect(Object.values(OPTION_KEYS)).not.toContain("n");
  });

  test("where nobody is typing, ¬ is alt+l, and the first one says which terminal setting sends alt", () => {
    const d = door();
    try {
      d.press({ kind: "char", ch: "¬" });
      expect(d.keys).toEqual([{ kind: "alt", ch: "l" }]);
      expect(d.flashed).toContain("macos-option-as-alt");
      expect(d.flashed).toContain("macos_option_as_alt");
      d.press({ kind: "char", ch: "∂" });
      expect(d.keys.at(-1)).toEqual({ kind: "alt", ch: "d" });
    } finally { d.quit(); }
  });

  test("said once: a second Option key doesn't say it again", () => {
    const d = door();
    try {
      d.press({ kind: "char", ch: "¬" });
      const first = d.flashed;
      d.press({ kind: "char", ch: "π" });
      expect(d.flashed).toBe(first);
    } finally { d.quit(); }
  });

  test("in text (an edit, a filter, a panel) and in a paste, the character stays what was typed", () => {
    const d = door(true);
    try {
      d.press({ kind: "char", ch: "ç" });
      expect(d.keys).toEqual([{ kind: "char", ch: "ç" }]);
      expect(d.flashed).toBe("");
    } finally { d.quit(); }
    const p = door();
    try {
      p.press({ kind: "char", ch: "µ", pasted: true });
      expect(p.keys).toEqual([{ kind: "char", ch: "µ", pasted: true }]);
    } finally { p.quit(); }
  });

  test("an ordinary letter and a real alt key pass through untouched", () => {
    const d = door();
    try {
      d.press({ kind: "char", ch: "l" });
      d.press({ kind: "alt", ch: "l" });
      expect(d.keys).toEqual([{ kind: "char", ch: "l" }, { kind: "alt", ch: "l" }]);
      expect(d.flashed).toBe("");
    } finally { d.quit(); }
  });
});

describe("Option characters on other keyboards", () => {
  test("read only where the locale's keyboard is US-like, or when EP0CH_OPTION_KEYS says so", () => {
    expect(optionKeysOn({ LANG: "en_US.UTF-8" })).toBe(true);
    expect(optionKeysOn({ LANG: "en_CA.UTF-8" })).toBe(true);
    expect(optionKeysOn({})).toBe(true);
    expect(optionKeysOn({ LANG: "C.UTF-8" })).toBe(true);
    // å ø are keys of their own on a Nordic keyboard, ß § on a German one, £ on a British one.
    expect(optionKeysOn({ LANG: "nb_NO.UTF-8" })).toBe(false);
    expect(optionKeysOn({ LANG: "en_US.UTF-8", LC_CTYPE: "de_DE.UTF-8" })).toBe(false);
    expect(optionKeysOn({ LANG: "en_GB.UTF-8" })).toBe(false);
    expect(optionKeysOn({ LC_ALL: "fr_FR.UTF-8", LANG: "en_US.UTF-8" })).toBe(false);
    expect(optionKeysOn({ LANG: "de_DE.UTF-8", EP0CH_OPTION_KEYS: "us" })).toBe(true);
    expect(optionKeysOn({ LANG: "en_US.UTF-8", EP0CH_OPTION_KEYS: "off" })).toBe(false);
  });

  test("off, å is the letter typed: it doesn't pull up the dock, and nothing is said", () => {
    const d = door(false, false);
    try {
      d.press({ kind: "char", ch: "å" });
      d.press({ kind: "char", ch: "ß" });
      expect(d.keys).toEqual([{ kind: "char", ch: "å" }, { kind: "char", ch: "ß" }]);
      expect(d.flashed).toBe("");
    } finally { d.quit(); }
  });
});

describe("ep0ch where without /proc", () => {
  test("ancestors walk the parent table, nearest first, stopping at launchd or init", () => {
    const table = new Map([[500, 400], [400, 300], [300, 1]]);
    expect(procAncestors(500, p => table.get(p) ?? null)).toEqual([400, 300]);
  });
  test("a process the table doesn't know ends the walk; nothing is guessed", () => {
    expect(procAncestors(77, () => null)).toEqual([]);
  });
  test("this process's own parent is found on this machine, /proc or not", () => {
    // A runner started straight by init or launchd (a container's entry point) has no ancestors to walk.
    if (process.ppid > 1) expect(procAncestors(process.pid)[0]).toBe(process.ppid);
    else expect(procAncestors(process.pid)).toEqual([]);
  });
});
