// PIE-410: readers fold headings and nested lists, as Detail does (PIE-386). A heading folds through the
// next heading of the same or a higher level; a list item folds its nested items and continuation lines.
// Folding is the reader's reading state: the note's text never changes, folds survive live refreshes and
// edits elsewhere in the note, and reset when the reader shows another note. Keys, clicks and agents (the
// action registry) all fold the same way. The service part runs against a throwaway outliner only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import { DeliveryBoard } from "../src/desk/delivery";
import { foldPoints, renderDoc, type DocEnv } from "../src/doc";
import { MainMenu } from "../src/screens";
import { SocketBoard, type Actor } from "../src/socket";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const AGENT: Actor = { kind: "agent", id: "claude-410" };

const BODY = [
  "Intro: what goes where this year.",   // 0
  "",                                      // 1
  "## Beds",                               // 2
  "- [ ] dig the north bed",               // 3
  "  - edge it with boards",               // 4
  "  - add compost",                       // 5
  "    two barrows, well rotted",          // 6
  "- [ ] buy canes",                       // 7
  "",                                      // 8
  "### Soil",                              // 9
  "Loam, mostly.",                         // 10
  "",                                      // 11
  "## Water",                              // 12
  "The hose runs along the fence.",        // 13
  "```",                                   // 14
  "# not a heading",                       // 15
  "```",                                   // 16
  "",                                      // 17
  "# Later",                               // 18
  "Mulch in autumn.",                      // 19
].join("\n");
const TEXT = `Plan the allotment [stage::queued]\n${BODY}`;
const ENV: DocEnv = { width: 60, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false };
const note = (text: string, over: Partial<Msg> = {}): Msg => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {}, ...over });
const host = (): SurfaceHost & { flashes: string[] } => {
  const flashes: string[] = [];
  return { flashes, ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} };
};
const body = (s: NoteSurface, h: SurfaceHost, rows = 40) => s.render(60, rows, h).lines.map(plain).join("\n");

describe("fold points", () => {
  const points = foldPoints(BODY);
  const by = (text: string) => points.find(p => p.text === text)!;

  test("a heading folds through the next heading of the same or a higher level; a fence's # line isn't one", () => {
    expect(points.map(p => [p.kind, p.text, p.line, p.end])).toEqual([
      ["heading", "Beds", 2, 11],                 // through ### Soil, up to ## Water (the blank line before it stays)
      ["list", "[ ] dig the north bed", 3, 7],     // its nested items and the continuation line, not the next item
      ["list", "add compost", 5, 7],
      ["heading", "Soil", 9, 11],
      ["heading", "Water", 12, 17],               // the fence goes with it; "# not a heading" doesn't end it
      ["heading", "Later", 18, 20],
    ]);
    expect(by("Beds").hidden).toBe(7);
    expect(points.some(p => p.text === "not a heading")).toBe(false);
  });

  test("names survive edits elsewhere; repeats are told apart; an anchor names its heading", () => {
    const again = foldPoints("Changed intro.\n\nMore text.\n" + BODY);
    expect(again.map(p => p.key)).toEqual(points.map(p => p.key));
    const twice = foldPoints("## Notes\na\n## Notes\nb");
    expect(twice.map(p => p.key)).toEqual(["heading:2:Notes#0", "heading:2:Notes#1"]);
    const anchors: (string | undefined)[] = ["beds"];
    expect(foldPoints("## Beds, renamed\na", anchors)[0]!.key).toBe("^beds");
    // The service's task id on a step (added when it gets a comment) doesn't rename the item.
    expect(foldPoints("- step ^task-c1a0d412-fa9f-461c-80c4-eb95ddf68a2a\n  - child")[0]!.key).toBe(foldPoints("- step\n  - child")[0]!.key);
  });

  test("a folded heading or item draws its disclosure and what it hides, and nothing it hides", () => {
    const pts = foldPoints(BODY);
    const draw = (folded: string[]) => {
      const doc = renderDoc(BODY, { ...ENV, folds: { points: pts, folded: new Set(folded.map(t => pts.find(p => p.text === t)!.key)) } });
      return { doc, text: doc.lines.map(plain) };
    };
    const open = draw([]);
    // Every fold point shows its disclosure (▾ open), which a click toggles; other lines draw as before.
    expect(open.text).toContain("▾ ## Beds");
    expect(open.text).toContain("▾ [ ] dig the north bed");
    expect(open.text).toContain("  ∙ edge it with boards");
    expect(renderDoc(BODY, ENV).lines.map(plain)).toContain("## Beds");   // without folds (an embed): as always
    const beds = draw(["Beds"]);
    expect(beds.text).toContain("▸ ## Beds · 7 lines folded");
    expect(beds.text.join("\n")).not.toContain("dig the north bed");
    expect(beds.text.join("\n")).not.toContain("Loam");
    expect(beds.text).toContain("▾ ## Water");
    expect(beds.doc.lines.length).toBe(open.doc.lines.length - 8);
    const item = draw(["[ ] dig the north bed"]);
    expect(item.text).toContain("▸ [ ] dig the north bed · 3 lines folded");
    expect(item.text.join("\n")).not.toContain("edge it");
    expect(item.text).toContain("∙ [ ] buy canes");
    // Nested: the inner fold stays when the outer one opens again.
    const inner = draw(["add compost"]);
    expect(inner.text).toContain("  ▸ add compost · 1 line folded");
    expect(inner.text).toContain("  ∙ edge it with boards");
    expect(inner.text.join("\n")).not.toContain("barrows");
    // Rows map back to the body lines they draw, folded or not (for hit-testing and link clicks).
    expect(beds.doc.source[beds.text.indexOf("▾ ## Water")]).toBe(12);
    expect(beds.doc.heads.map(h => [h.row, beds.text[h.row]!.slice(0, 9)])).toContainEqual([beds.text.indexOf("▸ ## Beds · 7 lines folded"), "▸ ## Beds"]);
  });
});

