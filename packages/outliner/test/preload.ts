// Every test service reads extensions only from folders a test gives it: never the owner's real
// ~/.config/pi-herdr-outliner/extensions (its code and secrets). A test that wants a user folder sets
// OUTLINER_EXTENSIONS_DIR itself.
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../../scripts/fake-ssh-owner";

process.env.OUTLINER_EXTENSIONS_DIR ??= join(tmpdir(), `outliner-test-no-user-extensions-${process.pid}`);

// No test asks the real Jev for a figure suggestion (src/figure-fit.ts), whatever key the machine has: a test that wants
// one sets OUTLINER_FIGURE_FIT=on and OUTLINER_JEV_ENDPOINT to a fake of its own.
process.env.OUTLINER_FIGURE_FIT ??= "off";
