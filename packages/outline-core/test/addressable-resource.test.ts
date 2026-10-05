import { describe, expect, test } from "bun:test";
import {
  formatEp0chBlockUri,
  parseAddressedBlock,
  parseBlockRef,
  parseEp0chBlockUri,
} from "../src/addressable-resource";

const ID = "A1111111-1111-4111-8111-111111111111";
const id = ID.toLowerCase();

describe("canonical ep0ch block URI", () => {
  test("formats and parses outline@machine block URIs", () => {
    const uri = formatEp0chBlockUri({ outline: "pie", machine: "float-2", blockId: ID, fragment: "part_1" });
    expect(uri).toBe(`ep0ch://pie@float-2/b/${id}#part_1`);
    expect(parseEp0chBlockUri(uri)).toEqual({ outline: "pie", machine: "float-2", blockId: id, fragment: "part_1" });
  });

  test("percent-encodes URI fields without accepting presentation hints", () => {
    expect(formatEp0chBlockUri({ outline: "pie", machine: "box_a", blockId: id })).toBe(`ep0ch://pie@box_a/b/${id}`);
    expect(() => parseEp0chBlockUri(`ep0ch://pie@box_a/b/${id}?title=Garden`)).toThrow("expected exact");
    expect(() => parseEp0chBlockUri(`ep0ch://pie@box_a/b/${id}#`)).toThrow("fragment");
    expect(() => parseEp0chBlockUri(` ep0ch://pie@box_a/b/${id}`)).toThrow("expected exact");
  });

  test("refuses invalid outline, machine and block ids", () => {
    expect(() => parseEp0chBlockUri(`ep0ch://bad_name@box-a/b/${id}`)).toThrow("outline");
    expect(() => parseEp0chBlockUri(`ep0ch://pie@-box/b/${id}`)).toThrow("machine");
    expect(() => parseEp0chBlockUri("ep0ch://pie@box-a/b/not-a-uuid")).toThrow("block id");
  });
});

describe("shared block reference parser", () => {
  test("parses UUIDs and exact block references", () => {
    expect(parseBlockRef(ID)).toEqual({ blockId: id });
    expect(parseBlockRef(`((${ID}^frag-1))`)).toEqual({ blockId: id, fragment: "frag-1" });
    expect(parseBlockRef(`((${ID}|Readable label))`)).toEqual({ blockId: id });
    expect(parseBlockRef(`((${ID}|Readable (label)))`)).toEqual({ blockId: id });
    expect(() => parseBlockRef(`((${ID}|))`)).toThrow("Invalid block reference");
    expect(() => parseBlockRef(`((${ID}|   ))`)).toThrow("Invalid block reference");
    expect(() => parseBlockRef(`((${ID}|label))junk))`)).toThrow("Invalid block reference");
  });

  test("parses addressed blocks from URI or local reference", () => {
    expect(parseAddressedBlock(`ep0ch://pie@float-2/b/${id}`)).toEqual({ outline: "pie", machine: "float-2", blockId: id });
    expect(parseAddressedBlock(`((${ID}))`)).toEqual({ blockId: id });
    expect(() => parseAddressedBlock(` ep0ch://pie@float-2/b/${id}`)).toThrow("expected exact");
  });
});
