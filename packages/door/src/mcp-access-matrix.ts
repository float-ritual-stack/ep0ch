// Who can reach what (PIE-1034): which MCP caller can reach which outline, and how far, with each caller's recent use.
//
// Nothing here is a store. It reads the three places the answer already lives and combines them:
//   - each outline's grant, the owner's setting (`ep0ch mcp access`, `mcp.access.status` on the outline host);
//   - each named path's cap, `EP0CH_MCP_PATH_ACCESS` (src/mcp-writes.ts `pathCapEntry`), from the environment or
//     `~/.config/ep0ch/mcp.env`, the way the gateway reads it for every request;
//   - the usage records (src/mcp-usage.ts `readUsage`, what `ep0ch mcp usage` reads).
// The effective level is `levelFor` (src/mcp-writes.ts): the lower of the grant and the caller's cap. A cell never
// computes it a second way, so this view and the gateway can't disagree.
//
// Two kinds of caller, and the view says which: a *named path* (`/gpty/mcp`, the gateway's persona) is capped, at
// `propose` when no entry names it; a *client* (a stdio client, or a sign-in that names no path) has no cap, so it gets
// the outline's level. Usage records the outline's name without its machine, so usage joins on the name and shows for
// the outlines of the machine the records were written on.
//
// Changing a cell is the person's (ADR 0005): a plan says what would be written (the outline's grant, the path's cap, or
// both) and the command that does it; `applyPlan` runs those same commands' code. Agents read.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseActor } from "@ep0ch/outline-core/attribution";
import type { McpAccessLevel, McpAccessStatus } from "@ep0ch/outline-core/protocol";
import { canonicalLocalMachineName, isLocalMachine } from "@ep0ch/outliner/machine-name";
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { CAP_KEY, capSettings, MATRIX_DAYS, readMcpAccessFiles, type McpAccessFiles } from "@ep0ch/outliner/mcp-access-files";
import { LEVELS, levelFor, mcpEnvFile, pathCapEntry, STDIO_SUBJECT, type McpCaller } from "./mcp-writes";
import { readUsage, usageDir, type Usage } from "./mcp-usage";
import { ago } from "./text";
import { hostRequest, SocketBoard } from "./socket";
import { resolveTarget } from "./discover";
import { forwardTo } from "./machine";

export { CAP_KEY, MATRIX_DAYS };
const DAY = 86_400_000;

/** A level as the matrix says it: a glyph and a word, never a colour alone. */
export const LEVEL_MARK: Record<McpAccessLevel, { glyph: string; word: string }> = {
  none: { glyph: "✗", word: "none" }, read: { glyph: "○", word: "read" }, propose: { glyph: "♦", word: "propose" }, full: { glyph: "●", word: "full" },
};
export const levelText = (l: McpAccessLevel) => `${LEVEL_MARK[l].glyph} ${LEVEL_MARK[l].word}`;

/** An outline's grant as its host reports it. */
export interface Grant { outline: string; machine: string; level: McpAccessLevel; owner?: string; yolo?: boolean; error?: string }

export interface MatrixCaller {
  name: string;
  /** `path`: a named gateway path, capped (`propose` unless an entry says otherwise). `client`: no cap; the outline's level. */
  via: "path" | "client";
  /** The principals seen for it in usage (`claude.ai`, `claude-code@float-2`). */
  principals: string[];
  calls: number;
  lastCall: string | null;
}

export interface MatrixCell {
  caller: string; outline: string; machine: string;
  /** What this caller can do in this outline. */
  level: McpAccessLevel;
  grant: McpAccessLevel;
  /** The caller's cap here and the entry it came from (`gpty@rotfield`; null: the default); null for a client. */
  cap: { level: McpAccessLevel; entry: string | null } | null;
  /** What binds it: the outline's grant, the caller's cap (lower than the grant), or the outline's owner having full in its own. */
  limitedBy: "grant" | "cap" | "owner";
  why: string;
  /** Calls in the last 7 days and the last call; null when the usage records are another machine's. */
  usage: { calls: number; lastCall: string | null } | null;
}

