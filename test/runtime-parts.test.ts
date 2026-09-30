// The parts behind the door's runtime safety (PIE-488), one at a time: the one state dir, private folders,
// where `snap` may write, the one env list for terminal tiles, marks shared by two doors, ctrl+e files a
// killed door left, and "offline" when the service can't be asked. test/runtime.test.ts runs the door itself.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapPath } from "../src/control";
import { LocalMarks } from "../src/desk/marks";
import { DOOR_START_VARS, HERDR_PANE_VARS, HERDR_VARS, tileEnv } from "../src/desk/pty";
import { mediaCache } from "../src/media";
import { Offline, SocketBoard } from "../src/socket";
import { cacheDir, claimState, privateDir, stateDir } from "../src/state";
import { recoverEdits } from "../src/surface/editor";

let root: string;
const was = process.env.EP0CH_STATE;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ep0ch-runtime-parts-"));
  process.env.EP0CH_STATE = join(root, "state");
});
afterAll(() => {
  if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
  rmSync(root, { recursive: true, force: true });
});

describe("one state dir (F4)", () => {
  test("EP0CH_STATE moves the state and the media cache", () => {
    expect(stateDir()).toBe(join(root, "state"));
    expect(cacheDir()).toBe(join(root, "state", "cache"));
    expect(mediaCache()).toBe(join(root, "state", "cache", "media"));
  });
});

