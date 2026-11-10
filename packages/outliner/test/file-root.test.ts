// A relative file path is the outline's own folder's (PIE-1695): `notes.md` is `<outlines>/<name>/notes.md`, and a file
// above that folder is said with the folder it is really in, never shown as if it were one of the outline's.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerStore } from "../src/store";

function withOutline(run: (outlines: string, store: OutlinerStore) => void): void {
  const outlines = mkdtempSync(join(tmpdir(), "outliner-file-root-"));
  const folder = join(outlines, "garden");
  mkdirSync(folder);
  const store = new OutlinerStore(join(outlines, "garden.sqlite"), { workspaceRoot: folder });
  try { run(outlines, store); } finally { store.close(); rmSync(outlines, { recursive: true, force: true }); }
}

test("a relative file is read from the outline's folder, and one above it names the folder it is in (PIE-1695)", () => {
  withOutline((outlines, store) => {
    writeFileSync(join(outlines, "garden", "beds.md"), "# Beds\n");
    writeFileSync(join(outlines, "outside.txt"), "Above the outline\n");

    const inside = store.resources.internFilesystem({ path: "beds.md" });
    expect(inside.resource.address).toEqual({ kind: "filesystem", path: "beds.md" });
    expect(store.resources.describe(inside.resource.id, true).source.name).toBe("Filesystem · garden");

    const outside = store.resources.internFilesystem({ path: "../outside.txt" });
    const described = store.resources.describe(outside.resource.id, true);
    expect(described.source.boundary).toMatchObject({ root: outlines });
    expect(described.source.name).toBe(`Filesystem · ${outlines} (outside this outline's folder)`);
    expect(store.resources.readFilesystemReference("../outside.txt").text).toBe("Above the outline\n");
  });
});
