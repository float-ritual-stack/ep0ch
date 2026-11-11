// Every test service reads extensions only from folders a test gives it: never the owner's real
// ~/.config/pi-herdr-outliner/extensions (its code and secrets). A test that wants a user folder sets
// OUTLINER_EXTENSIONS_DIR itself.
import { afterEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../../scripts/fake-ssh-owner";
import "../../../scripts/host-free-guard";
import { runTestCleanups } from "./test-cleanups";

// A preload's hook runs after every test of every file: the shared helpers' cleanups (test/test-cleanups.ts).
afterEach(runTestCleanups);

const NO_USER_EXTENSIONS = join(tmpdir(), `outliner-test-no-user-extensions-${process.pid}`);
process.env.OUTLINER_EXTENSIONS_DIR ??= NO_USER_EXTENSIONS;
// …and that folder stays empty from one test to the next. A test's OutlineHost puts the default-on built-ins (glass,
// waiting, what-changed: PIE-1506) in the user folder at its start, and every later service in this process then read
// them and wrote their pages into its own outline: change-feed-protocol's feed after herdr-open-remote (PIE-1736).
// Its contents go, not the folder, so a host a file keeps across its tests still watches a folder that's there.
afterEach(() => {
  if (!existsSync(NO_USER_EXTENSIONS)) return;
  for (const entry of readdirSync(NO_USER_EXTENSIONS)) rmSync(join(NO_USER_EXTENSIONS, entry), { recursive: true, force: true });
});

// No test asks the real Jev for a figure suggestion (src/figure-fit.ts), whatever key the machine has: a test that wants
// one sets OUTLINER_FIGURE_FIT=on and OUTLINER_JEV_ENDPOINT to a fake of its own.
process.env.OUTLINER_FIGURE_FIT = "off";

// Nor is a write's answer drawn (agent-tools.ts drawnWrite, PIE-588: each would start this checkout's `ep0ch show`): a test
// about the drawing passes an environment without it (write-review.test.ts's CLI runs).
process.env.OUTLINER_WRITE_VIEW = "off";
