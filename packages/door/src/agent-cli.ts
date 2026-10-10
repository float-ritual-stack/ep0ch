// `ep0ch agent` (PIE-737): start an agent session in this folder, or attach the one running here, in the door on this
// folder's outline. It is `act agent.start` on that door (src/drawer.ts), as an agent: the session opens as a tab in the
// drawer, behind the one shown, and the person's keys stay where they are; the door says it on its status bar.
import { resolve } from "node:path";
import { ask } from "./jsonl";
import { resolveDoor } from "./door-resolve";

export const AGENT_USAGE = `  ep0ch agent [--program <name>] [--in <folder>] [--persona <name>] [--new] [--json]
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
