// A named agent (fern, moss, reed) is one hc terminal: started on purpose, kept, attached by name.
// One launch line, used by `ep0ch agent start`, the drawer's card and `ep0ch install --apply`.
// Nobody writes the hc flags twice. The drawer never starts the process; it only attaches, or shows the card.
//
// Herdr stays a window host. It is not a fallback for this. ^W o s then `claude` stays a shell tile.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMachineName, nearestDotEp0ch, type LocationReader } from "@ep0ch/outline-core/outline-location";
import { words } from "../text";
import { isLocalMachine } from "@ep0ch/outliner/machine-name";
import { AGENT_VARS, DOOR_START_VARS, PLACE_VAR, outerClaudeVar } from "./agent-env";

/** An hc terminal name: 1–32 lowercase letters, digits, underscores or hyphens. */
export const HC_NAME = /^[a-z0-9_-]{1,32}$/;

/** One row of `.ep0ch/agents.toml`. `machine` empty: this machine (`hc run` omits `--on`). */
export interface NamedAgent {
  persona: string;
  machine: string;
  folder: string;
  program: string;
  outline: string;
  outlineMachine?: string;
  /** A restored card resolves this folder's declaration again before starting a program. */
  declarationFolder?: string;
}

export interface HcListTerm {
  address: string;
  name?: string | null;
  state?: string | null;
  agent?: string | null;
  status?: string | null;
}

export interface HcStatus {
  state: "idle" | "working" | "done" | "blocked" | "error";
  app?: string; msg?: string; title?: string; kind?: "permission" | "question" | "auth" | null; progress?: number | null;
}

export interface HcGot {
  name?: string;
  pid?: number | null;
  status?: HcStatus | null;
  records?: Record<string, HcStatus>;
  address?: string;
  state?: string;
  exit_code?: number | null;
  reason?: string | null;
  labels?: Record<string, string> | null;
  error?: { kind?: string; message?: string };
}

export type NamedLook =
  | { kind: "live"; address: string; argv: string[]; terminal: HcGot }
  | { kind: "missing"; title: string; lines: string[]; buttons: [string, string][] }
  | { kind: "ended"; title: string; lines: string[]; exit: number | null; buttons: [string, string][] }
  | { kind: "unreachable"; title: string; lines: string[]; buttons: [string, string][] };

const START = "named.start";
const SHELL = "named.shell";
export const namedAgentButtons = (persona: string): [string, string][] => [[`ep0ch agent start ${persona}`, START], ["a shell here", SHELL]];

/** Where the process runs, as hc addresses it (`garden-box/fern`, or `fern` on this machine). */
export const localAgent = (machine: string, env: Record<string, string | undefined> = process.env) => !machine || isLocalMachine(machine, env);

export function hcAddress(a: Pick<NamedAgent, "persona" | "machine">, env: Record<string, string | undefined> = process.env): string {
  return localAgent(a.machine, env) ? a.persona : `${a.machine}/${a.persona}`;
}

/**
 * The one launch line. `--bg --no-parent --keep`: not a door tile's child, survives the door,
 * a crash leaves a shell and does not rerun the program. `--rm` is never set (it would drop a phone session).
 */
export function hcRunArgv(a: NamedAgent, env: Record<string, string | undefined> = process.env): string[] {
  const local = localAgent(a.machine, env);
  const program = words(a.program);
  return [
    "hc", "run", "--bg", "--no-parent", "--keep",
    "--name", a.persona,
    "--cwd", local ? resolve(tilde(a.folder, env.HOME ?? homedir())) : a.folder,
    "--label", `ep0ch.outline=${a.outline}`,
    "--label", `ep0ch.persona=${a.persona}`,
    ...(!local ? ["--on", a.machine] : []),
    // hc owns a long-lived environment: clear the door binding there, not only in this CLI.
    "--", "env", ...[...AGENT_VARS, ...DOOR_START_VARS, PLACE_VAR, "EP0CH_SOCKET", "EP0CH_STATE", "EP0CH_MACHINE", ...Object.keys(env).filter(outerClaudeVar)].flatMap(k => ["-u", k]),
    `EP0CH_WS=${a.outline}`, ...(a.outlineMachine ? [`EP0CH_MACHINE=${a.outlineMachine}`] : []),
    `EP0CH_AGENT=${a.persona}`, `OUTLINER_ACTOR=${a.persona}`, ...program,
  ];
}

