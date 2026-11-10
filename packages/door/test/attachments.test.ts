// The attached surface as one layer (PIE-1536): a made-up attachment supplies only its state, drawing and words, and the
// layer places it (split, float, popup, tile), layers it, sizes its split, moves its float and hands it to a tile. The
// reader's own kinds go through the same layer: no per-kind placement code is left in note.ts.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTACHMENT_KINDS, Attachments, attachmentKinds, declareAttachmentKinds, type AttachedState, type AttachmentDef, type AttachmentHost, type AttachmentKind } from "../src/surface/attachments";
import type { AttachedSide } from "../src/surface/attached";
import { bindExtensions } from "../src/extensions";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

function made(kind: AttachmentKind = "sources", keys = { held: false }) {
  const state: AttachedState = { place: "split", float: null };
  const def: AttachmentDef = {
    kind, noun: "gizmo", owner: () => state,
    draw: (cols, rows) => ({ lines: Array.from({ length: rows }, (_, i) => `g${i}`.padEnd(cols, "g")) }),
    holdsKeys: () => keys.held, tileKeys: () => true,
    actions: { place: "gizmo.place", move: "gizmo.move" }, closed: "open the gizmo first",
    chip: () => ({ col: 0, row: 0 }),
  };
  return { state, def };
}

function host(tiles = true) {
  const asked: { kind: AttachmentKind; on: boolean; side?: AttachedSide; keys?: boolean }[] = [];
  const h: AttachmentHost = {
    redraw() {}, ctx: { flash() {} },
    ...(tiles ? { attachedTile: async (kind: AttachmentKind, on: boolean, side?: AttachedSide, keys?: boolean) => { asked.push({ kind, on, side, keys }); }, hasAttachedTile: () => true } : {}),
  };
  return { h, asked };
}

const note = (cols: number, rows: number) => ({ lines: Array.from({ length: rows }, () => ".".repeat(cols)) });

test("a made-up attachment is placed, layered, split, moved and tiled by the layer alone", async () => {
  const { state, def } = made();
  const layer = new Attachments([def]);
  const { h, asked } = host();

  // Split: beside the note when the reader is wide, its divider dragged to size it.
  layer.begin();
  let v = layer.compose(layer.layered(h), 160, 20, h, note);
  expect(plain(v.lines[0]!)).toMatch(/^\.+│g0g+$/);
  const edge = layer.splitDrawn[0]!.edge;
  expect(layer.divider(edge, 3)?.target).toBe("sources");
  layer.split("sources", "down", .3);
  layer.begin();
  v = layer.compose(layer.layered(h), 160, 20, h, note);
  expect(plain(v.lines[0]!)).toBe(".".repeat(160));
  expect(v.lines.some(l => plain(l).startsWith("─"))).toBe(true);

  // Floating: framed over the note, its title the kind's noun, its top edge a grip, moved inside the reader.
  expect(await layer.put("sources", "floating", h)).toBe("floating");
  layer.begin();
  v = layer.compose(layer.layered(h), 80, 20, h, note);
  expect(v.lines.join("\n")).toContain("gizmo · ≡ move");
  const at = state.frame!;
  expect(layer.at(at.col + 2, at.row + 2)).toBe("sources");
  expect(layer.grip(at.col + 2, at.row)?.zone.kind).toBe("move");
  expect(layer.move("sources", { col: 10, row: 3, cols: 30, rows: 8 }, h as never)).toEqual({ col: 10, row: 3, cols: 30, rows: 8 });
  const moved = layer.move("sources", { dx: -4, dy: 1 }, h as never)!;
  expect(moved).toEqual({ col: 6, row: 4, cols: 30, rows: 8 });
  layer.begin();
  layer.compose(layer.layered(h), 80, 20, h, note);
  expect(state.frame).toEqual(moved);

  // Popup: centred, no grip.
  await layer.put("sources", "popup", h);
  layer.begin();
  layer.compose(layer.layered(h), 80, 20, h, note);
  expect(layer.grip(state.frame!.col + 2, state.frame!.row)).toBeNull();

  // Tile: the host's one hand-off, with the kind's keys; drawn by the kind in the tile's cells, gone from the reader.
  await layer.put("sources", undefined, h, "right");
  expect(state.place).toBe("tile");
  expect(asked).toEqual([{ kind: "sources", on: true, side: "right", keys: true }]);
  expect(layer.layered(h)).toEqual([]);
  expect(layer.tile("sources", 30, 4)!.lines).toEqual(["g0", "g1", "g2", "g3"].map(l => l.padEnd(30, "g")));
  await layer.put("sources", "inline", h);
  expect(asked.at(-1)).toMatchObject({ kind: "sources", on: false });
});

