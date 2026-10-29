// The signed-in web client (web-signin.ts, publish-outlines.ts, web-sessions.ts): the tailnet's web client on a public
// origin behind a Clerk sign-in. Clerk is faked here (a local discovery, authorize, token endpoint and JWKS); a scratch
// outline host serves two made-up outlines. Signed out, every route but the sign-in is the sign-in page; signed in, it
// is the tailnet's client, every outline; writes need this origin; sessions are listed, renewed and revoked from the
// page and from `web sessions`/`web revoke`; nothing logs a token, a code or a cookie.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { WEB_SESSION_TTL_MS, type WebSession } from "@ep0ch/outline-core/protocol";
import { issuerFromPublishableKey } from "@ep0ch/outline-core/signin";
import { OutlinerClient } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import { Publisher } from "../src/publish";
import { OutlinePublishers } from "../src/publish-outlines";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { runWebCommand } from "../src/web-cli";
import { WebSessions } from "../src/web-sessions";
import { SESSION_COOKIE, SignInGate, signInSettings, type SignInSettings } from "../src/web-signin";

const ORIGIN = "https://my.example.test";
const TAILNET = "garden.tail0000.ts.net";
const PERSON = "user_fictional0001";
const STRANGER = "user_fictional9999";
const CLIENT_ID = "fictionalWebClient";

let root = "";
let host: OutlineHost;
let homeClient: OutlinerClient;
let publisher: Publisher;
let web: OutlinePublishers;
let clerk: ReturnType<typeof Bun.serve>;
let issuer = "";
let survey: Block;
const logged: string[] = [];
const secrets: string[] = [];

/** The fake Clerk: who the next sign-in is, and what it does wrong (to test the checks). */
const fake: { sub: string; nonce?: "drop" | "wrong"; aud?: string; codes: Map<string, { challenge: string; nonce: string; redirect: string }> } = { sub: PERSON, codes: new Map() };

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-signin-")));
  const layout = outlineLayout(join(root, "outlines"));
  // Two made-up outlines, written before the host opens them.
  const garden = new OutlinerStore(layout.database("garden"), { workspaceRoot: root });
  const hub = garden.create("Field notes [page::Field Notes]\nWhat the garden did this autumn.", null, "user");
  survey = garden.create("Moth survey\nThe night-scented stock drew elephant hawk-moths after dusk.", hub.id, "user");
  garden.close();
  const orchard = new OutlinerStore(layout.database("orchard"), { workspaceRoot: root });
  orchard.create("Pruning plan\nThe old pear first, before the frost.", null, "user");
  orchard.close();
  host = new OutlineHost({ outlinesFolder: layout.root, log: line => logged.push(line) });
  await host.start();
  homeClient = new OutlinerClient(layout.socket, 15_000, "garden");
  publisher = new Publisher({ client: homeClient, basePath: "/pub", log: (line) => logged.push(line) });
  await publisher.start();
  web = new OutlinePublishers({
    home: publisher, homeName: "garden", names: async () => ["garden", "orchard"], log: (line) => logged.push(line),
    open: (name, basePath) => new Publisher({ client: new OutlinerClient(layout.socket, 15_000, name), basePath, webRoot: "/pub", log: (line) => logged.push(line) }),
  });

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "fake-1", alg: "RS256", use: "sig" };
  clerk = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, jwks_uri: `${issuer}/.well-known/jwks.json` });
      }
      if (url.pathname === "/.well-known/jwks.json") return Response.json({ keys: [jwk] });
      if (url.pathname === "/oauth/authorize") {
        // The person signs in at GitHub and Clerk sends the browser back with a code.
        const p = url.searchParams;
        if (p.get("client_id") !== CLIENT_ID || p.get("code_challenge_method") !== "S256" || p.get("response_type") !== "code") return new Response("bad request", { status: 400 });
        const code = crypto.randomUUID();
        secrets.push(code);
        fake.codes.set(code, { challenge: p.get("code_challenge")!, nonce: p.get("nonce")!, redirect: p.get("redirect_uri")! });
        return new Response(null, { status: 302, headers: { location: `${p.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(p.get("state")!)}` } });
      }
      if (url.pathname === "/oauth/token" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        const kept = fake.codes.get(form.get("code") ?? "");
        fake.codes.delete(form.get("code") ?? "");
        const verified = kept && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === kept.challenge && form.get("redirect_uri") === kept.redirect && form.get("client_id") === CLIENT_ID;
        if (!verified) return Response.json({ error: "invalid_grant" }, { status: 400 });
        const nonce = fake.nonce === "drop" ? undefined : fake.nonce === "wrong" ? "another-sign-in" : kept.nonce;
        const idToken = await new SignJWT({ ...(nonce ? { nonce } : {}), name: "Fictional Gardener" })
          .setProtectedHeader({ alg: "RS256", kid: "fake-1" }).setIssuer(issuer).setAudience(fake.aud ?? CLIENT_ID).setSubject(fake.sub)
          .setIssuedAt().setExpirationTime("5m").sign(privateKey);
        secrets.push(idToken);
        return Response.json({ access_token: "fake-access", token_type: "Bearer", id_token: idToken });
      }
      return new Response("not here", { status: 404 });
    },
  });
  issuer = `http://127.0.0.1:${clerk.port}`;
});

