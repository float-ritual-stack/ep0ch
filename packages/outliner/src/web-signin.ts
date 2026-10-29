// The signed-in web client (`publish serve --signin-port`, https://my.ep0ch.sh): the tailnet's web client, whole, on a
// public origin behind a sign-in. It is a gate in front of the same publishers (publish-outlines.ts), never a second
// client: every route needs a web session except the sign-in itself, and a request with one is answered exactly as the
// tailnet answers it.
//
// Sign-in is OpenID Connect against Clerk, the authorization server the MCP gateway already uses: the authorization
// code flow with PKCE (S256), `state` bound to this browser by a short cookie, and a `nonce`, for a public client
// (EP0CH_WEB_CLIENT_ID; no client secret). The ID token is checked against the issuer's JWKS (issuer, audience, expiry,
// nonce), and its subject must be on the one shared list of people allowed in (outline-core's signin.ts, the same
// setting the MCP gateway reads). Then the outline host starts a web session (web-sessions.ts) and the browser gets its
// token as an HttpOnly, Secure, SameSite=Lax cookie for 30 days, set again as it is used.
//
// Writes need the session and an Origin naming this origin (CSRF: SameSite=Lax keeps the cookie off cross-site posts,
// and the Origin check refuses any that get here). Nothing logs a token, a code or a cookie; every answer says
// noindex and no-referrer.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { WEB_SESSION_TTL_MS, type WebSession } from "@ep0ch/outline-core/protocol";
import { allowedSubjects, ALLOWED_SUBJECTS_ENV, issuerFromPublishableKey, originOfHost } from "@ep0ch/outline-core/signin";
import { escapeHtml, plainPage, redactSharePath, type SignedIn } from "./publish";
import { hostBusy } from "./client";

export const SESSION_COOKIE = "__Host-ep0ch_session";
const PENDING_COOKIE = "__Host-ep0ch_signin";
/** How long a sign-in may take between leaving for Clerk and coming back. */
const PENDING_MS = 10 * 60_000;
const CALLBACK = "/signin/callback";

export interface SignInSettings {
  /** This listener's public origin (`https://my.ep0ch.sh`): the Host it answers, the Origin writes carry, the redirect. */
  origin: string;
  /**
   * Every public origin it answers (PIE-813), `origin` first: a request is served as the origin its Host names (its
   * OAuth redirect, its cookies, the Origin its writes carry), and a host not here is refused.
   */
  origins?: readonly string[];
  /** Clerk's Frontend API URL, its OIDC issuer. */
  issuer: string;
  /** The OAuth application's client id (a public client: PKCE, no secret). */
  clientId: string;
  /** The Clerk user ids allowed in; empty, nobody (each refusal logs who it was, to pin). */
  allowedSubjects: readonly string[];
  /** Where a browser lands after signing in when it asked for nothing else (`/pub/`). */
  home: string;
}

const loopback = (url: URL) => url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";


/** The origins in `--signin-url` / EP0CH_WEB_URL: one, or several comma-separated (PIE-813). */
export const signInOrigins = (value: string) => value.split(",").map((origin) => origin.trim()).filter(Boolean);

