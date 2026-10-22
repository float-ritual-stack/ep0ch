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
