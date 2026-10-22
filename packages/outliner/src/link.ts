import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server as SocketServer } from "node:net";
import { chmodSync, existsSync, readFileSync, readlinkSync, readdirSync, statSync, writeFileSync, renameSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import type { ServerWebSocket } from "bun";
import { forwardPaths, sshArgv, withForwardLock } from "@ep0ch/outline-core/machine";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { hostAnswers, nodeMachineIO } from "./machine-forward";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { LinkStreams } from "./link-streams";
import { readLinkConfig } from "./link-config";
import { linkDeployPath, linkDeployAt, linkResultPath, readLinkFile, writeLinkFile, type LinkDeploy, type LinkInstallResult, type LinkUpdate } from "./link-install";
export { publishLinkInstall, linkInstallResult, linkInstallSummary, linkUpdateLabel, reconcileLinkInstall } from "./link-install";
export type { LinkDeploy, LinkInstallResult } from "./link-install";

export type OpenResult = { opened: true; machine: string } | { opened: false; error?: string };
const openSocket = (outlines: string) => join(outlines, ".host/link-open.sock");

/** Ask the link process on this host; a missing link leaves delivery to the terminal. */
export async function openLinked(outlines: string, url: string): Promise<OpenResult> {
  try {
    const response = await fetch("http://localhost/open", { unix: openSocket(outlines), method: "POST", body: JSON.stringify({ url }) });
    return await response.json() as OpenResult;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ECONNREFUSED" || code === "FailedToOpenSocket") return { opened: false };
    return { opened: false, error: `laptop link: ${(error as Error).message}; run ep0ch link status` };
  }
}

type LinkState = { machine: string; since?: string; pid: number; up: boolean; reason?: string };
const savedState = (path: string): LinkState | undefined => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return; }
};
function saveState(path: string, state: LinkState) {
  writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

const proof = (key: string, machine: string, nonce: string, role: "client" | "server" = "client") => createHmac("sha256", key).update(`ep0ch-link-${role}\n${machine}\n${nonce}`).digest();
const receiptKey = (result: LinkInstallResult) => createHash("sha256").update(JSON.stringify(result)).digest("hex");
type Peer = { nonce: string; machine?: string; streams?: LinkStreams; listener?: SocketServer; timer?: ReturnType<typeof setTimeout>; last: number; closed?: boolean; reason?: string; authenticated?: boolean; sent?: string };
export function serveLink(o: { outlines: string; port: number; keys: Record<string, string>; log: (line: string) => void; onResult?: (machine: string, result: LinkInstallResult, deploy: LinkDeploy) => Promise<void> }) {
  let reporting = Promise.resolve();
  let openId = 0;
  const opens = new Map<number, { ws: ServerWebSocket<Peer>; finish: (result: OpenResult) => void }>();
  const io = nodeMachineIO(), peers = new Map<string, ServerWebSocket<Peer>>();
  if (new Set(Object.values(o.keys)).size !== Object.keys(o.keys).length) throw new Error("Each link key must name only one machine");
  for (const machine of Object.keys(o.keys)) forwardPaths(o.outlines, machine);
  io.privateDir(join(o.outlines, ".remote"));
  const sendInstall = (ws: ServerWebSocket<Peer>) => {
    const deploy = readLinkFile<LinkDeploy>(linkDeployPath(o.outlines));
    if (deploy && ws.data.authenticated && ws.data.sent !== deploy.sha) {
      ws.data.sent = deploy.sha;
      ws.send(JSON.stringify({ install: deploy.sha }));
    }
  };
  io.privateDir(join(o.outlines, ".host"));
  const updates = watch(join(o.outlines, ".host"), (_, file) => {
    if (file === "link-deploy.json") for (const ws of peers.values()) sendInstall(ws);
  });
  const cleanup = (ws: ServerWebSocket<Peer>, code?: number, reason?: string) => {
    const p = ws.data;
    for (const pending of opens.values()) if (pending.ws === ws) pending.finish({ opened: false, error: "laptop link disconnected; run ep0ch link status" });
    p.closed = true; clearTimeout(p.timer); p.streams?.close(); p.listener?.close();
    if (p.machine && peers.get(p.machine) === ws) {
      peers.delete(p.machine);
      const paths = forwardPaths(o.outlines, p.machine);
      try { if (readlinkSync(paths.socket) === join(paths.dir, `${p.machine}.link.sock`)) io.remove(paths.socket); } catch {}
      const statePath = join(paths.dir, `${p.machine}.link.json`);
      saveState(statePath, { machine: p.machine, since: savedState(statePath)?.since, pid: process.pid, up: false, reason: p.reason ?? (reason || `connection closed (${code ?? 1006})`) });
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
          if (!p.authenticated) {
            if (typeof bytes !== "string" || p.machine) throw new Error("authentication required");
            const auth = JSON.parse(bytes);
            if (!Number.isInteger(auth.protocol)) throw new Error("invalid protocol");
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
              if (auth.protocol === PROTOCOL) {
                const linkSocket = join(paths.dir, `${auth.machine}.link.sock`);
                io.remove(linkSocket);
                const streams = p.streams = new LinkStreams(data => ws.send(data));
                p.listener = createServer(socket => streams.open(socket));
                await new Promise<void>((resolve, reject) => { p.listener!.once("error", reject); p.listener!.listen(linkSocket, resolve); });
                if (p.closed) { p.listener.close(); return; }
                chmodSync(linkSocket, 0o600);
                io.routeLink(paths.socket, linkSocket);
              }
              const since = new Date().toISOString();
              const stateFile = join(paths.dir, `${auth.machine}.link.json`);
              saveState(stateFile, { machine: auth.machine, since, pid: process.pid, up: true });
              p.authenticated = true;
              clearTimeout(p.timer); ws.send(JSON.stringify({ ready: true, compatible: auth.protocol === PROTOCOL, proof: proof(key, auth.machine, p.nonce, "server").toString("hex") })); sendInstall(ws); o.log(`link ${auth.machine} up since ${since}`);
            });
          } else if (typeof bytes === "string") {
            if (bytes === "ping") { p.last = Date.now(); ws.send("pong"); return; }
            const message = JSON.parse(bytes), result = message.result;
            if (Number.isInteger(message.opened)) {
              const pending = opens.get(message.opened);
              if (pending?.ws === ws) pending.finish(message.error ? { opened: false, error: String(message.error) } : { opened: true, machine: p.machine! });
              return;
            }
            if (!result || typeof result.sha !== "string" || !/^[a-f0-9]{40}$/.test(result.sha) || !Number.isInteger(result.code) || !Array.isArray(result.notDone) || !result.notDone.every((s: unknown) => typeof s === "string") || !Array.isArray(result.sessions)) throw new Error("invalid install result");
            const deploy = readLinkFile<LinkDeploy>(linkDeployAt(o.outlines, result.sha));
            if (!deploy) throw new Error("unexpected install result");
            const saved = reporting.then(async () => {
              await o.onResult?.(p.machine!, result, deploy);
              writeLinkFile(linkResultPath(o.outlines, p.machine!, result.sha), result);
              if (!p.closed) ws.send(JSON.stringify({ received: receiptKey(result) }));
            });
            reporting = saved.catch(() => {});
            await saved;
          } else {
            if (!p.streams) throw new Error("protocol mismatch; run ep0ch install --apply on both machines");
            p.streams.receive(Buffer.from(bytes));
          }
        } catch (error) { p.reason = (error as Error).message; o.log(`link refused: ${p.reason}`); ws.close(1008, p.reason); }
      },
      close: cleanup,
    },
  });
  const socket = openSocket(o.outlines);
  io.remove(socket);
  const opener = Bun.serve({ unix: socket, async fetch(req) {
    const { url } = await req.json() as { url: string };
    const ws = [...peers.values()].find(ws => ws.data.authenticated && ws.data.streams && !ws.data.closed);
    if (!ws) return Response.json({ opened: false });
    const id = ++openId;
    const result = await new Promise<OpenResult>(resolve => {
      const timer = setTimeout(() => finish({ opened: false, error: "laptop link did not answer; run ep0ch link status" }), 5000);
      const finish = (result: OpenResult) => { clearTimeout(timer); opens.delete(id); resolve(result); };
      opens.set(id, { ws, finish });
      ws.send(JSON.stringify({ open: url, id }));
    });
    return Response.json(result);
  } });
  chmodSync(socket, 0o600);
  for (const machine of Object.keys(o.keys)) {
    const path = join(o.outlines, ".remote", `${machine}.link.json`);
    saveState(path, { machine, since: savedState(path)?.since, pid: process.pid, up: false, reason: "waiting for connector" });
  }
  const heartbeat = setInterval(() => { for (const ws of peers.values()) if (Date.now() - ws.data.last > 25_000) { ws.data.reason = "heartbeat timed out"; ws.terminate(); } }, 10_000);
  return { port: server.port!, async stop() { await opener.stop(true); io.remove(socket); updates.close(); clearInterval(heartbeat); for (const ws of peers.values()) { ws.data.reason = "link server stopped"; cleanup(ws); ws.terminate(); } await server.stop(true); } };
}

