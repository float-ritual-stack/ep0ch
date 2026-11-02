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
