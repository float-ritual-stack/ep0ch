// PIE-1720: the plan hub section. Today's plan drawn whole by a query embed, and a ::links whose preview is drawn whole
// (height: fill), both carried by the reader's one scroll. Its seed is PLAN_HUB (seed.ts); its test is
// test/showcase/plan-preview.test.ts.
import { ReaderPane } from "../desk/panes";
import { deskOf, type Section } from "./showcase";

export const PLAN_PREVIEW_SECTION: Section = {
  key: "plan-preview", need: "read today's plan whole on a hub page and scroll it in place", part: "the query embed (`!((query: …))`, outline-core's link grammar; the service answers it in transclusions.read as it does ![[page]]) drawn by the reader's embedRegion, and ::links' height: (rows, or fill) sizing its preview, carried by the reader's one scroll", files: "src/embeds.ts, src/links.ts, outline-core src/link-syntax.ts, src/link-blocks.ts, outliner src/transclusions.ts",
  aside: "a query embed of the newest bakery plan: write a newer one and it moves · a query nothing answers says why (comet=bright, at the foot) · the wheel scrolls the note, the keys stay in it · the ::links below with height: fill previews the plan whole, no '⋮ more rows'",
  stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · plan preview", panes: [r], names: ["hub"] }, show, [[r, n.planHub]]); },
};
