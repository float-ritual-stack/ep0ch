// What the dock's own tile runs (PIE-498): the program the host layer's drawer starts with, and the folder it starts in.
// One answer, read where the drawer makes its tile and where `ep0ch doctor` says it, so the two never disagree.
//
// - The program: EP0CH_DAILY_AGENT when the person set one (`claude`, the Herdr launcher scripts/door-agent-herdr.ts,
//   anything), else a shell ($SHELL). No agent is started that nobody asked for.
// - The folder: EP0CH_DAILY_CWD when the person set one; else the folder of the nearest `.ep0ch` above where the door
//   was started, when it names this outline (the project the door was opened for); else the outline's own folder
//   (`<outlines>/<name>/`, an outline on this machine); else the folder the door was started from. Claude Code's
//   /resume lists one folder's conversations, so the folder is the person's or the outline's, never one made up.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { nearestDotEp0ch, outlineLayout, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { words } from "../text";

/** The folder the door was started from (a session's daemon: where its first client started it). */
const START = process.cwd();

export interface DockProgram {
  cmd: string[];
  cwd: string;
  /** What the dock's own tab is called: `claude` for a Claude (or the Herdr launcher), `shell` for a shell, else the program. */
  name: string;
  /** Why this program, in words (`ep0ch doctor`, `layout.get` of the dock). */
  programWhy: string;
  /** Why this folder, in words. */
  folderWhy: string;
}

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "nu", "elvish"]);
const tilde = (s: string, home: string) => s.trim().replace(/^~(?=$|\/)/, home);

/** The tab's name for a program: claude, shell, or the program's own name. */
export function programName(cmd: readonly string[]): string {
  const first = basename(cmd[0] ?? "");
  if (/claude/.test(first) || first === "door-agent-herdr.ts" || cmd.some(c => basename(c) === "door-agent-herdr.ts")) return "claude";
  if (SHELLS.has(first)) return "shell";
  return first.replace(/\.[jt]s$/, "") || "shell";
}

/** The dock's program and folder, read now from `env`, for the outline `outline` (null: the home base, none yet). */
export function dockProgram(o: { env?: Record<string, string | undefined>; outline?: string | null; machine?: string | null; start?: string; home?: string } = {}): DockProgram {
  const env = o.env ?? process.env, home = o.home ?? env.HOME ?? homedir(), start = o.start ?? START;
  const set = env.EP0CH_DAILY_AGENT?.trim();
  const cmd = set ? words(set) : [env.SHELL || "sh"];
  const programWhy = set ? `EP0CH_DAILY_AGENT (${set})` : `a shell: no agent is configured (EP0CH_DAILY_AGENT is unset; set it to claude, or to scripts/door-agent-herdr.ts for the Herdr agent)`;
  const folder = ((): { cwd: string; why: string } => {
    const chosen = env.EP0CH_DAILY_CWD?.trim();
    if (chosen) return { cwd: tilde(chosen, home), why: `EP0CH_DAILY_CWD (${chosen})` };
    if (o.outline) {
      try {
        const dot = nearestDotEp0ch(start, { readFile: p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } }, exists: existsSync });
        if (dot && dot.name === o.outline) return { cwd: dot.folder, why: `the folder whose .ep0ch names ${o.outline}` };
      } catch { /* a malformed .ep0ch: the next rule */ }
      if (!o.machine) {
        const f = outlineLayout(outlinesFolder(env, home)).folder(o.outline);
        if (existsSync(f)) return { cwd: f, why: `the outline's own folder (${o.outline})` };
      }
    }
    return { cwd: start, why: "the folder the door was started from" };
  })();
  return { cmd: cmd.length ? cmd : ["sh"], cwd: folder.cwd, name: programName(cmd), programWhy, folderWhy: folder.why };
}
