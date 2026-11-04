// The file after it starts with no kept desk all the same.
import { expect, test } from "bun:test";
import { kept } from "../../../src/desk/kept-desk";

test("no kept desk", () => { expect(kept.desk).toBeNull(); });
