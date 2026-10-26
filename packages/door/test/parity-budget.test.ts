import { expect, test } from "bun:test";
import { ScenarioBudget } from "./parity-budget";

test("a parity scenario past its budget fails by its name, with the slowest key and the slowest build (PIE-1307)", () => {
  let clock = 1_000;
  const budget = new ScenarioBudget(60_000, () => clock);
  budget.start();
  budget.key("ctrl+k", 40); budget.key("j", 12); budget.build(30); budget.build(520);
  const cost = { builds: 300, buildMs: 14_000, seconds: 21 };

  clock += 59_000;
  expect(() => budget.check("desk: facets tile", "key x", cost)).not.toThrow();

  clock += 2_000;
  expect(() => budget.check("desk: facets tile", "keys alt+l q", cost)).toThrow(
    /parity scenario "desk: facets tile" took over 60 s \(61\.0 s: 300 builds taking 14\.0 s, 21 second checks\) at keys alt\+l q: its slowest key took 40 ms \(ctrl\+k\) and its slowest build 520 ms/,
  );
  // It says where to look, not only that it was slow.
  expect(() => budget.check("x", "a build", cost)).toThrow(/PARITY_KEYS=<file>/);
});

test("the next scenario starts with a clean budget", () => {
  let clock = 0;
  const budget = new ScenarioBudget(1_000, () => clock);
  budget.start(); budget.key("slow", 900); clock = 5_000;
  expect(() => budget.check("one", "a build", { builds: 1, buildMs: 1, seconds: 0 })).toThrow(/"one" took over 1 s/);
  budget.start();
  expect(budget.worst()).toEqual({ key: "", keyMs: 0, buildMs: 0 });
  expect(() => budget.check("two", "a build", { builds: 1, buildMs: 1, seconds: 0 })).not.toThrow();
});
