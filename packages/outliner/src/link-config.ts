import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readGroupSecret } from "./extension-secrets";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
export type LinkConfig = { mode: "connect"; server: string; machine: string; autoInstall?: boolean } | { mode: "serve"; port: number; machines: string[] };
export const linkConfigPath = (outlines: string) => join(outlines, ".host/link.json");
export function readLinkConfig(outlines: string): LinkConfig | undefined {
  let text: string;
  try { text = readFileSync(linkConfigPath(outlines), "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  const c = JSON.parse(text);
  if (c.mode === "connect" && typeof c.server === "string" && isMachineName(c.machine) && (c.autoInstall === undefined || typeof c.autoInstall === "boolean")) { checkLinkServer(c.server); return c; }
  if (c.mode === "serve" && Number.isInteger(c.port) && c.port > 0 && c.port < 65536 && Array.isArray(c.machines) && c.machines.every((m: unknown) => typeof m === "string" && isMachineName(m))) return c;
  throw new Error(`${linkConfigPath(outlines)} is invalid; run ep0ch link setup`);
}
export function checkLinkServer(server: string) {
  const url = new URL(server);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("link server must be an HTTPS origin, for example https://link.ep0ch.sh");
}
export function writeLinkConfig(outlines: string, config: LinkConfig) {
  const file = linkConfigPath(outlines);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
export const linkKeyGroup = (machine: string) => `link-${machine.toLowerCase()}`;
export async function linkKey(machine: string, env: NodeJS.ProcessEnv = process.env) {
  return readGroupSecret(linkKeyGroup(machine), "LINK_KEY", "ep0ch link", async service => {
    const child = Bun.spawn(["security", "find-generic-password", "-s", service, "-w"], { stdout: "pipe", stderr: "ignore", env });
    const value = await new Response(child.stdout).text();
    return await child.exited === 0 ? value.trimEnd() : undefined;
  }, env);
}
