// Tests never write the person's door state: anything that falls back to XDG_STATE_HOME (a draft put
// aside, a copy of refused text) lands in a temp dir for this run, removed when the run ends. Tests that
// set EP0CH_STATE still win.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ep0ch-test-state-"));
process.env.XDG_STATE_HOME = dir;
process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir */ } });
