// A test file that turns the theme and leaves it, as test/power-bar.test.ts's theme.cycle does.
import { expect, test } from "bun:test";
import { setTheme, theme } from "../../../src/theme";

test("a theme turned and left", () => {
  setTheme("night");
  expect(theme().name).toBe("night");
});
