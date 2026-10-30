// One owner path for attached tiles (PIE-1448): a reader's comment, Sources and previews and a facets tile's Matches all
// go through AttachedOwner. The attached tile never asks what kind of tile its owner is or which attachment it holds, so
// a second way of deciding (the hydra #1085's review found) can't grow back: the source is held to it, and a made-up
// owner works with no change to the tile.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AttachedTilePane, type AttachedOwner } from "../src/desk/attached-tile";
import type { DeskApi, Pane } from "../src/desk/panes";

test("the attached tile decides nothing by its owner's kind or its attachment's name", () => {
  const src = readFileSync(join(import.meta.dir, "../src/desk/attached-tile.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*\*[\s\S]*?\*\//g, "");
  const cls = src.slice(src.indexOf("export class AttachedTilePane"), src.indexOf("export const COMMENT_TILE"));
  expect(cls).not.toMatch(/instanceof|ReaderPane|FacetsPane|\.surface\b/);
  expect(cls).not.toMatch(/attachment\s*[!=]==/);
});

test("any owner draws, keys and moves its attachment through the tile", () => {
  const seen: string[] = [];
  const parts: AttachedOwner = {
    attachedView: (a, w, h) => ({ lines: Array.from({ length: h }, (_, i) => `${a} row ${i}`.padEnd(w)) }),
    attachedKey: (a, k) => { seen.push(`key ${a} ${k.kind}`); return true; },
    attachedMouse: (a, k) => { seen.push(`mouse ${a} ${k.action}`); return true; },
    attachedTitle: (a, source) => `${a} of ${source}`, attachedHint: () => "hint",
    attachedSide: (a, side) => { seen.push(`side ${a} ${side}`); }, attachedSideWords: () => "beside it",
    attachedTileIs: (a, tile) => { seen.push(`tile ${a} ${tile ? "set" : "gone"}`); },
  };
  const owner = { kind: "made-up", title: () => "owner", hint: () => "", render: () => ({ lines: [] }), key: () => false, ...parts } as unknown as Pane & AttachedOwner;
  const desk = { paneNamed: (n: string) => (n === "owner" ? owner : undefined), dismiss() {} } as unknown as DeskApi;
  const tile = new AttachedTilePane("owner", "matches");
  const v = tile.render(60, 4, true, desk);
  expect(v.lines.slice(0, 3)).toEqual(["matches row 0", "matches row 1", "matches row 2"].map(l => l.padEnd(60)));
  expect(v.lines[3]).toContain("beside it");
  expect(tile.title()).toBe("matches of owner");
  expect(tile.key({ kind: "char", ch: "j" }, desk)).toBe(true);
  const at = v.lines[3]!.replace(/\x1b\[[\d;]*m/g, "").indexOf("[right");
  tile.mouse({ kind: "mouse", action: "up", button: 0, x: at + 1, y: 3 } as never, at + 1, 3, desk);
  expect(seen).toEqual(["tile matches set", "key matches char", "side matches right"]);
});
