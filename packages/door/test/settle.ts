// When the door is settled for a probe (test/parity.ts): no answer from an outline host is awaited, whichever way it
// was asked (src/socket.ts hostTraffic: a board's request, hostRequest), and nothing the screen says it's still asking
// for (`busy`: the power bar's sources, one of which waits for typing to pause before it asks). `settle()` waits, at
// most 3 s, until neither is, woken when the last answer comes; `tick` runs before each look (the walk's fake clock running its
// pauses out). `asked()` counts the round trips since `watchHosts()`.
import { livePrograms, type PtyPane } from "../src/desk/pty";
import { hostsIdle, hostTraffic } from "../src/socket";

export function watchHosts(busy: () => boolean = () => false, tick: () => void = () => {}) {
  const from = hostTraffic.asked;
  const settle = async () => {
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
    const end = Date.now() + 3000;
    for (tick(); (hostTraffic.waiting > 0 || busy()) && Date.now() < end; tick()) {
      // Woken by the last answer, or after 10 ms to look at busy() again; never past the end (one timer at a time).
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([...(hostTraffic.waiting > 0 ? [hostsIdle()] : []), new Promise<void>(r => { timer = setTimeout(r, Math.max(0, Math.min(end - Date.now(), hostTraffic.waiting > 0 ? 3000 : 10))); })]);
      clearTimeout(timer);
      await Bun.sleep(0);
    }
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
  };
  return { settle, asked: () => hostTraffic.asked - from };
}

/**
 * A terminal tile is settled for a probe too (PIE-1811). Two things about one are on a wall clock the walk doesn't run:
 * a program that exits by itself (the walk's $EDITOR is `true`, and the daily layout's draft tile runs it in every build)
 * has exited when the box gets to it, in 2 ms alone and in 20 on a busy night; and the tile draws what its program did "soon",
 * on a 16 ms timer of its own (PtyPane.soon), not when it happened. A build looked at before either is another screen than
 * one looked at after (its title's `· exited 0`, its last row's `[true exited 0] …`), and the walk compares builds.
 * `exits` says which programs exit by themselves; `drew` is told each tile a paint draws; `clear` starts a new build.
 * `settle()` waits those programs out (3 s at most) and makes the repaint a tile asked for now: true when one was asked.
 */
export function watchTerminals(exits: (p: PtyPane) => boolean) {
  const drawn = new Set<PtyPane>();
  /** What the walk reaches into a tile for: its "soon" timer, the desk it asks, and its emulator. */
  type Inside = { redrawSoon: ReturnType<typeof setTimeout> | null; desk: { redraw(): void } | null; term: { write(data: string, done: () => void): void } | null };
  return {
    drew(p: PtyPane) { drawn.add(p); },
    clear() { drawn.clear(); },
    async settle(): Promise<boolean> {
      // A program that ended is taken off the live ones as the tile hears of it (PtyPane.ended), which is when it asks for its repaint.
      for (const end = Date.now() + 3000; Date.now() < end && livePrograms().some(p => drawn.has(p) && exits(p));) await Bun.sleep(1);
      let asked = false;
      for (const p of drawn) {
        const t = p as unknown as Inside;
        if (!t.redrawSoon) continue;
        // After the emulator has read all the program wrote: the tile's status hears of an exit only then (PtyPane.ended).
        const term = t.term;
        if (term) await new Promise<void>(done => term.write("", done));
        if (t.redrawSoon) { clearTimeout(t.redrawSoon); t.redrawSoon = null; }
        t.desk?.redraw();
        asked = true;
      }
      return asked;
    },
  };
}
