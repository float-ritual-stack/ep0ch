// Past Bun's own 5 s default and within the preload's budget.
import { test } from "bun:test";

test("takes longer than Bun's default", async () => { await Bun.sleep(5500); });
