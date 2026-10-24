import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { scratchDir } from "./scratch";

test("link setup records an outbound connection without contacting the laptop", async () => {
  const dir = scratchDir("ep0ch-link-");
  try {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "link", "setup", "--server", "https://link.example.test", "--machine", "travel"], {
      env: { ...process.env, EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"), HOME: dir, XDG_CONFIG_HOME: join(dir, "config") }, stdout: "pipe", stderr: "pipe",
    });
    const err = await new Response(child.stderr).text();
    expect({ code: await child.exited, err }).toEqual({ code: 0, err: "" });
    expect(JSON.parse(readFileSync(join(dir, "outlines/.host/link.json"), "utf8"))).toMatchObject({ mode: "connect", server: "https://link.example.test", machine: "travel" });
    for (const setting of ["off", "on"]) {
      const toggle = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "link", "auto-install", setting], {
        env: { ...process.env, EP0CH_OUTLINES: join(dir, "outlines"), HOME: dir, XDG_CONFIG_HOME: join(dir, "config") }, stdout: "pipe", stderr: "pipe",
      });
      const error = await new Response(toggle.stderr).text();
      expect({ code: await toggle.exited, error }).toEqual({ code: 0, error: "" });
      expect(JSON.parse(readFileSync(join(dir, "outlines/.host/link.json"), "utf8")).autoInstall).toBe(setting === "on");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { ScratchHost, until } from "./scratch";
import { serveLink, connectLink, linkStates, linkStatus } from "@ep0ch/outliner/link";
import { hostAnswers, forwardFor } from "@ep0ch/outliner/machine-forward";
import { SocketBoard } from "../src/socket";
import { createConnection, createServer, type Socket } from "node:net";

test("a laptop dials out, carries simultaneous outline reads and writes, refuses a wrong key, and reconnects without replay", async () => {
  const here = new ScratchHost(), laptop = new ScratchHost();
  await here.start(); await laptop.start(); await laptop.create("garden");
  const messages: string[] = [];
  let server = serveLink({ outlines: here.outlines, port: 0, keys: { travel: "fictional-key" }, log: line => messages.push(line) });
  const url = `http://127.0.0.1:${server.port}`;
  const path = join(here.outlines, ".remote/travel.sock");
  let connector: ReturnType<typeof connectLink> | undefined;
  let board: SocketBoard | undefined, other: SocketBoard | undefined;
  try {
    connector = connectLink({ server: url, machine: "travel", key: "wrong-key", host: laptop.sock, log() {} });
    await until(() => messages.some(m => m.includes("wrong key")), "wrong key refused");
    expect(await hostAnswers(path, 100)).toBe(false);
    connector.stop();
    connector = connectLink({ server: url, machine: "travel", key: "fictional-key", host: laptop.sock, log() {} });
    await until(() => linkStates(here.outlines).length === 1, "authenticated link");
    expect(await hostAnswers(path)).toBe(true);
    // No SSH executable exists: a successful forward came through the live link.
    expect((await forwardFor("travel", here.outlines, { ...process.env, EP0CH_SSH: "/no-such-ssh" })).how).toBe("up");
    board = new SocketBoard(path, undefined, "garden");
    other = new SocketBoard(path, undefined, "garden");
    const text = "Greenhouse journal\n" + "Keep the vents open. ".repeat(12000);
    const note = await board.createBlock(null, text);
    const reads = await Promise.all([board.get(note.id), other.get(note.id)]);
    expect(reads.map(n => n?.text)).toEqual([text, text]);
    board.close(); other.close();
    // Drop after only part of a request reached the host: it must not finish on a new stream.
    const pending = createConnection(path);
    await new Promise<void>((resolve, reject) => { pending.once("connect", resolve); pending.once("error", reject); });
    pending.write('{"id":"interrupted","action":"outlines.');
    const closed = new Promise<void>(resolve => pending.once("close", resolve));
    await server.stop();
    await closed;
    await until(() => linkStates(here.outlines).length === 0, "link goes away");
    server = serveLink({ outlines: here.outlines, port: Number(new URL(url).port), keys: { travel: "fictional-key" }, log: line => messages.push(line) });
    await until(() => linkStates(here.outlines).length === 1, "link reconnects automatically");
    board = new SocketBoard(path, undefined, "garden");
    expect((await board.get(note.id))?.text).toBe(text);
    const direct = new SocketBoard(laptop.sock, undefined, "garden");
    try { expect((await direct.get(note.id))?.text).toBe(text); } finally { direct.close(); }
  } finally { board?.close(); other?.close(); connector?.stop(); await server.stop(); await here.dispose(); await laptop.dispose(); }
}, 30_000);

test("an unanswered link falls through to SSH and an unreachable machine explains both repairs", async () => {
  const here = new ScratchHost(), laptop = new ScratchHost();
  await here.start(); await laptop.start(); await laptop.create("garden");
  const server = serveLink({ outlines: here.outlines, port: 0, keys: { travel: "fictional-key" }, log() {} });
  const connector = connectLink({ server: `http://127.0.0.1:${server.port}`, machine: "travel", key: "fictional-key", host: join(laptop.outlines, "missing.sock"), log() {} });
  const ssh = join(here.outlines, "ssh");
  writeFileSync(ssh, `#!/bin/sh\nexec ${process.execPath} ${resolve(import.meta.dir, "../../outliner/test/fake-ssh.ts")} "$@"\n`, { mode: 0o755 });
  mkdirSync(join(here.outlines, "far-home"));
  const env = { ...process.env, EP0CH_SOCKET: undefined, EP0CH_OUTLINES: here.outlines, EP0CH_SSH: ssh, EP0CH_STATE: join(here.outlines, "state"), FAKE_SSH_HOME: join(here.outlines, "far-home"), FAKE_SSH_OUTLINES: laptop.outlines };
  try {
    await until(() => linkStates(here.outlines).length === 1, "link with host unavailable");
    writeFileSync(join(here.outlines, ".remote/travel.json"), JSON.stringify({ outlines: laptop.outlines }));
    const direct = new SocketBoard(laptop.sock, undefined, "garden");
    const note = await direct.createBlock(null, "Greenhouse journal"); direct.close();
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "show", note.id, "--ws", "garden", "--machine", "travel", "--source"], { env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, out }).toEqual({ code: 0, out: expect.stringContaining("Greenhouse journal") });
    expect(err).toContain("travel via ssh");
    const forward = await forwardFor("travel", here.outlines, env);
    expect(await hostAnswers(forward.socket)).toBe(true);
    // Stop only the dedicated SSH master this test started.
    const { sshArgv, forwardPaths } = await import("@ep0ch/outline-core/machine");
    const { nodeMachineIO } = await import("@ep0ch/outliner/machine-forward");
    await nodeMachineIO(env).run(sshArgv.exit(ssh, forwardPaths(here.outlines, "travel")), 5000);
    await expect(forwardFor("travel", here.outlines, { ...env, FAKE_SSH_DOWN: "1" })).rejects.toThrow(/link.*ep0ch link status.*ssh.*ssh travel true/s);
  } finally { connector.stop(); await server.stop(); await here.dispose(); await laptop.dispose(); }
}, 30_000);

