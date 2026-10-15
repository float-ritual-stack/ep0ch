import { expect, test } from "bun:test";
import { bookkeepingOnly, isMachinery, machineryAllows, parseMachineryMode } from "../src/machinery";

test("a stamped block is machinery, an unstamped one is not, and the modes say who is let through", () => {
  expect(isMachinery([{ key: "machine", value: "echonet" }, { key: "type", value: "toss" }])).toBe(true);
  expect(isMachinery([{ key: "type", value: "toss" }])).toBe(false);
  expect(isMachinery([{ key: "machine", value: " " }])).toBe(false);
  expect([machineryAllows("hide", true), machineryAllows("hide", false)]).toEqual([false, true]);
  expect([machineryAllows("only", true), machineryAllows("only", false)]).toEqual([true, false]);
  expect([machineryAllows("show", true), machineryAllows("show", false)]).toEqual([true, true]);
});

test("the mode defaults to hide, and a wrong one says what is allowed", () => {
  expect(parseMachineryMode(undefined)).toBe("hide");
  expect(parseMachineryMode("only")).toBe("only");
  expect(() => parseMachineryMode("none")).toThrow("hide, only or show");
});

test("a revision that only moved property tokens is bookkeeping; one that changed words is not", () => {
  expect(bookkeepingOnly("Mend the gate [work-stage::doing] [priority::high]", "Mend the gate [work-stage::review] [priority::high]")).toBe(true);
  expect(bookkeepingOnly("Mend the gate [work-stage::doing]", "Mend the gate [work-stage::doing] [done-at::today]")).toBe(true);
  expect(bookkeepingOnly("Mend the gate [work-stage::doing]", "Mend the fence [work-stage::doing]")).toBe(false);
  expect(bookkeepingOnly("same", "same")).toBe(false);
});
