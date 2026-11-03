// The edit control is the one text field (PIE-1542): every place a person types (a note's edit, a comment, the
// composer, an inspector field, the power bar, a line field) takes keys, a paste, undo, the mouse and a rebind through
// it, so each behaves the same. One capture contract, run against every host that can stand without a service; the
// reader's own edit is walked in select.test.ts against a scratch outline. Made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Draft } from "../src/edit";
import { DraftSession } from "../src/draft-session";
import { editHint } from "../src/surface/editor";
import { Inspector } from "../src/surface/inspector";
import { LineField } from "../src/surface/line";
import { reloadKeymap } from "../src/surface/keymap";
import { wordIn } from "../src/surface/selection";
import { pasteKeys, type Key } from "../src/term";

const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const alt = (ch: string): Key => ({ kind: "alt", ch });
const typeKeys = (s: string): Key[] => [...s].map(ch => ({ kind: "char", ch }));

/**
 * A host as the contract drives it: `press` a key the way the door hands it over (a paste typed out key by key, as the
 * App does), `select` a span with the mouse's action (draft.place twice, as a drag leaves it), `text` what it holds now.
 */
interface Host { name: string; text(): string; press(k: Key): unknown; select(from: number, to: number): Promise<void> | void; settle?(): Promise<void> }

/** A paste as the App hands it to anything but a terminal tile: typed out key by key, in one go (pasteKeys). */
const paste = (h: Host, text: string) => { for (const k of pasteKeys(text)) h.press(k); };

const sessionHost = (name: string): Host => {
  const s = DraftSession.open({ place: `test:${name}`, back: "", label: name, what: name, verb: "save", leaveWrites: false, submit: async () => ({ ok: true }) }, { text: "" }, {});
  return {
    name, text: () => s.draft.text,
    press: k => s.key(k, { completer: null, run: () => {} }),
    select: (from, to) => { s.draft.place(0, from); s.draft.place(0, to, true); },
  };
};

const inspectorHost = async (): Promise<Host & { ins: Inspector; saved: string[] }> => {
  const ins = new Inspector(), saved: string[] = [];
  await ins.edit("children", "", [], false, "test:children", async v => { saved.push(v); });
  return {
    name: "inspector", ins, saved, text: () => ins.field?.session.draft.text ?? saved.at(-1) ?? "",
    press: k => { const r = ins.key(k); if (r && r !== true) return ins.input(r.op, r.value, r.n); },
    select: (from, to) => { const d = ins.field!.session.draft; d.place(0, from); d.place(0, to, true); },
  };
};

const lineHost = (): Host => {
  const l = new LineField("", false, { complete: false });
  return { name: "line field", text: () => l.text, press: k => l.take(k), select: (from, to) => { l.place(0, from); l.place(0, to, true); } };
};

