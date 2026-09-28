// Let an agent see what you see: a local socket where `peek` returns the screen as text plus
// structured state (which pane shows which block), `snap` composites exactly what the terminal
// was sent into a PNG, and `open` puts a block in front of you.
//   bun src/main.ts peek | snap [file.png] | open <block-id>
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import type { App } from "./app";
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
  throw new Error(`unknown command ${req.cmd}; try peek, snap or open`);
}

/** Serve on door.sock; if another live door already has it, use door-<pid>.sock. */
export async function startControl(d: ControlDeps): Promise<{ path: string; close(): void }> {
  mkdirSync(DIR, { recursive: true });
  let path = CONTROL_SOCKET;
  if (existsSync(path)) {
    const live = await new Promise<boolean>(res => { const c = connect(path, () => { c.end(); res(true); }); c.on("error", () => res(false)); });
    if (live) path = join(DIR, `door-${process.pid}.sock`);
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
  const req = cmd === "snap" ? { cmd, path: arg } : cmd === "open" ? { cmd, id: arg } : { cmd };
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
      else console.log(JSON.stringify(r.result));
      res(0);
    });
    c.on("error", e => { console.error(`no door running at ${path} (${e.message})`); res(1); });
  });
}
