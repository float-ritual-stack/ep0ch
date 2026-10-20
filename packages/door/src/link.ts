import { run } from "./setup/facts";
import { recordLinkInstall } from "./setup/deploy-record";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMachineName, outlineLayout } from "@ep0ch/outline-core/outline-location";
import { connectLink, linkStatus, serveLink, linkInstallSummary, type LinkInstallResult } from "@ep0ch/outliner/link";
import { checkLinkServer, linkKey, linkKeyGroup, readLinkConfig, writeLinkConfig } from "@ep0ch/outliner/link-config";

export async function installLinkedSha(sha: string): Promise<LinkInstallResult> {
  const invoke = async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "main.ts"), "install", "--apply", "--as-client", "--sha", sha, "--json"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { report: JSON.parse(out), err, code };
  };
  const first = await invoke();
  // A successful checkout update asks for another invocation so the new code owns the remaining install work.
  const changed = first.code === 0 && first.report.steps.some((s: { id: string; done?: string[] }) => s.id === "repo" && s.done?.some(line => line.startsWith("RUN AGAIN:")));
  const { report, err, code } = changed ? await invoke() : first;
  const sessions = [...(changed ? first.report.steps : []), ...report.steps].filter((s: { id: string }) => s.id === "session");
  const installedCommit = (await run(["git", "-C", resolve(import.meta.dir, "../../.."), "rev-parse", "HEAD"])).out;
  return { sha, code, commit: installedCommit, notDone: report.notDone, notes: report.notes, sessions, error: report.error || (code !== 0 ? err || undefined : undefined) };
}

export async function runLink(args: string[]): Promise<number> {
  const outlines = process.env.EP0CH_OUTLINES || join(homedir(), "outlines");
  try {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { server: { type: "string" }, machine: { type: "string", multiple: true }, port: { type: "string" }, json: { type: "boolean" }, serve: { type: "boolean" } } });
    const [op, ...extra] = positionals;
    if (op === "auto-install") {
      const config = readLinkConfig(outlines);
      if (config?.mode !== "connect" || extra.length !== 1 || !["on", "off"].includes(extra[0]!)) throw new Error("ep0ch link auto-install on|off (on the connecting machine)");
      writeLinkConfig(outlines, { ...config, autoInstall: extra[0] === "on" });
      console.log(`Link auto-install ${extra[0]}.`);
      return 0;
    }
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
    const commit = (await run(["git", "-C", resolve(import.meta.dir, "../../.."), "rev-parse", "HEAD"])).out;
    let installed = () => {};
    const running = config.mode === "serve"
      ? serveLink({ outlines, port: config.port, keys: Object.fromEntries(await Promise.all(config.machines.map(async m => [m, await linkKey(m)]))), log, onResult: async (machine, result, deploy) => { log(linkInstallSummary(machine, result)); await recordLinkInstall(deploy, machine, result); } })
      : connectLink({ server: config.server, machine: config.machine, key: await linkKey(config.machine), commit, install: installLinkedSha, autoInstall: () => { const c = readLinkConfig(outlines); return c?.mode === "connect" && c.autoInstall !== false; }, onInstalled: () => installed(), host: outlineLayout(outlines).socket, statusPath: join(outlines, ".host/link-state.json"), log });
    await new Promise<void>(resolve => {
      const stop = () => { void running.stop(); resolve(); };
      installed = stop;
      process.once("SIGTERM", stop); process.once("SIGINT", stop);
    });
    return 0;
  } catch (e) { console.error(`ep0ch link: ${(e as Error).message}`); return 1; }
}
