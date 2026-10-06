/*
 * The drawer and the dock swap words (one version, no aliases): what the door saved under the old ones, renamed.
 *
 *   ep0ch session end --all --yes                                        # first: a running session holds the old names
 *   bun packages/door/scripts/migrations/drawer-words.ts [--ws <outline>]          # says what it would change
 *   bun packages/door/scripts/migrations/drawer-words.ts [--ws <outline>] --write  # changes it
 *
 * In the door's state dir (EP0CH_STATE, else $XDG_STATE_HOME/ep0ch-door), every folder:
 * - dock.json, dock-tiles.json and dock-agent.json become drawer.json, drawer-tiles.json and drawer-agent.json;
 * - in every saved layout and checkpoint (*.json): a layout node `"t": "drawer"` becomes `"t": "dock"`, the drawer's
 *   own tile `dock.agent` / `dock.own` / `dock.tiles` becomes `drawer.agent` / `drawer.own` / `drawer.tiles`, a moved
 *   terminal's key `dock.json:…` becomes `drawer.json:…`, and a checkpoint step's `"dock": true` becomes `"drawer": true`.
 * With --ws, the outline's screen notes (`[type::screen]`, PIE-565) through its outline host: a `"t": "drawer"` in a
 * note's spec becomes `"t": "dock"`, written with the revision read.
 *
 * Run once on each machine that matters (float-2 for pie, the MacBook for float-hub), then delete this file. A
 * program a session's terminal host still keeps under an old key isn't adopted after it: end sessions first.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostSocket } from "../../src/outlines";
import { SocketBoard, type Actor } from "../../src/socket";
import { stateDir } from "../../src/state";

const FILES: Record<string, string> = { "dock.json": "drawer.json", "dock-tiles.json": "drawer-tiles.json", "dock-agent.json": "drawer-agent.json" };
const NAMES: Record<string, string> = { "dock.agent": "drawer.agent", "dock.own": "drawer.own", "dock.tiles": "drawer.tiles" };

/** A saved value in the new words: what changed, and the value. */
export function migrateValue(v: unknown): unknown {
  if (typeof v === "string") {
    // A moved terminal's key, `<home>:<tile id>`: the drawer's home and its own tile's id in their new names.
    const key = /^dock\.json(#\d+)?:(.+)$/.exec(v);
    return NAMES[v] ?? (key ? `drawer.json${key[1] ?? ""}:${NAMES[key[2]!] ?? key[2]}` : v);
  }
  if (Array.isArray(v)) return v.map(migrateValue);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "t" && x === "drawer") out.t = "dock";
    // A checkpoint's step in the drawer (session-state.json).
    else if (k === "dock" && x === true && "action" in v) out.drawer = true;
    else out[k] = migrateValue(x);
  }
  return out;
}

/** What a run did, or would do. */
export interface Report { renamed: string[]; rewritten: string[]; skipped: string[]; notes: string[] }

/** The state dir `dir`, every folder under it: files renamed, saved JSON rewritten (`write`), else only said. */
export function migrateState(dir: string, write: boolean, report: Report = { renamed: [], rewritten: [], skipped: [], notes: [] }): Report {
  if (!existsSync(dir)) return report;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== "cache" && name !== "media") migrateState(path, write, report); continue; }
    let file = path;
    const to = FILES[name];
    if (to) {
      const dest = join(dir, to);
      if (existsSync(dest)) { report.skipped.push(`${path}: ${to} is there already (kept both; remove one by hand)`); continue; }
      report.renamed.push(`${path} → ${to}`);
      if (write) { renameSync(path, dest); file = dest; }
    }
    if (!file.endsWith(".json")) continue;
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    let data: unknown;
    try { data = JSON.parse(text); } catch { continue; }
    const next = JSON.stringify(migrateValue(data));
    if (next === JSON.stringify(data)) continue;
    report.rewritten.push(file);
    // Written beside it, then renamed over it: never a half-written layout.
    if (write) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, text.includes("\n  ") ? JSON.stringify(JSON.parse(next), null, 2) : next, { mode: 0o600 }); renameSync(tmp, file); }
  }
  return report;
}

/** A screen note's text in the new words: its ```json spec rewritten, else null (nothing to change). */
export function migrateNoteText(text: string): string | null {
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  if (!m) return null;
  let spec: unknown;
  try { spec = JSON.parse(m[1]!); } catch { return null; }
  const next = migrateValue(spec);
  if (JSON.stringify(next) === JSON.stringify(spec)) return null;
  return text.slice(0, m.index) + "```json\n" + JSON.stringify(next, null, 2) + "\n```" + text.slice(m.index + m[0].length);
}

const MIGRATION: Actor = { kind: "agent", id: "drawer-words" };

/** The outline's screen notes through `board`: rewritten (`write`), else only said. */
export async function migrateNotes(board: Pick<SocketBoard, "byProp" | "update">, write: boolean, report: Report): Promise<Report> {
  for (const m of await board.byProp("type", "screen")) {
    const next = migrateNoteText(m.text);
    if (next === null) continue;
    report.notes.push(`${m.id} ${m.text.split("\n")[0]}`);
    if (write) await board.update(m.id, next, m.revision ?? 0, MIGRATION);
  }
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2), write = args.includes("--write"), at = args.indexOf("--ws"), ws = at >= 0 ? args[at + 1] : undefined;
  if ((at >= 0 && (!ws || ws.startsWith("--"))) || args.some(a => a !== "--write" && a !== "--ws" && a !== ws)) {
    console.error("usage: bun packages/door/scripts/migrations/drawer-words.ts [--ws <outline>] [--write]");
    process.exit(2);
  }
  const dir = stateDir();
  const report = migrateState(dir, write);
  if (ws) {
    const board = new SocketBoard(hostSocket(), 15_000, ws);
    try { await board.info(); await migrateNotes(board, write, report); }
    catch (e) { console.error(`couldn't reach outline ${ws}'s host (${(e as Error).message}) · start it (ep0ch --ws ${ws}), then run this again`); process.exitCode = 1; }
    finally { board.close(); }
  }
  const say = (what: string, xs: string[]) => { if (xs.length) console.log(`${what}:\n  ${xs.join("\n  ")}`); };
  say(write ? "renamed" : "would rename", report.renamed);
  say(write ? "rewrote" : "would rewrite", report.rewritten);
  say(write ? "rewrote screen notes" : "would rewrite screen notes", report.notes);
  say("skipped", report.skipped);
  if (!report.renamed.length && !report.rewritten.length && !report.notes.length) console.log(`nothing in the old words in ${dir}${ws ? ` or outline ${ws}'s screen notes` : ""}`);
  else if (!write) console.log(`dry run · again with --write to change it: bun packages/door/scripts/migrations/drawer-words.ts${ws ? ` --ws ${ws}` : ""} --write`);
}
