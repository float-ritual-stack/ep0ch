// What the drawer's own tab runs (PIE-498): the agent the person chose for this outline's session, and the folder it
// starts in. One answer, read where the drawer makes its tile, where its picker lists the choices and where
// `ep0ch doctor` says it, so they never disagree.
//
// - The agent: EP0CH_DAILY_AGENT when set (an override, for a test door or a one-off); else the named persona in .ep0ch/agents.toml; else the choice saved for this
//   outline's session (drawer-agent.json in its folder of the state dir, made by the drawer's picker, `host.agent`); else
//   the person's default (drawer-agent.json in the state dir, `host.agent default=true`); else none chosen yet: a shell,
//   and the drawer offers its picker the first time it's pulled up.
// - The agents offered: those installed here (Herdr's supported agent kinds, found on PATH), and always a shell.
//   A named agent (`.ep0ch` `agent` plus `.ep0ch/agents.toml`) is an hc terminal:
//   the drawer attaches, or shows a card. It never starts the process.
// - Every agent that runs in a tile starts inside the person's login shell (`inLoginShell`): when it exits, or
//   crashes, the tile is a working shell in the same folder with the same environment, and says the agent exited.
//   Nothing restarts it. An `hc attach` is not wrapped: the shell would say the agent exited while it still runs.
// - The folder: the one chosen with the agent (`host.agent in=<folder>`); else the folder of the nearest `.ep0ch` above where the door
//   was started, when it names this outline (the project); else the outline's own folder (`<outlines>/<name>/`, an
//   outline on this machine); else the folder the door was started from. Claude Code's /resume lists one folder's
//   conversations, so the folder is the person's or the outline's, never one made up.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { nearestDotEp0ch, outlineLayout, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { words } from "../text";
import { hcAttachArgv, namedFromFolder, type NamedAgent } from "./named-agent";

/** The folder the door was started from (a session's daemon: where its first client started it). */
const START = process.cwd();

/** An agent the drawer can run: its name and its command. */
export interface DrawerAgent { name: string; cmd: string[] }
/** What a choice is saved as (drawer-agent.json): the agent by name or command line, where it runs, and in which folder. */
export interface DrawerChoice { agent: string; folder?: string }

export interface DrawerProgram {
  cmd: string[];
  cwd: string;
  /** What the drawer's own tab is called: the agent's name (`claude`, `codex`), or `shell`. */
  name: string;
  /** Where the choice came from. `named`: `.ep0ch/agents.toml` names this outline's persona. */
  from: "env" | "session" | "default" | "none" | "named";
  /** Why this program, in words (`ep0ch doctor`, `peek`). */
  programWhy: string;
  /** Why this folder, in words. */
  folderWhy: string;
  /** Set when this outline's persona has a row in `.ep0ch/agents.toml`. The drawer attaches or shows a card. */
  named?: NamedAgent;
}

/**
 * The agent kinds Herdr supports (`herdr agent start --kind`), and aider, each by the command that starts it. Found
 * on PATH, they're offered; Herdr detects them in its panes. Read from Herdr's own list when it's updated. The third
 * word, where there is one, is the `app` the agent names itself with in its OSC 7501 reports when that isn't its
 * program's name (`agentOfApp`, src/desk/agent-sessions.ts): the Claude mod and Claude Code say `claude-code`.
 */
export const KNOWN_AGENTS: readonly [name: string, cmd: string, app?: string][] = [
  ["claude", "claude", "claude-code"], ["codex", "codex"], ["pi", "pi"], ["gemini", "gemini"], ["opencode", "opencode"], ["aider", "aider"],
  ["amp", "amp"], ["cursor", "cursor-agent"], ["copilot", "copilot"], ["goose", "goose"], ["droid", "droid"], ["qwen", "qwen"],
  ["kimi", "kimi"], ["grok", "grok"], ["hermes", "hermes"], ["cline", "cline"], ["kilo", "kilo"], ["letta", "letta"],
];
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "nu", "elvish"]);
/** A shell's program name (`bash`, `-zsh` as a login shell names itself, `/bin/sh`). */
export const isShellName = (name: string) => SHELLS.has(basename(name).replace(/^-/, ""));
const tilde = (s: string, home: string) => s.trim().replace(/^~(?=$|\/)/, home);
/** The tab's name for a program: the agent it runs, shell, or the program's own name. */
export function programName(cmd: readonly string[]): string {
  const first = basename(cmd[0] ?? "");
  if (SHELLS.has(first)) return "shell";
  const known = KNOWN_AGENTS.find(([, c]) => c === first);
  if (known) return known[0];
  if (/claude/.test(first)) return "claude";
  return first.replace(/\.[jt]s$/, "") || "shell";
}

/**
 * A command that starts an agent (one of KNOWN_AGENTS) runs inside the person's shell.
 * An hc attachment ends independently of the kept agent, so it is not wrapped.
 */