/** Attach. `observe`: a second door or the phone watches and does not type. The drawer's own tile does not observe. */
export function hcAttachArgv(a: Pick<NamedAgent, "persona" | "machine">, observe = false, env: Record<string, string | undefined> = process.env): string[] {
  return ["hc", "attach", ...(observe ? ["--observe"] : []), hcAddress(a, env)];
}

function where(a: NamedAgent): string {
  return a.machine || "this machine";
}

function onMachine(a: NamedAgent, address: string, env: Record<string, string | undefined>): boolean {
  if (localAgent(a.machine, env)) return !address.includes("/");
  return address === hcAddress(a, env) || address.startsWith(`${a.machine}/`);
}

/** What the drawer shows, from `hc ls` and `hc get`. No I/O. */
export function lookNamed(a: NamedAgent, terms: readonly HcListTerm[], got: HcGot | null, tail: string[] = [], hcError?: string, env: Record<string, string | undefined> = process.env): NamedLook {
  const argv = hcAttachArgv(a, false, env);
  const here = terms.filter(t => t.state !== "finished" && onMachine(a, t.address, env));
  const live = here.find(t => t.name === a.persona && (t.state ?? "live") === "live");
  if (live) {
    return { kind: "live", address: live.address, argv, terminal: got! };
  }
  if (hcError) {
    return {
      kind: "unreachable",
      title: `can't list hc terminals on ${where(a)}`,
      lines: [hcError, "Run: hc server status"],
      buttons: namedAgentButtons(a.persona),
    };
  }
  const listed = here.length
    ? ["hc ls there:", ...here.slice(0, 8).map(t => `- ${t.name ?? t.address} (${t.address})${t.agent ? ` ${t.agent}` : ""}${t.status ? ` ${t.status}` : ""}`)]
    : ["hc ls there: nothing"];
  if (got?.state === "finished") {
    const exit = got.exit_code ?? null;
    return {
      kind: "ended",
      title: `${a.persona} on ${where(a)} ended${exit !== null ? ` (exit ${exit})` : got.reason ? ` (${got.reason})` : ""}`,
      lines: [...(tail.length ? tail : ["(hc read had no last lines)"]), "", ...listed],
      exit,
      buttons: namedAgentButtons(a.persona),
    };
  }
  return {
    kind: "missing",
    title: `no agent named ${a.persona} on ${where(a)}`,
    lines: listed,
    buttons: namedAgentButtons(a.persona),
  };
}

const tilde = (s: string, home: string) => s.trim().replace(/^~(?=$|\/)/, home);

/** `.ep0ch/agents.toml` text into rows. `outline` is that folder's `.ep0ch` name (`ws`). A bad row names the file and the fix. */
export function parseAgentsToml(text: string, file: string, outline: string, home = homedir()): NamedAgent[] {
  let parsed: { agent?: unknown };
  try { parsed = Bun.TOML.parse(text) as { agent?: unknown }; }
  catch (e) { throw new Error(`${file} is not TOML (${(e as Error).message}). Rows are [[agent]] with persona, folder, and optional machine and program.`); }
  const raw = parsed.agent;
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out: NamedAgent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error(`${file}: an [[agent]] row is empty`);
    const r = row as Record<string, unknown>;
    const persona = typeof r.persona === "string" ? r.persona.trim() : "";
    if (!HC_NAME.test(persona)) throw new Error(`${file}: persona ${JSON.stringify(persona)} is not an hc name (lowercase letters, digits, _ and -, at most 32). ep0ch agent start needs one.`);
    if (out.some(a => a.persona === persona)) throw new Error(`${file}: persona ${persona} is listed twice`);
    const machine = typeof r.machine === "string" ? r.machine.trim() : "";
    if (machine && !isMachineName(machine)) throw new Error(`${file}: machine ${JSON.stringify(machine)} is not an ssh name. Leave it out to run on this machine.`);
    const folderRaw = typeof r.folder === "string" ? r.folder.trim() : "";
    if (!folderRaw) throw new Error(`${file}: ${persona} needs folder = "<path>" (the directory hc run --cwd uses).`);
    const program = typeof r.program === "string" && r.program.trim() ? r.program.trim() : "claude";
    out.push({ persona, machine, folder: folderRaw, program, outline });
  }
  return out;
}

