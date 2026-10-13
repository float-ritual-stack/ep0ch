import { expect, test } from "bun:test";
import { workIdTitle } from "../src/work-id-title";

test("a Work ID goes first once; a title that starts with it isn't said twice; none, the title as it is", () => {
  expect(workIdTitle("Mend the gate latch", "HOME-001")).toEqual({ workId: "HOME-001", title: "Mend the gate latch" });
  expect(workIdTitle("HOME-001 — Mend the gate latch", "HOME-001")).toEqual({ workId: "HOME-001", title: "Mend the gate latch" });
  expect(workIdTitle("HOME-001: Mend the gate latch", "HOME-001")).toEqual({ workId: "HOME-001", title: "Mend the gate latch" });
  expect(workIdTitle("HOME-0011 is another", "HOME-001")).toEqual({ workId: "HOME-001", title: "HOME-0011 is another" });
  expect(workIdTitle("Mend the gate latch", undefined)).toEqual({ workId: null, title: "Mend the gate latch" });
});