test("the one holding the keys is laid last and takes the pointer first", async () => {
  const a = made("sources", { held: false }), b = made("settings", { held: true });
  const layer = new Attachments([b.def, a.def]);
  const { h } = host(false);
  a.state.place = b.state.place = "popup";
  layer.begin();
  layer.compose(layer.layered(h), 80, 24, h, note);
  const r = b.state.frame!;
  expect(layer.at(r.col + 3, r.row + 3)).toBe("settings");
  // Without tiles round it there's no tile to go to: refused, saying the nearest.
  await expect(layer.put("sources", "tile", h)).rejects.toThrow("split shares the reader");
});

test("note.ts keeps no placement code of its own for an attachment", () => {
  const src = readFileSync(join(import.meta.dir, "../src/surface/note.ts"), "utf8");
  // Geometry, float frames and tiles are the layer's: the reader asks it, never draws or sizes one itself.
  expect(src.match(/drawAttachedFloat\(/g)?.length ?? 0).toBe(1); // the comment's box, placed by its passage
  expect(src).not.toMatch(/new AttachedTile\(|renderBeside|placeSources|placeListPreview|placeEditPreview|splitAttachment|settingsTile\(|sourcesTile\(/);
});

test("binding the host's list declares the kinds of the extensions it says it serves, and only those", () => {
  const entry = (id: string, serving: boolean) => ({ id, name: id, version: 1, state: serving ? "active" : "disabled", serving, handlers: [], actions: [], agents: [], tiles: [], bar: [], completion: [], attachments: [{ kind: `${id}.pins`, noun: "pins", render: "pins" }] });
  const list = (...e: ReturnType<typeof entry>[]) => ({ extensions: e, tileKinds: [], rules: [], ruleProblems: [], available: [], resourceProviders: [], pages: {}, demos: {}, about: {} }) as never;
  try {
    bindExtensions(list(entry("pinboard", true), entry("idle", false)));
    expect(attachmentKinds()).toEqual([...ATTACHMENT_KINDS, "pinboard.pins"]);
  } finally { bindExtensions(null); }
  expect(attachmentKinds()).toEqual([...ATTACHMENT_KINDS]);
});

test("a served extension's record declares an attachment kind; an unknown one is refused once, with why (Nov 3 review card 16, ledger H)", async () => {
  const { def } = made("sources");
  const gizmo = made("pinboard.pins");
  const layer = new Attachments([def, gizmo.def]);
  const { h } = host(false);
  try {
    // Not declared yet: the boundary refuses it and says what is known and where a new one comes from.
    expect(() => layer.kind("pinboard.pins")).toThrow(/no attachment kind[\s\S]*comment, sources[\s\S]*manifest's attachments/);
    expect(() => layer.kind("nonsense")).toThrow("no attachment kind");
    declareAttachmentKinds([{ kind: "pinboard.pins", noun: "pins", render: "pins" }, { kind: "sources", noun: "shadow", render: "x" }]);
    expect(layer.kind("pinboard.pins")).toBe("pinboard.pins");
    expect(attachmentKinds()).toEqual([...ATTACHMENT_KINDS, "pinboard.pins"]);
    // The layer places it like any: no placement code of its own.
    expect(await layer.put("pinboard.pins", "floating", h)).toBe("floating");
    // Stopped being served: refused again.
    declareAttachmentKinds([]);
    expect(() => layer.kind("pinboard.pins")).toThrow("no attachment kind");
    expect(layer.kind("sources")).toBe("sources");
  } finally { declareAttachmentKinds([]); }
});