export interface AccessMatrix {
  callers: MatrixCaller[];
  outlines: Grant[];
  /** `cells[caller][outline]`, in the order of `callers` and `outlines`. */
  cells: MatrixCell[][];
  /** The person's machine: the commands a plan names are run here (`--machine` for any other). */
  localMachine: string;
  /** The machine whose caps and usage records these are: the one that serves the gateway (PIE-1037). */
  readFrom: string;
  caps: { file: string; from: "environment" | "file" | "none" };
  usage: { dir: string; days: number };
}

export interface MatrixInput {
  grants: Grant[];
  capSpec: string;
  capFrom: AccessMatrix["caps"]["from"];
  capFile: string;
  usage: Pick<Usage, "time" | "actor" | "outline">[];
  usageDir: string;
  localMachine: string;
  /** The machine the caps and usage were read on (default: this one). */
  readFrom?: string;
  now?: number;
}

/** The caller a usage record is: its persona, else its principal (`mcp:gpty/claude.ai` is gpty). */
export function callerOfActor(actor: string): { name: string; principal?: string; persona?: string } {
  const a = parseActor(actor);
  const name = a.persona ?? a.principal ?? a.handle;
  return { name, ...(a.principal ? { principal: a.principal } : {}), ...(a.persona ? { persona: a.persona } : {}) };
}

const addrOf = (g: Grant) => ({ outline: g.outline, machine: g.machine });
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The McpCaller `levelFor` takes for a principal, so the owner's `full` and the cap are asked of the one rule. */
function callerFor(principal: string | undefined, persona: string | undefined, cap: McpCaller["cap"]): { caller: McpCaller; machine?: string } {
  const at = principal?.indexOf("@") ?? -1;
  const base: McpCaller = at > 0 && principal
    ? { sub: STDIO_SUBJECT, clientId: principal.slice(0, at) }
    : { sub: principal ?? "-", ...(principal ? { clientId: principal } : {}) };
  return { caller: { ...base, ...(persona ? { persona } : {}), ...(cap ? { cap } : {}) }, ...(at > 0 && principal ? { machine: principal.slice(at + 1) } : {}) };
}

