import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readFileSync, rmSync } from "node:fs";
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
import { serveLink, connectLink, linkStates } from "@ep0ch/outliner/link";
import { hostAnswers, forwardFor } from "@ep0ch/outliner/machine-forward";
import { SocketBoard } from "../src/socket";
import { createConnection } from "node:net";

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
