import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server as SocketServer } from "node:net";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { forwardPaths, sshArgv, withForwardLock } from "@ep0ch/outline-core/machine";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { hostAnswers, nodeMachineIO } from "./machine-forward";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { LinkStreams } from "./link-streams";

const proof = (key: string, machine: string, nonce: string) => createHmac("sha256", key).update(`ep0ch-link\n${machine}\n${nonce}`).digest();
type Peer = { nonce: string; machine?: string; streams?: LinkStreams; listener?: SocketServer; timer?: ReturnType<typeof setTimeout>; last: number; closed?: boolean };
export function serveLink(o: { outlines: string; port: number; keys: Record<string, string>; log: (line: string) => void }) {
  const io = nodeMachineIO(), peers = new Map<string, ServerWebSocket<Peer>>();
  if (new Set(Object.values(o.keys)).size !== Object.keys(o.keys).length) throw new Error("Each link key must name only one machine");
  for (const machine of Object.keys(o.keys)) forwardPaths(o.outlines, machine);
  io.privateDir(join(o.outlines, ".remote"));
  const cleanup = (ws: ServerWebSocket<Peer>) => {
    const p = ws.data;
    p.closed = true; clearTimeout(p.timer); p.streams?.close(); p.listener?.close();
    if (p.machine && peers.get(p.machine) === ws) {
      peers.delete(p.machine);
      // Node's listener owns unlinking its socket; do not unlink a replacement SSH forward.
      io.remove(join(o.outlines, ".remote", `${p.machine}.link.json`));
      o.log(`link ${p.machine} down`);
    }
  };
  const server = Bun.serve<Peer>({
    hostname: "127.0.0.1", port: o.port,
    fetch(req, server) {
      if (new URL(req.url).pathname !== "/" || !server.upgrade(req, { data: { nonce: randomBytes(32).toString("hex"), last: Date.now() } })) return new Response("WebSocket authentication required", { status: 401 });
    },
    websocket: {
      maxPayloadLength: 1024 * 1024, backpressureLimit: 4 * 1024 * 1024, closeOnBackpressureLimit: true,
      open(ws) {
        ws.send(JSON.stringify({ challenge: ws.data.nonce, protocol: PROTOCOL }));
        ws.data.timer = setTimeout(() => { o.log("link refused: authentication timeout"); ws.close(1008, "authentication timeout"); }, 5000);
      },
      async message(ws, bytes) {
        const p = ws.data;
        try {
          if (!p.streams) {
            if (typeof bytes !== "string" || p.machine) throw new Error("authentication required");
            const auth = JSON.parse(bytes);
            if (auth.protocol !== PROTOCOL) throw new Error("protocol mismatch; run ep0ch install --apply on both machines");
            if (typeof auth.machine !== "string" || !isMachineName(auth.machine) || typeof auth.proof !== "string" || !/^[a-f0-9]{64}$/.test(auth.proof)) throw new Error("invalid proof");
            const key = Object.hasOwn(o.keys, auth.machine) ? o.keys[auth.machine] : undefined;
            if (!key || !timingSafeEqual(proof(key, auth.machine, p.nonce), Buffer.from(auth.proof, "hex"))) throw new Error("unknown machine or wrong key");
            if (peers.has(auth.machine)) throw new Error("machine already linked");
            p.machine = auth.machine;
            peers.set(auth.machine, ws);
            const paths = forwardPaths(o.outlines, auth.machine);
            // Serialize with ensureForward so SSH cannot replace the link while it binds.
            await withForwardLock(`${paths.control}.lock`, io, async () => {
              if (p.closed) return;
              // The old SSH listener must relinquish this pathname, or its later exit could unlink the link.
              const ssh = process.env.EP0CH_SSH || "ssh";
              if ((await io.run(sshArgv.check(ssh, paths), 5000)).code === 0) {
                if ((await io.run(sshArgv.exit(ssh, paths), 5000)).code !== 0) throw new Error("SSH forward could not release its socket");
                const deadline = Date.now() + 5000;
                while (existsSync(paths.socket) && Date.now() < deadline) await Bun.sleep(20);
                if (existsSync(paths.socket)) throw new Error("SSH forward has not released its socket; reconnect");
              }
              if (p.closed) return;
              io.remove(paths.socket);
              const streams = p.streams = new LinkStreams(data => ws.send(data));
              p.listener = createServer(socket => streams.open(socket));
              await new Promise<void>((resolve, reject) => { p.listener!.once("error", reject); p.listener!.listen(paths.socket, resolve); });
              if (p.closed) { p.listener.close(); return; }
              chmodSync(paths.socket, 0o600);
              const since = new Date().toISOString();
              const stateFile = join(paths.dir, `${auth.machine}.link.json`);
              writeFileSync(`${stateFile}.tmp`, JSON.stringify({ machine: auth.machine, since, pid: process.pid }), { mode: 0o600 });
              renameSync(`${stateFile}.tmp`, stateFile);
              clearTimeout(p.timer); ws.send(JSON.stringify({ ready: true })); o.log(`link ${auth.machine} up since ${since}`);
            });
          } else if (typeof bytes === "string") {
            if (bytes !== "ping") throw new Error("unexpected message");
            p.last = Date.now(); ws.send("pong");
          } else p.streams.receive(Buffer.from(bytes));
        } catch (error) { o.log(`link refused: ${(error as Error).message}`); ws.close(1008, "link refused"); }
      },
      close: cleanup,
    },
  });
  const heartbeat = setInterval(() => { for (const ws of peers.values()) if (Date.now() - ws.data.last > 45_000) ws.terminate(); }, 15_000);
  return { port: server.port!, async stop() { clearInterval(heartbeat); for (const ws of peers.values()) { cleanup(ws); ws.terminate(); } await server.stop(true); } };
}

