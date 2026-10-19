// PIE-638: a code block, a quote and a callout copy their content as written (the ⧉ control, y on the current element, `act
// block.copy`), and a selection across them copies the words, not the drawn bars, frames and bullets. Fictional notes, no service.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPAN_COPY } from "../src/showcase/seed/media";
import { Scratch, until as waitUntil } from "./scratch";
import { SocketBoard } from "../src/socket";
import type { Msg } from "../src/board";
import type { Actor } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const AGENT: Actor = { kind: "agent", id: "claude-638" };

const TEXT = [
  "Notes for the hedge",
  "Before the draft:",
  "> Hi Sam, the hedge is cut.",
  "> I left the clippings by the gate.",
  "",
  "```sh",
  "cd ~/garden",
  "trim --all",
  "```",
  "",
  "> [!note] Reminder",
  "> Bring the *shears* back.",
  "> - sharpen them first",
  "",
  "- a plain bullet",
  "",
  "Run `trim --all` twice, then see ((22222222-3333-4444-8555-666666666666|the shed)).",
].join("\n");

const setup = (text = TEXT) => {
  const copies: string[] = [], flashes: string[] = [];
  const h: SurfaceHost = {
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash: (m: string) => flashes.push(m), copy: (t: string) => { copies.push(t); return true; }, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate() {},
  };
  const m: Msg = { id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, properties: [] };
  const s = new NoteSurface();
  s.show(m, h);
  const draw = () => s.render(60, 24, h).lines;
  const at = (needle: string, lines = draw()) => {
    const y = lines.findIndex(l => plain(l).includes(needle));
    if (y < 0) throw new Error(`${needle} isn't drawn:\n${lines.map(plain).join("\n")}`);
    return { x: plain(lines[y]!).indexOf(needle), y };
  };
  /** The ⧉ controls drawn: their cell, top to bottom. */
  const controls = () => draw().flatMap((l, y) => { const x = [...plain(l)].indexOf("⧉"); return x >= 0 ? [{ x, y }] : []; });
  return { s, h, copies, flashes, draw, at, controls };
};

