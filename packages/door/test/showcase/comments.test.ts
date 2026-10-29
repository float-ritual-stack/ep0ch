// PIE-439: the showcase screen, comments and drafts: composer, kept edits, deep links, undo. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { unsent } from "../../src/draft-session";
import { osc52 } from "../../src/surface/selection";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import type { Desk } from "../../src/desk/desk";
import { LABELS_BEFORE, MARGIN_LINES, SEED, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, SESSION_QUOTE, Showcase } from "../../src/showcase/showcase";
import { reopen } from "../../src/session/restore";
import { SocketBoard, USER } from "../../src/socket";
import { C } from "../../src/style";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("the showcase screen: comments and drafts: composer, kept edits, deep links, undo", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("drafts: the shed reader's kept-edit line, by act: [show them] opens the edit's own change against the note beside it, and [add them] puts it into an edit", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drafts" }, as: "test-agent" });
    await until(() => marks.drafts!.every(m => screen().includes(m)), "the drafts section");
    const stage = () => S().stages.get(S().sel).top;
    const name = "reader3";                                        // the third reader shows the shed
    // An agent reads the diff as data (nothing drawn); the person's [diff] opens a reader beside.
    expect(await app.act({ action: "unsent.diff", tile: name, args: {}, as: "test-agent" })).toMatchObject({ diff: expect.stringContaining("+ Oil the padlock before winter.") });
    const els = await app.act({ action: "elements", tile: name, args: {}, as: "test-agent" }) as any;
    const diff = (els.elements as any[]).find(e => e.control === "diff");
    expect(diff).toBeTruthy();
    await stage().dispatch.press("element.open", { n: diff.n }, name);
    const diffView = () => (stage().describe().panes as any[]).map(x => stage().pane(x.name)).find((p: any) => p?.msg?.id?.startsWith?.("unsent:"));
    await until(() => !!diffView(), "the diff beside the shed");
    expect(diffView().msg.text).toContain("+ Oil the padlock before winter.");
    expect(diffView().readOnly).toBe(true);
    // [add them]: the shed reader opens its edit with the unsent line in it, lit as a patch.
    await stage().dispatch.press("unsent.add", {}, name);
    await until(() => !!stage().pane(name).surface.draft, "the edit open");
    expect(stage().pane(name).surface.draft.text).toContain("Oil the padlock before winter.");
    await stage().dispatch.press("edit.close", { discard: true }, name);
    press({ kind: "esc" });
  }, 20_000);


  test("kept edits: the three cases by act: a new line is shown and added as one patch, an edit the note has settles itself, an old conflict folds to a chip and compares both versions", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "kept" }, as: "test-agent" });
    await until(() => marks.kept!.every(m => screen().includes(m)), `the kept section: ${marks.kept!.filter(m => !screen().includes(m)).join(" | ")}`);
    const stage = () => S().stages.get(S().sel).top;
    // Still new: the rota's edit adds a line the note lacks; the note's other change since isn't in the comparison.
    const rota = await app.act({ action: "unsent.diff", tile: "rota", args: {}, as: "test-agent" }) as any;
    expect(rota).toMatchObject({ basis: "three-way", verdict: "new", said: expect.stringContaining("1 line from your edit") });
    expect(rota.diff).toContain("+ Check the seed trays on Fridays.");
    expect(rota.diff).not.toContain("Wipe the shelves");
    await stage().dispatch.press("unsent.add", {}, "rota");
    await until(() => !!stage().pane("rota").surface.draft, "the rota's edit open");
    expect(stage().pane("rota").surface.draft.text).toContain("Shut the vents at dusk.\nCheck the seed trays on Fridays.\nWipe the shelves on Sundays.");
    await stage().dispatch.press("edit.close", { discard: true }, "rota");
    // Already in the note: settled when the reader opened; a copy is kept, and nothing is asked.
    const hedge = S().notes.hedge;
    expect(unsent(`edit:${hedge.id}`)).toBeNull();
    await expect(app.act({ action: "unsent.diff", tile: "hedge", args: {}, as: "test-agent" })).rejects.toThrow("nothing is kept here (edit)");
    // An old edit with a conflict: folded to a chip; [show] opens it, and the comparison shows both versions.
    await app.act({ action: "unsent.show", tile: "compost", args: {}, as: "test-agent" });
    const compost = await app.act({ action: "unsent.diff", tile: "compost", args: {}, as: "test-agent" }) as any;
    expect(compost).toMatchObject({ verdict: "conflict", hunks: [{ state: "conflict", removed: ["Turn the heap monthly."], added: ["Turn the heap weekly in summer."], now: ["Turn the heap every fortnight."] }] });
    expect(compost.diff).toContain("the note now: Turn the heap every fortnight.");
    press({ kind: "esc" });
  }, 20_000);


  // PIE-770, Evan's reading loop: select words, C, and the comment is written right there in the note (inline), the
  // text around it still drawn; the mouse deletes a phrase, (( puts in a reference and ^ refines it, ctrl+p previews it
  // drawn as the reader draws it, an embed too; ctrl+s and the thread sits where the box was. Then the same in another
  // place: floating, moved to split by ctrl+o and to a popup by a click on its chip.
  test("composer: select, C writes at the passage inline, a phrase deleted by mouse, a reference refined, the thread in place; then floating, split and popup by ctrl+o and a click", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "composer" }, as: "test-agent" });
    await until(() => marks.composer!.every(m => screen().includes(m)), "the composer section");
    const stage = () => S().stages.get(S().sel).top;
    const surf = (name: string) => stage().pane(name).surface;
    const cs = () => surf("inline").session;
    const d = () => cs()?.composer;
    const note = seeded.notes.margin.id, meeting = seeded.notes.meeting.id;
    const rows = () => sc.render(app).lines.map(plain);
    const type = (s: string) => { for (const c of s) ch(c); };
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    const drag = (y: number, from: number, to: number) => {
      press({ kind: "mouse", action: "down", button: 0, x: from, y });
      press({ kind: "mouse", action: "drag", button: 0, x: from + 1, y });
      press({ kind: "mouse", action: "drag", button: 0, x: to, y });
      press({ kind: "mouse", action: "up", button: 0, x: to, y });
    };
    // Where `text` is drawn in the left half of the stage (the inline and split readers), first from the top.
    const find = (text: string) => { const r = rows(); const y = r.findIndex(l => { const x = l.indexOf(text); return x >= 0 && x < 140; }); return { y, x: y >= 0 ? r[y]!.indexOf(text) : -1, r }; };
    const { completionOf } = await import("../../src/surface/completer");
    const pop = () => completionOf(d()!);
    const settled = async (what: string) => { await until(() => !!pop() && !pop()!.loading && pop()!.items.length > 0, what, 8000); return pop()!; };
    // Each reader is writing in its own place, the person's setting untouched.
    await until(() => (["inline", "floating", "split", "popup"] as const).every(p => surf(p).session?.place === p), "each reader writing in its place");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // The inline reader's goes (the person's own close), and the person reads, then selects words with the mouse and presses C.
    await stage().dispatch.press("comment.close", {}, "inline");
    await until(() => !cs() && find("two new sheets of felt").y > 0, "the inline reader reading");
    let at = find("two new sheets of felt");
    drag(at.y, at.x, at.x + "two new sheets".length - 1);
    await until(() => stage().describe().focusName === "inline", "the inline reader has the keys");
    ch("C");
    await until(() => cs()?.mode === "compose" && !!d(), "the comment open at the selected words");
    expect(cs()!.place).toBe("inline");
    expect(cs()!.target).toMatchObject({ kind: "quote", passage: { quote: "two new sheets" } });
    // The box is under its line, in the note: the line is still drawn above it, the next line below it.
    at = find("two new sheets of felt");
    let r = rows();
    const title = r.findIndex((l, i) => i > at.y && l.includes("» comment") && l.includes("[inline ▸]"));
    expect(title - at.y, r.join("\n")).toBeLessThanOrEqual(3);
    expect(r.findIndex((l, i) => i > title && l.includes("The rain barrel overflows"))).toBeGreaterThan(title);
    // An agent never takes the person's composer.
    await expect(app.act({ action: "comment.write", tile: "inline", args: { body: "an agent's words" }, as: "test-agent" })).rejects.toThrow();
    await expect(app.act({ action: "comment.place", tile: "inline", args: { place: "popup" }, as: "test-agent" })).rejects.toThrow();
    // Typed, a doubled word dragged across with the mouse and taken out.
    type("Felt is very very cheap at the depot, see ");
    at = find("Felt is very very");
    const from = at.x + "Felt is very ".length;
    drag(at.y, from, from + "very ".length);
    expect(d()!.selectedText()).toBe("very ");
    press({ kind: "backspace" });
    expect(d()!.text).toBe("Felt is very cheap at the depot, see ");
    press({ kind: "end" });
    // A reference from the (( popup, refined by ^ to the meeting's ^a10.
    type("((Gree");
    let p = await settled("the (( popup");
    const pick = p.items.findIndex(i => i.insertion === `((${meeting}))`);
    expect(pick, p.items.map(i => i.label).join("\n")).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < pick; i++) press({ kind: "down" });
    press({ kind: "enter" });
    await until(() => d()!.text.endsWith(`((${meeting}))`), "the meeting inserted", 8000);
    ch("^");
    p = await settled("the meeting's passages");
    expect(p.items[0]!.insertion).toBe(`((${meeting}^a10))`);
    press({ kind: "enter" });
    await until(() => d()!.text.endsWith(`((${meeting}^a10))`), "refined to ^a10", 8000);
    // And an embed of the meeting's decision, pasted.
    press({ kind: "paste", text: `\n!((${meeting}^decision))` });
    const body = `Felt is very cheap at the depot, see ((${meeting}^a10))\n!((${meeting}^decision))`;
    expect(d()!.text).toBe(body);
    // The preview draws the reference by its title and the embed's text, as the reader does.
    press({ kind: "char", ch: "p", ctrl: true });
    await until(() => rows().some(l => l.includes("Buy a second water butt")), "the preview with the embed", 8000);
    expect(rows().join("\n")).toContain("( preview )");
    // The preview follows the cursor's line: up on the first, the reference reads as its note's title.
    press({ kind: "up" }); press({ kind: "up" });
    await until(() => rows().some(l => l.includes("see Greenhouse meeting")), "the reference drawn by its title in the preview");
    press({ kind: "char", ch: "p", ctrl: true });
    // Saved: back to reading, the thread where the box was, its reference and embed drawn.
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !cs(), "the comment saved, the person reading", 8000);
    const mine = (await board.comments(note)).find(t => t.body === body);
    expect(mine?.quote).toBe("two new sheets");
    // Its thread open where the box was: waited for, not assumed by the time the session ended (it once raced under load).
    await until(() => surf("inline").expanded.has(mine!.id), "the new thread shown open", 8000);
    await until(() => { const a = find("two new sheets of felt"); return a.y > 0 && rows().slice(a.y + 1, a.y + 12).some(l => l.includes("Buy a second water butt")); }, "the thread under its passage, the embed drawn", 8000);
    at = find("two new sheets of felt");
    r = rows().slice(at.y + 1, at.y + 12);
    expect(r[0]).toContain("┌─ comment · ■ user");
    expect(r.join("\n")).toContain("Felt is very cheap at the depot, see Greenhouse meeting");
    expect(r.join("\n")).not.toContain(`((${meeting}`);
    // Again, in other places: floating by the setting, then split by ctrl+o, then a popup by a click on its chip.
    await app.dispatch.press("composer.place", { place: "floating" });
    at = find("felt before the frost");
    drag(at.y, at.x + "felt ".length, at.x + "felt before the frost".length - 1);
    ch("C");
    await until(() => cs()?.mode === "compose" && cs()?.place === "floating", "the comment open, floating");
    expect(cs()!.target).toMatchObject({ kind: "quote", passage: { quote: "before the frost" } });
    expect(rows().join("\n")).toContain("[floating ▸]");
    type("Frost is due on Friday night");
    press({ kind: "char", ch: "o", ctrl: true });
    await until(() => cs()?.place === "split" && rows().join("\n").includes("[split ▸]"), "moved to split");
    expect(d()!.text).toBe("Frost is due on Friday night");
    const chip = find("[split ▸]");
    click(chip.x + 2, chip.y);
    await until(() => screen().includes("Placement"), "the chip opens the placement menu");
    expect(cs()?.place).toBe("split");
    const popupChoice = find(" popup");
    click(popupChoice.x + 2, popupChoice.y);
    await until(() => cs()?.place === "popup" && rows().join("\n").includes("[popup ▸]"), "the menu chooses popup");
    // In the popup the mouse still selects: " night" dragged across and taken out.
    at = find("Frost is due on Friday night");
    expect(at.y).toBeGreaterThan(0);
    drag(at.y, at.x + "Frost is due on Friday".length, at.x + "Frost is due on Friday night".length);
    press({ kind: "backspace" });
    expect(d()!.text).toBe("Frost is due on Friday");
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !cs(), "the second comment saved", 8000);
    const second = (await board.comments(note)).find(t => t.body === "Frost is due on Friday");
    expect(second?.quote).toBe("before the frost");
    await until(() => { const a = find("two new sheets of felt"); return rows().slice(a.y + 1, a.y + 20).some(l => l.includes("Frost is due on Friday")); }, "the second thread in place too", 8000);
    // Back as it was: the setting, the section, and the two threads (they'd rank in other sections' searches).
    await app.dispatch.press("composer.place", { place: "inline" });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    for (const t of [mine!, second!]) await board.trash(t.id);
  }, 60_000);


  // PIE-785, the floating composer stays with you: dragged by its top edge and sized by its ◢ corner (and by ctrl+g's
  // keys), still there as it was after a click on another tile and back, and a link followed with it unsent asks; save
  // and continue keeps it unsent, and opened again it's in its usual place.
  test("composer stays with you: drag and size the floating box, click away and back, follow a link and save and continue, reopened in its usual place", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "composer" }, as: "test-agent" });
    await until(() => screen().includes("Writing in the margin"), "the composer section");
    const stage = () => S().stages.get(S().sel).top;
    const surf = () => stage().pane("floating").surface;
    const cs = () => surf().session;
    const note = seeded.notes.margin.id, shed = seeded.notes.shed.id;
    const rows = () => sc.render(app).lines.map(plain);
    const rect = () => (surf() as any).boxRect as { row: number; col: number; cols: number; rows: number };
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    const drag = (x: number, y: number, dx: number, dy: number) => {
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "drag", button: 0, x: x + Math.sign(dx), y });
      press({ kind: "mouse", action: "drag", button: 0, x: x + dx, y: y + dy });
      press({ kind: "mouse", action: "up", button: 0, x: x + dx, y: y + dy });
    };
    const find = (text: string) => { const r = rows(); const y = r.findIndex(l => l.includes(text)); return { y, x: y >= 0 ? r[y]!.indexOf(text) : -1 }; };
    await until(() => cs()?.place === "floating" && !!rect(), "the floating comment drawn");
    // The prior journey deletes comments; a held composer keeps its snapshot until it closes.
    await stage().dispatch.press("comment.close", { discard: true }, "floating");
    await stage().dispatch.press("open", { id: note }, "floating");
    const threadCount = (await board.comments(note)).length;
    await until(() => { rows(); return surf().comments?.length === threadCount; }, "the fresh comment gutter");
    await stage().dispatch.press("passage.select", { quote: MARGIN_LINES.floating }, "floating");
    await stage().dispatch.press("comment.write", { body: "" }, "floating");
    await stage().dispatch.press("comment.place", { place: "floating" }, "floating");
    rows();
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // In by a click in its text, then typed.
    const t = find("» comment");
    expect(t.y).toBeGreaterThan(0);
    click(t.x + 2, t.y + 2);
    await until(() => stage().describe().focusName === "floating", "the floating comment has the keys");
    for (const c of "Clear the gutter") ch(c);
    await until(() => rows().some(l => l.includes("Clear the gutter")), "typed");
    // Its top edge (≡ move) dragged up, its ◢ corner dragged: narrower and taller, then the edge again to the right. The
    // passage it's on never moves.
    const r0 = rect();
    let grip = find("≡ move");
    expect(grip.y, rows().join("\n")).toBeGreaterThan(0);
    drag(grip.x, grip.y, 0, -5);
    await until(() => cs()?.float?.row === r0.row - 5, `moved up (${JSON.stringify(cs()?.float)} from ${JSON.stringify(r0)})`);
    const edge = find("─◢");
    drag(edge.x + 1, edge.y, -20, 2);
    await until(() => cs()?.float?.cols === r0.cols - 20 && cs()!.float!.rows === r0.rows + 2, `sized (${JSON.stringify(cs()?.float)})`);
    grip = find("≡ move");
    drag(grip.x, grip.y, 10, 0);
    await until(() => cs()?.float?.col === r0.col + 10, `moved right (${JSON.stringify(cs()?.float)})`);
    expect(cs()!.float).toEqual({ row: r0.row - 5, col: r0.col + 10, cols: r0.cols - 20, rows: r0.rows + 2 });
    expect(cs()!.target).toMatchObject({ kind: "quote", passage: { quote: MARGIN_LINES.floating } });
    // By keys: ctrl+g, → moves it two columns, shift+↓ makes it a row taller, ⏎ is done; then the keys type again.
    press({ kind: "char", ch: "g", ctrl: true });
    press({ kind: "right" });
    press({ kind: "down", shift: true });
    await until(() => cs()!.float!.rows === r0.rows + 3 && cs()!.float!.col === r0.col + 12, `moved and sized by keys (${JSON.stringify(cs()?.float)})`);
    press({ kind: "enter" });
    ch("!");
    expect(cs()!.composer!.text).toBe("Clear the gutter!");
    // A click on another tile (the inline reader's, top left): that tile has the keys, the box stays as it was; a click
    // back and the keys type in it again.
    const left = rows().findIndex(l => { const x = l.indexOf(MARGIN_LINES.inline.slice(0, 20)); return x >= 0 && x < l.length / 2; });
    const other = { y: left, x: rows()[left]!.indexOf(MARGIN_LINES.inline.slice(0, 20)) };
    click(other.x + 1, other.y);
    await until(() => stage().describe().focusName !== "floating", "another tile has the keys");
    expect([cs()?.mode, cs()?.composer?.text, cs()?.float]).toEqual(["compose", "Clear the gutter!", { row: r0.row - 5, col: r0.col + 12, cols: r0.cols - 20, rows: r0.rows + 3 }]);
    expect(rows().some(l => l.includes("Clear the gutter!"))).toBe(true);
    const back = find("Clear the gutter!");
    click(back.x + "Clear the gutter!".length, back.y);
    await until(() => stage().describe().focusName === "floating", "back in the floating reader");
    ch("?");
    expect(cs()!.composer!.text).toBe("Clear the gutter!?");
    // An agent following the link never asks the person.
    await expect(app.act({ action: "link.follow", tile: "floating", args: { n: 1 }, as: "test-agent" })).rejects.toThrow();
    expect(surf().state()).toBe("writing · unsent");
    // The person's follow of [[Bike shed]] asks in the power bar; ⏎ on its first row, save and continue, keeps it
    // unsent and goes.
    await stage().dispatch.press("link.follow", { n: 1 }, "floating");
    const asking = () => (app as any).bar?.describe() as { scope: string; rows: { label: string }[] } | undefined;
    await until(() => asking()?.scope === "ask" && asking()!.rows.map(r => r.label.split(" (")[0]).join() === "save and continue,keep writing,discard", "asked in the power bar");
    press({ kind: "enter" });
    await until(() => stage().pane("floating").msg?.id === shed, "the reader on the shed");
    expect(cs()).toBeNull();
    expect(unsent(`comment:${note}`)?.text).toBe("Clear the gutter!?");
    expect((await board.comments(note)).some(c => c.body.startsWith("Clear the gutter"))).toBe(false);
    // Back, and the comment opened again (as the section opens it): the text is back, the box in its usual place.
    await stage().dispatch.press("back", {}, "floating");
    await until(() => stage().pane("floating").msg?.id === note, "back on the margin note");
    await stage().dispatch.press("passage.select", { quote: MARGIN_LINES.floating }, "floating");
    await stage().dispatch.press("comment.write", { body: "" }, "floating");
    await stage().dispatch.press("comment.place", { place: "floating" }, "floating");
    await until(() => cs()?.mode === "compose" && !!rect(), "opened again");
    expect(cs()!.float).toBeNull();
    sc.render(app);
    // Reopening fetches comments again; their gutter changes the room the floating box has.
    await until(() => { sc.render(app); return surf().comments?.length === threadCount; }, "the restored comment gutter");
    expect(rect(), JSON.stringify([rect(), r0, cs()!.composer!.text])).toMatchObject({ col: r0.col, cols: r0.cols });
    // As it was: the comment let go of (its put-aside text with it).
    await stage().dispatch.press("comment.close", { discard: true }, "floating");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);


  // PIE-846: "i can't easily scroll this comment, if my cursor is over this", "once i type again - it scrolls back to the
  // top", "when i hit preview - i cant scroll the preview either". The wheel over the box scrolls its text, over its
  // preview the preview, anywhere else the note; typing in a floating comment leaves the note where it was scrolled.
  test("composer scrolls: the wheel over a long comment scrolls it, over its preview the preview, elsewhere the note; typing leaves the note where it is", async () => {
    (app as any).lastInput = 0;
    // A stage drawn for the first time opens its own comments as it opens: let those land before this one's.
    const fresh = !S().stages.has(SECTIONS.findIndex(x => x.key === "composer"));
    await app.act({ action: "section", args: { name: "composer" }, as: "test-agent" });
    await until(() => screen().includes("Writing in the margin"), "the composer section");
    const stage = () => S().stages.get(S().sel).top;
    const pane = () => stage().pane("floating");
    const surf = () => pane().surface;
    const d = () => surf().session?.composer;
    const rect = () => (surf() as any).boxRect as { row: number; col: number; cols: number; rows: number };
    if (fresh) await until(() => { sc.render(app); return surf().session?.place === "floating" && !!rect(); }, "the stage's own floating comment");
    const long = Array.from({ length: 30 }, (_, i) => `- row ${i + 1} of the long comment`).join("\n");
    // On the note's first words, so the note can scroll its passage out of view above (whatever the stage's own comment is
    // by now: a test before this one may have closed it).
    await stage().dispatch.press("comment.close", { discard: true }, "floating");
    await stage().dispatch.press("passage.select", { quote: "A comment is written where you read it" }, "floating");
    await stage().dispatch.press("comment.write", { body: long }, "floating");
    await stage().dispatch.press("comment.place", { place: "floating" }, "floating");
    await until(() => { sc.render(app); return surf().session?.place === "floating" && !!rect(); }, "the floating comment drawn");
    const noteAt = () => (surf() as any).scroll as number;
    // Over the box's text: its text scrolls, the note doesn't.
    const r = rect(), inText = { x: r.col + 4, y: r.row + r.rows - 3 }, before = noteAt();
    pane().wheel(-1, stage(), inText); pane().wheel(-1, stage(), inText);
    expect(d()!.follow).toBe(false);
    expect(noteAt()).toBe(before);
    // Off the box: the note scrolls, here until the passage the comment is on is out of view above.
    for (let i = 0; i < 12; i++) { pane().wheel(1, stage(), { x: 0, y: 4 }); sc.render(app); }
    const passage = (surf() as any).composerRows as [number, number];
    expect(passage[0]).toBeLessThan((surf() as any).drawn.top);
    const scrolled = noteAt();
    expect(scrolled).not.toBe(before);
    // Typing in it: the comment's view follows the cursor again; the note stays where it was scrolled.
    pane().key({ kind: "char", ch: "!" }, stage());
    sc.render(app);
    expect(d()!.text.endsWith("!")).toBe(true);
    expect(noteAt()).toBe(scrolled);
    // Its preview scrolls under the wheel too, from where it follows the cursor, until the text changes.
    await stage().dispatch.press("draft.preview", { on: true }, "floating");
    sc.render(app);
    const p = d()!.frame!.preview!;
    expect(p.total).toBeGreaterThan(p.rows);
    const top = p.top;
    pane().wheel(-1, stage(), { x: r.col + 4, y: p.row + 2 });
    sc.render(app);
    expect(d()!.frame!.preview!.top).toBeLessThan(top);
    pane().key({ kind: "char", ch: "?" }, stage());
    sc.render(app);
    expect(d()!.previewScroll).toBeNull();
    await stage().dispatch.press("comment.close", { discard: true }, "floating");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);


  // PIE-846, Evan's comments while writing in the floating editor: a comment on the whole note (C with nothing selected,
  // the byline's [comment]), the comment in a tile of its own beside the reader so the whole note stays in view (docked
  // as any tile), and its thread at the top of the note.
  test("comment-tile: a whole-note comment in its own tile, typed into and sent; C with nothing selected starts another; its tile on each side of the note and sized, the thread list there too; closed, the layout as it was", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "comment-tile" }, as: "test-agent" });
    await until(() => marks["comment-tile"]!.every(m => screen().includes(m)), "the comment-tile section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    const surf = () => (stage() as any).pane("reader").surface;
    const tiles = () => (stage().describe().panes as any[]).map(t => t.kind);
    // The thread already there is on the whole note: drawn at the top of the note, before its first line.
    const rows = () => screen().split("\n");
    const at = (s: string) => rows().findIndex(l => l.includes(s));
    expect(at("Could we pin the opening hours")).toBeGreaterThan(-1);
    expect(at("Could we pin the opening hours")).toBeLessThan(at("The seed library opens"));
    // Its card names its picture, never its path.
    expect(surf().said((surf().comments as any[]).find(c => c.start === null)!.body)).toContain("▣ the notice on the gate");
    // In the stage, the keys are the comment tile's: what's typed lands in the reader's comment, and ctrl+s sends it.
    expect(tiles()).toContain("comment");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    for (const c of ", please") ch(c);
    await until(() => surf().session?.composer?.text === "The winter shelf needs a lock, please", "typed in the comment tile");
    expect(surf().session.target).toMatchObject({ kind: "note" });
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !tiles().includes("comment") && !surf().session, "sent, the tile closed");
    await until(() => (surf().comments as any[]).some(c => c.start === null && !c.quote && c.body === "The winter shelf needs a lock, please"), "its thread on the whole note");
    // C with nothing selected: another comment on the whole note, in the reader (the place new ones open).
    ch("C");
    await until(() => surf().session?.target?.kind === "note" && surf().session?.mode === "compose", "C opened a whole-note comment");
    // The request's validation (pie 16d46bc7): its tile beside the note on all four sides, sized, the tiles round them
    // never moving; closed, the layout exactly as it was; the text, cursor and the note's scroll kept throughout.
    const rects = () => { sc.render(app); return Object.fromEntries((stage().describe().panes as any[]).map(t => [t.kind === "comment" ? "comment" : t.name, t.rect])); };
    const was = rects(), d = () => surf().session.composer;
    for (const c of "Gate code?") ch(c);
    const cursor = [d().row, d().col], scroll = (surf() as any).scroll;
    await stage().dispatch.press("comment.place", { place: "tile" }, "reader");
    await until(() => tiles().includes("comment"), "the comment tile");
    for (const side of ["left", "up", "down", "right"] as const) {
      await stage().dispatch.press("comment.place", { side }, "reader");
      const r = rects(), rd = r.reader, cm = r.comment;
      // In the note's place: the two of them fill the room the note had; the tile on the side asked for.
      expect(r.links).toEqual(was.links);
      if (side === "left" || side === "right") expect([rd.cols + cm.cols, rd.row, cm.rows]).toEqual([was.reader.cols, was.reader.row, was.reader.rows]);
      else expect([rd.rows + cm.rows, rd.col, cm.cols]).toEqual([was.reader.rows, was.reader.col, was.reader.cols]);
      expect(side === "left" ? cm.col < rd.col : side === "right" ? cm.col > rd.col : side === "up" ? cm.row < rd.row : cm.row > rd.row).toBe(true);
    }
    // Sized by its border (as ^W > does), then moved: it keeps its size.
    const tile = (stage().describe().panes as any[]).find(t => t.kind === "comment")!.name;
    await stage().dispatch.press("tile.resize", { by: 3 }, tile);
    const wide = rects().comment.cols;
    await stage().dispatch.press("comment.place", { side: "left" }, "reader");
    expect(Math.abs(rects().comment.cols - wide)).toBeLessThanOrEqual(1);
    expect([d().text, [d().row, d().col], (surf() as any).scroll]).toEqual(["Gate code?", cursor, scroll]);
    await stage().dispatch.press("comment.place", { place: "inline" }, "reader");
    await until(() => !tiles().includes("comment"), "back in the reader, the tile closed");
    expect(rects()).toEqual(was);
    // Its tile closed by hand (×, ^W x): the comment isn't lost out of sight, it's back in the reader, split.
    for (const c of "Bring a padlock") ch(c);
    await stage().dispatch.press("comment.place", { place: "tile" }, "reader");
    await until(() => tiles().includes("comment"), "in its tile again");
    await stage().dispatch.press("tile.close", {}, (stage().describe().panes as any[]).find(t => t.kind === "comment")!.name);
    await until(() => { sc.render(app); return surf().session?.place === "split"; }, "back in the reader, split");
    expect(surf().session.composer.text).toBe("Gate code?Bring a padlock");
    await stage().dispatch.press("comment.close", { discard: true }, "reader");
    // Reading the comments there too: the thread list (m) in the tile beside the note, the note not covered; a reply
    // written there; esc, and the layout is as it was.
    ch("m");
    await until(() => surf().session?.mode === "threads", "the thread list");
    await stage().dispatch.press("comment.place", { place: "tile" }, "reader");
    await until(() => { sc.render(app); return tiles().includes("comment"); }, "the thread list in its tile");
    expect(screen()).toContain("comments · reader");
    expect(screen()).toContain("The seed library opens");
    ch("r");
    await until(() => surf().session?.mode === "compose" && surf().session?.place === "tile", "a reply, in the tile");
    press({ kind: "esc" });
    await until(() => surf().session?.mode === "threads", "back to the list");
    press({ kind: "esc" });
    await until(() => !surf().session && !tiles().includes("comment"), "closed");
    expect(rects()).toEqual(was);
    // An agent's own comment put in a tile: the tile opens, the person's keys stay where they were.
    const keysWere = (stage().describe() as any).focus;
    await app.act({ action: "passage.select", tile: "reader", args: { quote: "The seed library opens" }, as: "test-agent" });
    await app.act({ action: "comment.write", tile: "reader", args: { body: "Saturdays only?" }, as: "test-agent" });
    await app.act({ action: "comment.place", tile: "reader", args: { place: "tile" }, as: "test-agent" });
    await until(() => { sc.render(app); return tiles().includes("comment"); }, "the agent's comment in its tile");
    expect((stage().describe() as any).focus).toEqual(keysWere);
    await app.act({ action: "comment.close", tile: "reader", args: { discard: true }, as: "test-agent" });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);


  // PIE-847: a handover (a deploy, `ep0ch session restart`) brings a comment being written back as it sat. The session
  // section's half-written comment, moved and sized, its cursor moved; put aside as a handover puts it and the reader
  // reading again, as a new daemon has it; then opened again by the steps the checkpoint keeps, run as a restore runs them.
  test("session: a half-written floating comment, moved and sized, comes back after a handover as it sat: its words, place, size and cursor", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "session" }, as: "test-agent" });
    await until(() => marks.session!.every(m => screen().includes(m)), "the session section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    const surf = () => (stage() as any).pane("reader").surface;
    const cs = () => surf().session;
    await until(() => cs()?.place === "floating" && screen().includes("Fill it from the tap by the gate") && !!surf().boxRect, "the half-written comment, floating");
    await stage().dispatch.press("comment.move", { dx: 6, dy: 2, dcols: -10 }, "reader");
    await stage().dispatch.press("draft.place", { line: 1, col: 9 }, "reader");
    const now = () => ({ text: cs()?.composer?.text, place: cs()?.place, float: cs()?.float, cursor: cs()?.composer && [cs()!.composer!.row, cs()!.composer!.col], quote: cs()?.target?.passage?.quote });
    const was = now();
    expect(was).toMatchObject({ text: "Fill it from the tap by the gate", place: "floating", cursor: [0, 8], quote: SESSION_QUOTE });
    expect(was.float).toBeTruthy();
    const steps = stage().reopen();
    stage().keepDrafts();
    surf().closeSession();
    await until(() => !screen().includes("Fill it from the tap by the gate"), "the comment put aside");
    const out = { reopened: 0, errors: [] as string[] };
    await reopen(steps, () => stage().dispatch, out);
    expect(out.errors).toEqual([]);
    expect(now()).toEqual(was);
    await until(() => screen().includes("Fill it from the tap by the gate"), "the comment drawn again");
    await stage().dispatch.press("comment.close", { discard: true }, "reader");
  }, 60_000);


  // PIE-761, Evan's workflow by keys and mouse in the real comment box: write, select a phrase with the mouse and delete
  // it, insert a reference, break it, fix it, send; while it's open nothing moves the reader off its note. Then a comment
  // with the mistake left in: it's sent anyway, and the reference is said as a warning with a did-you-mean.
  test("drafts: a comment written by keys and mouse, a reference broken and fixed, held on its note while others navigate, sent; a broken one sends with a warning", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drafts" }, as: "test-agent" });
    await until(() => marks.drafts!.every(m => screen().includes(m)), "the drafts section");
    const stage = () => S().stages.get(S().sel).top;
    const reader = () => stage().pane("reader2");
    const cs = () => reader().surface.session;
    const d = () => cs()?.composer;
    const notebook = seeded.notes.notebook;
    await until(() => cs()?.mode === "compose" && !!d(), "the comment open");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // A click in the comment's text gives the middle reader the keys and puts the cursor there.
    const textRow = () => { const rows = sc.render(app).lines.map(plain); const y = rows.findIndex(l => l.includes("» comment")); const x = rows[y]!.indexOf("comment"); return { rows, y, x }; };
    let at = textRow();
    expect(at.y).toBeGreaterThan(0);
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    const firstText = at.rows.findIndex((l, i) => i > at.y && /─{5,}/.test(l.slice(at.x))) + 1;
    click(at.x + 2, firstText);
    await until(() => stage().describe().focusName === "reader2", `the comment has the keys (focus ${stage().describe().focusName})`);
    for (const c of "Beans look very very good ") ch(c);
    expect(d()!.text).toBe("Beans look very very good ");
    // A drag across the doubled "very " and backspace takes it out.
    at = textRow();
    const y = at.rows.findIndex((l, i) => i > at.y && l.includes("Beans look very very")), line = at.rows[y] ?? "";
    expect(y, at.rows.join("\n")).toBeGreaterThan(at.y);
    const from = line.indexOf("very very") + "very ".length, to = from + "very ".length;
    press({ kind: "mouse", action: "down", button: 0, x: from, y });
    press({ kind: "mouse", action: "drag", button: 0, x: from + 2, y });
    press({ kind: "mouse", action: "drag", button: 0, x: to, y });
    press({ kind: "mouse", action: "up", button: 0, x: to, y });
    expect(d()!.selectedText()).toBe("very ");
    press({ kind: "backspace" });
    expect(d()!.text).toBe("Beans look very good ");
    // A reference from the (( popup, then broken (its )) taken out) and fixed again by typing.
    press({ kind: "end" });
    for (const c of "see ((alotment notebok") ch(c);
    const { completionOf } = await import("../../src/surface/completer");
    await until(() => { const p = completionOf(d()!); return !!p && !p.loading && p.items.length > 0; }, "the (( popup", 8000);
    press({ kind: "enter" });
    const ref = `((${notebook.id}))`;
    await until(() => d()!.text.includes(ref), "the reference inserted", 8000);
    press({ kind: "end" });
    press({ kind: "backspace" }); press({ kind: "backspace" });
    expect(d()!.text).toBe(`Beans look very good see ((${notebook.id}`);
    for (const c of "))") ch(c);
    await until(() => !completionOf(d()!)?.items.length, "no popup over the fixed reference");
    expect(d()!.text).toBe(`Beans look very good see ${ref}`);
    // While it's open: another tile changes the current note, and an agent opens a note. The comment stays put.
    const shed = seeded.notes.shed;
    stage().setCurrent(shed, { from: stage().pane("reader3"), reveal: true });
    await app.act({ action: "open", args: { id: seeded.notes.whiteboard.id }, as: "test-agent" }).catch(() => null);
    expect([reader().msg?.id, cs()?.mode, d()?.text, stage().describe().focusName]).toEqual([notebook.id, "compose", `Beans look very good see ${ref}`, "reader2"]);
    // Typed keys still land in the comment.
    ch(" ");
    expect(d()!.text).toBe(`Beans look very good see ${ref} `);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => cs()?.mode === "threads" && !cs()?.busy, "the comment sent", 8000);
    const bodies = async () => (await board.comments(notebook.id)).map(t => t.body);
    expect(await bodies()).toContain(`Beans look very good see ${ref}`);
    expect(cs()!.note).toBe("");
    // Another, with the mistake left in: an unclosed (( and a title for an id. It's sent as written, and warned about.
    await stage().dispatch.press("passage.select", {}, "reader2");
    await stage().dispatch.press("comment.write", { body: "" }, "reader2");
    await until(() => cs()?.mode === "compose" && !!d(), "a second comment open");
    const broken = `and ((${notebook.id} needs closing, ((alotment notebok too`;
    for (const c of broken) ch(c);
    expect(d()!.text).toBe(broken);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => cs()?.mode === "threads" && !!cs()?.note, "the broken comment sent, with its warning", 8000);
    expect(await bodies()).toContain(broken);
    expect(cs()!.note).toContain("saved; 2 references lead nowhere");
    expect(cs()!.note).toContain(`did you mean ${ref}`);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // The two threads go to the Trash: they'd rank in the other sections' searches for the notebook.
    for (const t of await board.comments(notebook.id)) if ([`Beans look very good see ${ref}`, broken].includes(t.body)) await board.trash(t.id);
  }, 40_000);


  test("deep links (PIE-762): a comment by keys and mouse; ((Gree lists the meeting with its anchors, ^ refines a reference to one, a passage with none gets one, a click back in a ((id)) and # refines it, a mistake sends with a warning; an agent the same through act", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "deep-links" }, as: "test-agent" });
    await until(() => marks["deep-links"]!.every(m => screen().includes(m)), "the deep links section");
    const stage = () => S().stages.get(S().sel).top;
    const cs = () => stage().pane("guide").surface.session;
    const d = () => cs()?.composer;
    const meeting = seeded.notes.meeting.id, guide = seeded.notes.deepLinks.id;
    const { completionOf } = await import("../../src/surface/completer");
    const pop = () => completionOf(d()!);
    const settled = async (what: string) => { await until(() => !!pop() && !pop()!.loading && pop()!.items.length > 0, what, 8000); return pop()!; };
    const type = (s: string) => { for (const c of s) ch(c); };
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    const rows = () => sc.render(app).lines.map(plain);
    await until(() => cs()?.mode === "compose" && !!d(), "the comment open");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // A click in the comment's text gives the guide's tile the keys.
    let r = rows(), y = r.findIndex(l => l.includes("» comment")), x = r[y]!.indexOf("comment");
    click(x + 2, r.findIndex((l, i) => i > y && /─{5,}/.test(l.slice(x))) + 1);
    await until(() => stage().describe().focusName === "guide", "the comment has the keys");
    // Typed, then a doubled word dragged across with the mouse and taken out.
    type("The meeting was very very clear: ");
    r = rows(); y = r.findIndex(l => l.includes("The meeting was very very"));
    const from = r[y]!.indexOf("very very") + "very ".length, to = from + "very ".length;
    press({ kind: "mouse", action: "down", button: 0, x: from, y });
    press({ kind: "mouse", action: "drag", button: 0, x: to, y });
    press({ kind: "mouse", action: "up", button: 0, x: to, y });
    expect(d()!.selectedText()).toBe("very ");
    press({ kind: "backspace" });
    expect(d()!.text).toBe("The meeting was very clear: ");
    press({ kind: "end" });
    // ((Gree: the meeting, its anchors right under it, each at the front of its row. Choose the meeting.
    const pickMeeting = async () => {
      type("((Gree");
      const p = await settled("the (( popup");
      const at = p.items.findIndex(i => i.insertion === `((${meeting}))`);
      expect(at, p.items.map(i => i.label).join("\n")).toBeGreaterThanOrEqual(0);
      expect(p.items.slice(at + 1, at + 3).map(i => i.label)).toEqual(["  ^a10  We agreed to water the seedlings every morning, before the glass warms.", "  ^decision  # Decision"]);
      for (let i = 0; i < at; i++) press({ kind: "down" });
      press({ kind: "enter" });
      await until(() => d()!.text.endsWith(`((${meeting}))`), "the meeting inserted", 8000);
    };
    await pickMeeting();
    // ^ straight after its )): the meeting's anchors first, then its passages. ⏎ takes ^a10.
    ch("^");
    expect(d()!.text).toEndWith(`((${meeting}^))`);
    let p = await settled("the meeting's passages");
    expect(p.heading).toBe(`in ${SEED.meeting}`);
    expect(p.items.slice(0, 3).map(i => i.insertion)).toEqual([`((${meeting}^a10))`, `((${meeting}^decision))`, `((${meeting}^present-ana-bo))`]);
    expect(p.items[2]!.label).toBe("Present: Ana, Bo and Cy, in the greenhouse at ten. · adds ^present-ana-bo");
    const drawn = rows().join("\n");
    expect(drawn).toContain(`in ${SEED.meeting} 1/`);
    const popupRows = () => { const all = rows(); const start = all.findIndex(l => l.includes(`in ${SEED.meeting} 1/`)); return all.slice(start + 1, start + 13); };
    const previewLine = (line: string) => {
      const rect = pop()?.previewRect;
      const col = S().stageRect.col + (rect?.col ?? 0);
      return rect ? line.slice(col, col + rect.cols) : "";
    };
    const preview = () => popupRows().map(previewLine);
    await until(() => preview().some(l => l.includes("We agreed to water")), "the anchor's passage in the floating reader");
    r = rows(); y = r.findIndex((l, i) => i > r.findIndex(l => l.includes(`in ${SEED.meeting} 1/`)) && previewLine(l).includes("We agreed to water"));
    x = r[y]!.lastIndexOf("We agreed to water");
    press({ kind: "mouse", action: "wheel-down", button: 0, x, y });
    expect(pop()!.index).toBe(0);
    expect(preview().join("\n")).not.toContain("We agreed to water");
    press({ kind: "pgup" });
    await until(() => preview().some(l => l.includes("We agreed to water")), "keys scroll the same preview");
    press({ kind: "enter" });
    await until(() => d()!.text.endsWith(`((${meeting}^a10))`), "refined to ^a10", 8000);
    // Another, refined to a line with no anchor: the meeting gains it, as the person's, and the reference points at it.
    type(" and ");
    await pickMeeting();
    type("^vent");
    p = await settled("the vent line");
    await until(() => !!pop()?.target.query.endsWith("vent") && !pop()!.loading, "narrowed to vent", 8000);
    expect(pop()!.items.map(i => i.label)).toEqual(["- Ana mends the vent hinge · adds ^ana-mends-the"]);
    press({ kind: "enter" });
    await until(() => d()!.text.endsWith(`((${meeting}^ana-mends-the))`), "refined to the new anchor", 8000);
    expect((await board.get(meeting))!.text).toContain("- Ana mends the vent hinge ^ana-mends-the");
    const history = await board.request("block.revisions", { blockId: meeting }) as { revisions: { author?: string }[] };
    expect(history.revisions[0]!.author).toBe("user");
    // A third on a line of its own, left whole; then a click back inside it and # refines it to a heading's anchor.
    press({ kind: "enter" });
    type("Read ");
    await pickMeeting();
    r = rows(); y = r.findIndex(l => l.includes(`Read ((${meeting.slice(0, 8)}`));
    expect(y, r.join("\n")).toBeGreaterThan(0);
    click(r[y]!.indexOf(`((${meeting.slice(0, 8)}`) + 8, y);
    expect(d()!.row).toBe(1);
    expect(d()!.col).toBe("Read ((".length + 6);
    ch("#");
    expect(d()!.lines[1]).toBe(`Read ((${meeting}#))`);
    p = await settled("the meeting's headings");
    expect(p.items.map(i => i.insertion)).toContain(`((${meeting}^decision))`);
    for (let i = 0; i < p.items.findIndex(i => i.insertion === `((${meeting}^decision))`); i++) press({ kind: "down" });
    press({ kind: "enter" });
    await until(() => d()!.lines[1] === `Read ((${meeting}^decision))`, "refined by the click and #", 8000);
    // A mistake: an unclosed (( left in. Sent as written, with a warning.
    press({ kind: "end" });
    type(" and ((Greenhouse meeting");
    await settled("the popup over the mistake");
    press({ kind: "esc" });
    expect(pop()).toBeNull();
    const body = `The meeting was very clear: ((${meeting}^a10)) and ((${meeting}^ana-mends-the))\nRead ((${meeting}^decision)) and ((Greenhouse meeting`;
    expect(d()!.text).toBe(body);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => cs()?.mode === "threads" && !!cs()?.note, "sent, with its warning", 8000);
    expect(cs()!.note).toContain("saved; a reference leads nowhere");
    const bodies = async () => (await board.comments(guide)).map(t => t.body);
    expect(await bodies()).toContain(body);
    // The person goes back to the index. An agent, through act, in a comment of its own: complete refine=^ opens the
    // reference, insert=n takes the anchor.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    (app as any).lastInput = 0;
    const as = "test-agent", tile = "guide";
    await app.act({ action: "passage.select", tile, args: {}, as });
    await app.act({ action: "comment.write", tile, args: { body: `Agreed, see ((${meeting}))` }, as });
    await app.act({ action: "draft.place", tile, args: { line: 1 }, as });
    const listed = await app.act({ action: "complete", tile, args: { refine: "^" }, as }) as any;
    expect(listed.items[0]).toMatchObject({ n: 1, insertion: `((${meeting}^a10))` });
    await app.act({ action: "complete", tile, args: { insert: 1, expect: `((${meeting}^a10))` }, as });
    expect(d()!.text).toBe(`Agreed, see ((${meeting}^a10))`);
    // Not in a reference: refused with where the cursor is and what to do.
    await app.act({ action: "draft.place", tile, args: { line: 1, col: 3 }, as });
    await expect(app.act({ action: "complete", tile, args: { refine: "^" }, as })).rejects.toThrow("isn't in a finished ((reference))");
    await app.act({ action: "comment.send", tile, args: {}, as });
    for (const end = Date.now() + 8000; !(await bodies()).includes(`Agreed, see ((${meeting}^a10))`);) { if (Date.now() > end) throw new Error("the agent's comment wasn't sent"); await Bun.sleep(50); }
    expect(S().focus).toBe("index");
    // The threads go to the Trash: they'd rank in the other sections' searches for the meeting.
    for (const t of await board.comments(guide)) await board.trash(t.id);
  }, 60_000);


  test("deep links (PIE-592): !((Gree lists the meeting's callout, quote and headings with no anchor yet; the callout's embed carries every line of it", async () => {
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
    await app.act({ action: "section", args: { name: "deep-links" }, as: "test-agent" });
    await until(() => screen().includes("Greenhouse meeting, October"), "the deep links section");
    const r = await app.act({ action: "complete", args: { text: "!((Greenhouse meeting" }, tile: "guide", as: "test-agent" }) as any;
    const labels: string[] = (r.candidates ?? r.items ?? []).map((c: any) => (c.label ?? c).toString().trim());
    expect(labels, labels.join("\n")).toContain("[!] What Cy said · adds ^what-cy-said");
    const meeting = seeded.notes.meeting.id;
    // The callout embedded whole, once it has its anchor.
    const text = (await board.get(meeting))!.text;
    const at = text.split("\n").findIndex(l => l.startsWith("> They mind the draught"));
    await board.ensureFragment(meeting, at, (await board.get(meeting))!.revision!, { kind: "agent", id: "test-agent" });
    expect(JSON.stringify(await board.readTransclusions([{ blockId: meeting, fragmentId: "what-cy-said" }]))).toContain("> [!quote] What Cy said\\n> The seedlings don't mind the cold.\\n> They mind the draught from the door.");
  });


  test("undo (PIE-621): a big paste is one step, ctrl+z and ctrl+y by keys; copy by a drag's release and by shift+arrows then alt+c; an agent's undo and redo through act, its own only", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "undo" }, as: "test-agent" });
    await until(() => marks.undo!.every(m => screen().includes(m)), `the undo section: ${marks.undo!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
    const stage = () => S().stages.get(S().sel).top;
    const draft = () => stage().pane("reader").surface.draft;
    expect(draft().text).toContain("# Pantry inventory");
    // An agent can't take back the person's paste: its undo is its own.
    await expect(app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).rejects.toThrow("this agent has no edit to undo");
    // The person, by keys: into the stage, and so into their edit kept open there (PIE-812: no ⏎ or e to enter it),
    // ctrl+z takes the whole paste back, ctrl+y puts it back, ctrl+z again.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft().text.includes("Pantry"), "the paste undone in one step");
    expect(draft().note).toContain("undid the paste (42 lines)");
    press({ kind: "char", ch: "y", ctrl: true });
    await until(() => draft().text.includes("Pantry"), "the paste redone");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft().text.includes("Pantry"), "undone again");
    expect(draft().dirty).toBe(false);
    // By mouse: a drag across [page::…] on the first line, and its release copies it (OSC 52).
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    const rows = sc.render(app).lines.map(plain);
    const y = rows.findIndex(l => l.includes("Jar labels [page::Jar labels]"));
    expect(y).toBeGreaterThan(0);
    const x0 = rows[y]!.indexOf("[page::"), x1 = x0 + "[page::Jar labels]".length;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x0 + 4, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x1, y });
    press({ kind: "mouse", action: "up", button: 0, x: x1, y });
    await until(() => copies().length > 0, "the drag's selection copied on release");
    expect(copies()).toEqual([osc52("[page::Jar labels]")]);
    expect(draft().text).not.toContain("Pantry");                    // copying never types
    // By keys: home, shift+→ over the title, then alt+c (cmd+c where the terminal sends it).
    press({ kind: "home" });
    for (let i = 0; i < "Jar".length; i++) press({ kind: "right", shift: true });
    expect(draft().selectedText()).toBe("Jar");
    press({ kind: "alt", ch: "c" });
    await until(() => copies().length > 1, "alt+c copied the selection");
    expect(copies().at(-1)).toBe(osc52("Jar"));
    expect(screen()).toContain("[copy]");
    // A double click's word, copied once it's selected.
    const rows2 = sc.render(app).lines.map(plain), y2 = rows2.findIndex(l => l.includes("Rota: whoever fills")), x2 = rows2[y2]!.indexOf("whoever") + 2;
    for (let i = 0; i < 2; i++) { press({ kind: "mouse", action: "down", button: 0, x: x2, y: y2 }); press({ kind: "mouse", action: "up", button: 0, x: x2, y: y2 }); }
    await until(() => copies().length > 2, "the double click's word copied");
    expect(copies().at(-1)).toBe(osc52("whoever"));
    await stage().dispatch.press("edit.close", { discard: true }, "reader");
    await until(() => !draft(), "the person's edit closed");
    // An agent in an edit of its own, through act: its paste, its undo, its redo.
    await app.act({ action: "edit", tile: "reader", as: "test-agent" });
    await until(() => !!draft(), "the agent's edit open");
    await app.act({ action: "draft.place", tile: "reader", args: { line: 1 }, as: "test-agent" });
    expect(await app.act({ action: "draft.paste", tile: "reader", args: { text: " (wiped Sunday)" }, as: "test-agent" })).toMatchObject({ line: 1 });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    expect(await app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).toMatchObject({ left: 0, redo: 1 });
    expect(draft().text.split("\n")[0]).not.toContain("wiped");
    expect(await app.act({ action: "draft.redo", tile: "reader", as: "test-agent" })).toMatchObject({ redone: "redid the paste" });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    // The note's earlier revision (the seed saved it twice), into its own edit as one step, and taken back.
    expect(await app.act({ action: "revision.restore", tile: "reader", as: "test-agent" })).toMatchObject({ revision: 1, current: 2 });
    expect(draft().text).toBe(LABELS_BEFORE);
    expect(screen()).toContain("by cowboy · for evan · via yolo");
    await app.act({ action: "draft.undo", tile: "reader", as: "test-agent" });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    await app.act({ action: "edit.close", tile: "reader", args: { discard: true }, as: "test-agent" });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("undo never takes back what's saved (PIE-1414): write, save, open it again, ctrl+z stops at the save and says so; ctrl+z again goes past it, and the note keeps what was saved", async () => {
    await app.act({ action: "section", args: { name: "undo" }, as: "test-agent" });
    const stage = () => S().stages.get(S().sel).top;
    const draft = () => stage().pane("reader").surface.draft;
    await until(() => !!stage()?.pane("reader")?.surface.msg, "the undo section's note", 8000);
    const id = stage().pane("reader").surface.msg!.id;
    if (draft()) await stage().dispatch.press("edit.close", { discard: true }, "reader");
    await until(() => !draft(), "no edit open");
    const edit = async () => { await stage().dispatch.act({ action: "edit", tile: "reader" }, USER); await until(() => !!draft(), "the person's edit open"); };
    await edit();
    press({ kind: "enter" });
    if (S().focus !== "stage") press({ kind: "enter" });
    await stage().dispatch.act({ action: "draft.place", tile: "reader", args: { line: 999 } }, USER);
    for (const c of "\nLids go on warm.") press(c === "\n" ? { kind: "enter" } : { kind: "char", ch: c });
    await until(() => draft()?.text.endsWith("Lids go on warm."), "typed by keys");
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !draft(), "saved");
    const saved = (await board.get(id))!.text;
    expect(saved).toEndWith("Lids go on warm.");
    // Opened again: ctrl+z says the text is saved and leaves it.
    await edit();
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => draft()!.note.includes("that's saved text"), "ctrl+z asks at the save");
    expect(draft()!.text).toBe(saved);
    expect(draft()!.dirty).toBe(false);
    expect(screen()).toContain("that's saved text");
    // Through act the same: it asks, and past=true is the answer.
    expect(await stage().dispatch.act({ action: "draft.undo", tile: "reader" }, USER)).toMatchObject({ asks: expect.stringContaining("saved") });
    await expect(app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).rejects.toThrow("already saved");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft()!.text.endsWith("Lids go on warm."), "ctrl+z again goes past the save");
    expect(draft()!.dirty).toBe(true);
    expect((await board.get(id))!.text).toBe(saved);                  // nothing saved changed
    await stage().dispatch.press("edit.close", { discard: true }, "reader");
    await until(() => !draft(), "closed, the saved text as it was");
    expect((await board.get(id))!.text).toBe(saved);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);
});
