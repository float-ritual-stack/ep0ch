// PIE-510: what reaches the terminal. Nothing a note title, an extension's words or an error holds can act on the
// person's terminal (an OSC 52 clipboard write, ESC[2J, an 8-bit CSI); everything is measured in terminal cells,
// so a wide (CJK, emoji) title can't push the hint row's chips off the screen; a frame's hint is cut between its
// parts, never mid-word; under kitty+crt the bytes carry CP437 lookalikes, not glyphs its font draws as ?; and a
// tile opened is said as the kind's word, to agents' credit only. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CP437_NEAREST, cp437Code, inCp437, toCp437Glyphs } from "../src/ansi";
import { App } from "../src/app";
import { Canvas } from "../src/canvas";
import { Desk } from "../src/desk/desk";
import { EXT_ACTIONS } from "../src/extensions";
import { vgaCode } from "../src/mirror";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { fitHint, headOf, pad, visible, width } from "../src/style";
import { rowBytes } from "../src/term";
import { paintable, printable, wrap } from "../src/text";
import { outliner, Scratch, until } from "./scratch";

const OSC52 = "\x1b]52;c;ZXZpbA==\x07", CLEAR = "\x1b[2J", CSI8 = "\x9b2J";
/** Anything in the bytes a terminal would act on, beyond the door's own cursor moves, SGR and erase-line. */
const acts = (bytes: string) => bytes.replace(/\x1b\[\d+;1H|\x1b\[[\d;:]*m|\x1b\[K/g, "").match(/[\x00-\x1f\x7f-\x9f]/);
const cells = (s: string) => Bun.stringWidth(visible(s));

describe("nothing a terminal acts on is drawn", () => {
  test("printable takes escape sequences out whole, 7- and 8-bit, and controls as the caller says", () => {
    expect(printable(`Omen${OSC52} list${CLEAR}`)).toBe("Omen list");
    expect(printable(`a${CSI8}b\x9d52;c;eA==\x9cc\x1bPq#0\x1b\\d`)).toBe("abcd");
    expect(printable("one\ttwo\nthree", " ")).toBe("one two three");
    expect(printable("one\ttwo\nthree\x07", "", { lines: true })).toBe("one\ttwo\nthree");
    expect(printable(undefined)).toBe("");
  });

  test("a drawn line keeps the door's colour and loses everything else, at the canvas and at the row writer", () => {
    const line = `\x1b[38;2;255;255;85mlit\x1b[0m ${OSC52}tail${CLEAR}${CSI8}`;
    expect(paintable(line)).toBe("\x1b[38;2;255;255;85mlit\x1b[0m tail");
    const bytes = rowBytes(0, line, 40);
    expect(acts(bytes)).toBeNull();
    expect(bytes).toContain("\x1b[38;2;255;255;85mlit");
    const c = new Canvas(20, 1);
    c.text(0, 0, `ab${OSC52}cd${CLEAR}ef`);
    expect(visible(c.lines()[0]!)).toBe("abcdef".padEnd(20));
  });
});

describe("terminal cells, not code points", () => {
  const cjk = "会議メモ：来週の発表", emoji = "🌙 moon 👩‍💻 dev";

  test("width, pad and headOf count cells and never split a wide or joined glyph", () => {
    expect(width(cjk)).toBe(20);
    expect(width(emoji)).toBe(14);
    for (const w of [5, 6, 9, 12]) expect(cells(pad(cjk, w))).toBe(w);
    expect(pad(cjk, 6)).toStartWith("会議 ");
    expect(headOf(`\x1b[1m${cjk}`, 5)).toBe("\x1b[1m会議");
    expect(headOf(emoji, 8)).toBe("🌙 moon ");
    expect(cells(pad(emoji, 10))).toBe(10);
    for (const l of wrap(`${cjk}${cjk} and some words`, 7)) expect(width(l)).toBeLessThanOrEqual(7);
  });

  test("the canvas puts a wide glyph in two cells, keeps the row's width, and blanks half a glyph written over", () => {
    const c = new Canvas(10, 2);
    c.text(0, 0, "会議メモ：来週");
    expect(cells(c.lines()[0]!)).toBe(10);
    expect(visible(c.lines()[0]!)).toBe("会議メモ：");
    c.text(0, 1, "a会議メモ：");                      // the last one doesn't fit whole: a space instead
    expect(visible(c.lines()[1]!)).toBe("a会議メモ ");
    c.text(2, 0, "|");                                  // over the first half of 議
    expect(cells(c.lines()[0]!)).toBe(10);
    c.text(5, 0, "x");                                  // over the second half of メ
    expect(cells(c.lines()[0]!)).toBe(10);
    // A terminal tile's row (a wide character and its zero-width second cell) keeps its width too.
    const t = new Canvas(6, 1);
    t.text(0, 0, "東​ab");
    expect(cells(t.lines()[0]!)).toBe(6);
  });

  test("a hint is cut between its parts, else at a space, never mid-word; a frame's bottom edge too", () => {
    const hint = "drag title · drag ◢ · H J K L move · ^W f dock · ^W x close";
    const f = fitHint(hint, 28);
    expect(visible(f.text)).toBe("drag title · drag ◢ …");
    expect(f.at).toBe(19);
    expect(visible(fitHint("comment from a reader on the left", 20).text)).toBe("comment from a …");
    expect(fitHint("short", 20)).toEqual({ text: "short", at: -1, cut: false });
    const c = new Canvas(36, 3);
    c.box({ col: 0, row: 0, cols: 34, rows: 3 }, "", "t", hint);
    const bottom = visible(c.lines()[2]!);
    expect(bottom).toContain(" drag title · drag ◢ … ");
    expect(bottom).not.toMatch(/mov\b|H J K L m/);
  });
});

describe("CP437 on the wire", () => {
  test("every glyph the door draws is in the VGA font or has a lookalike in it", () => {
    // Characters only read, never drawn: keys macOS types with Option, key names, a paste's markers, a
    // terminal tile's zero-width second cell.
    const INPUT_ONLY = new Set([..."∫∂©˙∆˚øœ®†∑™⌫ ￼​"]);
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "vendor") walk(p); } else if (p.endsWith(".ts")) files.push(p); } };
    const src = join(import.meta.dir, "../src");
    walk(src);
    const missing: string[] = [];
    for (const file of files) readFileSync(file, "utf8").split("\n").forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      for (const lit of l.replace(/\/\/ .*$/, "").matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/gu)) for (const ch of lit[2]!) {
        const c = ch.codePointAt(0)!;
        if (inCp437(ch) || CP437_NEAREST.has(ch) || INPUT_ONLY.has(ch) || c >= 0x100000 || (c >= 0xe000 && c <= 0xf8ff)) continue;
        missing.push(`${ch} U+${c.toString(16).toUpperCase()} ${relative(src, file)}:${i + 1}`);
      }
    });
    expect(missing).toEqual([]);
  });

  test("a lookalike is one cell for one, and the mirror draws the same glyph the terminal is sent", () => {
    for (const [from, to] of CP437_NEAREST) {
      expect(Bun.stringWidth(to)).toBe(Bun.stringWidth(from));
      expect(inCp437(to)).toBe(true);
      expect(vgaCode(from)).toBe(cp437Code(to));
    }
    expect(toCp437Glyphs("⏎ open · ✓ done · ▣ locked · ╭─╮ × ◇")).toBe("◄ open · √ done · ◙ locked · ┌─┐ x ♦");
    expect(vgaCode("東")).toBe(63);
  });
});