export function isAgentCmd(cmd: readonly string[]): boolean {
  const first = basename(cmd[0] ?? "");
  return KNOWN_AGENTS.some(([, c]) => c === first) || /claude/.test(first);
}

/** A word as the shell reads it back. */
export { shellQuote } from "@ep0ch/outline-core/shell-word";
import { shellQuote } from "@ep0ch/outline-core/shell-word";

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

/** The agents installed here, a shell first. */
export function detectAgents(o: { env?: Record<string, string | undefined>; which?: (c: string) => string | null; session?: string | null } = {}): DrawerAgent[] {
  const env = o.env ?? process.env, which = o.which ?? ((c: string) => Bun.which(c, { PATH: env.PATH ?? "" }));
  const shell = env.SHELL || "sh";
  const found = KNOWN_AGENTS.filter(([, c]) => !!which(c)).map(([name, c]) => ({ name, cmd: [c] }));
  return [{ name: "shell", cmd: [shell] }, ...found];
}

/** This session's label: the outline, and its machine when it's on another (`pie-hole@float-2`). */
export const sessionLabel = (p: { outline?: string | null; machine?: string | null }) => (p.outline ? `${p.outline}${p.machine ? `@${p.machine}` : ""}` : null);

const readChoice = (file: string): DrawerChoice | null => {
  try { const x = JSON.parse(readFileSync(file, "utf8")); return x && typeof x.agent === "string" && x.agent.trim() ? { agent: x.agent.trim(), ...(typeof x.folder === "string" && x.folder.trim() ? { folder: x.folder.trim() } : {}) } : null; } catch { return null; }
};
/** The choice file of a session's folder (`dir`), or the person's default (the state dir). */
export const choiceFile = (dir: string) => join(dir, "drawer-agent.json");

/**
 * The drawer's program and folder, read now. `dir`: this session's folder of the state dir (its saved choice);
 * `state`: the state dir (the person's default).
 */
export function drawerProgram(o: { env?: Record<string, string | undefined>; outline?: string | null; machine?: string | null; start?: string; home?: string; dir?: string | null; state?: string | null; picked?: boolean } = {}): DrawerProgram {
  const env = o.env ?? process.env, home = o.home ?? env.HOME ?? homedir(), start = o.start ?? START;
  const shell = env.SHELL || "sh";
  const session = sessionLabel(o);
  const set = env.EP0CH_DAILY_AGENT?.trim();
  const saved = o.dir ? readChoice(choiceFile(o.dir)) : null;
  const dflt = !saved && o.state ? readChoice(choiceFile(o.state)) : null;
  const choice = saved ?? dflt;
  const folderOf = ((): { cwd: string; why: string } => {
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
  const answer = (cmd: string[], from: DrawerProgram["from"], programWhy: string, extra: { cwd?: string; folderWhy?: string; name?: string; named?: NamedAgent } = {}): DrawerProgram => ({
    cmd: cmd.length ? cmd : [shell], cwd: extra.cwd ?? folderOf.cwd, name: extra.name ?? programName(cmd), from, programWhy,
    folderWhy: extra.folderWhy ?? folderOf.why, ...(extra.named ? { named: extra.named } : {}),
  });
  // A scratch door's explicit shell keeps it off any configured agent.
  if (set) {
    return answer(words(set), "env", `EP0CH_DAILY_AGENT (${set}), which overrides the drawer's choice. Check ~/.zshrc, ~/.zprofile, ~/.profile or the door launcher; remove: export EP0CH_DAILY_AGENT=${shellQuote(set)}`);
  }
  if (o.outline && !o.picked) {
    try {
      const named = namedFromFolder({ start, outline: o.outline, machine: o.machine ?? null, home });
      if (named) {
        const where = named.machine || "this machine";
        return answer(hcAttachArgv(named, false, env), "named", `named agent ${named.persona} on ${where}: the drawer attaches when that hc terminal is live, and shows a card when it is not. Start it with: ep0ch agent start ${named.persona}.`, {
          cwd: named.folder, folderWhy: `the folder in .ep0ch/agents.toml (${named.folder})`, name: named.persona, named,
        });
      }
    } catch (e) { return answer([shell], "none", (e as Error).message); }
  }
  if (choice) {
    const agent = words(choice.agent === "shell" ? shell : choice.agent);
    return answer(agent, saved ? "session" : "default", `${saved ? `chosen for ${session ?? "this session"}` : "your default"} (${choice.agent})`);
  }
  return answer([shell], "none", "a shell: no agent chosen yet (the drawer's picker, alt+g, chooses one)");
}

/** The command that changes it, for `ep0ch doctor` and a refusal: the drawer's picker, or `act host.agent`. */
export const CHANGE_AGENT = "alt+click (or right-click) the drawer agent chip, or `ep0ch agent use <name> [--everywhere]`";