export function buildMatrix(input: MatrixInput): AccessMatrix {
  const now = input.now ?? Date.now();
  const since = now - MATRIX_DAYS * DAY;
  const recent = input.usage.filter(r => Date.parse(r.time) >= since);
  const callers = new Map<string, MatrixCaller>();
  const personaOf = new Map<string, string>();
  const seen = (name: string): MatrixCaller => {
    let c = [...callers.values()].find(x => sameName(x.name, name));
    if (!c) { c = { name, via: "client", principals: [], calls: 0, lastCall: null }; callers.set(name.toLowerCase(), c); }
    return c;
  };
  // A named path is a caller with an entry in the caps, or a persona that came in through the gateway (a principal with no machine).
  for (const entry of input.capSpec.split(",")) {
    const [who = ""] = entry.split("=");
    const persona = who.trim().split("@")[0];
    if (persona) { const c = seen(persona); c.via = "path"; personaOf.set(c.name.toLowerCase(), c.name); }
  }
  for (const row of recent) {
    const who = callerOfActor(row.actor), c = seen(who.name);
    if (who.persona && who.principal && !who.principal.includes("@")) { c.via = "path"; personaOf.set(c.name.toLowerCase(), who.persona); }
    if (who.principal && !c.principals.includes(who.principal)) c.principals.push(who.principal);
    c.calls++;
    if (!c.lastCall || row.time > c.lastCall) c.lastCall = row.time;
  }
  const list = [...callers.values()].sort((a, b) => (b.lastCall ?? "").localeCompare(a.lastCall ?? "") || a.name.localeCompare(b.name));
  const outlines = [...input.grants].sort((a, b) => a.machine.localeCompare(b.machine) || a.outline.localeCompare(b.outline));
  const cells = list.map(caller => outlines.map((g): MatrixCell => {
    const where = addrOf(g);
    const capOf = caller.via === "path" ? pathCapEntry(input.capSpec, personaOf.get(caller.name.toLowerCase()) ?? caller.name) : null;
    const parsedCap = capOf ? capOf(where) : null;
    const cap = parsedCap ? { level: parsedCap.level, entry: parsedCap.entry } : null;
    const status = { level: g.level, ...(g.owner ? { owner: g.owner } : {}) };
    // Every principal the caller came in as; the highest is what it can do (the outline's owner is `full` in its own).
    const asked = (caller.principals.length ? caller.principals : [undefined]).map(p => {
      // A cap is a named path's: the same persona over stdio (a principal with a machine) is a client and has none.
      const capped = cap && !p?.includes("@");
      const { caller: c, machine } = callerFor(p, caller.via === "path" ? caller.name : undefined, capped ? () => cap.level : undefined);
      return levelFor(status, c, machine, where);
    });
    const level = asked.reduce((a, b) => LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);
    const usageHere = g.machine === (input.readFrom ?? input.localMachine);
    const mine = usageHere ? recent.filter(r => r.outline === g.outline && sameName(callerOfActor(r.actor).name, caller.name)) : [];
    const last = mine.reduce<string | null>((a, r) => !a || r.time > a ? r.time : a, null);
    const limitedBy = LEVELS.indexOf(level) > LEVELS.indexOf(g.level) ? "owner" : cap && LEVELS.indexOf(cap.level) < LEVELS.indexOf(g.level) ? "cap" : "grant";
    return { caller: caller.name, outline: g.outline, machine: g.machine, level, grant: g.level, cap, limitedBy, usage: usageHere ? { calls: mine.length, lastCall: last } : null,
      why: whyOf(caller, g, level, cap, parsedCap?.invalid) };
  }));
  return { callers: list, outlines, cells, localMachine: input.localMachine, readFrom: input.readFrom ?? input.localMachine, caps: { file: input.capFile, from: input.capFrom }, usage: { dir: input.usageDir, days: MATRIX_DAYS } };
}

function whyOf(caller: MatrixCaller, g: Grant, level: McpAccessLevel, cap: MatrixCell["cap"], invalid = false): string {
  const o = `${g.outline}@${g.machine}`;
  if (g.error) return `${o} could not be read (${g.error}): nothing is assumed`;
  const grant = g.level === "none" ? `${o} has no MCP access set (it is none)` : `${o} allows ${g.level}${g.yolo ? " (the grant; yolo is on, so agents act as full for now)" : ""}`;
  if (!cap) return level === g.level ? `${grant}; ${caller.name} comes in as a client and is not capped` : `${grant}; ${caller.name} is the outline's owner, so it has ${level}`;
  const capSays = invalid ? `EP0CH_MCP_PATH_ACCESS has an invalid entry for ${cap.entry}; access is none (fail closed)` : cap.entry ? `EP0CH_MCP_PATH_ACCESS has ${cap.entry}=${cap.level}` : `no entry names it, so the default cap is propose`;
  if (LEVELS.indexOf(cap.level) < LEVELS.indexOf(g.level)) return `${grant}; ${caller.name} is capped at ${cap.level} on its named path (${capSays})`;
  return `${grant}; ${caller.name}'s cap is ${cap.level === g.level ? "the same" : `${cap.level}, higher`} (${capSays}), so the outline's level is what it gets`;
}

// ---- reading the sources

/** One machine's outline host: its outlines and their grants, and the one write there is. */
export interface GrantSource {
  machine: string;
  grants(): Promise<Grant[]>;
  configure(outline: string, level: McpAccessLevel): Promise<void>;
  /** This machine's caps and usage records as its host reads them (`mcp.access.files`, PIE-1037); a local source's are read in place. */
  files(env?: Record<string, string | undefined>): Promise<McpAccessFiles>;
}

const grantOf = (outline: string, machine: string, s: McpAccessStatus): Grant =>
  ({ outline, machine, level: s.configured ?? s.level, ...(s.owner ? { owner: s.owner } : {}), ...(s.yolo ? { yolo: true } : {}) });

