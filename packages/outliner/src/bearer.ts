// The one check of a Clerk access token, shared by everything that lets Evan in from a browser or a remote client:
// the MCP gateway (`ep0ch mcp serve --http`, packages/door/src/mcp-gateway.ts) and a published page's sign-in
// (src/publish-page-auth.ts). Clerk is the authorization server; this checks a JWT access token (`typ: at+jwt`) signed
// by a key in the issuer's JWKS, from that issuer, for this resource (`aud`), with a subject on the allowlist (and,
// when set, a client on its list). An empty allowlist lets nobody in (capture mode): every valid token is refused and
// its subject logged, so it can be pinned. There is no anonymous mode and no switch that turns the check off.
import { errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";

/** What a token is checked against. `keys`: the issuer's JWKS (a local set under test). */
export interface BearerPolicy {
  issuer: string;
  /** The resource's public URL, as clients name it and as tokens carry it in `aud` (RFC 8707). */
  resource: string;
  /** Token subjects (Clerk user ids) allowed in. Empty: nobody (capture mode). */
  allowedSubjects: readonly string[];
  /** When set, the OAuth clients (`client_id`) allowed in; otherwise any client a pinned person signed in with. */
  allowedClients?: readonly string[];
  keys: JWTVerifyGetKey;
  /** What the log calls the allowlists: the gateway's are EP0CH_MCP_ALLOWED_SUBJECTS and EP0CH_MCP_ALLOWED_CLIENTS. */
  names?: { label: string; noun: string; subjects: string; clients: string };
}

export type BearerVerdict =
  | { ok: true; sub: string; clientId?: string }
  | { ok: false; status: 401 | 403 | 503; error?: string; description: string; sub?: string };

const GATEWAY_NAMES = { label: "mcp gateway", noun: "this gateway", subjects: "EP0CH_MCP_ALLOWED_SUBJECTS", clients: "EP0CH_MCP_ALLOWED_CLIENTS" };

/** Checks an Authorization header. Every failure is a refusal; nothing falls through to a read. */
export async function verifyBearer(authorization: string | null, policy: BearerPolicy, log: (line: string) => void = console.error): Promise<BearerVerdict> {
  const names = policy.names ?? GATEWAY_NAMES;
  const match = /^Bearer[ ]+([^\s]+)\s*$/i.exec(authorization ?? "");
  if (!match) return { ok: false, status: 401, description: "a Bearer access token is required" };
  const token = match[1]!;
  if (token.startsWith("oat_")) {
    log(`${names.label}: refused an opaque Clerk access token; this verifies JWT access tokens (Clerk: OAuth applications → Settings → JWT access tokens)`);
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
      log(`${names.label}: can't check tokens: the issuer's keys didn't load (${(e as Error).message})`);
      return { ok: false, status: 503, description: "the authorization server's keys are unreachable; try again" };
    }
    log(`${names.label}: token refused: ${(e as Error).message}`);
    return { ok: false, status: 401, error: "invalid_token", description: "the access token is invalid or expired" };
  }
  const audiences = payload.aud === undefined ? [] : [payload.aud].flat();
  // Exactly this resource: `/mcp` and `/mcp/` are different resources.
  if (!audiences.includes(policy.resource)) {
    log(`${names.label}: token refused: aud ${JSON.stringify(payload.aud ?? null)} isn't ${policy.resource} (Clerk: aud_claim_enabled must be on)`);
    return { ok: false, status: 401, error: "invalid_token", description: "the access token is for another resource" };
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const clientId = typeof payload.client_id === "string" ? payload.client_id : undefined;
  const who = `sub=${sub} client_id=${clientId ?? "(none)"}`;
  if (!policy.allowedSubjects.length) {
    log(`${names.label}: capture mode, refusing a valid token: ${who}. To let this person in, set ${names.subjects}=${sub} and restart.`);
    return { ok: false, status: 403, description: `${names.noun} hasn't been told who may use it yet`, sub };
  }
  if (!sub || !policy.allowedSubjects.includes(sub)) {
    log(`${names.label}: refused ${who}: not on ${names.subjects}`);
    return { ok: false, status: 403, description: `this account may not use ${names.noun}`, sub };
  }
  if (policy.allowedClients?.length && !(clientId && policy.allowedClients.includes(clientId))) {
    log(`${names.label}: refused ${who}: client not on ${names.clients}`);
    return { ok: false, status: 403, description: `this client may not use ${names.noun}`, sub };
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
