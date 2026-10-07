// The resize bench (PIE-623): a border dragged across a desk of typical tiles, measured frame by frame, so resize
// performance is numbers and not vibes. It needs no real terminal: the door renders into a Rows that counts what it
// would write (bytes, Kitty graphics commands), against a scratch outline host seeded with the showcase.
//
//   bun scripts/bench-resize.ts                       every config: Kitty graphics on and off, at 120x40 and 250x70
//   bun scripts/bench-resize.ts --only kitty@250x70   one config or more (kitty|cells@COLSxROWS, comma-separated)
//   bun scripts/bench-resize.ts --json                the summaries as JSON on stdout
//   bun scripts/bench-resize.ts --frames              every frame of the drag, on stderr
//   bun scripts/bench-resize.ts --check               exit 1 when a budget below is broken (--check-time: the 16 ms too)
//   --span N (cells the border travels, default 20) · --hz N (mouse reports a second, default 60) · --runs N (each
//   config N times, default 3: the frame times pooled, the rest from the run with the median CPU)
//
// The desk: the hero note, scrolled so its header shows the picture's backdrop | the pictures note over the figures
// note | the river | the kanban over a terminal tile. The first border is pressed, dragged `span` cells right, back
// past where it started by half that (it ends somewhere new), then let go. The reports come on the mouse's own clock, `hz` a second: those due
// while the door was busy painting arrive together as one chunk of input, as a terminal hands them over, and the
// door paints once a chunk (App.batched). Then the door is left to settle: what letting go finishes (images scaled for
// the new widths, uploaded, placed).
//
// Each frame painted during the drag (a chunk's, or one an image arriving asked for): its ms (the chunk's reports
// handled, and the paint), the layout part (the reports), the screen's render and each tile's, bytes written, Kitty
// uploads (and their bytes), placements and deletes. Per config: p50/p95/max frame ms, frames over the 16 ms
// budget, how long a report waited to be seen (lag), media work (PNGs scaled, cell grids made), the tick's ms, CPU
// over the drag (every thread, sharp's included), peak RSS, and what letting go costs.
//
// Each run is a child process of its own (its own scratch host, media cache and state): none warms another's.
// Benchmarks are CPU-heavy: on a shared machine run them in a box (CONTRIBUTING.md, Performance), and compare numbers
// from one machine only.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? def : def; };

export interface Config { kitty: boolean; cols: number; rows: number }
export const CONFIGS: Config[] = [false, true].flatMap(kitty => [[120, 40], [250, 70]].map(([cols, rows]) => ({ kitty, cols: cols!, rows: rows! })));
const label = (c: Config) => `${c.kitty ? "kitty" : "cells"}@${c.cols}x${c.rows}`;
const parse = (s: string): Config => {
  const m = /^(kitty|cells)@(\d+)x(\d+)$/.exec(s);
  if (!m) throw new Error(`a config is kitty|cells@COLSxROWS, not ${s}`);
  return { kitty: m[1] === "kitty", cols: Number(m[2]), rows: Number(m[3]) };
};

interface Frame { ms: number; layoutMs: number; renderMs: number; tiles: Record<string, number>; bytes: number; uploads: number; uploadBytes: number; places: number; deletes: number }
export interface Summary {
  config: string; frames: number; reports: number; p50: number; p95: number; max: number; over16: number; lagP95: number;
  layoutMs: number; renderMs: number; tiles: Record<string, number>;
  bytes: number; bytesPerFrame: number; uploads: number; uploadBytes: number; places: number; deletes: number; scaled: number; grids: number;
  tickMs: number; cpuMs: number; rssMB: number;
  /** Every frame's ms and every chunk's lag, for pooling runs. */
  ms: number[]; lag: number[];
  settle: { ms: number; frames: number; bytes: number; uploads: number; uploadBytes: number; scaled: number; grids: number };
}

