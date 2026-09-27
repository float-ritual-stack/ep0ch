import {expect, spyOn, test} from "bun:test";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ViewPreferences} from "../src/view-preferences";

function preferencesWith(contents: string): ViewPreferences {
  const path = join(mkdtempSync(join(tmpdir(), "view-preferences-")), "view.json");
  writeFileSync(path, contents);
  try { return new ViewPreferences({OUTLINER_VIEW_PREFERENCES_PATH: path}); }
  finally { rmSync(join(path, ".."), {recursive:true,force:true}); }
}

test("malformed or unsupported view preferences fall back to compact with a diagnostic", () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(preferencesWith("{not json").density).toBe("compact");
    expect(preferencesWith(JSON.stringify({density: "roomy"})).density).toBe("compact");
    expect(error).toHaveBeenCalledTimes(2);
    expect(preferencesWith(JSON.stringify({density: "expanded"})).density).toBe("expanded");
    expect(error).toHaveBeenCalledTimes(2);
  } finally {
    error.mockRestore();
  }
});