describe("private folders (F3)", () => {
  test("a folder the door owns is tightened to 0700; one it doesn't is refused while it's open to others", () => {
    const own = join(root, "own"), other = join(root, "other");
    mkdirSync(own, { mode: 0o775 }); chmodSync(own, 0o775);
    mkdirSync(other); chmodSync(other, 0o755);
    expect(privateDir(own, true)).toBe(own);
    expect(statSync(own).mode & 0o777).toBe(0o700);
    expect(privateDir(other)).toBeNull();
    expect(statSync(other).mode & 0o777).toBe(0o755);   // left as it was
    expect(privateDir(join(root, "fresh", "deeper"))).toBe(join(root, "fresh", "deeper"));
    expect(statSync(join(root, "fresh", "deeper")).mode & 0o777).toBe(0o700);
  });

  test("snap writes only under the state dir", () => {
    expect(snapPath(undefined)).toBe(join(stateDir(), "screen.png"));
    expect(snapPath("shots/a.png")).toBe(join(stateDir(), "shots", "a.png"));
    expect(snapPath(join(stateDir(), "b.png"))).toBe(join(stateDir(), "b.png"));
    for (const bad of ["../escape.png", "/tmp/elsewhere.png", join(stateDir(), "..", "x.png")]) expect(() => snapPath(bad)).toThrow(/only under the door's state/);
  });
});

describe("one env list for terminal tiles (F6)", () => {
  test("a tile's program gets the person's environment without the door's Herdr pane or how the door started", () => {
    const env = tileEnv({ PATH: "/bin", HOME: "/home/someone", EP0CH_STATE: "/s", EP0CH_SOCKET: "/o.sock", HERDR_SOCKET_PATH: "/h.sock", HERDR_PANE_ID: "p1", HERDR_TAB_ID: "t1", EP0CH_DAILY_AGENT: "claude", EP0CH_LANDING: "brief", EP0CH_DAILY_CWD: "~/garden" }, "editor", "/c/door.sock");
    for (const k of [...HERDR_PANE_VARS, ...DOOR_START_VARS]) expect(env[k]).toBeUndefined();
    expect(env).toMatchObject({ PATH: "/bin", EP0CH_STATE: "/s", EP0CH_SOCKET: "/o.sock", HERDR_SOCKET_PATH: "/h.sock", EP0CH_DAILY_CWD: "~/garden",
      EP0CH_TILE: "editor", EP0CH_CONTROL: "/c/door.sock", TERM: "xterm-256color", COLORTERM: "truecolor" });
    expect(tileEnv({ EP0CH_CONTROL: "/elsewhere.sock" }, "x", null).EP0CH_CONTROL).toBe("/elsewhere.sock");
  });

  test("the Herdr list is written once: tests use HERDR_VARS, and try-it.sh unsets the same five", () => {
    const script = readFileSync(join(import.meta.dir, "../scripts/try-it.sh"), "utf8");
    const unset = [...script.matchAll(/-u (HERDR_\w+)/g)].map(m => m[1]);
    expect(unset.sort()).toEqual([...HERDR_VARS].sort());
    for (const f of readdirSync(import.meta.dir).filter(f => f.endsWith(".ts") && f !== "runtime-parts.test.ts"))
      expect(readFileSync(join(import.meta.dir, f), "utf8")).not.toMatch(/"HERDR_ENV",\s*"HERDR_SOCKET_PATH"/);
  });
});

describe("two doors on one state dir (F19)", () => {
  test("marks from two stores on one file are all kept and never numbered alike", async () => {
    const a = new LocalMarks(), b = new LocalMarks();
    const m1 = a.add({ block: "0000aaaa", reason: "check the rope", by: "you" });
    await Bun.sleep(5);
    const m2 = b.add({ block: "0000bbbb", reason: "check the sails", by: "deckhand-1" });
    await Bun.sleep(5);
    const m3 = a.add({ block: "0000cccc", reason: "check the keel", by: "you" });
    expect(new Set([m1.n, m2.n, m3.n]).size).toBe(3);
    for (const s of [a, b]) expect(s.list().map(m => m.reason).sort()).toEqual(["check the keel", "check the rope", "check the sails"]);
    await Bun.sleep(5);
    expect(b.remove(m1.n)?.reason).toBe("check the rope");
    expect(a.list().map(m => m.n).sort()).toEqual([m2.n, m3.n].sort());
  });

  test("a door says which other doors use its state dir; a gone door's claim is swept", () => {
    const doors = join(stateDir(), "doors");
    mkdirSync(doors, { recursive: true });
    const gone = Bun.spawnSync(["true"]).pid;
    writeFileSync(join(doors, String(gone)), "");
    writeFileSync(join(doors, String(process.ppid)), "");   // a live process standing in for another door
    expect(claimState()).toEqual([process.ppid]);
    expect(existsSync(join(doors, String(gone)))).toBe(false);
    expect(existsSync(join(doors, String(process.pid)))).toBe(true);
  });
});

describe("ctrl+e files a killed door left (F5)", () => {
  test("copied to drafts/ and removed; a live door's are left alone", () => {
    const edit = join(stateDir(), "edit");
    const gone = Bun.spawnSync(["true"]).pid;
    mkdirSync(join(edit, `${gone}-abc123`), { recursive: true });
    writeFileSync(join(edit, `${gone}-abc123`, "0000dddd.md"), "Mooring notes\nthe second buoy\n");
    mkdirSync(join(edit, `${process.ppid}-def456`), { recursive: true });
    const kept = recoverEdits(pid => pid === process.ppid);
    expect(kept.length).toBe(1);
    expect(kept[0]!.startsWith(join(stateDir(), "drafts", "0000dddd-editor-"))).toBe(true);
    expect(readFileSync(kept[0]!, "utf8")).toBe("Mooring notes\nthe second buoy\n");
    expect(existsSync(join(edit, `${gone}-abc123`))).toBe(false);
    expect(existsSync(join(edit, `${process.ppid}-def456`))).toBe(true);
  });
});

describe("offline says offline (F24)", () => {
  test("get() on a service that can't be reached throws Offline, not null ('no block')", async () => {
    const b = new SocketBoard(join(root, "no-service.sock"), 1000);
    const e = await b.get("0000eeee-0000-4000-8000-000000000000").catch(x => x);
    b.close();
    expect(e).toBeInstanceOf(Offline);
    expect(String(e.message)).toMatch(/^offline · /);
  });
});
