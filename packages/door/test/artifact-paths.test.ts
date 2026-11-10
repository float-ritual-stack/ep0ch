// PIE-1656: a file with spaces in its name, written as a terminal drop writes it (`A\ B.html`, or quoted), is read and
// runs, its card titled by the file's whole name; and a card that can't read its file says the whole reason, wrapped
// inside the tile. On a scratch host, through the door's own drawing (ep0ch show). Made-up files in a temp folder.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const scratch = new Scratch();
let dir = "";
beforeAll(async () => {
  await scratch.start();
  dir = join(realpathSync(mkdtempSync(join(tmpdir(), "ep0ch-artifact-paths-"))), "late shift");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "A B.html"), "<!doctype html><p>a made-up page with no title</p>");
  writeFileSync(join(dir, "lamp (night).html"), "<!doctype html><title>Night lamp</title><p>made up</p>");
});
afterAll(() => scratch.dispose());

/** The note drawn at `width`, colours off; it waits for the card's read to land. */
const show = async (id: string, width = 44) => {
  const p = Bun.spawn(["bun", MAIN, "show", id, "--width", String(width)], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", EP0CH_MACHINE: "" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  expect(err).toBe(""); expect(code).toBe(0);
  return out.replace(/\x1b\[[0-9;]*m/g, "");
};
/** The drawing with its frame and blanks taken out: what was said, whatever the wrap did to it. */
const flat = (s: string) => s.replace(/[\s│╭╮╰╯─┌┐└┘]/g, "");

test("a path written with a terminal's escapes, or quoted, is read and runs; its card is titled by the whole name", async () => {
  const board = new SocketBoard(scratch.sock);
  const escaped = `${dir.replace(/ /g, "\\ ")}/A\\ B.html`;
  for (const line of [`[artifact::${escaped}]`, `[artifact::'${dir}/A B.html']`, `artifact:: "${dir}/A B.html"`]) {
    const note = await board.createBlock(null, `Late shift\n\n${line}`);
    // Wide enough for the temp folder's whole path, which a printed card names in full.
    const drawn = await show(note.id, 160);
    expect(drawn).not.toContain("can't read it");
    expect(drawn).toContain(`${dir}/A B.html`);
    // Read: its title is the name the store kept it under, which only a read gives.
    expect(drawn).toMatch(/│ a-b\s/);
  }
  // Other escapes a terminal writes (brackets, here) read the same, and the file's own <title> is the card's.
  const lamp = await board.createBlock(null, `Lamp\n\n[artifact::${dir.replace(/ /g, "\\ ")}/lamp\\ \\(night\\).html]`);
  const drawn = await show(lamp.id, 160);
  expect(drawn).not.toContain("can't read it");
  expect(drawn).toContain(`${dir}/lamp (night).html`);
  expect(drawn).toMatch(/│ lamp-night\s/);
}, 60_000);

test("a card that can't read its file says the whole reason, with what to do, inside the tile at 44 and 80 columns", async () => {
  const board = new SocketBoard(scratch.sock);
  const gone = "/made/up/a/folder/that/is/nowhere/on/this/machine/ghost-lantern-page.html";
  const note = await board.createBlock(null, `Ghost\n\n[artifact::${gone}]`);
  for (const width of [44, 80]) {
    const drawn = await show(note.id, width);
    expect(drawn).toContain("can't read it");
    expect(drawn.split("\n").every(row => Bun.stringWidth(row) <= width)).toBe(true);
    // Nothing of the reason is cut: from its first row to the card's end, no row ends short.
    expect(drawn.slice(drawn.indexOf("can't read it"))).not.toContain("…");
    // The reason's end is what says what to do: it's there, whole.
    expect(flat(drawn)).toContain(flat(gone));
    expect(flat(drawn)).toContain(flat("or write its path on the machine that has it."));
  }
}, 60_000);
