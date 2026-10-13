// PIE-797: Claude Code's copy in the drawer agent's Herdr pane reaches the person. Herdr doesn't pass a pane's OSC 52
// on to a `herdr terminal attach` client (herdrdev/herdr#4612), so the pane gives Claude the door's `wl-copy`
// (scripts/clip): it hands the text to the door showing the pane (`terminal.clip`), which copies it as the tile's own
// OSC 52 would be copied: only for a tile the person uses. Each hop here: the pane's env, the shim's request, the action,
// the tile's copy. Fictional text; a fake control socket stands in for the door.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLIP_DIR, clipVars } from "../src/desk/herdr-agent";
import { PTY_ACTIONS } from "../src/desk/pty-actions";
import { PtyPane, cttyPrefix } from "../src/desk/pty";
import { JsonLines, jsonLine } from "../src/jsonl";
import { until } from "./scratch";

const SHIM = resolve(import.meta.dir, "../scripts/clip/wl-copy");

describe("the pane's env", () => {
  test("a machine with no display gets the door's wl-copy first on PATH and a WAYLAND_DISPLAY that picks it", () => {
    expect(clipVars({ PATH: "/usr/bin:/bin" })).toEqual({ WAYLAND_DISPLAY: "ep0ch-clip", PATH: `${CLIP_DIR}:/usr/bin:/bin` });
    expect(CLIP_DIR).toBe(resolve(import.meta.dir, "../scripts/clip"));
  });
  test("one with a display of its own keeps its own clipboard tools", () => {
    expect(clipVars({ PATH: "/usr/bin", WAYLAND_DISPLAY: "wayland-0" })).toEqual({});
    expect(clipVars({ PATH: "/usr/bin", DISPLAY: ":0" })).toEqual({});
  });
});

/** A stand-in for the door's control socket: answers ok, keeps what it was asked. */
function fakeDoor() {
  const dir = mkdtempSync(join(tmpdir(), "clip-shim-"));
  const path = join(dir, "door.sock");
  const asked: any[] = [];
  const server = Bun.listen({
    unix: path,
    socket: {
      open(s) { (s as any).lines = new JsonLines((v: any) => { asked.push(v); s.write(jsonLine({ id: v.id, ok: true })); }); },
      data(s, d) { (s as any).lines.feed(d); },
    },
  });
  return { path, asked, stop() { server.stop(true); rmSync(dir, { recursive: true, force: true }); } };
}

/** The shim as Claude Code runs it: text on stdin; `setsid`, so it has no terminal to write its OSC 52 to here. */
async function copy(text: string, args: string[], env: Record<string, string>) {
  const p = Bun.spawn(["setsid", process.execPath, SHIM, ...args], { stdin: new Blob([text]), stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", ...env } });
  return { code: await p.exited, err: await new Response(p.stderr).text() };
}

describe("the door's wl-copy", () => {
  test("hands what Claude copied to the door showing the pane, as terminal.clip for its tile; --primary is left alone", async () => {
    const door = fakeDoor();
    try {
      const env = { EP0CH_CONTROL: door.path, EP0CH_TILE_ID: "drawer.agent" };
      expect(await copy("Stake the beans · 🌱", [], env)).toEqual({ code: 0, err: "" });
      await until(() => door.asked.length === 1, "the door asked", 3000);
      expect(door.asked[0]).toMatchObject({ cmd: "act", action: "terminal.clip", tile: "drawer.agent", args: { text: "Stake the beans · 🌱" } });
      expect(door.asked[0].as).toBeUndefined();
      // Claude fills the primary selection too, right after: that one isn't a copy of the person's.
      expect(await copy("Stake the beans · 🌱", ["--primary"], env)).toEqual({ code: 0, err: "" });
      await Bun.sleep(300);
      expect(door.asked).toHaveLength(1);
    } finally { door.stop(); }
  }, 15_000);

  test("found on the pane's PATH as wl-copy, it takes text as arguments too, and reads a big --primary write to its end", async () => {
    const door = fakeDoor();
    try {
      const env = { EP0CH_CONTROL: door.path, EP0CH_TILE_ID: "drawer.agent", PATH: `${CLIP_DIR}:${process.env.PATH ?? ""}` };
      // As a shell in the pane runs it: by name, through PATH and the shebang.
      const byName = Bun.spawn(["setsid", "sh", "-c", "wl-copy -t text/plain Mulch the rhubarb"], { stdin: "ignore", env });
      expect(await byName.exited).toBe(0);
      await until(() => door.asked.length === 1, "the door asked", 3000);
      expect(door.asked[0]).toMatchObject({ action: "terminal.clip", args: { text: "Mulch the rhubarb" } });
      // A big write to --primary: every byte is taken (the writer sees no broken pipe), nothing is sent.
      const big = "x".repeat(512 * 1024);
      const primary = Bun.spawn(["setsid", "bash", "-c", `set -o pipefail; head -c ${big.length} /dev/zero | tr "\\0" x | wl-copy --primary`], { env });
      expect(await primary.exited).toBe(0);
      await Bun.sleep(300);
      expect(door.asked).toHaveLength(1);
    } finally { door.stop(); }
  }, 20_000);

  test("with no door to tell (run by hand, or the door gone), it still exits 0: a copy never fails", async () => {
    expect((await copy("Net the brassicas", [], { EP0CH_CONTROL: join(tmpdir(), "no-such-door.sock"), EP0CH_TILE_ID: "x" })).code).toBe(0);
    expect((await copy("Net the brassicas", [], {})).code).toBe(0);
  }, 15_000);
});

describe.skipIf(!cttyPrefix())("terminal.clip in the door", () => {
  const tile = () => {
    const copies: [unknown, string | undefined][] = [];
    const p = new PtyPane({ cmd: ["sh"] });
    p.tileName = "claude";
    p.init({ redraw() {}, ctx: { flash() {}, copy: (t: unknown, from?: string) => { copies.push([t, from]); return typeof t === "string"; } } } as any);
    return { p, copies };
  };

  test("copies as the tile's own OSC 52 would: for a tile the person typed in lately, else it says why not, whoever asks", async () => {
    const { p, copies } = tile();
    try {
      p.render(60, 8, false, { redraw() {} } as any);
      await Bun.sleep(150);
      const on = { pane: p, desk: {} as any, tile: "drawer.agent" };
      // Nobody has typed in it: not copied, and said.
      await PTY_ACTIONS.run("terminal.clip", { text: "Lift the onions" }, on as any, { kind: "user" } as any);
      expect(copies).toEqual([[{ away: true }, "sh"]]);
      // The person types in it: now it's theirs.
      p.inputRaw("\r");
      expect(await PTY_ACTIONS.run("terminal.clip", { text: "Lift the onions" }, on as any, { kind: "user" } as any)).toEqual({ tile: "drawer.agent", copied: 15 });
      expect(copies.at(-1)).toEqual(["Lift the onions", "sh"]);
      // A request over the control socket (an agent, or the shim) gets the same rule, nothing more.
      expect(await PTY_ACTIONS.run("terminal.clip", { text: "Net the brassicas" }, on as any, { kind: "agent", id: "garden-agent" } as any)).toEqual({ tile: "drawer.agent", copied: 17 });
      expect(copies.at(-1)).toEqual(["Net the brassicas", "sh"]);
    } finally { p.dispose(); }
  }, 15_000);
});