describe("a reader's folds, without a service", () => {
  test("keys: ) selects, f folds and unfolds, F folds every outer section then unfolds all; the text never changes", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    expect(body(s, h)).toContain("dig the north bed");
    expect(s.hint()).toContain("( ) f folds");
    s.key(char(")"), h);
    expect(s.hint()).toStartWith("fold 1/6 ## Beds · ⏎ f fold");
    s.key(char("f"), h);
    expect(body(s, h)).toContain("▸ ## Beds · 7 lines folded");
    expect(body(s, h)).not.toContain("dig the north bed");
    expect(s.msg!.text).toBe(TEXT);
    // ⏎ toggles the selected fold point when no link is selected.
    s.key({ kind: "enter" }, h);
    expect(body(s, h)).toContain("dig the north bed");
    // Folded sections' points aren't stepped through: ) goes from Beds to Water when Beds is folded.
    s.key(char("f"), h);
    s.key(char(")"), h);
    expect(s.describe().folds).toEqual({ points: 6, folded: ["## Beds"], selected: "## Water" });
    s.key(char("F"), h);            // something is folded: F unfolds everything
    expect(s.describe().folds!.folded).toEqual([]);
    s.key(char("F"), h);            // nothing folded: F folds every outermost one
    expect(s.describe().folds!.folded).toEqual(["## Beds", "## Water", "# Later"]);
    expect(body(s, h)).not.toContain("Mulch");
  });

  test("f with nothing selected folds the section at the top of the view", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.render(60, 12, h);
    s.scroll = 9;                 // "Loam, mostly." (under ### Soil) is at the top
    s.render(60, 12, h);
    s.key(char("f"), h);
    expect(s.describe().folds!.folded).toEqual(["### Soil"]);
  });

  test("the scroll indicator counts the rows drawn: a fold shortens the note, and the view clamps to it", () => {
    const long = `Long note\n## Top\n${Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n")}\n## End\nlast`;
    const s = new NoteSurface(), h = host();
    s.show(note(long), h);
    const before = s.render(60, 20, h).scroll!;
    s.scroll = 40;
    const at = s.render(60, 20, h).scroll!;
    expect(at.top).toBe(40);
    s.key(char(")"), h);                    // the first fold point in view (## Top is scrolled past): ## End
    expect(s.describe().folds!.selected).toBe("## End");
    s.key(char("("), h); s.key(char("f"), h);
    const after = s.render(60, 20, h).scroll!;
    expect(after.total).toBe(before.total - 60);        // the 60 lines under ## Top
    expect(after.room).toBe(before.room);
    // Everything fits now: the view is at the top, with the folded heading in it.
    expect(after.top).toBe(0);
    expect(after.total).toBeLessThanOrEqual(after.room);
    expect(s.render(60, 20, h).lines.map(l => plain(l).trimEnd())).toContain(" ▸ ## Top · 60 lines folded");   // the ruler pads its row
  });

  test("folds survive a refresh and an edit elsewhere, drop when their heading is reworded, and reset on another note", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.key(char(")"), h); s.key(char("f"), h);
    s.refresh(note(TEXT.replace("Intro: what goes where this year.", "Intro, rewritten elsewhere.\n\nWith a new paragraph."), { revision: 4 }));
    expect(body(s, h)).toContain("▸ ## Beds");
    // The same note shown again (the preview following its own card) keeps them.
    s.show(note(s.msg!.text, { revision: 4 }), h);
    expect(s.describe().folds!.folded).toEqual(["## Beds"]);
    // Reworded: it would hide a different section, so it's dropped.
    s.refresh(note(s.msg!.text.replace("## Beds", "## Raised beds"), { revision: 5 }));
    expect(body(s, h)).toContain("dig the north bed");
    expect(s.describe().folds!.folded).toEqual([]);
    s.act("fold", { text: "Water" }, h, AGENT);
    return Bun.sleep(0).then(() => {
      expect(s.describe().folds!.folded).toEqual(["## Water"]);
      s.show(note("Another note\n## Water\nrain barrel", { id: "99999999-2222-4333-8444-555555555555" }), h);
      expect(s.describe().folds).toEqual({ points: 1, folded: [], selected: null });
      expect(body(s, h)).toContain("## Water");
    });
  });

  test("a heading with an anchor keeps its fold when it's reworded", () => {
    const s = new NoteSurface(), h = host();
    s.show(note("Anchored\n## Beds ^beds\n- dig\n## Water\nhose"), h);
    s.key(char(")"), h); s.key(char("f"), h);
    s.refresh(note("Anchored\n## Raised beds ^beds\n- dig\n## Water\nhose", { revision: 4 }));
    expect(s.describe().folds!.folded).toEqual(["## Raised beds"]);
    expect(body(s, h)).not.toContain("dig");
    expect(body(s, h)).not.toContain("^beds");
  });

  test("a click on a heading, or on a list item's mark, folds it; rows map to the note's lines", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    const lines = s.render(60, 40, h).lines.map(plain);
    const water = lines.findIndex(l => l.includes("## Water"));
    expect(s.sourceLineAt(water)).toBe(13);                // the note's line (0 is the subject)
    expect(s.click(20, water, h)).toBe(true);
    expect(s.describe().folds!.folded).toEqual(["## Water"]);
    const dig = s.render(60, 40, h).lines.map(plain).findIndex(l => l.includes("dig the north bed"));
    expect(s.click(40, dig, h)).toBe(false);              // the item's text isn't its disclosure
    expect(s.click(2, dig, h)).toBe(true);
    expect(s.describe().folds!.folded).toEqual(["- [ ] dig the north bed", "## Water"]);
    const after = s.render(60, 40, h).lines.map(plain);
    expect(s.sourceLineAt(after.findIndex(l => l.includes("buy canes")))).toBe(8);
    expect(s.sourceLineAt(0)).toBe(null);                  // the header isn't the body
  });

  test("callouts still fold with z inside an unfolded section", () => {
    const s = new NoteSurface(), h = host();
    s.show(note("Callouts\n## Notes\n> [!tip]- Frost\n> Nothing out before May."), h);
    expect(body(s, h)).toContain("z unfolds");
    s.key(char("z"), h);
    expect(body(s, h)).toContain("Nothing out before May.");
    s.key(char(")"), h); s.key(char("f"), h);
    expect(body(s, h)).not.toContain("Frost");
    s.key(char("f"), h);
    expect(body(s, h)).toContain("Nothing out before May.");      // z's choice is kept under the fold
  });

  test("agent actions: fold, unfold, fold.toggle by text, line or n; folds lists them; refusals say why", async () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    const act = (name: string, args: Record<string, unknown> = {}) => s.act(name, args, h, AGENT) as Promise<any>;
    const listed = (await act("folds")).folds;
    expect(listed.map((f: any) => [f.n, f.text, f.line, f.folded])).toEqual([
      [1, "Beds", 4, false], [2, "[ ] dig the north bed", 5, false], [3, "add compost", 7, false],
      [4, "Soil", 11, false], [5, "Water", 14, false], [6, "Later", 20, false],
    ]);
    expect(await act("fold", { text: "## Beds" })).toMatchObject({ n: 1, text: "Beds", line: 4, folded: true, foldedNow: ["## Beds"] });
    expect(s.describe().agent?.did).toBe("folded ## Beds");
    expect(s.describe().folds!.selected).toBe(null);       // an agent's fold doesn't move the person's selection
    expect(await act("fold", { text: "dig the north" })).toMatchObject({ n: 2, folded: true });
    expect(await act("fold.toggle", { line: 8 })).toMatchObject({ text: "add compost", folded: true });   // inside "add compost"
    expect((await act("folds")).folds.filter((f: any) => f.folded).map((f: any) => [f.text, f.shown])).toEqual([["Beds", true], ["[ ] dig the north bed", false], ["add compost", false]]);
    expect(await act("unfold", { n: 1 })).toMatchObject({ folded: false });
    expect(await act("unfold", { all: true })).toMatchObject({ changed: 2, foldedNow: [] });
    expect(await act("fold", { all: true })).toMatchObject({ changed: 3 });
    await expect(act("fold", { text: "Compost heap" })).rejects.toThrow('no heading or list item reads "Compost heap"; the note\'s are: line 4 ## Beds');
    await expect(act("fold", {})).rejects.toThrow("one of text=, line= or n=");
    await expect(act("fold", { line: 1 })).rejects.toThrow("line 1 is the subject");
    await expect(act("fold", { line: 2 })).rejects.toThrow("line 2 isn't a heading or a list item with nested lines, nor inside one");
    await expect(act("fold", { n: 9 })).rejects.toThrow("there is no fold point 9; the note has 6");
    await expect(act("fold", { all: true, n: 1 })).rejects.toThrow("leave out text, line and n");
    const dup = new NoteSurface();
    dup.show(note("Twice\n## Notes\na\n## Notes\nb"), h);
    await expect(dup.act("fold", { text: "Notes" }, h, AGENT)).rejects.toThrow("2 match \"Notes\" (line 2 ## Notes; line 4 ## Notes); pass line= or n=");
    expect(await dup.act("fold", { line: 4 }, h, AGENT)).toMatchObject({ n: 2, folded: true });
    const empty = new NoteSurface();
    await expect(empty.act("fold", { text: "x" }, h, AGENT)).rejects.toThrow("this reader shows no note");
  });

  test("the registry lists the fold actions with their keys", () => {
    const names = NOTE_ACTIONS.list().map(a => [a.name, a.keys]);
    expect(names).toContainEqual(["fold", "( ) then f or enter, click, F"]);
    expect(names).toContainEqual(["unfold", "( ) then f or enter, click, F"]);
    expect(names).toContainEqual(["fold.toggle", "f, enter, click"]);
    expect(names.map(n => n[0])).toContain("folds");
  });
});