describe("the edit control's keys are one table the keymap rebinds (PIE-1542)", () => {
  const was = process.env.EP0CH_KEYMAP;
  let file = "";
  beforeAll(() => { file = join(mkdtempSync(join(tmpdir(), "edit-keymap-")), "keybindings.json"); process.env.EP0CH_KEYMAP = file; reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });
  const rebind = (map: Record<string, string[]>) => { writeFileSync(file, JSON.stringify(map)); reloadKeymap(); };

  test("draft.undo rebound to alt+e undoes in a draft, and ctrl+z says where it went", async () => {
    rebind({ "draft.undo": ["alt+e"] });
    try {
      const d = new Draft("test", 0, "");
      for (const k of typeKeys("sowing")) d.key(k);
      expect(d.text).toBe("sowing");
      d.key(alt("e"));
      await Bun.sleep(0);
      expect(d.text).toBe("");
      for (const k of typeKeys("beans")) d.key(k);
      d.key(ctrl("z"));
      await Bun.sleep(0);
      expect(d.text).toBe("beans");
      expect(d.note).toContain("alt+e");
      // The hint row says the key that works, once.
      const hint = editHint(d, { save: "save" }).replace(/\x1b\[[\d;]*m/g, "");
      expect(hint).toContain("alt+e undo");
      expect(hint).not.toContain("alt+e/alt+e");
      expect(hint).not.toContain("^Z undo");
    } finally { rebind({}); }
  });

  test("a rebind of draft.undo works in every host: a note's edit, a comment, the composer, the inspector and a line field (the power bar's)", async () => {
    rebind({ "draft.undo": ["alt+e"] });
    try {
      for (const h of [sessionHost("note edit"), sessionHost("comment"), sessionHost("composer"), await inspectorHost(), lineHost()]) {
        for (const k of typeKeys("kale")) await h.press(k);
        await h.press(alt("e"));
        await Bun.sleep(0);
        expect({ host: h.name, text: h.text() }).toEqual({ host: h.name, text: "" });
      }
    } finally { rebind({}); }
  });
});

describe("an inspector field takes a paste as the edit control does (PIE-1542)", () => {
  test("a multi-line paste lands whole and nothing saves until the person saves", async () => {
    const h = await inspectorHost();
    paste(h, "dig the bed\nbuy canes\nsow peas");
    await Bun.sleep(0);
    expect(h.saved).toEqual([]);
    expect(h.text()).toBe("dig the bed\nbuy canes\nsow peas");
    // Drawn whole: each line of the value on a row of its own.
    const drawn = h.ins.fieldDraw(40).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    for (const line of ["dig the bed", "buy canes", "sow peas"]) expect(drawn).toContain(line);
    await h.press(ctrl("s"));
    await Bun.sleep(5);
    expect(h.saved).toEqual(["dig the bed\nbuy canes\nsow peas"]);
  });

  test("ctrl+z takes a paste back in one step", async () => {
    const h = await inspectorHost();
    for (const k of typeKeys("plot ")) await h.press(k);
    paste(h, "seven by three");
    await Bun.sleep(0);
    expect(h.text()).toBe("plot seven by three");
    await h.press(ctrl("z"));
    await Bun.sleep(0);
    expect(h.text()).toBe("plot ");
  });
});

describe("a word is one rule, by grapheme (PIE-1542)", () => {
  test("a combining accent and an astral character stay inside their word", () => {
    const line = "the café \u{1D400}bc garden";
    expect(line.slice(...span(wordIn(line, line.indexOf("caf") + 1)))).toBe("café");
    expect(line.slice(...span(wordIn(line, line.indexOf("́"))))).toBe("café");
    expect(line.slice(...span(wordIn(line, line.indexOf("\u{1D400}") + 1)))).toBe("\u{1D400}bc");
    expect(line.slice(...span(wordIn(line, line.length - 1)))).toBe("garden");
  });
});
const span = (w: { start: number; end: number }) => [w.start, w.end] as const;

describe("the capture contract, in every host that types (PIE-1542)", () => {
  const hosts = async (): Promise<Host[]> => [sessionHost("note edit"), sessionHost("comment"), sessionHost("composer"), await inspectorHost(), lineHost()];

  test("type, select by mouse and delete, paste several lines, undo", async () => {
    for (const h of await hosts()) {
      const one = h.name === "line field";
      for (const k of typeKeys("plant the beans")) await h.press(k);
      await h.select(6, 10);                         // "the " by the mouse's draft.place
      await h.press({ kind: "backspace" });
      expect({ host: h.name, text: h.text() }).toEqual({ host: h.name, text: "plant beans" });
      await h.press({ kind: "end" });
      paste(h, " by\nthe fence");
      await Bun.sleep(0);
      // A line field flattens a line break to a space; every other host keeps it.
      expect({ host: h.name, text: h.text() }).toEqual({ host: h.name, text: one ? "plant beans by the fence" : "plant beans by\nthe fence" });
      await h.press(ctrl("z"));
      await Bun.sleep(0);
      expect({ host: h.name, text: h.text() }).toEqual({ host: h.name, text: "plant beans" });
    }
  });
});