export function connectLink(o: { server: string; machine: string; key: string; host: string; statusPath?: string; commit?: string; install?: (sha: string) => Promise<LinkInstallResult>; autoInstall?: () => boolean; onInstalled?: () => void; open?: (url: string) => Promise<void>; log: (line: string) => void }) {
  const updatePath = o.statusPath ? join(o.statusPath, "../link-update.json") : undefined;
  let update = updatePath ? readLinkFile<LinkUpdate>(updatePath) : undefined;
  let receipts = update?.receipts ?? [];
  let installing = false;
  let wanted: string | undefined;
  let considerCurrent = () => {};
  let sendResult: ((result: LinkInstallResult) => void) | undefined;
  const saveUpdate = () => {
    if (!update) return;
    update = { ...update, receipts };
    if (updatePath) writeLinkFile(updatePath, update);
  };
  const returnResult = (result: LinkInstallResult) => {
    if (!receipts.some(r => receiptKey(r) === receiptKey(result))) receipts.push(result);
    saveUpdate();
    sendResult?.(result);
  };
  let stopped = false, streams: LinkStreams | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  let delay = 1000;
  let since = o.statusPath ? savedState(o.statusPath)?.since : undefined;
  const state = (up: boolean, reason?: string) => { if (o.statusPath) saveState(o.statusPath, { machine: o.machine, since, pid: process.pid, up, reason }); };
  state(false, "connecting");
  let finish: (reason: string) => void = () => {};
  const dial = () => {
    if (stopped) return;
    const url = new URL(o.server); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url); socket.binaryType = "arraybuffer";
    let last = Date.now(), ended = false, authenticated = false, nonce = "";
    const consider = async () => {
      if (!authenticated || ended || !update || installing) return;
      if (update.result && update.phase !== "ready") { returnResult(update.result); return; }
      const sha = update.sha;
      if (o.commit === sha && update.phase === "ready" && !update.result) {
        update = { sha, phase: "done", result: { sha, code: 0, notDone: [], sessions: [] } };
        returnResult(update.result!); return;
      }
      if (o.autoInstall?.() === false || !o.install) {
        update.phase = "ready";
        returnResult({ sha: update.sha, code: 1, notDone: ["auto-install off; run ep0ch install --apply"], sessions: [] });
        return;
      }
      installing = true; update = { sha, phase: "installing" }; saveUpdate();
      let result: LinkInstallResult;
      try { result = await o.install(sha); }
      catch (error) { result = { sha, code: 1, notDone: ["install"], sessions: [], error: (error as Error).message }; }
      installing = false;
      update = { sha, phase: result.code === 0 && !result.error ? "done" : "blocked", result, restart: !!result.commit && result.commit !== o.commit };
      returnResult(result);
      if (wanted && wanted !== sha) { update = { sha: wanted, phase: "ready" }; saveUpdate(); considerCurrent(); }
    };
    considerCurrent = () => { void consider(); };
    const configWatch = o.statusPath ? watch(dirname(o.statusPath), (_, file) => {
      if (file === "link-update.json" && !installing && updatePath) {
        const saved = readLinkFile<LinkUpdate>(updatePath);
        if (JSON.stringify(saved) !== JSON.stringify(update)) { update = saved; receipts = saved?.receipts ?? []; void consider(); }
      }
      if (file === "link.json") void consider();
    }) : undefined;
    const timeout = setTimeout(() => endAttempt("connection timed out"), 10_000);
    finish = (reason: string) => {
      if (ended) return;
      ended = true; configWatch?.close(); sendResult = undefined;
      clearTimeout(timeout); clearInterval(heartbeat); streams?.close(); streams = undefined;
      socket.close(); state(false, reason);
      if (!stopped) { o.log(`link down: ${reason}; reconnect in ${delay / 1000}s`); retry = setTimeout(dial, delay); delay = Math.min(delay * 2, 15_000); }
    };
    const endAttempt = finish;
    socket.onmessage = event => {
      if (ended) return;
      try {
        if (typeof event.data !== "string") { if (!streams) throw new Error("not authenticated"); streams.receive(Buffer.from(event.data)); return; }
        if (event.data === "pong") { last = Date.now(); return; }
        const message = JSON.parse(event.data);
        if (typeof message.challenge === "string" && !authenticated) {
          nonce = message.challenge;
          socket.send(JSON.stringify({ protocol: PROTOCOL, machine: o.machine, proof: proof(o.key, o.machine, message.challenge).toString("hex") }));
        } else if (message.ready === true && !authenticated) {
          if (typeof message.proof !== "string" || !/^[a-f0-9]{64}$/.test(message.proof) || !timingSafeEqual(proof(o.key, o.machine, nonce, "server"), Buffer.from(message.proof, "hex"))) throw new Error("server did not prove the link key");
          authenticated = true;
          sendResult = result => socket.send(JSON.stringify({ result }));
          for (const receipt of receipts) sendResult(receipt);
          clearTimeout(timeout); delay = 1000;
          if (message.compatible) streams = new LinkStreams(data => { if (socket.bufferedAmount > 4 * 1024 * 1024) socket.close(); else socket.send(data); }, o.host);
          since = new Date().toISOString(); state(true);
          o.log(`link ${o.machine} up since ${since}`);
          heartbeat = setInterval(() => { if (Date.now() - last > 25_000) endAttempt("heartbeat timed out"); else socket.send("ping"); }, 10_000);
        } else if (authenticated && typeof message.open === "string") {
          const id = message.id;
          void (async () => {
            try {
              const url = new URL(message.open);
              if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only HTTP or HTTPS links can open on this machine");
              if (!o.open) throw new Error("this connector cannot open links; run ep0ch install --apply on the Mac");
              await o.open(url.href);
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ opened: id }));
            } catch (error) {
              const why = (error as Error).stack ?? String(error);
              o.log(`open failed: ${why}`);
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ opened: id, error: why }));
            }
          })();
        } else if (authenticated && typeof message.install === "string" && /^[a-f0-9]{40}$/.test(message.install)) {
          wanted = message.install;
          if (installing) return;
          if (update?.sha !== message.install) update = { sha: message.install, phase: "ready" };
          void consider();
        } else if (authenticated && typeof message.received === "string" && /^[a-f0-9]{64}$/.test(message.received)) {
          receipts = receipts.filter(r => receiptKey(r) !== message.received);
          const restart = update?.restart && update.result && receiptKey(update.result) === message.received;
          if (restart && update) update.restart = false;
          saveUpdate();
          if (restart) o.onInstalled?.();
        } else throw new Error("unexpected authentication message");
      } catch (error) { endAttempt(`${(error as Error).message}; check ep0ch install --apply on both machines`); }
    };
    socket.onerror = () => endAttempt("connection failed");
    socket.onclose = event => endAttempt(event.reason || `connection closed (${event.code})`);
  };
  dial();
  return { stop() { stopped = true; clearTimeout(retry); finish("connector stopped"); state(false, "connector stopped"); } };
}

