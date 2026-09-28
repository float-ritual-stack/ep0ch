// Let an agent see what you see, and do what you do: a local socket where `peek` returns the screen as
// text plus structured state (which reader shows which block, what it's editing or commenting on),
// `snap` composites exactly what the terminal was sent into a PNG, `open` puts a block in front of you,
// `actions` lists what the current screen can do, and `act` does one of those things as the agent.
//   bun src/main.ts peek | snap [file.png] | open <block-id> | actions | act <action> [key=value…] [--as <actor-id>]
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import type { App } from "./app";
import { parseActArgs } from "./surface/actions";
import type { Mirror } from "./mirror";
import type { TermInfo } from "./term";

const DIR = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door");
export const CONTROL_SOCKET = process.env.EP0CH_CONTROL ?? join(DIR, "door.sock");

export interface ControlDeps { app: App; mirror: Mirror; info: () => TermInfo }

async function handle(req: any, d: ControlDeps): Promise<unknown> {
  if (req.cmd === "peek") return { screen: d.app.describe(), text: d.mirror.text() };
  if (req.cmd === "snap") {
    const path = req.path || join(DIR, "screen.png");
    mkdirSync(dirname(path), { recursive: true });
    // Render at the VGA font's own 9×16 cell, whatever the real terminal's cell size is.
    writeFileSync(path, d.mirror.snapshot({ ...d.info(), cellW: 9, cellH: 16 }));
    return { path, cols: d.mirror.cols, rows: d.mirror.rows };
  }
  if (req.cmd === "open") {
    if (!req.id) throw new Error("open needs a block id");
    return { opened: await d.app.openBlock(String(req.id)) };
  }
  if (req.cmd === "actions") return d.app.actions();
  if (req.cmd === "act") {
    if (typeof req.action !== "string") throw new Error("act needs an action name; `actions` lists them");
    const args = req.args && typeof req.args === "object" && !Array.isArray(req.args) ? req.args : {};
    return d.app.act({ action: req.action, reader: typeof req.reader === "string" ? req.reader : undefined, args, as: typeof req.as === "string" ? req.as : undefined });
  }
  throw new Error(`unknown command ${req.cmd}; try peek, snap, open, actions or act`);
}

/** Serve on door.sock; if another live door already has it, use door-<pid>.sock. */
export async function startControl(d: ControlDeps, at = CONTROL_SOCKET): Promise<{ path: string; close(): void }> {
  mkdirSync(dirname(at), { recursive: true });
  let path = at;
  if (existsSync(path)) {
    const live = await new Promise<boolean>(res => { const c = connect(path, () => { c.end(); res(true); }); c.on("error", () => res(false)); });
    if (live) path = join(dirname(at), `door-${process.pid}.sock`);
    else unlinkSync(path);
  }
  const server: Server = createServer(sock => {
    let buf = "";
    sock.on("data", chunk => {
      buf += chunk.toString();
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let req: any;
        try { req = JSON.parse(line); } catch { sock.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n"); continue; }
        handle(req, d).then(result => sock.write(JSON.stringify({ ok: true, result }) + "\n"), e => sock.write(JSON.stringify({ ok: false, error: String(e.message ?? e) }) + "\n"));
      }
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((res, rej) => { server.once("error", rej); server.listen(path, () => res()); });
  return { path, close: () => { server.close(); try { unlinkSync(path); } catch { /* gone */ } } };
}

/** Client side: send one command to a running door and print the reply. */
export async function controlClient(args: string[]): Promise<number> {
  const [cmd, arg] = args;
  let req: Record<string, unknown>;
  try {
    req = cmd === "snap" ? { cmd, path: arg } : cmd === "open" ? { cmd, id: arg }
      : cmd === "act" ? { cmd, ...(await parseActArgs(args.slice(1))) } : { cmd };
  } catch (e) { console.error((e as Error).message); return 1; }
  // An agent names itself once per shell: EP0CH_AGENT=claude-7 (or --as on each act).
  if (cmd === "act" && !req.as && process.env.EP0CH_AGENT) req.as = process.env.EP0CH_AGENT;
  const path = process.env.EP0CH_CONTROL ?? CONTROL_SOCKET;
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
        console.log(`${a.screen ?? "?"}${a.note ? ` · ${a.note}` : ""}${a.readers?.length ? ` · readers: ${a.readers.join(", ")}` : ""}`);
        for (const x of a.actions) {
          const args = Object.entries(x.args as Record<string, { type: string; optional?: boolean }>).map(([k, v]) => `${k}=<${v.type}>${v.optional ? "?" : ""}`).join(" ");
          console.log(`  ${x.name}${args ? " " + args : ""}${x.keys ? `   [${x.keys}]` : ""}\n      ${x.summary}`);
        }
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