/**
 * The matrix of `sources`. The caps and the usage records are the gateway's, which writes them on the machine it runs on:
 * the first source's machine (the one the door's outline is on), read from that machine's own host unless it is this one,
 * so a door on another machine shows the gateway's truth rather than its own empty usage and default caps (PIE-1037).
 */
export async function gatherMatrix(sources: GrantSource[], env: Record<string, string | undefined> = process.env, now = Date.now()): Promise<AccessMatrix> {
  const grants = (await Promise.all(sources.map(s => s.grants()))).flat();
  const from = sources[0], local = canonicalLocalMachineName();
  const here = !from || isLocalMachine(from.machine);
  const files = here ? readMcpAccessFiles(env, now, usageDir()) : await from!.files(env);
  const readFrom = here ? local : from!.machine;
  return buildMatrix({ grants, capSpec: files.caps.spec, capFrom: files.caps.from, capFile: files.caps.file, usage: files.usage.rows, usageDir: files.usage.dir, localMachine: local, readFrom, now });
}

// ---- changing a cell (the person's)

export type Step =
  | { kind: "grant"; outline: string; machine: string; level: McpAccessLevel; command: string; affects: string }
  | { kind: "cap"; key: string; level: McpAccessLevel; command: string; affects: string };
export interface Plan { caller: string; outline: string; machine: string; level: McpAccessLevel; steps: Step[]; said: string }

const machineFlag = (machine: string, local: string) => machine === local ? "" : ` --machine ${machine}`;

/** What it takes for `caller` to have `want` in an outline: the caps entry, the outline's grant, or both; or why not. */
export function planChange(m: AccessMatrix, who: { caller: string; outline: string; machine?: string; level: string }): Plan | { error: string } {
  if (!(LEVELS as readonly string[]).includes(who.level)) return { error: `level is one of ${LEVELS.join(", ")} (got ${JSON.stringify(who.level)})` };
  const want = who.level as McpAccessLevel;
  const ci = m.callers.findIndex(c => sameName(c.name, who.caller));
  if (ci < 0) return { error: `no caller ${who.caller} (${m.callers.map(c => c.name).join(", ") || "none seen"})` };
  const oi = m.outlines.findIndex(o => o.outline === who.outline && (!who.machine || o.machine === who.machine));
  if (oi < 0) return { error: `no outline ${who.outline}${who.machine ? `@${who.machine}` : ""} (${m.outlines.map(o => `${o.outline}@${o.machine}`).join(", ")})` };
  const cell = m.cells[ci]![oi]!, caller = m.callers[ci]!, g = m.outlines[oi]!;
  if (g.error) return { error: `${g.outline}@${g.machine} could not be read, so nothing is changed there: ${g.error}` };
  const steps: Step[] = [];
  const key = `${caller.name}@${g.outline}${g.machine === m.localMachine ? "" : `@${g.machine}`}`;
  const grantStep = (): Step => ({ kind: "grant", outline: g.outline, machine: g.machine, level: want,
    command: `ep0ch mcp access ${want} --ws ${g.outline}${machineFlag(g.machine, m.localMachine)}`,
    affects: `${g.outline}'s grant is every caller's ceiling there (clients and every named path), not only ${caller.name}'s` });
  // A cap is written into mcp.env on the machine this process runs on; the gateway's is another's (PIE-1037).
  const capElsewhere = m.readFrom !== m.localMachine;
  const capStep = (): Step => ({ kind: "cap", key, level: want, command: `ep0ch mcp access --cap ${key}=${want}`,
    affects: `only ${caller.name} in ${g.outline}; written to ${m.caps.file} (${CAP_KEY}), read by the gateway on its next request` });
  if (want === cell.level) return { caller: caller.name, outline: g.outline, machine: g.machine, level: want, steps, said: `${caller.name} already has ${want} in ${g.outline}@${g.machine}; nothing to change` };
  if (caller.via === "client" && g.owner && caller.principals.includes(g.owner) && want !== "none" && LEVELS.indexOf(want) < LEVELS.indexOf(cell.level))
    return { error: `${caller.name} made ${g.outline}, so it keeps full there whatever the grant says (only none, which denies everyone, takes it away): ep0ch mcp access none --ws ${g.outline}${machineFlag(g.machine, m.localMachine)}` };
  if (caller.via === "client") steps.push(grantStep());
  else if (LEVELS.indexOf(want) < LEVELS.indexOf(cell.level)) steps.push(capStep());
  else {
    if (cell.cap && LEVELS.indexOf(cell.cap.level) < LEVELS.indexOf(want)) steps.push(capStep());
    if (LEVELS.indexOf(cell.grant) < LEVELS.indexOf(want)) steps.push(grantStep());
  }
  if (capElsewhere && steps.some(x => x.kind === "cap"))
    return { error: `${caller.name}'s cap is written where the gateway reads it, on ${m.readFrom}: run \`ssh ${m.readFrom} ep0ch mcp access --cap ${key}=${want}\` there` };
  return { caller: caller.name, outline: g.outline, machine: g.machine, level: want, steps,
    said: `${caller.name} to ${want} in ${g.outline}@${g.machine}: ${steps.map(s => s.command).join(" and ")}. ${steps.map(s => s.affects).join("; ")}` };
}

