// The one-off migration for the drawer and dock word swap (scripts/migrations/drawer-words.ts): a state dir saved in the
// old words reads in the new ones, a dry run changes nothing, and a screen note's spec is rewritten through a scratch
// outline host. Fictional layouts and notes; delete this with the script once it has run where it matters.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateNoteText, migrateNotes, migrateState, migrateValue } from "../scripts/migrations/drawer-words";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const oldLayout = { root: { t: "split", dir: "row", weights: [0.3, 0.7], kids: [{ t: "drawer", edge: "left", open: false, kid: { t: "leaf", kind: "tree", name: "tree" } }, { t: "leaf", kind: "pty", name: "kettle", kept: "dock.json:dock.agent" }] }, focus: 1 };

describe("drawer-words: the old words saved, read in the new ones", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ep0ch-drawer-words-"));
    const s = join(dir, "sessions", "local", "allotment");
    mkdirSync(s, { recursive: true });
    writeFileSync(join(s, "dock.json"), JSON.stringify({ open: true, share: 0.5 }));
    writeFileSync(join(s, "dock-tiles.json"), JSON.stringify({ root: { t: "tabs", ids: [{ t: "leaf", kind: "dock.own", name: "dock.agent" }, { t: "leaf", kind: "pty", name: "kettle" }] } }));
    writeFileSync(join(s, "desk.json"), JSON.stringify(oldLayout, null, 2));
    writeFileSync(join(s, "session-state.json"), JSON.stringify({ v: 2, screens: [], reopen: [{ action: "edit", tile: "notes", dock: true }] }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("values: a drawer node is a dock, the drawer's own tile and keys its new names; nothing else moves", () => {
    expect(migrateValue({ t: "drawer", edge: "left", kid: { t: "leaf", name: "dock" } })).toEqual({ t: "dock", edge: "left", kid: { t: "leaf", name: "dock" } });
    expect(migrateValue(["dock.agent", "dock.own", "dock.tiles", "dock.json:t3", "a dock note"])).toEqual(["drawer.agent", "drawer.own", "drawer.tiles", "drawer.json:t3", "a dock note"]);
  });

  test("a dry run says what it would do and changes nothing; --write renames and rewrites", () => {
    const s = join(dir, "sessions", "local", "allotment");
    const dry = migrateState(dir, false);
    expect(dry.renamed.map(x => x.split(" → ")[1])).toEqual(expect.arrayContaining(["drawer.json", "drawer-tiles.json"]));
    expect(dry.rewritten).toEqual(expect.arrayContaining([join(s, "desk.json"), join(s, "session-state.json"), join(s, "dock-tiles.json")]));
    expect(existsSync(join(s, "dock.json"))).toBe(true);
    migrateState(dir, true);
    expect(existsSync(join(s, "dock.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(s, "drawer.json"), "utf8"))).toEqual({ open: true, share: 0.5 });
    expect(JSON.parse(readFileSync(join(s, "drawer-tiles.json"), "utf8")).root.ids[0]).toEqual({ t: "leaf", kind: "drawer.own", name: "drawer.agent" });
    const desk = JSON.parse(readFileSync(join(s, "desk.json"), "utf8"));
    expect(desk.root.kids[0].t).toBe("dock");
    expect(desk.root.kids[1].kept).toBe("drawer.json:drawer.agent");
    expect(JSON.parse(readFileSync(join(s, "session-state.json"), "utf8")).reopen[0]).toEqual({ action: "edit", tile: "notes", drawer: true });
    // Run again: nothing left in the old words.
    const again = migrateState(dir, false);
    expect([...again.renamed, ...again.rewritten]).toEqual([]);
  });

  test("a screen note's spec: its ```json rewritten, the rest of the note as it was", () => {
    const text = `allotment [type::screen] [screen::allotment]\nA screen made in the door.\n\n\`\`\`json\n${JSON.stringify({ name: "allotment", layout: oldLayout }, null, 2)}\n\`\`\``;
    const next = migrateNoteText(text)!;
    expect(next.startsWith("allotment [type::screen] [screen::allotment]\nA screen made in the door.\n\n```json\n")).toBe(true);
    expect(next).toContain(`"t": "dock"`);
    expect(next).not.toContain(`"t": "drawer"`);
    expect(migrateNoteText(next)).toBeNull();
  });
});

describe.skipIf(!outliner)("drawer-words: screen notes through a scratch outline host", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("a screen note in the old words is rewritten with the revision read; a dry run leaves it", async () => {
    const text = `beds [type::screen] [screen::beds]\nA screen made in the door.\n\n\`\`\`json\n${JSON.stringify({ name: "beds", layout: oldLayout }, null, 2)}\n\`\`\``;
    const note = await board.request<any>("create", { parentId: null, text, author: "agent" });
    const dry = await migrateNotes(board, false, { renamed: [], rewritten: [], skipped: [], notes: [] });
    expect(dry.notes).toEqual([expect.stringContaining(note.id)]);
    expect((await board.byProp("type", "screen"))[0]!.text).toContain(`"t": "drawer"`);
    await migrateNotes(board, true, { renamed: [], rewritten: [], skipped: [], notes: [] });
    const after = (await board.byProp("type", "screen")).find(m => m.id === note.id)!;
    expect(after.text).toContain(`"t": "dock"`);
    expect(after.text).not.toContain(`"t": "drawer"`);
  });
});
