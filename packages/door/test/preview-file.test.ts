// A file preview (src/desk/preview.ts) re-reads its file when it's saved, the first save too (PIE-822).
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreviewPane } from "../src/desk/preview";
import { until } from "./scratch";

const dir = mkdtempSync(join(tmpdir(), "ep0ch-preview-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
// A desk with nothing to resolve: the file's text is drawn as it is.
const board = new Proxy({}, { get: () => async () => null });
const desk = { ctx: { board, flash() {} }, redraw() {} } as any;

test("a save made as the preview opens the file is read again", async () => {
  // fs.watchFile took its first look a moment after it was called: a save in between (an editor saving as the preview
  // opened beside it) became its starting point and was never read; the desk tiles test's save came 2 ms after.
  for (let i = 0; i < 20; i++) {
    const f = join(dir, `draft-${i}.md`);
    writeFileSync(f, "# scratch\n\nThe daily draft.\n");
    const p = new PreviewPane({ file: f });
    p.init(desk);
    writeFileSync(f, "# Pea notes\n");
    await until(() => p.reads > 0, `save ${i} read again`, 3000);
    expect(p.msg?.text).toBe("# Pea notes\n");
    p.dispose();
  }
});
