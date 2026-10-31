// PIE-1230: a script's slots written twice are a list everywhere a line is read or written back (the power bar, recall, copied commands).
import { describe, expect, test } from "bun:test";
import { actRequestOf } from "@ep0ch/outline-core/action-line";
import { coerceActionArgs, FREE_ARGS, shownLine, type ArgSpec } from "../src/surface/actions";

const spec: Record<string, ArgSpec> = {
  tone: { type: "string", optional: true, choices: ["warm", "cool"], many: true, about: "a tone" },
  [FREE_ARGS]: { type: "string", optional: true, context: true, about: "slots" },
};

describe("repeated slots", () => {
  test("a line written back repeats the word, so Tab and recall keep a list a list", () => {
    const req = actRequestOf(["neat", "page=meadow", "page=orchard"], { repeats: "list" });
    expect(shownLine("neat", req.args)).toBe("neat page=meadow page=orchard");
    expect(actRequestOf(shownLine("neat", req.args).split(" "), { repeats: "list" }).args).toEqual({ page: ["meadow", "orchard"] });
  });

  test("each value of a repeated choice is checked, not the joined text", () => {
    expect(coerceActionArgs("x", spec, { tone: ["warm", "cool"] })).toEqual({ tone: ["warm", "cool"] });
    expect(() => coerceActionArgs("x", spec, { tone: ["warm", "hot"] })).toThrow(/tone is warm, cool, not hot/);
  });
});