afterAll(async () => {
  clerk?.stop(true);
  await web?.stop();
  await publisher?.stop();
  await host?.close();
  rmSync(root, { recursive: true, force: true });
});

function gateFor(settings: Partial<SignInSettings> = {}) {
  return new SignInGate({
    settings: { origin: ORIGIN, issuer, clientId: CLIENT_ID, allowedSubjects: [PERSON], home: "/pub/", ...settings },
    request: (input) => homeClient.request(input as Parameters<typeof homeClient.request>[0]),
    serve: (request, signedIn) => web.handle(request, "tailnet", signedIn),
    readerWrite: request => web.readerWrite(request),
    log: (line) => logged.push(line),
  });
}

const html = { accept: "text/html,application/xhtml+xml" };
const at = (gate: SignInGate, path: string, init: { method?: string; headers?: Record<string, string>; body?: string; cookie?: string; origin?: string } = {}) =>
  gate.handle(new Request(`${init.origin ?? ORIGIN}${path}`, {
    method: init.method ?? "GET", ...(init.body !== undefined ? { body: init.body } : {}),
    headers: { host: new URL(init.origin ?? ORIGIN).host, ...html, "user-agent": "FictionalBrowser/1.0 (Test)", ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  }));
const setCookies = (response: Response) => response.headers.getSetCookie();
const cookieValue = (response: Response, name: string) => setCookies(response).map((c) => c.split(";")[0]!).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

/** The whole browser round trip: start, Clerk's authorize, back to the callback with the pending cookie. */
async function signIn(gate: SignInGate, next = "/pub/", options: { bindCookie?: boolean; origin?: string } = {}): Promise<{ response: Response; cookie?: string }> {
  const origin = options.origin ?? ORIGIN;
  const started = await at(gate, `/signin/start?next=${encodeURIComponent(next)}`, { origin });
  expect(started.status).toBe(303);
  const pending = cookieValue(started, "__Host-ep0ch_signin")!;
  const authorize = new URL(started.headers.get("location")!);
  expect(authorize.origin).toBe(issuer);
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/signin/callback`);
  expect(authorize.searchParams.get("scope")).toBe("openid profile email");
  const back = await fetch(authorize, { redirect: "manual" });
  const callback = new URL(back.headers.get("location")!);
  expect(callback.origin).toBe(origin);
  const response = await at(gate, `${callback.pathname}${callback.search}`, { origin, ...(options.bindCookie === false ? {} : { cookie: `__Host-ep0ch_signin=${pending}` }) });
  const token = cookieValue(response, SESSION_COOKIE);
  if (token) secrets.push(token);
  return { response, ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) };
}

test("signed out, every page is the sign-in page: dark, noindex, no-referrer, nothing from the outline; an API call is 401", async () => {
  const gate = gateFor();
  for (const path of ["/pub/", `/pub/p/${survey.id}`, "/pub/o/orchard/", "/pub/sessions", "/"]) {
    const page = await at(gate, path);
    expect(page.status).toBe(401);
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await page.text();
    expect(body).toContain('<meta name="color-scheme" content="dark">');
    expect(body).toContain("Sign in with GitHub");
    expect(body).not.toContain("Moth survey");
    expect(body).not.toContain("<script");
  }
  // The sign-in link comes back to the page asked for.
  expect(await (await at(gate, `/pub/p/${survey.id}`)).text()).toContain(`/signin/start?next=${encodeURIComponent(`/pub/p/${survey.id}`)}`);
  const api = await at(gate, "/pub/_marginalia/threads?page=x", { headers: { accept: "application/json" } });
  expect(api.status).toBe(401);
  expect(await api.json()).toMatchObject({ ok: false, error: "sign in first" });
  expect(await (await at(gate, "/robots.txt")).text()).toContain("Disallow: /");
  // Another name for this listener is refused before anything else.
  expect((await gate.handle(new Request(`${ORIGIN}/pub/`, { headers: { host: "127.0.0.1:8793" } }))).status).toBe(421);
});

// PIE-813: one listener, two public names (a work network blocks one). Each name is answered as itself: its own Clerk
// redirect, its own cookies, writes only from its own pages; a name not on the list gets nothing.
test("a second origin signs in as itself: its own callback and cookie, its pages; writes only from its own pages; other names refused", async () => {
  const SECOND = "https://my.second.example.test";
  const settings = signInSettings({ EP0CH_WEB_CLIENT_ID: CLIENT_ID, EP0CH_WEB_ISSUER: issuer, EP0CH_MCP_ALLOWED_SUBJECTS: PERSON }, `${ORIGIN}, ${SECOND}`, "/pub/");
  if ("error" in settings) throw new Error(settings.error);
  expect(settings).toMatchObject({ origin: ORIGIN, origins: [ORIGIN, SECOND] });
  const gate = gateFor(settings);
  const { response, cookie } = await signIn(gate, "/pub/o/orchard/", { origin: SECOND });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/pub/o/orchard/");
  expect(setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toContain("; Secure");
  expect(await (await at(gate, "/pub/o/orchard/", { origin: SECOND, cookie })).text()).toContain("Pruning plan");
  // Signed out there, the API's sign-in link is that origin's.
  expect(await (await at(gate, "/pub/_marginalia/threads?page=x", { origin: SECOND, headers: { accept: "application/json" } })).json()).toMatchObject({ signin: `${SECOND}/signin` });
  // A write carries the Origin of the name it was sent to: the other name's pages can't post here.
  const words = { page: survey.id, quote: "dusk", action: "comment", body: "From the second name.", requestId: "second-origin-01" };
  const post = (origin: string) => at(gate, "/pub/_marginalia/write", { origin: SECOND, method: "POST", cookie, body: JSON.stringify(words), headers: { "content-type": "application/json", origin, accept: "application/json" } });
  expect((await post(ORIGIN)).status).toBe(403);
  expect((await post(SECOND)).status).toBe(200);
  // Names it wasn't given: refused before anything else.
  for (const host of ["my.third.example.test", "127.0.0.1:8795"]) expect((await gate.handle(new Request(`${SECOND}/pub/`, { headers: { host } }))).status).toBe(421);
  expect(signInSettings({ EP0CH_WEB_CLIENT_ID: CLIENT_ID, EP0CH_WEB_ISSUER: issuer }, `${ORIGIN},${ORIGIN}/`, "/pub/")).toMatchObject({ error: expect.stringContaining("twice") });
  // Cookies don't tell ports apart: one name on two ports would share a sign-in, so it's refused.
  expect(signInSettings({ EP0CH_WEB_CLIENT_ID: CLIENT_ID, EP0CH_WEB_ISSUER: issuer }, `${ORIGIN},${ORIGIN}:8443`, "/pub/")).toMatchObject({ error: expect.stringContaining("twice") });
  // The https port said outright is the same name.
  expect((await at(gate, "/pub/o/orchard/", { origin: SECOND, cookie, headers: { host: "my.second.example.test:443" } })).status).toBe(200);
  expect(signInSettings({ EP0CH_WEB_CLIENT_ID: CLIENT_ID, EP0CH_WEB_ISSUER: issuer }, `${ORIGIN},http://my.second.example.test`, "/pub/")).toMatchObject({ error: expect.stringContaining("https") });
});

