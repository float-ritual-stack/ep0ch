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
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { App } from "./app";
import { parseActArgs } from "./surface/actions";
import type { Mirror } from "./mirror";
import type { TermInfo } from "./term";
import { privateDir, stateDir } from "./state";

/** Where a door serves, and where `ep0ch act|peek|…` looks: EP0CH_CONTROL, else door.sock in the state dir. */
export const controlSocket = () => process.env.EP0CH_CONTROL ?? join(stateDir(), "door.sock");

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
    if (!types || types.has(e.type) || e.type === "hello") sock.write(JSON.stringify({ event: e }) + "\n");
  };
}

export interface ControlDeps { app: App; mirror: Mirror; info: () => TermInfo }

async function handle(req: any, d: ControlDeps): Promise<unknown> {
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
 * Is a door listening on `path`? False only when nobody is (the file is left from a door that died). A
 * file that isn't a socket has nobody on it either: macOS says ENOTSOCK where Linux says ECONNREFUSED.
 */
export const listening = (path: string, ms = 2000) => new Promise<boolean>(res => {
  const c = connect(path, () => { clearTimeout(t); c.end(); res(true); });
  // No answer in time: somebody holds it but isn't answering (a session or door busy starting): taken, not free.
  const t = setTimeout(() => { c.destroy(); res(true); }, ms);
  c.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(t); res(e.code !== "ECONNREFUSED" && e.code !== "ENOENT" && e.code !== "ENOTSOCK"); });
});

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
export async function startControl(d: ControlDeps, at = controlSocket()): Promise<{ path: string; close(): void }> {
  const dir = dirname(at);
  if (!privateDir(dir, resolve(dir) === resolve(stateDir()))) throw new Error(`${dir} isn't yours alone (it needs mode 700): no control socket, so agents can't reach this door`);
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
    let buf = "";
    // Decoded as a stream: a character split across two chunks arrives whole (a note's text, for edit.text).
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      // Only the new chunk is searched for a line's end: a long request costs its length once, not per chunk.
      if (!chunk.includes("\n")) {
        buf += chunk;
        if (buf.length > LINE_LIMIT) {
          // Said, then closed once said; nothing more it sends is read.
          sock.removeAllListeners("data"); buf = "";
          sock.end(JSON.stringify({ ok: false, error: `request line too long (over ${LINE_LIMIT} characters)` }) + "\n", () => sock.destroy());
        }
        return;
      }
      buf += chunk;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let req: any;
        try { req = JSON.parse(line); } catch { sock.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n"); continue; }
        // The live feed: this connection stays open, and every change to what the person sees comes down it as
        // one JSON line (`{"event":{…}}`) until the subscriber hangs up.
        if (req.cmd === "subscribe") {
          const types = Array.isArray(req.types) ? new Set<string>(req.types.map(String)) : null;
          let off = () => {};
          off = d.app.subscribe(feedWriter(sock, types, () => off()));
          sock.on("close", off); sock.on("error", off);
          continue;
        }
        handle(req, d).then(result => sock.write(JSON.stringify({ ok: true, result }) + "\n"), e => sock.write(JSON.stringify({ ok: false, error: String(e.message ?? e) }) + "\n"));
      }
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

/** Client side: send one command to a running door and print the reply. */
export async function controlClient(args: string[]): Promise<number> {
  const [cmd, arg] = args;
  let req: Record<string, unknown>;
  // `subscribe [type,…]`: print the live feed, one JSON event per line, until interrupted.
  if (cmd === "subscribe") {
    const path = controlSocket();
    return new Promise(res => {
      const c = connect(path, () => c.write(JSON.stringify({ cmd, ...(arg ? { types: arg.split(",") } : {}) }) + "\n"));
      let buf = "";
      c.on("data", chunk => {
        buf += chunk.toString();
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { console.log(JSON.stringify(JSON.parse(l).event)); } catch { console.log(l); } }
      });
      c.on("close", () => res(0));
      c.on("error", e => { console.error(`no door running at ${path} (${e.message})`); res(1); });
    });
  }
  try {
    // `snap <file>`: the door sends the PNG and this command writes it, where the person said; the door
    // itself writes only under its state (snapPath).
    // `open <id> [from=<tile>] [tile=<tile>] [--as <id>]` is `act open id=<id> …`: one way to open a note.
    if (cmd === "open" && (!arg || arg.includes("="))) throw new Error("open needs a block id: open <id> [from=<tile>] [--as <your id>]");
    req = cmd === "snap" ? (arg ? { cmd, data: true } : { cmd })
      : cmd === "open" ? { cmd: "act", ...(await parseActArgs(["open", `id=${arg}`, ...args.slice(2)])) }
      : cmd === "act" ? { cmd, ...(await parseActArgs(args.slice(1))) } : { cmd };
  } catch (e) { console.error((e as Error).message); return 1; }
  // An agent names itself once per shell: EP0CH_AGENT=claude-7 (or --as on each act and open).
  if (req.cmd === "act" && !req.as && process.env.EP0CH_AGENT) req.as = process.env.EP0CH_AGENT;
  const path = controlSocket();
  return new Promise(res => {
    const c = connect(path, () => c.write(JSON.stringify(req) + "\n"));
    let buf = "";
    c.on("data", chunk => {
      buf += chunk.toString();
      const i = buf.indexOf("\n");
      if (i < 0) return;
      const r = JSON.parse(buf.slice(0, i));
      c.end();
      if (!r.ok) { console.error(r.error); return res(1); }
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
        catch (e) { console.error(`can't write ${out}: ${(e as Error).message}`); return res(1); }
        console.log(JSON.stringify({ path: out, cols: r.result.cols, rows: r.result.rows }));
      }
      else console.log(JSON.stringify(r.result));
      res(0);
    });
    c.on("error", e => { console.error(`no door running at ${path} (${e.message})`); res(1); });
  });
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
