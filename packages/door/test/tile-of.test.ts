import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { realTileDeps, tileOf } from "../src/tile-of";

const tiles = [{ id: "t1", name: "claude", pid: 100 }, { id: "t2", name: "shell", pid: 200 }];

test("a tile is found by the process's ancestors, else by the owner of a TCP port, else none", () => {
  const ancestors = (pid: number) => (pid === 301 ? [300, 200, 1] : pid === 401 ? [400, 100] : []);
  const deps = { ancestors, portOwners: (port: number) => (port === 5555 ? [401] : []) };
  expect(tileOf(tiles, { pid: 301 }, deps)).toEqual({ tile: "t2", name: "shell", by: "pid" });
  // The ssh client in the claude tile owns the connection sshd named in SSH_CONNECTION.
  expect(tileOf(tiles, { port: 5555 }, deps)).toEqual({ tile: "t1", name: "claude", by: "port" });
  expect(tileOf(tiles, { pid: 999, port: 6666 }, deps)).toEqual({ tile: null, name: null, by: null });
});

test("the real process table finds this process as the owner of a port it listens on, and its parent as the tile", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const deps = realTileDeps();
    expect(deps.portOwners(port)).toContain(process.pid);
    expect(tileOf([{ id: "t1", name: "me", pid: process.ppid }], { port }, deps)).toEqual({ tile: "t1", name: "me", by: "port" });
  } finally { server.close(); }
});

// PIE-1242: the laptop's door is on macOS, where there is no /proc: the port's owners come from lsof there.
test("on a machine without /proc, a port's owners are lsof's answer", async () => {
  const { lsofPortOwners, portOwnersFor } = await import("../src/tile-of");
  const asked: string[][] = [];
  const owners = lsofPortOwners(50123, argv => { asked.push(argv); return { code: 0, out: "4242\n4243\n" }; });
  expect(owners).toEqual([4242, 4243]);
  expect(asked).toEqual([["lsof", "-nP", "-a", "-iTCP:50123", "-sTCP:ESTABLISHED", "-t"]]);
  expect(lsofPortOwners(50123, () => ({ code: 1, out: "" }))).toEqual([]);
  expect(portOwnersFor(false)).toBe(lsofPortOwners);
});
