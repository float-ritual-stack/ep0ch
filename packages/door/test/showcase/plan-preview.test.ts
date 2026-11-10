// PIE-1720: the showcase's plan hub. A query embed draws the newest bakery plan whole and moves to a newer one when it
// is written; the same plans as a ::links with height: fill preview the plan whole. Driven through act, as an agent
// would; the harness (harness.ts) seeds a scratch outline and opens the screen on it. Made-up plans only.
import { beforeAll, describe, expect, test } from "bun:test";
import type { App } from "../../src/app";
import type { SocketBoard } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: plan preview (PIE-1720)", () => {
  const h = useShowcaseScreen(44);
  const { screen } = h;
  let board!: SocketBoard, app!: App;
  beforeAll(() => { ({ board, app } = h); });

  test("the hub draws the newest plan whole by its query, scrolls through it in place, and follows a newer plan", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "plan-preview" }, as: "test-agent" });
    await until(() => screen().includes("Bakery plan, 2026-03-03") && screen().includes("tray 1: rye"), "the newest plan, embedded by its query");
    expect(screen()).not.toContain("Bakery plan, 2026-03-02");
    // The reader's one scroll carries the embed and the list's whole preview: to the end, no '⋮ more rows'.
    for (let i = 0; i < 40 && !screen().includes("tray 40: barm cakes"); i++) await app.act({ action: "scroll", args: { by: 3 }, tile: "hub", as: "test-agent" });
    expect(screen()).toContain("tray 40: barm cakes");
    for (let i = 0; i < 40 && !/MATCHES|matches/.test(screen()); i++) await app.act({ action: "scroll", args: { by: 3 }, tile: "hub", as: "test-agent" });
    await until(() => screen().includes("MATCHES") || screen().includes("matches"), "the list under the embed");
    expect(screen()).not.toContain("more rows");
    // PIE-1723: the aside's last promise, held by the seed: the query nothing answers says why, with the nearest keys.
    // At the foot, under the list's whole preview: scrolled to as the preview's rows arrive.
    await until(() => { void app.act({ action: "scroll", args: { to: "end" }, tile: "hub", as: "test-agent" }); return /no notes have comet/.test(screen().replace(/[\s│┊▌]+/g, " ")); }, "the empty query's reason").catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    // A newer plan is written: the embed moves to it on its own.
    await board.createBlock(null, "Bakery plan, 2026-03-04 [type::showcase-plan] [day::2026-03-04]\n## Ovens\n- [ ] tray 1: brioche");
    await app.act({ action: "scroll", args: { to: "top" }, tile: "hub", as: "test-agent" });
    await until(() => screen().includes("Bakery plan, 2026-03-04") && screen().includes("tray 1: brioche"), "the embed following the newer plan");
  }, 60_000);
});
