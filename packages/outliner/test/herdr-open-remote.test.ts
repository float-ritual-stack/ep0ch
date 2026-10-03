import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { OutlinerClient, type OutlinerWatcher } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import type { OutlinerClientRegistration } from "../src/types";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [mode, via] of [["focus-or-open", "socket"], ["open-tree", "socket"], ["focus-or-open", "machine"]] as const) test(`remote Herdr ${mode} (${via === "socket" ? "EP0CH_SOCKET" : "the .ep0ch's machine"}) keeps the host and the folder's outline, and opens only its required panes`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-remote-herdr-"));
  temporaryDirectories.push(directory);
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  // The host on the other machine (EP0CH_SOCKET names it, or the .ep0ch names its machine), and the folder's .ep0ch
  // naming its outline.
  const host = new OutlineHost({ outlinesFolder: join(directory, "remote-outlines"), log: () => {} });
  await host.start();
  await host.create("garden");
  writeFileSync(join(workspaceRoot, ".ep0ch"), via === "socket" ? 'ws = "garden"\n' : 'ws = "garden"\nmachine = "box-a"\n');
  // The machine is reached through the fake ssh: its `ep0ch status --json` says where the host is.
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(bin, "ep0ch"), `#!/bin/sh\necho '${JSON.stringify({ socket: host.socketPath })}'\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(bin, f), 0o755);
  mkdirSync(join(directory, "far-home"));
  const canonical = { socket: host.socketPath };
  const foreignConnected = Promise.withResolvers<void>();
  const foreignWatcher = new OutlinerClient(canonical.socket, undefined, "garden").watch({
    client: {
      clientId: "float-box-tree",
      role: "tree",
      contextId: "float-box",
      runtime: {
        hostname: "float-box.invalid",
        paneId: "float-box-pane",
        workspaceId: "workspace",
        tabId: "tab",
      },
    } satisfies OutlinerClientRegistration,
    onConnect: foreignConnected.resolve,
    onEvent() {},
  });
  await foreignConnected.promise;

  const herdr = join(directory, "fake-herdr");
  const logPath = join(directory, "herdr-calls.jsonl");
  writeFileSync(
    herdr,
    `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "pane" && args[1] === "get") {
  console.log(JSON.stringify({ result: { pane: {
    pane_id: "workspace:pane",
    foreground_cwd: ${JSON.stringify(mode === "open-tree" ? "/unrelated/plugin-checkout" : workspaceRoot)},
    cwd: ${JSON.stringify(workspaceRoot)},
    workspace_id: "workspace",
    tab_id: "workspace:tab",
  } } }));
} else if (args[0] === "plugin" && args[1] === "pane" && args[2] === "open") {
  const entrypoint = args[args.indexOf("--entrypoint") + 1];
  console.log(JSON.stringify({ result: { plugin_pane: { pane: {
    pane_id: "workspace:" + entrypoint,
  } } } }));
} else {
  console.log(JSON.stringify({ result: { type: "ok" } }));
}
`,
  );
  chmodSync(herdr, 0o755);

  let stopPaneRegistration = false;
  const registerOpenedPanes = (async (): Promise<OutlinerWatcher[]> => {
    const watchers: OutlinerWatcher[] = [];
    function register(role: "tree" | "detail", paneId: string): void {
      watchers.push(new OutlinerClient(canonical.socket, undefined, "garden").watch({
        client: {
          clientId: `opened-local-${role}`,
          role,
          contextId: "opened-local-context",
          ...(role === "detail" ? { locked: false } : {}),
          runtime: {
            hostname: hostname(),
            paneId,
            workspaceId: "workspace",
            tabId: "workspace:tab",
          },
        },
        onEvent() {},
      }));
    }
    while (!stopPaneRegistration) {
      const calls = (() => {
        try {
          return readFileSync(logPath, "utf8");
        } catch {
          return "";
        }
      })();
      // Neither client can become ready until both panes have been opened.
      if (
        calls.includes('"--entrypoint","outliner"') &&
        (mode === 'open-tree' || calls.includes('"--entrypoint","detail"'))
      ) {
        register("tree", "workspace:outliner");
        if (mode !== "open-tree") register("detail", "workspace:detail");
        return watchers;
      }
      await Bun.sleep(10);
    }
    return watchers;
  })();

  try {
    const child = Bun.spawn([
      "bun",
      "run",
      "src/herdr-open.ts", "--mode", mode,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_BIN_PATH: herdr,
        HERDR_PANE_ID: "workspace:pane",
        OUTLINER_WORKSPACE_ROOT: workspaceRoot,
        EP0CH_OUTLINES: join(directory, "local-outlines"),
        EP0CH_SOCKET: via === "socket" ? canonical.socket : undefined,
        EP0CH_WS: undefined,
        EP0CH_MACHINE: undefined,
        EP0CH_SSH: join(bin, "ssh"),
        FAKE_SSH_HOME: join(directory, "far-home"),
        FAKE_SSH_OUTLINES: join(directory, "remote-outlines"),
        FAKE_SSH_BIN: bin,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
      killSignal: "SIGKILL",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result.outline).toBe("garden");
    expect(result.outlinerPane).toBe("workspace:outliner");
    expect(result.detailPane).toBe(mode === "open-tree" ? undefined : "workspace:detail");

    const calls = readFileSync(logPath, "utf8").trim().split("\n").map(
      (line) => JSON.parse(line) as string[],
    );
    const openedEntrypoints = calls
      .filter((args) => args[0] === "plugin" && args[1] === "pane" && args[2] === "open")
      .map((args) => args[args.indexOf("--entrypoint") + 1]);
    expect(openedEntrypoints).toEqual(mode === "open-tree" ? ["outliner"] : ["outliner", "detail"]);
    for (const args of calls.filter((call) => call.includes("--entrypoint"))) {
      // Every pane reaches the same host for the same outline, whatever its own environment says.
      if (via === "socket") expect(args).toContain(`EP0CH_SOCKET=${canonical.socket}`);
      expect(args).toContain("EP0CH_WS=garden");
      expect(args).toContain(`EP0CH_MACHINE=${via === "socket" ? "" : "box-a"}`);
    }
  } finally {
    try { process.kill(Number(readFileSync(join(directory, "local-outlines", ".remote", "box-a.ctl"), "utf8"))); } catch { /* none started */ }
    stopPaneRegistration = true;
    const openedPaneWatchers = await registerOpenedPanes;
    await Promise.all(openedPaneWatchers.map((watcher) => watcher.stop()));
    await foreignWatcher.stop();
    await host.close();
  }
}, 10_000);

test("an outline the .ep0ch's machine doesn't have is never made there: refused with the commands, no pane opened (PIE-545)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-remote-missing-"));
  temporaryDirectories.push(directory);
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const host = new OutlineHost({ outlinesFolder: join(directory, "remote-outlines"), log: () => {} });
  await host.start();
  await host.create("garden");
  writeFileSync(join(workspaceRoot, ".ep0ch"), 'ws = "fern"\nmachine = "box-a"\n');
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(bin, "ep0ch"), `#!/bin/sh\necho '${JSON.stringify({ socket: host.socketPath })}'\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(bin, f), 0o755);
  mkdirSync(join(directory, "far-home"));
  const herdr = join(directory, "fake-herdr");
  const logPath = join(directory, "herdr-calls.jsonl");
  writeFileSync(herdr, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "pane" && args[1] === "get") console.log(JSON.stringify({ result: { pane: { pane_id: "workspace:pane", foreground_cwd: ${JSON.stringify(workspaceRoot)}, cwd: ${JSON.stringify(workspaceRoot)}, workspace_id: "workspace", tab_id: "workspace:tab" } } }));