test("a silent broken connection is replaced within a minute", async () => {
  const here = new ScratchHost(), laptop = new ScratchHost();
  await here.start(); await laptop.start(); await laptop.create("garden");
  const messages: string[] = [];
  const server = serveLink({ outlines: here.outlines, port: 0, keys: { travel: "fictional-key" }, log() {} });
  const sockets = new Set<Socket>();
  let cut = () => {};
  const proxy = createServer(client => {
    const remote = createConnection({ host: "127.0.0.1", port: server.port });
    let silent = false;
    cut = () => { silent = true; };
    for (const socket of [client, remote]) {
      sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
    }
    client.on("data", data => { if (!silent) remote.write(data); });
    remote.on("data", data => { if (!silent) client.write(data); });
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as import("node:net").AddressInfo).port;
  const connector = connectLink({ server: `http://127.0.0.1:${port}`, machine: "travel", key: "fictional-key", host: laptop.sock, log: line => messages.push(line) });
  try {
    await until(() => messages.filter(m => m.includes(" up since ")).length === 1, "initial link");
    cut();
    await until(() => messages.filter(m => m.includes(" up since ")).length === 2, "silent link replaced within a minute", 59_000);
    expect(await hostAnswers(join(here.outlines, ".remote/travel.sock"))).toBe(true);
  } finally {
    connector.stop(); for (const socket of sockets) socket.destroy(); proxy.close();
    await server.stop(); await here.dispose(); await laptop.dispose();
  }
}, 65_000);

test("the connector recovers after a refused dial and status keeps the last connection on both ends", async () => {
  const here = new ScratchHost(), laptop = new ScratchHost();
  await here.start(); await laptop.start(); await laptop.create("garden");
  let server = serveLink({ outlines: here.outlines, port: 0, keys: { travel: "fictional-key" }, log() {} });
  const port = server.port;
  const messages: string[] = [];
  let connector: ReturnType<typeof connectLink> | undefined;
  try {
    await server.stop();
    connector = connectLink({ server: `http://127.0.0.1:${port}`, machine: "travel", key: "fictional-key", host: laptop.sock, statusPath: join(laptop.outlines, ".host/link-state.json"), log: line => messages.push(line) });
    await until(() => messages.some(m => m.includes("reconnect")), "refused connection schedules another dial");
    server = serveLink({ outlines: here.outlines, port, keys: { travel: "fictional-key" }, log() {} });
    await until(() => linkStates(here.outlines).length === 1, "link after refused dial");
    // Each end writes its own "up since" on its own clock: wait for both before reading them.
    let before = await linkStatus(here.outlines), outboundBefore = await linkStatus(laptop.outlines);
    const end = Date.now() + 10_000;
    while (!(before[0]?.since && outboundBefore[0]?.since) && Date.now() < end) {
      await Bun.sleep(20);
      before = await linkStatus(here.outlines); outboundBefore = await linkStatus(laptop.outlines);
    }
    expect(outboundBefore[0]?.since).toBeTruthy();
    expect(before.find(l => l.machine === "travel")).toMatchObject({ up: true, transport: "link" });
    const disconnects = messages.filter(m => m.includes("link down")).length;
    await server.stop();
    await until(() => messages.filter(m => m.includes("link down")).length > disconnects, "disconnect recorded");
    for (const [folder, previous] of [[here.outlines, before], [laptop.outlines, outboundBefore]] as const) {
      const state = (await linkStatus(folder)).find(l => l.machine === "travel");
      expect(state).toMatchObject({ up: false, transport: "link", since: previous[0]!.since });
      expect(state?.reason).toBeTruthy();
    }
    server = serveLink({ outlines: here.outlines, port, keys: { travel: "fictional-key" }, log() {} });
    await until(() => linkStates(here.outlines).length === 1, "link after server restart");
    connector.stop();
    await until(() => linkStates(here.outlines).length === 0, "connector stopped");
    connector = connectLink({ server: `http://127.0.0.1:${port}`, machine: "travel", key: "fictional-key", host: laptop.sock, statusPath: join(laptop.outlines, ".host/link-state.json"), log() {} });
    await until(() => linkStates(here.outlines).length === 1, "link after connector restart");
    expect(await hostAnswers(join(here.outlines, ".remote/travel.sock"))).toBe(true);
  } finally { connector?.stop(); await server.stop(); await here.dispose(); await laptop.dispose(); }
}, 30_000);

test("a spawned remote read uses the link with SSH unavailable and names its transport", async () => {
  const here = new ScratchHost(), laptop = new ScratchHost();
  await here.start(); await laptop.start(); await laptop.create("garden");
  const server = serveLink({ outlines: here.outlines, port: 0, keys: { travel: "fictional-key" }, log() {} });
  const connector = connectLink({ server: `http://127.0.0.1:${server.port}`, machine: "travel", key: "fictional-key", host: laptop.sock, log() {} });
  const direct = new SocketBoard(laptop.sock, undefined, "garden");
  try {
    const note = await direct.createBlock(null, "Greenhouse journal");
    await until(() => linkStates(here.outlines).length === 1, "link ready for CLI");
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "show", note.id, "--ws", "garden", "--machine", "travel", "--source"], {
      env: { ...process.env, EP0CH_SOCKET: undefined, EP0CH_OUTLINES: here.outlines, EP0CH_SSH: "/no-such-ssh", EP0CH_STATE: join(here.outlines, "state") }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, out }).toEqual({ code: 0, out: expect.stringContaining("Greenhouse journal") });
    expect(err).toContain("travel via link");
  } finally { direct.close(); connector.stop(); await server.stop(); await here.dispose(); await laptop.dispose(); }
}, 30_000);

