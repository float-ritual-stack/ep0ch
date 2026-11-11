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
import { PropertyPanel } from "../src/surface/props-panel";
import { asHintEsc } from "../src/esc-rule";
import { keysNow, reloadKeymap } from "../src/surface/keymap";
import { LISTVIEW_ACTIONS } from "../src/surface/list-actions";
import { wordIn } from "../src/surface/selection";
import type { Key } from "../src/term";

const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const alt = (ch: string): Key => ({ kind: "alt", ch });
const typeKeys = (s: string): Key[] => [...s].map(ch => ({ kind: "char", ch }));

/**
 * A host as the contract drives it: `press` a key the way the door hands it over (a paste whole, one key, as the
 * App does), `select` a span with the mouse's action (draft.place twice, as a drag leaves it), `text` what it holds now.
 */
interface Host { name: string; text(): string; press(k: Key): unknown; select(from: number, to: number): Promise<void> | void; settle?(): Promise<void> }

/** A paste as the App hands it to every place that types: whole, one key (src/paste-path.ts). */
const paste = (h: Host, text: string) => { h.press({ kind: "paste", text }); };

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

  test("a rebound comment.place moves in the hint as in the keys window: the hint names the action its key runs", () => {
    rebind({ "comment.place": ["alt+o"] });
    try {
      const hint = editHint(new Draft("test", 0, ""), { save: "send", place: "floating" }).replace(/\x1b\[[\d;]*m/g, "");
      expect(hint).toContain("alt+o floating");
      expect(hint).not.toContain("^O floating");
    } finally { rebind({}); }
  });

  test("an action's keys say what a rebind with arguments replaced: list.step by=1 on alt+9 lists alt+9, not j or ↓, and k and ↑ stay", () => {
    const shown = () => JSON.stringify(keysNow("list.step", LISTVIEW_ACTIONS.def("list.step")!.keys));
    expect(shown()).toContain("j");
    rebind({ "list.step by=1": ["alt+9"] });
    try {
      const rows = keysNow("list.step", LISTVIEW_ACTIONS.def("list.step")!.keys) as { keys: string; does: string }[];
      const first = rows.find(r => r.does === "the next or previous row")!.keys.split(" ");
      expect(first).not.toContain("j");
      expect(first).not.toContain("↓");
      expect(first).toContain("k");
      expect(first).toContain("↑");
      expect(rows.some(r => r.keys.includes("9") && r.does.startsWith("yours"))).toBe(true);
    } finally { rebind({}); }
  });

  test("a cmd (super) rebind of draft.undo undoes in a draft and in a line field", async () => {
    rebind({ "draft.undo": ["super+z"] });
    try {
      for (const h of [sessionHost("note edit"), lineHost()]) {
        for (const k of typeKeys("chard")) await h.press(k);
        await h.press({ kind: "super", ch: "z" });
        await Bun.sleep(0);
        expect({ host: h.name, text: h.text() }).toEqual({ host: h.name, text: "" });
      }
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

describe("the line field's erase, clear and cut keys are rows of the key table too (Nov 3 review card 1)", () => {
  const was = process.env.EP0CH_KEYMAP;
  let file = "";
  beforeAll(() => { file = join(mkdtempSync(join(tmpdir(), "edit-keymap-line-")), "keybindings.json"); process.env.EP0CH_KEYMAP = file; reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });
  const rebind = (map: Record<string, string[]>) => { writeFileSync(file, JSON.stringify(map)); reloadKeymap(); };
  const line = (text: string) => { const l = new LineField(text, false, { complete: false }); l.copy = t => { copied.push(t); }; return l; };
  const copied: string[] = [];

  test("draft.erase to=word-back rebound to alt+e erases the word before in every host, and ctrl+w no longer does in a line field", async () => {
    rebind({ "draft.erase to=word-back": ["alt+e"] });
    try {
      for (const h of [sessionHost("note edit"), sessionHost("comment"), sessionHost("composer"), await inspectorHost(), lineHost()]) {
        for (const k of typeKeys("sow peas")) await h.press(k);
        await h.press(alt("e"));
        await Bun.sleep(0);
        expect({ host: h.name, text: h.text() }).toEqual({ host: h.name, text: "sow " });
      }
      const l = line("sow peas");
      l.take(ctrl("w"));
      expect(l.text).toBe("sow peas");
      expect(l.note).toContain("alt+e");
    } finally { rebind({}); }
  });

  test("draft.clear rebound to alt+k clears the line field, and ctrl+u no longer does", () => {
    rebind({ "draft.clear": ["alt+k"] });
    try {
      const l = line("sow peas");
      l.place(0, 3);
      // ctrl+u is no longer "clear": what's left of it is the draft table's ctrl+u, erase to the line's start.
      l.take(ctrl("u"));
      expect(l.text).toBe(" peas");
      l.take(ctrl("z"));
      expect(l.text).toBe("sow peas");
      l.take(alt("k"));
      expect(l.text).toBe("");
      l.take(ctrl("z"));
      expect(l.text).toBe("sow peas");
    } finally { rebind({}); }
  });

  test("draft.cut rebound to alt+q cuts the selection to the field's clipboard, and ctrl+x no longer does", () => {
    rebind({ "draft.cut": ["alt+q"] });
    try {
      copied.length = 0;
      const l = line("sow peas");
      l.place(0, 4); l.place(0, 8, true);
      l.take(ctrl("x"));
      expect(l.text).toBe("sow peas");
      l.take(alt("q"));
      expect(l.text).toBe("sow ");
      expect(copied).toEqual(["peas"]);
    } finally { rebind({}); }
  });

  test("unrebound, ctrl+w ctrl+u ctrl+x are the table's rows: erase the word, clear the line, cut the selection", () => {
    copied.length = 0;
    const l = line("sow peas now");
    l.take(ctrl("w"));
    expect(l.text).toBe("sow peas ");
    l.place(0, 4); l.place(0, 8, true);
    l.take(ctrl("x"));
    expect(copied).toEqual(["peas"]);
    l.take(ctrl("u"));
    expect(l.text).toBe("");
  });
});

describe("the hint row and the keys follow a rebind of esc, tab, shift+tab, the $EDITOR chord, ctrl+o, ctrl+g and the [ wrap (Nov 3 review card 1)", () => {
  const was = process.env.EP0CH_KEYMAP;
  let file = "";
  beforeAll(() => { file = join(mkdtempSync(join(tmpdir(), "edit-keymap-hint-")), "keybindings.json"); process.env.EP0CH_KEYMAP = file; reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });
  const rebind = (map: Record<string, string[]>) => { writeFileSync(file, JSON.stringify(map)); reloadKeymap(); };
  const hint = (d: Draft, o: Parameters<typeof editHint>[1] = { save: "save" }) => editHint(d, o).replace(/\x1b\[[\d;]*m/g, "");

  test("built in, the hint says the keys of the tables: esc, ctrl+x ctrl+e, tab, shift+tab, ctrl+o, ctrl+g and the [ wrap", () => {
    const d = new Draft("test", 0, "beans");
    d.place(0, 0); d.place(0, 5, true);
    const h = hint(d, { save: "send", place: "floating", move: true });
    for (const part of ["esc done", "^X ^E $EDITOR", "tab indent", "shift+tab out", "^O floating", "^G move"]) expect(h).toContain(part);
    expect(h).toMatch(/\[ wraps/);
  });

  test("edit.close, draft.indent, draft.outdent and edit.external rebound show in the hint and run on the new key", () => {
    rebind({ "edit.close": ["alt+q"], "draft.indent": ["alt+i"], "draft.outdent": ["alt+o"], "edit.external": ["ctrl+x alt+e"] });
    try {
      const d = new Draft("test", 0, "- beans");
      const h = hint(d);
      for (const part of ["alt+q done", "alt+i indent", "alt+o out", "^X alt+e $EDITOR"]) expect(h).toContain(part);
      expect(h).not.toContain("esc done");
      expect(h).not.toContain("shift+tab out");
      expect(h).not.toContain("^X ^E");
      // The keys run what the hint says.
      expect(d.key(alt("q"))).toBe("close");
      d.place(0, 7);
      d.key(alt("i"));
      expect(d.text).toBe("  - beans");
      d.key(alt("o"));
      expect(d.text).toBe("- beans");
      // The old keys are nothing, not the old action.
      d.key({ kind: "tab" });
      expect(d.text).toBe("- beans");
      expect(d.key({ kind: "esc" })).toBe("keep");
      d.key(ctrl("x"));
      expect(d.key(alt("e"))).toBe("editor");
      d.key(ctrl("x"));
      expect(d.key(ctrl("e"))).toBe("keep");
    } finally { rebind({}); }
  });

  test("a changed draft's esc rebound: the first press arms, the second puts it aside", () => {
    rebind({ "edit.close": ["alt+q"] });
    try {
      const d = new Draft("test", 0, "");
      for (const k of typeKeys("kale")) d.key(k);
      expect(d.key(alt("q"))).toBe("keep");
      expect(d.key(alt("q"))).toBe("discard");
    } finally { rebind({}); }
  });

  test("comment.place and comment.grip rebound show in the hint (the comment keys table), and the [ wrap shows its rebound key", () => {
    rebind({ "comment.place": ["alt+o"], "comment.grip": ["alt+g"], "draft.wrap with=[": ["alt+8"] });
    try {
      const d = new Draft("test", 0, "beans");
      d.place(0, 0); d.place(0, 5, true);
      const h = hint(d, { save: "send", place: "floating", move: true });
      expect(h).toContain("alt+o floating");
      expect(h).toContain("alt+g move");
      expect(h).toContain("alt+8 wraps");
      expect(h).not.toContain("^G move");
    } finally { rebind({}); }
  });

  test("the snippet and completion hint rows say the table's keys too", () => {
    rebind({ "draft.indent": ["alt+i"] });
    try {
      const d = new Draft("test", 0, "");
      d.startSnippet([{ start: 0, end: 0 }, { start: 0, end: 0 }] as never, 0);
      expect(hint(d)).toContain("alt+i next");
    } finally { rebind({}); }
  });
});

describe("the line field is an adapter over the edit control, not a subclass of it (Nov 3 review card 8)", () => {
  test("it holds the one Draft its text, history and status live in; a session opened on that draft is the same text", async () => {
    const l = new LineField("sow", false, { complete: false });
    expect(l instanceof Draft).toBe(false);
    expect(l.draft).toBeInstanceOf(Draft);
    l.take({ kind: "char", ch: "n" });
    expect([l.text, l.draft.text, l.col, l.draft.col]).toEqual(["sown", "sown", 4, 4]);
    // The field's undo is the draft's own history.
    expect(l.draft.undos.length).toBeGreaterThan(0);
    l.take(ctrl("z"));
    expect(l.draft.text).toBe("sow");
    // A session opened on its draft types into the same text (an inspector value is this).
    const s = DraftSession.open({ place: "test:line-adapter", back: "", label: "line", what: "line", verb: "save", leaveWrites: false, submit: async () => ({ ok: true }) }, { draft: l.draft }, {});
    s.key({ kind: "char", ch: "!" }, { completer: null, run: () => {} });
    expect(l.text).toBe("sow!");
  });
});

describe("the facets tile's query line is the one line field with the draft's keys (Nov 3 review card 1)", () => {
  const was = process.env.EP0CH_KEYMAP;
  let file = "";
  beforeAll(() => { file = join(mkdtempSync(join(tmpdir(), "edit-keymap-facets-")), "keybindings.json"); process.env.EP0CH_KEYMAP = file; reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });
  const rebind = (map: Record<string, string[]>) => { writeFileSync(file, JSON.stringify(map)); reloadKeymap(); };
  const desk = { redraw() {}, ctx: { copy() {} } } as never;
  const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

  test("the hint names the table's keys; a rebind of edit.close shows and drops the query on the new key, esc doing nothing", async () => {
    const { FacetsPane } = await import("../src/desk/facets");
    const pane = new FacetsPane();
    pane.editQuery(desk, "seed beans");
    expect(plain(pane.hint())).toContain("esc undo");
    expect(plain(pane.hint())).toContain("⏎ apply");
    rebind({ "edit.close": ["alt+q"] });
    try {
      expect(plain(pane.hint())).toContain("alt+q undo");
      expect(plain(pane.hint())).not.toContain("esc undo");
      pane.key({ kind: "esc" }, desk);
      expect(pane.draft).not.toBeNull();
      pane.key(alt("q"), desk);
      expect(pane.draft).toBeNull();
    } finally { rebind({}); }
  });

  test("the typing keys are the line field's: a rebound erase-word and clear work on the query, undo takes them back", async () => {
    const { FacetsPane } = await import("../src/desk/facets");
    rebind({ "draft.erase to=word-back": ["alt+e"], "draft.clear": ["alt+k"] });
    try {
      const pane = new FacetsPane();
      // Words given to the line (a button's ▸ edit the query) are typed on at their end (PIE-1731).
      pane.editQuery(desk, "seed beans");
      pane.key({ kind: "char", ch: "!" }, desk);
      expect(pane.draft!.text).toBe("seed beans!");
      pane.draft!.set("seed beans");
      pane.key(ctrl("w"), desk);
      expect(pane.draft!.text).toBe("seed beans");
      pane.key(alt("e"), desk);
      expect(pane.draft!.text).toBe("seed ");
      pane.key(alt("k"), desk);
      expect(pane.draft!.text).toBe("");
      pane.key(ctrl("z"), desk);
      expect(pane.draft!.text).toBe("seed ");
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

describe("typing while a save lands is held, never shown and then dropped (PIE-1542 review)", () => {
  test("an inspector field: keys pressed while its save is in flight change nothing; what's saved is what was shown", async () => {
    const ins = new Inspector(), saved: string[] = [];
    let land!: () => void;
    await ins.edit("title", "", [], false, "test:held", v => { saved.push(v); return new Promise<void>(r => { land = r; }); });
    for (const k of typeKeys("beans")) ins.key(k);
    const r = ins.key(ctrl("s"));
    expect(r).toEqual({ op: "save" });
    const saving = ins.input("save");
    await Bun.sleep(0);
    ins.key({ kind: "char", ch: "!" });
    expect(ins.field!.session.draft.text).toBe("beans");
    land(); await saving;
    expect(saved).toEqual(["beans"]);
  });
  test("a draft session holds keys while its submit is in flight", async () => {
    let land!: () => void;
    const s = DraftSession.open({ place: "test:held-session", back: "", label: "held", what: "held", verb: "save", leaveWrites: false, submit: () => new Promise(r => { land = () => r({ ok: true }); }) }, { text: "beans" }, {});
    const done = s.submit();
    s.key({ kind: "char", ch: "!" }, { completer: null, run: () => {} });
    expect(s.draft.text).toBe("beans");
    land(); await done;
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

describe("a table edited as cells keeps the keys inside its cells (PIE-1542 review)", () => {
  test("shift+↑ and shift+↓ move between cells, as ↑ ↓ do, never selecting across the separator", async () => {
    const { elementEdit } = await import("../src/surface/element-editor");
    const d = new Draft("test", 0, "Beds\n| crop | bed |\n| --- | --- |\n| beans | one |\n| kale | two |");
    const e = elementEdit(d);
    e.on = true;
    d.place(3, 3);
    const ran: [string, unknown][] = [];
    for (const kind of ["up", "down"] as const) {
      const took = e.key({ kind, shift: true }, (action, args) => { ran.push([action, args]); });
      expect(took).toBe(true);
    }
    expect(ran).toEqual([["rich.move", { direction: "up" }], ["rich.move", { direction: "down" }]]);
    expect(d.selection()).toBeNull();
  });
});

describe("the hosts take edit.close, tab, shift+tab and the $EDITOR chord from the table, not from the literal keys (Nov 3 review card 1, #1390 walk follow-ups)", () => {
  const was = process.env.EP0CH_KEYMAP;
  let file = "";
  beforeAll(() => { file = join(mkdtempSync(join(tmpdir(), "edit-keymap-hosts-")), "keybindings.json"); process.env.EP0CH_KEYMAP = file; reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });
  const rebind = (map: Record<string, string[]>) => { writeFileSync(file, JSON.stringify(map)); reloadKeymap(); };
  const open = (name: string) => {
    const ran: string[] = [];
    const s = DraftSession.open({ place: `test:${name}`, back: "", label: name, what: name, verb: "save", leaveWrites: false, submit: async () => ({ ok: true }) }, { text: "" }, {});
    return { s, ran, press: (k: Key) => s.key(k, { completer: null, run: cmd => { ran.push(cmd); } }) };
  };

  test("a note's edit, a comment and the composer close on the rebound edit.close and indent on the rebound tab; Esc and tab do nothing", () => {
    rebind({ "edit.close": ["alt+q"], "draft.indent": ["alt+i"], "draft.outdent": ["alt+o"], "edit.external": ["ctrl+x alt+e"] });
    try {
      for (const name of ["note edit", "comment", "composer"]) {
        const h = open(name);
        h.press({ kind: "esc" });
        expect({ host: name, ran: h.ran }).toEqual({ host: name, ran: [] });
        h.press(alt("q"));
        expect({ host: name, ran: h.ran }).toEqual({ host: name, ran: ["close"] });
        // The comment's own esc row (comment.escape) reads as the composer's close key, wherever the keymap put it.
        const again = open(name);
        asHintEsc(() => again.press({ kind: "esc" }));
        expect({ host: name, ran: again.ran }).toEqual({ host: name, ran: ["close"] });
        const typed = open(name);
        for (const k of typeKeys("- beans")) typed.press(k);
        typed.press({ kind: "tab" });
        expect(typed.s.draft.text).toBe("- beans");
        typed.press(alt("i"));
        expect(typed.s.draft.text).toBe("  - beans");
        typed.press(alt("o"));
        expect(typed.s.draft.text).toBe("- beans");
        // The chord's second key.
        typed.press(ctrl("x")); typed.press(ctrl("e"));
        expect(typed.ran).not.toContain("editor");
        typed.press(ctrl("x")); typed.press(alt("e"));
        expect(typed.ran).toContain("editor");
      }
    } finally { rebind({}); }
  });

  test("the inspector's value field cancels on the rebound edit.close, and Esc does nothing there", () => {
    const panel = (text: string) => {
      const input = new LineField(text, false, { complete: false });
      const session = DraftSession.open({ place: "test:panel", back: "", label: "value", what: "value", verb: "save", leaveWrites: false, submit: async () => ({ ok: true }) }, { draft: input.draft }, {});
      const p = new PropertyPanel();
      p.field = { row: { key: "priority", value: text } as never, session, input };
      return p;
    };
    expect(panel("high").key({ kind: "esc" }, 10)).toBe("cancel");
    rebind({ "edit.close": ["alt+q"] });
    try {
      expect(panel("high").key({ kind: "esc" }, 10)).toBeNull();
      expect(panel("high").key(alt("q"), 10)).toBe("cancel");
    } finally { rebind({}); }
  });
});
