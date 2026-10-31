// A named agent (loki, kitty, cowboy) is one hc terminal: started on purpose, kept, attached by name.
// One launch line, used by `ep0ch agent start`, the drawer's card and `ep0ch install --apply`.
// Nobody writes the hc flags twice. The drawer never starts the process; it only attaches, or shows the card.
//
// Herdr stays a window host. It is not a fallback for this. ^W o s then `claude` stays a shell tile.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMachineName, nearestDotEp0ch, type LocationReader } from "@ep0ch/outline-core/outline-location";
import { words } from "../text";

/** An hc terminal name: 1–32 of [a-z0-9_-], starting with a letter or digit. */
export const HC_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** One row of `.ep0ch/agents.toml`. `machine` empty: this machine (`hc run` omits `--on`). */
export interface NamedAgent {
  persona: string;
  machine: string;
  folder: string;
  program: string;
  outline: string;
}

export interface HcListTerm {
  address: string;
  name?: string | null;
  state?: string | null;
  agent?: string | null;
  status?: string | null;
}

export interface HcGot {
  name?: string;
  address?: string;
  state?: string;
  exit_code?: number | null;
  reason?: string | null;
  labels?: Record<string, string> | null;
  error?: { kind?: string; message?: string };
}

export type NamedLook =
  | { kind: "live"; address: string; argv: string[] }
  | { kind: "missing"; title: string; lines: string[]; buttons: [string, string][] }
  | { kind: "ended"; title: string; lines: string[]; exit: number | null; buttons: [string, string][] }
  | { kind: "taken"; title: string; lines: string[]; buttons: [string, string][] }
  | { kind: "unreachable"; title: string; lines: string[]; buttons: [string, string][] };

const START = "named.start";
const SHELL = "host.shell";
const buttons = (persona: string): [string, string][] => [[`start ${persona}`, START], ["a shell here", SHELL]];

/** Where the process runs, as hc addresses it (`float-box/loki`, or `loki` on this machine). */
export function hcAddress(a: Pick<NamedAgent, "persona" | "machine">): string {
  return a.machine ? `${a.machine}/${a.persona}` : a.persona;
}

/**
 * The one launch line. `--bg --no-parent --keep`: not a door tile's child, survives the door,
 * a crash leaves a shell and does not rerun the program. `--rm` is never set (it would drop a phone session).
 */
export function hcRunArgv(a: NamedAgent): string[] {
  const program = words(a.program);
  if (!program.length) throw new Error(`ep0ch agent start ${a.persona}: program is empty`);
  return [
    "hc", "run", "--bg", "--no-parent", "--keep",
    "--name", a.persona,
    "--cwd", a.folder,
    "--label", `ep0ch.outline=${a.outline}`,
    "--label", `ep0ch.persona=${a.persona}`,
    ...(a.machine ? ["--on", a.machine] : []),
    "--", ...program,
  ];
}

/** Attach. `observe`: a second door or the phone watches and does not type. The drawer's own tile does not observe. */
export function hcAttachArgv(a: Pick<NamedAgent, "persona" | "machine">, observe = false): string[] {
  return ["hc", "attach", ...(observe ? ["--observe"] : []), hcAddress(a)];
}

function where(a: NamedAgent): string {
  return a.machine || "this machine";
}

function onMachine(a: NamedAgent, address: string): boolean {
  if (!a.machine) return !address.includes("/");
  return address === hcAddress(a) || address.startsWith(`${a.machine}/`);
}

function labelsAgree(a: NamedAgent, labels: Record<string, string> | null | undefined): boolean {
  if (!labels) return true;
  if (labels["ep0ch.persona"] && labels["ep0ch.persona"] !== a.persona) return false;
  if (labels["ep0ch.outline"] && labels["ep0ch.outline"] !== a.outline) return false;
  return true;
}