/** Add or replace `key=level` in a `EP0CH_MCP_PATH_ACCESS` list (keys compare without case). */
export function withCap(spec: string, key: string, level: McpAccessLevel): string {
  // The gateway takes the last entry for a key, so the last one is replaced and earlier duplicates go.
  const entries = spec.split(",").map(e => e.trim()).filter(Boolean);
  const same = (e: string) => sameName(e.split("=")[0]!.trim(), key);
  const last = entries.map(same).lastIndexOf(true), entry = `${key}=${level}`;
  if (last < 0) return [...entries, entry].join(",");
  return entries.flatMap((e, i) => i === last ? [entry] : same(e) ? [] : [e]).join(",");
}

/**
 * Write `key=level` into the caps in `mcp.env`, the file the gateway reads, leaving every other line as it is. Refuses when
 * the process environment sets the caps itself (that wins over the file: change it where it is set).
 */
export function setPathCap(key: string, level: McpAccessLevel, env: Record<string, string | undefined> = process.env): { file: string; spec: string } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*){0,2}$/.test(key)) throw new Error(`a cap is <persona>[@<outline>[@<machine>]], got ${JSON.stringify(key)}`);
  if (env[CAP_KEY] !== undefined) throw new Error(`${CAP_KEY} is set in this process's environment, which wins over ${mcpEnvFile(env)}: change it where it is set (the gateway's unit or shell), then restart that`);
  const file = mcpEnvFile(env);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const spec = withCap(parseEnvFile(text)[CAP_KEY] ?? "", key, level);
  const line = new RegExp(`^(\\s*(?:export\\s+)?${CAP_KEY}\\s*=).*$`, "m");
  const next = line.test(text) ? text.replace(line, (_, head: string) => `${head}${spec}`) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${CAP_KEY}=${spec}\n`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, next, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return { file, spec };
}

/** Run a plan's steps: the grant through the outline's host, the cap through `mcp.env`. Returns the commands it ran. */
export async function applyPlan(plan: Plan, sources: GrantSource[], env: Record<string, string | undefined> = process.env): Promise<string[]> {
  const ran: string[] = [];
  for (const step of plan.steps) {
    if (step.kind === "cap") setPathCap(step.key, step.level, env);
    else {
      const source = sources.find(s => s.machine === step.machine);
      if (!source) throw new Error(`no host for ${step.machine}; run ${step.command}`);
      await source.configure(step.outline, step.level);
    }
    ran.push(step.command);
  }
  return ran;
}

// ---- words

/** The matrix as the CLI prints it: callers down the side, outlines across, each cell a glyph and a word, then its use. */
export function matrixLines(m: AccessMatrix, now = Date.now()): string[] {
  const out: string[] = [];
  const names = m.outlines.map(o => m.outlines.some(x => x !== o && x.outline === o.outline) ? `${o.outline}@${o.machine}` : o.outline);
  const useText = (x: MatrixCell) => !x.usage ? "no records" : x.usage.calls ? `${x.usage.calls} calls ${ago(Date.parse(x.usage.lastCall!), now)}` : x.level === "none" ? "" : "unused";
  // A column is as wide as its widest cell and a gap, so the usage under a level never runs into the next cell's.
  const w = Math.max(10, ...names.map(n => n.length + 1), ...m.cells.flat().map(x => useText(x).length + 2));
  const side = Math.max(8, ...m.callers.map(c => c.name.length + 7));
  const row = (head: string, cells: string[]) => `${head.padEnd(side)}${cells.map(c => c.padEnd(w)).join("")}`.trimEnd();
  out.push(`Who can reach what: the lower of the outline's grant and the caller's cap (calls: last ${m.usage.days} days)`);
  if (!m.callers.length) { out.push("No caller has been seen in usage and none is named in the caps."); return out; }
  out.push(row("", names));
  m.callers.forEach((c, ci) => {
    out.push(row(`${c.name}${c.via === "path" ? " (path)" : ""}`, m.cells[ci]!.map(x => levelText(x.level))));
    out.push(row("", m.cells[ci]!.map(useText)));
  });
  const limited = m.cells.flat().filter(x => x.limitedBy === "cap");
  if (limited.length) { out.push("", "Why a caller has less than the outline allows:"); for (const x of limited) out.push(`  ${x.caller} in ${x.outline}: ${x.why}`); }
  const none = m.outlines.filter(o => o.level === "none" && !o.error).map(o => o.outline);
  if (none.length) out.push("", `No MCP access is set on ${none.join(", ")}: nobody gets in (ep0ch mcp access <level> --ws <name>).`);
  for (const o of m.outlines) if (o.error) out.push(`${o.outline}@${o.machine}: ${o.error}`);
  out.push("", `(path) is a named gateway path, capped at propose unless ${CAP_KEY} says otherwise (${m.caps.from === "none" ? "not set" : m.caps.from === "environment" ? "from the environment" : m.caps.file}); other callers are not capped.`,
    `Caps and usage are ${m.readFrom}'s${m.readFrom === m.localMachine ? "" : " (the machine that serves the gateway, read through its outline host)"}: ${m.caps.file}, ${m.usage.dir}.`);
  return out;
}