/** The settings from the environment and the flags, or what's missing, said with what to set. */
export function signInSettings(env: Record<string, string | undefined>, originList: string, home: string): SignInSettings | { error: string } {
  const origins: string[] = [];
  for (const origin of signInOrigins(originList)) {
    let url: URL;
    try { url = new URL(origin); } catch { return { error: `--signin-url ${origin} isn't a URL (e.g. --signin-url https://my.ep0ch.sh, or several comma-separated)` }; }
    if (url.protocol !== "https:" && !loopback(url)) return { error: `--signin-url must be https (got ${origin})` };
    if (url.pathname !== "/" || url.search || url.hash) return { error: `--signin-url is an origin, with no path (e.g. https://my.ep0ch.sh; got ${origin})` };
    // Cookies are kept by host name, whatever the port: two origins on one name would share a sign-in.
    if (origins.some((known) => new URL(known).hostname === url.hostname)) return { error: `--signin-url names ${url.hostname} twice (cookies don't tell ports apart)` };
    origins.push(url.origin);
  }
  if (!origins.length) return { error: "--signin-url (or EP0CH_WEB_URL) names no origin (e.g. https://my.ep0ch.sh)" };
  const issuerText = env.EP0CH_WEB_ISSUER?.trim() || (env.CLERK_PUBLISHABLE_KEY ? issuerFromPublishableKey(env.CLERK_PUBLISHABLE_KEY) : undefined);
  if (!issuerText) return { error: "no issuer: set EP0CH_WEB_ISSUER to Clerk's Frontend API URL (the MCP gateway's issuer), or run under `with-secrets clerk -- …` (CLERK_PUBLISHABLE_KEY)" };
  let issuer: URL;
  try { issuer = new URL(issuerText); } catch { return { error: `the issuer ${issuerText} isn't a URL` }; }
  if (issuer.protocol !== "https:" && !loopback(issuer)) return { error: `the issuer must be https (got ${issuerText})` };
  const clientId = env.EP0CH_WEB_CLIENT_ID?.trim();
  if (!clientId) return { error: "EP0CH_WEB_CLIENT_ID is unset: the Clerk OAuth application's client id for the web client (Clerk → OAuth applications → ep0ch-web)" };
  return { origin: origins[0]!, origins, issuer: issuer.href.replace(/\/+$/, ""), clientId, allowedSubjects: allowedSubjects(env), home };
}

interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
/**
 * A sign-in on its way, kept in the browser that started it (an HttpOnly `__Host-` cookie no other site can set or
 * read), not here: nothing a stranger asks for can crowd out the owner's sign-in. `state` must come back from Clerk.
 */
interface Pending { state: string; verifier: string; nonce: string; next: string; at: number }

function readPending(value: string | undefined): Pending | undefined {
  if (!value || value.length > 4096) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Pending>;
    const strings = [parsed.state, parsed.verifier, parsed.nonce, parsed.next].every((v) => typeof v === "string" && v.length > 0);
    return strings && typeof parsed.at === "number" ? parsed as Pending : undefined;
  } catch { return undefined; }
}

export interface SignInGateOptions {
  settings: SignInSettings;
  /** The outline host's `web.sessions.*` (any client of the host: they are host actions). */
  request: <T>(input: Record<string, unknown> & { action: string }) => Promise<T>;
  /** The web client, answering a request the gate let through. */
  serve: (request: Request, signedIn: SignedIn) => Promise<Response>;
  loki?: (request: Request) => Promise<Response>;
  /** The artifacts inbox's upload route (publish-upload.ts): its token is its credential, so it's answered before the sign-in. */
  upload?: (request: Request) => Promise<Response>;
  snapshot?: (request: Request) => Promise<Response>;
  /** A device's signed "Send to ep0ch" Shortcut (PIE-1408), by the device's id: it holds the device's token, so only signed in. */
  shortcut?: (deviceId: string) => Promise<Response>;
  readerWrite?: (request: Request) => Promise<Response>;
  /** The issuer's keys (a local set under test); else its JWKS, from discovery. */
  keys?: JWTVerifyGetKey;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

const sha = (text: string) => createHash("sha256").update(text).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));
const random = () => randomBytes(32).toString("base64url");

const GATE_HEADERS = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function withGateHeaders(response: Response, cookies: string[] = []): Response {
  // A response from elsewhere may be immutable: copy it.
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(GATE_HEADERS)) if (name !== "cache-control" || !headers.has(name)) headers.set(name, value);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const redirect = (location: string, cookies: string[] = []) => withGateHeaders(new Response(null, { status: 303, headers: { location } }), cookies);

function cookiesOf(request: Request): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

/** A path on this origin to come back to: absolute, never another host (`//evil`, `/\evil`). */
function safeNext(value: string | null, home: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f]/.test(value)) return home;
  if (value.startsWith("/signin") || value.startsWith("/signout")) return home;
  return value.slice(0, 2048);
}

