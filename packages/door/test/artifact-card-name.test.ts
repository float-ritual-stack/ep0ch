// PIE-1588: a repo whose name isn't attached reads as a missing name on its card: live at the address the app answers
// at, with what the name still needs and the command. On a scratch host, through the door's own drawing (ep0ch show).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const scratch = new Scratch();
beforeAll(async () => { await scratch.start(); });
afterAll(() => scratch.dispose());

const show = async (id: string) => {
  const p = Bun.spawn(["bun", MAIN, "show", id, "--width", "44"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", EP0CH_MACHINE: "" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  expect(err).toBe(""); expect(code).toBe(0);
  return out.replace(/\x1b\[[0-9;]*m/g, "");
};
const record = (wanted?: { name: string; said: string }) => {
  mkdirSync(join(scratch.outlines, ".artifacts"), { recursive: true });
  writeFileSync(join(scratch.outlines, ".artifacts", "deployments.json"), JSON.stringify([{ name: "moth-garden", repo: "ep0ch-artifacts/moth-garden", where: "vercel", url: wanted ? "https://moth-garden.vercel.app" : "https://moth-garden.ep0ch.sh", commit: "abc1234", deployedAt: "2026-10-01T00:00:00.000Z", reason: "package.json has a build script", ...(wanted ? { wanted } : {}) }]));
};

test("the card says the address the app answers at and the name it's missing; attached, it says the name alone", async () => {
  const board = new SocketBoard(scratch.sock);
  // No deployment account here: the artifact-deploy kit isn't installed, so the repo line never clones (as in the showcase).
  const note = await board.createBlock(null, "Moth garden\n\n[artifact::ep0ch-artifacts/moth-garden]");
  record({ name: "moth-garden.ep0ch.sh", said: 'Vercel wants this DNS record: _vercel.ep0ch.sh. 300 IN TXT "vc-domain-verify=moth-garden.ep0ch.sh,tok3n" and moth-garden.ep0ch.sh. 300 IN CNAME cname.vercel-dns.com. No hetzner-dns secrets group: run with-secrets --add hetzner-dns HCLOUD_TOKEN to store a token with DNS rights, or add it by hand, then run the command again.' });
  const missing = await show(note.id);
  // Evan's reading width: the card wraps, and the records are there whole, whatever the wrap did to them.
  const flat = missing.replace(/[\s│]/g, "");
  expect(flat).toContain("●liveathttps://moth-garden.vercel.app");
  expect(flat).toContain("○moth-garden.ep0ch.shisn'tattached");
  expect(flat).toContain(`VercelwantsthisDNSrecord:_vercel.ep0ch.sh.300INTXT"vc-domain-verify=moth-garden.ep0ch.sh,tok3n"andmoth-garden.ep0ch.sh.300INCNAMEcname.vercel-dns.com.`);
  expect(flat).toContain("run:ep0chartifactdeployep0ch-artifacts/moth-garden");
  expect(missing).not.toContain("deploy failed");
  record();
  const attached = await show(note.id);
  expect(attached.replace(/[\s│]/g, "")).toContain("●liveathttps://moth-garden.ep0ch.sh");
  expect(attached).not.toContain("isn't attached");
  expect(attached).not.toContain("run: ep0ch artifact deploy");
}, 60_000);
