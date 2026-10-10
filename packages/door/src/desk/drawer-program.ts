// What the drawer's own tab runs (PIE-498): the agent the person chose for this outline's session, and the folder it
// starts in. One answer, read where the drawer makes its tile, where its picker lists the choices and where
// `ep0ch doctor` says it, so they never disagree.
//
// - The agent: EP0CH_DAILY_AGENT when set (an override, for a test door or a one-off); else the choice saved for this
//   outline's session (drawer-agent.json in its folder of the state dir, made by the drawer's picker, `host.agent`); else
//   the person's default (drawer-agent.json in the state dir, `host.agent default=true`); else none chosen yet: a shell,
//   and the drawer offers its picker the first time it's pulled up.
// - The agents offered: those installed here (Herdr's supported agent kinds, found on PATH), and always a shell. One
//   in Herdr (it outlives the door) when Herdr is installed: `door-agent-herdr.ts --session <this session> --agent <agent…>`.
// - Every agent starts inside the person's login shell (`inLoginShell`): when it exits, or crashes, the tile is a
//   working shell in the same folder with the same environment, and says the agent exited. Nothing restarts it.
// - The folder: the one chosen with the agent (`host.agent in=<folder>`); else the folder of the nearest `.ep0ch` above where the door
//   was started, when it names this outline (the project); else the outline's own folder (`<outlines>/<name>/`, an
//   outline on this machine); else the folder the door was started from. Claude Code's /resume lists one folder's
//   conversations, so the folder is the person's or the outline's, never one made up.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { nearestDotEp0ch, outlineLayout, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { words } from "../text";

/** The folder the door was started from (a session's daemon: where its first client started it). */
const START = process.cwd();
/** The Herdr launcher (scripts/door-agent-herdr.ts): the agent in a Herdr pane that outlives the door. */
export const HERDR_LAUNCHER = resolve(import.meta.dir, "../../scripts/door-agent-herdr.ts");

/** An agent the drawer can run: its name, its command, and whether it runs in Herdr. */
export interface DrawerAgent { name: string; cmd: string[]; herdr?: boolean }
/** What a choice is saved as (drawer-agent.json): the agent by name or command line, where it runs, and in which folder. */
export interface DrawerChoice { agent: string; herdr?: boolean; folder?: string }

export interface DrawerProgram {
  cmd: string[];
  cwd: string;
  /** What the drawer's own tab is called: the agent's name (`claude`, `codex`), or `shell`. */
  name: string;
  /** It runs in a Herdr pane (the launcher). */
  herdr: boolean;
  /** Where the choice came from: env (EP0CH_DAILY_AGENT), session, default, none. */
  from: "env" | "session" | "default" | "none";
  /** Why this program, in words (`ep0ch doctor`, `peek`). */
  programWhy: string;
  /** Why this folder, in words. */
  folderWhy: string;
}

/**
 * The agent kinds Herdr supports (`herdr agent start --kind`), and aider, each by the command that starts it. Found
 * on PATH, they're offered; Herdr detects them in its panes. Read from Herdr's own list when it's updated.
 */
export const KNOWN_AGENTS: readonly [name: string, cmd: string][] = [
  ["claude", "claude"], ["codex", "codex"], ["pi", "pi"], ["gemini", "gemini"], ["opencode", "opencode"], ["aider", "aider"],
  ["amp", "amp"], ["cursor", "cursor-agent"], ["copilot", "copilot"], ["goose", "goose"], ["droid", "droid"], ["qwen", "qwen"],
  ["kimi", "kimi"], ["grok", "grok"], ["hermes", "hermes"], ["cline", "cline"], ["kilo", "kilo"], ["letta", "letta"],
];
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "nu", "elvish"]);
/** A shell's program name (`bash`, `-zsh` as a login shell names itself, `/bin/sh`). */
export const isShellName = (name: string) => SHELLS.has(basename(name).replace(/^-/, ""));
const tilde = (s: string, home: string) => s.trim().replace(/^~(?=$|\/)/, home);
const isLauncher = (cmd: readonly string[]) => cmd.some(c => basename(c) === "door-agent-herdr.ts");

