import { describe, expect, test } from "bun:test";
import {
  formatDotEp0ch, guessOutline, isMachineName, outlineOfFile, type LocationReader, nearestDotEp0ch, outlineLayout, outlinesFolder, parseDotEp0ch,
  slugifyOutlineName, whichOutline,
} from "../src/outline-location";

/** A disk made of paths: files with their text, and folders that hold a `.git`. */
function disk(files: Record<string, string>, gitRoots: string[] = []): LocationReader {
  return {
    readFile: path => files[path],
    exists: path => path in files || gitRoots.some(root => path === `${root}/.git`),
  };
}
const HOME = "/home/sam";

describe("which outline (PIE-530)", () => {
  const fs = disk({ "/work/garden/.ep0ch": 'ws = "garden"\n', "/work/garden/beds/.ep0ch": '# the beds have their own\nws = "garden-beds"\n' }, ["/work/garden", "/work/jam-shelf"]);

  test("--ws wins from anywhere, then EP0CH_WS, then the nearest .ep0ch walking up", () => {
    expect(whichOutline({ flag: "float-hub", env: "pie", folder: "/work/garden/beds/peas", home: HOME, fs })).toEqual({ kind: "named", name: "float-hub", source: "flag" });
    expect(whichOutline({ env: "pie", folder: "/work/garden", home: HOME, fs })).toEqual({ kind: "named", name: "pie", source: "env" });
    expect(whichOutline({ folder: "/work/garden/paths/stones", home: HOME, fs }))
      .toEqual({ kind: "named", name: "garden", source: "file", file: "/work/garden/.ep0ch", folder: "/work/garden" });
    expect(whichOutline({ folder: "/work/garden/beds/peas", home: HOME, fs })).toMatchObject({ name: "garden-beds", file: "/work/garden/beds/.ep0ch" });
  });

  test("--ws from anywhere and the folder's own .ep0ch name the same outline, and so the same file", () => {
    const fromAnywhere = whichOutline({ flag: "garden", folder: "/tmp/elsewhere", home: HOME, fs });
    const inside = whichOutline({ folder: "/work/garden/paths", home: HOME, fs });
    expect(fromAnywhere.kind === "named" && inside.kind === "named" && fromAnywhere.name === inside.name).toBe(true);
    const layout = outlineLayout("/home/sam/outlines");
    expect(layout.database(fromAnywhere.kind === "named" ? fromAnywhere.name : "")).toBe("/home/sam/outlines/garden.sqlite");
  });

  test("a folder that names nothing is unnamed, with the folder's or its repository's name offered for init, never used", () => {
    expect(whichOutline({ folder: "/work/jam-shelf/notes", home: HOME, fs })).toMatchObject({
      kind: "unnamed", folder: "/work/jam-shelf/notes", guess: { name: "jam-shelf", folder: "/work/jam-shelf" },
    });
    expect(whichOutline({ folder: "/opt/fictional/Bandit Notes", home: HOME, fs })).toMatchObject({ kind: "unnamed", guess: { name: "bandit-notes", folder: "/opt/fictional/Bandit Notes" } });
    // $HOME, / and a folder right under / are too broad to name an outline after: no guess.
    for (const folder of [HOME, "/", "/tmp"]) expect("guess" in whichOutline({ folder, home: HOME, fs })).toBe(false);
    // A repository rooted at $HOME gives way to the folder's own name.
    expect(guessOutline(`${HOME}/sketches`, HOME, disk({}, [HOME]))).toEqual({ name: "sketches", folder: `${HOME}/sketches` });
  });

  test("names are checked: a bad --ws, EP0CH_WS or .ep0ch is said, never read as no outline", () => {
    expect(() => whichOutline({ flag: "Not A Name", folder: "/", home: HOME, fs })).toThrow("--ws");
    expect(() => whichOutline({ env: "../x", folder: "/", home: HOME, fs })).toThrow("EP0CH_WS");
    expect(() => nearestDotEp0ch("/a", disk({ "/a/.ep0ch": "garden\n" }))).toThrow('/a/.ep0ch must hold ws = "<name>"');
    expect(() => parseDotEp0ch('ws = "Garden"', "/a/.ep0ch")).toThrow("isn't an outline name");
    expect(() => parseDotEp0ch('ws = "a"\nws = "b"', "/a/.ep0ch")).toThrow("at most one");
    expect(() => parseDotEp0ch("# nothing\n", "/a/.ep0ch")).toThrow("names no outline");
    expect(parseDotEp0ch(formatDotEp0ch("float-hub"), "/a/.ep0ch")).toEqual({ name: "float-hub" });
    expect(() => formatDotEp0ch("Float Hub")).toThrow("isn't an outline name");
  });

  test("a .ep0ch names a machine beside the outline: an ssh config name, never a path, a user@ or an option", () => {
    expect(formatDotEp0ch("pie", "float-2")).toBe('ws = "pie"\nmachine = "float-2"\n');
    expect(parseDotEp0ch('# on the box\nmachine = "float-2"\nws = "pie"\n', "/a/.ep0ch")).toEqual({ name: "pie", machine: "float-2" });
    expect(() => parseDotEp0ch('ws = "pie"\nmachine = "a"\nmachine = "b"', "/a/.ep0ch")).toThrow("at most one");
    expect(() => parseDotEp0ch('machine = "float-2"', "/a/.ep0ch")).toThrow("names no outline");
    for (const bad of ["/home/sam/box", "sam@box", "-oProxyCommand=x", "box:22", ""]) {
      expect(isMachineName(bad)).toBe(false);
      expect(() => parseDotEp0ch(`ws = "pie"\nmachine = "${bad}"`, "/a/.ep0ch")).toThrow();
    }
    expect(() => formatDotEp0ch("pie", "sam@box")).toThrow("isn't a machine name");
  });

  test("the machine: --machine, then EP0CH_MACHINE, then the machine of the .ep0ch that named the outline", () => {
    const fs = disk({ "/work/far/.ep0ch": 'ws = "pie"\nmachine = "box-a"\n', "/work/near/.ep0ch": 'ws = "garden"\n' });
    expect(whichOutline({ folder: "/work/far/notes", home: HOME, fs })).toMatchObject({ name: "pie", machine: "box-a", machineSource: "file" });
    expect(whichOutline({ machineEnv: "box-b", folder: "/work/far", home: HOME, fs })).toMatchObject({ name: "pie", machine: "box-b", machineSource: "env" });
    expect(whichOutline({ machineFlag: "box-c", machineEnv: "box-b", folder: "/work/far", home: HOME, fs })).toMatchObject({ name: "pie", machine: "box-c", machineSource: "flag" });
    // A .ep0ch is read whole: an outline named by --ws or EP0CH_WS takes no machine from a file that named another.
    expect(whichOutline({ flag: "garden", folder: "/work/far", home: HOME, fs })).toEqual({ kind: "named", name: "garden", source: "flag" });
    expect(whichOutline({ env: "garden", folder: "/work/far", home: HOME, fs })).toEqual({ kind: "named", name: "garden", source: "env" });
    expect(whichOutline({ flag: "garden", machineFlag: "box-a", folder: "/", home: HOME, fs })).toMatchObject({ name: "garden", machine: "box-a" });
    expect("machine" in whichOutline({ folder: "/work/near", home: HOME, fs })).toBe(false);
    // Nothing names an outline: the machine named is still said (the home base opens on it).
    expect(whichOutline({ machineFlag: "box-a", folder: "/opt/elsewhere/x", home: HOME, fs })).toMatchObject({ kind: "unnamed", machine: "box-a" });
    expect(() => whichOutline({ machineFlag: "sam@box", folder: "/", home: HOME, fs })).toThrow("--machine");
    expect(() => whichOutline({ machineEnv: "../box", folder: "/", home: HOME, fs })).toThrow("EP0CH_MACHINE");
  });

  test("outlines live in EP0CH_OUTLINES, else ~/outlines: <name>.sqlite beside <name>/, the host's files in dot folders", () => {
    expect(outlinesFolder({}, HOME)).toBe("/home/sam/outlines");
    expect(outlinesFolder({ EP0CH_OUTLINES: "/srv/fictional-outlines/" }, HOME)).toBe("/srv/fictional-outlines");
    const layout = outlineLayout("/home/sam/outlines");
    expect([layout.database("pie"), layout.folder("pie"), layout.socket, layout.lock, layout.clientDir("pie"), layout.deleted]).toEqual([
      "/home/sam/outlines/pie.sqlite", "/home/sam/outlines/pie", "/home/sam/outlines/.host/host.sock",
      "/home/sam/outlines/.host/host.lock", "/home/sam/outlines/.clients/pie", "/home/sam/outlines/.deleted",
    ]);
    expect(layout.remote("box-a")).toEqual({ socket: "/home/sam/outlines/.remote/box-a.sock", control: "/home/sam/outlines/.remote/box-a.ctl" });
    expect(slugifyOutlineName("Évan's Fictional Garden!")).toBe("evan-s-fictional-garden");
  });
});

test("only <name>.sqlite files are outlines: the owner lock, WAL and other files beside them are not", () => {
  expect(outlineOfFile("garden.sqlite")).toBe("garden");
  expect(outlineOfFile("garden.sqlite.owner.sqlite")).toBeNull();
  expect(outlineOfFile("garden.sqlite-wal")).toBeNull();
  expect(outlineOfFile("notes.txt")).toBeNull();
  expect(outlineOfFile(".sqlite")).toBeNull();
});
