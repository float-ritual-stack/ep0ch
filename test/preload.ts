// Tests never write the person's door state: anything that falls back to XDG_STATE_HOME (a draft put
// aside, a copy of refused text) lands in a temp dir for this run, removed when the run ends. Tests that
// set EP0CH_STATE still win. The person's own EP0CH_* settings (a landing, a now page, the daily agent) are
// cleared too, so the suite runs the same from any shell; EP0CH_OUTLINER, which names the checkout the tests
// start scratch services from, stays.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const k of Object.keys(process.env)) if (k.startsWith("EP0CH_") && k !== "EP0CH_OUTLINER") delete process.env[k];

const dir = mkdtempSync(join(tmpdir(), "ep0ch-test-state-"));
process.env.XDG_STATE_HOME = dir;
process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir */ } });
