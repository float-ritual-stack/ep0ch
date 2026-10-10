// Signing in on a published page (PIE-774): Evan's one account, on the Clerk the MCP gateway already uses, so a page
// can take his highlights and comments. Reading needs nothing: a page stays open to anyone with its link. No reader
// accounts, no roles: one allowlist of Clerk subjects, the same check as the gateway's (src/bearer.ts).
//
// The sign-in is OAuth's authorization code flow with PKCE, run by the publisher itself against Clerk (a public OAuth
// application with this page's callback as its redirect URI): the page sends the browser to Clerk, Clerk sends it back
// with a code, the publisher trades the code for an access token and checks it (issuer, `aud` = this page's resource,
// client, subject on the allowlist). The token never reaches the browser; what does is the publisher's own session
// cookie: HttpOnly, Secure on https, SameSite=Strict, signed with a key only the publisher holds, and checked against
// the allowlist again on every write, so taking a subject off the list (and restarting) ends its sessions, and
// replacing the key file ends every session at once.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { issuerFromPublishableKey, verifyBearer } from "./bearer";

/** Where a listener is opened: the origin a browser sees, and the path the publisher is mounted at (`/share`). */
export interface PageSite {
  origin: string;
  basePath: string;
  /** Which listener: each keeps its own session cookie. */
  audience: "tailnet" | "public";
}

export interface PageAuthOptions {
  /** Clerk's Frontend API URL, its OAuth issuer. */
  issuer: string;
  /** The Clerk OAuth application's client id (a public client: PKCE, no secret). */
  clientId: string;
  /** Only for a confidential application. */
  clientSecret?: string;
  /** Clerk user ids allowed to write. Empty: nobody (capture mode: the refusal names the id to add). */
  allowedSubjects: readonly string[];
  /** The key session cookies are signed with. */
  sessionKey: Uint8Array;
  /** How long a session lasts. */
  sessionDays?: number;
  /** The issuer's JWKS (a local set under test). */
  keys?: JWTVerifyGetKey;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

const SESSION_DAYS = 30;
const OAUTH_MAX_AGE = 600;
const ENV_NAMES = { label: "page sign-in", noun: "this page's sign-in", subjects: "OUTLINER_PAGE_ALLOWED_SUBJECTS", clients: "OUTLINER_PAGE_CLIENT_ID" };

const list = (value: string | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

/**
 * The sign-in's settings from the publisher's environment: none (writes are off) without OUTLINER_PAGE_CLIENT_ID, else
 * the issuer (OUTLINER_PAGE_ISSUER, or the one CLERK_PUBLISHABLE_KEY names under `with-secrets clerk`), the allowlist
 * and the session key (a file made once, 0600). A setting that's wrong is an error naming what to set.
 */
export function pageAuthConfig(env: Record<string, string | undefined>, keyFile: string): Omit<PageAuthOptions, "log"> | { error: string } | undefined {
  const clientId = env.OUTLINER_PAGE_CLIENT_ID?.trim();
  if (!clientId) return undefined;
  const issuerText = env.OUTLINER_PAGE_ISSUER?.trim() || (env.CLERK_PUBLISHABLE_KEY ? issuerFromPublishableKey(env.CLERK_PUBLISHABLE_KEY) : undefined);
  if (!issuerText) return { error: "OUTLINER_PAGE_CLIENT_ID is set but there's no issuer: run the publisher under `with-secrets clerk -- …` (CLERK_PUBLISHABLE_KEY), or set OUTLINER_PAGE_ISSUER to Clerk's Frontend API URL" };
  let issuer: URL;
  try { issuer = new URL(issuerText); } catch { return { error: `OUTLINER_PAGE_ISSUER=${issuerText} isn't a URL` }; }
  const loopback = issuer.hostname === "127.0.0.1" || issuer.hostname === "localhost";
  if (issuer.protocol !== "https:" && !loopback) return { error: `the page sign-in's issuer must be https (got ${issuerText})` };
  const secret = env.OUTLINER_PAGE_CLIENT_SECRET?.trim();
  return {
    issuer: issuer.href.replace(/\/+$/, ""),
    clientId,
    ...(secret ? { clientSecret: secret } : {}),
    allowedSubjects: list(env.OUTLINER_PAGE_ALLOWED_SUBJECTS),
    sessionKey: sessionKey(keyFile),
  };
}

/** The session key in `file`, made (32 random bytes, 0600) the first time. */
export function sessionKey(file: string): Uint8Array {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  }
  chmodSync(file, 0o600);
  const key = readFileSync(file);
  if (key.length < 32) throw new Error(`${file} holds a session key shorter than 32 bytes: remove it and restart, and a new one is made`);
  return new Uint8Array(key);
}

interface AuthServer { authorization_endpoint: string; token_endpoint: string }

/** A page that says what happened, with what to do; the publisher's own, so it runs no script. */
export type PageAnswer = { kind: "redirect"; location: string; cookies: string[] } | { kind: "page"; status: number; title: string; html: string; cookies: string[] };

export class PageAuth {
  private readonly keys: JWTVerifyGetKey;
  private readonly fetch: typeof fetch;
  private readonly log: (line: string) => void;
  private server: Promise<AuthServer> | null = null;

