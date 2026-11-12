// PIE-1500: what a frame costs a session's terminal in each video mode, measured at the mini's size (218×63). The brief
// suspected the CRT underlay was resent each frame under kitty+crt; it is not: the tube goes up once (then only on a
// resize or a theme change) and every later frame is the rows that changed, the same bytes in kitty+crt, kitty and cells.
// This keeps it so: a change that makes kitty+crt cost more per frame than cells fails here.
import { describe, expect, test } from "bun:test";
import type { Video } from "../src/display";
import type { DaemonMsg, Hello } from "../src/session/protocol";
import { PROTOCOL } from "../src/session/protocol";
import { SessionTerm, type Link } from "../src/session/session-term";
import type { Placement } from "../src/kitty";
import { sizedPlacement } from "../src/text-sizing";

const COLS = 218, ROWS = 63;
const frame = (n: number) => Array.from({ length: ROWS }, (_, r) => `\x1b[33m${"█".repeat(10)}\x1b[36m row ${r} frame ${n} ${"·".repeat(COLS - 40)}\x1b[0m`);

/** A client whose link counts the bytes it is sent, and the Kitty uploads among them. */
function client(video: Video, cellH = 18) {
  let bytes = 0, uploads = 0;
  const link: Link = {
    send: (m: DaemonMsg) => { if (m.t === "output") { bytes += Buffer.byteLength(m.text); uploads += (m.text.match(/\x1b_Ga=t,/g) ?? []).length; } },
    backlog: () => 0, onDrain: () => {}, close: () => {},
  };
  const term = new SessionTerm();
  const hello: Hello = { proto: PROTOCOL, remote: false, cols: COLS, rows: ROWS, cellW: 9, cellH, kitty: true, pst: false, tree: false, sized: false, acks: false, pid: 4242 };
  const c = term.attach(link, hello);
  c.painter.video = video;
  const take = () => { const b = bytes; bytes = 0; return b; };
  const show = (lines: string[]) => { term.show(lines, []); return take(); };
  take();
  return { term, c, show, uploads: () => uploads, bytes: () => c.bytesSent, frames: () => c.framesSent };
}

describe("what a frame costs per video mode at the mini's size (PIE-1500)", () => {
  test("the CRT underlay goes up once; after it, a kitty+crt frame costs what a cells frame does", () => {
    const crt = client("kitty+crt"), kitty = client("kitty"), cells = client("cells");
    const first = { crt: crt.show(frame(0)), kitty: kitty.show(frame(0)), cells: cells.show(frame(0)) };
    expect(crt.uploads()).toBe(1);
    expect(kitty.uploads()).toBe(0);
    // The tube is one upload, under 40 KB at this size, never a frame's worth.
    expect(first.crt - first.cells).toBeGreaterThan(0);
    expect(first.crt - first.cells).toBeLessThan(40_000);
    // Every frame after: the rows that changed, the same bytes in each mode, and nothing uploaded again.
    const whole = { crt: crt.show(frame(1)), kitty: kitty.show(frame(1)), cells: cells.show(frame(1)) };
    expect(whole.crt).toBe(whole.cells);
    expect(whole.kitty).toBe(whole.cells);
    const oneRow = frame(1); oneRow[5] = oneRow[5]!.replace("frame 1", "frame 2");
    const row = { crt: crt.show(oneRow), kitty: kitty.show(oneRow), cells: cells.show(oneRow) };
    expect(row.crt).toBe(row.cells);
    expect(row.crt).toBeLessThan(1000);
    expect(crt.uploads()).toBe(1);
    // A hundred frames more: still one upload, and the bytes per frame are what `peek` says of the client.
    for (let n = 3; n < 103; n++) crt.show(frame(n));
    expect(crt.uploads()).toBe(1);
    expect(crt.frames()).toBe(103);
    expect(crt.term.speed()[0]).toMatchObject({ frames: 103, bytes: crt.bytes() });
    expect(crt.bytes() / crt.frames()).toBeLessThan(whole.cells + 500);
  });

  test("under cells nothing but rows goes: no images and no text drawn at a size, whatever the terminal has", () => {
    const sized: Placement = sizedPlacement("title", "Plot", "\x1b[1m", 2, 1, 4);
    const lines = frame(0); lines[1] = "  Plot"; lines[2] = "";
    for (const [video, expectSized] of [["kitty+crt", true], ["kitty", true], ["cells", false]] as const) {
      let out = "";
      const link: Link = { send: m => { if (m.t === "output") out += m.text; }, backlog: () => 0, onDrain: () => {}, close: () => {} };
      const term = new SessionTerm();
      const c = term.attach(link, { proto: PROTOCOL, remote: false, cols: COLS, rows: ROWS, cellW: 9, cellH: 18, kitty: true, pst: false, tree: false, sized: true, acks: false, pid: 1 });
      c.painter.video = video;
      term.show(lines, [sized]);
      expect(out.includes("\x1b]66;")).toBe(expectSized);
      expect(out.includes("\x1b_G")).toBe(video === "kitty+crt");   // the tube: the one image this frame has
    }
  });

  test("a taller cell (a Retina mini) makes the tube taller, still one upload and no bigger frames", () => {
    const crt = client("kitty+crt", 36), cells = client("cells", 36);
    crt.show(frame(0)); cells.show(frame(0));
    expect(crt.uploads()).toBe(1);
    expect(crt.show(frame(1))).toBe(cells.show(frame(1)));
    expect(crt.uploads()).toBe(1);
  });
});
