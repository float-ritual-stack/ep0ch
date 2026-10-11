// Private spike imports are intentional: this is a thin client of the real host.
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { OutlinerClient } from "../outliner/src/client";
import { seed } from "./seed";
import { startServer, type ResonanceServer } from "./server";

if (process.argv.length > 2) throw new Error("Resonance is session-ephemeral; no existing data folder or outline may be supplied. Run bun packages/resonance/demo.ts.");
const port = Number(process.env.RESONANCE_PORT ?? "4789");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("RESONANCE_PORT must be an integer from 1024 to 65535.");
const root = await mkdtemp("/tmp/resonance-");
await chmod(root, 0o700);
const outlines = join(root, "outlines");
const socket = join(outlines, ".host", "host.sock");
let host: Bun.Subprocess<"ignore", "inherit", "inherit"> | undefined;
let server: ResonanceServer | undefined;
let stopping = false;
let cleanupPromise: Promise<void> | undefined;
function cleanup(): Promise<void> {
  return cleanupPromise ??= (async () => {
    stopping = true;
    server?.stop(true);
    if (host && host.exitCode === null) {
      host.kill("SIGTERM");
      const deadline = setTimeout(() => { if (host?.exitCode === null) host.kill("SIGKILL"); }, 5000);
      try { await host.exited; } finally { clearTimeout(deadline); }
    }
    await rm(root, { recursive: true, force: true });
  })();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void cleanup().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });

try {
  await Promise.all(["home", "config", "state", "cache", "data", "tmp", "prompts", "outlines"].map(name => mkdir(join(root, name), { recursive: true, mode: 0o700 })));
  if (stopping) throw new Error("Launch interrupted.");
  // Allowlist, not a copied environment: no inherited EP0CH_*, OUTLINER_*, HERDR_*,
  // credentials, real HOME extensions, XDG configuration or Litestream state.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    TMPDIR: join(root, "tmp"),
    EP0CH_OUTLINES: outlines,
    OUTLINER_PROMPT_DIR: join(root, "prompts"),
  };
  host = Bun.spawn([process.execPath, join(import.meta.dir, "../outliner/src/host-main.ts")], {
    cwd: root, env, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  const administration = new OutlinerClient(socket, 1000);
  const deadline = Date.now() + 15_000;
  while (true) {
    if (stopping) throw new Error("Launch interrupted.");
    if (host.exitCode !== null) throw new Error(`Scratch host exited ${host.exitCode}; see its error above.`);
    try { await administration.requireCompatibleService(); break; }
    catch (error) {
      if (Date.now() >= deadline) throw new Error(`Scratch host did not become ready: ${error instanceof Error ? error.message : String(error)}`);
      await Bun.sleep(100);
    }
  }
  // The one creation request is never retried; it can only target our fresh root.
  await administration.request({ action: "outlines.create", name: "resonance", about: {
    kind: "scratch", createdBy: "Resonance demo", principal: "fictional expedition visitor", created: new Date().toISOString(), purpose: "Isolated fictional orbital listening station experiment",
  } });
  const client = new OutlinerClient(socket, 10_000, "resonance");
  await client.requireCompatibleService();
  await seed(client);
  if (stopping) throw new Error("Launch interrupted.");
  server = await startServer(client, port);
  console.log(`\nResonance — fictional scratch expedition\nRoot: ${root}\nSocket: ${socket}\nOutline: resonance (session ephemeral)\nOpen: http://127.0.0.1:${port}\nCtrl-C removes this scratch data and stops only this app's host.\n`);
  const code = await host.exited;
  if (!stopping) throw new Error(`Scratch host exited ${code}; the app has stopped. Relaunch the demo for a fresh expedition.`);
} catch (error) {
  if (!stopping) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
} finally {
  await cleanup();
}
