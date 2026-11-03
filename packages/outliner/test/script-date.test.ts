// date(text) in scripts (PIE-1525): a date as people write it in a property, read as the views read one, in the
// service host's zone. The Waiting extension sorts by it.
import { expect, test } from "bun:test";
import { scriptDate } from "../src/script-runtime";

test("a date and time as written is that moment on this host; a day runs to its end; words that aren't a date are null", () => {
  expect(scriptDate("2026-01-05 4:23 PM")).toMatchObject({ ms: new Date(2026, 0, 5, 16, 23).getTime() });
  expect(scriptDate("2026-01-05 09:30")?.ms).toBe(new Date(2026, 0, 5, 9, 30).getTime());
  const day = scriptDate("2026-01-05")!;
  expect(day.ms).toBe(new Date(2026, 0, 5).getTime());
  expect(day.endMs).toBeGreaterThan(day.ms);
  expect(day.at).toBe(new Date(day.ms).toISOString());
  expect(scriptDate("last week")).toBeNull();
  expect(scriptDate(undefined)).toBeNull();
});