describe("copying a block", () => {
  test("a ⧉ is drawn on the quote, the code block and the callout, and a click copies the content as written", () => {
    const { s, h, copies, flashes, controls } = setup();
    const cs = controls();
    expect(cs).toHaveLength(3);
    s.press(cs[0]!.x, cs[0]!.y, h); s.release(cs[0]!.x, cs[0]!.y, h);
    expect(copies.at(-1)).toBe("Hi Sam, the hedge is cut.\nI left the clippings by the gate.");
    expect(flashes.at(-1)).toBe("copied 2 lines");
    const c2 = controls()[1]!;
    s.press(c2.x, c2.y, h); s.release(c2.x, c2.y, h);
    expect(copies.at(-1)).toBe("cd ~/garden\ntrim --all");
    const c3 = controls()[2]!;
    s.press(c3.x, c3.y, h); s.release(c3.x, c3.y, h);
    expect(copies.at(-1)).toBe("Bring the *shears* back.\n- sharpen them first");
    for (const c of copies) { expect(c).not.toContain("│"); expect(c).not.toMatch(/^>/m); expect(c).not.toContain("[!note]"); expect(c).not.toContain("```"); }
  });

  test("[ ] stops on a block, and y copies it", () => {
    const { s, h, copies, flashes, draw } = setup();
    draw();
    const els = s.describe().elements;
    expect(els?.count).toBeGreaterThan(0);
    s.key(char("]"), h);
    expect(s.describe().elements?.current).toMatchObject({ kind: "block", label: "quote, 2 lines" });
    s.key(char("y"), h);
    expect(copies).toEqual(["Hi Sam, the hedge is cut.\nI left the clippings by the gate."]);
    expect(flashes.at(-1)).toBe("copied 2 lines");
    s.key(char("]"), h);
    s.key(char("y"), h);
    expect(copies.at(-1)).toBe("cd ~/garden\ntrim --all");
  });

  test("act blocks lists them; block.copy copies the person's to their clipboard and returns an agent's only", async () => {
    const { s, h, copies, flashes, draw } = setup();
    draw();
    const listed = await s.act("blocks", {}, h, AGENT) as { blocks: { n: number; kind: string; lines: number }[] };
    expect(listed.blocks.map(b => b.kind)).toEqual(["quote", "code", "callout", "span"]);
    const mine = await s.act("block.copy", { n: 2 }, h, { kind: "user" } as Actor) as { text: string; clipboard: boolean };
    expect(mine).toMatchObject({ text: "cd ~/garden\ntrim --all", clipboard: true });
    expect(copies).toEqual(["cd ~/garden\ntrim --all"]);
    const theirs = await s.act("block.copy", { n: 3 }, h, AGENT) as { text: string; clipboard: boolean };
    expect(theirs).toMatchObject({ text: "Bring the *shears* back.\n- sharpen them first", clipboard: false });
    expect(copies).toHaveLength(1);                                  // the agent's never reached the clipboard
    expect(flashes.at(-1)).toContain("your clipboard is untouched");
    await expect(s.act("block.copy", {}, h, AGENT)).rejects.toThrow(/say which block/);
    await expect(s.act("block.copy", { n: 9 }, h, AGENT)).rejects.toThrow(/no block 9/);
  });

  test("a drag across the quote and the callout copies the words, with no bar, frame, marker or glyph", () => {
    const { s, h, copies, at, draw } = setup();
    const a = at("Hi Sam"), z = at("a plain bullet");
    s.press(a.x, a.y, h); s.drag(a.x + 3, a.y, h); s.drag(z.x + 14, z.y, h);
    s.release(z.x + 14, z.y, h);
    const text = copies.at(-1)!;
    expect(text).toContain("Hi Sam, the hedge is cut.\nI left the clippings by the gate.");
    expect(text).toContain("cd ~/garden\ntrim --all");
    expect(text).toContain("Bring the shears back.");
    expect(text).toContain("- a plain bullet");                      // a list marker is the note's, not the drawn glyph
    expect(text).toContain("- sharpen them first");
    for (const bad of ["│", "▌", "╭", "╮", "╰", "╯", "∙", "```"]) expect(text).not.toContain(bad);
    expect(plain(draw().join("\n"))).toContain("│");              // the frame is still drawn
  });

  test("an inline code span copies its contents without the backticks by a click, by [ ] and y, and by act element=", async () => {
    const { s, h, copies, flashes, draw, at } = setup();
    const a = at("trim --all twice");
    s.press(a.x + 2, a.y, h); s.release(a.x + 2, a.y, h);
    expect(copies.at(-1)).toBe("trim --all");
    expect(flashes.at(-1)).toBe("copied 10 chars");
    expect(s.describe().elements?.current).toMatchObject({ kind: "block", label: "code · trim --all" });
    // The text around it is as it was: a click beside the span copies nothing.
    const n = copies.length;
    s.press(a.x + 14, a.y, h); s.release(a.x + 14, a.y, h);
    expect(copies).toHaveLength(n);
    // By keys: [ ] steps to the span (the last element), y copies it.
    s.key({ kind: "esc" }, h);
    for (let i = 0; i < 12 && s.describe().elements?.current?.label !== "code · trim --all"; i++) s.key(char("]"), h);
    s.key(char("y"), h);
    expect(copies.at(-1)).toBe("trim --all");
    // By act: element=n, and an agent's is only returned.
    const els = (await s.act("elements", {}, h, AGENT)) as { elements: { n: number; label: string }[] };
    const el = els.elements.find(e => e.label === "code · trim --all")!;
    const before = copies.length;
    expect(await s.act("block.copy", { element: el.n }, h, AGENT)).toMatchObject({ kind: "span", text: "trim --all", clipboard: false });
    expect(copies).toHaveLength(before);
    expect(draw().map(plain).join("\n")).toContain("Run trim --all twice");   // the backticks are not drawn, as before
  });

  test("a quote holding a bullet list copies with the list markers as written and no bar", () => {
    const { s, h, copies, at } = setup("Draft\n> Before sending:\n> - check the new R2 pages\n>   - and the nested one\n> * confirm one form event\n> 1. then number it");
    const a = at("Before sending"), z = at("then number it");
    s.press(a.x, a.y, h); s.drag(a.x + 2, a.y, h); s.drag(z.x + 13, z.y, h); s.release(z.x + 13, z.y, h);
    expect(copies.at(-1)).toBe("Before sending:\n- check the new R2 pages\n  - and the nested one\n* confirm one form event\n1. then number it");
    // The ⧉ copies the quote's source text, markers and all.
    const c = s.render(60, 24, h).lines.flatMap((l, y) => { const x = [...plain(l)].indexOf("⧉"); return x >= 0 ? [{ x, y }] : []; })[0]!;
    s.press(c.x, c.y, h); s.release(c.x, c.y, h);
    expect(copies.at(-1)).toBe("Before sending:\n- check the new R2 pages\n  - and the nested one\n* confirm one form event\n1. then number it");
  });

  test("a selection of part of a quote copies just those words", () => {
    const { s, h, copies, at } = setup();
    const a = at("the clippings");
    s.press(a.x, a.y, h); s.drag(a.x + 12, a.y, h); s.release(a.x + 12, a.y, h);
    expect(copies.at(-1)).toBe("the clippings");
  });
});