describe.skipIf(!outliner)("on a scratch outline", () => {
  const scratch = new Scratch();
  const COLS = 120, ROWS = 36;
  let board: SocketBoard, app: App;
  let key: (k: any) => void = () => {};
  const painted: string[][] = [];
  const message = () => (app as any).message as string;
  const frameBytes = () => (painted.at(-1) ?? []).map((l, r) => rowBytes(r, l, COLS)).join("");
  const screen = () => (app as any).stack.at(-1) as any;
  let loud: any, wide: any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(scratch.root, "door", "draft.md");
    process.env.EDITOR = "tail -f";
    // An extension whose name and whose answer to `act` carry escapes: its error reaches the status bar.
    const dir = join(scratch.workspace, "extensions", "noisy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "noisy", version: 1, name: `Noisy${OSC52}${CLEAR}`, run: ["bun", "noisy.ts"],
      handlers: [{ key: "noisy", kind: "output", effects: "read", argument: { name: "word" } }],
      actions: [{ id: "shout", label: "Shout", on: "handler:noisy", key: "s", effects: "read" }],
    }));
    writeFileSync(join(dir, "noisy.ts"), `const r = await Bun.stdin.json();
process.stdout.write(JSON.stringify({ ok: true, value: r.operation === "act" ? { writes: "nope" } : { markdown: "fine" } }));`);
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = (text: string) => board.request<any>("create", { parentId: null, text, author: "agent", provenance: { actorId: "ext:probe" } });
    loud = await make(`Omen${OSC52} list${CLEAR}${CSI8}\nbody`);
    wide = await make("会議メモ：来週の発表の準備と資料のまとめ方について 🌙👩‍💻");
    const term = { info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted.push(l); }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe((e: any) => app.event(e));
    app.push(new MainMenu());
    await app.loadExtensions(true);
    app.push(new Desk(undefined, { layout: "daily" }));
  }, 40_000);

  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("a note title holding OSC 52, ESC[2J and an 8-bit CSI draws as its words; none of it reaches the bytes", async () => {
    await app.act({ action: "open", args: { id: loud.id }, as: "probe-agent-510" });
    app.redraw();
    await until(() => (painted.at(-1) ?? []).some(l => visible(l).includes("Omen list")), "the title drawn");
    const bytes = frameBytes();
    expect(acts(bytes)).toBeNull();
    expect(bytes).not.toContain("]52;");
  });

  test("an extension's error with escapes in it reaches the status bar as words", async () => {
    await until(() => EXT_ACTIONS.has("ext.noisy.shout"), "the noisy extension", 15_000);
    const n = await board.createBlock(null, "A loud note\nnoisy:: hello");
    await app.act({ action: "ext.noisy.shout", args: { block: n.id }, as: "probe-agent-510" }).catch(() => {});
    app.flash(`refused: ${OSC52}the name ${CLEAR}Noisy`);
    expect(message()).toBe("refused: the name Noisy");
    app.redraw();
    await Bun.sleep(30);
    expect(acts(frameBytes())).toBeNull();
  });

  test("a wide title in the hint row keeps the row in the screen, and the lock chip where its click lands", async () => {
    await app.act({ action: "open", args: { id: wide.id }, as: "probe-agent-510" });
    app.redraw();
    const desk = screen() as Desk & Record<string, any>;
    await until(() => desk.current?.id === wide.id, "the wide note is current");
    const row = desk.render((desk as any).ctx ?? app).lines[ROWS - 2]!;
    expect(cells(row)).toBe(COLS);
    const plain = visible(row);
    const chip = (desk as any).lockChip as { from: number; to: number };
    // The chip's click range covers the chip as drawn, in cells.
    const atCells = (from: number, to: number) => { let col = 0, out = ""; for (const g of new Intl.Segmenter().segment(plain)) { const w = Bun.stringWidth(g.segment); if (col >= from && col < to) out += g.segment; col += w; } return out; };
    expect(atCells(chip.from, chip.to)).toMatch(/lock/);
    // Cut, it says ? more, and ? shows the rest.
    expect(plain).toMatch(/· \? more/);
    const more = (desk as any).moreChip as { from: number; to: number };
    expect(atCells(more.from, more.to)).toBe("? more");
  });

  test("a tile an agent opens is said as its kind's word; the person's own open isn't said at all", async () => {
    await app.act({ action: "tile.open", args: { kind: "pty", cmd: "sh" }, as: "probe-agent-510" });
    expect(message()).toContain("an agent (probe-agent-510) opened a terminal tile");
    expect(message()).not.toMatch(/opened pty/);
    (app as any).message = "";
    const desk = screen() as any;
    await desk.cmd?.("tile.open", { kind: "tree" });
    await Bun.sleep(20);
    expect(message()).not.toMatch(/^you /);
  });
});