describe("review fixes (PR #13)", () => {
  const LONG = `Long note\n## Top\n- a\n  - a1\n${Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n")}\n## End\nlast`;

  test("1: every repeat counts toward a fold's name, so an earlier empty one gaining a body doesn't move the fold", () => {
    const before = foldPoints("## Notes\n## Notes\nb");
    const after = foldPoints("## Notes\na\n## Notes\nb");
    expect(before.map(p => p.key)).toEqual(["heading:2:Notes#1"]);
    expect(after.find(p => p.line === 2)!.key).toBe(before[0]!.key);
    const s = new NoteSurface(), h = host();
    s.show(note("Twice\n## Notes\n## Notes\nsecond body"), h);
    s.key(char(")"), h); s.key(char("f"), h);
    expect(body(s, h)).not.toContain("second body");
    s.refresh(note("Twice\n## Notes\nfirst body\n## Notes\nsecond body", { revision: 4 }));
    const text = body(s, h);
    expect(text).toContain("first body");                  // the first section isn't the folded one
    expect(text).not.toContain("second body");             // the second stays folded
  });

  test("6: ticking a step elsewhere keeps its fold (the box isn't part of its name)", () => {
    expect(foldPoints("- [x] dig\n  - edge")[0]!.key).toBe(foldPoints("- [ ] dig\n  - edge")[0]!.key);
    const s = new NoteSurface(), h = host();
    s.show(note("Steps\n- [ ] dig\n  - edge it"), h);
    s.key(char(")"), h); s.key(char("f"), h);
    s.refresh(note("Steps\n- [x] dig\n  - edge it", { revision: 4 }));
    expect(s.describe().folds!.folded).toEqual(["- [x] dig"]);
    expect(body(s, h)).not.toContain("edge it");
  });

  test("2: moving on, or esc, lets go of the selected fold point, and then ⏎ isn't the reader's", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(LONG), h);
    s.render(60, 20, h);
    s.key(char(")"), h);
    expect(s.key({ kind: "enter" }, h)).toBe(true);          // selected and in view: ⏎ folds it
    expect(s.describe().folds!.folded).toEqual(["## Top"]);
    s.key({ kind: "enter" }, h);
    s.key(char("j"), h);                                     // scrolling lets go
    expect(s.describe().folds!.selected).toBe(null);
    expect(s.key({ kind: "enter" }, h)).toBe(false);         // the host's ⏎ again (the preview opens a detail)
    s.key(char(")"), h);
    s.wheel(1, h);
    expect(s.describe().folds!.selected).toBe(null);
    s.key(char(")"), h);
    expect(s.key({ kind: "esc" }, h)).toBe(true);            // esc lets go, and is used up doing so
    expect(s.describe().folds!.selected).toBe(null);
    expect(s.key({ kind: "esc" }, h)).toBe(false);           // the next esc is the host's
    // Selected but scrolled out of view (say by an agent): ⏎ isn't a fold.
    s.scroll = 0;
    s.render(60, 20, h);
    s.key(char(")"), h);
    expect(s.describe().folds!.selected).toBe("## Top");
    s.render(60, 20, h);
    s.scroll = 30;
    s.render(60, 20, h);
    expect(s.key({ kind: "enter" }, h)).toBe(false);
    expect(s.describe().folds!.folded).toEqual([]);
  });

  test("3: an agent's fold all and unfold all leave the person's selection and scroll alone", async () => {
    const s = new NoteSurface(), h = host();
    s.show(note(LONG), h);
    s.render(60, 20, h);
    s.key(char(")"), h); s.key(char(")"), h);                // "- a", not an outermost fold point
    s.render(60, 20, h);
    expect(s.describe().folds!.selected).toBe("- a");
    s.scroll = 25;
    s.render(60, 20, h);
    await s.act("fold", { text: "a" }, h, AGENT);
    await s.act("unfold", { all: true }, h, AGENT);
    s.render(60, 20, h);
    expect(s.scroll).toBe(25);
    expect(s.describe().folds!.selected).toBe("- a");
    await s.act("fold", { all: true }, h, AGENT);
    expect(s.describe().folds!.selected).toBe("- a");
  });

  test("4: a link in a heading opens; elsewhere on the heading the click folds it", async () => {
    const target = note("Stake the beans\ncanes", { id: "22222222-2222-4333-8444-555555555555" });
    const went: string[] = [];
    const h = host();
    (h.ctx.board as any).get = async (id: string) => (id === target.id ? target : null);
    h.navigate = (m: Msg) => { went.push(m.id); };
    const s = new NoteSurface();
    s.show(note(`Links\n## See ((${target.id})) first\nunder it`), h);
    const lines = s.render(60, 20, h).lines.map(plain);
    const row = lines.findIndex(l => l.includes("## See"));
    const link = (s as any).hits.find((x: any) => x.row === row && x.link);
    expect(link).toBeTruthy();
    expect(s.click(link.from, row, h)).toBe(true);
    await Bun.sleep(0);
    expect(went).toEqual([target.id]);
    expect(s.describe().folds!.folded).toEqual([]);
    expect(s.click(1, row, h)).toBe(true);                   // the disclosure
    expect(s.describe().folds!.folded.length).toBe(1);
    expect(went).toEqual([target.id]);
  });

  test("5: a click past the surface's cells (a host's border, its scroll thumb) never folds", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    const lines = s.render(60, 40, h).lines.map(plain);
    const water = lines.findIndex(l => l.includes("## Water"));
    expect(s.click(60, water, h)).toBe(false);
    expect(s.click(-1, water, h)).toBe(false);
    expect(s.describe().folds!.folded).toEqual([]);
    expect(s.click(59, water, h)).toBe(true);
  });
});