/**
 * What a drag may cost, checked by `--check` (and test/resize-bench.test.ts): no image scaled, no cell grid made and
 * nothing uploaded until it's let go, then what the new sizes need made; and at most this many bytes a cell a frame
 * (a moved border rewrites the rows it crosses). `--check-time`: p95 under a frame, which only means something on a
 * quiet machine.
 */
export const BUDGET = { bytesPerCell: 6, frameMs: 16 };
export function broken(s: Summary, time = false): string[] {
  const [cols, rows] = s.config.split("@")[1]!.split("x").map(Number) as [number, number];
  const kitty = s.config.startsWith("kitty");
  const perCell = s.bytesPerFrame / (cols * rows);
  return [
    s.scaled ? `${s.scaled} images scaled during the drag (none until it's let go)` : "",
    s.grids ? `${s.grids} cell grids made during the drag (none until it's let go)` : "",
    s.uploads ? `${s.uploads} images uploaded during the drag (none until it's let go)` : "",
    perCell > BUDGET.bytesPerCell ? `${perCell.toFixed(1)} bytes a cell a frame (at most ${BUDGET.bytesPerCell})` : "",
    (kitty ? s.settle.scaled : s.settle.grids) ? "" : `letting go made nothing for the new sizes (${kitty ? "scaled" : "grids"} 0)`,
    time && s.p95 > BUDGET.frameMs ? `p95 ${s.p95} ms (at most ${BUDGET.frameMs})` : "",
  ].filter(Boolean);
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0; };
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The Kitty graphics commands in `s`: uploads (a=t, counted once, with every chunk's bytes), placements (a=p), deletes (a=d). */
function kittyCounts(s: string) {
  let uploads = 0, uploadBytes = 0, places = 0, deletes = 0;
  for (const m of s.matchAll(/\x1b_G([^;\x1b]*)(?:;[^\x1b]*)?\x1b\\/g)) {
    const head = m[1]!;
    if (/(^|,)a=t/.test(head)) { uploads++; uploadBytes += m[0].length; }
    else if (/(^|,)a=p/.test(head)) places++;
    else if (/(^|,)a=d/.test(head)) deletes++;
    else if (/(^|,)m=[01]/.test(head)) uploadBytes += m[0].length;
  }
  return { uploads, uploadBytes, places, deletes };
}

async function runOne(cfg: Config, o: { span: number; hz: number; frames: boolean }): Promise<Summary> {
  const { Scratch } = await import("../test/scratch");
  const scratch = new Scratch();
  process.env.EP0CH_STATE = join(scratch.root, "door");
  mkdirSync(process.env.EP0CH_STATE, { recursive: true });
  try {
    await scratch.start();
    const n = (await scratch.seedShowcase()).notes;
    const { App } = await import("../src/app");
    const { MainMenu } = await import("../src/screens");
    const { Desk } = await import("../src/desk/desk");
    const { register } = await import("../src/desk/screen-notes");
    const { Rows } = await import("../src/term");
    const { SocketBoard } = await import("../src/socket");
    const { mediaWork } = await import("../src/media");
    const board = new SocketBoard(scratch.sock);
    await board.info();

    // The terminal: a Rows whose writes are counted (a frame's rows and its Kitty commands), keys and chunks from here.
    let written = "", total = 0;
    const rows = new Rows(s => { written += s; total += s.length; }, { cols: cfg.cols, rows: cfg.rows, cellW: 9, cellH: 18, kitty: cfg.kitty });
    let keyHandler: (k: unknown) => void = () => {};
    let batch: (run: () => void) => void = run => run();
    const term = Object.assign(rows, { onKey(f: (k: unknown) => void) { keyHandler = f; }, onBatch(f: (run: () => void) => void) { batch = f; }, onResize() {}, stop() {}, resume() {} });
    const app = new App(term as never, board, Date.now(), () => {});
    app.push(new MainMenu());

    const L = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });
    const root = {
      t: "split", dir: "row", weights: [0.3, 0.25, 0.25, 0.2], kids: [
        L("detail", "hero", { note: n.hero.id }),
        { t: "split", dir: "col", weights: [0.55, 0.45], kids: [L("detail", "pictures", { note: n.images.id }), L("detail", "figures", { note: n.figures.id })] },
        { t: "flow", key: "river", kids: [L("river.column", "library", { source: "roots" })] },
        { t: "split", dir: "col", weights: [0.6, 0.4], kids: [L("board", "board", { preview: false }), L("pty", "term", { cmd: ["sh", "-c", "ls -la /usr/bin | head -200; exec sleep 3600"] })] },
      ],
    };
    register({ name: "bench-resize", id: "00000000-0000-4000-8000-0000be4c4e51", revision: 1, spec: { name: "bench-resize", title: "bench-resize", layouts: true, layout: { name: "bench-resize", rule: "current", focus: "hero", root } } } as never);
    const desk = new Desk(undefined, { layout: "bench-resize" });
    app.push(desk);
    // The bench reaches inside: the desk's tiles and borders, App's frame and tick.
    const D = desk as any, A = app as any;

    // Each tile's render, timed by its name; the screen's render.
    const tileMs: Record<string, number> = {};
    const timed = new WeakSet<object>();
    let renderMs = 0;
    const render = desk.render.bind(desk);
    desk.render = (ctx => {
      for (const [id, pane] of D.panes as Map<number, any>) {
        if (timed.has(pane)) continue;
        timed.add(pane);
        const name = D.nameOf(id) as string, draw = pane.render.bind(pane);
        pane.render = (...a: unknown[]) => { const t0 = performance.now(); try { return draw(...a); } finally { tileMs[name] = (tileMs[name] ?? 0) + performance.now() - t0; } };
      }
      const t0 = performance.now();
      try { return render(ctx); } finally { renderMs += performance.now() - t0; }
    }) as typeof desk.render;

    // Settled: `quiet` ms with nothing written (the door paints by itself: an image ready, a tile's output). When it last wrote.
    const settle = async (quiet = 600, max = 30_000) => {
      const t0 = performance.now();
      let last = total, at = t0;
      while (performance.now() - t0 < max && performance.now() - at < quiet) {
        await Bun.sleep(20);
        if (total !== last) { last = total; at = performance.now(); }
      }
      return at;
    };
    await settle(800);
    // The hero note scrolled so its picture has gone under the header: the header draws its backdrop.
    const hero = [...D.panes.values()].find((p: any) => p.msg?.id === n.hero.id);
    if (!hero) throw new Error("the hero note isn't on the desk");
    hero.surface.scrollBy(14, false);
    app.redraw();
    await settle(800);

    // The first border of the row: between the hero and the pictures/figures column.
    const div = (D.dividers as any[]).find(d => d.node.dir === "row" && d.i === 0 && d.area.cols === cfg.cols);
    if (!div) throw new Error(`no top-level border (${(D.dividers as any[]).map(d => `${d.node.dir}${d.i}@${d.at}`).join(" ")})`);
    const y = div.area.row + Math.floor(div.area.rows / 2), x0 = div.at;

    // Every frame App paints while recording, timed and counted; the tick's time too.
    const frames: Frame[] = [];
    let recording = false, layoutPending = 0, tickMs = 0, rss = process.memoryUsage().rss;
    const drawFrame = A.drawFrame.bind(app), tick = A.tick.bind(app);
    A.drawFrame = () => {
      if (!recording) return drawFrame();
      written = ""; renderMs = 0;
      for (const k of Object.keys(tileMs)) delete tileMs[k];
      const t0 = performance.now();
      try { drawFrame(); } finally {
        frames.push({ ms: performance.now() - t0 + layoutPending, layoutMs: layoutPending, renderMs, tiles: { ...tileMs }, bytes: written.length, ...kittyCounts(written) });
        layoutPending = 0;
        rss = Math.max(rss, process.memoryUsage().rss);
      }
    };
    A.tick = () => { const t0 = performance.now(); try { return tick(); } finally { if (recording) tickMs += performance.now() - t0; } };
    // One chunk of input: every report in it handled, then the chunk's one paint (App.batched).
    const chunk = (reports: { action: string; x: number }[]) => batch(() => {
      const t0 = performance.now();
      for (const r of reports) keyHandler({ kind: "mouse", action: r.action, button: 0, x: r.x, y });
      layoutPending += performance.now() - t0;
    });

    chunk([{ action: "down", x: x0 }]);
    if (!D.drag) throw new Error(`pressing ${x0},${y} didn't grab the border`);
    await Bun.sleep(50);
    const path = [...Array.from({ length: o.span }, (_, i) => x0 + i + 1), ...Array.from({ length: o.span + Math.ceil(o.span / 2) }, (_, i) => x0 + o.span - i - 1)];
    const gap = 1000 / o.hz, lag: number[] = [];
    const w0 = { ...mediaWork };
    recording = true;
    const cpu0 = process.cpuUsage(), wall0 = performance.now();
    for (let next = 0; next < path.length;) {
      const due = wall0 + next * gap;
      if (performance.now() < due) { await Bun.sleep(due - performance.now()); continue; }
      const reports: { action: string; x: number }[] = [];
      while (next < path.length && wall0 + next * gap <= performance.now()) reports.push({ action: "drag", x: path[next++]! });
      const oldest = wall0 + (next - reports.length) * gap;
      chunk(reports);
      // How long the oldest report in the chunk waited to be on screen.
      lag.push(performance.now() - oldest);
      await Bun.sleep(0);
    }
    const cpu = process.cpuUsage(cpu0);
    const drag = frames.splice(0), scaled = mediaWork.scaled - w0.scaled, grids = mediaWork.grids - w0.grids;

    // Let go, and what it finishes.
    const w1 = { ...mediaWork }, s0 = performance.now();
    chunk([{ action: "up", x: path.at(-1)! }]);
    const settled = await settle(600);
    const after = frames.splice(0);
    recording = false;

    const sumOf = (fs: Frame[], k: keyof Frame) => fs.reduce((a, f) => a + (f[k] as number), 0);
    if (o.frames) for (const [i, f] of drag.entries()) console.error(`${label(cfg)} #${i} ${r1(f.ms)}ms · layout ${r1(f.layoutMs)} · render ${r1(f.renderMs)} (${Object.entries(f.tiles).map(([k, v]) => `${k} ${r1(v)}`).join(", ")}) · ${f.bytes}B · up ${f.uploads} (${f.uploadBytes}B) · place ${f.places} · del ${f.deletes}`);
    const ms = drag.map(f => f.ms), each = (k: keyof Frame) => r1(sumOf(drag, k) / Math.max(1, drag.length));
    const tiles: Record<string, number> = {};
    for (const f of drag) for (const [k, v] of Object.entries(f.tiles)) tiles[k] = (tiles[k] ?? 0) + v;
    for (const k of Object.keys(tiles)) tiles[k] = r1(tiles[k]! / Math.max(1, drag.length));
    const out: Summary = {
      config: label(cfg), frames: drag.length, reports: path.length, p50: r1(pct(ms, 50)), p95: r1(pct(ms, 95)), max: r1(Math.max(0, ...ms)), over16: ms.filter(m => m > 16).length,
      lagP95: r1(pct(lag, 95)), layoutMs: each("layoutMs"), renderMs: each("renderMs"), tiles,
      bytes: sumOf(drag, "bytes"), bytesPerFrame: Math.round(sumOf(drag, "bytes") / Math.max(1, drag.length)), uploads: sumOf(drag, "uploads"), uploadBytes: sumOf(drag, "uploadBytes"), places: sumOf(drag, "places"), deletes: sumOf(drag, "deletes"), scaled, grids,
      tickMs: r1(tickMs), cpuMs: r1((cpu.user + cpu.system) / 1000), rssMB: r1(rss / 1048576), ms: ms.map(r1), lag: lag.map(r1),
      settle: { ms: r1(settled - s0), frames: after.length, bytes: sumOf(after, "bytes"), uploads: sumOf(after, "uploads"), uploadBytes: sumOf(after, "uploadBytes"), scaled: mediaWork.scaled - w1.scaled, grids: mediaWork.grids - w1.grids },
    };
    D.dispose?.();
    A.closed = true;
    board.close();
    return out;
  } finally {
    await scratch.dispose();
  }
}

