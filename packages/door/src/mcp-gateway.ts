// `ep0ch mcp serve --http`: the remote MCP gateway (ADR 0002, decision 4; PIE-520's remote part). The same read-only
// server as `ep0ch mcp` (src/mcp.ts, `answerMcp`), over streamable HTTP, for the outlines on this machine's host.
//
// It is an OAuth resource server only. Clerk is the authorization server (client registration, the GitHub sign-in,
// tokens); this process checks each Bearer token itself: a JWT access token (`typ: at+jwt`) signed by a key in the
// issuer's JWKS, from that issuer, for this resource (`aud`), with a subject on EP0CH_MCP_ALLOWED_SUBJECTS. Unset,
// the list allows no one: every valid token is refused 403 and its subject is logged, so it can be pinned. There is
// no anonymous mode and no switch that turns the check off. Past the token, each outline's own `ep0ch mcp access`
// setting decides, as it does for stdio. Nothing here writes.
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { answerMcp, type McpOutlines, type NamedOutline } from "./mcp";
import { boardFor, canonicalLocalMachineName, type NotesBoard } from "./notes-cli";
import { OUTLINE_NAME } from "./socket";

export const DEFAULT_GATEWAY_PORT = 8792;
const MAX_BODY = 1024 * 1024;

/** What the gateway checks a token against. `keys`: the issuer's JWKS (a local set under test). */
export interface BearerPolicy {
  issuer: string;
  /** This endpoint's public URL, as clients name it and as tokens carry it in `aud` (RFC 8707). */
  resource: string;
  /** Token subjects (Clerk user ids) allowed in. Empty: nobody (capture mode). */
  allowedSubjects: readonly string[];
  /** When set, the OAuth clients (`client_id`) allowed in; otherwise any client a pinned person signed in with. */
  allowedClients?: readonly string[];
  keys: JWTVerifyGetKey;
}

export type BearerVerdict =
  | { ok: true; sub: string; clientId?: string }
  | { ok: false; status: 401 | 403 | 503; error?: string; description: string };

const trimSlash = (url: string) => url.replace(/\/+$/, "");
const listOf = (value: string | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);

/** Checks an Authorization header. Every failure is a refusal; nothing falls through to a read. */
export async function verifyBearer(authorization: string | null, policy: BearerPolicy, log: (line: string) => void = console.error): Promise<BearerVerdict> {
  const match = /^Bearer[ ]+([^\s]+)\s*$/i.exec(authorization ?? "");
  if (!match) return { ok: false, status: 401, description: "a Bearer access token is required" };
  const token = match[1]!;
  if (token.startsWith("oat_")) {
    log("mcp gateway: refused an opaque Clerk access token; this gateway verifies JWT access tokens (Clerk: OAuth applications → Settings → JWT access tokens)");
    return { ok: false, status: 401, error: "invalid_token", description: "opaque access tokens aren't accepted" };
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, policy.keys, {
      issuer: policy.issuer,
      algorithms: ["RS256"],
      typ: "at+jwt",
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 30,
    }));
  } catch (e) {
    if (e instanceof joseErrors.JWKSTimeout || !(e instanceof joseErrors.JOSEError)) {
      log(`mcp gateway: can't check tokens: the issuer's keys didn't load (${(e as Error).message})`);
      return { ok: false, status: 503, description: "the authorization server's keys are unreachable; try again" };
    }
    log(`mcp gateway: token refused: ${(e as Error).message}`);
    return { ok: false, status: 401, error: "invalid_token", description: "the access token is invalid or expired" };
  }
  const audiences = payload.aud === undefined ? [] : [payload.aud].flat();
  if (!audiences.some(a => typeof a === "string" && trimSlash(a) === trimSlash(policy.resource))) {
    log(`mcp gateway: token refused: aud ${JSON.stringify(payload.aud ?? null)} isn't ${policy.resource} (Clerk: aud_claim_enabled must be on)`);
    return { ok: false, status: 401, error: "invalid_token", description: "the access token is for another resource" };
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const clientId = typeof payload.client_id === "string" ? payload.client_id : undefined;
  const who = `sub=${sub} client_id=${clientId ?? "(none)"}`;
  if (!policy.allowedSubjects.length) {
    log(`mcp gateway: capture mode, refusing a valid token: ${who}. To let this person in, set EP0CH_MCP_ALLOWED_SUBJECTS=${sub} and restart.`);
    return { ok: false, status: 403, description: "this gateway hasn't been told who may use it yet" };
  }
  if (!sub || !policy.allowedSubjects.includes(sub)) {
    log(`mcp gateway: refused ${who}: not on EP0CH_MCP_ALLOWED_SUBJECTS`);
    return { ok: false, status: 403, description: "this account may not use this gateway" };
  }
  if (policy.allowedClients?.length && !(clientId && policy.allowedClients.includes(clientId))) {
    log(`mcp gateway: refused ${who}: client not on EP0CH_MCP_ALLOWED_CLIENTS`);
    return { ok: false, status: 403, description: "this client may not use this gateway" };
  }
  return { ok: true, sub, ...(clientId ? { clientId } : {}) };
}