// ---- the outline host as a source

/** A machine's outline host (the socket at `path`): every outline in its folder, each with its grant. */
export function hostSource(path: string, machine: string): GrantSource {
  const board = (outline: string) => new SocketBoard(path, 8_000, outline);
  return {
    machine,
    async grants() {
      const list = await hostRequest<{ outlines: { name: string }[] }>(path, "outlines.list", {}, 8_000);
      const out: Grant[] = [];
      for (const { name } of list.outlines) {
        const b = board(name);
        try { out.push(grantOf(name, machine, await b.mcpAccessStatus())); }
        catch (e) { out.push({ outline: name, machine, level: "none", error: (e as Error).message }); }
        finally { b.close(); }
      }
      return out;
    },
    async configure(outline, level) {
      const b = board(outline);
      try { await b.configureMcpAccess(level); } finally { b.close(); }
    },
    files: () => hostRequest<McpAccessFiles>(path, "mcp.access.files", {}, 8_000),
  };
}

/** The host of this machine, or of `--machine <ssh-name>` (through its forward): a source, or why not. */
export async function hostSourceFor(machine?: string): Promise<GrantSource | { error: string }> {
  const target = resolveTarget(machine ? ["--machine", machine] : []);
  if ("error" in target) return target;
  if (target.machine) {
    try { await forwardTo(target.machine); } catch (e) { return { error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }; }
  }
  return hostSource(target.path, target.machine ?? canonicalLocalMachineName());
}