import { setupCommand } from "../src/setup/apply";

test("a pinned install only fast-forwards to the requested origin/main commit", async () => {
  const dir = scratchDir("link-pin-");
  const repo = join(dir, "repo"), origin = join(dir, "origin.git"), home = join(dir, "home");
  mkdirSync(home);
  const env = { HOME: home, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:/usr/bin:/bin`, XDG_CONFIG_HOME: join(home, ".config"), EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"), GIT_AUTHOR_NAME: "Wren", GIT_AUTHOR_EMAIL: "wren@example.test", GIT_COMMITTER_NAME: "Wren", GIT_COMMITTER_EMAIL: "wren@example.test" };
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
  };
  const output: string[] = [];
  const io = { env, repoRoot: repo, cwd: home, platform: "other", out: (s: string) => output.push(s), err: (s: string) => output.push(s) };
  try {
    git("init", "-qb", "main", repo);
    mkdirSync(join(repo, "packages/door/scripts"), { recursive: true });
    copyFileSync(resolve(import.meta.dir, "../scripts/with-secrets"), join(repo, "packages/door/scripts/with-secrets"));
    mkdirSync(join(repo, "packages/outliner/src"), { recursive: true });
    copyFileSync(resolve(import.meta.dir, "../../outliner/src/schema.ts"), join(repo, "packages/outliner/src/schema.ts"));
    writeFileSync(join(repo, "journal"), "one");
    git("-C", repo, "add", "."); git("-C", repo, "commit", "-qm", "one");
    const before = git("-C", repo, "rev-parse", "HEAD");
    git("clone", "-q", "--bare", repo, origin); git("-C", repo, "remote", "add", "origin", origin);
    writeFileSync(join(repo, "journal"), "two"); git("-C", repo, "commit", "-qam", "two");
    const target = git("-C", repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "journal"), "three"); git("-C", repo, "commit", "-qam", "three");
    git("-C", repo, "push", "-q", "origin", "main");
    git("-C", repo, "switch", "-qc", "unpublished");
    writeFileSync(join(repo, "journal"), "not main"); git("-C", repo, "commit", "-qam", "unpublished");
    const unpublished = git("-C", repo, "rev-parse", "HEAD");
    git("-C", repo, "switch", "-q", "main");
    // The scratch main branch starts at the first commit without touching a real checkout.
    git("-C", repo, "update-ref", "refs/heads/main", before);
    git("-C", repo, "restore", "--source=HEAD", "--staged", "--worktree", ".");
    const invalid = await setupCommand(["install", "--apply", "--as-client", "--sha", unpublished, "--json"], io);
    expect({ invalid, head: git("-C", repo, "rev-parse", "HEAD"), output: output.join("\n") }).toMatchObject({ invalid: 1, head: before, output: expect.stringContaining("origin/main") });
    output.length = 0;
    // Other steps cannot finish in this deliberately incomplete checkout; the checkout step must still pin correctly.
    const code = await setupCommand(["install", "--apply", "--as-client", "--sha", target, "--json"], io);
    expect({ code, head: git("-C", repo, "rev-parse", "HEAD"), output: output.join("\n") }).toMatchObject({ code: 1, head: target });
    expect(output.join("\n")).toContain('"notDone"');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);

import { publishLinkInstall, linkInstallResult, linkUpdateLabel } from "@ep0ch/outliner/link";
import { writeLinkConfig, readLinkConfig } from "@ep0ch/outliner/link-config";
import { recordLinkInstall } from "../src/setup/deploy-record";

test("install control returns a receipt, survives an offline connector, and honours the laptop setting", async () => {
  const here = new ScratchHost(), laptop = new ScratchHost();
  await here.start(); await laptop.start(); await here.create("garden");
  const board = new SocketBoard(here.sock, undefined, "garden");
  const note = await board.createBlock(null, "Deploy on the garden host\nLocal: finished");
  const messages: string[] = [];
  const sha = "a".repeat(40);
  const receipts = async (previous: string) => {
    const result = await board.request<{ blocks: { text: string }[] }>("blocks.query", { query: { where: "type=deploy machine=install" } });
    return result.blocks.filter(b => b.text.includes(`[previous::((${previous}))]`));
  };
  const target = { sha, record: { socket: here.sock, outline: "garden", id: note.id } };
  let linked = serveLink({ outlines: here.outlines, port: 0, keys: { travel: "fictional-key" }, log() {}, onResult: (machine, result, deploy) => recordLinkInstall(deploy, machine, result) });
  let reportReady = false;
  let release = () => {};
  const installing = new Promise<void>(resolve => { release = resolve; });
  let connector: ReturnType<typeof connectLink> | undefined;
  const env = { ...laptop.env, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:/usr/bin:/bin`, EP0CH_STATE: join(laptop.root, "state") };
  try {
    writeLinkConfig(laptop.outlines, { mode: "connect", server: "https://link.example.test", machine: "travel", autoInstall: false });
    publishLinkInstall(here.outlines, target);
    connector = connectLink({ server: `http://127.0.0.1:${linked.port}`, machine: "travel", key: "fictional-key", host: laptop.sock, statusPath: join(laptop.outlines, ".host/link-state.json"),
      autoInstall: () => { const c = readLinkConfig(laptop.outlines); return c?.mode === "connect" && c.autoInstall !== false; },
      install: async requested => {
        const output: string[] = [];
        // A real install against a missing scratch checkout reports the blocked steps rather than executing a made-up command.
        const code = await setupCommand(["install", "--apply", "--as-client", "--sha", requested, "--json"], { env, repoRoot: join(laptop.root, "absent-checkout"), cwd: laptop.root, out: s => output.push(s), err: s => output.push(s) });
        const report = JSON.parse(output.join("\n"));
        reportReady = true;
        await installing;
        return { sha: requested, code, notDone: report.notDone, sessions: [], error: report.error };
      }, log: line => messages.push(line) });
    await until(() => !!linkInstallResult(here.outlines, "travel", sha), "disabled laptop reports why it did not install");
    expect(linkInstallResult(here.outlines, "travel", sha)?.notDone.join(" ")).toContain("auto-install off");
    expect(linkUpdateLabel(laptop.outlines)).toBe("update ready · ep0ch install --apply");
    expect((await receipts(note.id)).some(b => b.text.includes("auto-install off"))).toBe(true);
    const toggle = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "link", "auto-install", "on"], { env, stdout: "pipe", stderr: "pipe" });
    expect(await toggle.exited).toBe(0);
    await until(() => linkUpdateLabel(laptop.outlines) === "update ready · installing", "the door sees installation in progress");
    await until(() => reportReady, "the installer has its receipt ready to return");
    const queued = "c".repeat(40);
    const queuedNote = await board.createBlock(null, "Next deploy on the garden host\nLocal: finished");
    publishLinkInstall(here.outlines, { sha: queued, record: { ...target.record, id: queuedNote.id } });
    const port = linked.port;
    await linked.stop();
    let interruptReceipt = true;
    // Finish before the connector processes ready: server presence alone cannot return a receipt.
    linked = serveLink({ outlines: here.outlines, port, keys: { travel: "fictional-key" }, log: line => { if (line.includes(" up since ")) release(); }, onResult: async (machine, result, deploy) => {
      await recordLinkInstall(deploy, machine, result);
      if (result.sha === sha && interruptReceipt) { interruptReceipt = false; throw new Error("scratch receipt interrupted before acknowledgement"); }
    } });
    await until(() => linkStates(here.outlines).length === 1, "link reconnects while the installer is still running");
    release();
    await until(() => !!linkInstallResult(here.outlines, "travel", sha)?.error?.includes("origin/main"), "install refusal returns through the link");
    expect(linkInstallResult(here.outlines, "travel", sha)?.code).toBe(1);
    await until(() => readFileSync(join(here.outlines, `.remote/travel.${sha}.install.json`), "utf8").includes("origin/main"), "receipt saved");
    await until(() => !!linkInstallResult(here.outlines, "travel", queued), "the newer deploy queued during installation also returns its result");
    expect(messages.filter(m => m.includes("unexpected authentication message"))).toEqual([]);
    expect((await receipts(queuedNote.id)).some(b => b.text.includes(queued))).toBe(true);
    expect((await receipts(note.id)).some(b => b.text.includes("origin/main"))).toBe(true);
    expect((await board.get(note.id))?.text).toBe("Deploy on the garden host\nLocal: finished");
    expect((await board.get(queuedNote.id))?.text).toBe("Next deploy on the garden host\nLocal: finished");
    connector.stop();
    await until(() => linkStates(here.outlines).length === 0, "laptop is offline");
    const newer = "b".repeat(40);
    publishLinkInstall(here.outlines, { ...target, sha: newer });
    connector = connectLink({ server: `http://127.0.0.1:${linked.port}`, machine: "travel", key: "fictional-key", host: laptop.sock, statusPath: join(laptop.outlines, ".host/link-state.json"), commit: newer, install: async () => { throw new Error("a current laptop must not run install again"); }, log() {} });
    await until(() => !!linkInstallResult(here.outlines, "travel", newer), "next connection receives the latest install");
    expect(linkInstallResult(here.outlines, "travel", newer)?.code).toBe(0);
    expect(linkUpdateLabel(laptop.outlines)).toBe("");
  } finally { connector?.stop(); await linked.stop(); board.close(); await here.dispose(); await laptop.dispose(); }
}, 30_000);

