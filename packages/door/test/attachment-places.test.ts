// PIE-1671: opening a note reads where its attachments were left once, from the attachments layer, never per field.
// A made-up state folder; no outline is touched.
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoteSurface } from "../src/surface/note";

const FILES = ["list-preview-place.json", "edit-preview-place.json", "sources-place.json", "settings-place.json"];
let dir = "", was: string | undefined;

beforeAll(() => {
  was = process.env.EP0CH_STATE;
  dir = mkdtempSync(join(tmpdir(), "ep0ch-places-"));
  process.env.EP0CH_STATE = dir;
  writeFileSync(join(dir, "edit-preview-place.json"), JSON.stringify({ place: "floating", split: { direction: "right", share: 0.3 } }));
  writeFileSync(join(dir, "list-preview-place.json"), JSON.stringify({ place: "popup" }));
});
afterAll(() => { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; fs.rmSync(dir, { recursive: true, force: true }); });

test("readers opened one after another read each placement file once, and start where it was left", () => {
  const reads = spyOn(fs, "readFileSync");
  try {
    const surfaces = Array.from({ length: 4 }, () => new NoteSurface());
    const counts = Object.fromEntries(FILES.map(f => [f, reads.mock.calls.filter(c => String(c[0]).endsWith(`/${f}`)).length]));
    expect(counts).toEqual(Object.fromEntries(FILES.map(f => [f, 1])));
    for (const s of surfaces) {
      expect(s.editPreview.place).toBe("floating");
      expect(s.attachments.splits["edit-preview"]).toEqual({ direction: "right", share: 0.3 });
      expect(s.listPreview.place).toBe("popup");
    }
    // One reader's split is its own: sizing it moves no other reader's.
    surfaces[0]!.attachments.splits["edit-preview"].share = 0.6;
    expect(surfaces[1]!.attachments.splits["edit-preview"].share).toBe(0.3);
  } finally { reads.mockRestore(); }
});
