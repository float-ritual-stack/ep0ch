// ONE-OFF (delete once float-2 and the MacBook have moved over; git keeps it): the session from before sessions were
// per outline. That one kept its files in the state dir itself (session.sock, session.json, pty.sock, the checkpoint,
// desk.json, river.json, delivery.json, river-index.json, lastcall.json). It is moved over once, one of two ways:
//
// - `ep0ch session upgrade` (or `ep0ch install --apply`) hands it over: the old daemon starts its successor on this
//   code, which finds its outline from the same arguments and moves the old files into that outline's folder
//   (`adoptOldSession`) before it restores and adopts the programs.
// - `ep0ch session end` ends it, then moves what it left (its desk layouts, its last call) into its outline's folder.
//
// - An old daemon that died (kill -9, a reboot) left its session.json naming its outline: that outline's next session
//   takes the files over as it starts.
//
// Until then `ep0ch` and `ep0ch session attach` say which of the two to run. Files no old session names (it ended on
// the old code) aren't guessed at: `ep0ch` prints the `mv` that moves them into the outline it opens, if they were
// that outline's. Nothing here reads an old file in place: files are moved, once, and the per-outline code only ever
// reads the new folders.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { listening } from "../jsonl";
import { outlinesDir } from "../discover";
import { stateDir } from "../state";
import { ep0ch, placeLabel, placeOf, sessionFlags, sessionInfo, type OutlineKey, type Place } from "./place";
import { askSession } from "./start";

/** What the old session kept that is its outline's: moved into that outline's folder. */
const OUTLINE_FILES = ["session-state.json", "pty.sock", "pty-host.log", "session.log", "desk.json", "river.json", "delivery.json", "river-index.json", "lastcall.json", "marks.json", "drafts/unsent"];
/** Of those, what's worth moving by hand when no old session names its outline: the layouts, the last call, the marks. */
const KEPT_FILES = ["desk.json", "river.json", "delivery.json", "lastcall.json", "marks.json", "drafts/unsent"];
/** What only described the old session itself: removed once it's gone. */
const SESSION_FILES = ["session.sock", "session.json", "session.lock"];

const oldSocket = (root: string) => join(root, "session.sock");

/** The old session, when it still runs: its pid and the outline it's on. */
export interface OldSession extends OutlineKey { pid: number; commit: string | null; dir: string; clients: number; programs: number }
export async function oldSession(root = stateDir()): Promise<OldSession | null> {
  if (!existsSync(oldSocket(root))) return null;
  const i = await sessionInfo(oldSocket(root)).catch(() => null) as unknown as { pid: number; outline: { outline?: string; socket: string }; code: { dir: string; commit: string | null }; clients: unknown[]; terminals: unknown[]; kept?: unknown[] } | null;
  if (!i) return null;
  return { pid: i.pid, outline: i.outline.outline ?? "?", ...keyOf(i.outline.socket), commit: i.code.commit, dir: i.code.dir, clients: i.clients.length, programs: i.terminals.length + (i.kept?.length ?? 0) };
}

/** A host socket as a place's key: a machine's forward (`<outlines>/.remote/<name>.sock`), else the socket. */
function keyOf(socket: string): { machine?: string; socket?: string } {
  return resolve(dirname(socket)) === resolve(join(outlinesDir(), ".remote")) ? { machine: basename(socket, ".sock") } : { socket };
}

/** The pasteable commands that move the old session over, for `ep0ch` and `session attach` to say. */
export function oldSessionSaying(o: { pid: number; outline: string; machine?: string }): string {
  const on = `${o.outline}${o.machine ? ` on ${o.machine}` : ""}`;
  return `a session from before sessions were per outline still runs (pid ${o.pid}, on ${on}) · move it over once, either:\n`
    + `  ${ep0ch()}session upgrade     hands it to this code, into ${o.outline}'s own folder (its programs keep running)\n`
    + `  ${ep0ch()}session end         ends it (unsaved text is kept)`;
}

/**
 * Move what the old session left in the state dir into `place`'s folder, once, when no old daemon serves there any
 * more (it handed over to this one, or stopped). What the place already has is kept, never overwritten. What was
 * moved, said; null when there was nothing.
 */
