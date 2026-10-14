// Every extension carries its own copy of the outline client (an extension folder is self-contained). The copies must
// be the one file, and the one file must survive a character split across two chunks and a host that hangs up.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extensions = join(import.meta.dir, "..", "extensions");
const COPIES = ["almanac", "echonet", "intake", "notify", "readwise", "runbook", "structure"];

test("every extension's outline.ts is the same file", () => {
  const template = readFileSync(join(extensions, "almanac", "outline.ts"), "utf8");
  for (const name of COPIES) expect(readFileSync(join(extensions, name, "outline.ts"), "utf8"), name).toBe(template);
});

const cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

async function host(onRequest: (connection: Socket) => void): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), "outline-client-"));
  const server: Server = createServer(connection => connection.once("data", () => onRequest(connection)));
  await new Promise<void>(resolve => server.listen(join(folder, "s.sock"), resolve));
  process.env.EP0CH_SOCKET = join(folder, "s.sock");
  process.env.EP0CH_EXT_GRANT = "grant";
  cleanups.push(() => { server.close(); rmSync(folder, { recursive: true, force: true }); });
}

for (const name of COPIES) {
  test(`${name}: a character split across two chunks stays whole, and a host that closes without an answer rejects`, async () => {
    const { outline } = await import(join(extensions, name, "outline.ts")) as typeof import("../extensions/almanac/outline");
    const bytes = Buffer.from(`${JSON.stringify({ ok: true, result: "naïve 🌱" })}\n`);
    const cut = bytes.indexOf(0xf0) + 2; // inside the four-byte seedling
    await host(connection => { connection.write(bytes.subarray(0, cut)); setTimeout(() => connection.write(bytes.subarray(cut)), 30); });
    expect(await outline<string>({ action: "ping" } as never)).toBe("naïve 🌱");
    await host(connection => connection.end());
    await expect(outline({ action: "ping" } as never)).rejects.toThrow(/closed without an answer/);
  });
}
