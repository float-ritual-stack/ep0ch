import { describe, expect, test } from "bun:test";
import { looksLikeDate, readBound, readDate, readDateBound, valueHolds } from "../src/dates";
import { dateWarnings, describeReferenceWarnings } from "../src/reference-warnings";

// Tuesday 2026-10-13, 17:00 on the wall clock.
const NOW = Date.UTC(2026, 9, 13, 17, 0);
const day = (text: string) => { const w = readDate(text, NOW); return w && new Date(w.from).toISOString().slice(0, 10); };

describe("dates as people write them", () => {
  test("every common spelling of one day reads as that day", () => {
    for (const text of ["2026-10-20", "2026/10/20", "Oct 20", "October 20, 2026", "oct. 20th", "20 Oct", "20th of October 2026", "10/20", "10/20/26", "10/20/2026", "Tue Oct 20", "2026-10-20 4:23 PM", "2026-10-20T09:30"]) {
      expect([text, day(text)]).toEqual([text, "2026-10-20"]);
    }
    // Day first when the first number can't be a month.
    expect(day("20/10")).toBe("2026-10-20");
  });

  test("a date without a year is the one nearest today", () => {
    expect(day("Jan 5")).toBe("2027-01-05");
    expect(day("Sep 30")).toBe("2026-09-30");
  });

  test("a span covers its first day to the end of its last", () => {
    const w = readDate("2026-10-20..2026-10-24", NOW)!;
    expect([new Date(w.from).toISOString(), new Date(w.to).toISOString()]).toEqual(["2026-10-20T00:00:00.000Z", "2026-10-24T23:59:59.999Z"]);
    expect(readDate("Oct 20..24", NOW)).toEqual(w);
    expect(readDate("2026-10-24..2026-10-20", NOW)).toBeNull();
    // An end without a year is nearest the start: a window next October stays next October.
    expect(new Date(readDate("2027-10-20..Oct 24", NOW)!.to).toISOString().slice(0, 10)).toBe("2027-10-24");
    // Milliseconds count.
    expect(valueHolds("2026-10-20T09:30:00.900", ">", readBound("2026-10-20T09:30:00.100", NOW), NOW)).toBe(true);
  });

  test("impossible dates read as none, and only date-shaped text asks to be fixed", () => {
    for (const text of ["Oct 32", "2026-13-01", "Feb 30", "2026-10-20 25:00"]) expect([text, readDate(text, NOW)]).toEqual([text, null]);
    expect(["Oct 32", "2026-13-01", "13/45/2026"].map(looksLikeDate)).toEqual([true, true, true]);
    expect(["3/5", "1-2", "may 5 people come", "someday", "v2.1"].map(looksLikeDate)).toEqual([false, false, false, false, false]);
  });

  test("a bound is relative to now", () => {
    expect(new Date(readDateBound("today", NOW)!.from).toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(new Date(readDateBound("+3d", NOW)!.from).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(new Date(readDateBound("-12h", NOW)!.from).toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(new Date(readDateBound("-30m", NOW)!.from).toISOString()).toBe("2026-10-13T16:30:00.000Z");
    // A day is on one side of +3d only, whatever the hour.
    const third = readBound("+3d", NOW);
    expect([valueHolds("2026-10-16", "<=", third, NOW), valueHolds("2026-10-16", ">", third, NOW)]).toEqual([true, false]);
    expect(readBound("3", NOW)).toEqual({ kind: "number", value: 3 });
    expect(readBound("beta", NOW)).toEqual({ kind: "text", value: "beta" });
  });

  test("a value holds when any of its dates does, and says when it can't be read", () => {
    const soon = readBound("+3d", NOW);
    expect(valueHolds("[Oct 30, Oct 15]", "<=", soon, NOW)).toBe(true);
    expect(valueHolds("Oct 30", "<=", soon, NOW)).toBe(false);
    expect(valueHolds("someday", "<=", soon, NOW)).toBeNull();
    expect(valueHolds("2026-10-10..2026-10-14", "=", readBound("today", NOW), NOW)).toBe(true);
  });

  test("a save warns about a date it can't read, never one it can", () => {
    const ws = dateWarnings("Kiln estimate [due::Oct 32] [sent::Oct 3] [score::3/5]\n```\n[due::Oct 99]\n```");
    expect(ws.map(w => w.written)).toEqual(["[due::Oct 32]"]);
    expect(describeReferenceWarnings(ws)).toStartWith("saved; a date can't be read: [due::Oct 32] isn't a date");
  });
});
