// `ep0ch agent` (PIE-737): start an agent session in this folder, or attach the one running here, in the door on this
// folder's outline. It is `act agent.start` on that door (src/drawer.ts), as an agent: the session opens as a tab in the
// drawer, behind the one shown, and the person's keys stay where they are; the door says it on its status bar.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { nearestDotEp0ch } from "@ep0ch/outline-core/outline-location";
import { ask } from "./jsonl";
import { resolveDoor } from "./door-resolve";
import { HC_NAME, parseAgentsToml, startNamedAgent, type NamedAgent } from "./desk/named-agent";

export const AGENT_USAGE = `  ep0ch agent ls [--machine <ssh-name>] [--json]
                                   the Claude Code sessions here (or on that machine, over ssh): name, short id, kind
                                   (background: the daemon's job; interactive: a terminal owns it, with where it runs
                                   when the process's parents say), busy or waiting, and the version each runs beside
                                   the one installed, marked "behind" when it is older
  ep0ch agent restart <name | short id | --all> [--if-update] [--fresh-daemon] [--check-env <VAR>] [--now] [--dry-run]
                      [--machine <ssh-name>]
                                   restart a background session at a safe moment (between turns, its builders done
                                   and pushed), detached: it prints where the log is and returns. An interactive one
                                   is its terminal's: refused, with how. --if-update: only one behind the installed
                                   version (after a Claude Code update); --all: every background session, one at a
                                   time (interactive ones left out, said); --fresh-daemon: so a changed ~/.bashrc
                                   reaches it; --check-env: and check the new process carries <VAR>; --now: don't
                                   wait; --dry-run: say the plan, change nothing. It runs scripts/agent-restart here
                                   or on --machine (only that flag names the machine, never EP0CH_MACHINE or a .ep0ch)
  ep0ch agent splits [--session <id>] [--machine <ssh-name>] [--json]
                                   the Claude sessions running twice here (or on that machine): each process with
                                   its pid, start and state, the command that stops it and, for a background job, the
                                   one that attaches it (the door's ⚠ ×2 chip and the Claude mod read the same)
  ep0ch agent stop <pid> --session <session id> [--machine <ssh-name>]
                                   stop one process of a Claude session that runs twice (two \`claude --continue\`s
                                   on one session, both writing its transcript; the door's ⚠ ×2 chip): only while
                                   that pid is still a process of that session and another still holds it, else
                                   nothing is stopped
  ep0ch agent use <name> [--everywhere]
                                   choose and restart the drawer agent for this outline, or every outline
  ep0ch agent start <persona> [--on <machine>] [--cwd <folder>] [--program <cmd>] [--outline <name>]
                                   start that persona's hc terminal, or say it is already live. One launch
                                   line (hc run --bg --no-parent --keep --name <persona>). Flags left out
                                   come from the nearest .ep0ch/agents.toml. A live terminal is not started
                                   again, so a phone session stays up
  ep0ch agent [--program <name>] [--in <folder>] [--persona <name>] [--new] [--json]
                                   start an agent session in this folder (or --in one), or attach the one already
                                   running there: the same program in the same folder is the same session. It opens
                                   in the door on this folder's outline, as a tab in its drawer (alt+g lists every
                                   session: jump to it, pull it into the drawer, dock it), continuing the program's
                                   last conversation in that folder. --program: an agent config in the outline
                                   ([agent-config::<name>]) or one installed here (claude, codex, pi); left out, the
                                   drawer's agent, else claude. --new starts another beside the one running`;

/** The arguments `ep0ch agent` takes, as agent.start's; or what's wrong. */
export function agentArgs(argv: readonly string[], cwd = process.cwd()): { args: Record<string, unknown>; json: boolean } | { error: string } {
  const args: Record<string, unknown> = { in: cwd };
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (key: string) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      i++;
      args[key] = key === "in" ? resolve(cwd, v.replace(/^~(?=$|\/)/, process.env.HOME ?? "~")) : v;
    };
    try {
      if (a === "--program") value("program");
      else if (a === "--in") value("in");
      else if (a === "--persona") value("persona");
      else if (a === "--new") args.fresh = true;
      else if (a === "--json") json = true;
      else return { error: `ep0ch agent: no flag ${a} · ep0ch agent [--program <name>] [--in <folder>] [--persona <name>] [--new] [--json]` };
    } catch (e) { return { error: `ep0ch agent: ${(e as Error).message}` }; }
  }
  return { args, json };
}

