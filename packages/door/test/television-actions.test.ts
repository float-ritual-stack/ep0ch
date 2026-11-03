// Pressing a television action again and again (PIE-1538): every action comes back to a live tv. tv 0.15.9's fork mode
// ends tv at the key after the first action ("Error: channel closed", whatever the action runs), so the cables' actions
// run in execute mode and start tv again (`ep0ch-tv again <channel>`). A tmux pane on its own socket stands in for
// Evan's terminal, the repo's own cable files and ep0ch-tv drive a real tv, and a fake door answers the source and
// counts the opens. Skipped where tv or tmux isn't installed.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scratchDir, until } from "./scratch";

const EXT = resolve(import.meta.dir, "../ext/television");
const have = (p: string) => Bun.which(p) !== null;
const ready = have("tv") && have("tmux");
let here = "", sock = "";
const tmux = (...a: string[]) => Bun.spawnSync(["tmux", "-L", sock, "-f", "/dev/null", ...a], { stdout: "pipe", stderr: "pipe" });
const screen = (t: string) => tmux("capture-pane", "-p", "-t", t).stdout.toString();
const dead = (t: string) => tmux("display-message", "-p", "-t", t, "#{pane_dead}").stdout.toString().trim() === "1";
const opens = () => { try { return readFileSync(join(here, "opens"), "utf8").split("\n").filter(Boolean); } catch { return []; } };

beforeAll(() => {
  if (!ready) return;
  here = scratchDir("ep0ch-tv-again-");
  sock = `ep0ch-tv-again-${process.pid}`;
  // tv's config: the repo's cable files, nothing else; its history and frecency in the scratch folder.
  mkdirSync(join(here, "config"));
  symlinkSync(join(EXT, "cable"), join(here, "config", "cable"));
  mkdirSync(join(here, "data"));
  // The door, made up: the tree is two notes, and each open is written down.
  writeFileSync(join(here, "door.ts"), [
    `const a = process.argv.slice(2), log = ${JSON.stringify(join(here, "opens"))};`,
    `if (a[0] === "find") process.stdout.write("n-seeds\\tSeeds to sow\\t\\t0\\t\\t\\tep0ch://x/n-seeds\\nn-beans\\tBeans\\t\\t1\\t└─ \\t\\tep0ch://x/n-beans\\n");`,
    `else if (a[0] === "open") require("node:fs").appendFileSync(log, a[1] + "\\n");`,
    `else { process.stderr.write("no answer for " + a.join(" ")); process.exit(1); }`,
  ].join("\n"));
});

afterAll(() => {
  if (!ready) return;
  tmux("kill-server");
  rmSync(here, { recursive: true, force: true });
});

/** tv on `argv` in pane `t` (stdout to `out` when given), then ctrl-g `n` times, each open waited for and tv back after it. */
async function pressed(t: string, argv: string[], n: number, out?: string) {
  // Through env, not tmux's -e: the pane's shell would put the person's own PATH (an installed ep0ch-tv) first.
  const env = [...(out ? [`EP0CH_PICK_OUT=${out}`] : []), `TELEVISION_CONFIG=${join(here, "config")}`, `TELEVISION_DATA=${join(here, "data")}`, `EP0CH_DOOR_MAIN=${join(here, "door.ts")}`, `PATH=${join(EXT, "bin")}:${process.env.PATH}`];
  const cmd = ["env", ...env, "tv", ...argv].map(a => `'${a}'`).join(" ") + (out ? ` > '${out}'` : "");
  expect(tmux("new-session", "-d", "-x", "120", "-y", "24", "-s", t, cmd).exitCode).toBe(0);
  tmux("set-option", "-t", t, "remain-on-exit", "on");
  await until(() => screen(t).includes("Seeds to sow"), "tv lists the tree", 20_000);
  const before = opens().length;
  for (let i = 1; i <= n; i++) {
    tmux("send-keys", "-t", t, "C-g");
    await until(() => opens().length === before + i || dead(t), `open ${i} reaches the door`, 20_000);
    expect(dead(t) ? screen(t).trim() : "").toBe("");
    await until(() => screen(t).includes("Seeds to sow") || dead(t), `tv is back after open ${i}`, 20_000);
  }
  // A key after the last action: tv takes it (the row moves), it doesn't end.
  tmux("send-keys", "-t", t, "Down");
  await until(() => /> .*Beans/.test(screen(t)) || dead(t), "tv moves to the next row", 20_000);
  expect(dead(t) ? screen(t).trim() : "").toBe("");
  expect(screen(t)).not.toContain("channel closed");
}

test.skipIf(!ready)("ctrl-g ten times in tv ep0ch opens ten notes and tv is still there to type in", async () => {
  await pressed("full", ["ep0ch"], 10);
  expect(opens()).toEqual(Array(10).fill("n-seeds"));
}, 120_000);

test.skipIf(!ready)("as the door's ctrl+t picker (tv --inline, its answer in EP0CH_PICK_OUT), tv comes back inline and ⏎ still answers", async () => {
  const out = join(here, "picked");
  await pressed("picker", ["--inline", "ep0ch"], 3, out);
  tmux("send-keys", "-t", "picker", "Enter");
  await until(() => dead("picker"), "tv exits on ⏎", 20_000);
  expect(readFileSync(out, "utf8").trim()).toBe("((n-beans))");
}, 120_000);