export function connectLink(o: { server: string; machine: string; key: string; host: string; statusPath?: string; log: (line: string) => void }) {
  let stopped = false, ws: WebSocket | undefined, streams: LinkStreams | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  let delay = 1000;
  const clearState = () => { if (o.statusPath) nodeMachineIO().remove(o.statusPath); };
  const dial = () => {
    if (stopped) return;
    const url = new URL(o.server); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = ws = new WebSocket(url); socket.binaryType = "arraybuffer";
    let last = Date.now();
    const timeout = setTimeout(() => socket.close(), 10_000);
    socket.onmessage = event => {
      try {
        if (typeof event.data !== "string") { if (!streams) throw new Error("not authenticated"); streams.receive(Buffer.from(event.data)); return; }
        if (event.data === "pong") { last = Date.now(); return; }
        const message = JSON.parse(event.data);
        if (typeof message.challenge === "string" && !streams) {
          if (message.protocol !== PROTOCOL) throw new Error("protocol mismatch");
          socket.send(JSON.stringify({ protocol: PROTOCOL, machine: o.machine, proof: proof(o.key, o.machine, message.challenge).toString("hex") }));
        } else if (message.ready === true && !streams) {
          clearTimeout(timeout); delay = 1000;
          streams = new LinkStreams(data => { if (socket.bufferedAmount > 4 * 1024 * 1024) socket.close(); else socket.send(data); }, o.host);
          const since = new Date().toISOString();
          if (o.statusPath) writeFileSync(o.statusPath, JSON.stringify({ machine: o.machine, since, pid: process.pid }), { mode: 0o600 });
          o.log(`link ${o.machine} up since ${since}`);
          heartbeat = setInterval(() => { if (Date.now() - last > 45_000) socket.close(); else socket.send("ping"); }, 15_000);
        } else throw new Error("unexpected authentication message");
      } catch (error) { o.log(`link refused: ${(error as Error).message}; check ep0ch install --apply on both machines`); socket.close(1008, "invalid link message"); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(timeout); clearInterval(heartbeat); streams?.close(); streams = undefined; clearState();
      if (!stopped) { o.log(`link down; reconnect in ${delay / 1000}s`); retry = setTimeout(dial, delay); delay = Math.min(delay * 2, 30_000); }
    };
  };
  dial();
  return { stop() { stopped = true; clearState(); clearTimeout(retry); clearInterval(heartbeat); streams?.close(); ws?.close(); } };
}

export function linkStates(outlines: string) {
  const dir = join(outlines, ".remote"), io = nodeMachineIO();
  let files: string[]; try { files = readdirSync(dir); } catch { return []; }
  return files.filter(f => f.endsWith(".link.json")).flatMap(file => {
    try { const state = JSON.parse(readFileSync(join(dir, file), "utf8")); return io.alive(state.pid) ? [state as { machine: string; since: string; pid: number }] : []; } catch { return []; }
  });
}

/** Both transports share the client socket; status probes that socket without starting SSH. */
export async function linkStatus(outlines: string) {
  const dir = join(outlines, ".remote"), links = linkStates(outlines);
  let files: string[]; try { files = readdirSync(dir); } catch { files = []; }
  const outbound: { machine: string; transport: string; up: boolean; since: string; direction: string }[] = [];
  try {
    const state = JSON.parse(readFileSync(join(outlines, ".host/link-state.json"), "utf8"));
    if (nodeMachineIO().alive(state.pid)) outbound.push({ machine: state.machine, transport: "link", up: true, since: state.since, direction: "outbound" });
  } catch { /* No connector is running here. */ }
  const inbound = await Promise.all(files.filter(f => f.endsWith(".sock")).map(async file => {
    const machine = file.slice(0, -5), link = links.find(l => l.machine === machine);
    let since = link?.since;
    if (!since) { try { since = statSync(join(dir, `${machine}.ctl`)).mtime.toISOString(); } catch {} }
    return { machine, transport: link ? "link" : "ssh", up: await hostAnswers(join(dir, file)), since };
  }));
  return [...inbound, ...outbound];
}
