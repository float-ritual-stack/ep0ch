// A posted comment's edit against a real host (PIE-1560): a reload that can't reach the outline says so and keeps the
// conflict, whatever comments the door already holds; a short box still names the copy and the key that reloads.
// A scratch service, never a real outline; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SocketBoard, USER } from "../src/socket";
import { visible } from "../src/style";
import { composerBox } from "../src/surface/composer";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("a posted comment's edit against a real host", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard;
  const host = (): SurfaceHost => ({ ctx: { board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    other = new SocketBoard(scratch.sock);
    await other.info();
  });
  afterAll(async () => { board?.close(); other?.close(); await scratch.dispose(); });

  /** A note with one posted comment, in its edit with a word typed; the comment then changed elsewhere and ctrl+s refused. */
  async function refused(title: string, rows = 8) {
    const id = (await board.request("create", { parentId: null, text: `${title}\nThe plot by the shed.`, author: "user" })).id as string;
    const m = (await board.get(id))!;
    const posted = await board.comment(`req-${id}`, id, m.revision!, "How deep is the bed?", null);
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    await s.loadComments(h);
    s.key(char("m"), h);
    await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
    s.key(char("e"), h);
    await until(() => !!s.session?.composer, "the comment's edit");
    const d = s.session!.composer!;
    for (const c of " now") s.key(char(c), h);
    const now = (await other.comments(id))[0]!;
    await other.updateComment(posted.id, now.revision!, "How deep should the bed be?");
    // Drawn as it's typed, in a small tile: what ctrl+s says comes after this, and must not push the text out of view.
    s.render(28, rows, h);
    s.key(ctrl("s"), h);
    s.render(28, rows, h);                  // the frame the key paints, before the answer
    await until(() => d.status.conflict !== null, "the stale refusal");
    return { s, h, d };
  }

  test("a short box keeps the typed text, the copy's file name and the reload key", async () => {
    const { s, h, d } = await refused("Short box");
    const file = d.status.savedCopy!.split("/").at(-1)!;
    const shown = s.render(28, 8, h).lines.map(visible);
    const flat = shown.join("").replace(/[\s│]+/g, "");
    expect(flat).toContain("now");
    expect(flat).toContain("notsaved");
    // One row is what's left for the copy and its key: the name's two ends, which tell one copy from another.
    expect(flat).toContain(file.slice(0, 8));
    expect(flat).toContain(file.slice(-6));
    expect(flat).toContain("^R");
    // Reloaded, it says the revision and names the copy, in the same box.
    await s.act("comment.reload", {}, h, USER);
    const after = s.render(28, 8, h).lines.map(visible).join("").replace(/[\s│]+/g, "");
    expect(d.text).toBe("How deep should the bed be?");
    expect(after).toMatch(/revision\d/);
    const copy = d.status.savedCopy!.split("/").at(-1)!;
    expect(after).toContain(copy.slice(0, 8));
    expect(after).toContain(copy.slice(-6));
  }, 30_000);

  test("in the zoomed 30×12 reader the refusal's why and its key stay beside the typed row", async () => {
    const { s, h, d } = await refused("Zoomed");
    const shown = s.render(28, 7, h).lines.map(visible).join("").replace(/[\s│]+/g, "");
    expect(shown).toContain("now");
    expect(shown).toContain("!notsaved");
    expect(shown).toContain("^R");
    // The copy's name, on the row that's left: its two ends.
    const file = d.status.savedCopy!.split("/").at(-1)!;
    expect(shown).toContain(file.slice(0, 8));
    expect(shown).toContain(file.slice(-6));
  }, 30_000);

  test("wheeled away from an inline comment edit, a resize leaves the note where it was scrolled", async () => {
    const body = Array.from({ length: 120 }, (_, i) => `row ${i + 1} of the long plan`).join("\n");
    const id = (await board.request("create", { parentId: null, text: `Long plan\n${body}`, author: "user" })).id as string;
    const m = (await board.get(id))!;
    await board.comment(`req-${id}`, id, m.revision!, "Which rows first?", null);
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    await s.loadComments(h);
    s.key(char("m"), h);
    await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
    s.key(char("e"), h);
    await until(() => !!s.session?.composer, "the comment's edit");
    s.key(char("!"), h);
    s.render(80, 24, h);
    // The wheel, away from the box; then the tile shrinks, and the box with it. No key was pressed.
    (s as any).scroll = 60;
    s.render(80, 24, h);
    const at = (s as any).scroll;
    s.render(80, 8, h);
    expect((s as any).scroll).toBeGreaterThan(at - 3);
  }, 30_000);

  test("a draft write while a reload's read is out is refused with what to do, and nothing is lost", async () => {
    const { s, h, d } = await refused("Late paste");
    const comments = board.comments.bind(board);
    let release = () => {};
    const gate = new Promise<void>(r => { release = r; });
    board.comments = (async (...a: Parameters<typeof comments>) => { await gate; return comments(...a); }) as typeof board.comments;
    const reload = s.act("comment.reload", {}, h, USER);
    await until(() => !!s.session?.busy, "the reload's read");
    await expect(s.act("draft.paste", { text: "?" }, h, USER)).rejects.toThrow("try again");
    board.comments = comments as typeof board.comments;
    release();
    await reload;
    expect(d.text).toBe("How deep should the bed be?");
  }, 30_000);

  test("at the zoomed size, what ctrl+s says never pushes the typed row out of view", async () => {
    for (const rows of [7, 8, 9, 10]) {
      const { s, h } = await refused(`Zoomed save ${rows}`, rows);
      const lines = s.render(28, rows, h).lines.map(visible);
      expect({ rows, saved: lines.join("\n").includes("! not saved") || lines.join("\n").includes("not saved:") }).toEqual({ rows, saved: true });
      expect({ rows, typed: lines.join("").replace(/[\s│]+/g, "").includes("now") }).toEqual({ rows, typed: true });
    }
  }, 30_000);

  test("keys and a paste during a held reload land, in order, on the words it loaded", async () => {
    const { s, h, d } = await refused("Held reload");
    process.kill(scratch.pid!, "SIGSTOP");
    try {
      s.key(ctrl("r"), h);
      await until(() => d.status.phase === "reloading", "the reload's read");
      for (const c of "ab") s.key(char(c), h);
      s.key({ kind: "paste", text: "pasted" }, h);
      s.key(char("c"), h);
      expect(d.text).toBe("How deep is the bed? now");
    } finally { process.kill(scratch.pid!, "SIGCONT"); }
    await until(() => d.status.phase === null && d.text.includes("should"), "the loaded words", 10_000);
    expect(d.text).toBe("How deep should the bed be?abpastedc");
  }, 30_000);

  test("a note's edit holds keys through its reload the same way", async () => {
    const id = (await board.request("create", { parentId: null, text: "Seed list\nbeans", author: "user" })).id as string;
    const m = (await board.get(id))!;
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    s.startDraft(m, h);
    const d = s.draft!;
    s.key(char("!"), h);
    await other.update(id, "Seed list\npeas", m.revision!, USER);
    d.status.changedElsewhere = true;
    process.kill(scratch.pid!, "SIGSTOP");
    try {
      s.key(ctrl("r"), h);
      await until(() => d.status.phase === "reloading", "the reload's read");
      s.key(char("x"), h);
      s.key({ kind: "paste", text: "yz" }, h);
    } finally { process.kill(scratch.pid!, "SIGCONT"); }
    await until(() => d.status.phase === null && d.text.includes("peas"), "the current text", 10_000);
    expect(d.text).toBe("Seed list\npeasxyz");
  }, 30_000);

  /** Runs `during` with the scratch host paused, the reload's read held, then lets the read answer. */
  async function heldReload(d: { status: { phase: string | null } }, press: () => void, during: () => void, loaded: () => boolean) {
    process.kill(scratch.pid!, "SIGSTOP");
    try {
      press();
      await until(() => d.status.phase === "reloading", "the reload's read");
      during();
    } finally { process.kill(scratch.pid!, "SIGCONT"); }
    await until(() => d.status.phase === null && loaded(), "the reload's answer", 10_000);
  }

  test("a hold replays only what was written: ctrl+s and esc don't run, the text after them lands, and the line says so", async () => {
    const { s, h, d } = await refused("Commands held");
    const id = s.msg!.id;
    await heldReload(d, () => s.key(ctrl("r"), h), () => {
      s.key(char("a"), h);
      s.key(ctrl("s"), h);
      expect(d.note).toContain("press ctrl+s again");
      s.key(char("b"), h);
      s.key({ kind: "esc" }, h);
      s.key(char("c"), h);
    }, () => d.text.includes("should"));
    await Bun.sleep(100);
    // Nothing was saved or closed: the words on the host are the loaded ones, the draft is open with all three.
    expect(s.session?.composer).toBe(d);
    expect(d.text).toBe("How deep should the bed be?abc");
    expect((await board.comments(id))[0]!.body).toBe("How deep should the bed be?");
    expect(d.note).toContain("press");
    expect(d.note).toContain("ctrl+s");
  }, 30_000);

  test("in rich cells, what's typed during a held reload lands in the cell", async () => {
    const id = (await board.request("create", { parentId: null, text: "Crops\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |", author: "user" })).id as string;
    const m = (await board.get(id))!;
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    s.startDraft(m, h);
    const d = s.draft!;
    d.place(d.lines.length - 1, 3);
    await s.act("rich.toggle", { on: true }, h, USER);
    await other.update(id, `Crops [season::spring]\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |`, m.revision!, USER);
    d.status.changedElsewhere = true;
    await heldReload(d, () => s.key(ctrl("r"), h), () => {
      for (const c of "ab") s.key(char(c), h);
      s.key({ kind: "paste", text: "cd" }, h);
    }, () => d.text.includes("season"));
    await until(() => d.text.includes("abcd"), "the held text", 5000);
    expect(d.lines.at(-1)).toContain("abcd");
  }, 30_000);

  /** A note's rich edit on a table, past the end of its second cell by typing, refused on a save because the note changed. */
  async function richRefused(title: string) {
    const text = `${title}\n\n| crop | bed |\n| --- | --- |\n| one | leeks |`;
    const id = (await board.request("create", { parentId: null, text, author: "user" })).id as string;
    const m = (await board.get(id))!;
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    s.startDraft(m, h);
    const d = s.draft!;
    d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("leeks") + 5);
    await s.act("rich.toggle", { on: true }, h, USER);
    for (const c of " and radishes too") s.key(char(c), h);
    await other.update(id, `${title} today\n\n| crop | bed |\n| --- | --- |\n| one | leeks |`, m.revision!, USER);
    d.status.changedElsewhere = true;
    s.key(ctrl("s"), h);
    await until(() => d.status.conflict !== null && !d.busy, "the stale refusal", 5000);
    return { s, h, d };
  }
  const rich = (d: { views: { rich: unknown } }) => (d.views.rich as { on: boolean }).on;

  test("a rich cell's text after a reload stays in the cell, held or not", async () => {
    const held = await richRefused("Held cell");
    await heldReload(held.d, () => held.s.key(ctrl("r"), held.h), () => { for (const c of "ab") held.s.key(char(c), held.h); }, () => held.d.lines[0]!.includes("today"));
    await until(() => held.d.text.includes("ab"), "the held text", 5000);
    expect(held.d.lines.at(-1)).toBe("| one | leeksab |");
    expect(rich(held.d)).toBe(true);
    const plain = await richRefused("Plain cell");
    await plain.s.act("edit.reload", {}, plain.h, USER);
    for (const c of "ab") plain.s.key(char(c), plain.h);
    await until(() => plain.d.text.includes("ab"), "the typed text", 5000);
    expect(plain.d.lines.at(-1)).toBe("| one | leeksab |");
    expect(rich(plain.d)).toBe(true);
  }, 40_000);

  test("a reload that takes the table away closes rich edit, says so, and keeps the text out of any table", async () => {
    const { s, h, d } = await richRefused("Gone cell");
    await other.update(s.msg!.id, "Gone cell\n\nNo table now.", (await other.get(s.msg!.id))!.revision!, USER);
    await heldReload(d, () => s.key(ctrl("r"), h), () => { for (const c of "ab") s.key(char(c), h); }, () => d.text.includes("No table"));
    expect(rich(d)).toBe(false);
    expect(d.text).toBe("Gone cell\n\nNo table now.ab");
    expect(d.note).toContain("rich edit closed");
  }, 30_000);

  test("a reload that puts another table at that number closes rich edit: nothing goes into the other table", async () => {
    const { s, h, d } = await richRefused("Other table");
    await other.update(s.msg!.id, "Other table\n\n| tool | shed |\n| --- | --- |\n| rake | two |", (await other.get(s.msg!.id))!.revision!, USER);
    await heldReload(d, () => s.key(ctrl("r"), h), () => { for (const c of "ab") s.key(char(c), h); }, () => d.text.includes("rake"));
    expect(rich(d)).toBe(false);
    // The table stays as it came; what was typed is on a line of its own after it.
    expect(d.text).toBe("Other table\n\n| tool | shed |\n| --- | --- |\n| rake | two |\nab");
    expect(d.note).toContain("rich edit closed");
  }, 30_000);

  test("the table gone: held characters and pastes land, a held backspace or move doesn't touch the new prose, and it says so", async () => {
    const { s, h, d } = await richRefused("Gone keys");
    await other.update(s.msg!.id, "Gone keys\n\nNo table now.", (await other.get(s.msg!.id))!.revision!, USER);
    await heldReload(d, () => s.key(ctrl("r"), h), () => {
      s.key({ kind: "backspace" }, h); s.key({ kind: "left" }, h); s.key(char("a"), h); s.key({ kind: "paste", text: "bc" }, h);
    }, () => d.text.includes("No table"));
    expect(d.text).toBe("Gone keys\n\nNo table now.abc");
    expect(d.note).toContain("didn't apply");
  }, 30_000);

  test("rich edit says what a held command didn't do, whole, during the hold and after it", async () => {
    for (const cols of [80, 177]) {
      const { s, h, d } = await richRefused(`Rich line ${cols}`);
      const flat = () => s.render(cols, 24, h).lines.map(visible).join("").replace(/\s+/g, "");
      await heldReload(d, () => s.key(ctrl("r"), h), () => {
        s.key(ctrl("s"), h);
        s.key({ kind: "esc" }, h);
        expect(flat()).toContain("reloading·pressctrl+s,escagain");
      }, () => d.lines[0]!.includes("Rich line") && d.status.phase === null && d.status.conflict === null);
      const after = flat();
      expect(after).toContain("ctrl+s,escdidn'trun:pressthemagain");
      // The status grew by rows; the note under it didn't scroll for that.
      expect(after).toContain(`Richline${cols}today`);
      expect(after).toContain("revision");
      expect(after).toContain(d.status.savedCopy!.split("/").at(-1)!);
      expect(rich(d)).toBe(true);
    }
  }, 60_000);

  test("a plain note edit under a hold: written keys land in order, a command says press it again", async () => {
    const id = (await board.request("create", { parentId: null, text: "Sowing\nbeans", author: "user" })).id as string;
    const m = (await board.get(id))!;
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    s.startDraft(m, h);
    const d = s.draft!;
    s.key(char("!"), h);
    await other.update(id, "Sowing\npeas", m.revision!, USER);
    d.status.changedElsewhere = true;
    await heldReload(d, () => s.key(ctrl("r"), h), () => {
      s.key(char("x"), h); s.key(ctrl("s"), h); s.key({ kind: "paste", text: "yz" }, h); s.key({ kind: "esc" }, h); s.key(char("w"), h);
    }, () => d.text.includes("peas"));
    expect(d.text).toBe("Sowing\npeasxyzw");
    expect(s.draft).toBe(d);
    expect(d.note).toContain("didn't run");
  }, 30_000);

  test("a narrow float brought back with the cursor on line 2 draws both lines, with no blank row for line 1", async () => {
    const id = (await board.request("create", { parentId: null, text: "Gate\nHang it.", author: "user" })).id as string;
    const m = (await board.get(id))!;
    const first = new NoteSurface(), h = host();
    first.show(m, h);
    first.key(char("C"), h);
    await until(() => !!first.session?.composer, "the comment");
    for (const c of "onions by the gate") first.key(char(c), h);
    first.key({ kind: "enter" }, h);
    for (const c of "and a sign for the leeks") first.key(char(c), h);
    composerBox(first.session!.composer!, first.session!.composerFrame()!, 32, 8, true);   // drawn, so its place is kept
    first.session!.writing!.keep();
    first.session!.writing!.dispose();
    const again = new NoteSurface();
    again.show(m, h);
    again.key(char("C"), h);
    await until(() => !!again.session?.composer, "the comment again");
    const d = again.session!.composer!;
    expect(d.note).toContain("brought back");
    expect(d.row).toBe(1);
    const box = composerBox(d, again.session!.composerFrame()!, 32, 8, true).lines.map(visible).join("\n");
    expect(box).toContain("onions by the gate");
    expect(box).toContain("and a sign for the leeks");
  }, 30_000);

  // Last: it stops the host.
  test("with the host stopped ctrl+r says it couldn't read, keeps the text and the conflict", async () => {
    const { s, h, d } = await refused("Stopped host");
    const typed = d.text, conflict = d.status.conflict;
    // The host hangs mid-read, the person keeps typing, then it dies: what they typed lands on the kept text.
    process.kill(scratch.pid!, "SIGSTOP");
    const reload = s.act("comment.reload", {}, h, USER);
    await until(() => d.status.phase === "reloading", "the reload's read");
    s.key(char("!"), h);
    s.key({ kind: "paste", text: "kept" }, h);
    expect(d.text).toBe(typed);
    await scratch.stop(1);
    await reload;
    await until(() => !s.session?.busy, "the reload's answer", 15_000);
    expect(d.note).toContain("couldn't read");
    expect(d.note).not.toContain("loaded");
    expect(d.text).toBe(`${typed}!kept`);
    expect(d.status.conflict).toBe(conflict);
    // In the zoomed 30×12 reader too: why it wasn't saved, what to press, and that the read failed, over the typed row.
    const shown = s.render(28, 7, h).lines.map(visible).join("").replace(/[\s│]+/g, "");
    expect(shown).toContain("!notsaved");
    expect(shown).toContain("^R");
    expect(shown).toContain("couldn't");
    expect(shown).toContain("now");
  }, 40_000);
});