/** What the drawer shows, from `hc ls` and `hc get`. No I/O. */
export function lookNamed(a: NamedAgent, terms: readonly HcListTerm[], got: HcGot | null, tail: string[] = [], hcError?: string): NamedLook {
  const argv = hcAttachArgv(a);
  const here = terms.filter(t => t.state !== "finished" && onMachine(a, t.address));
  const live = here.find(t => t.name === a.persona && (t.state ?? "live") === "live");
  if (live) {
    if (got && !labelsAgree(a, got.labels)) {
      return {
        kind: "taken",
        title: `${a.persona} on ${where(a)} is not this outline's agent`,
        lines: [
          `hc name ${a.persona} is live at ${live.address}, and its labels are not ep0ch.outline=${a.outline} ep0ch.persona=${a.persona}.`,
          "Nothing was started.",
          "Close that terminal, or pick another persona in .ep0ch/agents.toml.",
        ],
        buttons: [["a shell here", SHELL]],
      };
    }
    return { kind: "live", address: live.address, argv };
  }
  if (hcError) {
    return {
      kind: "unreachable",
      title: `can't list hc terminals on ${where(a)}`,
      lines: [hcError, "Run: hc server status"],
      buttons: buttons(a.persona),
    };
  }
  const listed = here.length
    ? ["hc ls there:", ...here.slice(0, 8).map(t => `- ${t.address}${t.agent ? ` ${t.agent}` : ""}${t.status ? ` ${t.status}` : ""}`)]
    : ["hc ls there: nothing"];
  if (got?.state === "finished") {
    const exit = got.exit_code ?? null;
    return {
      kind: "ended",
      title: `${a.persona} on ${where(a)} ended${exit !== null ? ` (exit ${exit})` : got.reason ? ` (${got.reason})` : ""}`,
      lines: [...(tail.length ? tail : ["(hc read had no last lines)"]), "", ...listed],
      exit,
      buttons: buttons(a.persona),
    };
  }
  return {
    kind: "missing",
    title: `no agent named ${a.persona} on ${where(a)}`,
    lines: listed,
    buttons: buttons(a.persona),
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
    out.push({ persona, machine, folder: tilde(folderRaw, home), program, outline });
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
  return rows.find(r => r.persona === dot.agent) ?? null;
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

function runHc(args: string[], env: Record<string, string | undefined>): Ran {
  const hc = env.HC_BIN || "hc";
  const r = Bun.spawnSync([hc, ...args], {
    env: env as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 8_000,
  });
  return { code: r.exitCode ?? 127, out: r.stdout.toString(), err: r.stderr.toString() };
}

function hcFailure(ran: Ran): string {
  const text = (ran.err || ran.out).trim();
  try {
    const j = JSON.parse(text) as { error?: { message?: string; kind?: string } };
    if (j.error?.message) return `hc: ${j.error.message}${j.error.kind ? ` (${j.error.kind})` : ""}. Run: hc server status`;
  } catch { /* prose */ }
  if (ran.code === 127 || /not found|ENOENT/.test(text)) return "hc isn't on PATH. Install herder-core, then: hc server status";
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
export function seeNamed(a: NamedAgent, env: Record<string, string | undefined> = process.env): NamedLook {
  const listed = runHc(["ls", "--json"], env);
  if (listed.code !== 0) return lookNamed(a, [], null, [], hcFailure(listed));
  let terms: HcListTerm[] = [];
  try { terms = parseLs(listed.out); }
  catch { return lookNamed(a, [], null, [], "hc ls --json was not JSON. Run: hc server status"); }
  const gotRan = runHc(["get", "--json", hcAddress(a)], env);
  const got = parseGet(gotRan.out, gotRan.err);
  let tail: string[] = [];
  if (got?.state === "finished") {
    const read = runHc(["read", "--lines", "8", hcAddress(a)], env);
    tail = read.out.split("\n").map(s => s.trimEnd()).filter(s => s.trim()).slice(-8);
  }
  return lookNamed(a, terms, gotRan.code === 0 || got?.state ? got : null, tail);
}

export type StartResult =
  | { ok: true; started: boolean; address: string; argv: string[] }
  | { ok: false; error: string };

/**
 * Start the terminal, or refuse when that name is already live (no second process).
 * A finished name can be started again: hc frees it. A live one is left alone, including Remote Control.
 */
export function startNamedAgent(a: NamedAgent, env: Record<string, string | undefined> = process.env): StartResult {
  if (!HC_NAME.test(a.persona)) return { ok: false, error: `ep0ch agent start: ${JSON.stringify(a.persona)} is not an hc name (lowercase letters, digits, _ and -, at most 32)` };
  const seen = seeNamed(a, env);
  if (seen.kind === "live") return { ok: true, started: false, address: seen.address, argv: hcRunArgv(a) };
  if (seen.kind === "taken") return { ok: false, error: seen.lines.join(" ") };
  if (seen.kind === "unreachable") return { ok: false, error: seen.lines.join(" ") };
  const argv = hcRunArgv(a);
  const ran = runHc(argv.slice(1), env);
  if (ran.code !== 0) return { ok: false, error: `ep0ch agent start ${a.persona}: ${hcFailure(ran)}` };
  let address = hcAddress(a);
  try {
    const j = JSON.parse(ran.out) as { address?: string; name?: string };
    if (j.address) address = a.machine && !j.address.includes("/") ? `${a.machine}/${j.address}` : j.address;
  } catch { /* hc printed prose; the name still addresses it */ }
  return { ok: true, started: true, address, argv };
}

export interface Ensured { lines: string[] }

/**
 * Start this machine's named agents that are down. A live terminal is left alone.
 * `here` is this machine's ssh name. A row with no machine runs here. A row for another machine is skipped.
 * Failures are lines, not a thrown error: install has already moved the checkout.
 */
export function ensureNamedAgents(o: {
  home: string;
  here: string;
  extra?: string[];
  env?: Record<string, string | undefined>;
}): Ensured {
  const env = o.env ?? process.env;
  const lines: string[] = [];
  let files: string[] = [];
  try { files = findAgentTomls(o.home, o.extra ?? []); }
  catch (e) { return { lines: [`named agents: couldn't look for .ep0ch/agents.toml (${(e as Error).message})`] }; }
  for (const file of files) {
    let rows: NamedAgent[] = [];
    try {
      const outline = file.split("/.ep0ch/")[0]?.split("/").pop() || "outline";
      const text = readFileSync(file, "utf8");
      let ws = outline;
      try {
        const dot = nearestDotEp0ch(join(file, "..", ".."), { readFile: p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } }, exists: existsSync });
        if (dot) ws = dot.name;
      } catch { /* the row's outline label falls back to the folder name */ }
      rows = parseAgentsToml(text, file, ws, o.home);
    } catch (e) { lines.push((e as Error).message); continue; }
    for (const agent of rows) {
      if (agent.machine && agent.machine !== o.here) continue;
      const r = startNamedAgent(agent, env);
      if (!r.ok) lines.push(r.error);
      else lines.push(r.started ? `started ${agent.persona} at ${r.address}` : `${agent.persona} already live at ${r.address}`);
    }
  }
  return { lines };
}
