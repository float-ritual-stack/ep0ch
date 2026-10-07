// Let an agent see what you see, and do what you do: a local socket where `peek` returns the screen as
// text plus structured state (which reader shows which block, what it's editing or commenting on),
// `snap` composites exactly what the terminal was sent into a PNG, `open` puts a block in front of you,
// `actions` lists what the current screen can do, and `act` does one of those things as the agent.
//   bun src/main.ts peek | snap [file.png] | open <block-id> [--as <actor-id>] | actions | act <action> [key=value…] [--as <actor-id>]
//   (`open <id>` is `act open id=<id>`: the one way an agent opens a note, attributed like any act)
//   bun src/main.ts subscribe [focus.changed,viewport,cursor,layout.changed,marks.changed]   (the live feed)
//
// The socket is the door's shell: whoever can connect can do what the person can, including start a program in
// a terminal tile. So it is 0600, in a folder that is the user's alone (0700, owner checked, the same check as
// the nvim tiles' sockets); a folder anyone else can reach is refused and the door runs without it.
import { canonicalLocalMachineName } from "./machine-name";
import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { App } from "./app";
import { parseActArgs } from "./surface/actions";
import type { Mirror } from "./mirror";
import type { TermInfo } from "./term";
import { isInside, onOutline, outlineState, privateDir, stateDir } from "./state";
import { reachDoor, type DoorReach } from "@ep0ch/outline-core/door-reach";
import { ask, jsonLine, JsonLines, listening } from "./jsonl";
import { namesOutline, parseAddressedBlock } from "@ep0ch/outline-core/addressable-resource";
import { runningSessions, sessionInfo, sessionSocket } from "./session/place";

/**
 * Where a door serves, and where `ep0ch act|peek|…` looks: EP0CH_CONTROL, else door.sock in its outline's folder of the
 * state dir (`outlineState()`; `ep0ch act` finds which: src/session/place.ts, `controlFor`).
 */
export const controlSocket = () => process.env.EP0CH_CONTROL ?? join(outlineState(), "door.sock");

/**
 * Where this door serves: `controlSocket()`, except an EP0CH_CONTROL inherited from another outline's door. A door
 * started where one was set (a tile's program, a script run from one, a shell that kept it) without EP0CH_IN_DOOR
 * kept it, and served on that outline's socket: its tiles were then told another outline's door, and after a handover
 * reached it, or none (PIE-604). A socket named in another outline's folder of the state dir is never this door's.
 */
export function servingSocket(env: Record<string, string | undefined> = process.env): string {
  const own = join(outlineState(), "door.sock");
  const given = env.EP0CH_CONTROL;
  if (!given) return own;
  const sessions = join(stateDir(), "sessions");
  return isInside(sessions, given) && !isInside(outlineState(), given) ? own : given;
}

/**
 * The outline's session folder a door serving on `control` is in, for its tiles' EP0CH_PLACE: set only when the door
 * is on an outline and serves inside its folder (a test door that moved its socket elsewhere, and the home base, have
 * none, so their programs keep EP0CH_CONTROL as it is).
 */
export function controlPlace(control: string | null | undefined): string | null {
  return control && onOutline() && isInside(outlineState(), control) ? outlineState() : null;
}

/** The door a program reaches now, from EP0CH_CONTROL and EP0CH_PLACE (outline-core's door-reach.ts, PIE-604). */
export function reachControl(env: Record<string, string | undefined> = process.env): Promise<DoorReach> {
  return reachDoor(env.EP0CH_CONTROL, env.EP0CH_PLACE, {
    listening: p => listening(controlTarget(p)),
    linkTarget: p => { try { return lstatSync(p).isSymbolicLink() ? resolve(dirname(p), readlinkSync(p)) : null; } catch { return null; } },
  });
}

/** How much of the live feed may wait unread for one subscriber before it's disconnected. */
export const FEED_LIMIT = 1 << 20;
/**
 * The longest request line: a connection that sends more without a newline is told so and cut off. Well
 * above the biggest request the door takes (`act edit.text` with a note's whole text, JSON-escaped), and
 * small enough that a client can't make the door hold unbounded memory.
 */
export const LINE_LIMIT = 16 << 20;

/**
 * Where `snap` may write: `path` inside the state dir (relative to it, or absolute under it), default
 * screen.png there. Anything else is refused: a path elsewhere is written by the `ep0ch snap` command
 * itself, which asks for the PNG's bytes (`data`), so the door never writes where a client names.
 */
export function snapPath(path: unknown): string {
  const root = stateDir();
  const p = typeof path === "string" && path ? resolve(root, path) : join(root, "screen.png");
  const rel = relative(root, p);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`snap writes only under the door's state (${root}); \`ep0ch snap <file>\` writes anywhere you can`);
  return p;
}