export class SignInGate {
  private readonly settings: SignInSettings;
  private discovery: Promise<Discovery> | null = null;
  private keys: JWTVerifyGetKey | undefined;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** Each origin it answers, by its host. */
  private readonly origins: Map<string, string>;

  constructor(private readonly options: SignInGateOptions) {
    this.settings = options.settings;
    this.keys = options.keys;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.origins = new Map((this.settings.origins ?? [this.settings.origin]).map((origin) => [new URL(origin).host.toLowerCase(), origin]));
  }

  /** A cookie for `origin` (each origin has its own: a session made on one isn't the other's). */
  private cookie(origin: string, name: string, value: string, maxAgeSeconds: number): string {
    // `__Host-`: Secure, Path=/, no Domain. A loopback origin under test is http, where browsers drop Secure cookies.
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${origin.startsWith("https:") ? "; Secure" : ""}`;
  }

  async handle(request: Request): Promise<Response> {
    // Only its own origins' names: a page that rebinds its own name to this listener gets nothing.
    const origin = originOfHost(this.origins, request.headers.get("host"));
    if (!origin) return withGateHeaders(new Response("Host not allowed\n", { status: 421 }));
    const url = new URL(request.url);
    const path = url.pathname;
    if (this.options.readerWrite && /\/_reader\/[A-Za-z0-9_-]+$/.test(path)) return this.options.readerWrite(request);
    const reading = request.method === "GET" || request.method === "HEAD";
    try {
      if (path.startsWith("/loki/") && this.options.loki) return withGateHeaders(await this.options.loki(request));
      if (path.startsWith("/_upload/") && this.options.upload) return withGateHeaders(await this.options.upload(request));
      // A write comes from a page of the origin it was sent to (CSRF), signed in or not.
      if (!reading && request.headers.get("origin") !== origin) {
        return withGateHeaders(new Response("A change comes from this site's own pages\n", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } }));
      }

      if (path === "/robots.txt") return withGateHeaders(new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }));
      if (path === "/signin" && reading) return this.signInPage(url.searchParams.get("next"));
      if (path === "/signin/start" && reading) return await this.start(origin, url.searchParams.get("next"));
      if (path === CALLBACK && reading) return await this.callback(origin, request, url);
      const snapshotPath = path.startsWith(this.settings.home) ? path.slice(this.settings.home.replace(/\/+$/, "").length) : "";
      if (/^(?:\/o\/[^/]+)?\/s\/[A-Za-z0-9_-]+\/snapshot\.sqlite$/.test(snapshotPath) && this.options.snapshot) return withGateHeaders(await this.options.snapshot(request));
      const token = cookiesOf(request).get(SESSION_COOKIE);
      const resolved = token ? (await this.options.request<{ found: { session: WebSession; renewed: boolean } | null }>({ action: "web.sessions.resolve", token })).found : null;
      // Taken off the list, a person's sessions open nothing from the next request (a restart reads the list again).
      const found = resolved && this.settings.allowedSubjects.includes(resolved.session.subject) ? resolved : null;
      if (path === "/signout") {
        if (request.method !== "POST") return withGateHeaders(new Response("Sign out with POST (the Sign out button)\n", { status: 405, headers: { allow: "POST" } }));
        if (found) await this.options.request({ action: "web.sessions.revoke", sessionId: found.session.id });
        return redirect("/signin", [this.cookie(origin, SESSION_COOKIE, "", 0)]);
      }
      if (!found) {
        const wantsPage = reading && (request.headers.get("accept") ?? "").includes("text/html");
        const cleared = token ? [this.cookie(origin, SESSION_COOKIE, "", 0)] : [];
        if (wantsPage) return withGateHeaders(this.signInPage(`${path}${url.search}`, 401), cleared);
        return withGateHeaders(new Response(`${JSON.stringify({ ok: false, error: "sign in first", signin: `${origin}/signin` })}\n`, { status: 401, headers: { "content-type": "application/json; charset=utf-8" } }), cleared);
      }
      const renewed = found.renewed && token ? [this.cookie(origin, SESSION_COOKIE, token, Math.floor(WEB_SESSION_TTL_MS / 1000))] : [];
      // The old easy links (my.ep0ch.sh/p/<slug> went to the tailnet's /pub/p/<slug>) and the bare origin.
      const root = this.settings.home.replace(/\/+$/, "");
      if (path === "/" || path === "") return redirect(this.settings.home, renewed);
      if (root && path.startsWith("/p/")) return redirect(`${root}${path}${url.search}`, renewed);
      const shortcut = /^\/_shortcut\/([0-9a-f]{8})(?:\/[^/]*)?$/.exec(path);
      if (shortcut && reading && this.options.shortcut) return withGateHeaders(await this.options.shortcut(shortcut[1]!), renewed);
      const sessionId = found.session.id;
      return withGateHeaders(await this.options.serve(request, { sessionId, origin, stillSignedIn: () => this.stillSignedIn(sessionId) }), renewed);
    } catch (error) {
      this.log(redactSharePath(`web sign-in: ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`));
      // A busy host (a request it didn't answer in time, PIE-1047) is said as busy: it is running, and the page comes back.
      if (hostBusy(error)) return withGateHeaders(plainPage("Busy", `<h1>The outline host is busy</h1>\n<p class="dim">Try again in a moment: this page will load once it has answered. If it stays busy, on the server: <code>journalctl --user -u outliner-host | grep slow_request | tail</code> names what it was computing.</p>\n`, 503));
      return withGateHeaders(plainPage("Not reachable", `<h1>The outline host could not be reached</h1>\n<p class="dim">Try again in a moment. On the server: <code>systemctl --user status outliner-host outliner-publish</code></p>\n`, 502));
    }
  }

  /**
   * Whether a session the gate let a request through on is still live: listed (not signed out or revoked), not expired,
   * its person still on the list. Asked by an answer that outlasts its request (the door's stream); it doesn't renew it.
   */
  private async stillSignedIn(sessionId: string): Promise<boolean> {
    const { sessions } = await this.options.request<{ sessions: WebSession[] }>({ action: "web.sessions.list" });
    const session = sessions.find((s) => s.id === sessionId);
    return !!session && Date.parse(session.expiresAt) > this.now() && this.settings.allowedSubjects.includes(session.subject);
  }

  private signInPage(next: string | null, status = 200): Response {
    const href = `/signin/start?next=${encodeURIComponent(safeNext(next, this.settings.home))}`;
    return withGateHeaders(plainPage("Sign in", `<h1>ep0ch</h1>\n<p>Sign in to read and write your outlines.</p>\n<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:.6em 1.2em;border:1px solid currentColor;border-radius:6px;text-decoration:none">Sign in with GitHub</a></p>\n<p class="dim">Through Clerk. Only the outlines' owner is let in.</p>\n`, status));
  }