/** Clerk's Frontend API URL, its OAuth issuer, from a publishable key (`pk_test_<base64 of "<host>$">`). */
export function issuerFromPublishableKey(key: string): string | undefined {
  const m = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key.trim());
  if (!m) return undefined;
  try {
    const host = Buffer.from(m[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : undefined;
  } catch { return undefined; }
}

const loopback = (url: URL) => url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";

/** The gateway's settings from its environment, or what's missing, said with what to set. */
export function gatewayConfig(env: Record<string, string | undefined>): { issuer: string; resource: URL; allowedSubjects: string[]; allowedClients: string[] } | { error: string } {
  const resourceText = env.EP0CH_MCP_RESOURCE?.trim();
  if (!resourceText) return { error: "EP0CH_MCP_RESOURCE is unset: set it to this endpoint's public URL, e.g. EP0CH_MCP_RESOURCE=https://mcp.ep0ch.sh/mcp" };
  let resource: URL;
  try { resource = new URL(resourceText); } catch { return { error: `EP0CH_MCP_RESOURCE=${resourceText} isn't a URL` }; }
  if (resource.protocol !== "https:" && !loopback(resource)) return { error: `EP0CH_MCP_RESOURCE must be https (got ${resourceText})` };
  if (resource.search || resource.hash) return { error: "EP0CH_MCP_RESOURCE takes no query or fragment" };
  const issuerText = env.EP0CH_MCP_ISSUER?.trim() || (env.CLERK_PUBLISHABLE_KEY ? issuerFromPublishableKey(env.CLERK_PUBLISHABLE_KEY) : undefined);
  if (!issuerText) return { error: "no issuer: run under `with-secrets clerk -- …` (CLERK_PUBLISHABLE_KEY), or set EP0CH_MCP_ISSUER to Clerk's Frontend API URL" };
  let issuer: URL;
  try { issuer = new URL(issuerText); } catch { return { error: `the issuer ${issuerText} isn't a URL` }; }
  if (issuer.protocol !== "https:" && !loopback(issuer)) return { error: `the issuer must be https (got ${issuerText})` };
  return { issuer: trimSlash(issuer.href), resource, allowedSubjects: listOf(env.EP0CH_MCP_ALLOWED_SUBJECTS), allowedClients: listOf(env.EP0CH_MCP_ALLOWED_CLIENTS) };
}

/**
 * The gateway's outlines: any outline on this machine's host by name, opened once and kept. Another machine's is
 * refused (this gateway reads only its own host), and an outline that doesn't exist is never made.
 */
export function machineOutlines(defaultOutline?: string, log: (line: string) => void = console.error, open: (name: string) => Promise<NotesBoard | { error: string }> = name => boardFor(["--ws", name, "--here"])): McpOutlines & { close(): void } {
  const machine = canonicalLocalMachineName();
  const boards = new Map<string, Promise<NotesBoard | { error: string }>>();
  return {
    kind: "remote",
    machine,
    ...(defaultOutline ? { defaultOutline } : {}),
    async board(named?: NamedOutline) {
      const name = named?.outline ?? defaultOutline;
      if (!name) return { error: `Name the outline: an outline on ${machine}.` };
      if (named?.machine && named.machine !== machine) return { error: `${name}@${named.machine} is on another machine; this gateway reads only outlines on ${machine}.` };
      if (!OUTLINE_NAME.test(name)) return { error: `${JSON.stringify(name)} isn't an outline name.` };
      let pending = boards.get(name);
      if (!pending) { pending = open(name); boards.set(name, pending); }
      const board = await pending;
      if ("error" in board) {
        boards.delete(name);
        log(`mcp gateway: can't open ${name}: ${board.error}`);
        return { error: `No outline ${name} is open to this gateway on ${machine}.` };
      }
      return board;
    },
    close() { for (const p of boards.values()) void p.then(b => { if (!("error" in b)) b.close(); }); boards.clear(); },
  };
}

export interface Gateway { url: string; port: number; stop(): void }

/** Starts the HTTP gateway. `keys` overrides the issuer's JWKS (tests sign their own). */
export function startGateway(opts: {
  config: Exclude<ReturnType<typeof gatewayConfig>, { error: string }>;
  outlines: McpOutlines;
  port: number;
  bind: string;
  keys?: JWTVerifyGetKey;
  log?: (line: string) => void;
}): Gateway {
  const { config, outlines } = opts;
  const log = opts.log ?? console.error;
  const resource = trimSlash(config.resource.href);
  const mcpPath = trimSlash(config.resource.pathname) || "/";
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath === "/" ? "" : mcpPath}`;
  const metadataUrl = `${config.resource.origin}${metadataPath}`;
  const policy: BearerPolicy = {
    issuer: config.issuer,
    resource,
    allowedSubjects: config.allowedSubjects,
    allowedClients: config.allowedClients,
    keys: opts.keys ?? createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`), { timeoutDuration: 5000, cooldownDuration: 30_000 }),
  };
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
  const quoted = (s: string) => `"${s.replace(/["\\]/g, "")}"`;
  const metadata = {
    resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["profile", "offline_access"],
    resource_name: "ep0ch",
  };

  const server = Bun.serve({
    hostname: opts.bind,
    port: opts.port,
    maxRequestBodySize: MAX_BODY,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === metadataPath) {
        return req.method === "GET" ? json(200, metadata) : json(405, { error: "method not allowed" }, { Allow: "GET" });
      }
      if (url.pathname === "/healthz" && req.method === "GET") return json(200, { ok: true });
      if (url.pathname !== mcpPath) return json(404, { error: "not found" });

      // Every request to the endpoint, whatever its method, shows its token first.
      const verdict = await verifyBearer(req.headers.get("authorization"), policy, log);
      if (!verdict.ok) {
        if (verdict.status === 401) {
          const challenge = [`Bearer resource_metadata=${quoted(metadataUrl)}`, ...(verdict.error ? [`error=${quoted(verdict.error)}`, `error_description=${quoted(verdict.description)}`] : [])].join(", ");
          return json(401, { error: verdict.error ?? "unauthorized", error_description: verdict.description }, { "WWW-Authenticate": challenge });
        }
        return json(verdict.status, { error: verdict.status === 403 ? "forbidden" : "unavailable", error_description: verdict.description });
      }
      // Stateless streamable HTTP: no server-sent stream and no session to end, so only POST carries messages.
      if (req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "POST" });
      const body = await req.text();
      if (body.length > MAX_BODY) return json(413, { error: "request too large" });
      const answer = await answerMcp(outlines, body);
      if (answer?.methods.length) log(`mcp gateway: ${verdict.sub} ${answer.methods.join(", ")}`);
      if (!answer) return json(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "empty request" } });
      if (answer.malformed) return json(400, answer.reply);
      if (answer.reply === null) return new Response(null, { status: 202, headers: cors });
      return json(200, answer.reply);
    },
  });
  return { url: `http://${opts.bind}:${server.port}${mcpPath}`, port: server.port!, stop: () => server.stop(true) };
}

