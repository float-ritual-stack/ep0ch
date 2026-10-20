import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMachineName, outlineLayout } from "@ep0ch/outline-core/outline-location";
import { connectLink, linkStatus, serveLink } from "@ep0ch/outliner/link";
import { checkLinkServer, linkKey, linkKeyGroup, readLinkConfig, writeLinkConfig } from "@ep0ch/outliner/link-config";

export async function runLink(args: string[]): Promise<number> {
  const outlines = process.env.EP0CH_OUTLINES || join(homedir(), "outlines");
  try {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { server: { type: "string" }, machine: { type: "string", multiple: true }, port: { type: "string" }, json: { type: "boolean" }, serve: { type: "boolean" } } });
    const [op, ...extra] = positionals;
    if (extra.length) throw new Error("link takes one operation");
    if (op === "setup") {
      const machines = values.machine ?? [];
      if (!machines.length || machines.some(m => !isMachineName(m) || !/^[a-z0-9._-]{1,59}$/.test(m))) throw new Error("name a machine with --machine <lowercase-name> (up to 59 characters)");
      if (values.serve) {
        const port = Number(values.port ?? "8788");
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be 1 through 65535");
        writeLinkConfig(outlines, { mode: "serve", port, machines: [...new Set(machines)] });
      } else {
        if (!values.server || machines.length !== 1) throw new Error("ep0ch link setup --server https://link.ep0ch.sh --machine laptop");
        checkLinkServer(values.server);
        writeLinkConfig(outlines, { mode: "connect", server: values.server, machine: machines[0]! });
      }
      console.log(`Link configured. Set the same random key on each end, then run ep0ch install --apply:\n${machines.map(m => `  ep0ch keys set ${linkKeyGroup(m)} LINK_KEY`).join("\n")}`);
      return 0;
    }
    if (op === "status") {
      const links = await linkStatus(outlines), config = readLinkConfig(outlines);
      console.log(values.json ? JSON.stringify({ config, links }) : links.length ? links.map(l => `${l.machine}: ${l.transport} ${l.up ? "up" : "down"}${l.since ? `; last up ${l.since}` : "; never up"}${l.reason ? `; ${l.reason}` : ""}`).join("\n") : "No machine link is configured; run ep0ch link setup.");
      return 0;
    }
    const config = readLinkConfig(outlines);
    if (!config || op !== config.mode) throw new Error("Configure this machine first: ep0ch link setup --server https://link.ep0ch.sh --machine laptop (connector), or ep0ch link setup --serve --machine laptop (server)");
    const log = (line: string) => console.error(line);
    const running = config.mode === "serve"
      ? serveLink({ outlines, port: config.port, keys: Object.fromEntries(await Promise.all(config.machines.map(async m => [m, await linkKey(m)]))), log })
      : connectLink({ server: config.server, machine: config.machine, key: await linkKey(config.machine), host: outlineLayout(outlines).socket, statusPath: join(outlines, ".host/link-state.json"), log });
    await new Promise<void>(resolve => {
      const stop = () => { void running.stop(); resolve(); };
      process.once("SIGTERM", stop); process.once("SIGINT", stop);
    });
    return 0;
  } catch (e) { console.error(`ep0ch link: ${(e as Error).message}`); return 1; }
}
