// Dates and numbers on any property (PIE-769), asked the way a work outline asks them: what's due in three days, what's
// done waiting, which release window today is inside, what was sent this week. The notes are made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY_MS, wallClock } from "@ep0ch/outline-core/dates";
import { parseSearchExpression } from "../src/block-query";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, VisibleBlockCollection } from "../src/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Today plus `n` days, written each way people write a date. */
const day = (n: number) => {
  const d = new Date(Math.floor(wallClock(Date.now()) / DAY_MS) * DAY_MS + n * DAY_MS);
  const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  return { iso: d.toISOString().slice(0, 10), short: `${MONTHS[m - 1]} ${dd}`, slashed: `${m}/${dd}`, dayFirst: `${dd} ${MONTHS[m - 1]}`, y };
};

let root: string, server: OutlinerServer, client: OutlinerClient;
const query = (where: string, extra: object = {}) =>
  client.request<VisibleBlockCollection & { hint?: string; groups?: { value: string | null; count: number }[] }>({ action: "blocks.query", query: { where, limit: 50, ...extra } });
const names = (c: { blocks: Block[] }) => c.blocks.map(b => b.text.split(" [")[0]);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "query-dates-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  server = new OutlinerServer(store, join(root, "service.sock"));
  await server.start();
  client = new OutlinerClient(join(root, "service.sock"));
  const create = (text: string) => client.request<Block>({ action: "create", text });
  // Follow-ups, due dates written four ways.
  await create(`Send the kiln estimate [type::follow-up] [due::${day(-2).iso}]`);
  await create(`Book the glaze room [type::follow-up] [due::${day(1).short}]`);
  await create(`Chase the clay order [type::follow-up] [due::${day(3).slashed}]`);
  await create(`Plan the open studio [type::follow-up] [due::${day(9).dayFirst}]`);
  await create(`Water the fern [type::follow-up] [due::someday]`);
  // Waiting until a day before doing something.
  await create(`Ask about the shelf again [type::follow-up] [wait-until::${day(0).iso}]`);
  await create(`Nudge the framer [type::follow-up] [wait-until::${day(5).iso}]`);
  // Release windows: spans.
  await create(`Mugs release [type::release] [release-window::${day(-1).iso}..${day(2).iso}]`);
  await create(`Bowls release [type::release] [release-window::${day(6).iso}..${day(10).iso}]`);
  // Sprints, messages and ratings.
  await create(`Sprint 7 [type::sprint] [sprint-start::${day(-10).iso}] [sprint-end::${day(-1).iso}]`);
  await create(`Sprint 8 [type::sprint] [sprint-start::${day(0).iso}] [sprint-end::${day(13).iso}]`);
  await create(`Note to the gallery [type::message] [sent::${day(-2).iso} 4:23 PM] [rating::4]`);
  await create(`Note to the supplier [type::message] [sent::${day(-30).iso}] [rating::2]`);
});

afterAll(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("dates and numbers on any property", () => {
  test("what's due in three days, overdue included, however the date was written", async () => {
    expect(names(await query("type=follow-up due <= +3d"))).toEqual(["Send the kiln estimate", "Book the glaze room", "Chase the clay order"]);
    expect(names(await query("type=follow-up due < today"))).toEqual(["Send the kiln estimate"]);
    expect(names(await query(`due > "${day(3).short}"`))).toEqual(["Plan the open studio"]);
    expect(names(await query(`due = ${day(1).iso}`))).toEqual(["Book the glaze room"]);
    expect(names(await query(`[due::${day(3).short}]`))).toEqual(["Chase the clay order"]);
  });

  test("a value that isn't a date never matches, and the answer says which", async () => {
    const answer = await query("type=follow-up due <= +30d");
    expect(names(answer)).not.toContain("Water the fern");
    expect(answer.hint).toContain("due: 1 note has a value that isn't a date: “someday”");
    // Only about the notes the question asks of: another kind of note's `due::Wed` is no concern of a follow-up query.
    await client.request<Block>({ action: "create", text: "Bin day [type::chore] [due::Wed]" });
    expect((await query("type=follow-up due <= +30d")).hint).not.toContain("Wed");
  });

  test("waiting until a day surfaces itself on that day", async () => {
    expect(names(await query("wait-until <= today"))).toEqual(["Ask about the shelf again"]);
    expect(names(await query("wait-until > today"))).toEqual(["Nudge the framer"]);
  });

  test("today is inside a release window", async () => {
    expect(names(await query("type=release release-window = today"))).toEqual(["Mugs release"]);
    expect(names(await query("release-window <= today release-window >= today"))).toEqual(["Mugs release"]);
    // Any day of a span counts: one still running has days after today; one that hasn't begun is NOT <= today.
    expect(names(await query("release-window > today"))).toEqual(["Mugs release", "Bowls release"]);
    expect(names(await query("release-window NOT release-window <= today"))).toEqual(["Bowls release"]);
    expect(names(await query("type=sprint sprint-start <= today sprint-end >= today"))).toEqual(["Sprint 8"]);
  });

  test("a message sent this week, and numbers as numbers", async () => {
    expect(names(await query("sent >= -7d"))).toEqual(["Note to the gallery"]);
    expect(names(await query("rating > 3"))).toEqual(["Note to the gallery"]);
    expect(names(await query("rating <= 10 rating >= 2"))).toEqual(["Note to the gallery", "Note to the supplier"]);
  });

  test("sorted and grouped by a date property, in calendar order", async () => {
    const sorted = await query("type=follow-up due", { sort: "due asc" });
    expect(names(sorted)).toEqual(["Send the kiln estimate", "Book the glaze room", "Chase the clay order", "Plan the open studio", "Water the fern"]);
    const grouped = await query("type=follow-up due", { group: "due:day" });
    expect(grouped.groups!.map(g => g.value)).toEqual([day(-2).iso, day(1).iso, day(3).iso, day(9).iso, null]);
  });

  test("a comparison names its property, and says how when it doesn't", () => {
    expect(parseSearchExpression("due <= +3d").where).toEqual({ kind: "compare", key: "due", op: "<=", value: "+3d" });
    expect(parseSearchExpression('due<="Oct 20"').where).toEqual({ kind: "compare", key: "due", op: "<=", value: "Oct 20" });
    expect(() => parseSearchExpression("<= today")).toThrow("Write it like due <= +3d");
  });
});
