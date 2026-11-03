// PIE-1550: `ep0ch install --apply` on the laptop said "no session runs for float-hub" when its sessions had come over
// to the new code: install read the session while its daemon was between the old pid and the new one. A read in
// between waits for the session to serve again; one that never comes back still says so, with the command that fixes
// it. The session here is a fake daemon on a scratch folder's socket that answers `query`, made up.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upgradeSession } from "../src/session/client";
import { codeVersion } from "../src/session/code-version";
import { sessionSocket } from "../src/session/place";
import { ptyHostSocket } from "../src/session/pty-host";
import { encode, Frames, type ClientMsg, type SessionInfo } from "../src/session/protocol";

const root = mkdtempSync(join(tmpdir(), "ep0ch-upw-"));
const servers: Server[] = [];
afterAll(() => { for (const s of servers) s.close(); rmSync(root, { recursive: true, force: true }); });

/** A daemon that answers `query` with its info, as a successor does once it serves. */
function serve(dir: string, commit: string | null): Server {
  const info = { pid: 4242, started: 0, proto: 1, code: { dir: codeVersion().dir, commit }, state: dir, socket: sessionSocket(dir), control: null, place: { outline: "orchard" }, dir, outline: { host: "", workspace: "orchard", socket: "" }, screen: null, clients: [], terminals: [] } as unknown as SessionInfo;
  const server = createServer(sock => {
    const f = new Frames<ClientMsg>();
    sock.on("data", (d: Buffer) => { for (const m of f.push(d)) if (m.t === "query") sock.write(encode({ t: "info", info })); });
    sock.on("error", () => {});
  });
  server.listen(sessionSocket(dir));
  servers.push(server);
  return server;
}

test("a session between its old daemon and its new one on this code: install waits for it, and it's handed over", async () => {
  const dir = mkdtempSync(join(root, "orchard-"));
  // Nothing serves when install reads, but its terminal host still runs; the successor serves a moment later, on the
  // code install brought.
  const host = createServer(() => {}); host.listen(ptyHostSocket(dir)); servers.push(host);
  setTimeout(() => serve(dir, codeVersion().commit), 400);
  const r = await upgradeSession({ outline: "orchard", dir }, { handoff: true, wait: 5000 });
  expect(r.ok).toBe(true);
  expect(r.message).not.toContain("no session runs");
  expect(r.message).toContain("pid 4242");
});

test("with nothing running there at all, it says so at once, with the command that starts one", async () => {
  const dir = mkdtempSync(join(root, "orchard-"));
  const t = Date.now(), r = await upgradeSession({ outline: "orchard", dir }, { handoff: true });
  expect(Date.now() - t).toBeLessThan(2000);
  expect(r).toMatchObject({ ok: false, message: expect.stringContaining("no session runs for orchard") });
});

test("a session that never comes back still says no session runs, with the command that starts one", async () => {
  const dir = mkdtempSync(join(root, "orchard-"));
  const host = createServer(() => {}); host.listen(ptyHostSocket(dir)); servers.push(host);
  const r = await upgradeSession({ outline: "orchard", dir }, { handoff: true, wait: 300 });
  expect(r.ok).toBe(false);
  expect(r.message).toContain("no session runs for orchard");
  expect(r.message).toContain("starts one");
});

// Codex on #1262: `upgradeAll` listed only the sessions that answered, so one between daemons whose successor never
// came up was skipped and install said installed. A session install planned to hand over, or one whose terminal host
// still runs, is checked whether it answers the listing or not.
test("upgradeAll counts a planned session missing from the listing, and one whose terminal host runs alone", async () => {
  const state = mkdtempSync(join(root, "state-")), was = process.env.EP0CH_STATE;
  process.env.EP0CH_STATE = state;
  try {
    const { upgradeAll } = await import("../src/session/client");
    const { recordPlace } = await import("../src/session/place");
    const { mkdirSync } = await import("node:fs");
    // orchard: its terminal host runs, no daemon answers, and none comes back. quince: planned, and nothing runs at all.
    const orchard = join(state, "sessions", "local", "orchard"), quince = join(state, "sessions", "local", "quince");
    for (const dir of [orchard, quince]) mkdirSync(dir, { recursive: true });
    recordPlace({ outline: "orchard", dir: orchard });
    const host = createServer(() => {}); host.listen(ptyHostSocket(orchard)); servers.push(host);
    const rs = await upgradeAll({ handoff: true, wait: 300, expected: [{ outline: "quince", dir: quince }] });
    expect(rs.map(r => r.ok)).toEqual([false, false]);
    expect(rs.map(r => r.message).join("\n")).toContain("no session runs for orchard");
    expect(rs.map(r => r.message).join("\n")).toContain("no session runs for quince");
  } finally { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; }
});
