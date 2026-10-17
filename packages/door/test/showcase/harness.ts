// The showcase screen's test harness: a scratch service seeded with the showcase, the door's App over it and the
// Showcase screen pushed, as the door does at start. Each test file calls `useShowcaseScreen()` inside its describe.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { afterAll, beforeAll, describe, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import { MainMenu } from "../../src/screens";
import { seedShowcase, type Seeded } from "../../src/showcase/seed";
import { Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { type Key } from "../../src/term";
import { Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");


export interface ShowcaseScreen {
  scratch: Scratch; board: SocketBoard; app: App; sc: Showcase; seeded: Seeded;
  /** Everything the terminal was written. */
  written: string[];
  /** The last frame the door painted. */
  painted: string[];
  press: (k: Key) => void;
  ch: (c: string) => void;
  /** The showcase screen as text. */
  screen: () => string;
  S: () => any;
}

export function useShowcaseScreen(): ShowcaseScreen {
  const scratch = new Scratch();
  const written: string[] = [];
  let key: (k: Key) => void = () => {};
  const h = { scratch, written, painted: [] as string[] } as ShowcaseScreen;
  h.press = (k: Key) => key(k);
  h.ch = (c: string) => h.press({ kind: "char", ch: c });
  h.screen = () => h.sc.render(h.app).lines.map(plain).join("\n");
  h.S = () => h.sc as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    // e arms the edit here, as in the door (test/preload.ts turns it off): ⏎ opens it.
    process.env.EP0CH_EDIT_ARM = "60000";
    await scratch.start();
    h.seeded = await scratch.seedShowcase();
    h.board = new SocketBoard(scratch.sock);
    await h.board.info();
    const term = { info: { cols: 200, rows: 90, cellW: 9, cellH: 16, kitty: false }, write(s: string) { written.push(s); }, paint(l: string[]) { h.painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    h.app = new App(term as any, h.board, Date.now(), () => {});
    h.board.subscribe(e => h.app.event(e));
    // As the door does at start: the extensions and rules the service lists (the seed installed the example rules).
    await h.app.loadExtensions(true);
    h.sc = new Showcase();
    h.app.push(new MainMenu()); h.app.push(h.sc);
    await until(() => !!h.S().notes, "the showcase outline", 8000);
    // A first frame, as the door draws one before anyone presses a key.
    h.screen();
  }, 30_000);
  afterAll(async () => { h.board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; process.env.EP0CH_EDIT_ARM = "off"; });
  return h;
}
