import { expect, test } from "bun:test";
import { headedTitle, workIdOf, workIdTitle } from "../src/work-id-title";

test("a Work ID goes first once; a title that starts with it isn't said twice; none, the title as it is", () => {
  expect(workIdTitle("Mend the gate latch", "HOME-001")).toEqual({ workId: "HOME-001", title: "Mend the gate latch" });
  expect(workIdTitle("HOME-001 — Mend the gate latch", "HOME-001")).toEqual({ workId: "HOME-001", title: "Mend the gate latch" });
  expect(workIdTitle("HOME-001: Mend the gate latch", "HOME-001")).toEqual({ workId: "HOME-001", title: "Mend the gate latch" });
  expect(workIdTitle("HOME-0011 is another", "HOME-001")).toEqual({ workId: "HOME-001", title: "HOME-0011 is another" });
  expect(workIdTitle("Mend the gate latch", undefined)).toEqual({ workId: null, title: "Mend the gate latch" });
});

test("one string for every place a note's name is drawn (PIE-1356): the ID, then the title; another ticket key in the title stays", () => {
  expect(headedTitle("PC-582 acceptance summary for the intake desk", "HUB-062")).toBe("HUB-062 · PC-582 acceptance summary for the intake desk");
  expect(headedTitle("HUB-062 — PC-582 acceptance summary", "HUB-062")).toBe("HUB-062 · PC-582 acceptance summary");
  expect(headedTitle("HUB-062", "HUB-062")).toBe("HUB-062");
  expect(headedTitle("Mend the gate latch", undefined)).toBe("Mend the gate latch");
  expect(headedTitle("Mend the gate latch", " ")).toBe("Mend the gate latch");
});

test("a note's Work ID from its properties or its text, as queries read it", () => {
  expect(workIdOf({ text: "PC-582 acceptance summary [work-id::HUB-062]\nbody" })).toBe("HUB-062");
  expect(workIdOf({ properties: [{ key: "work-id", values: ["HUB-064"] }] })).toBe("HUB-064");
  expect(workIdOf({ properties: [{ key: "Work-ID", value: "HUB-065" }] })).toBe("HUB-065");
  expect(workIdOf({ text: "No id here" })).toBeUndefined();
});