/**
 * One subscriber's end of the feed: each event (of the types asked for) as a JSON line. A subscriber that stops
 * reading is let go once `limit` bytes wait unread: the door never buffers without end for it.
 */
export function feedWriter(sock: { writableLength: number; write(s: string): unknown; destroy(): unknown }, types: Set<string> | null, off: () => void, limit = FEED_LIMIT) {
  return (e: { type: string }) => {
    if (sock.writableLength > limit) { off(); sock.destroy(); return; }
    if (!types || types.has(e.type) || e.type === "hello") sock.write(jsonLine({ event: e }));
  };
}

export interface ControlDeps { app: App; mirror: Mirror; info: () => TermInfo }

interface ExpectedAddress { outline: string; machine: string }

function requireAddress(expected: unknown, d: ControlDeps): void {
  if (!expected || typeof expected !== "object") return;
  const e = expected as Partial<ExpectedAddress>;
  if (typeof e.outline !== "string" || typeof e.machine !== "string") throw new Error("open URI address is malformed");
  const actual = { outline: d.app.outline, machine: d.app.machine ?? canonicalLocalMachineName() };
  if (!namesOutline({ outline: e.outline, machine: e.machine }, actual)) {
    throw new Error(`that URI names ${e.outline} on ${e.machine}, but this door is ${actual.outline ?? "not on an outline"} on ${actual.machine}`);
  }
}

async function handle(req: any, d: ControlDeps): Promise<unknown> {
  // A session nobody watches renders no frames: the one skipped is drawn before anything reads the screen.
  d.app.catchUp();
  if (req.cmd === "peek") return { screen: d.app.describe(), text: d.mirror.text() };
  if (req.cmd === "snap") {
    // Render at the VGA font's own 9×16 cell, whatever the real terminal's cell size is.
    const png = () => d.mirror.snapshot({ ...d.info(), cellW: 9, cellH: 16 });
    if (req.data) return { png: Buffer.from(png()).toString("base64"), cols: d.mirror.cols, rows: d.mirror.rows };
    const path = snapPath(req.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, png(), { mode: 0o600 });
    return { path, cols: d.mirror.cols, rows: d.mirror.rows };
  }
  if (req.cmd === "actions") return d.app.actions();
  if (req.cmd === "act") {
    if (typeof req.action !== "string") throw new Error("act needs an action name; `actions` lists them");
    requireAddress(req.address, d);
    const args = req.args && typeof req.args === "object" && !Array.isArray(req.args) ? req.args : {};
    return d.app.act({ action: req.action, tile: typeof req.tile === "string" ? req.tile : undefined, args, as: typeof req.as === "string" ? req.as : undefined });
  }
  throw new Error(`unknown command ${req.cmd}; try peek, snap, actions or act`);
}

/**
 * The socket this door serves on, once it does. Terminal tiles get it as EP0CH_CONTROL, so `ep0ch act` from
 * a program in a tile (an agent's `show`) reaches the door it runs in, not whichever door has door.sock.
 */
export let controlPath: string | null = null;

/**
 * Remove control sockets that no door listens on any more (a door killed with kill -9, or before this
 * sweep existed): door.sock and door-<pid>.sock in `dir`. Returns what was removed.
 */
export async function sweepSockets(dir: string): Promise<string[]> {
  let names: string[];
  try { names = readdirSync(dir).filter(n => /^door(-\d+)?\.sock$/.test(n)); } catch { return []; }
  const gone: string[] = [];
  await Promise.all(names.map(async n => {
    const p = join(dir, n);
    if (!(await listening(p))) { try { unlinkSync(p); gone.push(p); } catch { /* someone else swept it */ } }
  }));
  return gone;
}

/**
 * Serve on door.sock; if another live door already has it, use door-<pid>.sock. The folder must be the
 * user's alone (the state dir is tightened to 0700 if it isn't); anything else is refused, with why.
 */
