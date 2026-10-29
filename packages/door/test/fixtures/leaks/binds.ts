// A test file that binds an extension list itself and never unbinds it (bindExtensions(null)): the check names it.
import { expect, test } from "bun:test";
import { bindExtensions, EXT_ACTIONS } from "../../../src/extensions";
import { list } from "./list";

test("an extension list bound and left", () => {
  bindExtensions(list);
  expect(EXT_ACTIONS.names()).toContain("ext.tarot.draw");
});
