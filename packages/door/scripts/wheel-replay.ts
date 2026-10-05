// Wheel replay: a door of its own in a pty (its own EP0CH_STATE and EP0CH_CONTROL under a temp dir) on a
// scratch service, a long fictional note open in the desk's reader, and wheel reports written into the pty
// as a terminal sends them. Each painted frame is parsed (xterm headless) for the first note line in view.
// Prints, per stream: frames, lines scrolled per report, each frame's step and the gaps between frames.
//   bun scripts/wheel-replay.ts [slow read fast wheel notch ssh]
//   LINES=1500 the note's length (default 600); RICH=1 gives each line bold, a link and a property (it wraps
//   to two rows at the reader's width, so a row is half a line).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import xterm from "@xterm/headless";
import { Scratch } from "../test/scratch";
import { SocketBoard } from "../src/socket";

const COLS = 160, ROWS = 48;
type Step = { at: number; n: number; dir: 1 | -1 };   // at ms: n reports in one write

// Seeded jitter so runs compare.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
export const streams: Record<string, () => Step[]> = {
  // A slow read: one report every 15–60ms (Ghostty: one report per cell of finger travel), 40 reports.
  slow: () => { seed = 7; let t = 0; return Array.from({ length: 40 }, () => ({ at: (t += 15 + rnd() * 45), n: 1, dir: 1 as const })); },
  // Reading speed with pauses: 4–6 reports 20–50ms apart, then a 300–600ms pause (reading), 6 times.
  read: () => { seed = 11; let t = 0; const out: Step[] = []; for (let g = 0; g < 6; g++) { const k = 4 + Math.floor(rnd() * 3); for (let i = 0; i < k; i++) out.push({ at: (t += 20 + rnd() * 30), n: 1, dir: 1 }); t += 300 + rnd() * 300; } return out; },
  // A fast swipe with momentum: a frame every 8ms, 2–5 reports per event, decaying to singles.
  fast: () => { seed = 3; let t = 0; const out: Step[] = []; for (let i = 0; i < 60; i++) { const n = Math.max(1, Math.round(5 * Math.exp(-i / 25) + rnd())); out.push({ at: (t += 8 + rnd() * 4 + i * 0.6), n, dir: 1 }); } return out; },
  // A mouse wheel in Ghostty: each notch is 3 reports in one write (discrete multiplier 3), 300ms apart.
  wheel: () => Array.from({ length: 8 }, (_, i) => ({ at: 100 + i * 300, n: 3, dir: 1 as const })),
  // A mouse wheel in a terminal that sends one report per notch (xterm, most Linux terminals).
  notch: () => Array.from({ length: 8 }, (_, i) => ({ at: 100 + i * 300, n: 1, dir: 1 as const })),
  // The slow read over a slow ssh link: reports coalesced into one write every 80ms.
  ssh: () => { const s = streams.slow!(), out: Step[] = []; for (const x of s) { const at = Math.ceil(x.at / 80) * 80; const l = out.at(-1); if (l && l.at === at) l.n += x.n; else out.push({ at, n: x.n, dir: 1 }); } return out; },
};

const scratch = new Scratch();
const sock = await scratch.start();
const board = new SocketBoard(sock);
const text = ["Scroll fixture [type::fixture]", ...Array.from({ length: Number(process.env.LINES ?? 600) }, (_, i) => `L${String(i + 1).padStart(3, "0")} the lighthouse keeper counts the gulls on the breakwater${process.env.RICH ? " with **the brass** telescope, see [[Harbour log]] and `tide::low`" : ""}`)].join("\n");
const id = (await board.request<any>("create", { parentId: null, text, author: "agent" })).id as string;
board.close();

const tmp = mkdtempSync(join(tmpdir(), "ep0ch-wheel-"));
const env = { ...process.env, EP0CH_STATE: join(tmp, "state"), EP0CH_CONTROL: join(tmp, "door.sock"), EP0CH_SOCKET: sock, TERM: "xterm-256color" } as Record<string, string>;
const vt = new xterm.Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true, scrollback: 0 });
const frames: { t: number; top: number | null }[] = [];
let t0 = performance.now(), raw = "";
const topLine = (): number | null => {
  const b = vt.buffer.active;
  for (let y = 0; y < ROWS; y++) { const m = /L(\d{3,4}) the lighthouse/.exec(b.getLine(y)?.translateToString() ?? ""); if (m) return Number(m[1]); }
  return null;
};
const pty = new Bun.Terminal({
  cols: COLS, rows: ROWS, name: "xterm-256color",
  data: (_t, d) => {
    const s = Buffer.from(d).toString("latin1");
    raw += s;
    // A frame ends at the synchronized update's end; read the screen once xterm has parsed it.
    let i;
    while ((i = raw.indexOf("\x1b[?2026l")) >= 0) {
      const chunk = raw.slice(0, i + 8); raw = raw.slice(i + 8);
      const at = performance.now() - t0;
      vt.write(Buffer.from(chunk, "latin1"), () => frames.push({ t: at, top: topLine() }));
    }
  },
});
const door = Bun.spawn(["bun", "src/main.ts", "--no-daemon", "--screen", "desk"], { cwd: join(import.meta.dir, ".."), env, terminal: pty });
const ctl = (...a: string[]) => Bun.spawnSync(["bun", "src/main.ts", ...a], { cwd: join(import.meta.dir, ".."), env, timeout: 8000 }).stdout.toString();
await Bun.sleep(3000);
ctl("open", id);
await Bun.sleep(1500);

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(streams);
const results: Record<string, { reports: { t: number; n: number }[]; frames: typeof frames }> = {};
for (const name of want) {
  // Back to the top: the wheel up, far enough, in one write.
  pty.write("\x1b[<64;80;24M".repeat(4000));
  await Bun.sleep(800);
  frames.length = 0; t0 = performance.now(); const start = topLine()!;
  const s = streams[name]!();
  for (const st of s) {
    const wait = st.at - (performance.now() - t0);
    if (wait > 0) await Bun.sleep(wait);
    pty.write(`\x1b[<${st.dir > 0 ? 65 : 64};80;24M`.repeat(st.n));
  }
  await Bun.sleep(1200);
  results[name] = { reports: s.map(x => ({ t: Math.round(x.at), n: x.n })), frames: frames.map(f => ({ t: Math.round(f.t), top: f.top })) };
  const total = s.reduce((a, x) => a + x.n, 0);
  const tops = [start, ...frames.map(f => f.top).filter((x): x is number => x !== null)];
  const deltas = tops.slice(1).map((v, i) => v - tops[i]!);
  const lastReport = s.at(-1)!.at, lastFrame = frames.at(-1)?.t ?? 0;
  console.log(`\n== ${name}: ${total} reports in ${s.length} writes over ${Math.round(lastReport)}ms → ${frames.length} frames, scrolled ${tops.length ? tops.at(-1)! - tops[0]! : 0} lines (${((tops.at(-1)! - tops[0]!) / total).toFixed(2)}/report), last frame ${Math.round(lastFrame - lastReport)}ms after the last report`);
  console.log(`   per-frame steps: ${deltas.filter(d => d).join(" ")}`);
  console.log(`   frame gaps ms: ${frames.slice(1).map((f, i) => Math.round(f.t - frames[i]!.t)).join(" ")}`);
  console.log(`   backwards steps: ${deltas.filter(d => d < 0).length}`);
}
await Bun.write(join(tmp, "results.json"), JSON.stringify(results, null, 1));
console.log(`\nresults: ${join(tmp, "results.json")}`);
door.kill(); await door.exited; pty.close();
await scratch.stop();
process.exit(0);