function reader(readFile: (p: string) => string | undefined, exists: (p: string) => boolean): LocationReader {
  return { readFile, exists };
}

/**
 * The named agent for this outline: `.ep0ch` says `agent = "<persona>"`, and `.ep0ch/agents.toml` has that row.
 * No file, or no matching persona: null (the drawer stays a shell or the saved pick). A bad file throws.
 */
export function namedFromFolder(o: {
  start: string;
  outline: string | null;
  machine: string | null;
  home: string;
  persona?: string;
  readFile?: (p: string) => string | undefined;
  exists?: (p: string) => boolean;
}): NamedAgent | null {
  if (!o.outline) return null;
  const readFile = o.readFile ?? (p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } });
  const exists = o.exists ?? existsSync;
  let dot;
  try { dot = nearestDotEp0ch(o.start, reader(readFile, exists)); } catch { return null; }
  if (!dot?.agent || dot.name !== o.outline || (dot.machine ?? null) !== (o.machine ?? null)) return null;
  const file = join(dot.folder, ".ep0ch", "agents.toml");
  const text = readFile(file);
  if (text === undefined) return null;
  const rows = parseAgentsToml(text, file, dot.name, o.home);
  const row = rows.find(r => r.persona === (o.persona ?? dot.agent));
  return row ? { ...row, declarationFolder: dot.folder, ...(dot.machine ? { outlineMachine: dot.machine } : {}) } : null;
}

const SKIP = new Set(["node_modules", "Library", ".git", ".Trash", "Caches", "cache", "backups"]);

/** `.ep0ch/agents.toml` under `home`, three levels down (a project, or outlines/<name>/<folder>). */
export function findAgentTomls(home: string, extra: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (dir: string) => {
    const file = join(dir, ".ep0ch", "agents.toml");
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    out.push(file);
  };
  const walk = (dir: string, depth: number) => {
    take(dir);
    if (depth === 0) return;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (name.startsWith(".") || SKIP.has(name)) continue;
      const child = join(dir, name);
      try { if (!statSync(child).isDirectory()) continue; } catch { continue; }
      walk(child, depth - 1);
    }
  };
  walk(home, 3);
  for (const root of extra) take(root);
  return out;
}

interface Ran { code: number; out: string; err: string }