/** The tab's name for a program: the agent it runs (the launcher's too), shell, or the program's own name. */
export function programName(cmd: readonly string[]): string {
  if (isLauncher(cmd)) { const i = cmd.indexOf("--agent"); return i >= 0 && cmd[i + 1] ? programName(cmd.slice(i + 1)) : "claude"; }
  const first = basename(cmd[0] ?? "");
  if (SHELLS.has(first)) return "shell";
  const known = KNOWN_AGENTS.find(([, c]) => c === first);
  if (known) return known[0];
  if (/claude/.test(first)) return "claude";
  return first.replace(/\.[jt]s$/, "") || "shell";
}

/**
 * A command that starts an agent (one of KNOWN_AGENTS): it runs inside the person's shell. Never the Herdr launcher:
 * it only attaches, and its pane wraps the agent itself (runLine); a tile left a shell when the attach ends would say
 * "exited" while the agent runs on in Herdr.
 */
export function isAgentCmd(cmd: readonly string[]): boolean {
  const first = basename(cmd[0] ?? "");
  return !isLauncher(cmd) && (KNOWN_AGENTS.some(([, c]) => c === first) || /claude/.test(first));
}

/** A word as the shell reads it back. */
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/**
 * `cmd` started inside the person's login shell (no dead panes): when it exits, or crashes, the shell says so (and
 * titles the tile `<name> exited · shell`) and becomes the person's login shell, in the same folder with the same
 * environment. Nothing is run again by itself.
 */
export function inLoginShell(cmd: readonly string[], shell: string, name = programName(cmd)): string[] {
  const line = cmd.map(shellQuote).join(" ");
  const say = `printf '\\033]2;%s\\007\\n%s\\n' ${shellQuote(`${name} exited · shell`)} "${name} exited ($c) · this is your shell, in $PWD"`;
  // The login shell reads the person's profile, then a POSIX sh runs the agent and says how it ended: fish, nu and
  // elvish take `exec /bin/sh -c '…'` as their own line, never the sh syntax after it.
  return [shell, "-l", "-c", `exec /bin/sh -c ${shellQuote(`${line}; c=$?; ${say}; exec ${shellQuote(shell)} -l`)}`];
}

/** The agents installed here, a shell first; each also in Herdr when Herdr is installed (and the launcher is here). */
export function detectAgents(o: { env?: Record<string, string | undefined>; which?: (c: string) => string | null; session?: string | null } = {}): DrawerAgent[] {
  const env = o.env ?? process.env, which = o.which ?? ((c: string) => Bun.which(c, { PATH: env.PATH ?? "" }));
  const shell = env.SHELL || "sh";
  const found = KNOWN_AGENTS.filter(([, c]) => !!which(c)).map(([name, c]) => ({ name, cmd: [c] }));
  const herdr = !!(env.EP0CH_HERDR_BIN || which("herdr")) && existsSync(HERDR_LAUNCHER);
  return [
    { name: "shell", cmd: [shell] },
    ...found,
    ...(herdr ? found.map(a => ({ name: a.name, cmd: herdrCmd(a.cmd, o.session ?? null), herdr: true })) : []),
  ];
}

/** The launcher's command line for `agent`, in this session's own Herdr pane. */
export function herdrCmd(agent: readonly string[], session: string | null): string[] {
  return [HERDR_LAUNCHER, ...(session ? ["--session", session] : []), "--agent", ...agent];
}

/** This session's label: the outline, and its machine when it's on another (`pie-hole@float-2`). */
export const sessionLabel = (p: { outline?: string | null; machine?: string | null }) => (p.outline ? `${p.outline}${p.machine ? `@${p.machine}` : ""}` : null);

