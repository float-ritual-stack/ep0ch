// A dropped link under `ep0ch door` (PIE-1429): the door on the other machine can't reset this terminal once the link
// is gone, so the side still running does. A tmux pane stands in for Evan's terminal, a fake ssh for the link: it turns
// on what a door turns on (the alternate screen, mouse, paste) and is then killed, as a tailnet blip kills ssh. tmux
// tracks the pane's modes, so the assertion is the terminal's own state, not grepped output.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scratchDir, until } from "./scratch";

const MAIN = resolve(import.meta.dir, "../src/main.ts");
let here = "", sock = "";
const tmux = (...a: string[]) => Bun.spawnSync(["tmux", "-L", sock, "-f", "/dev/null", ...a], { stdout: "pipe", stderr: "pipe" });
const modes = () => tmux("display-message", "-p", "-t", "t", "#{alternate_on} #{mouse_any_flag} #{mouse_sgr_flag} #{pane_dead}").stdout.toString().trim();
const screen = () => tmux("capture-pane", "-p", "-t", "t").stdout.toString();

beforeAll(() => {
  here = scratchDir("ep0ch-drop-");
  sock = `ep0ch-drop-${process.pid}`;
  // The link: what the door on the far side writes when it starts, then nothing until it is killed.
  writeFileSync(join(here, "ssh"), `#!/bin/sh\necho "$@" > ${join(here, "argv")}\necho $$ > ${join(here, "pid")}\nprintf '\\033[?1049h\\033[?1000h\\033[?1002h\\033[?1003h\\033[?1006h\\033[?2004h'\necho the door is drawn\nexec sleep 600\n`);
  chmodSync(join(here, "ssh"), 0o755);
});

afterAll(() => {
  tmux("kill-server");
  rmSync(here, { recursive: true, force: true });
});

test("a link killed under ep0ch door leaves the terminal clean and says what reattaches", async () => {
  expect(tmux("new-session", "-d", "-x", "100", "-y", "20", "-s", "t", "-e", `EP0CH_SSH=${join(here, "ssh")}`, "-e", `PATH=${process.env.PATH}`, `${process.execPath} ${MAIN} door box-a`).exitCode).toBe(0);
  tmux("set-option", "-t", "t", "remain-on-exit", "on");
  await until(() => modes().startsWith("1 1 1"), "the door's modes are on", 20_000);
  // ssh -t to the machine, an outline name only (the far side's ForceCommand takes nothing else), and keepalives so a dead link ends.
  expect(readFileSync(join(here, "argv"), "utf8").trim()).toBe("-t -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -- box-a");
  process.kill(Number(readFileSync(join(here, "pid"), "utf8")), "SIGKILL");
  await until(() => modes().endsWith(" 1"), "ep0ch door exits", 20_000);
  expect(modes()).toBe("0 0 0 1");
  expect(screen()).toContain("ep0ch door box-a reattaches");
}, 30_000);