export async function adoptOldFiles(place: Place, root = stateDir()): Promise<string | null> {
  if (await listening(oldSocket(root))) return null;
  const moved: string[] = [];
  mkdirSync(place.dir, { recursive: true, mode: 0o700 });
  for (const f of OUTLINE_FILES) {
    const from = join(root, f), to = join(place.dir, f);
    if (!existsSync(from)) continue;
    if (existsSync(to)) continue;
    try { mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); renameSync(from, to); moved.push(f); } catch { /* left where it was */ }
  }
  for (const f of SESSION_FILES) rmSync(join(root, f), { force: true });
  // The old door claims (doors/<pid>): only gone doors' are left by now.
  try { const d = join(root, "doors"); for (const n of readdirSync(d)) rmSync(join(d, n), { force: true }); rmdirSync(d); } catch { /* none */ }
  return moved.length ? `moved over from before sessions were per outline: ${moved.join(", ")} → ${place.dir}` : null;
}

/**
 * What a session's daemon takes over as it starts in `place`: the old session's files, when the old daemon handed over
 * to it (`EP0CH_SESSION_RESTORE=upgrade`, and its checkpoint is in the state dir itself), or when an old daemon that
 * died left its session.json there naming this outline. Never a guess: files no old session names stay where they are.
 */
export async function adoptOnStart(place: Place, handedOver: boolean, root = stateDir()): Promise<string | null> {
  const fromHandover = handedOver && existsSync(join(root, "session-state.json"));
  if (!fromHandover && !diedOn(place, root)) return null;
  return adoptOldFiles(place, root);
}

/** The old daemon that died left its session.json naming this place's outline (and where it is). */
function diedOn(place: Place, root: string): boolean {
  let i: { outline?: { outline?: string; socket?: string } } | null = null;
  try { i = JSON.parse(readFileSync(join(root, "session.json"), "utf8")); } catch { return false; }
  if (!i?.outline?.socket || !i.outline.outline) return false;
  const k = keyOf(i.outline.socket);
  return placeOf({ outline: i.outline.outline, ...k }, root).dir === place.dir;
}

/**
 * Layout files from before sessions were per outline that no old session names (it ended on the old code): the `mv`
 * that moves them into `place`'s folder, filled in, for `ep0ch` to say as it opens that outline. Null when none are left.
 */
export function leftoverSaying(place: Place, root = stateDir()): string | null {
  if (existsSync(oldSocket(root)) || existsSync(join(root, "session.json"))) return null;
  const left = KEPT_FILES.filter(f => existsSync(join(root, f)));
  if (!left.length) return null;
  const q = (p: string) => (/^[\w./~-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
  return `${left.join(", ")} from before sessions were per outline are still in ${root} · if they were ${placeLabel(place)}'s, end its session and move them:\n`
    + `  ${ep0ch(process.env, place)}session end ${sessionFlags({ place })} && mkdir -p ${q(place.dir)} && mv ${left.map(f => q(join(root, f))).join(" ")} ${q(place.dir)}/\n`
    + `  or, if they aren't worth keeping: rm ${left.map(f => q(join(root, f))).join(" ")}`;
}

/** `ep0ch session upgrade`: hand the old session over to this code (into its outline's folder). What happened, said. */
export async function upgradeOld(root = stateDir()): Promise<{ ok: boolean; message: string } | null> {
  const o = await oldSession(root);
  if (!o) return null;
  const r = await askSession(oldSocket(root), { t: "upgrade" }, 60_000);
  const ok = r?.t === "ask" && r.message === "handed over";
  return ok ? { ok, message: `the session from before sessions were per outline (pid ${o.pid}, on ${o.outline}) was handed over into ${o.outline}'s own folder` }
    : { ok: false, message: `handing over the old session (pid ${o.pid}) failed: ${r?.t === "ask" ? r.message : "it didn't answer"} · \`${ep0ch()}session end\` ends it instead` };
}

/** After `ep0ch session end` ended the old session: what it left moved into its outline's folder. */
export async function afterOldEnded(o: OutlineKey, root = stateDir()): Promise<string | null> {
  for (let i = 0; i < 50 && (await listening(oldSocket(root))); i++) await Bun.sleep(100);
  return adoptOldFiles(placeOf({ outline: o.outline, ...(o.machine ? { machine: o.machine } : o.socket ? { socket: o.socket } : {}) }, root), root);
}

export const oldSocketPath = oldSocket;