export async function startControl(d: ControlDeps, at = servingSocket()): Promise<{ path: string; close(): void }> {
  const dir = dirname(at);
  if (!privateDir(dir, isInside(stateDir(), dir))) throw new Error(`${dir} isn't yours alone (it needs mode 700): no control socket, so agents can't reach this door`);
  await sweepSockets(dir);
  const own = join(dir, `door-${process.pid}.sock`);
  let path = at;
  // A link (the Herdr agent's agent-*.sock) is never ours to serve on or remove: it names another door's socket.
  const link = (() => { try { return lstatSync(at).isSymbolicLink(); } catch { return false; } })();
  if (link) path = own;
  else if (existsSync(path)) {
    if (await listening(path)) path = own;
    else try { unlinkSync(path); } catch { /* another door starting swept it */ }
  }
  const server: Server = createServer(sock => {
    const reply = (r: unknown) => sock.write(jsonLine(r));
    const lines = new JsonLines(req => {
      // The live feed: this connection stays open, and every change to what the person sees comes down it as
      // one JSON line (`{"event":{…}}`) until the subscriber hangs up.
      if (req?.cmd === "subscribe") {
        const types = Array.isArray(req.types) ? new Set<string>(req.types.map(String)) : null;
        let off = () => {};
        off = d.app.subscribe(feedWriter(sock, types, () => off()));
        sock.on("close", off); sock.on("error", off);
        return;
      }
      handle(req, d).then(result => reply({ ok: true, result }), e => reply({ ok: false, error: String(e.message ?? e) }));
    }, () => reply({ ok: false, error: "bad json" }));
    sock.on("data", (chunk: Buffer) => {
      if (lines.feed(chunk, LINE_LIMIT)) return;
      // Said, then closed once said; nothing more it sends is read.
      sock.removeAllListeners("data");
      sock.end(jsonLine({ ok: false, error: `request line too long (over ${LINE_LIMIT} characters)` }), () => sock.destroy());
    });
    sock.on("error", () => {});
  });
  const listen = (p: string) => new Promise<void>((res, rej) => { server.once("error", rej); server.listen(p, () => res()); });
  // Two doors starting at once can both find door.sock free: the one that loses takes door-<pid>.sock.
  try { await listen(path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || path === own) throw e; path = own; await listen(path); }
  // 0600. No umask change for the moment before this: the folder is already the user's alone (checked above),
  // and a process-wide umask would also apply to anything else the door made while it waited.
  chmodSync(path, 0o600);
  controlPath = path;
  return { path, close: () => { server.close(); try { unlinkSync(path); } catch { /* gone */ } } };
}
function controlTarget(path: string): string {
  try { return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : path; }
  catch { return path; }
}



async function receiverForControl(path: string): Promise<unknown | null> {
  const target = controlTarget(path);
  const owns = (info: Awaited<ReturnType<typeof sessionInfo>>) => !!info?.control && resolve(info.control) === resolve(target);
  let info = await sessionInfo(sessionSocket(dirname(target))).catch(() => null);
  if (!owns(info)) info = (await runningSessions().catch(() => [])).map(row => row.info).find(owns) ?? null;
  if (!info) return null;
  const hosted = info.clients.find(client => client.active && client.clientHost) ?? info.clients.find(client => client.clientHost) ?? null;
  return {
    session: { outline: info.place.outline, machine: info.place.machine ?? null, pid: info.pid, dir: info.dir },
    ...(hosted?.clientHost ? { clientHost: hosted.clientHost } : {}),
    ...(hosted ? { client: { id: hosted.id, pid: hosted.pid, active: hosted.active } } : {}),
  };
}

/** `open`'s argument: a URI or `((…))` reference through the shared parser, else the id as given. */
function openRef(arg: string): { blockId: string; fragment?: string; address?: { outline: string; machine: string } } {
  const a = arg.trim();
  if (!a.startsWith("ep0ch://") && !a.startsWith("((")) return { blockId: a };
  const parsed = parseAddressedBlock(a);
  return "outline" in parsed ? { ...parsed, address: { outline: parsed.outline, machine: parsed.machine } } : parsed;
}

