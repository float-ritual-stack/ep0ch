// The file after it starts in the theme the run started in.
import { expect, test } from "bun:test";
import { theme } from "../../../src/theme";

test("the run's own theme", () => { expect(theme().name).toBe("calm"); });
