// Tests never write the person's door state: anything that falls back to XDG_STATE_HOME (a draft put
// aside, a copy of refused text) lands in a temp dir for this run. Tests that set EP0CH_STATE still win.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "ep0ch-test-state-"));
