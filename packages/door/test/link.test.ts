import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
