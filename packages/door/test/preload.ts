// Tests never write the person's door state: anything that falls back to XDG_STATE_HOME (a draft put
// aside, a copy of refused text) lands in a temp dir for this run, removed when the run ends. Tests that
// set EP0CH_STATE still win. The person's own EP0CH_* settings (a landing, a now page, the daily agent) are
// cleared too (and Claude's config dir moved), so the suite runs the same from any shell; EP0CH_OUTLINER, which names the checkout the tests
// start scratch services from, stays.
import { plugin } from "bun";
import { afterAll, beforeEach, setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import "../../../scripts/fake-ssh-owner";

for (const k of Object.keys(process.env)) if (k.startsWith("EP0CH_") && k !== "EP0CH_OUTLINER") delete process.env[k];
// No test asks the real Jev for a figure suggestion (the outliner's figure-fit.ts, run by the gateway's writes).
process.env.OUTLINER_FIGURE_FIT = "off";
// A test's budget is its own waits' (until()'s, 5 s and up), not Bun's 5 s default: under a loaded runner (CI's
// --parallel=16) a test whose waits all held still ran past 5 s and was timed out. A timeout costs more than that test:
// Bun ends every process the file started when a test times out ("killed N dangling processes"), the file's scratch
// host among them, so each test after it in the file failed too, with "connect ENOENT …/host.sock" (test/scratch.ts `revive` starts it again, below).
setDefaultTimeout(30_000);
// The scratch services a file holds register here (test/scratch.ts), and each test starts by having any that Bun ended
// started again on the same folder, so one test's timeout is that test's alone.
// Only the running file's own: one a file left undisposed is no business of the next file's tests.
type Held = { root: string; running: boolean; revive(): Promise<boolean>; dispose(): Promise<void> };
const scratches = new Map<Held, string>();
(globalThis as { [k: symbol]: unknown })[Symbol.for("ep0ch.test.scratches")] = { add(s: Held) { scratches.set(s, Bun.main); }, delete(s: Held) { scratches.delete(s); } };
beforeEach(async () => { for (const [s, file] of [...scratches]) if (file === Bun.main) await s.revive(); });

// A door a test starts (`bun src/main.ts …`) runs in its own process, not as a session that would outlive the test
// (test/session.test.ts starts its sessions itself).
process.env.EP0CH_DAEMON = "0";
// ctrl+t in a draft (draft.pick, src/pick.ts) hands the terminal to a picker: one that exits at once having chosen
// nothing, never the person's tv (test/pick.test.ts sets its own).
process.env.EP0CH_PICKER = "true";
// No test reads the real `claude agents` for the status bar's split chip (src/claude-splits.ts): a real session running
// twice on the test machine would draw it on every frame. The showcase's section hands its watch made-up rows.
process.env.EP0CH_CLAUDE_SPLITS = "off";

// e opens an edit at once, as before arming (src/arm.ts): a test that presses e means the edit. The arm itself is tested
// where it's turned on (test/edit-arm.test.ts, the showcase's edit section, the parity probes).
process.env.EP0CH_EDIT_ARM = "off";
// Layout changes snap in tests: a frame is the settled screen (the motion tests set the mode and a clock of their own).
process.env.EP0CH_MOTION = "off";

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

// An App a test file leaves running keeps ticking (and painting against that file's boards) while the next files run:
// a stub board without some method then throws "between tests" in an unrelated file, and the whole suite exits 1 with
// no test failed. Every App registers itself here (src/app.ts, TEST_APPS) with the file that made it; once another file
// is running, the earlier files' Apps are retired: they stop ticking and painting, and give back the extension actions
// they bound (power-bar's stayed bound into dispatch and wkeys, PIE-1412).
const apps = new Map<{ retire(): void }, string>();
const retireOthers = () => { for (const [app, file] of apps) if (file !== Bun.main) { app.retire(); apps.delete(app); } };
(globalThis as { [k: symbol]: unknown })[Symbol.for("ep0ch.test.apps")] = { add(app: { retire(): void }) { retireOthers(); apps.set(app, Bun.main); } };
beforeEach(retireOthers);
afterAll(() => { for (const app of apps.keys()) app.retire(); apps.clear(); });

// ── Between test files (PIE-1412) ──
// `bun test` runs its files one after another in one process, so what one file leaves behind is the next file's
// starting state: a test that passes alone fails in the suite (with --parallel each file starts afresh, and is checked
// at its end all the same: a scratch host it left running still eats the box the other files run on). Before each file is loaded (a
// module hook, so it runs after the earlier file's afterAll and before any of this file's code), the shared teardown
// puts back what it can (retires the earlier file's Apps, stops its scratch hosts, unbinds the extensions it bound,
// restores the environment) and names what else the earlier file left (a host, a binding); once the last file has run, a run where any file
// left something fails, naming each. A part with process-wide state registers it here (`what`, what's left now, how to
// put it back): src/extensions.ts does.
const leftovers = new Map<string, { left(): string[]; reset(): void }>();
(globalThis as { [k: symbol]: unknown })[Symbol.for("ep0ch.test.leftovers")] = { set(what: string, left: () => string[], reset: () => void) { leftovers.set(what, { left, reset }); } };
// The environment the file running now started with (its module code is the file's too).
let env0 = { ...process.env };
const said: string[] = [];
// `file` ended: the next file (Bun.main) is loading, or (`end`) it was the last.
async function between(file: string, end = false): Promise<void> {
  retireOthers();
  const left: string[] = [];
  for (const [s, from] of [...scratches]) {
    if (from !== file && !end) continue;
    // One stopped and not disposed has only its folder left, removed here; one still running is a leak.
    if (s.running) left.push(`a scratch host still running (${s.root})`);
    try { await s.dispose(); } catch { /* stopped as far as it goes */ }
    scratches.delete(s);
  }
  for (const [what, l] of leftovers) { const now = l.left(); if (now.length) { left.push(`${what} (${now.join(", ")})`); l.reset(); } }
  // The environment is put back without a word: a file's beforeAll setting EP0CH_STATE for its scratch is the usual way.
  const changed = [...new Set([...Object.keys(env0), ...Object.keys(process.env)])].filter(k => process.env[k] !== env0[k]);
  for (const k of changed) if (env0[k] === undefined) delete process.env[k]; else process.env[k] = env0[k];
  if (!left.length) return;
  const line = `${relative(join(import.meta.dir, ".."), file)} left behind: ${left.join("; ")}`;
  said.push(line);
  console.error(`test leak: ${line}`);
}
let last: string | null = null;
plugin({
  name: "ep0ch-test-boundary",
  setup(build) {
    build.onLoad({ filter: /\/test\/(?:.*\.test|fixtures\/.*)\.ts$/ }, async a => {
      // This package's files only: another package's (a run from the repository's root) has its own preload.
      if (a.path === Bun.main && last !== a.path && a.path.startsWith(import.meta.dir)) { if (last) await between(last); last = a.path; env0 = { ...process.env }; }
      return { contents: readFileSync(a.path, "utf8"), loader: "ts" };
    });
  },
});
afterAll(async () => {
  if (last) await between(last, true);
  if (said.length) throw new Error(`test files left state behind for the files after them (test/preload.ts):\n${said.join("\n")}`);
});