describe("copying the whole note", () => {
  test("Y with nothing selected copies the note's source as stored, said as lines; a selection's Y is still that selection's source", async () => {
    const { s, h, copies, flashes, draw } = setup();
    draw();
    s.key(char("Y"), h);
    await until(() => copies.length === 1);
    expect(copies[0]).toBe(TEXT);
    expect(flashes.at(-1)).toBe(`copied the note, ${TEXT.split("\n").length} lines`);
    // With a selection, Y is that selection's source and not the note.
    s.key(char("v"), h); for (const c of "lll") s.key(char(c), h);
    s.key(char("Y"), h);
    await until(() => copies.length === 2);
    expect(copies[1]!.length).toBeLessThan(TEXT.length);
    expect(TEXT).toContain(copies[1]!);
    s.key({ kind: "esc" }, h);
    // y with nothing selected still only hints, and now names Y.
    s.key(char("y"), h);
    expect(flashes.at(-1)).toContain("Y copies the whole note");
    expect(copies).toHaveLength(2);
  });

  test("an agent's note.copy returns the text and never touches the person's clipboard; the person's goes to it", async () => {
    const { s, h, copies, flashes } = setup();
    const theirs = await s.act("note.copy", {}, h, AGENT) as { text: string; lines: number; clipboard: boolean };
    expect(theirs).toMatchObject({ text: TEXT, lines: TEXT.split("\n").length, clipboard: false });
    expect(copies).toEqual([]);
    expect(flashes.at(-1)).toContain("your clipboard is untouched");
    const mine = await s.act("note.copy", {}, h, { kind: "user" } as Actor) as { clipboard: boolean };
    expect(mine.clipboard).toBe(true);
    expect(copies).toEqual([TEXT]);
  });
});

const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(10); };

