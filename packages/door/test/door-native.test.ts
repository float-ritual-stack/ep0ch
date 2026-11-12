// `--door native` (packages/native): the door's own client reaches the native window's control socket, which sits
// beside the terminal door's in the outline's session folder and speaks the same protocol.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_COMMANDS } from "../src/cli-commands";
import { DOORS, doorFlags } from "../src/cli-words";
import { controlFor, placeFor } from "../src/session/place";

describe("--door native", () => {
  const root = mkdtempSync(join(tmpdir(), "ep0ch-door-native-"));
  const env = { ...process.env, EP0CH_STATE: join(root, "state"), EP0CH_OUTLINES: join(root, "outlines"), EP0CH_WS: undefined, EP0CH_SOCKET: undefined, EP0CH_MACHINE: undefined, EP0CH_CONTROL: undefined } as Record<string, string | undefined>;
  const before = process.env.EP0CH_STATE;
  let server: Server | null = null;
  let dir = "";

  beforeAll(async () => {
    // The place's folder is under the state dir the process names: this test's own.
    process.env.EP0CH_STATE = env.EP0CH_STATE;
    const place = placeFor(["--ws", "garden"], env, root);
    if (!place || "error" in place) throw new Error(`no place for garden: ${JSON.stringify(place)}`);
    dir = place.dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  });
  afterAll(() => {
    server?.close();
    if (before === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = before;
  });

  test("the flag is lifted from anywhere on the line, and names a door there is", () => {
    expect(doorFlags(["act", "--door", "native", "note.trash", "--as", "compost-agent"])).toEqual({ args: ["act", "note.trash", "--as", "compost-agent"], door: "native" });
    expect(doorFlags(["act", "note.trash", "--ws", "garden", "--door", "native"])).toEqual({ args: ["act", "note.trash"], ws: "garden", door: "native" });
    expect(doorFlags(["act", "note.trash", "--door", "attic"])).toEqual({ error: "--door is terminal or native, not attic" });
    expect(doorFlags(["act", "note.trash", "--door"])).toEqual({ error: "--door needs which door answers (terminal or native): ep0ch act … --door <door>" });
    expect(Object.keys(DOORS)).toEqual(["terminal", "native"]);
  });

  test("the commands a native window answers each say they take the flag", () => {
    // What native's control socket serves (packages/native/src/control.rs): peek, act and actions.
    const taking = CLI_COMMANDS.filter(c => c.flags.some(f => f[0].startsWith("--door "))).map(c => c.name);
    expect(taking).toEqual(["peek", "act", "actions"]);
  });

  test("no native window on the outline is said, with what starts one", async () => {
    const none = await controlFor(env, root, ["act", "--ws", "garden"], "native");
    expect(none).toEqual({ error: "no native door runs on garden · `ep0ch-native -- --ws garden` starts one" });
  });

  test("a native window's socket is the one reached, beside where the terminal door's would be", async () => {
    server = createServer(() => {});
    await new Promise<void>(res => server!.listen(join(dir, "native.sock"), () => res()));
    expect(await controlFor(env, root, ["act", "--ws", "garden"], "native")).toBe(join(dir, "native.sock"));
    // The terminal door is still its own question: none runs here.
    const terminal = await controlFor(env, root, ["act", "--ws", "garden"]);
    expect(typeof terminal === "object" && terminal.error).toContain("no door runs on garden");
    // With no outline named, the only native window running is the one meant.
    expect(await controlFor(env, root, ["act"], "native")).toBe(join(dir, "native.sock"));
  });
});