test("a sign-in through Clerk lands on the page asked for, with a 30-day HttpOnly Secure SameSite=Lax cookie; then it is the tailnet's client, every outline", async () => {
  const gate = gateFor();
  const { response, cookie } = await signIn(gate, "/pub/o/orchard/");
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/pub/o/orchard/");
  const set = setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  expect(set).toContain("HttpOnly");
  expect(set).toContain("Secure");
  expect(set).toContain("SameSite=Lax");
  expect(set).toContain("Path=/");
  expect(set).toContain(`Max-Age=${WEB_SESSION_TTL_MS / 1000}`);

  const home = await at(gate, "/pub/", { cookie });
  expect(home.status).toBe(200);
  expect(home.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(await home.text()).toContain("Field notes");
  const note = await at(gate, `/pub/p/${survey.id}`, { cookie });
  expect(note.status).toBe(200);
  expect(await note.text()).toContain("elephant hawk-moths");
  const orchard = await at(gate, "/pub/o/orchard/", { cookie });
  expect(orchard.status).toBe(200);
  expect(await orchard.text()).toContain("Pruning plan");
  const outlines = await (await at(gate, "/pub/o/", { cookie })).text();
  expect(outlines).toContain('href="/pub/o/orchard/"');
  expect(outlines).toContain('href="/pub/"');
  // The old easy links and the bare origin.
  expect((await at(gate, "/", { cookie })).headers.get("location")).toBe("/pub/");
  expect((await at(gate, "/p/field-notes", { cookie })).headers.get("location")).toBe("/pub/p/field-notes");
  // The tailnet keeps answering with no sign-in, the same pages.
  const tailnet = await web.handle(new Request(`https://${TAILNET}/pub/o/orchard/`, { headers: { host: TAILNET, ...html } }));
  expect(tailnet.status).toBe(200);
  // `tailscale serve` mounts /pub and strips it, so the same outlines arrive as /o/…, as note pages arrive as /p/….
  const stripped = await web.handle(new Request(`https://${TAILNET}/o/orchard/`, { headers: { host: TAILNET, ...html } }));
  expect(stripped.status).toBe(200);
  expect(await stripped.text()).toContain("Pruning plan");
  expect((await web.handle(new Request(`https://${TAILNET}/o/`, { headers: { host: TAILNET, ...html } }))).status).toBe(200);
  expect(await tailnet.text()).toContain("Pruning plan");
  // …under its own names only: another Host gets no list of outlines.
  expect((await web.handle(new Request("https://rebound.example/pub/o/", { headers: { host: "rebound.example", ...html } }))).status).toBe(421);
});

test("signed in, it is the owner's reader (PIE-789): search in every outline and completion in the comment box, as on the tailnet", async () => {
  const gate = gateFor();
  const { cookie } = await signIn(gate);
  const found = await (await at(gate, "/pub/search?q=elephant+hawk", { cookie })).text();
  expect(found).toContain(`href="/pub/p/${survey.id}"`);
  expect(found).toContain("<b>elephant</b>");
  const orchard = await (await at(gate, "/pub/o/orchard/search?q=old+pear", { cookie })).text();
  expect(orchard).toContain("Pruning plan");
  expect(orchard).toContain('action="/pub/o/orchard/search"');
  const line = "see [[Field";
  const completed = await (await at(gate, `/pub/_marginalia/complete?${new URLSearchParams({ text: line, at: String(line.length), page: survey.id })}`, { cookie, headers: { accept: "application/json" } })).json() as { items: { insertion: string }[] };
  expect(completed.items[0]!.insertion).toBe("[[Field Notes]]");
  for (const path of ["/pub/", `/pub/p/${survey.id}`, `/pub/p/${survey.id}?view=full`]) expect(await (await at(gate, path, { cookie })).text()).not.toMatch(/not published/i);
});

test("a write needs this origin as well as the session; a comment from the page lands as the person's", async () => {
  const gate = gateFor();
  const { cookie } = await signIn(gate);
  const words = { page: survey.id, quote: "elephant hawk-moths", prefix: "The night-scented stock drew ", suffix: " after dusk.", action: "comment", body: "Count them again.", requestId: "signin-comment-1" };
  const write = (origin?: string) => at(gate, "/pub/_marginalia/write", { method: "POST", cookie, body: JSON.stringify(words), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } });
  expect((await write()).status).toBe(403);
  expect((await write("https://elsewhere.example")).status).toBe(403);
  const landed = await write(ORIGIN);
  expect(landed.status).toBe(200);
  expect(await landed.json()).toMatchObject({ ok: true });
  // Signed out, even this origin's write is refused.
  const anonymous = await at(gate, "/pub/_marginalia/write", { method: "POST", body: JSON.stringify(words), headers: { "content-type": "application/json", origin: ORIGIN, accept: "application/json" } });
  expect(anonymous.status).toBe(401);
});

