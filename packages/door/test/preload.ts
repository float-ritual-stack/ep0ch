// Tests never write the person's door state: anything that falls back to XDG_STATE_HOME (a draft put
// aside, a copy of refused text) lands in a temp dir for this run, removed when the run ends. Tests that
// set EP0CH_STATE still win. The person's own EP0CH_* settings (a landing, a now page, the daily agent) are
// cleared too (and Claude's config dir moved), so the suite runs the same from any shell; EP0CH_OUTLINER, which names the checkout the tests
// start scratch services from, stays.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const k of Object.keys(process.env)) if (k.startsWith("EP0CH_") && k !== "EP0CH_OUTLINER") delete process.env[k];
// A door a test starts (`bun src/main.ts …`) runs in its own process, not as a session that would outlive the test
// (test/session.test.ts starts its sessions itself).
process.env.EP0CH_DAEMON = "0";
// ctrl+t in a draft (draft.pick, src/pick.ts) hands the terminal to a picker: one that exits at once having chosen
// nothing, never the person's tv (test/pick.test.ts sets its own).
process.env.EP0CH_PICKER = "true";

// e opens an edit at once, as before arming (src/arm.ts): a test that presses e means the edit. The arm itself is tested
// where it's turned on (test/edit-arm.test.ts, the showcase's edit section, the parity probes).
process.env.EP0CH_EDIT_ARM = "off";

// The art the menus draw is the repo's own few pieces (test/fixtures/packs, PIE-596), never the person's packs folder,
// so the suite draws the same art on every machine, a fresh clone included.
process.env.EP0CH_PACKS = join(import.meta.dir, "fixtures/packs");

const dir = mkdtempSync(join(tmpdir(), "ep0ch-test-state-"));
process.env.XDG_STATE_HOME = dir;
// What the agent chip compares an agent with (the Claude mod Claude loads, src/desk/agent-env.ts) is never the
// person's: an empty Claude config here, and no plugin dirs from the shell.
process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
delete process.env.CLAUDE_CODE_PLUGIN_DIRS;
process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir */ } });
