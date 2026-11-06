// PIE-1589: what a terminal pastes for dropped files, read: quoted and escaped paths, several on a line or a line each,
// macOS's bare names. A name with its narrow no-break space opens like any other. Made-up files in a temp folder.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMediaPath } from "../src/media";
import { droppedFiles, findDropped } from "../src/paste-image";

const dir = mkdtempSync(join(tmpdir(), "ep0ch-drop-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const narrow = "Plot 2026-03-02 at 2.55.46 AM.png", plainName = "Plot 2026-03-02 at 2.55.46 AM.png";
writeFileSync(join(dir, narrow), "x");
writeFileSync(join(dir, "gate.jpg"), "x");
const other = join(dir, "other"); mkdirSync(other);

describe("what a paste of dropped files reads as", () => {
  test("a path quoted, or with escaped spaces, with the space a terminal adds after it", () => {
    expect(droppedFiles(`'/shots/plot at dusk.png' `)).toEqual(["/shots/plot at dusk.png"]);
    expect(droppedFiles(`/shots/plot\\ at\\ dusk.png`)).toEqual(["/shots/plot at dusk.png"]);
    expect(droppedFiles(`"~/shots/gate.jpg"`)).toEqual(["~/shots/gate.jpg"]);
  });
  test("several: on one line, or a line each, with the narrow space kept", () => {
    expect(droppedFiles(`'/a/b c.png' /d/e\\ f.webp`)).toEqual(["/a/b c.png", "/d/e f.webp"]);
    expect(droppedFiles(`/a/one.png\r\n/a/two.png\n`)).toEqual(["/a/one.png", "/a/two.png"]);
    expect(droppedFiles(`/a/plot\\ at AM.png`)).toEqual(["/a/plot at AM.png"]);
  });
  test("macOS's bare names, a line each, as they were saved on Nov 2", () => {
    expect(droppedFiles(`${narrow}\ngate.jpg \n`)).toEqual([narrow, "gate.jpg"]);
  });
  test("a path with spaces its terminal left as they are is one file", () => {
    expect(droppedFiles("/shots/plot at dusk.png")).toEqual(["/shots/plot at dusk.png"]);
  });
  test("anything else is an ordinary paste: images mixed with anything stay text, never one file made of them", () => {
    for (const text of ["", "\n", "some words", "/tmp is full", "- gate.jpg", "see [img::/a.png]", "/a/notes.txt", "'/a/open.png", "/a/one.png\nand words",
      "/shots/a.png /shots/notes.txt /shots/b.png", "/shots/notes.txt /shots/b.png", "/shots/a.png then /shots/b.png", "/shots/a.png b.png", "'/shots/a b.png' c.png", "/shots/a.png\n/shots/notes.txt"]) {
      expect(droppedFiles(text)).toBeNull();
    }
  });
});

describe("finding it", () => {
  test("a path that's here, either way round the narrow space", () => {
    expect(resolveMediaPath(join(dir, narrow))).toEqual({ path: join(dir, narrow), exists: true });
    expect(resolveMediaPath(join(dir, plainName))).toEqual({ path: join(dir, narrow), exists: true });
    writeFileSync(join(other, plainName), "x");
    expect(resolveMediaPath(join(other, narrow))).toEqual({ path: join(other, plainName), exists: true });
  });
  test("a bare name or another machine's path, by its name in the folders named; none, null", () => {
    expect(findDropped(plainName, [other, dir])).toBe(join(other, plainName));
    expect(findDropped("gate.jpg", [other, dir])).toBe(join(dir, "gate.jpg"));
    expect(findDropped("/Users/someone/Desktop/gate.jpg", [dir])).toBe(join(dir, "gate.jpg"));
    expect(findDropped("gate.jpg", [other])).toBeNull();
    expect(findDropped("gate.jpg", [join(dir, "no-such-folder")])).toBeNull();
    expect(findDropped(join(dir, "gate.jpg"), [])).toBe(join(dir, "gate.jpg"));
  });
});
