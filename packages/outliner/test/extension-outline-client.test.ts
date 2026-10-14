// Every extension carries its own copy of the outline client (an extension folder is self-contained). The copies must
// be the one file, and the one file must survive a character split across two chunks and a host that hangs up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extensions = join(import.meta.dir, "..", "extensions");
const COPIES = ["almanac", "echonet", "intake", "notify", "readwise", "runbook", "structure"];

/** Every extension file that opens a socket (imports node:net) is one of the clients tested here: a new one fails this until it is. */
test("the extension files that import node:net are exactly the clients tested here", () => {
  const found: string[] = [];
  for (const dir of readdirSync(extensions, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(extensions, dir.name))) {
      if (file.endsWith(".ts") && /from "node:net"/.test(readFileSync(join(extensions, dir.name, file), "utf8"))) found.push(`${dir.name}/${file}`);
    }
  }
  expect(found.sort()).toEqual([...COPIES.map(name => `${name}/outline.ts`), "tarot/request.ts"].sort());
});

test("every extension's outline.ts is the same file", () => {
  const template = readFileSync(join(extensions, "almanac", "outline.ts"), "utf8");
  for (const name of COPIES) expect(readFileSync(join(extensions, name, "outline.ts"), "utf8"), name).toBe(template);
});

const cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups.splice(0).reverse()) c(); });

async function host(onRequest: (connection: Socket) => void): Promise<void> {
  const was = { socket: process.env.EP0CH_SOCKET, grant: process.env.EP0CH_EXT_GRANT };
  const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  const folder = mkdtempSync(join(tmpdir(), "outline-client-"));
  const server: Server = createServer(connection => connection.once("data", () => onRequest(connection)));
  await new Promise<void>(resolve => server.listen(join(folder, "s.sock"), resolve));
  process.env.EP0CH_SOCKET = join(folder, "s.sock");
  process.env.EP0CH_EXT_GRANT = "grant";
  cleanups.push(() => { restore("EP0CH_SOCKET", was.socket); restore("EP0CH_EXT_GRANT", was.grant); server.close(); rmSync(folder, { recursive: true, force: true }); });
}

const CLIENTS: Array<[string, string]> = [...COPIES.map(name => [name, "outline.ts"] as [string, string]), ["tarot", "request.ts"]];
for (const [name, file] of CLIENTS) {
  test(`${name}: a character split across two chunks stays whole, and a host that closes without an answer rejects`, async () => {
    const mod = await import(join(extensions, name, file)) as { outline?: (r: never) => Promise<unknown>; request?: (b: Record<string, unknown>, to: { socketPath?: string; timeoutMs?: number }) => Promise<unknown> };
    const outline = <T>(r: unknown) => (mod.outline ? mod.outline(r as never) : mod.request!(r as Record<string, unknown>, { socketPath: process.env.EP0CH_SOCKET, timeoutMs: 5000 })) as Promise<T>;
    const bytes = Buffer.from(`${JSON.stringify({ ok: true, result: "naïve 🌱" })}\n`);
    const cut = bytes.indexOf(0xf0) + 2; // inside the four-byte seedling
    await host(connection => { connection.write(bytes.subarray(0, cut)); setTimeout(() => connection.write(bytes.subarray(cut)), 30); });
    expect(await outline<string>({ action: "ping" })).toBe("naïve 🌱");
    await host(connection => connection.end());
    await expect(outline({ action: "ping" })).rejects.toThrow(/closed without an answer/);
  });
}
