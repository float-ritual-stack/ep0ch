// A test file whose desk is kept for the next open of the desk, as leaving it with a program running does.
import { expect, test } from "bun:test";
import { Desk } from "../../../src/desk/desk";

test("a desk is kept and left", () => {
  const desk = new Desk();
  Desk.keep(desk);
  (globalThis as { keptProbe?: Desk }).keptProbe = desk;
  expect(desk).toBeDefined();
});