test("sessions: listed on the page (this browser marked) and by `web sessions`, revoked from either, and Sign out ends this one", async () => {
  const gate = gateFor();
  const first = await signIn(gate);
  const second = await signIn(gate);
  const page = await (await at(gate, "/pub/sessions", { cookie: second.cookie })).text();
  expect(page).toContain("FictionalBrowser/1.0 (Test) <strong>(this browser)</strong>");
  expect(page).toContain("Fictional Gardener");
  expect(page).toContain("Sign out everywhere");
  // The tailnet's sessions page lists the same, with no sign-in.
  expect(await (await web.handle(new Request(`https://${TAILNET}/pub/sessions`, { headers: { host: TAILNET, ...html } }))).text()).toContain("Fictional Gardener");

  const env = { EP0CH_OUTLINES: join(root, "outlines") };
  const out: string[] = [];
  expect(await runWebCommand(["sessions", "--json"], { out: (line) => out.push(line), err: (line) => out.push(line) }, env)).toBe(0);
  const listed = (JSON.parse(out.join("\n")) as { sessions: WebSession[] }).sessions;
  expect(listed.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(listed)).not.toContain(first.cookie!.split("=")[1]!);
  // `web revoke <id>` ends the first browser's session (the one its own page marks): its next request is the sign-in page.
  const own = (cookie: string | undefined) => at(gate, "/pub/sessions", { cookie }).then((r) => r.text()).then((text) => /\(this browser\)<\/strong><div class="dim">([0-9a-f]{8})/.exec(text)?.[1]);
  const firstSessionId = await own(first.cookie);
  expect(listed.map((s) => s.id)).toContain(firstSessionId!);
  expect(await runWebCommand(["revoke", firstSessionId!], { out: () => {}, err: (line) => out.push(line) }, env)).toBe(0);
  expect((await at(gate, "/pub/", { cookie: first.cookie })).status).toBe(401);
  expect((await at(gate, "/pub/", { cookie: second.cookie })).status).toBe(200);
  // Revoke from the page needs this origin; Sign out ends this browser's own session and clears its cookie.
  expect((await at(gate, "/signout", { method: "POST", cookie: second.cookie })).status).toBe(403);
  const out2 = await at(gate, "/signout", { method: "POST", cookie: second.cookie, headers: { origin: ORIGIN } });
  expect(out2.status).toBe(303);
  expect(out2.headers.get("location")).toBe("/signin");
  expect(setCookies(out2).find((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toContain("Max-Age=0");
  expect((await at(gate, "/pub/", { cookie: second.cookie })).status).toBe(401);
  // Sign out everywhere, from the page.
  const third = await signIn(gate);
  await signIn(gate);
  const everywhere = await at(gate, "/pub/sessions/revoke", { method: "POST", cookie: third.cookie, body: "all=1", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" } });
  expect(everywhere.status).toBe(303);
  expect(everywhere.headers.get("location")).toBe("/signin");
  expect((await homeClient.request<{ sessions: WebSession[] }>({ action: "web.sessions.list" })).sessions).toEqual([]);
  // A bad revoke says where the ids are.
  expect(await runWebCommand(["revoke", "nosuchid"], { out: () => {}, err: (line) => out.push(line) }, env)).toBe(1);
  expect(out.join("\n")).toContain("ep0ch web sessions lists them");
});

test("only the people on the shared list get in: anyone else is refused and logged; with nobody listed, everyone, saying what to set", async () => {
  fake.sub = STRANGER;
  try {
    const refused = await signIn(gateFor());
    expect(refused.response.status).toBe(403);
    expect(refused.cookie).toBeUndefined();
    expect(logged.join("\n")).toContain(`web sign-in: refused ${STRANGER} (Fictional Gardener): not on EP0CH_MCP_ALLOWED_SUBJECTS`);
    const capture = await signIn(gateFor({ allowedSubjects: [] }));
    expect(capture.response.status).toBe(403);
    expect(logged.join("\n")).toContain(`set EP0CH_MCP_ALLOWED_SUBJECTS=${STRANGER}`);
  } finally { fake.sub = PERSON; }
  // Taken off the list, a signed-in person's session opens nothing.
  const { cookie } = await signIn(gateFor());
  expect((await at(gateFor(), "/pub/", { cookie })).status).toBe(200);
  expect((await at(gateFor({ allowedSubjects: ["user_other"] }), "/pub/", { cookie })).status).toBe(401);
  // The settings read the one shared list, the MCP gateway's.
  const settings = signInSettings({ EP0CH_WEB_CLIENT_ID: CLIENT_ID, EP0CH_WEB_ISSUER: "https://fictional-otter-12.clerk.accounts.dev", EP0CH_MCP_ALLOWED_SUBJECTS: `${PERSON}, user_other` }, ORIGIN, "/pub/");
  expect(settings).toMatchObject({ origin: ORIGIN, clientId: CLIENT_ID, allowedSubjects: [PERSON, "user_other"] });
  expect(signInSettings({ EP0CH_WEB_ISSUER: issuer }, ORIGIN, "/pub/")).toMatchObject({ error: expect.stringContaining("EP0CH_WEB_CLIENT_ID") });
  expect(signInSettings({ EP0CH_WEB_CLIENT_ID: CLIENT_ID, EP0CH_WEB_ISSUER: issuer }, "http://my.example.test", "/pub/")).toMatchObject({ error: expect.stringContaining("https") });
  const pk = `pk_test_${Buffer.from("fictional-otter-12.clerk.accounts.dev$").toString("base64")}`;
  expect(issuerFromPublishableKey(pk)).toBe("https://fictional-otter-12.clerk.accounts.dev");
});

test("a sign-in that didn't start in this browser, or whose ID token is for another sign-in or client, is refused", async () => {
  const gate = gateFor();
  const unbound = await signIn(gate, "/pub/", { bindCookie: false });
  expect(unbound.response.status).toBe(400);
  expect(unbound.cookie).toBeUndefined();
  for (const nonce of ["wrong", "drop"] as const) {
    fake.nonce = nonce;
    try { expect((await signIn(gate)).response.status).toBe(401); } finally { delete fake.nonce; }
  }
  fake.aud = "someone-elses-client";
  try { expect((await signIn(gate)).response.status).toBe(401); } finally { delete fake.aud; }
  // A state nobody started.
  expect((await at(gate, "/signin/callback?code=x&state=nobody", { cookie: "__Host-ep0ch_signin=whatever" })).status).toBe(400);
  // Coming back to another site is never offered: the next page is a path here.
  const started = await at(gate, `/signin/start?next=${encodeURIComponent("//elsewhere.example/x")}`);
  const authorize = new URL(started.headers.get("location")!);
  const back = new URL((await fetch(authorize, { redirect: "manual" })).headers.get("location")!);
  const landed = await at(gate, `${back.pathname}${back.search}`, { cookie: `__Host-ep0ch_signin=${cookieValue(started, "__Host-ep0ch_signin")}` });
  expect(landed.headers.get("location")).toBe("/pub/");
  secrets.push(cookieValue(landed, SESSION_COOKIE)!);
});

test("a session lasts 30 days from its last use; the host keeps only its digest, in a 0600 file", () => {
  let now = Date.parse("2026-10-11T12:00:00Z");
  const file = join(root, "sessions-unit.json");
  const store = new WebSessions(file, () => now);
  const { token, session } = store.start({ subject: PERSON, device: "FictionalBrowser" });
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf8")).not.toContain(token);
  expect(Date.parse(session.expiresAt) - now).toBe(WEB_SESSION_TTL_MS);
  now += 20 * 24 * 60 * 60_000;
  const used = store.resolve(token)!;
  expect(used.renewed).toBe(true);
  expect(Date.parse(used.session.expiresAt) - now).toBe(WEB_SESSION_TTL_MS);
  // Within the minute, not written again.
  expect(store.resolve(token)!.renewed).toBe(false);
  now += WEB_SESSION_TTL_MS + 1;
  expect(store.resolve(token)).toBeUndefined();
  expect(store.list()).toEqual([]);
});

test("nothing logged holds a token, a code or a cookie", () => {
  const log = logged.join("\n");
  expect(secrets.length).toBeGreaterThan(5);
  for (const secret of secrets) expect(log).not.toContain(secret);
});


test("a signed-in bookmark creates a scoped iframe session on its named outline", async () => {
  const gate = gateFor();
  const { cookie } = await signIn(gate);
  const mint = await at(gate, "/pub/o/orchard/reader/bookmark", { cookie, method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
  expect(mint.status).toBe(200);
  const lease = await mint.json();
  expect(lease.token).toBeUndefined();
  expect(mint.headers.get("set-cookie")).toContain("HttpOnly");
  const session = mint.headers.get("set-cookie")!.split(";")[0]!;
  const popup = await at(gate, "/pub/o/orchard/reader/approve?source=https://journal.example", { cookie });
  const approvalToken = (await popup.text()).match(/name="token" value="([^"]+)"/)![1];
  const approval = { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ source: "https://journal.example", decision: "allow", token: approvalToken }) };
  const other = await signIn(gate);
  expect((await at(gate, "/pub/o/orchard/reader/approve", { ...approval, cookie: other.cookie })).status).toBe(403);
  expect((await at(gate, "/pub/o/orchard/reader/approve", approval)).status).toBe(401);
  expect((await at(gate, "/pub/o/orchard/reader/approve", { ...approval, cookie, headers: { ...approval.headers, origin: "https://journal.example" } })).status).toBe(403);
  expect((await gate.handle(new Request("http://127.0.0.1/pub/o/orchard/reader/approve", {
    ...approval, headers: { ...approval.headers, host: new URL(ORIGIN).host, cookie: cookie! },
  }))).status).toBe(200);
  const minted = await at(gate, "/pub/o/orchard/_reader/lease", { cookie: session, method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ source: "https://journal.example/pears", scope: lease.id }) });
  expect(minted.status).toBe(200);
  const token = (await minted.json()).token;
  const path = "/pub/o/orchard/_reader/write";
  const headers = { origin: ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json" };
  expect((await at(gate, path, { method: "POST", headers: { ...headers, origin: "https://journal.example" }, body: "{}" })).status).toBe(403);
  expect((await at(gate, `/pub/o/orchard/_reader/${token}`, { method: "POST", headers, body: "{}" })).status).toBe(404);
  const saved = await at(gate, path, { method: "POST", headers, body: JSON.stringify({ action: "comment", quote: "The pears are ready", body: "Harvest tomorrow #pie-request", source: "https://journal.example/pears" }) });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ ok: true, said: "Saved to the outline" });
  const orchard = new OutlinerClient(outlineLayout(join(root, "outlines")).socket, 15_000, "orchard");
  const date = new Date();
  const address = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const day = await orchard.request<{ block: Block }>({ action: "pages.resolve", address });
  const captures = await orchard.request<Block[]>({ action: "children", parentId: day.block.id });
  expect(captures.some(b => b.text.includes("Harvest tomorrow #pie-request"))).toBe(true);
  expect((await at(gate, path, { headers })).status).toBe(405);
  expect((await at(gate, "/pub/o/orchard/reader/bookmark", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
});

// The upstream is an isolated Loki, with no live volumes or ports; run `docker pull grafana/loki:3.6.2` first.
test.skipIf(!Bun.which("docker") || Bun.spawnSync(["docker", "image", "inspect", "grafana/loki:3.6.2"], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0)("a CLI lease reads real Loki to a file, refuses writes, is limited, revoked and expires", async () => {
  const { publishLoki } = await import("../src/publish-loki");
  const docker = async (...args: string[]) => {
    const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`docker ${args[0]} exited ${code}: ${err}`);
    return out.trim();
  };
  const container = await docker("run", "--rm", "-d", "--name", `ep0ch-loki-test-${crypto.randomUUID()}`, "-p", "127.0.0.1::3100", "grafana/loki:3.6.2", "-config.file=/etc/loki/local-config.yaml", "-ingester.min-ready-duration=0s");
  let server: ReturnType<typeof Bun.serve> | undefined;
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../door/src/main.ts"), "loki", "lease", ...args], {
      cwd: root, env: { ...process.env, EP0CH_SOCKET: host.socketPath, EP0CH_OUTLINES: join(root, "outlines"), XDG_CONFIG_HOME: join(root, "config") }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, err).toBe(0);
    return out.trim();
  };
  try {
    const upstream = `http://${await docker("port", container, "3100/tcp")}`;
    const deadline = Date.now() + 30_000;
    while (true) {
      try { if ((await fetch(`${upstream}/ready`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`scratch Loki never became ready: ${await docker("logs", container)}`);
      await Bun.sleep(100);
    }
    const timestamp = `${Date.now()}000000`;
    expect((await fetch(`${upstream}/loki/api/v1/push`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ streams: [{ stream: { service_name: "claude-code", event_name: "user_prompt" }, values: [[timestamp, "Fictional lantern survey"]] }] }) })).status).toBe(204);
    const gate = new SignInGate({
      settings: { origin: ORIGIN, issuer, clientId: CLIENT_ID, allowedSubjects: [PERSON], home: "/pub/" },
      request: input => homeClient.request(input as Parameters<typeof homeClient.request>[0]),
      serve: (request, signedIn) => web.handle(request, "tailnet", signedIn),
      loki: request => publishLoki(request, homeClient, upstream, line => logged.push(line)),
      log: line => logged.push(line),
    });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => gate.handle(request) });
    const lease = await cli("--ttl", "1m");
    const path = new URL(lease).pathname;
    const get = (suffix: string, method = "GET") => fetch(`http://127.0.0.1:${server!.port}${path}${suffix}`, { method, headers: { host: new URL(ORIGIN).host }, redirect: "manual" });
    const query = new URLSearchParams({ query: '{service_name="claude-code"}', start: `${Date.now() - 60_000}000000`, end: `${Date.now() + 1000}000000` });
    const output = join(root, "loki-results.json");
    const curl = Bun.spawn(["curl", "--fail", "--silent", "--show-error", "-H", `Host: ${new URL(ORIGIN).host}`, `http://127.0.0.1:${server.port}${path}/loki/api/v1/query_range?${query}`, "--output", output], { stderr: "pipe" });
    const error = await new Response(curl.stderr).text();
    expect(await curl.exited, error).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("Fictional lantern survey");
    const calendar = await get(`loki/api/v1/query?${new URLSearchParams({ query: 'sum by (event_name) (count_over_time({service_name="claude-code"}[1d]))' })}`);
    expect(calendar.status).toBe(200);
    expect((await calendar.json()).data.result[0].value[1]).toBe("1");
    for (const suffix of ["labels", "label/service_name/values", `series?${new URLSearchParams({ "match[]": '{service_name="claude-code"}' })}`]) {
      const response = await get(`loki/api/v1/${suffix}`);
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("success");
    }
    for (const [method, suffix] of [["POST", "push"], ["DELETE", "delete"], ["GET", "delete"], ["GET", "tail"], ["GET", "status/buildinfo"], ["POST", "query_range"]]) {
      const response = await get(`loki/api/v1/${suffix}`, method);
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("only Loki read queries");
    }
    for (let i = 5; i < 60; i++) { const response = await get("loki/api/v1/labels"); expect(response.status).toBe(200); await response.text(); }
    const limited = await get("loki/api/v1/labels");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    await limited.text();
    expect(logged.join("\n")).not.toContain(path.split("/")[2]!);
    await cli("--revoke");
    expect((await get("loki/api/v1/labels")).status).toBe(410);
    const expiring = await cli("--ttl", "1m");
    await Bun.sleep(60_100);
    const expired = await fetch(`http://127.0.0.1:${server.port}${new URL(expiring).pathname}loki/api/v1/labels`, { headers: { host: new URL(ORIGIN).host } });
    expect(expired.status).toBe(410);
    expect(expired.headers.get("cache-control")).toBe("no-store");
  } finally {
    server?.stop(true);
    await docker("rm", "-f", container);
  }
}, 120_000);