export function linkStates(outlines: string) {
  const dir = join(outlines, ".remote"), io = nodeMachineIO();
  let files: string[]; try { files = readdirSync(dir); } catch { return []; }
  return files.filter(f => f.endsWith(".link.json")).flatMap(file => {
    const state = savedState(join(dir, file)); return state?.up && io.alive(state.pid) ? [state] : [];
  });
}

/** Both transports share the client socket; status probes that socket without starting SSH. */
export async function linkStatus(outlines: string) {
  const dir = join(outlines, ".remote"), io = nodeMachineIO();
  let files: string[]; try { files = readdirSync(dir); } catch { files = []; }
  const config = readLinkConfig(outlines);
  const machines = new Set(files.filter(f => f.endsWith(".link.json")).map(f => f.slice(0, -10)));
  if (config?.mode === "serve") for (const machine of config.machines) machines.add(machine);
  const rows: { machine: string; transport: "link" | "ssh"; up: boolean; running?: boolean; pid?: number; since?: string; direction: "inbound" | "outbound"; reason?: string }[] = [];
  const add = (machine: string, path: string, direction: "inbound" | "outbound") => {
    const state = savedState(path), alive = state && io.alive(state.pid);
    const up = !!(alive && state.up);
    rows.push({ machine, transport: "link", up, running: !!alive, pid: state?.pid, since: state?.since, direction, reason: up ? undefined : alive ? state.reason : "link process is not running; run ep0ch install --apply" });
  };
  for (const machine of machines) add(machine, join(dir, `${machine}.link.json`), "inbound");
  const outbound = savedState(join(outlines, ".host/link-state.json"));
  if (config?.mode === "connect" || outbound) add(config?.mode === "connect" ? config.machine : outbound!.machine, join(outlines, ".host/link-state.json"), "outbound");
  for (const file of files.filter(f => f.endsWith(".ctl"))) {
    const machine = file.slice(0, -4);
    let since: string | undefined;
    try { since = statSync(join(dir, file)).mtime.toISOString(); } catch {}
    rows.push({ machine, transport: "ssh", up: await hostAnswers(join(dir, `${machine}.sock`)), since, direction: "inbound" });
  }
  return rows;
}