function table(rows: Summary[]): string {
  const head = ["config", "frames", "p50", "p95", "max", ">16ms", "lag p95", "layout", "render", "KB/frame", "uploads", "upload KB", "place/del", "scaled", "grids", "cpu ms", "rss MB", "settle ms", "settle up", "settle scaled"];
  const lines = rows.map(s => [s.config, `${s.frames}/${s.reports}`, s.p50, s.p95, s.max, s.over16, s.lagP95, s.layoutMs, s.renderMs, r1(s.bytesPerFrame / 1024), s.uploads, r1(s.uploadBytes / 1024), `${s.places}/${s.deletes}`, s.scaled, s.grids, s.cpuMs, s.rssMB, s.settle.ms, s.settle.uploads, s.settle.scaled + s.settle.grids].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...lines.map(l => l[i]!.length)));
  const fmt = (l: string[]) => l.map((c, i) => c.padStart(w[i]!)).join("  ");
  const tiles = rows.map(s => `  ${s.config}: ${Object.entries(s.tiles).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  return [fmt(head), ...lines.map(fmt), "", "render ms a frame, by tile:", ...tiles].join("\n");
}

if (import.meta.main) {
  const o = { span: Number(opt("span", "20")), hz: Number(opt("hz", "60")), frames: flag("frames") };
  const one = opt("one", "");
  if (one) {
    // A child: one run, its summary as the last line of stdout.
    console.log(JSON.stringify(await runOne(parse(one), o)));
    process.exit(0);
  }
  const configs = opt("only", "") ? opt("only", "").split(",").map(parse) : CONFIGS;
  const runs = Math.max(1, Number(opt("runs", "3")));
  const results: Summary[] = [];
  for (const c of configs) {
    const got: Summary[] = [];
    for (let i = 0; i < runs; i++) {
      const p = Bun.spawn(["bun", import.meta.path, "--one", label(c), "--span", String(o.span), "--hz", String(o.hz), ...(o.frames ? ["--frames"] : [])], { stdout: "pipe", stderr: "inherit", env: process.env as Record<string, string> });
      const text = await new Response(p.stdout).text();
      if ((await p.exited) !== 0) { console.error(`bench-resize: ${label(c)} failed`); process.exit(1); }
      got.push(JSON.parse(text.trim().split("\n").pop()!));
    }
    // The frame times of every run pooled (a run is a few dozen frames: its p95 is its second worst); the rest from the
    // run with the median CPU.
    const mid = got.sort((a, b) => a.cpuMs - b.cpuMs)[Math.floor((got.length - 1) / 2)]!, ms = got.flatMap(g => g.ms), lag = got.flatMap(g => g.lag);
    results.push({ ...mid, frames: ms.length, reports: got.reduce((a, g) => a + g.reports, 0), p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(0, ...ms), over16: ms.filter(m => m > 16).length, lagP95: pct(lag, 95), ms, lag });
    if (!flag("json")) console.error(`bench-resize: ${label(c)} done`);
  }
  console.log(flag("json") ? JSON.stringify(results, null, 2) : table(results));
  if (flag("check") || flag("check-time")) {
    const bad = results.flatMap(s => broken(s, flag("check-time")).map(b => `${s.config}: ${b}`));
    if (bad.length) { console.error(`bench-resize: over budget\n  ${bad.join("\n  ")}`); process.exit(1); }
    console.error("bench-resize: within budget");
  }
}
