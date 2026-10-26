// PIE-1286: the one grammar tile= reads for a tile beyond the screen asking: an exact id (or its 8+ character prefix), a
// role, a slot on a screen, a relative ^, then a name. Pure: the desk lists its tiles, this says which one an address means.
import { describe, expect, test } from "bun:test";
import { parseTileAddress, resolveAddress, resolveRelative, whyNone, type AddressCandidate } from "../src/desk/tile-address";

const tile = (id: string, name: string, role: string, o: Partial<AddressCandidate<string>> = {}): AddressCandidate<string> =>
  ({ value: name, id, name, role, slots: [], screen: "desk", where: `@desk/${name}`, ...o });
const TILES = [
  tile("t-3a4f9c21-0000-4000-8000-000000000001", "tree", "tree", { slots: ["tree"] }),
  tile("t-3a4f9c21-0000-4000-8000-000000000002", "notes", "reader", { slots: ["detail"], from: "t-3a4f9c21-0000-4000-8000-000000000001" }),
  tile("t-77aa1100-0000-4000-8000-000000000003", "shell", "agent", { screen: "library", where: "@library/shell", from: "t-gone0000-0000-4000-8000-000000000009" }),
];

describe("parseTileAddress", () => {
  test("an id, its 8+ character prefix, a role with a scope, a slot, a relative and a name", () => {
    expect(parseTileAddress("t-3a4f9c21-0000-4000-8000-000000000001")).toMatchObject({ kind: "id" });
    expect(parseTileAddress("t-3a4f9c21")).toMatchObject({ kind: "id", id: "t-3a4f9c21" });
    expect(parseTileAddress("t-3a4f9c2")).toMatchObject({ kind: "name" });              // 7 characters is not a prefix
    expect(parseTileAddress("role:agent@drawer")).toMatchObject({ kind: "role", role: "agent", scope: "drawer" });
    expect(parseTileAddress("role:reader")).toEqual({ kind: "role", role: "reader", text: "role:reader" });
    expect(parseTileAddress("detail@library")).toMatchObject({ kind: "slot", slot: "detail", screen: "library" });
    expect(parseTileAddress("^")).toMatchObject({ kind: "relative", up: 1 });
    expect(parseTileAddress("^^")).toMatchObject({ kind: "relative", up: 2 });
    expect(parseTileAddress("reader")).toMatchObject({ kind: "name", name: "reader" });
    expect(parseTileAddress("@drawer/shell")).toMatchObject({ kind: "name" });          // a path is the desk's own grammar
    expect(parseTileAddress("group/tile")).toMatchObject({ kind: "name" });
  });
  test("drawer.agent is the alias of role:agent", () => {
    expect(parseTileAddress("drawer.agent")).toMatchObject({ kind: "role", role: "agent" });
  });
});

describe("resolveAddress", () => {
  test("an exact id or a unique prefix names its tile; a shared prefix lists the ids; none is null", () => {
    expect(resolveAddress(parseTileAddress("t-77aa1100"), TILES)?.name).toBe("shell");
    expect(resolveAddress(parseTileAddress(TILES[0]!.id), TILES)?.name).toBe("tree");
    expect(() => resolveAddress(parseTileAddress("t-3a4f9c21"), TILES)).toThrow(/names 2 tiles: @desk\/tree \(t-3a4f9c21-0000-4000-8000-000000000001\), @desk\/notes/);
    expect(resolveAddress(parseTileAddress("t-deadbeef"), TILES)).toBeNull();
  });
  test("a role finds the tile whatever its name or place; scoped, only that screen's", () => {
    expect(resolveAddress(parseTileAddress("role:agent"), TILES)?.name).toBe("shell");
    expect(resolveAddress(parseTileAddress("role:agent@library"), TILES)?.name).toBe("shell");
    expect(resolveAddress(parseTileAddress("role:agent@desk"), TILES)).toBeNull();
    const two = [...TILES, tile("t-aaaa0000-0000-4000-8000-00000000000a", "claude", "agent")];
    expect(() => resolveAddress(parseTileAddress("role:agent"), two)).toThrow(/role:agent names 2 tiles: .*use tile=<id> or role:agent@<screen>/);
    expect(resolveAddress(parseTileAddress("role:agent@desk"), two)?.name).toBe("claude");
  });
  test("a slot is a place on a screen, whatever fills it", () => {
    expect(resolveAddress(parseTileAddress("detail@desk"), TILES)?.name).toBe("notes");
    expect(resolveAddress(parseTileAddress("detail@library"), TILES)).toBeNull();
  });
  test("a name is not decided here: it is the caller's, matched last", () => {
    expect(resolveAddress(parseTileAddress("tree"), TILES)).toBeNull();
  });
});

describe("resolveRelative", () => {
  const up = (sel: string, from?: string) => resolveRelative(parseTileAddress(sel) as never, TILES, from);
  test("^ is the tile that opened the acting one", () => {
    expect(up("^", TILES[1]!.id).name).toBe("tree");
  });
  test("refused with why: no acting tile, nothing recorded, or the opener was closed", () => {
    expect(() => up("^")).toThrow(/relative to the tile you act from/);
    expect(() => up("^", TILES[0]!.id)).toThrow(/names the tile that opened tree, and nothing recorded opening it/);
    expect(() => up("^^", TILES[1]!.id)).toThrow(/nothing recorded opening it/);
    expect(() => up("^", TILES[2]!.id)).toThrow(/the tile that opened shell \(t-gone0000-0000-4000-8000-000000000009\) was closed/);
  });
});

describe("whyNone", () => {
  test("says what to type instead: the roles, the slots, the screens there are", () => {
    expect(whyNone(parseTileAddress("role:nothing"), TILES)).toBe("no tile has the role nothing; roles here: agent, reader, tree");
    expect(whyNone(parseTileAddress("role:agent@nowhere"), TILES)).toContain("no screen nowhere is on show");
    expect(whyNone(parseTileAddress("x@desk"), TILES)).toBe("desk has no slot x; its slots: tree, detail");
    expect(whyNone(parseTileAddress("x@nowhere"), TILES)).toContain("no screen nowhere is on show or mounted here; screens: desk, library");
    expect(whyNone(parseTileAddress("t-deadbeef"), TILES)).toContain("no tile has the id t-deadbeef");
    expect(whyNone(parseTileAddress("t-3a4f0000"), TILES)).toContain("did you mean t-3a4f9c21-0000-4000-8000-000000000001");
    const copied = [...TILES, tile("t-5e5e5e5e-0000-4000-8000-000000000005", "tree2", "tree", { copiedFrom: "t-9d9d9d9d-0000-4000-8000-000000000004" })];
    expect(whyNone(parseTileAddress("t-9d9d9d9d"), copied)).toContain("it was copied to @desk/tree2 (t-5e5e5e5e-0000-4000-8000-000000000005)");
    expect(whyNone(parseTileAddress("tree"), TILES)).toBeNull();
  });
});
