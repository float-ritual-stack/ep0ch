// PIE-1790: Evan writes a card into a roadmap lane, it's refused, and he can read which properties to add without
// widening anything, at 44 columns as at 177. A real tmux pane over a scratch service, his keys. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { TallyDoors, idle } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("a composer refusal shows what to type (PIE-1790)", () => {
  const doors = new TallyDoors();
  let hub = "";
  beforeAll(async () => {
    await doors.start();
    await doors.board.request("work-ids.configure", { prefix: "HOME" });
    await doors.create("Shed work queue [type::work-queue] [project::shed]");
    hub = await doors.create("Shed board");
    for (const s of ["queued", "doing"]) await doors.board.request("create", { parentId: hub, author: "user", text: `${s[0]!.toUpperCase()}${s.slice(1)} [type::virtual-branch] [query::type=roadmap-item project=shed work-stage=${s}] [create::project=shed]` });
    // A lane whose query asks more than its create:: sets: the composer says "the text must also meet" in a row of its own.
    await doors.board.request("create", { parentId: hub, author: "user", text: "Bench [type::virtual-branch] [query::type=roadmap-item project=shed work-stage=queued (area=bench OR area=wall)] [create::project=shed]" });
  }, 40_000);
  afterAll(() => doors.stop());

  for (const cols of [44, 177]) test(`at ${cols} columns the refusal names the properties to add, whole`, async () => {
    const p = await doors.pane(hub, "Doing", cols, 40, { screen: ["--screen", "board", hub] });
    try {
      p.keys("l"); await Bun.sleep(300);
      p.keys("n"); await until(() => p.capture().includes("new card in"), "the composer");
      await until(() => !p.capture().includes("asking the outline"), "the lane's plan");
      p.type("Oil the hinges"); p.keys("C-s");
      await until(() => p.capture().includes("not created"), "the refusal", 8000);
      const flat = p.capture().split("\n").map(l => l.replace(/^[│║|]\s?|\s*[│║|]\s*$/g, "").trim()).join(" ");
      for (const t of ["[priority::", "[arc::", "[track::"]) expect(flat).toContain(t);
    } finally { p.close(); }
  }, 60_000);

  // ^W o d with his keys on a lane was refused ("the lanes container takes only query"): an open naming no place now
  // lands beside the tile the lane shows its card in, its preview.
  test("^W o d on a lane opens the reader beside the lane's preview", async () => {
    const p = await doors.pane(hub, "Doing", 177, 40, { screen: ["--screen", "board", hub] });
    try {
      const tiles = () => JSON.parse(p.act("layout.get").out).layers.find((l: { drawer: boolean }) => !l.drawer).tiles as { name: string; kind: string; focused: boolean }[];
      await until(() => tiles().find(t => t.focused)?.kind === "query", "his keys on a lane");
      const before = tiles().length;
      p.keys("C-w", "o"); await Bun.sleep(400); p.keys("d");
      await until(() => tiles().length === before + 1, "a new tile", 5000);
      expect(tiles().filter(t => t.kind === "reader").length).toBe(1);
      expect(p.capture()).not.toContain("takes only");
    } finally { p.close(); }
  }, 60_000);

  // ^W P at 44 columns wrapped each wire row onto two lines and drew its × (clear the wire) on both.
  test("^W P at 44 columns draws one × per wire row, however it wraps", async () => {
    const p = await doors.pane(hub, "Doing", 44, 40, { screen: ["--screen", "board", hub] });
    try {
      p.keys("C-w", "P"); await until(() => p.capture().includes("pick on"), "the policy panel");
      const box = p.capture().split("\n").filter(l => l.includes("│") && !/[─═]/.test(l) && !l.startsWith("‹"));   // its rows: not a frame's close, nor the status bar
      const wires = box.filter(l => / · pick/.test(l)).length, crosses = box.filter(l => l.includes("×")).length;
      expect(wires).toBeGreaterThan(0);
      expect(crosses).toBe(wires);
    } finally { p.close(); }
  }, 60_000);

  // Codex on #1496: a short composer (44×16) with a "text must also meet" row and a four-row refusal pushed the draft's
  // text onto the bottom border. The text keeps its rows; the refusal takes what's left.
  test("at 44×16 the draft's text stays in the box beside a long refusal", async () => {
    const p = await doors.pane(hub, "Doing", 44, 16, { screen: ["--screen", "board", hub] });
    try {
      await idle();
      expect(p.act("tile.focus", "tile=Bench").ok).toBe(true);
      p.keys("n"); await until(() => p.capture().includes("new card in"), "the composer");
      await until(() => !p.capture().includes("asking the outline"), "the lane's plan");
      p.type("Oil the hinges"); p.keys("C-s");
      await until(() => p.capture().includes("not created"), "the refusal", 8000);
      const rows = p.capture().split("\n"), at = rows.findIndex(l => l.includes("Oil the hinges"));
      expect(at).toBeGreaterThan(-1);
      expect(rows[at]).toMatch(/│\s*Oil the hinges/);   // inside the box, not on its border
    } finally { p.close(); }
  }, 60_000);

  // Codex on #1496: an agent's open redirected beside the preview came back as a copy of the layout's answer, so the
  // step lost who made it and the agent's own layout.undo was refused as the person's.
  test("an agent's redirected open is its own step: its layout.undo takes it back", async () => {
    const p = await doors.pane(hub, "Doing", 177, 40, { screen: ["--screen", "board", hub] });
    try {
      const tiles = () => JSON.parse(p.act("layout.get").out).layers.find((l: { drawer: boolean }) => !l.drawer).tiles as { name: string; kind: string }[];
      await idle();
      const before = tiles().length, opened = p.act("tile.open", "kind=reader", "where=right");
      expect([opened.ok, opened.out]).toEqual([true, expect.stringContaining("so it went beside")]);
      await until(() => tiles().length === before + 1, "the reader open");
      const undo = p.act("layout.undo");
      expect([undo.ok, undo.out]).toEqual([true, expect.any(String)]);
      await until(() => tiles().length === before, "the open taken back");
    } finally { p.close(); }
  }, 60_000);

  // Codex on #1496: tile=Doing (named) redirected where to=Doing refused. A tile named gets that tile or the refusal;
  // only an open from the keys' tile (^W o, or none named) lands beside the preview.
  test("tile.open naming a lane (tile=) is refused there, as to= is", async () => {
    const p = await doors.pane(hub, "Doing", 177, 40, { screen: ["--screen", "board", hub] });
    try {
      await idle();
      for (const named of ["tile=Doing", "to=Doing"]) {
        const r = p.act("tile.open", "kind=reader", named, "where=right");
        expect([named, r.ok, r.out]).toEqual([named, false, expect.stringContaining("takes only query")]);
      }
    } finally { p.close(); }
  }, 60_000);

  // Codex on #1496: at 44 the blank cell under a wrapped wire row's × still cleared the wire. Only the × line does.
  test("^W P at 44: a click under a wire row's × clears nothing", async () => {
    const p = await doors.pane(hub, "Doing", 44, 40, { screen: ["--screen", "board", hub] });
    try {
      const wires = () => JSON.stringify(JSON.parse(p.act("layout.get").out).layers.find((l: { drawer: boolean }) => !l.drawer).tiles.map((t: { name: string; wires?: unknown }) => [t.name, t.wires]));
      const was = wires();
      p.keys("C-w", "P"); await until(() => p.capture().includes("pick on"), "the policy panel");
      const frame = p.capture(), row = frame.split("\n").findIndex(l => / · pick/.test(l) && l.includes("×"));
      const col = frame.split("\n")[row]!.indexOf("×");
      expect(frame.split("\n")[row + 1]!.slice(col, col + 1)).not.toBe("×");
      p.click({ col: col + 1, row: row + 2 });   // the cell under ×, 1-based
      await Bun.sleep(600);
      expect(wires()).toBe(was);
    } finally { p.close(); }
  }, 60_000);
});