  private discover(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const response = await this.fetch(`${this.settings.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`the issuer's discovery answered ${response.status}`);
      const found = await response.json() as Partial<Discovery>;
      if (!found.authorization_endpoint || !found.token_endpoint || !found.jwks_uri) throw new Error("the issuer's discovery names no authorization, token or JWKS endpoint");
      return found as Discovery;
    })();
    this.discovery.catch(() => { this.discovery = null; });
    return this.discovery;
  }

  /** Off to Clerk: a fresh state, verifier and nonce, kept in this browser by a short cookie. */
  private async start(origin: string, next: string | null): Promise<Response> {
    const { authorization_endpoint } = await this.discover();
    const pending: Pending = { state: random(), verifier: random(), nonce: random(), next: safeNext(next, this.settings.home), at: this.now() };
    const { state, verifier, nonce } = pending;
    const target = new URL(authorization_endpoint);
    target.search = new URLSearchParams({
      response_type: "code", client_id: this.settings.clientId, redirect_uri: `${origin}${CALLBACK}`,
      scope: "openid profile email", state, nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    }).toString();
    return redirect(target.href, [this.cookie(origin, PENDING_COOKIE, Buffer.from(JSON.stringify(pending)).toString("base64url"), PENDING_MS / 1000)]);
  }

  /** Back from Clerk: the code exchanged (with the verifier), the ID token checked, the person checked, a session made. */
  private async callback(origin: string, request: Request, url: URL): Promise<Response> {
    const clear = this.cookie(origin, PENDING_COOKIE, "", 0);
    const refused = (status: number, said: string) => withGateHeaders(plainPage("Not signed in", `<h1>Not signed in</h1>\n<p>${escapeHtml(said)}</p>\n<p><a href="/signin">Try again</a></p>\n`, status), [clear]);
    const state = url.searchParams.get("state") ?? "";
    const pending = readPending(cookiesOf(request).get(PENDING_COOKIE));
    if (!pending || !state || !same(state, pending.state) || this.now() - pending.at > PENDING_MS || this.now() < pending.at) {
      return refused(400, "This sign-in didn't start in this browser, or took longer than ten minutes.");
    }
    const failed = url.searchParams.get("error");
    if (failed) {
      this.log(`web sign-in: Clerk answered ${failed.slice(0, 80)}`);
      return refused(400, `Clerk said: ${(url.searchParams.get("error_description") ?? failed).slice(0, 200)}`);
    }
    const code = url.searchParams.get("code");
    if (!code) return refused(400, "Clerk sent no code back.");
    const { token_endpoint, jwks_uri } = await this.discover();
    const answered = await this.fetch(token_endpoint, {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${origin}${CALLBACK}`, client_id: this.settings.clientId, code_verifier: pending.verifier }),
    });
    if (!answered.ok) {
      this.log(`web sign-in: the token endpoint answered ${answered.status}`);
      return refused(502, "Clerk didn't accept the sign-in; try again.");
    }
    const tokens = await answered.json() as { id_token?: string };
    if (typeof tokens.id_token !== "string") {
      this.log("web sign-in: the token endpoint gave no ID token (the OAuth application needs the openid scope)");
      return refused(502, "Clerk gave no ID token back.");
    }
    this.keys ??= createRemoteJWKSet(new URL(jwks_uri));
    let claims: Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, this.keys, { issuer: this.settings.issuer, audience: this.settings.clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"], clockTolerance: 30 }));
    } catch (error) {
      this.log(`web sign-in: ID token refused: ${error instanceof Error ? error.message : String(error)}`);
      return refused(401, "Clerk's answer didn't check out; try again.");
    }
    if (typeof claims.nonce !== "string" || !same(claims.nonce, pending.nonce)) {
      this.log("web sign-in: ID token refused: its nonce isn't this sign-in's");
      return refused(401, "Clerk's answer was for another sign-in; try again.");
    }
    const subject = String(claims.sub);
    const name = [claims.name, claims.preferred_username, claims.email].find((value): value is string => typeof value === "string" && !!value);
    if (!this.settings.allowedSubjects.length) {
      this.log(`web sign-in: capture mode, refusing ${subject}${name ? ` (${name})` : ""}. To let this person in, set ${ALLOWED_SUBJECTS_ENV}=${subject} (shared with the MCP gateway) and restart.`);
      return refused(403, "This site hasn't been told who may sign in yet.");
    }
    if (!this.settings.allowedSubjects.includes(subject)) {
      this.log(`web sign-in: refused ${subject}${name ? ` (${name})` : ""}: not on ${ALLOWED_SUBJECTS_ENV}`);
      return refused(403, "This account may not sign in here.");
    }
    const { token, session } = await this.options.request<{ token: string; session: WebSession }>({
      action: "web.sessions.start", subject, ...(name ? { name } : {}), device: request.headers.get("user-agent") ?? "",
    });
    this.log(`web sign-in: ${name ?? subject} signed in (session ${session.id})`);
    return redirect(pending.next, [clear, this.cookie(origin, SESSION_COOKIE, token, Math.floor(WEB_SESSION_TTL_MS / 1000))]);
  }
}
