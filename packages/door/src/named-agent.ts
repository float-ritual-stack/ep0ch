import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { nearestDotEp0ch } from "@ep0ch/outline-core/outline-location";
import { isLocalMachine } from "@ep0ch/outliner/machine-name";
import { words } from "./text";
import { AGENT_VARS, DOOR_START_VARS, PLACE_VAR } from "./desk/agent-env";

type Env = Record<string, string | undefined>;
export interface NamedAgent { persona: string; machine: string; folder: string; program: string[]; outline: string; outlineMachine?: string }
export interface HcRow { address: string; name?: string; state: string; agent?: string; cwd: string }
export interface HcStatus { state: "idle" | "working" | "done" | "blocked" | "error"; app?: string; msg?: string; title?: string; kind?: "permission" | "question" | "auth" | null; progress?: number | null }
export interface HcTerminal extends HcRow { argv: string[]; pid: number | null; exit_code: number | null; reason: string | null; status: HcStatus | null; records: Record<string, HcStatus>; labels: Record<string, string> }

export const localAgentMachine = (machine: string, env: Env = process.env) => machine === "local" || isLocalMachine(machine, env);
export const agentAddress = (a: Pick<NamedAgent, "machine" | "persona">, env: Env = process.env) => localAgentMachine(a.machine, env) ? a.persona : `${a.machine}/${a.persona}`;

export function agentBinding(folder = process.cwd()) {
  return nearestDotEp0ch(folder, { exists: existsSync, readFile: p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } } });
}

/** The only reader of the person's named-agent launch lines. */
export function namedAgents(folder = process.cwd()): NamedAgent[] {
  const dot = agentBinding(folder);
  if (!dot) return [];
  const file = join(dot.folder, ".ep0ch/agents.toml");
  if (!existsSync(file)) return [];
  const data = Bun.TOML.parse(readFileSync(file, "utf8")) as { agents?: unknown };
  if (!Array.isArray(data.agents)) throw new Error(`${file}: use [[agents]] with persona, machine, folder and program`);
  return data.agents.map((v: any) => {
    if (!v || typeof v.persona !== "string" || !/^[a-z0-9_-]{1,32}$/.test(v.persona) || typeof v.machine !== "string" || !v.machine || typeof v.folder !== "string" || !v.folder || !(typeof v.program === "string" || Array.isArray(v.program) && v.program.length && v.program.every((x: unknown) => typeof x === "string"))) throw new Error(`${file}: each [[agents]] needs persona (a-z, 0-9, -, _), machine, folder and program`);
    const program = typeof v.program === "string" ? words(v.program) : v.program;
    if (!program.length) throw new Error(`${file}: ${v.persona} needs a program`);
    return { persona: v.persona, machine: v.machine, folder: v.folder, program, outline: dot.name, ...(dot.machine ? { outlineMachine: dot.machine } : {}) };
  });
}

export async function hc(args: string[], env: Env = process.env): Promise<string> {
  const p = Bun.spawn(["hc", ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`hc ${args.join(" ")}: ${err.trim() || `exit ${code}`} · hc ls shows the terminals`);
  return out.trim();
}

/** hc owns the terminal list, including finished names and machine-qualified addresses. */
export async function agentTerminals(a: Pick<NamedAgent, "machine">, env: Env = process.env): Promise<HcRow[]> {
  const { terminals } = JSON.parse(await hc(["ls", "--all"], env)) as { terminals: HcRow[] };
  return terminals.filter(t => localAgentMachine(a.machine, env) ? !t.address.includes("/") : t.address.startsWith(`${a.machine}/`));
}
export const readTerminal = async (address: string, env: Env = process.env): Promise<HcTerminal> => JSON.parse(await hc(["get", address], env));

/** The one owner of starting a named agent: CLI, the drawer card and install all call here. */
export async function startNamedAgent(a: NamedAgent, env: Env = process.env): Promise<HcTerminal> {
  const live = (await agentTerminals(a, env)).find(t => t.name === a.persona && t.state === "live");
  if (live) return readTerminal(live.address, env);
  const local = localAgentMachine(a.machine, env);
  const folder = local ? resolve(a.folder.replace(/^~(?=$|\/)/, env.HOME ?? "~")) : a.folder;
  const result = JSON.parse(await hc(["run", "--bg", "--no-parent", "--keep", "--name", a.persona,
    ...(!local ? ["--on", a.machine] : []), "--cwd", folder,
    "--label", `ep0ch.outline=${a.outline}`, "--label", `ep0ch.persona=${a.persona}`,
    // A kept agent belongs to its outline, not to whichever door first started the core.
    "--", "env", ...[...AGENT_VARS, ...DOOR_START_VARS, PLACE_VAR, "EP0CH_SOCKET", "EP0CH_MACHINE"].flatMap(k => ["-u", k]),
    `EP0CH_WS=${a.outline}`, ...(a.outlineMachine ? [`EP0CH_MACHINE=${a.outlineMachine}`] : []),
    `EP0CH_AGENT=${a.persona}`, `OUTLINER_ACTOR=${a.persona}`, ...a.program], env));
  return readTerminal(result.address, env);
}

/** Install restarts only agents declared for this machine, through the same launcher as a deliberate start. */
export async function restartNamedAgents(folder: string, env: Env = process.env): Promise<HcTerminal[]> {
  const result: HcTerminal[] = [];
  for (const a of namedAgents(folder).filter(a => localAgentMachine(a.machine, env))) {
    const live = (await agentTerminals(a, env)).find(t => t.name === a.persona && t.state === "live");
    if (live) await hc(["kill", live.address], env);
    result.push(await startNamedAgent(a, env));
  }
  return result;
}

export async function namedAgentCommand(argv: readonly string[], env: Env, cwd: string): Promise<number> {
  try {
    const persona = argv[0];
    if (!persona || persona.startsWith("--")) throw new Error("ep0ch agent start <persona> [--on <machine>] [--cwd <folder>]");
    const agent = namedAgents(cwd).find(a => a.persona === persona);
    if (!agent) throw new Error(`no launch line for ${persona} in .ep0ch/agents.toml · add [[agents]] with persona, machine, folder and program`);
    for (let i = 1; i < argv.length; i += 2) {
      const key = argv[i], value = argv[i + 1];
      if (!value || value.startsWith("--") || !["--on", "--cwd"].includes(key!)) throw new Error("ep0ch agent start <persona> [--on <machine>] [--cwd <folder>]");
      if (key === "--on") agent.machine = value; else agent.folder = value;
    }
    const terminal = await startNamedAgent(agent, env);
    console.log(`${agentAddress(agent, env)} · ${terminal.state} (${terminal.address}) · hc attach ${agentAddress(agent, env)}`);
    return 0;
  } catch (e) { console.error((e as Error).message); return 1; }
}