const readChoice = (file: string): DrawerChoice | null => {
  try { const x = JSON.parse(readFileSync(file, "utf8")); return x && typeof x.agent === "string" && x.agent.trim() ? { agent: x.agent.trim(), ...(x.herdr === true ? { herdr: true } : {}), ...(typeof x.folder === "string" && x.folder.trim() ? { folder: x.folder.trim() } : {}) } : null; } catch { return null; }
};
/** The choice file of a session's folder (`dir`), or the person's default (the state dir). */
export const choiceFile = (dir: string) => join(dir, "drawer-agent.json");

/**
 * The drawer's program and folder, read now. `dir`: this session's folder of the state dir (its saved choice);
 * `state`: the state dir (the person's default).
 */
export function drawerProgram(o: { env?: Record<string, string | undefined>; outline?: string | null; machine?: string | null; start?: string; home?: string; dir?: string | null; state?: string | null } = {}): DrawerProgram {
  const env = o.env ?? process.env, home = o.home ?? env.HOME ?? homedir(), start = o.start ?? START;
  const shell = env.SHELL || "sh";
  const session = sessionLabel(o);
  const set = env.EP0CH_DAILY_AGENT?.trim();
  const saved = o.dir ? readChoice(choiceFile(o.dir)) : null;
  const dflt = !saved && o.state ? readChoice(choiceFile(o.state)) : null;
  const choice = saved ?? dflt;
  let cmd: string[], from: DrawerProgram["from"], programWhy: string;
  if (set) { cmd = words(set); from = "env"; programWhy = `EP0CH_DAILY_AGENT (${set}), which overrides the drawer's choice`; }
  else if (choice) {
    const agent = words(choice.agent === "shell" ? shell : choice.agent);
    cmd = choice.herdr ? herdrCmd(agent, session) : agent;
    from = saved ? "session" : "default";
    programWhy = `${saved ? `chosen for ${session ?? "this session"}` : "your default"} (${choice.agent}${choice.herdr ? " in Herdr" : ""})`;
  } else { cmd = [shell]; from = "none"; programWhy = "a shell: no agent chosen yet (the drawer's picker, alt+g, chooses one)"; }
  // The launcher named outright (EP0CH_DAILY_AGENT): it's told this session, so its pane is this session's own.
  // After the script's path (`bun …/door-agent-herdr.ts`: bun's own arguments come before it).
  if (isLauncher(cmd) && session && !cmd.includes("--session")) { const at = cmd.findIndex(c => basename(c) === "door-agent-herdr.ts") + 1; cmd = [...cmd.slice(0, at), "--session", session, ...cmd.slice(at)]; }
  const folder = ((): { cwd: string; why: string } => {
    // Chosen with the agent (host.agent in=<folder>), for this session or as your default.
    if (choice?.folder) return { cwd: tilde(choice.folder, home), why: `chosen with the agent (${choice.folder})` };
    if (o.outline) {
      try {
        const dot = nearestDotEp0ch(start, { readFile: p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } }, exists: existsSync });
        // The project of this outline on this machine (a .ep0ch naming it on another machine is another outline's).
        if (dot && dot.name === o.outline && (dot.machine ?? null) === (o.machine ?? null)) return { cwd: dot.folder, why: `the folder whose .ep0ch names ${o.outline}` };
      } catch { /* a malformed .ep0ch: the next rule */ }
      if (!o.machine) {
        const f = outlineLayout(outlinesFolder(env, home)).folder(o.outline);
        if (existsSync(f)) return { cwd: f, why: `the outline's own folder (${o.outline})` };
      }
    }
    return { cwd: start, why: "the folder the door was started from" };
  })();
  return { cmd: cmd.length ? cmd : [shell], cwd: folder.cwd, name: programName(cmd), herdr: isLauncher(cmd), from, programWhy, folderWhy: folder.why };
}

/** The command that changes it, for `ep0ch doctor` and a refusal: the drawer's picker, or `act host.agent`. */
export const CHANGE_AGENT = "alt+g in the drawer (its picker), or `ep0ch act host.agent name=<agent> [herdr=true] [default=true]`";