else console.log(JSON.stringify({ result: { type: "ok" } }));
`);
  chmodSync(herdr, 0o755);
  try {
    const child = Bun.spawn(["bun", "run", "src/herdr-open.ts", "--mode", "focus-or-open"], {
      cwd: process.cwd(),
      env: {
        ...process.env, HERDR_ENV: "1", HERDR_BIN_PATH: herdr, HERDR_PANE_ID: "workspace:pane", OUTLINER_WORKSPACE_ROOT: workspaceRoot,
        EP0CH_OUTLINES: join(directory, "local-outlines"), EP0CH_SOCKET: undefined, EP0CH_WS: undefined, EP0CH_MACHINE: undefined,
        EP0CH_SSH: join(bin, "ssh"), FAKE_SSH_HOME: join(directory, "far-home"), FAKE_SSH_OUTLINES: join(directory, "remote-outlines"), FAKE_SSH_BIN: bin,
      },
      stdout: "pipe", stderr: "pipe", timeout: 5_000, killSignal: "SIGKILL",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("box-a has no outline fern. Nothing was created.");
    expect(stderr).toContain("ep0ch outline create fern --machine box-a");
    expect(host.list().outlines.map(o => o.name)).toEqual(["garden"]);
    const calls = (() => { try { return readFileSync(logPath, "utf8"); } catch { return ""; } })();
    expect(calls).not.toContain("--entrypoint");
  } finally {
    try { process.kill(Number(readFileSync(join(directory, "local-outlines", ".remote", "box-a.ctl"), "utf8"))); } catch { /* none started */ }
    await host.close();
  }
}, 10_000);