export async function runHc(args: string[], env: Record<string, string | undefined> = process.env): Promise<Ran> {
  const p = Bun.spawn(["hc", ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

export async function hc(args: string[], env: Record<string, string | undefined> = process.env): Promise<string> {
  const r = await runHc(args, env);
  if (r.code !== 0) throw new Error(hcFailure(r));
  return r.out;
}

export const readNamedTerminal = async (address: string, env: Record<string, string | undefined> = process.env): Promise<HcGot> => JSON.parse(await hc(["get", address], env));

function hcFailure(ran: Ran): string {
  const text = (ran.err || ran.out).trim();
  try {
    const j = JSON.parse(text) as { error?: { message?: string; kind?: string } };
    if (j.error?.message) return `hc: ${j.error.message}${j.error.kind ? ` (${j.error.kind})` : ""}. Run: hc server status`;
  } catch { /* prose */ }
  if (ran.code === 127 || /not found|ENOENT/.test(text)) return "hc isn't on PATH. Install herdr-core, then: hc server status";
  return text || `hc exited ${ran.code}. Run: hc server status`;
}

function parseLs(out: string): HcListTerm[] {
  const j = JSON.parse(out) as { terminals?: HcListTerm[] };
  return Array.isArray(j.terminals) ? j.terminals : [];
}

function parseGet(out: string, err: string): HcGot | null {
  const text = out.trim() || err.trim();
  if (!text) return null;
  try { return JSON.parse(text) as HcGot; } catch { return null; }
}

/** Ask hc. Uses `env` as given, so a test's HC_SESSION never touches the person's core. */
export async function seeNamed(a: NamedAgent, env: Record<string, string | undefined> = process.env): Promise<NamedLook> {
  const listed = await runHc(["ls", "--json"], env);
  if (listed.code !== 0) return lookNamed(a, [], null, [], hcFailure(listed), env);
  let terms: HcListTerm[] = [];
  try { terms = parseLs(listed.out); }
  catch { return lookNamed(a, [], null, [], "hc ls --json was not JSON. Run: hc server status"); }
  const gotRan = await runHc(["get", "--json", hcAddress(a, env)], env);
  const got = parseGet(gotRan.out, gotRan.err);
  let tail: string[] = [];
  if (got?.state === "finished") {
    const read = await runHc(["read", "--lines", "8", hcAddress(a, env)], env);
    tail = read.out.split("\n").map(s => s.trimEnd()).filter(s => s.trim()).slice(-8);
  }
  return lookNamed(a, terms, gotRan.code === 0 || got?.state ? got : null, tail, undefined, env);
}

export type StartResult =
  | { ok: true; started: boolean; address: string; argv: string[] }
  | { ok: false; error: string };

/**
 * Start the terminal, or reuse that name when it is already live.
 * A finished name can be started again: hc frees it. A live one is left alone, including Remote Control.
 */
export async function startNamedAgent(a: NamedAgent, env: Record<string, string | undefined> = process.env): Promise<StartResult> {
  const seen = await seeNamed(a, env);
  if (seen.kind === "live") return { ok: true, started: false, address: seen.address, argv: hcRunArgv(a, env) };
  if (seen.kind === "unreachable") return { ok: false, error: seen.lines.join(" ") };
  const argv = hcRunArgv(a, env);
  const ran = await runHc(argv.slice(1), env);
  if (ran.code !== 0) return { ok: false, error: `ep0ch agent start ${a.persona}: ${hcFailure(ran)}` };
  let address = hcAddress(a, env);
  try {
    const j = JSON.parse(ran.out) as { address?: string; name?: string };
    if (j.address) address = !localAgent(a.machine, env) && !j.address.includes("/") ? `${a.machine}/${j.address}` : j.address;
  } catch { /* hc printed prose; the name still addresses it */ }
  return { ok: true, started: true, address, argv };
}

export interface Ensured { lines: string[]; ok: boolean }

/** Install restarts this machine's declared agents, using the same launch owner as the CLI and card. */
export async function ensureNamedAgents(o: {
  home: string; here: string; extra?: string[]; env?: Record<string, string | undefined>;
}): Promise<Ensured> {
  const env = o.env ?? process.env, lines: string[] = [];
  let ok = true;
  const seen = new Set<string>();
  for (const file of findAgentTomls(o.home, o.extra ?? [])) {
    try {
      const dot = nearestDotEp0ch(dirname(dirname(file)), { readFile: p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } }, exists: existsSync });
      if (!dot) throw new Error(`${file}: add ws to .ep0ch/config.toml`);
      for (const row of parseAgentsToml(readFileSync(file, "utf8"), file, dot.name, o.home)) {
        if (row.machine && row.machine !== o.here && !localAgent(row.machine, env)) continue;
        if (seen.has(row.persona)) continue;
        seen.add(row.persona);
        const agent = { ...row, machine: "", ...(dot.machine ? { outlineMachine: dot.machine } : {}) };
        const before = await seeNamed(agent, env);
        if (before.kind === "live") await hc(["kill", before.address], env);
        const r = await startNamedAgent(agent, env);
        if (!r.ok) throw new Error(r.error);
        lines.push(`${before.kind === "live" ? "restarted" : "started"} ${agent.persona} at ${r.address}`);
      }
    } catch (e) { ok = false; lines.push((e as Error).message); }
  }
  return { lines, ok };
}