export async function agentCommand(argv: readonly string[], env: Record<string, string | undefined> = process.env, cwd = process.cwd()): Promise<number> {
  if (argv[0] === "splits") {
    const [{ agentSplits }, { realFleetIO }] = await Promise.all([import("./claude-splits"), import("./agent-fleet")]);
    return agentSplits(argv.slice(1), env, realFleetIO);
  }
  if (argv[0] === "ls" || argv[0] === "restart" || argv[0] === "stop") {
    const { agentLs, agentRestart, agentStop, realFleetIO } = await import("./agent-fleet");
    return (argv[0] === "ls" ? agentLs : argv[0] === "stop" ? agentStop : agentRestart)(argv.slice(1), env, realFleetIO);
  }
  if (argv[0] === "use") {
    const name = argv[1];
    if (!name || name.startsWith("--") || argv.slice(2).some(a => a !== "--everywhere")) {
      console.error("ep0ch agent use <name> [--everywhere]"); return 2;
    }
    const door = await resolveDoor(env, cwd);
    if (!door.path) { console.error(`ep0ch agent: ${door.text}`); return 1; }
    const r = await ask(door.path, { cmd: "act", action: "host.agent", args: { name, default: argv.includes("--everywhere") }, as: env.EP0CH_AGENT || "ep0ch-agent" }, 30_000);
    if (!r?.ok) { console.error(`ep0ch agent: ${r?.error ?? "no door answered"}`); return 1; }
    console.log(JSON.stringify(r.result)); return 0;
  }
  if (argv[0] === "start") return agentStart(argv.slice(1), env, cwd);
  const parsed = agentArgs(argv, cwd);
  if ("error" in parsed) { console.error(parsed.error); return 2; }
  const door = await resolveDoor(env, cwd);
  if (!door.path) { console.error(`ep0ch agent: ${door.text}`); return 1; }
  const r = await ask(door.path, { cmd: "act", action: "agent.start", args: parsed.args, as: env.EP0CH_AGENT || "ep0ch-agent" }, 30_000);
  if (!r) { console.error(`ep0ch agent: no door answered at ${door.path} · \`ep0ch session list\` says what runs`); return 1; }
  if (!r.ok) { console.error(`ep0ch agent: ${r.error}`); return 1; }
  const out = r.result as { attached?: boolean; id?: string; program?: string; folder?: string; tile?: string; resumed?: boolean; where?: string };
  if (parsed.json) console.log(JSON.stringify(out));
  else if (out.attached) console.log(`${out.id} runs already (${out.where}) · alt+g in the door lists it: ⏎ jumps to it`);
  else console.log(`started ${out.program} in ${out.folder}${out.resumed ? ", continuing its last conversation there" : ""} · a tab in the door's drawer (${out.tile}) · alt+a shows it, alt+g lists every session`);
  return 0;
}

const START_USAGE = "ep0ch agent start <persona> [--on <machine>] [--cwd <folder>] [--program <cmd>] [--outline <name>]";

/** The one `hc run` line. Flags left out are the persona's row in the nearest `.ep0ch/agents.toml`. */
async function agentStart(argv: readonly string[], env: Record<string, string | undefined>, cwd: string): Promise<number> {
  let persona = "", machine: string | undefined, folder: string | undefined, program: string | undefined, outline: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === "--on") machine = value();
      else if (a === "--cwd") folder = value();
      else if (a === "--program") program = value();
      else if (a === "--outline") outline = value();
      else if (a.startsWith("--")) throw new Error(`no flag ${a}`);
      else if (!persona) persona = a;
      else throw new Error(`unexpected ${a}`);
    } catch (e) { console.error(`ep0ch agent start: ${(e as Error).message}\n${START_USAGE}`); return 2; }
  }
  if (!persona) { console.error(START_USAGE); return 2; }
  if (!HC_NAME.test(persona)) { console.error(`ep0ch agent start: ${JSON.stringify(persona)} is not an hc name (lowercase letters, digits, _ and -, at most 32)`); return 2; }
  const home = env.HOME ?? homedir();
  const readFile = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };
  let agent: NamedAgent;
  try {
    const dot = nearestDotEp0ch(cwd, { readFile, exists: existsSync });
    const file = dot ? join(dot.folder, ".ep0ch", "agents.toml") : null;
    const text = file ? readFile(file) : undefined;
    const row = text !== undefined ? parseAgentsToml(text, file!, dot!.name, home).find(r => r.persona === persona) : undefined;
    const ws = outline ?? row?.outline ?? dot?.name;
    if (!ws || (!row && !folder)) throw new Error(`no launch line for ${persona}. Add an [[agent]] row in .ep0ch/agents.toml, or pass --cwd <folder> --outline <name>.`);
    agent = { persona, machine: machine ?? row?.machine ?? "", folder: folder ?? row!.folder, program: program ?? row?.program ?? "claude", outline: ws, ...(dot?.machine ? { outlineMachine: dot.machine } : {}) };
  } catch (e) { console.error(`ep0ch agent start: ${(e as Error).message}`); return 2; }
  const r = await startNamedAgent(agent, env);
  if (!r.ok) { console.error(r.error); return 1; }
  console.log(r.started ? `started ${agent.persona} at ${r.address}` : `${agent.persona} already live at ${r.address}`);
  return 0;
}
