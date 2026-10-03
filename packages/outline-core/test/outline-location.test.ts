import { describe, expect, test } from "bun:test";
import {
  formatDotEp0ch, guessOutline, outlineOfFile, type LocationReader, nearestDotEp0ch, outlineLayout, outlinesFolder, parseDotEp0ch,
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
    expect(() => nearestDotEp0ch("/a", disk({ "/a/.ep0ch": "garden\n" }))).toThrow('/a/.ep0ch must hold one line, ws = "<name>"');
    expect(() => parseDotEp0ch('ws = "Garden"', "/a/.ep0ch")).toThrow("isn't an outline name");
    expect(() => parseDotEp0ch('ws = "a"\nws = "b"', "/a/.ep0ch")).toThrow("one line");
    expect(() => parseDotEp0ch("# nothing\n", "/a/.ep0ch")).toThrow("is empty");
    expect(parseDotEp0ch(formatDotEp0ch("float-hub"), "/a/.ep0ch")).toBe("float-hub");
    expect(() => formatDotEp0ch("Float Hub")).toThrow("isn't an outline name");
  });

  test("outlines live in EP0CH_OUTLINES, else ~/outlines: <name>.sqlite beside <name>/, the host's files in dot folders", () => {
    expect(outlinesFolder({}, HOME)).toBe("/home/sam/outlines");
    expect(outlinesFolder({ EP0CH_OUTLINES: "/srv/fictional-outlines/" }, HOME)).toBe("/srv/fictional-outlines");
    const layout = outlineLayout("/home/sam/outlines");
    expect([layout.database("pie"), layout.folder("pie"), layout.socket, layout.lock, layout.clientDir("pie"), layout.deleted]).toEqual([
      "/home/sam/outlines/pie.sqlite", "/home/sam/outlines/pie", "/home/sam/outlines/.host/host.sock",
      "/home/sam/outlines/.host/host.lock", "/home/sam/outlines/.clients/pie", "/home/sam/outlines/.deleted",
    ]);
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
