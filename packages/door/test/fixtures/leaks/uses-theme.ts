// A file whose module code calls into the door: in a run of several files, the next one lost the preload's test budget.
import { test } from "bun:test";
import { setTheme } from "../../../src/theme";

setTheme("calm");
test("runs first", () => {});
