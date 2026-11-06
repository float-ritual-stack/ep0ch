// PIE-1602: a tile the service draws slowly. It asks one drawing at a time however busy the outline is, so a slow script
// never stacks workers; and when the drawing is cut off, the reason fits the tile it's in.
// Fictional tile; no host: the drawing is a promise the test settles.
import { expect, test } from "bun:test";
import type { DeskApi } from "../src/desk/panes";
import { ServiceTile, type ServiceFrame } from "../src/desk/tile-kinds";
import { RELOAD_PAUSE_MS } from "../src/search-schedule";

const desk = { redraw() {} } as unknown as DeskApi;
const settled = () => Bun.sleep(1);

function tile() {
  const asks: { resolve: (f: ServiceFrame) => void; reject: (e: Error) => void }[] = [];
  const t = new ServiceTile("hens.sheet" as never, () => new Promise<ServiceFrame>((resolve, reject) => { asks.push({ resolve, reject }); }));
  return { t, asks };
}

test("a change while it draws asks once more when the drawing ends, not beside it", async () => {
  const { t, asks } = tile();
  t.render(40, 10, false, desk);
  expect(asks.length).toBe(1);
  // Three more reasons to ask while the first is still drawing.
  t.refresh(desk, 40, 10); t.refresh(desk, 40, 10); t.refresh(desk, 40, 10);
  expect(asks.length).toBe(1);
  asks[0]!.resolve({ title: "old", lines: ["old drawing"] });
  await settled();
  expect(asks.length).toBe(2);
  asks[1]!.resolve({ title: "new", lines: ["new drawing"] });
  await settled();
  expect(asks.length).toBe(2);
  expect(t.render(40, 10, false, desk).lines.join("\n")).toContain("new drawing");
});

test("a drawing that fails lets the next one go", async () => {
  const { t, asks } = tile();
  t.render(40, 10, false, desk);
  asks[0]!.reject(new Error("the hens are out"));
  await settled();
  expect(t.render(40, 10, false, desk).lines.join(" ")).toContain("the hens are out");
  t.refresh(desk, 40, 10);
  expect(asks.length).toBe(2);
  asks[1]!.resolve({ title: "back", lines: ["the hens are in"] });
  await settled();
  const drawn = t.render(40, 10, false, desk).lines.join(" ");
  expect(drawn).toContain("the hens are in");
  expect(drawn).not.toContain("the hens are out");
});

test("closed while it draws with another asked for: the next drawing never starts, and nothing redraws", async () => {
  const { t, asks } = tile();
  let redraws = 0;
  const counting = { redraw() { redraws++; } } as unknown as DeskApi;
  t.render(40, 10, false, counting);
  t.refresh(counting, 40, 10);
  t.dispose();
  asks[0]!.resolve({ title: "late", lines: ["late drawing"] });
  await settled();
  expect(asks.length).toBe(1);
  expect(redraws).toBe(0);
});

test("closed with a change's refresh still waiting for its pause: it never asks", async () => {
  const { t, asks } = tile();
  t.render(40, 10, false, desk);
  asks[0]!.resolve({ title: "drawn", lines: ["drawn"] });
  await settled();
  t.onEvent(desk);
  t.dispose();
  await Bun.sleep(RELOAD_PAUSE_MS + 50);
  expect(asks.length).toBe(1);
});

test("closed, a late refresh asks nothing", async () => {
  const { t, asks } = tile();
  t.dispose();
  t.refresh(desk, 40, 10);
  expect(asks.length).toBe(0);
});

test("a cut-off's reason reads whole in a narrow tile", async () => {
  const { t, asks } = tile();
  t.render(30, 10, false, desk);
  asks[0]!.reject(new Error("drawing took too long: it ran past its 15 s budget and was stopped"));
  await settled();
  const lines = t.render(30, 10, false, desk).lines;
  expect(lines.every(line => line.length <= 30)).toBe(true);
  expect(lines.join(" ").replace(/\s+/g, " ")).toContain("drawing took too long: it ran past its 15 s budget and was stopped");
});
