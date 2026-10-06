import { describe, expect, test } from "bun:test";
import * as Result from "effect/Result";
import { Block, blockJsonSchema, decodeBlock, decodeResponseLine, decodeStatus, decodeStatusAll, decodeStatusResult, encodeBlock, PROTOCOL } from "../src/protocol";
import type { Block as WireBlock } from "@ep0ch/outline-core/protocol";

const block = {
  id: "b1", parentId: null, position: 0, text: "Seed order [type::errand]", revision: 3, author: "agent" as const, actorId: "tidy",
  createdAt: "2026-10-06T10:00:00.000Z", updatedAt: "2026-10-06T10:00:00.000Z", properties: [{ key: "type", value: "errand" }],
};

describe("the wire, as Schema", () => {
  test("the schema's Type is outline-core's interface, both ways", () => {
    const decoded: WireBlock = decodeBlock(block);        // Schema type → outline-core interface
    const back: typeof Block.Type = decoded;              // outline-core interface → Schema type
    expect(back).toEqual(block);
    expect(encodeBlock(decoded)).toEqual(block);
  });

  test("a line of the socket is parsed and checked in one step; a bad one names the path", () => {
    expect(decodeResponseLine('{"id":"7","ok":true,"result":{"n":1},"sequence":12}')).toEqual({ id: "7", ok: true, result: { n: 1 }, sequence: 12 });
    expect(decodeResponseLine('{"id":"7","ok":false,"error":"stale revision","sequence":12}')).toMatchObject({ ok: false, error: "stale revision" });
    expect(() => decodeResponseLine('{"id":"7","ok":true,"result":1}')).toThrow(/Missing key[\s\S]*\["sequence"\]/);
    expect(() => decodeResponseLine("not json")).toThrow(/JSON/);
    expect(() => decodeBlock({ ...block, properties: [{ key: "type" }] })).toThrow(/Missing key[\s\S]*\["properties"\]\[0\]\["value"\]/);
  });

  test("a protocol mismatch is refused while decoding ping, in outline-core's words", () => {
    const status = { status: "ready", protocolVersion: PROTOCOL, outline: { name: "jam-shelf" } };
    expect(decodeStatus(status).protocolVersion).toBe(PROTOCOL);
    expect(() => decodeStatus({ ...status, protocolVersion: PROTOCOL + 1 })).toThrow(`this client speaks protocol ${PROTOCOL} and the outline host protocol ${PROTOCOL + 1}: update the client (ep0ch install --apply) and restart it`);
    expect(() => decodeStatus({ ...status, protocolVersion: PROTOCOL - 1 })).toThrow("restart the outline host on current code");
    const r = decodeStatusResult({ ...status, protocolVersion: "97" });
    expect(Result.isFailure(r)).toBe(true);
    expect(() => decodeStatusAll({ status: "busy", protocolVersion: PROTOCOL + 1 })).toThrow(/"ready"[\s\S]*protocol/);
  });

  test("the JSON Schema is derived, not written a second time", () => {
    const doc = JSON.parse(JSON.stringify(blockJsonSchema()));   // as a tool definition would carry it
    expect(doc.dialect).toBe("draft-2020-12");
    expect(doc.schema.type).toBe("object");
    expect(doc.schema.required.sort()).toEqual(["author", "createdAt", "id", "parentId", "position", "properties", "revision", "text", "updatedAt"]);
    expect(doc.schema.properties.author).toEqual({ type: "string", enum: ["user", "agent", "system"] });
    expect(doc.schema.properties.parentId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(doc.schema.properties.properties.items.required).toEqual(["key", "value"]);
  });
});