describe.skipIf(!outliner)("folds in the board's readers, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any, card: any;
  let key: (k: Key) => void = () => {};
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: "test-agent-410" }) as Promise<any>;
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const frame = () => b.render(B().ctx).lines.map(plain);
  const long = `Plan the allotment [stage::queued]\n## Beds\n${Array.from({ length: 60 }, (_, i) => `- bed ${i + 1}: beans, then squash`).join("\n")}\n## Water\nThe hose runs along the fence.`;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    card = await create(null, long);
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = new DeliveryBoard(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 1 && B().lanes.every((l: any) => l.items?.length), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("keys and a click fold in a detail; the frame's thumb and % follow; an edit elsewhere keeps the fold; another note resets it", async () => {
    await act("open", { id: card.id }, "detail");
    const d = B().details[0];
    await until(() => d.msg?.id === card.id && !d.msg.partial, "the whole note");
    expect(B().focus).toBe("detail0");
    const r = B().rects.get("detail0") ?? (frame(), B().rects.get("detail0"));
    const title = () => [...frame()[r.row]!].slice(r.col, r.col + r.cols).join("");
    expect(title()).toMatch(/ · \d+%/);                        // long: the frame says how far down
    key(char(")")); key(char("f"));
    expect(d.surface.describe().folds.folded).toEqual(["## Beds"]);
    expect(frame().join("\n")).toContain("▸ ## Beds · 60 lines folded");
    expect(title()).not.toMatch(/ · \d+%/);                    // it fits now: no thumb, no %
    // A click on ## Water (inside the frame, below the header) folds it too.
    const rows = frame();
    const y = rows.findIndex((l, i) => i > r.row && i < r.row + r.rows && l.includes("## Water"));
    key({ kind: "mouse", action: "down", button: 0, x: r.col + 4, y });
    key({ kind: "mouse", action: "up", button: 0, x: r.col + 4, y });
    expect(d.surface.describe().folds.folded).toEqual(["## Beds", "## Water"]);
    // Someone edits the note elsewhere: the reader refreshes, and the folds stay.
    const cur = (await board.get(card.id))!;
    await board.update(card.id, cur.text.replace("- bed 1: beans", "- bed 1: broad beans"), cur.revision!);
    await until(() => d.msg.text.includes("broad beans"), "the live refresh");
    expect(d.surface.describe().folds.folded).toEqual(["## Beds", "## Water"]);
    // An agent unfolds through the registry, in that reader; the frame says so.
    expect(await act("unfold", { text: "Beds" }, "detail")).toMatchObject({ reader: "detail1", folded: false, foldedNow: ["## Water"] });
    expect(frame().join("\n")).toContain("broad beans");
    expect(frame().join("\n")).toContain("an agent (test-agent-410) unfolded ## Beds");
    // Another note in that reader: nothing folded there.
    const other = await create(null, "Mend the fence [stage::queued]\n## Water\nThe hose again.");
    await act("open", { id: other.id }, "detail");
    await until(() => d.msg?.id === other.id && !d.msg.partial, "the other note");
    expect(d.surface.describe().folds.folded).toEqual([]);
    expect(frame().join("\n")).toContain("The hose again.");
  });

  const click = (x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };
  const rowIn = (lines: string[], r: any, text: string) => lines.findIndex((l, i) => i > r.row && i < r.row + r.rows - 1 && [...l].slice(r.col, r.col + r.cols).join("").includes(text));

  test("review 2: in the preview, ( ) then moving on or esc gives ⏎ back: it opens the note in a detail", async () => {
    await act("open", { id: card.id }, "preview");
    const p = B().preview;
    await until(() => p.msg?.id === card.id && !p.msg.partial, "the whole note in the preview");
    expect(B().focus).toBe("preview");
    const opened = () => B().details.filter((d: any) => d.msg?.id === card.id).length;
    const was = opened();
    frame();
    key(char(")"));
    expect(p.surface.describe().folds.selected).toBe("## Beds");
    key(char("j"));
    key({ kind: "enter" });
    await until(() => opened() === was + 1, "⏎ to open a detail");
    await act("open", { id: card.id }, "preview");
    frame();
    key(char(")"));
    key({ kind: "esc" });
    expect(p.surface.describe().folds.selected).toBe(null);
    expect(B().focus).toBe("preview");                        // the first esc only let go of the fold point
  });

  test("review 4, 5: a heading's link opens, the heading folds, each click reaches the surface once, and the frame never folds", async () => {
    const beans = await create(null, "Stake the beans\nCanes along the fence.");
    const linked = await create(null, `Links in headings\n## See ((${beans.id})) first\nunder the heading\n## Water\nThe hose.`);
    await act("open", { id: linked.id }, "detail");
    const d = B().details.find((x: any) => x.msg?.id === linked.id);
    await until(() => !d.msg.partial && frame().join("\n").includes("Stake the beans"), "the link's title drawn");
    const region = `detail${B().details.indexOf(d)}`;
    const r = B().rects.get(region);
    let calls = 0;
    const orig = d.surface.click.bind(d.surface);
    d.surface.click = (...a: any[]) => { calls++; return orig(...a); };
    // The frame: its right border (where the scroll thumb is drawn) and its bottom border.
    const water = rowIn(frame(), r, "## Water");
    click(r.col + r.cols - 1, water);
    click(r.col + 4, r.row + r.rows - 1);
    expect(d.surface.describe().folds.folded).toEqual([]);
    // The heading, off its link: folds, delivered once.
    calls = 0;
    click(r.col + 4, water);
    expect(calls).toBe(1);
    expect(d.surface.describe().folds.folded).toEqual(["## Water"]);
    // The link in a heading: opens it, doesn't fold.
    const lines = frame(), y = rowIn(lines, r, "Stake the beans");
    const x = plain(lines[y]!).indexOf("Stake the beans", r.col);
    calls = 0;
    click(x + 1, y);
    expect(calls).toBe(1);
    await until(() => d.msg?.id === beans.id, "the heading's link to open");
    d.surface.click = orig;
  });

  test("review 5: the desk's reader: a click on its border or scroll thumb doesn't fold", async () => {
    const desk = new Desk();
    app.push(desk);
    try {
      await app.act({ action: "open", args: { id: card.id }, as: "test-agent-410" });
      const reader = () => [...(desk as any).panes.entries()].find(([, p]: any) => p.kind === "reader") as [number, any];
      await until(() => reader()[1].msg?.id === card.id && !reader()[1].msg.partial, "the note in the desk reader");
      const lines = () => desk.render((desk as any).ctx).lines.map(plain);
      const r = () => (desk as any).placed.rects.get(reader()[0]);
      // Zoomed, its right border is the screen's edge (between panes it's a divider, which drags).
      (desk as any).focus = reader()[0];
      key({ kind: "char", ch: "w", ctrl: true } as Key); key(char("z"));
      await until(() => rowIn(lines(), r(), "## Beds") >= 0 && r().col + r().cols === (desk as any).ctx.t.cols, "the zoomed reader drawn");
      const y = rowIn(lines(), r(), "## Beds");
      click(r().col + r().cols - 1, y);
      expect(reader()[1].surface.describe().folds.folded).toEqual([]);
      click(r().col + 4, y);
      expect(reader()[1].surface.describe().folds.folded).toEqual(["## Beds"]);
    } finally { app.pop(); }
  });
});

describe("block anchors", () => {
  test("a trailing ^anchor is hidden when drawn, in every form the service writes, and folds keep their keys", () => {
    const env = { width: 60, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false };
    const body = "- [ ] buy canes ^t-8a6d7f\n- [x] clear the books ^books\n- [ ] sow peas ^task-c1a0d412-fa9f-461c-80c4-eb95ddf68a2a\n- [ ] 2 ^ 3 stays";
    const drawn = renderDoc(body, env).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    expect(drawn).not.toMatch(/\^t-8a6d7f|\^books|\^task-/);
    expect(drawn).toContain("buy canes");
    expect(drawn).toContain("2 ^ 3 stays");
    expect(foldPoints("- step ^t-8a6d7f\n  - child")[0]!.key).toBe(foldPoints("- step\n  - child")[0]!.key);
  });
});
