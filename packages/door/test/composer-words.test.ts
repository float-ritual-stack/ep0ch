// PIE-1790: Evan writes a card into a roadmap lane, it's refused, and he can read which properties to add without
// widening anything, at 44 columns as at 177. A real tmux pane over a scratch service, his keys. Made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { TallyDoors } from "./tally-pane";

describe.skipIf(!outliner || !Bun.which("tmux"))("a composer refusal shows what to type (PIE-1790)", () => {
  const doors = new TallyDoors();
  let hub = "";
  beforeAll(async () => {
    await doors.start();
    await doors.board.request("work-ids.configure", { prefix: "HOME" });
    await doors.create("Shed work queue [type::work-queue] [project::shed]");
    hub = await doors.create("Shed board");
    for (const s of ["queued", "doing"]) await doors.board.request("create", { parentId: hub, author: "user", text: `${s[0]!.toUpperCase()}${s.slice(1)} [type::virtual-branch] [query::type=roadmap-item project=shed work-stage=${s}] [create::project=shed]` });
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
});