/** Client side: send one command to a running door and print the reply. */
export async function controlClient(args: string[]): Promise<number> {
  const commandArgs = args.filter(a => a !== "--json");
  const wantsJson = args.includes("--json");
  const [cmd, arg] = commandArgs;
  let req: Record<string, unknown>;
  // `subscribe [type,…]`: print the live feed, one JSON event per line, until interrupted.
  if (cmd === "subscribe") {
    const path = controlSocket();
    return new Promise(res => {
      const c = connect(path, () => c.write(jsonLine({ cmd, ...(arg ? { types: arg.split(",") } : {}) })));
      const lines = new JsonLines(r => console.log(JSON.stringify(r?.event)), l => console.log(l));
      c.on("data", chunk => lines.feed(chunk));
      c.on("close", () => res(0));
      c.on("error", () => { console.error(`no door answered at ${path}`); res(1); });
    });
  }
  try {
    // `snap <file>`: the door sends the PNG and this command writes it, where the person said; the door
    // itself writes only under its state (snapPath).
    if (cmd === "open" && (!arg || (arg.includes("=") && !arg.startsWith("file:")))) throw new Error("open needs a block id: open <id> [from=<tile>] [--as <your id>] [--json], or a file: open file:<absolute path> [diff=true]");
    // A block reference as written (`((id))`, `((id|label))`, `((id^fragment))`, what a picker prints) names the same
    // note, through outline-core's one parser; a canonical URI carries its outline address too. A fragment (`^anchor`,
    // `#anchor`) goes on to the open, whose reader scrolls to it. Anything else is passed as the door's own id.
    // `open file:<absolute path> [diff=true] [against=<copy>]`: a file on this machine, not a block (PIE-602).
    const fileTarget = cmd === "open" && arg!.startsWith("file:") ? arg!.slice(5) : null;
    const openTarget = cmd === "open" && fileTarget === null ? openRef(arg!) : null;
    req = cmd === "snap" ? (arg ? { cmd, data: true } : { cmd })
      : fileTarget !== null ? { cmd: "act", ...(await parseActArgs(["open", `file=${fileTarget}`, ...commandArgs.slice(2)])) }
      : cmd === "open" ? { cmd: "act", ...(openTarget!.address ? { address: openTarget!.address } : {}), ...(await parseActArgs(["open", `id=${openTarget!.blockId}`, ...(openTarget!.fragment ? [`fragment=${openTarget!.fragment}`] : []), ...commandArgs.slice(2)])) }
      : cmd === "act" ? { cmd, ...(await parseActArgs(commandArgs.slice(1))) } : { cmd };
  } catch (e) { console.error((e as Error).message); return 1; }
  // An agent names itself once per shell: EP0CH_AGENT=claude-7 (or --as on each act and open).
  if (req.cmd === "act" && !req.as && process.env.EP0CH_AGENT) req.as = process.env.EP0CH_AGENT;
  const path = controlSocket();
  const target = controlTarget(path);
  const r = await ask(target, req);
  if (!r) {
    if (cmd === "open" && wantsJson) console.log(JSON.stringify({ opened: false, reason: `no door answered at ${path}` }));
    else console.error(`no door answered at ${path}`);
    return cmd === "open" && wantsJson ? 0 : 1;
  }
  if (!r.ok) {
    if (cmd === "open" && wantsJson) console.log(JSON.stringify({ opened: false, reason: r.error }));
    else console.error(r.error);
    return cmd === "open" && wantsJson ? 0 : 1;
  }
  if (cmd === "peek") { console.log(JSON.stringify(r.result.screen, null, 2)); console.log(r.result.text.join("\n")); }
  else if (cmd === "actions") {
    const a = r.result;
    console.log(`${a.screen ?? "?"}${a.note ? ` · ${a.note}` : ""}${a.tiles?.length ? ` · tiles: ${a.tiles.join(", ")}` : ""}`);
    for (const x of a.actions) {
      const args = Object.entries(x.args as Record<string, { type: string; optional?: boolean }>).map(([k, v]) => `${k}=<${v.type}>${v.optional ? "?" : ""}`).join(" ");
      console.log(`  ${x.name}${args ? " " + args : ""}${x.keys ? `   [${x.keys}]` : ""}\n      ${x.summary}${x.touches ? `\n      touches ${x.touches}${x.person ? " (the person's only)" : ""} · replay ${x.replay}` : ""}`);
    }
  }
  else if (cmd === "snap" && arg) {
    const out = resolve(arg);
    try { writeFileSync(out, Buffer.from(r.result.png, "base64")); }
    catch (e) { console.error(`can't write ${out}: ${(e as Error).message}`); return 1; }
    console.log(JSON.stringify({ path: out, cols: r.result.cols, rows: r.result.rows }));
  }
  else if (cmd === "open" && wantsJson) {
    const base = typeof r.result === "object" && r.result !== null ? (r.result as Record<string, unknown>) : { result: r.result };
    const receiver = await receiverForControl(target);
    console.log(JSON.stringify({ ...base, ...(receiver ? { receiver } : {}), opened: true }));
  }
  else console.log(JSON.stringify(r.result));
  return 0;
}

/** One connected client as `ep0ch clients` lists it: any role the service reports, known or not. */
export interface ClientRow { role: string; clientId: string; pane: string; host: string; reading: string }

export function clientRows(list: readonly any[]): ClientRow[] {
  return list.map(c => ({
    role: String(c?.role ?? "?"),
    clientId: String(c?.clientId ?? "?"),
    pane: String(c?.runtime?.paneId ?? "—"),
    host: String(c?.runtime?.hostname ?? "—"),
    reading: c?.currentTarget?.kind === "block" ? `block ${String(c.currentTarget.blockId).slice(0, 8)}`
      : c?.currentTarget?.kind === "resource" ? "a resource" : "—",
  }));
}

/** `ep0ch clients`: who is connected to the service, one line each, every role (observers too). */
export function formatClients(rows: readonly ClientRow[]): string {
  if (!rows.length) return "no clients connected";
  const cols: (keyof ClientRow)[] = ["role", "pane", "host", "reading", "clientId"];
  const w = cols.map(k => Math.max(k.length, ...rows.map(r => r[k].length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i]!)).join("  ").trimEnd();
  return [line(cols.map(String)), ...rows.map(r => line(cols.map(k => r[k])))].join("\n");
}