test("signed in on the phone, a page's steps are its owner's: each box is a button, and a tap lands as the person's (PIE-1235)", async () => {
  const gate = gateFor();
  const { cookie } = await signIn(gate);
  const plan = (await homeClient.request<Block>({ action: "create", parentId: survey.id, text: "Lantern plan\n- [ ] hang the lantern\n- [ ] trim the wick", mutation: { author: "user" } } as never));
  const page = await (await at(gate, `/pub/p/${plan.id}`, { cookie })).text();
  const boxes = [...page.matchAll(/<button type="button" class="step s-todo"[^>]*data-step-start="(\d+)"[^>]*data-step-evidence="([0-9a-f]+)"/g)];
  expect(boxes).toHaveLength(2);
  const [, start, evidence] = boxes[0]!;
  const tap = await at(gate, "/pub/_marginalia/write", { method: "POST", cookie, body: JSON.stringify({ page: plan.id, action: "step", status: "done", block: plan.id, start: Number(start), revision: plan.revision, evidence }), headers: { "content-type": "application/json", origin: ORIGIN } });
  expect(await tap.json()).toMatchObject({ ok: true, status: "done" });
  const after = await homeClient.request<Block>({ action: "get", blockId: plan.id });
  expect(after.text).toContain("- [x] hang the lantern");
  expect(after.author).toBe("user");
});