  constructor(private readonly o: PageAuthOptions) {
    this.keys = o.keys ?? createRemoteJWKSet(new URL(`${o.issuer}/.well-known/jwks.json`), { timeoutDuration: 5000, cooldownDuration: 30_000 });
    this.fetch = o.fetch ?? fetch;
    this.log = o.log ?? (() => {});
  }

  /** The resource a page's tokens are for (`aud`): where the listener is opened. */
  static resource(site: PageSite): string {
    return `${site.origin}${site.basePath}`;
  }

  private sign(payload: object): string {
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(createHmac("sha256", this.o.sessionKey).update(body).digest())}`;
  }

  private open<T>(value: string | undefined): T | null {
    if (!value) return null;
    const [body, mac] = value.split(".");
    if (!body || !mac) return null;
    const want = createHmac("sha256", this.o.sessionKey).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
  }

  private static secure(site: PageSite): boolean {
    return site.origin.startsWith("https:");
  }

  /** The session cookie's name: `__Host-` on https, so no other host or path can set or read it. */
  static cookieName(site: PageSite): string {
    return `${PageAuth.secure(site) ? "__Host-" : ""}ep0ch-page-${site.audience}`;
  }

  private static oauthCookie(site: PageSite): string {
    return `ep0ch-page-oauth-${site.audience}`;
  }

  private cookie(site: PageSite, name: string, value: string, attributes: string): string {
    return `${name}=${value}; ${attributes}; HttpOnly${PageAuth.secure(site) ? "; Secure" : ""}`;
  }

  /** Who the request's session is, while it's valid and its subject is still on the allowlist. */
  who(request: Request, site: PageSite): { sub: string } | null {
    const session = this.open<{ sub: string; aud: string; exp: number }>(readCookie(request, PageAuth.cookieName(site)));
    if (!session || session.aud !== PageAuth.resource(site) || session.exp < Date.now() / 1000) return null;
    return this.o.allowedSubjects.includes(session.sub) ? { sub: session.sub } : null;
  }

  private authServer(): Promise<AuthServer> {
    this.server ??= (async () => {
      try {
        const response = await this.fetch(`${this.o.issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const meta = await response.json() as Partial<AuthServer>;
          if (meta.authorization_endpoint && meta.token_endpoint) return { authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint };
        }
      } catch { /* Clerk's own paths, below */ }
      this.server = null; // asked again next time
      return { authorization_endpoint: `${this.o.issuer}/oauth/authorize`, token_endpoint: `${this.o.issuer}/oauth/token` };
    })();
    return this.server;
  }

  private callbackUrl(site: PageSite): string {
    return `${site.origin}${site.basePath}/_marginalia/callback`;
  }

  /** Off to Clerk, to come back to `returnTo` (a published page's path here, or the site's root). */
  async signIn(site: PageSite, returnTo: string | null): Promise<PageAnswer> {
    const back = safeReturn(returnTo, site);
    const verifier = b64(randomBytes(32));
    const state = b64(randomBytes(16));
    const challenge = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const { authorization_endpoint } = await this.authServer();
    const url = new URL(authorization_endpoint);
    for (const [key, value] of Object.entries({
      response_type: "code", client_id: this.o.clientId, redirect_uri: this.callbackUrl(site), scope: "profile email",
      state, code_challenge: challenge, code_challenge_method: "S256", resource: PageAuth.resource(site),
    })) url.searchParams.set(key, value);
    const pending = this.sign({ state, verifier, back, aud: PageAuth.resource(site), exp: Math.floor(Date.now() / 1000) + OAUTH_MAX_AGE });
    // Lax: it comes back on Clerk's redirect, a navigation from another site.
    const cookie = this.cookie(site, PageAuth.oauthCookie(site), pending, `Path=${site.basePath}/_marginalia/; Max-Age=${OAUTH_MAX_AGE}; SameSite=Lax`);
    return { kind: "redirect", location: url.href, cookies: [cookie] };
  }

  /** Back from Clerk: the code traded for a token, the token checked, and a session made, or a page saying why not. */
  async callback(request: Request, site: PageSite): Promise<PageAnswer> {
    const url = new URL(request.url);
    const clearOauth = this.cookie(site, PageAuth.oauthCookie(site), "", `Path=${site.basePath}/_marginalia/; Max-Age=0; SameSite=Lax`);
    const refuse = (status: number, title: string, said: string): PageAnswer =>
      ({ kind: "page", status, title, html: said, cookies: [clearOauth] });
    const pending = this.open<{ state: string; verifier: string; back: string; aud: string; exp: number }>(readCookie(request, PageAuth.oauthCookie(site)));
    if (!pending || pending.aud !== PageAuth.resource(site) || pending.exp < Date.now() / 1000 || pending.state !== url.searchParams.get("state")) {
      return refuse(400, "Sign-in expired", `This sign-in didn't start here or took longer than ten minutes. <a href="${escapeAttr(`${site.basePath}/_marginalia/sign-in`)}">Sign in again</a>.`);
    }
    const failure = url.searchParams.get("error");
    if (failure) return refuse(403, "Not signed in", `Clerk said: ${escapeText(url.searchParams.get("error_description") ?? failure)}. <a href="${escapeAttr(pending.back)}">Back to the page</a>.`);
    const code = url.searchParams.get("code");
    if (!code) return refuse(400, "Not signed in", "Clerk sent no code back.");
    const { token_endpoint } = await this.authServer();
    const form = new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: this.callbackUrl(site), client_id: this.o.clientId,
      code_verifier: pending.verifier, resource: PageAuth.resource(site),
      ...(this.o.clientSecret ? { client_secret: this.o.clientSecret } : {}),
    });
    let token: string | undefined;
    try {
      const response = await this.fetch(token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form, signal: AbortSignal.timeout(10_000) });
      const answer = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
      if (!response.ok || !answer.access_token) {
        this.log(`page sign-in: the token exchange was refused (${response.status}): ${answer.error ?? ""} ${answer.error_description ?? ""}`.trim());
        return refuse(502, "Not signed in", `Clerk refused the sign-in (${escapeText(answer.error ?? String(response.status))}). Check that OUTLINER_PAGE_CLIENT_ID names a Clerk OAuth application whose redirect URIs include ${escapeText(this.callbackUrl(site))}.`);
      }
      token = answer.access_token;
    } catch (error) {
      this.log(`page sign-in: the token exchange failed: ${(error as Error).message}`);
      return refuse(502, "Not signed in", "Clerk didn't answer. Try again in a moment.");
    }
    const verdict = await verifyBearer(`Bearer ${token}`, {
      issuer: this.o.issuer, resource: PageAuth.resource(site), allowedSubjects: this.o.allowedSubjects,
      allowedClients: [this.o.clientId], keys: this.keys, names: ENV_NAMES,
    }, this.log);
    if (!verdict.ok) {
      const fix = verdict.sub && !this.o.allowedSubjects.includes(verdict.sub)
        ? ` To let this account write, add it to the publisher's environment and restart the publisher: <code>OUTLINER_PAGE_ALLOWED_SUBJECTS=${escapeText(verdict.sub)}</code>.`
        : "";
      return refuse(verdict.status, "Not signed in", `${escapeText(verdict.description)}.${fix} Reading needs no sign-in: <a href="${escapeAttr(pending.back)}">back to the page</a>.`);
    }
    const days = this.o.sessionDays ?? SESSION_DAYS;
    const session = this.sign({ sub: verdict.sub, aud: PageAuth.resource(site), exp: Math.floor(Date.now() / 1000) + days * 86_400 });
    // Strict: a write's request comes from the page itself, never from another site.
    const cookie = this.cookie(site, PageAuth.cookieName(site), session, `Path=/; Max-Age=${days * 86_400}; SameSite=Strict`);
    this.log(`page sign-in: ${verdict.sub} signed in on ${PageAuth.resource(site)}`);
    return { kind: "redirect", location: pending.back, cookies: [cookie, clearOauth] };
  }

  /** The session cookie cleared. */
  signOut(site: PageSite): string {
    return this.cookie(site, PageAuth.cookieName(site), "", "Path=/; Max-Age=0; SameSite=Strict");
  }
}

/** A path to come back to: a published page on this site (or its base), never another site. */
export function safeReturn(value: string | null, site: PageSite): string {
  const fallback = `${site.basePath}/`;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  let url: URL;
  try { url = new URL(value, site.origin); } catch { return fallback; }
  if (url.origin !== new URL(site.origin).origin || !url.pathname.startsWith(`${site.basePath}/p/`)) return fallback;
  return `${url.pathname}${url.search}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const escapeAttr = escapeText;