test("an endpoint cannot reflect a connector's proof back as permission to install", async () => {
  const laptop = new ScratchHost();
  await laptop.start();
  let captured = "";
  const nonce = "d".repeat(64), messages: string[] = [];
  const untrusted = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req, server) { if (!server.upgrade(req)) return new Response("upgrade required", { status: 400 }); },
    websocket: {
      open(ws) { ws.send(JSON.stringify({ challenge: captured ? nonce : `${nonce}\nserver`, protocol: 1 })); },
      message(ws, data) {
        const auth = JSON.parse(String(data));
        if (!captured) { captured = auth.proof; ws.close(); }
        else ws.send(JSON.stringify({ ready: true, compatible: true, proof: captured }));
      },
    },
  });
  const connector = connectLink({ server: `http://127.0.0.1:${untrusted.port}`, machine: "travel", key: "fictional-key", host: laptop.sock, statusPath: join(laptop.outlines, ".host/link-state.json"), log: line => messages.push(line) });
  try {
    await until(() => messages.some(m => m.includes("server did not prove the link key")), "reflected proof refused");
    expect((await linkStatus(laptop.outlines)).find(l => l.direction === "outbound")?.up).toBe(false);
  } finally { connector.stop(); await untrusted.stop(true); await laptop.dispose(); }
}, 10_000);