// The real terminal path owns container coverage: SGR mouse input to OSC 52 output.
describe("code span clicks in a scratch terminal", () => {
  const scratch = new Scratch();
  let board: SocketBoard, note: Msg;
  const socket = join(scratch.root, "tmux.sock"), output = join(scratch.root, "terminal.out");
  const env = { ...process.env, ...scratch.env, EP0CH_STATE: join(scratch.root, "door"), EP0CH_CONTROL: join(scratch.root, "door.sock"), EP0CH_DAEMON: "0", EP0CH_DAILY_AGENT: "sh" };
  const tmux = (...args: string[]) => {
    const r = Bun.spawnSync(["tmux", "-S", socket, ...args], { env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode) throw new Error(r.stderr.toString());
    return r.stdout.toString();
  };
  const capture = () => tmux("capture-pane", "-p", "-t", "spans");
  const copied = () => [...readFileSync(output, "utf8").matchAll(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g)].map(m => Buffer.from(m[1]!, "base64").toString());
  const click = (text: string, offset = 0) => {
    const lines = capture().split("\n"), y = lines.findIndex(l => l.includes(text));
    expect(y, `${text} is drawn\n${lines.join("\n")}`).toBeGreaterThanOrEqual(0);
    const x = lines[y]!.indexOf(text) + offset;
    tmux("send-keys", "-t", "spans", "-l", `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
    return y;
  };
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    note = await board.request<Msg>("create", { parentId: null, author: "agent", text: SPAN_COPY });
    await board.comment("span-comment", note.id, note.revision!, "Try `comment-copy`.", { quote: "Paragraph `paragraph-copy`.", start: SPAN_COPY.indexOf("Paragraph `paragraph-copy`.") });
    writeFileSync(output, "");
    tmux("new-session", "-d", "-s", "spans", "-x", "120", "-y", "65", "bun", join(import.meta.dir, "../src/main.ts"), "--here", "--ws", "scratch", "--screen", "detail", note.id);
    tmux("pipe-pane", "-t", "spans", `cat > ${output}`);
    await waitUntil(() => capture().includes("figure-copy"), "the scratch note", 15000);
  }, 30000);
  afterAll(async () => {
    tmux("kill-session", "-t", "spans");
    board?.close();
    await scratch.dispose();
  });
  for (const text of ["paragraph-copy", "bullet-copy", "step-copy", "callout-copy", "callout-list-copy", "callout-task-copy", "nested-copy", "table-copy", "figure-copy", "wrapped-tail", "callout-tail", "comment-copy"]) {
    test(`${text} copies on its drawn cell`, async () => {
      tmux("send-keys", "-t", "spans", "Escape");
      if (text === "comment-copy") {
        tmux("send-keys", "-t", "spans", "M");
        await waitUntil(() => capture().includes(text), "the comment", 3000);
      }
      const before = copied().length;
      const row = click(text, 2);
      await waitUntil(() => copied().length > before, `${text} OSC 52`, 1500);
      expect(copied().at(-1)).toBe(text.endsWith("-tail") ? `garden link setup --host garden.example --name shed --label brass watering can --finish ${text}` : text);
      await waitUntil(() => capture().includes("copied"), "the copied status painted", 1500);
      await waitUntil(() => tmux("capture-pane", "-e", "-p", "-t", "spans").split("\n")[row]!.includes("48;2;"), "the copied row highlighted", 1500);
      tmux("send-keys", "-t", "spans", "y");
      await waitUntil(() => copied().length > before + 1, "y on the selected span", 1500);
      expect(copied().at(-1)).toBe(text.endsWith("-tail") ? `garden link setup --host garden.example --name shed --label brass watering can --finish ${text}` : text);
    });
  }
  test("the expanded comment copies in the side margin too", async () => {
    tmux("send-keys", "-t", "spans", "Escape");
    click("comment ·", 2);
    tmux("resize-window", "-t", "spans", "-x", "200", "-y", "65");
    await waitUntil(() => capture().split("\n")[0]!.length > 150, "the wider terminal");
    tmux("send-keys", "-t", "spans", "Home");
    await waitUntil(() => capture().includes("[Reply]") && capture().includes("comment-copy"), "the expanded comment");
    const before = copied().length;
    const row = click("comment-copy", 2);
    await waitUntil(() => copied().length > before, "the side comment copied", 1500);
    expect(copied().at(-1)).toBe("comment-copy");
    await waitUntil(() => tmux("capture-pane", "-e", "-p", "-t", "spans").split("\n")[row]!.includes("48;2;"), "the copied row highlighted", 1500);
    tmux("resize-window", "-t", "spans", "-x", "120", "-y", "65");
    await waitUntil(() => capture().split("\n")[0]!.length < 150, "the narrow terminal");
  });
  test("the nested callout task mark opens its choices", async () => {
    tmux("send-keys", "-t", "spans", "Escape", "M");
    click("[ ] Task nested-copy", 1);
    await waitUntil(() => capture().includes("Mark done"), "nested task choices", 1500);
    tmux("send-keys", "-t", "spans", "x");
    let saved = "";
    for (let i = 0; i < 100; i++) { saved = (await board.get(note.id))!.text; if (saved.includes("> > > - [x] Task `nested-copy`")) break; await Bun.sleep(20); }
    expect(saved).toContain("> > > - [x] Task `nested-copy`");
  });
  test("the task mark still toggles on its own cell", async () => {
    tmux("send-keys", "-t", "spans", "Escape");
    click("[ ] Task step-copy", 1);
    await waitUntil(() => capture().includes("Mark done"), "the task choices");
    tmux("send-keys", "-t", "spans", "x");
    let saved = "";
    for (let i = 0; i < 100; i++) { saved = (await board.get(note.id))!.text; if (saved.includes("- [x] Task `step-copy`")) break; await Bun.sleep(20); }
    expect(saved).toContain("- [x] Task `step-copy`");
  });
});