interface ServeIo { err?: (line: string) => void; env?: Record<string, string | undefined>; keys?: JWTVerifyGetKey; ready?: (gateway: Gateway) => void; until?: Promise<unknown> }

function serveArgs(args: string[]): { port: number; bind: string; ws?: string } | { error: string } {
  if (!args.includes("--http")) return { error: "mcp serve takes --http (the stdio server is `ep0ch mcp`)" };
  let port = DEFAULT_GATEWAY_PORT, bind = "127.0.0.1", ws: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--http") continue;
    if (a === "--port" || a === "--bind" || a === "--ws") {
      const v = args[++i];
      if (!v || v.startsWith("--")) return { error: `${a} needs a value` };
      if (a === "--port") { port = Number(v); if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: `--port ${v} isn't a port` }; }
      else if (a === "--bind") bind = v;
      else { if (!OUTLINE_NAME.test(v)) return { error: `--ws ${v} isn't an outline name` }; ws = v; }
      continue;
    }
    return { error: `mcp serve doesn't take ${JSON.stringify(a)}; use --http, --port <n>, --bind <address> and --ws <name>` };
  }
  return { port, bind, ...(ws ? { ws } : {}) };
}

/** `ep0ch mcp serve --http …`: runs until stopped (or `io.until` settles, under test). */
export async function mcpServeCommand(args: string[], io: ServeIo = {}): Promise<number> {
  const err = io.err ?? console.error;
  const parsed = serveArgs(args);
  if ("error" in parsed) { err(`ep0ch: ${parsed.error}`); return 2; }
  const config = gatewayConfig(io.env ?? process.env);
  if ("error" in config) { err(`ep0ch: ${config.error}`); return 2; }
  const outlines = machineOutlines(parsed.ws, err);
  let gateway: Gateway;
  try { gateway = startGateway({ config, outlines, port: parsed.port, bind: parsed.bind, ...(io.keys ? { keys: io.keys } : {}), log: err }); }
  catch (e) { outlines.close(); err(`ep0ch: can't listen on ${parsed.bind}:${parsed.port}: ${(e as Error).message}`); return 1; }
  err(`ep0ch mcp gateway on ${gateway.url}: resource ${config.resource.href}, issuer ${config.issuer}, outlines on ${outlines.machine}${parsed.ws ? ` (default ${parsed.ws})` : ""}` +
    (config.allowedSubjects.length ? `, ${config.allowedSubjects.length} allowed subject(s)` : " [CAPTURE MODE: every token is refused and its subject logged; set EP0CH_MCP_ALLOWED_SUBJECTS]"));
  io.ready?.(gateway);
  const stop = new Promise<void>(resolve => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await Promise.race([stop, ...(io.until ? [io.until] : [])]);
  gateway.stop();
  outlines.close();
  return 0;
}
